/**
 * Disposable Fly Eagle-shaped migration rehearsal (in-memory).
 * Uses the same family/learner/opening/transaction helpers as apply.
 * Does not touch production or any real school database.
 */

import { formatRandFromCents } from "../finance/moneyCents";
import {
  resolveFamilyGroupingAuthority,
  resolveMigrationFamilyAccountLink,
  type MigrationFamilySourceLearner,
} from "./migrationFamilyEvidence";
import {
  allocateMigrationAdmissionNo,
  classifyMigrationLearnerIdentity,
  migrationLearnerBatchKey,
  type MigrationLearnerIdentityCandidate,
} from "./migrationLearnerIdentity";
import { openingBalanceRowsToPost } from "./migrationOpeningBalanceSafety";
import { migrationTransactionProvenance } from "./migrationTransactionProvenance";
import type { LedgerPostingType } from "../types/MigrationLedgerPosting";

export type RehearsalLearner = {
  key: string;
  schoolId: string;
  firstName: string;
  lastName: string;
  idNumber?: string;
  dob?: string;
  sourceLearnerId?: string;
  sourceAccountRef?: string;
  sourceParentId?: string;
  parentIdNumber?: string;
  parentName?: string;
  openingBalance?: string;
  enrollmentStatus?: "ACTIVE" | "HISTORICAL";
};

export type RehearsalTransaction = {
  accountRef: string;
  date: string;
  reference: string;
  description?: string;
  amount: number;
  postingType: LedgerPostingType;
  sourceFile: string;
};

export type RehearsalSchoolState = {
  learners: Array<
    MigrationLearnerIdentityCandidate & {
      key: string;
      lastName: string;
    }
  >;
  familyAccounts: Array<{ id: string; accountRef: string; familyName: string; learnerKeys: string[] }>;
  parents: Array<{ id: string; schoolId: string; idNumber: string | null; learnerKeys: string[] }>;
  openings: Map<string, number>;
  transactions: Array<{ provenance: string; accountRef: string; amount: number; postingType: string }>;
  reviews: string[];
};

function centsFromRandString(raw?: string): number {
  if (!raw) return 0;
  const n = Number(String(raw).replace(/[R,\s]/gi, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function emptyRehearsalSchool(schoolId: string): RehearsalSchoolState {
  void schoolId;
  return {
    learners: [],
    familyAccounts: [],
    parents: [],
    openings: new Map(),
    transactions: [],
    reviews: [],
  };
}

export function applyRehearsalMigration(input: {
  schoolId: string;
  learners: RehearsalLearner[];
  transactions?: RehearsalTransaction[];
  existing?: RehearsalSchoolState;
}): RehearsalSchoolState {
  const schoolId = input.schoolId;
  const state: RehearsalSchoolState = input.existing
    ? {
        learners: [...input.existing.learners],
        familyAccounts: input.existing.familyAccounts.map((fa) => ({
          ...fa,
          learnerKeys: [...fa.learnerKeys],
        })),
        parents: input.existing.parents.map((p) => ({ ...p, learnerKeys: [...p.learnerKeys] })),
        openings: new Map(input.existing.openings),
        transactions: [...input.existing.transactions],
        reviews: [...input.existing.reviews],
      }
    : emptyRehearsalSchool(schoolId);

  const seenBatch = new Set<string>();
  const takenAdmission = new Set(
    state.learners.map((l) => String(l.admissionNo || "").toUpperCase()).filter(Boolean)
  );

  const groupingInput: MigrationFamilySourceLearner[] = input.learners.map((l) => ({
    key: l.key,
    schoolId,
    lastName: l.lastName,
    sourceAccountRef: l.sourceAccountRef,
    sourceParentId: l.sourceParentId,
    parentIdNumber: l.parentIdNumber,
  }));
  const grouping = resolveFamilyGroupingAuthority(groupingInput);
  for (const review of grouping.reviews) {
    if (!state.reviews.includes(review.message)) state.reviews.push(review.message);
  }

  const familyByRef = new Map(state.familyAccounts.map((fa) => [fa.accountRef.toUpperCase(), fa]));

  for (const group of grouping.groups) {
    if (group.decision !== "AUTO_GROUP" || !group.canonicalAccountRef) continue;
    const ref = group.canonicalAccountRef;
    if (!familyByRef.has(ref)) {
      const fa = {
        id: `fa_${ref}`,
        accountRef: ref,
        familyName: ref,
        learnerKeys: [],
      };
      state.familyAccounts.push(fa);
      familyByRef.set(ref, fa);
    }
  }

  for (const learner of input.learners) {
    const batchKey = migrationLearnerBatchKey({
      schoolId,
      firstName: learner.firstName,
      lastName: learner.lastName,
      idNumber: learner.idNumber,
      dateOfBirth: learner.dob,
      sourceLearnerId: learner.sourceLearnerId,
    });
    if (batchKey && seenBatch.has(batchKey)) {
      continue;
    }
    if (batchKey) seenBatch.add(batchKey);

    const classified = classifyMigrationLearnerIdentity({
      incoming: {
        schoolId,
        firstName: learner.firstName,
        lastName: learner.lastName,
        idNumber: learner.idNumber,
        dateOfBirth: learner.dob,
        sourceLearnerId: learner.sourceLearnerId,
      },
      candidates: state.learners,
    });

    if (classified.classification === "EXISTING_HISTORICAL_LEARNER_REACTIVATION_REVIEW") {
      state.reviews.push(classified.operatorMessage);
      continue;
    }
    if (classified.classification === "EXISTING_ACTIVE_LEARNER_REVIEW_LINK") {
      state.reviews.push(classified.operatorMessage);
      const existing = state.learners.find((l) => l.id === classified.hit?.learnerId);
      if (existing && learner.sourceAccountRef) {
        const fa = familyByRef.get(learner.sourceAccountRef.toUpperCase());
        if (fa && !existing.familyAccountId) {
          existing.familyAccountId = fa.id;
          if (!fa.learnerKeys.includes(existing.key)) fa.learnerKeys.push(existing.key);
        }
      }
      continue;
    }

    const admissionNo = allocateMigrationAdmissionNo({
      learnerNumber: learner.sourceLearnerId,
      accountNumber: learner.sourceAccountRef,
      takenAdmissionNos: takenAdmission,
    });
    if (admissionNo) takenAdmission.add(admissionNo.toUpperCase());

    const created = {
      id: `lrn_${learner.key}`,
      key: learner.key,
      schoolId,
      firstName: learner.firstName,
      lastName: learner.lastName,
      idNumber: learner.idNumber || null,
      birthDate: learner.dob || null,
      admissionNo,
      enrollmentStatus: learner.enrollmentStatus || "ACTIVE",
      familyAccountId: null as string | null,
    };
    state.learners.push(created);

    const group = grouping.groups.find((g) => g.learnerKeys.includes(learner.key) && g.canonicalAccountRef);
    const ref = group?.canonicalAccountRef || learner.sourceAccountRef || "";
    if (ref && familyByRef.has(ref.toUpperCase())) {
      const fa = familyByRef.get(ref.toUpperCase())!;
      created.familyAccountId = fa.id;
      if (!fa.learnerKeys.includes(learner.key)) fa.learnerKeys.push(learner.key);
    } else {
      const link = resolveMigrationFamilyAccountLink({
        learner: {
          id: created.id,
          lastName: created.lastName,
          admissionNo: created.admissionNo,
          familyAccountId: created.familyAccountId,
        },
        familyAccounts: state.familyAccounts,
      });
      if (link.review) state.reviews.push(link.review.message);
      if (link.familyAccountId) {
        created.familyAccountId = link.familyAccountId;
        const fa = state.familyAccounts.find((a) => a.id === link.familyAccountId);
        if (fa && !fa.learnerKeys.includes(learner.key)) fa.learnerKeys.push(learner.key);
      }
    }

    if (learner.parentIdNumber) {
      let parent = state.parents.find(
        (p) => p.schoolId === schoolId && p.idNumber === learner.parentIdNumber
      );
      if (!parent) {
        parent = {
          id: `par_${learner.parentIdNumber}`,
          schoolId,
          idNumber: learner.parentIdNumber,
          learnerKeys: [],
        };
        state.parents.push(parent);
      }
      if (!parent.learnerKeys.includes(learner.key)) parent.learnerKeys.push(learner.key);
    }
  }

  const openingRows = input.learners
    .filter((l) => l.sourceAccountRef && l.openingBalance)
    .map((l) => ({
      accountRef: l.sourceAccountRef!,
      openingBalance: l.openingBalance,
      sourceFilename: "rehearsal",
      rowNumber: 1,
    }));
  const openings = openingBalanceRowsToPost(openingRows);
  for (const fail of openings.failed) {
    state.reviews.push(fail.message);
  }
  for (const row of openings.toPost) {
    const cents = centsFromRandString(String(row.openingBalance));
    if (!state.openings.has(row.accountRef)) {
      state.openings.set(row.accountRef, cents);
    }
  }

  const seenTx = new Set(state.transactions.map((t) => t.provenance));
  for (const tx of input.transactions || []) {
    const key = migrationTransactionProvenance(tx);
    const provenance = key
      ? `${key.accountRef}|${key.date}|${key.reference}|${key.amount}|${key.postingType}`
      : `unique:${tx.accountRef}|${tx.date}|${tx.reference}|${tx.description || ""}|${tx.amount}|${tx.postingType}|${tx.sourceFile}`;
    if (key && seenTx.has(provenance)) continue;
    if (key) seenTx.add(provenance);
    else if (seenTx.has(provenance)) continue;
    else seenTx.add(provenance);
    state.transactions.push({
      provenance,
      accountRef: tx.accountRef,
      amount: tx.amount,
      postingType: tx.postingType,
    });
  }

  return state;
}

export function rehearsalAccountCents(state: RehearsalSchoolState, accountRef: string): number {
  const opening = state.openings.get(accountRef) || 0;
  let movement = 0;
  for (const tx of state.transactions) {
    if (tx.accountRef !== accountRef) continue;
    if (tx.postingType === "invoice" || tx.postingType === "journal_debit") movement += Math.round(tx.amount * 100);
    else movement -= Math.round(tx.amount * 100);
  }
  return opening + movement;
}

export function rehearsalGlobalDifferenceCents(input: {
  sourceByAccount: Map<string, number>;
  state: RehearsalSchoolState;
}): { perAccount: Array<{ accountRef: string; source: string; educlear: string; difference: string; ok: boolean }>; globalDifferenceCents: number } {
  const refs = new Set([...input.sourceByAccount.keys(), ...input.state.openings.keys()]);
  const perAccount = [];
  let sourceSum = 0;
  let eduSum = 0;
  for (const accountRef of refs) {
    const source = input.sourceByAccount.get(accountRef) || 0;
    const educlear = rehearsalAccountCents(input.state, accountRef);
    sourceSum += source;
    eduSum += educlear;
    perAccount.push({
      accountRef,
      source: formatRandFromCents(source),
      educlear: formatRandFromCents(educlear),
      difference: formatRandFromCents(educlear - source),
      ok: source === educlear,
    });
  }
  return { perAccount, globalDifferenceCents: eduSum - sourceSum };
}
