/**
 * Family / sibling grouping for Migration Centre.
 *
 * Surname, cellphone, email, address, and fuzzy names are REVIEW SIGNALS only.
 * They are never AUTO-LINK AUTHORITY.
 */

export type FamilyEvidenceAuthority =
  | "SOURCE_ACCOUNT"
  | "SOURCE_PARENT_ID"
  | "PARENT_ID_NUMBER"
  | "EXISTING_PARENT_LEARNER_LINK"
  | "OPERATOR_APPROVED_MAPPING";

export type FamilyEvidenceDecision = "AUTO_GROUP" | "KEEP_SEPARATE" | "REVIEW_REQUIRED";

export type MigrationFamilySourceLearner = {
  key: string;
  schoolId: string;
  lastName?: string | null;
  sourceAccountRef?: string | null;
  sourceParentId?: string | null;
  parentIdNumber?: string | null;
  parentCell?: string | null;
  parentEmail?: string | null;
  address?: string | null;
  existingFamilyAccountRef?: string | null;
  existingParentLinkFamilyAccountRef?: string | null;
  operatorFamilyKey?: string | null;
};

export type MigrationFamilyGroup = {
  groupKey: string;
  learnerKeys: string[];
  decision: FamilyEvidenceDecision;
  authority: FamilyEvidenceAuthority | null;
  canonicalAccountRef: string | null;
  reviewReason: string | null;
};

export type MigrationFamilyReviewSignal = {
  kind:
    | "SURNAME_ONLY"
    | "WEAK_CONTACT_ONLY"
    | "FUZZY_NAME"
    | "SHARED_PARENT_DIFFERENT_ACCOUNTS"
    | "INSUFFICIENT_EVIDENCE";
  learnerKeys: string[];
  message: string;
};

function clean(value: unknown): string {
  return String(value || "").trim();
}

function normName(value: unknown): string {
  return clean(value).toLowerCase().replace(/\s+/g, " ");
}

function normId(value: unknown): string {
  return clean(value).replace(/\D/g, "");
}

function usableId(value: unknown): boolean {
  return normId(value).length >= 6;
}

function accountKey(value: unknown): string {
  return clean(value).toUpperCase();
}

export function resolveFamilyGroupingAuthority(
  learners: MigrationFamilySourceLearner[]
): {
  groups: MigrationFamilyGroup[];
  reviews: MigrationFamilyReviewSignal[];
} {
  const bySchool = new Map<string, MigrationFamilySourceLearner[]>();
  for (const learner of learners) {
    const schoolId = clean(learner.schoolId);
    if (!schoolId) continue;
    const list = bySchool.get(schoolId) || [];
    list.push(learner);
    bySchool.set(schoolId, list);
  }

  const groups: MigrationFamilyGroup[] = [];
  const reviews: MigrationFamilyReviewSignal[] = [];

  for (const [schoolId, schoolLearners] of bySchool) {
    const assigned = new Set<string>();

    const take = (
      members: MigrationFamilySourceLearner[],
      decision: FamilyEvidenceDecision,
      authority: FamilyEvidenceAuthority | null,
      canonicalAccountRef: string | null,
      reviewReason: string | null
    ) => {
      if (members.length === 0) return;
      for (const m of members) assigned.add(m.key);
      const refs = [
        ...new Set(members.map((m) => accountKey(m.sourceAccountRef)).filter(Boolean)),
      ];
      groups.push({
        groupKey: `${schoolId}:${authority || "review"}:${canonicalAccountRef || members.map((m) => m.key).join(",")}`,
        learnerKeys: members.map((m) => m.key),
        decision,
        authority,
        canonicalAccountRef,
        reviewReason,
      });
      void refs;
    };

    // 1. Operator-approved mapping
    const byOperator = new Map<string, MigrationFamilySourceLearner[]>();
    for (const learner of schoolLearners) {
      const op = clean(learner.operatorFamilyKey);
      if (!op) continue;
      const list = byOperator.get(op) || [];
      list.push(learner);
      byOperator.set(op, list);
    }
    for (const [op, members] of byOperator) {
      take(
        members,
        "AUTO_GROUP",
        "OPERATOR_APPROVED_MAPPING",
        accountKey(members[0]?.sourceAccountRef) || op,
        null
      );
    }

    // 2. Source customer / account identifier — one canonical FamilyAccount
    const remainingAfterOp = schoolLearners.filter((l) => !assigned.has(l.key));
    const byAccount = new Map<string, MigrationFamilySourceLearner[]>();
    for (const learner of remainingAfterOp) {
      const ref = accountKey(learner.sourceAccountRef);
      if (!ref) continue;
      const list = byAccount.get(ref) || [];
      list.push(learner);
      byAccount.set(ref, list);
    }
    for (const [ref, members] of byAccount) {
      take(members, "AUTO_GROUP", "SOURCE_ACCOUNT", ref, null);
    }

    // 3. Existing explicit parent↔learner link already established during migration
    const remainingAfterAccount = schoolLearners.filter((l) => !assigned.has(l.key));
    const byExistingLink = new Map<string, MigrationFamilySourceLearner[]>();
    for (const learner of remainingAfterAccount) {
      const ref = accountKey(
        learner.existingParentLinkFamilyAccountRef || learner.existingFamilyAccountRef
      );
      if (!ref) continue;
      const list = byExistingLink.get(ref) || [];
      list.push(learner);
      byExistingLink.set(ref, list);
    }
    for (const [ref, members] of byExistingLink) {
      take(members, "AUTO_GROUP", "EXISTING_PARENT_LEARNER_LINK", ref, null);
    }

    // 4. Same source parent id or trusted parent ID number.
    // If they already share a source account they were grouped above.
    // Same parent + different source accounts → REVIEW (do not merge financial positions).
    const remaining = schoolLearners.filter((l) => !assigned.has(l.key));
    const byParent = new Map<string, MigrationFamilySourceLearner[]>();
    for (const learner of remaining) {
      const sourceParent = clean(learner.sourceParentId);
      const parentId = usableId(learner.parentIdNumber) ? `id:${normId(learner.parentIdNumber)}` : "";
      const key = sourceParent ? `src:${sourceParent}` : parentId;
      if (!key) continue;
      const list = byParent.get(key) || [];
      list.push(learner);
      byParent.set(key, list);
    }
    for (const members of byParent.values()) {
      if (members.length < 2) continue;
      const accounts = [
        ...new Set(members.map((m) => accountKey(m.sourceAccountRef)).filter(Boolean)),
      ];
      if (accounts.length <= 1 && accounts[0]) {
        take(
          members,
          "AUTO_GROUP",
          members[0]?.sourceParentId ? "SOURCE_PARENT_ID" : "PARENT_ID_NUMBER",
          accounts[0]!,
          null
        );
        continue;
      }
      if (accounts.length > 1) {
        reviews.push({
          kind: "SHARED_PARENT_DIFFERENT_ACCOUNTS",
          learnerKeys: members.map((m) => m.key),
          message:
            "REVIEW REQUIRED. These learners share a parent identity but the source has separate accounts. Keep the accounts separate until an operator confirms they belong on one family account.",
        });
        take(
          members,
          "REVIEW_REQUIRED",
          members[0]?.sourceParentId ? "SOURCE_PARENT_ID" : "PARENT_ID_NUMBER",
          null,
          "Shared parent identity with different source accounts"
        );
      }
    }

    const leftover = schoolLearners.filter((l) => !assigned.has(l.key));

    // Surname-only / weak contact: REVIEW SIGNAL, never auto-group.
    const bySurname = new Map<string, MigrationFamilySourceLearner[]>();
    for (const learner of leftover) {
      const surname = normName(learner.lastName);
      if (!surname) continue;
      const list = bySurname.get(surname) || [];
      list.push(learner);
      bySurname.set(surname, list);
    }
    for (const [surname, members] of bySurname) {
      if (members.length < 2) continue;
      const sameCell = members.every(
        (m) => clean(m.parentCell) && clean(m.parentCell) === clean(members[0]?.parentCell)
      );
      const sameEmail = members.every(
        (m) =>
          clean(m.parentEmail) &&
          clean(m.parentEmail).toLowerCase() === clean(members[0]?.parentEmail).toLowerCase()
      );
      const sameAddress = members.every(
        (m) =>
          normName(m.address) && normName(m.address) === normName(members[0]?.address)
      );
      reviews.push({
        kind: sameCell || sameEmail || sameAddress ? "WEAK_CONTACT_ONLY" : "SURNAME_ONLY",
        learnerKeys: members.map((m) => m.key),
        message:
          sameCell || sameEmail || sameAddress
            ? `REVIEW REQUIRED. Learners share the surname "${surname}" and a contact detail, but that is not enough to combine family accounts automatically.`
            : `REVIEW REQUIRED. Learners share the surname "${surname}" but have no source account or parent identity linking them. They stay on separate accounts.`,
      });
    }

    for (const learner of leftover) {
      const ref = accountKey(learner.sourceAccountRef);
      take(
        [learner],
        ref ? "KEEP_SEPARATE" : "KEEP_SEPARATE",
        ref ? "SOURCE_ACCOUNT" : null,
        ref || null,
        ref ? null : "No source family/account identifier"
      );
    }
  }

  return { groups, reviews };
}

export function admissionBase(admissionNo: string | null | undefined): string {
  const adm = String(admissionNo || "").trim();
  if (!adm) return "";
  const dash = adm.indexOf("-");
  return dash === -1 ? adm : adm.slice(0, dash);
}

export type FamilyAccountLinkCandidate = {
  id: string;
  accountRef: string;
  familyName: string;
};

export type LearnerFamilyLinkInput = {
  id: string;
  lastName: string;
  admissionNo: string | null;
  familyAccountId: string | null;
};

/**
 * Authoritative learner → FamilyAccount match.
 * Admission/account-ref only. Surname is a review signal, never a link.
 */
export function resolveMigrationFamilyAccountLink(input: {
  learner: LearnerFamilyLinkInput;
  familyAccounts: FamilyAccountLinkCandidate[];
}): {
  familyAccountId: string | null;
  reason: "already-linked" | "account-ref" | "unlinked";
  review: MigrationFamilyReviewSignal | null;
} {
  if (input.learner.familyAccountId) {
    return { familyAccountId: input.learner.familyAccountId, reason: "already-linked", review: null };
  }

  const familyByRef = new Map(
    input.familyAccounts.map((fa) => [String(fa.accountRef || "").trim().toUpperCase(), fa])
  );
  const adm = String(input.learner.admissionNo || "").trim();
  const admBase = admissionBase(adm);
  const target =
    (adm && familyByRef.get(adm.toUpperCase())) ||
    (admBase && familyByRef.get(admBase.toUpperCase())) ||
    undefined;

  if (target) {
    return { familyAccountId: target.id, reason: "account-ref", review: null };
  }

  const surname = normName(input.learner.lastName);
  const surnameMatches = surname
    ? input.familyAccounts.filter((fa) => normName(fa.familyName) === surname)
    : [];
  if (surnameMatches.length > 0) {
    return {
      familyAccountId: null,
      reason: "unlinked",
      review: {
        kind: "SURNAME_ONLY",
        learnerKeys: [input.learner.id],
        message:
          "REVIEW REQUIRED. A family account has the same surname, but surname is not enough to attach this learner automatically.",
      },
    };
  }

  return { familyAccountId: null, reason: "unlinked", review: null };
}
