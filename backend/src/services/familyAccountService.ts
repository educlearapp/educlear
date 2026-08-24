import { prisma } from "../prisma";
import { getSurnamePrefix, resolveLearnerAccountNo } from "../utils/learnerIdentity";
import {
  reassignLedgerAccountRefs,
  readSchoolLedger,
  unmergeLearnerLedger,
  writeSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import { appendFamilyAccountAudit, listFamilyAccountAudit } from "../utils/familyAccountAuditStore";
import {
  combineAndRetireAgeAnalysisSnapshot,
  invalidateFamilyAccountAgeAnalysisFileCache,
  isRetiredAgeAnalysisSnapshot,
  readSchoolFamilyAccountAgeAnalysisSnapshots,
  replaceSchoolFamilyAccountAgeAnalysisSnapshots,
  retireAgeAnalysisSnapshot,
  type FamilyAccountAgeAnalysisSnapshot,
} from "../utils/familyAccountAgeAnalysisStore";
import { invalidateOfficialBillingAccountRefsCache } from "./officialBillingAccountRef";
import {
  alignParentsToCanonicalFamily,
  assertFamilyAccountOwnedBySchool,
} from "./learnerRegistrationService";
import {
  buildAccountsFromAgeAnalysisSnapshots,
  buildAccountsFromLearners,
  resolveAuthoritativeAccountBalance,
  roundStatementMoney,
} from "./statementAccounts";

const FORBIDDEN_LEARNER_IDENTITY_FIELDS = ["admissionNo", "idNumber"] as const;

type LearnerIdentitySnapshot = {
  id: string;
  admissionNo: string | null;
  idNumber: string | null;
};

function assertLearnerUpdateFieldsAllowed(data: Record<string, unknown>) {
  for (const field of FORBIDDEN_LEARNER_IDENTITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      throw new Error(
        `Family account operations must not modify learner.${field}`
      );
    }
  }
}

async function snapshotLearnerIdentities(
  schoolId: string,
  learnerIds: string[]
): Promise<LearnerIdentitySnapshot[]> {
  if (!learnerIds.length) return [];
  return prisma.learner.findMany({
    where: { schoolId, id: { in: learnerIds } },
    select: { id: true, admissionNo: true, idNumber: true },
  });
}

async function verifyLearnerIdentitiesUnchanged(
  schoolId: string,
  before: LearnerIdentitySnapshot[]
) {
  if (!before.length) return;
  const after = await snapshotLearnerIdentities(
    schoolId,
    before.map((l) => l.id)
  );
  const afterById = new Map(after.map((l) => [l.id, l]));
  for (const snap of before) {
    const current = afterById.get(snap.id);
    if (!current) continue;
    if (
      snap.admissionNo !== current.admissionNo ||
      snap.idNumber !== current.idNumber
    ) {
      throw new Error(
        "Learner admission number or ID number changed during family account operation (not allowed)"
      );
    }
  }
}

async function createFamilyAccountRef(schoolId: string, surname: string) {
  const prefix = getSurnamePrefix(surname);
  const existingCount = await prisma.familyAccount.count({
    where: {
      schoolId,
      accountRef: { startsWith: prefix },
    },
  });
  return `${prefix}${String(existingCount + 1).padStart(3, "0")}`;
}

type LearnerWithFamily = {
  id: string;
  schoolId: string;
  firstName: string;
  lastName: string;
  admissionNo: string | null;
  familyAccountId: string | null;
  familyAccount: { id: string; accountRef: string; familyName: string } | null;
};

type ResolvedFamilyAccount = {
  id: string;
  accountRef: string;
  familyName: string;
};

async function loadLearner(schoolId: string, learnerId: string): Promise<LearnerWithFamily | null> {
  return prisma.learner.findFirst({
    where: { id: learnerId, schoolId },
    select: {
      id: true,
      schoolId: true,
      firstName: true,
      lastName: true,
      admissionNo: true,
      idNumber: true,
      familyAccountId: true,
      familyAccount: { select: { id: true, accountRef: true, familyName: true } },
    },
  });
}

async function findFamilyAccountById(
  schoolId: string,
  familyAccountId: string
): Promise<ResolvedFamilyAccount | null> {
  const owned = await assertFamilyAccountOwnedBySchool(schoolId, familyAccountId);
  if (!owned) return null;
  return { id: owned.id, accountRef: owned.accountRef, familyName: owned.familyName };
}

async function findFamilyAccountByRef(
  schoolId: string,
  accountRef: string
): Promise<ResolvedFamilyAccount | null> {
  const ref = String(accountRef || "").trim();
  if (!ref) return null;
  return prisma.familyAccount.findFirst({
    where: { schoolId, accountRef: ref },
    select: { id: true, accountRef: true, familyName: true },
  });
}

function ledgerHasAccountRefOnly(schoolId: string, accountRef: string): boolean {
  const ref = String(accountRef || "").trim();
  if (!ref) return false;
  const ledger = readSchoolLedger(schoolId);
  return ledger.some((e) => String(e.accountNo || "").trim() === ref);
}

async function resolveMergeFamilyAccount(
  schoolId: string,
  side: "Source" | "Target",
  opts: {
    familyAccountId?: string;
    accountRef?: string;
    learnerId?: string;
  }
): Promise<ResolvedFamilyAccount> {
  const label = side === "Source" ? "Source" : "Target";
  const familyAccountId = String(opts.familyAccountId || "").trim();
  const accountRef = String(opts.accountRef || "").trim();
  const learnerId = String(opts.learnerId || "").trim();

  console.log(`[family-accounts] resolve ${label}`, {
    schoolId,
    familyAccountId: familyAccountId || null,
    accountRef: accountRef || null,
    learnerId: learnerId || null,
  });

  if (familyAccountId) {
    const byId = await findFamilyAccountById(schoolId, familyAccountId);
    if (byId) return byId;
    console.warn(`[family-accounts] ${label} validation: familyAccountId not found`, {
      schoolId,
      familyAccountId,
    });
    throw new Error(`${label} family account not found`);
  }

  if (accountRef) {
    const byRef = await findFamilyAccountByRef(schoolId, accountRef);
    if (byRef) return byRef;
    if (ledgerHasAccountRefOnly(schoolId, accountRef)) {
      console.warn(
        `[family-accounts] ${label} validation: accountRef in ledger only, no FamilyAccount row`,
        { schoolId, accountRef }
      );
      throw new Error(
        `${label} family account not found (account ref exists in billing ledger only — link learners to a family account first)`
      );
    }
    console.warn(`[family-accounts] ${label} validation: accountRef not found`, {
      schoolId,
      accountRef,
    });
    throw new Error(`${label} family account not found`);
  }

  if (learnerId) {
    const learner = await loadLearner(schoolId, learnerId);
    if (!learner) {
      console.warn(`[family-accounts] ${label} validation: learner not found`, {
        schoolId,
        learnerId,
      });
      throw new Error(`${label} learner not found`);
    }
    const linkedId = String(learner.familyAccountId || learner.familyAccount?.id || "").trim();
    if (linkedId) {
      const byLearner = await findFamilyAccountById(schoolId, linkedId);
      if (byLearner) return byLearner;
    }
    const learnerRef = resolveLearnerAccountNo({
      familyAccount: learner.familyAccount,
      accountNo: learner.admissionNo,
    });
    if (learnerRef && learnerRef !== "-") {
      const byLearnerRef = await findFamilyAccountByRef(schoolId, learnerRef);
      if (byLearnerRef) return byLearnerRef;
      if (ledgerHasAccountRefOnly(schoolId, learnerRef)) {
        console.warn(
          `[family-accounts] ${label} validation: learner account ref in ledger only`,
          { schoolId, learnerId, accountRef: learnerRef }
        );
        throw new Error(
          `${label} family account not found (account ref exists in billing ledger only — link learners to a family account first)`
        );
      }
    }
    console.warn(`[family-accounts] ${label} validation: learner has no family account`, {
      schoolId,
      learnerId,
    });
    throw new Error(`${label} family account not found (learner is not linked to a family account)`);
  }

  console.warn(`[family-accounts] ${label} validation: no identifiers provided`, { schoolId });
  throw new Error(
    side === "Source"
      ? "Source family account not found (provide sourceFamilyAccountId, sourceAccountRef, or sourceLearnerId)"
      : "Target family account not found (provide targetFamilyAccountId, targetAccountRef, or targetLearnerId)"
  );
}

export type MergeFamilyAccountsInput = {
  schoolId: string;
  sourceFamilyAccountId?: string;
  sourceAccountRef?: string;
  sourceLearnerId?: string;
  targetFamilyAccountId?: string;
  targetAccountRef?: string;
  targetLearnerId?: string;
  actorEmail?: string;
  /**
   * Explicit override for snapshot handling.
   * true  = Case A: add source snapshot into canonical (genuine unconsolidated debt).
   * false = Case B: retire/hide source snapshot without changing canonical opening.
   * omitted = auto-classify.
   */
  consolidateBalances?: boolean;
  /** Test-only: force post-merge reconciliation to fail so rollback can be asserted. */
  forceReconcileFailure?: boolean;
};

export type MergeBalanceMode = "consolidate" | "retire_without_adding";

function snapshotSourceKind(snap: FamilyAccountAgeAnalysisSnapshot | undefined): string {
  return String(snap?.source || "").trim().toLowerCase();
}

function hasPriorMergeIntoTarget(
  schoolId: string,
  sourceRef: string,
  targetRef: string
): boolean {
  const from = String(sourceRef || "").trim().toUpperCase();
  const to = String(targetRef || "").trim().toUpperCase();
  return listFamilyAccountAudit(schoolId, 200).some((entry) => {
    if (String(entry.action || "") !== "merge") return false;
    return (
      String(entry.sourceAccountRef || "").trim().toUpperCase() === from &&
      String(entry.targetAccountRef || "").trim().toUpperCase() === to
    );
  });
}

/**
 * Case A — genuine first-time consolidation of two independent Kid-e-Sys (or equivalent)
 * openings that still have learners on the source.
 * Case B — stale predecessor / new-learner shell: retire snapshot without adding it.
 */
export function resolveMergeBalanceMode(opts: {
  consolidateBalances?: boolean;
  sourceSnapshot?: FamilyAccountAgeAnalysisSnapshot;
  sourceLearnerCount: number;
  priorMergeIntoTarget: boolean;
}): MergeBalanceMode {
  if (opts.consolidateBalances === true) return "consolidate";
  if (opts.consolidateBalances === false) return "retire_without_adding";
  if (opts.priorMergeIntoTarget) return "retire_without_adding";
  if (opts.sourceLearnerCount === 0) return "retire_without_adding";
  const kind = snapshotSourceKind(opts.sourceSnapshot);
  if (kind === "educlear-registration") return "retire_without_adding";
  if (kind === "kideesys-age-analysis" || kind === "") return "consolidate";
  return "retire_without_adding";
}

const MERGE_RECONCILE_TOLERANCE = 0.009;

function cloneLedger(entries: BillingLedgerEntry[]): BillingLedgerEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

function cloneSnapshots(
  snapshots: Record<string, FamilyAccountAgeAnalysisSnapshot>
): Record<string, FamilyAccountAgeAnalysisSnapshot> {
  return JSON.parse(JSON.stringify(snapshots || {}));
}

export async function mergeFamilyAccounts(opts: MergeFamilyAccountsInput) {
  const schoolId = String(opts.schoolId || "").trim();
  const sourceFamilyAccountId = String(opts.sourceFamilyAccountId || "").trim();
  const sourceAccountRef = String(opts.sourceAccountRef || "").trim();
  const sourceLearnerId = String(opts.sourceLearnerId || "").trim();
  const targetFamilyAccountId = String(opts.targetFamilyAccountId || "").trim();
  const targetAccountRef = String(opts.targetAccountRef || "").trim();
  const targetLearnerId = String(opts.targetLearnerId || "").trim();

  if (!schoolId) {
    throw new Error("Missing schoolId");
  }

  const hasSource =
    Boolean(sourceFamilyAccountId) || Boolean(sourceAccountRef) || Boolean(sourceLearnerId);
  const hasTarget =
    Boolean(targetFamilyAccountId) || Boolean(targetAccountRef) || Boolean(targetLearnerId);

  if (!hasSource || !hasTarget) {
    console.warn("[family-accounts] merge validation failed: missing source or target", {
      schoolId,
      hasSource,
      hasTarget,
    });
    throw new Error(
      "Source and target are required (familyAccountId, accountRef, or learnerId for each side)"
    );
  }

  console.log("[family-accounts] merge start", {
    schoolId,
    sourceFamilyAccountId: sourceFamilyAccountId || null,
    sourceAccountRef: sourceAccountRef || null,
    sourceLearnerId: sourceLearnerId || null,
    targetFamilyAccountId: targetFamilyAccountId || null,
    targetAccountRef: targetAccountRef || null,
    targetLearnerId: targetLearnerId || null,
  });

  const sourceAccount = await resolveMergeFamilyAccount(schoolId, "Source", {
    familyAccountId: sourceFamilyAccountId,
    accountRef: sourceAccountRef,
    learnerId: sourceLearnerId,
  });

  const targetAccount = await resolveMergeFamilyAccount(schoolId, "Target", {
    familyAccountId: targetFamilyAccountId,
    accountRef: targetAccountRef,
    learnerId: targetLearnerId,
  });

  console.log("[family-accounts] merge resolved accounts", {
    schoolId,
    sourceAccountId: sourceAccount.id,
    sourceAccountRef: sourceAccount.accountRef,
    targetAccountId: targetAccount.id,
    targetAccountRef: targetAccount.accountRef,
  });

  if (sourceAccount.id === targetAccount.id) {
    console.warn("[family-accounts] merge validation failed: same account", {
      schoolId,
      familyAccountId: sourceAccount.id,
    });
    throw new Error("Cannot merge account into itself");
  }

  const sourceFamilyId = sourceAccount.id;
  const targetFamilyId = targetAccount.id;
  const sourceRef = String(sourceAccount.accountRef || "").trim().toUpperCase();
  const targetRef = String(targetAccount.accountRef || "").trim().toUpperCase();

  const snapshotsBefore = cloneSnapshots(readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId));
  const sourceSnap = snapshotsBefore[sourceRef];
  if (isRetiredAgeAnalysisSnapshot(sourceSnap) && String(sourceSnap.mergedIntoAccountRef).toUpperCase() === targetRef) {
    const statements = await buildAccountsFromAgeAnalysisSnapshots(schoolId);
    return {
      success: true,
      action: "merge" as const,
      sourceAccountRef: sourceRef,
      targetAccountRef: targetRef,
      mergedLearnerIds: [],
      ledgerRowsUpdated: 0,
      alreadyMerged: true,
      balanceBefore: {
        source: 0,
        target: await resolveAuthoritativeAccountBalance(schoolId, targetRef),
        combined: await resolveAuthoritativeAccountBalance(schoolId, targetRef),
      },
      balanceAfter: {
        source: 0,
        target: await resolveAuthoritativeAccountBalance(schoolId, targetRef),
        combined: await resolveAuthoritativeAccountBalance(schoolId, targetRef),
      },
      audit: null,
      statements,
    };
  }

  const sourceLearners = await prisma.learner.findMany({
    where: { schoolId, familyAccountId: sourceFamilyId },
    select: { id: true, admissionNo: true, idNumber: true },
  });
  const sourceParents = await prisma.parent.findMany({
    where: { schoolId, familyAccountId: sourceFamilyId },
    select: { id: true },
  });
  const sourceDeposits = await prisma.billingDeposit.findMany({
    where: { schoolId, familyAccountId: sourceFamilyId },
    select: { id: true },
  });
  const sourceLearnerIds = sourceLearners.map((l) => l.id);
  const identityBefore: LearnerIdentitySnapshot[] = sourceLearners.map((l) => ({
    id: l.id,
    admissionNo: l.admissionNo,
    idNumber: l.idNumber,
  }));

  const hasSourceSnapshot = Boolean(sourceSnap) && !isRetiredAgeAnalysisSnapshot(sourceSnap);
  const ledgerBefore = cloneLedger(readSchoolLedger(schoolId));
  const sourceHasLedger = ledgerBefore.some(
    (entry) => String(entry.accountNo || "").trim().toUpperCase() === sourceRef
  );

  if (sourceLearnerIds.length === 0 && !hasSourceSnapshot && !sourceHasLedger) {
    console.warn("[family-accounts] merge validation failed: no learners on source", {
      schoolId,
      sourceFamilyId,
      sourceAccountRef: sourceRef,
    });
    throw new Error("No learners found on source account");
  }

  const sourceBalanceBefore = await resolveAuthoritativeAccountBalance(schoolId, sourceRef, {
    ledger: ledgerBefore,
  });
  const targetBalanceBefore = await resolveAuthoritativeAccountBalance(schoolId, targetRef, {
    ledger: ledgerBefore,
  });
  const balanceMode = resolveMergeBalanceMode({
    consolidateBalances: opts.consolidateBalances,
    sourceSnapshot: sourceSnap,
    sourceLearnerCount: sourceLearnerIds.length,
    priorMergeIntoTarget: hasPriorMergeIntoTarget(schoolId, sourceRef, targetRef),
  });
  const sourceSnapshotBalance = hasSourceSnapshot
    ? roundStatementMoney(sourceSnap?.balance)
    : 0;
  const sourceLivePortion = roundStatementMoney(sourceBalanceBefore - sourceSnapshotBalance);
  const expectedCanonicalAfter =
    balanceMode === "consolidate"
      ? roundStatementMoney(sourceBalanceBefore + targetBalanceBefore)
      : roundStatementMoney(targetBalanceBefore + sourceLivePortion);
  const combinedBefore = expectedCanonicalAfter;

  const learnerMergeData = { familyAccountId: targetFamilyId };
  assertLearnerUpdateFieldsAllowed(learnerMergeData);

  let prismaCommitted = false;
  let ledgerMoved = false;
  let snapshotsCombined = false;
  let ledgerRowsUpdated = 0;

  const restoreJsonStores = () => {
    writeSchoolLedger(schoolId, ledgerBefore);
    replaceSchoolFamilyAccountAgeAnalysisSnapshots(schoolId, snapshotsBefore);
    invalidateFamilyAccountAgeAnalysisFileCache();
    invalidateOfficialBillingAccountRefsCache(schoolId);
  };

  const restorePrismaLinks = async () => {
    await prisma.$transaction(async (tx) => {
      if (sourceLearnerIds.length) {
        await tx.learner.updateMany({
          where: { schoolId, id: { in: sourceLearnerIds } },
          data: { familyAccountId: sourceFamilyId },
        });
      }
      if (sourceParents.length) {
        await tx.parent.updateMany({
          where: { schoolId, id: { in: sourceParents.map((p) => p.id) } },
          data: { familyAccountId: sourceFamilyId },
        });
      }
      if (sourceDeposits.length) {
        await tx.billingDeposit.updateMany({
          where: { schoolId, id: { in: sourceDeposits.map((d) => d.id) } },
          data: { familyAccountId: sourceFamilyId },
        });
      }
    });
  };

  try {
    await prisma.$transaction(async (tx) => {
      if (sourceLearnerIds.length) {
        await tx.learner.updateMany({
          where: { schoolId, familyAccountId: sourceFamilyId },
          data: learnerMergeData,
        });
      }
      await tx.parent.updateMany({
        where: { schoolId, familyAccountId: sourceFamilyId },
        data: { familyAccountId: targetFamilyId },
      });
      await tx.billingDeposit.updateMany({
        where: { schoolId, familyAccountId: sourceFamilyId },
        data: { familyAccountId: targetFamilyId },
      });
    });
    prismaCommitted = true;

    await verifyLearnerIdentitiesUnchanged(schoolId, identityBefore);
    await alignParentsToCanonicalFamily({
      schoolId,
      learnerIds: sourceLearnerIds,
      canonicalFamilyAccountId: targetFamilyId,
    });

    const ledgerResult = reassignLedgerAccountRefs(schoolId, {
      fromAccountNo: sourceRef,
      toAccountNo: targetRef,
      learnerIds: sourceLearnerIds,
      includeAccountNoOnly: true,
    });
    ledgerMoved = true;
    ledgerRowsUpdated = ledgerResult.updated;

    if (hasSourceSnapshot) {
      // Prevention: retire ONLY the explicit merge source. Do not scan for
      // other abandoned snapshots (e.g. MOT682-style unenrol leftovers) and
      // auto-retire them — that is a separate historical repair.
      if (balanceMode === "consolidate") {
        combineAndRetireAgeAnalysisSnapshot(schoolId, sourceRef, targetRef, {
          retiredReason: "family-account-merge-consolidate",
        });
      } else {
        retireAgeAnalysisSnapshot(schoolId, sourceRef, targetRef, {
          retiredReason: "family-account-merge-stale-predecessor",
        });
      }
      snapshotsCombined = true;
      invalidateFamilyAccountAgeAnalysisFileCache();
      invalidateOfficialBillingAccountRefsCache(schoolId);
    }

    if (opts.forceReconcileFailure) {
      throw new Error("Forced merge reconciliation failure");
    }

    const sourceBalanceAfter = isRetiredAgeAnalysisSnapshot(
      readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId)[sourceRef]
    )
      ? 0
      : await resolveAuthoritativeAccountBalance(schoolId, sourceRef);
    const targetBalanceAfter = await resolveAuthoritativeAccountBalance(schoolId, targetRef);
    const combinedAfter = roundStatementMoney(targetBalanceAfter);

    if (Math.abs(combinedAfter - combinedBefore) > MERGE_RECONCILE_TOLERANCE) {
      throw new Error(
        `Merge reconciliation failed: combined position ${combinedBefore} → ${combinedAfter}`
      );
    }
    if (Math.abs(sourceBalanceAfter) > MERGE_RECONCILE_TOLERANCE && hasSourceSnapshot) {
      throw new Error(
        `Merge reconciliation failed: retired source ${sourceRef} still shows ${sourceBalanceAfter}`
      );
    }

    const audit = appendFamilyAccountAudit({
      schoolId,
      action: "merge",
      actorEmail: opts.actorEmail,
      sourceFamilyAccountId: sourceFamilyId,
      targetFamilyAccountId: targetFamilyId,
      sourceAccountRef: sourceRef,
      targetAccountRef: targetRef,
      learnerIds: sourceLearnerIds,
      metadata: {
        sourceLearnerId: sourceLearnerId || null,
        targetLearnerId: targetLearnerId || null,
        ledgerRowsUpdated,
        balanceBefore: {
          source: sourceBalanceBefore,
          target: targetBalanceBefore,
          combined: combinedBefore,
        },
        balanceAfter: {
          source: sourceBalanceAfter,
          target: targetBalanceAfter,
          combined: combinedAfter,
        },
        snapshotsCombined,
        balanceMode,
        consolidateBalances: opts.consolidateBalances ?? null,
      },
    });

    const statements = await buildAccountsFromAgeAnalysisSnapshots(schoolId);

    return {
      success: true,
      action: "merge" as const,
      sourceAccountRef: sourceRef,
      targetAccountRef: targetRef,
      mergedLearnerIds: sourceLearnerIds,
      ledgerRowsUpdated,
      alreadyMerged: false,
      balanceMode,
      balanceBefore: {
        source: sourceBalanceBefore,
        target: targetBalanceBefore,
        combined: combinedBefore,
      },
      balanceAfter: {
        source: sourceBalanceAfter,
        target: targetBalanceAfter,
        combined: combinedAfter,
      },
      audit,
      statements,
    };
  } catch (error) {
    if (ledgerMoved || snapshotsCombined) restoreJsonStores();
    if (prismaCommitted) await restorePrismaLinks();
    throw error;
  }
}

export async function unmergeLearnerFromFamily(opts: {
  schoolId: string;
  learnerId: string;
  createNewAccount: boolean;
  actorEmail?: string;
}) {
  const schoolId = String(opts.schoolId || "").trim();
  const learnerId = String(opts.learnerId || "").trim();
  const createNewAccount = Boolean(opts.createNewAccount);

  if (!schoolId || !learnerId) {
    throw new Error("schoolId and learnerId are required");
  }

  const learner = await loadLearner(schoolId, learnerId);
  if (!learner) throw new Error("Learner not found");

  const identityBefore = await snapshotLearnerIdentities(schoolId, [learnerId]);

  const sourceFamilyId = String(learner.familyAccountId || learner.familyAccount?.id || "").trim();
  if (!sourceFamilyId) throw new Error("Learner is not linked to a family account");

  const sourceAccount = await prisma.familyAccount.findFirst({
    where: { id: sourceFamilyId, schoolId },
    select: { id: true, accountRef: true, familyName: true },
  });
  if (!sourceAccount) throw new Error("Family account not found for this school");

  const oldAccountRef = sourceAccount.accountRef;
  let targetFamilyId: string | null = sourceFamilyId;
  let targetAccountRef: string | null = oldAccountRef;
  let newFamilyAccount: { id: string; accountRef: string } | null = null;

  const familyMembersBefore = await prisma.learner.findMany({
    where: { schoolId, familyAccountId: sourceFamilyId },
    select: { id: true },
  });
  const familyLearnerIds = familyMembersBefore.map((m) => m.id);

  if (createNewAccount) {
    const accountRef = await createFamilyAccountRef(schoolId, learner.lastName);
    newFamilyAccount = await prisma.familyAccount.create({
      data: {
        schoolId,
        accountRef,
        familyName: learner.lastName,
      },
      select: { id: true, accountRef: true },
    });
    targetFamilyId = newFamilyAccount.id;
    targetAccountRef = newFamilyAccount.accountRef;

    const unmergeLearnerData = { familyAccountId: targetFamilyId };
    assertLearnerUpdateFieldsAllowed(unmergeLearnerData);
    await prisma.learner.update({
      where: { id: learnerId },
      data: unmergeLearnerData,
    });
  } else {
    const detachLearnerData = { familyAccountId: null };
    assertLearnerUpdateFieldsAllowed(detachLearnerData);
    await prisma.learner.update({
      where: { id: learnerId },
      data: detachLearnerData,
    });
    targetFamilyId = null;
    targetAccountRef = resolveLearnerAccountNo({
      familyAccount: null,
      accountNo: learner.admissionNo,
    });
  }

  await verifyLearnerIdentitiesUnchanged(schoolId, identityBefore);

  let ledgerRowsUpdated = 0;
  let ledgerMovedEntryIds: string[] = [];
  let ledgerSplitEntryIds: string[] = [];
  let balanceBefore: Record<string, number> | null = null;
  let balanceAfter: Record<string, number> | null = null;

  if (targetAccountRef && targetAccountRef !== oldAccountRef) {
    const ledgerResult = unmergeLearnerLedger(schoolId, {
      fromAccountNo: oldAccountRef,
      toAccountNo: targetAccountRef,
      learnerId,
      familyLearnerIds,
    });
    ledgerRowsUpdated = ledgerResult.updated;
    ledgerMovedEntryIds = ledgerResult.movedEntryIds;
    ledgerSplitEntryIds = ledgerResult.splitEntryIds;
    balanceBefore = ledgerResult.balanceBefore;
    balanceAfter = ledgerResult.balanceAfter;
  }

  const audit = appendFamilyAccountAudit({
    schoolId,
    action: "unmerge",
    actorEmail: opts.actorEmail,
    sourceFamilyAccountId: sourceFamilyId,
    targetFamilyAccountId: targetFamilyId,
    sourceAccountRef: oldAccountRef,
    targetAccountRef: targetAccountRef || undefined,
    learnerIds: [learnerId],
    createNewAccount,
    metadata: {
      learnerMoved: learnerId,
      oldAccount: oldAccountRef,
      newAccount: targetAccountRef,
      transactionsMoved: [...ledgerMovedEntryIds, ...ledgerSplitEntryIds],
      movedEntryIds: ledgerMovedEntryIds,
      splitEntryIds: ledgerSplitEntryIds,
      balanceBefore,
      balanceAfter,
      ledgerRowsUpdated,
      newFamilyAccountId: newFamilyAccount?.id ?? null,
    },
  });

  const ledger = readSchoolLedger(schoolId);
  const statements = await buildAccountsFromLearners(schoolId, ledger);

  return {
    success: true,
    action: "unmerge" as const,
    learnerId,
    createNewAccount,
    sourceAccountRef: oldAccountRef,
    targetAccountRef: createNewAccount ? targetAccountRef : null,
    newFamilyAccount,
    ledgerRowsUpdated,
    audit,
    statements,
  };
}
