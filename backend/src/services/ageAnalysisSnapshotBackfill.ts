/**
 * Safe age-analysis snapshot backfill plan (dry-run by default).
 *
 * Regenerates missing snapshot keys for current FamilyAccounts from
 * authoritative ledger balances + FA metadata. Does NOT mutate amounts on
 * existing snapshots or rewrite document identities.
 *
 * Apply path requires APPLY_AGE_ANALYSIS_BACKFILL=true — never run on
 * production without explicit approval.
 */
import { prisma } from "../prisma";
import {
  calculateBalanceFromEntries,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import {
  insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent,
  readSchoolFamilyAccountAgeAnalysisSnapshots,
  type FamilyAccountAgeAnalysisSnapshot,
} from "../utils/familyAccountAgeAnalysisStore";
import {
  countsTowardPostImportBalanceDelta,
  isEduClearUndoCorrectionEntry,
  isUndoneLedgerEntry,
} from "../utils/billingDisplayRules";
import {
  collectLedgerEntriesForFamily,
  listFamilyAccountsMissingAgeAnalysisSnapshot,
  type StatementFamilyAccount,
} from "./statementAccountIdentity";
import { resolveEduClearAccountNo, resolveLedgerJoinAccountRef } from "./familyAccountNumber";
import { isFamilyAccountRetired } from "./familyAccountLifecycle";

export const FLY_EAGLE_SCHOOL_ID = "cmt1e8bjp0jo8lcjeketlynhl";

export type AgeAnalysisBackfillCandidate = {
  faId: string;
  currentAccountNo: string | null;
  legacyRef: string;
  reason: string;
  proposedSnapshotKey: string;
  proposedBalance: number;
  proposedAccountHolder: string;
  ledgerEntryCount: number;
};

export type AgeAnalysisBackfillPlan = {
  schoolId: string;
  mode: "dry-run" | "apply";
  before: {
    snapshotKeyCount: number;
    familyAccountCount: number;
    currentFamilyAccountCount: number;
    missingCurrentFaSnapshotCount: number;
  };
  afterExpected: {
    snapshotKeyCount: number;
    insertedCount: number;
    skippedAlreadyExists: number;
  };
  candidates: AgeAnalysisBackfillCandidate[];
  applied?: {
    inserted: string[];
    alreadyExists: string[];
  };
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function activeLedgerBalance(entries: BillingLedgerEntry[]): number {
  const active = entries.filter(
    (entry) =>
      !isUndoneLedgerEntry(entry) &&
      !isEduClearUndoCorrectionEntry(entry) &&
      countsTowardPostImportBalanceDelta(entry)
  );
  return round2(calculateBalanceFromEntries(active));
}

export function proposeSnapshotForMissingFamily(
  fa: StatementFamilyAccount,
  ledger: BillingLedgerEntry[]
): AgeAnalysisBackfillCandidate {
  const legacyRef = resolveLedgerJoinAccountRef(fa);
  const currentAccountNo = resolveEduClearAccountNo(fa) || null;
  const entries = collectLedgerEntriesForFamily(fa, ledger);
  const proposedBalance = activeLedgerBalance(entries);
  return {
    faId: fa.id,
    currentAccountNo,
    legacyRef,
    reason: "current FA missing age-analysis snapshot key",
    proposedSnapshotKey: legacyRef.toUpperCase(),
    proposedBalance,
    proposedAccountHolder: String(fa.familyName || legacyRef || currentAccountNo || "").trim(),
    ledgerEntryCount: entries.length,
  };
}

/**
 * Build a dry-run (or apply) plan to insert missing age-analysis baselines
 * for current FamilyAccounts. Never overwrites existing snapshot keys.
 */
export async function planAgeAnalysisSnapshotBackfill(
  schoolId: string,
  opts: {
    ledger?: BillingLedgerEntry[];
    apply?: boolean;
    /** Only insert if APPLY_AGE_ANALYSIS_BACKFILL=true when apply=true */
    allowApplyEnv?: boolean;
  } = {}
): Promise<AgeAnalysisBackfillPlan> {
  const sid = String(schoolId || "").trim();
  if (!sid) throw new Error("schoolId required");

  const applyRequested = Boolean(opts.apply);
  if (applyRequested) {
    const envOk =
      opts.allowApplyEnv === false
        ? false
        : String(process.env.APPLY_AGE_ANALYSIS_BACKFILL || "").trim() === "true";
    if (!envOk) {
      throw new Error(
        "Refusing apply: set APPLY_AGE_ANALYSIS_BACKFILL=true (and pass apply:true) to mutate snapshots"
      );
    }
  }

  const snapshotsByRef = readSchoolFamilyAccountAgeAnalysisSnapshots(sid);
  const snapshotKeyCount = Object.keys(snapshotsByRef).filter((k) => {
    const snap = snapshotsByRef[k];
    return snap && !String(snap.mergedIntoAccountRef || "").trim();
  }).length;

  const familyAccounts = (await prisma.familyAccount.findMany({
    where: { schoolId: sid },
    select: {
      id: true,
      accountRef: true,
      accountNo: true,
      familyName: true,
      retiredAt: true,
      mergedIntoFamilyAccountId: true,
    },
  })) as StatementFamilyAccount[];

  const learners = await prisma.learner.findMany({
    where: { schoolId: sid, familyAccountId: { not: null } },
    select: { familyAccountId: true },
    distinct: ["familyAccountId"],
  });
  const linkedFamilyAccountIds = new Set(
    learners.map((l) => String(l.familyAccountId || "").trim()).filter(Boolean)
  );

  const ledger = opts.ledger ?? readSchoolLedger(sid);
  const missing = listFamilyAccountsMissingAgeAnalysisSnapshot({
    familyAccounts,
    snapshotsByRef,
    ledger,
    linkedFamilyAccountIds,
  });

  const faById = new Map(familyAccounts.map((fa) => [fa.id, fa]));
  const candidates: AgeAnalysisBackfillCandidate[] = [];
  for (const m of missing) {
    const fa = faById.get(m.faId);
    if (!fa || isFamilyAccountRetired(fa)) continue;
    candidates.push(proposeSnapshotForMissingFamily(fa, ledger));
  }

  const currentFamilyAccountCount = familyAccounts.filter((fa) => !isFamilyAccountRetired(fa)).length;

  const plan: AgeAnalysisBackfillPlan = {
    schoolId: sid,
    mode: applyRequested ? "apply" : "dry-run",
    before: {
      snapshotKeyCount,
      familyAccountCount: familyAccounts.length,
      currentFamilyAccountCount,
      missingCurrentFaSnapshotCount: candidates.length,
    },
    afterExpected: {
      snapshotKeyCount: snapshotKeyCount + candidates.length,
      insertedCount: candidates.length,
      skippedAlreadyExists: 0,
    },
    candidates,
  };

  if (!applyRequested) return plan;

  const inserted: string[] = [];
  const alreadyExists: string[] = [];
  const now = new Date().toISOString();
  for (const c of candidates) {
    const snapshot: FamilyAccountAgeAnalysisSnapshot = {
      schoolId: sid,
      accountRef: c.proposedSnapshotKey,
      accountHolder: c.proposedAccountHolder,
      balance: c.proposedBalance,
      buckets: {
        current: c.proposedBalance,
        d30: 0,
        d60: 0,
        d90: 0,
        d120: 0,
      },
      source: "educlear-registration",
      importedAt: now,
    };
    const result = insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
      sid,
      c.proposedSnapshotKey,
      snapshot
    );
    if (result === "inserted") inserted.push(c.proposedSnapshotKey);
    else alreadyExists.push(c.proposedSnapshotKey);
  }

  plan.applied = { inserted, alreadyExists };
  plan.afterExpected.insertedCount = inserted.length;
  plan.afterExpected.skippedAlreadyExists = alreadyExists.length;
  plan.afterExpected.snapshotKeyCount = snapshotKeyCount + inserted.length;
  return plan;
}
