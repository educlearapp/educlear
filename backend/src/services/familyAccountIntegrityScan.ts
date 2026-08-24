/**
 * READ-ONLY family-account / statement-snapshot integrity scan.
 *
 * Detects abandoned snapshots even when no merge-audit entry exists
 * (e.g. MOT682: unenrol + re-register left a HISTORICAL learner + snapshot).
 *
 * This module NEVER writes JSON, Prisma, ledger, or snapshots.
 * Historical leftovers require a separate explicit retirement call.
 */

export type IntegrityClassification =
  | "ACTIVE_CANONICAL"
  | "CONFIRMED_STALE_PREDECESSOR"
  | "ORPHAN_STATEMENT_SNAPSHOT"
  | "ORPHAN_FAMILYACCOUNT"
  | "REVIEW_REQUIRED";

export type IntegritySnapshot = {
  accountRef: string;
  accountHolder?: string;
  balance?: number;
  source?: string;
  importedAt?: string;
  mergedIntoAccountRef?: string;
};

export type IntegrityFamilyAccount = {
  id: string;
  accountRef: string;
  familyName?: string;
  createdAt?: string;
};

export type IntegrityLearner = {
  id: string;
  familyAccountId: string | null;
  firstName: string;
  lastName: string;
  admissionNo?: string | null;
  idNumber?: string | null;
  birthDate?: string | null;
  enrollmentStatus?: string | null;
};

export type IntegrityParent = {
  id: string;
  familyAccountId?: string | null;
  firstName?: string;
  surname?: string;
};

export type IntegrityParentLearnerLink = {
  parentId: string;
  learnerId: string;
};

export type IntegrityLedgerEntry = {
  accountNo?: string;
  type?: string;
  amount?: number;
};

export type IntegrityAuditEntry = {
  action?: string;
  sourceAccountRef?: string;
  targetAccountRef?: string;
  createdAt?: string;
};

export type StatementIntegrityRow = {
  accountRef: string;
  classification: IntegrityClassification;
  reasons: string[];
  familyAccountId: string | null;
  activeLearnerCount: number;
  historicalLearnerCount: number;
  linkedLearnerCount: number;
  ledgerRowCount: number;
  snapshotBalance: number;
  supersededByAccountRef?: string;
};

export type FamilyAccountIntegrityScanInput = {
  snapshots: Record<string, IntegritySnapshot | undefined>;
  familyAccounts: IntegrityFamilyAccount[];
  learners: IntegrityLearner[];
  parents?: IntegrityParent[];
  parentLearnerLinks?: IntegrityParentLearnerLink[];
  ledger?: IntegrityLedgerEntry[];
  audit?: IntegrityAuditEntry[];
};

export type FamilyAccountIntegrityScanResult = {
  statementRows: StatementIntegrityRow[];
  orphanFamilyAccounts: Array<{
    accountRef: string;
    familyAccountId: string;
    onStatements: boolean;
    classification: "ORPHAN_FAMILYACCOUNT";
  }>;
  counts: Record<IntegrityClassification, number> & { statementsScanned: number };
  expectedStatementCountAfterConfirmedRetirement: number;
};

function normRef(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

function enrollmentStatus(learner: IntegrityLearner): string {
  const raw = String(learner.enrollmentStatus || "ACTIVE").trim().toUpperCase();
  return raw || "ACTIVE";
}

function isActive(learner: IntegrityLearner): boolean {
  return enrollmentStatus(learner) === "ACTIVE";
}

function round2(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function compactName(value: unknown): string {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

function birthDay(value: unknown): string {
  return String(value || "").trim().slice(0, 10);
}

function usableIdNumber(value: unknown): string {
  const idn = String(value || "").trim();
  return idn.length >= 6 ? idn : "";
}

function isRetiredSnapshot(snap: IntegritySnapshot | undefined): boolean {
  return Boolean(String(snap?.mergedIntoAccountRef || "").trim());
}

/** Latest merge where this ref was the source (audit newest-first or any order). */
function latestMergeSourceTargets(audit: IntegrityAuditEntry[]): Map<string, string> {
  const dated = [...audit]
    .filter((entry) => String(entry.action || "") === "merge")
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const map = new Map<string, string>();
  for (const entry of dated) {
    const src = normRef(entry.sourceAccountRef);
    const tgt = normRef(entry.targetAccountRef);
    if (!src || !tgt || map.has(src)) continue;
    map.set(src, tgt);
  }
  return map;
}

function duplicateActiveElsewhere(
  learner: IntegrityLearner,
  accountRef: string,
  learners: IntegrityLearner[],
  faById: Map<string, IntegrityFamilyAccount>
): { otherLearnerId: string; otherAccountRef: string; via: "idNumber" | "name+dob" }[] {
  const hits: { otherLearnerId: string; otherAccountRef: string; via: "idNumber" | "name+dob" }[] =
    [];
  const idn = usableIdNumber(learner.idNumber);
  const nameKey = `${compactName(learner.firstName)}|${compactName(learner.lastName)}|${birthDay(
    learner.birthDate
  )}`;
  const hasNameDob =
    compactName(learner.firstName) && compactName(learner.lastName) && birthDay(learner.birthDate);

  for (const other of learners) {
    if (other.id === learner.id) continue;
    if (!isActive(other)) continue;
    const otherFa = other.familyAccountId ? faById.get(other.familyAccountId) : undefined;
    const otherRef = normRef(otherFa?.accountRef);
    if (!otherRef || otherRef === accountRef) continue;

    if (idn && usableIdNumber(other.idNumber) === idn) {
      hits.push({ otherLearnerId: other.id, otherAccountRef: otherRef, via: "idNumber" });
      continue;
    }
    if (!hasNameDob) continue;
    const otherKey = `${compactName(other.firstName)}|${compactName(other.lastName)}|${birthDay(
      other.birthDate
    )}`;
    if (otherKey === nameKey) {
      hits.push({ otherLearnerId: other.id, otherAccountRef: otherRef, via: "name+dob" });
    }
  }
  return hits;
}

/**
 * Classify displayed (non-retired) statement snapshots and empty FamilyAccount shells.
 * Does not mutate any store. Does not retire or repair.
 */
export function scanFamilyAccountIntegrity(
  input: FamilyAccountIntegrityScanInput
): FamilyAccountIntegrityScanResult {
  const familyAccounts = input.familyAccounts || [];
  const learners = input.learners || [];
  const ledger = input.ledger || [];
  const audit = input.audit || [];
  const snapshots = input.snapshots || {};

  const faByRef = new Map<string, IntegrityFamilyAccount>();
  const faById = new Map<string, IntegrityFamilyAccount>();
  for (const fa of familyAccounts) {
    faByRef.set(normRef(fa.accountRef), fa);
    faById.set(fa.id, fa);
  }

  const learnersByFaId = new Map<string, IntegrityLearner[]>();
  for (const learner of learners) {
    const faId = String(learner.familyAccountId || "").trim();
    if (!faId) continue;
    const bucket = learnersByFaId.get(faId) || [];
    bucket.push(learner);
    learnersByFaId.set(faId, bucket);
  }

  const ledgerCountByRef = new Map<string, number>();
  for (const entry of ledger) {
    const ref = normRef(entry.accountNo);
    if (!ref) continue;
    ledgerCountByRef.set(ref, (ledgerCountByRef.get(ref) || 0) + 1);
  }

  const mergeSources = latestMergeSourceTargets(audit);

  const displayedRefs = Object.values(snapshots)
    .filter((snap): snap is IntegritySnapshot => Boolean(snap) && !isRetiredSnapshot(snap))
    .map((snap) => normRef(snap.accountRef))
    .filter(Boolean);

  const emptyCounts: Record<IntegrityClassification, number> = {
    ACTIVE_CANONICAL: 0,
    CONFIRMED_STALE_PREDECESSOR: 0,
    ORPHAN_STATEMENT_SNAPSHOT: 0,
    ORPHAN_FAMILYACCOUNT: 0,
    REVIEW_REQUIRED: 0,
  };

  const statementRows: StatementIntegrityRow[] = displayedRefs.sort().map((accountRef) => {
    const snap = snapshots[accountRef];
    const fa = faByRef.get(accountRef);
    const linked = fa ? learnersByFaId.get(fa.id) || [] : [];
    const active = linked.filter(isActive);
    const historical = linked.filter((row) => !isActive(row));
    const reasons: string[] = [];
    let classification: IntegrityClassification = "REVIEW_REQUIRED";
    let supersededByAccountRef: string | undefined;

    const duplicateHits = linked.flatMap((learner) =>
      duplicateActiveElsewhere(learner, accountRef, learners, faById)
    );

    if (active.length > 0) {
      classification = "ACTIVE_CANONICAL";
      reasons.push(`${active.length} ACTIVE learner(s) currently own this FamilyAccount`);
    } else if (mergeSources.has(accountRef)) {
      classification = "CONFIRMED_STALE_PREDECESSOR";
      supersededByAccountRef = mergeSources.get(accountRef);
      reasons.push(
        `Merge-audit source with no ACTIVE learners (merged into ${supersededByAccountRef})`
      );
    } else if (duplicateHits.length > 0) {
      classification = "CONFIRMED_STALE_PREDECESSOR";
      supersededByAccountRef = duplicateHits[0].otherAccountRef;
      reasons.push(
        `Learner identity is now ACTIVE on ${supersededByAccountRef} (duplicate registration / unenrol leftover; no merge audit required)`
      );
    } else if (linked.length === 0) {
      classification = "ORPHAN_STATEMENT_SNAPSHOT";
      reasons.push("Statement snapshot has no current FamilyAccount learner ownership");
    } else {
      classification = "REVIEW_REQUIRED";
      reasons.push(
        "HISTORICAL-only learner ownership with no duplicate-identity or merge-audit evidence"
      );
    }

    emptyCounts[classification] += 1;
    return {
      accountRef,
      classification,
      reasons,
      familyAccountId: fa?.id || null,
      activeLearnerCount: active.length,
      historicalLearnerCount: historical.length,
      linkedLearnerCount: linked.length,
      ledgerRowCount: ledgerCountByRef.get(accountRef) || 0,
      snapshotBalance: round2(snap?.balance),
      supersededByAccountRef,
    };
  });

  const displayedSet = new Set(displayedRefs);
  const orphanFamilyAccounts = familyAccounts
    .filter((fa) => (learnersByFaId.get(fa.id) || []).length === 0)
    .map((fa) => ({
      accountRef: normRef(fa.accountRef),
      familyAccountId: fa.id,
      onStatements: displayedSet.has(normRef(fa.accountRef)),
      classification: "ORPHAN_FAMILYACCOUNT" as const,
    }));
  emptyCounts.ORPHAN_FAMILYACCOUNT = orphanFamilyAccounts.length;

  const confirmedRetirement =
    emptyCounts.CONFIRMED_STALE_PREDECESSOR + emptyCounts.ORPHAN_STATEMENT_SNAPSHOT;

  return {
    statementRows,
    orphanFamilyAccounts,
    counts: {
      ...emptyCounts,
      statementsScanned: statementRows.length,
    },
    expectedStatementCountAfterConfirmedRetirement: statementRows.length - confirmedRetirement,
  };
}
