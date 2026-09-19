/**
 * Canonical FamilyAccount billing identity for Statements / Reports / Payment.
 *
 * CURRENT identity = FamilyAccount record (prefer dedicated accountNo).
 * LEGACY / ledger join = FamilyAccount.accountRef (Express name or code).
 * Age-analysis snapshots enrich balances but must not be the sole visibility gate.
 */
import {
  resolveEduClearAccountNo,
  resolveLedgerJoinAccountRef,
  type FamilyAccountNumberFields,
} from "./familyAccountNumber";
import { isFamilyAccountRetired, type FamilyAccountLifecycleFields } from "./familyAccountLifecycle";
import type { FamilyAccountAgeAnalysisSnapshot } from "../utils/familyAccountAgeAnalysisStore";
import type { BillingLedgerEntry } from "../utils/billingLedgerStore";

export type StatementFamilyAccount = FamilyAccountNumberFields &
  FamilyAccountLifecycleFields & {
    id: string;
    familyName?: string | null;
    mergedInto?: { accountRef?: string | null; schoolId?: string | null } | null;
  };

export type StatementIdentityLabels = {
  /** FA database id */
  faId: string;
  /** Dedicated EduClear code when present (CURRENT ACCOUNT NO) */
  currentAccountNo: string | null;
  /** Ledger / snapshot join key — legacy Express name or code (LEGACY REF) */
  legacyRef: string;
  /** Whether this FA is retired/merged predecessor */
  isHistoricalPredecessor: boolean;
};

/** Label provenance for tooling / reports — never treat legacyRef as CURRENT ACCOUNT NO. */
export function describeStatementIdentity(fa: StatementFamilyAccount): StatementIdentityLabels {
  const legacyRef = resolveLedgerJoinAccountRef(fa);
  const currentAccountNo = resolveEduClearAccountNo(fa) || null;
  return {
    faId: String(fa.id || "").trim(),
    currentAccountNo,
    legacyRef,
    isHistoricalPredecessor: isFamilyAccountRetired(fa),
  };
}

/** Resolve age-analysis snapshot for a FA: prefer accountRef, then dedicated accountNo. */
export function resolveSnapshotForFamily(
  fa: StatementFamilyAccount,
  snapshotsByRef: Record<string, FamilyAccountAgeAnalysisSnapshot | undefined>
): FamilyAccountAgeAnalysisSnapshot | undefined {
  const join = resolveLedgerJoinAccountRef(fa).toUpperCase();
  if (join && snapshotsByRef[join]) return snapshotsByRef[join];
  const edu = resolveEduClearAccountNo(fa).toUpperCase();
  if (edu && snapshotsByRef[edu]) return snapshotsByRef[edu];
  return undefined;
}

/** Ledger rows keyed by legacy join (accountRef). Also accept dedicated accountNo when equal. */
export function collectLedgerEntriesForFamily(
  fa: StatementFamilyAccount,
  ledger: BillingLedgerEntry[]
): BillingLedgerEntry[] {
  const join = resolveLedgerJoinAccountRef(fa).toUpperCase();
  const edu = resolveEduClearAccountNo(fa).toUpperCase();
  if (!join && !edu) return [];
  return ledger.filter((e) => {
    const key = String(e.accountNo || "").trim().toUpperCase();
    if (!key) return false;
    if (join && key === join) return true;
    // Only when edu differs from join — rows wrongly keyed by code after unmerge (SOT002 pattern)
    if (edu && edu !== join && key === edu) return true;
    return false;
  });
}

/**
 * Should this FA appear in Statements / Billing Reports?
 * Active current accounts: learners, ledger, or snapshot — even if snap key missing.
 * Historical predecessors: snap or ledger history (viewable, not payable when zero-linked).
 */
export function shouldIncludeFamilyInStatements(
  fa: StatementFamilyAccount,
  opts: {
    hasLinkedLearners: boolean;
    hasLedger: boolean;
    hasSnapshot: boolean;
    includeRetired?: boolean;
  }
): boolean {
  const join = resolveLedgerJoinAccountRef(fa);
  if (!join) return false;

  const retired = isFamilyAccountRetired(fa);
  const billingRelevant = opts.hasLinkedLearners || opts.hasLedger || opts.hasSnapshot;

  if (!retired) {
    // Current FA: visible even when age-analysis snapshot key is missing (SOT002).
    return billingRelevant;
  }

  // Historical predecessors: only when explicitly requested (historical Statements).
  // Default active billing lists omit retired/merged FAs (merge lifecycle).
  if (!opts.includeRetired) return false;
  return opts.hasSnapshot || opts.hasLedger;
}

/**
 * Build the set of FamilyAccounts that should appear in the statement list,
 * including current FAs missing from age-analysis (SOT002 regression).
 */
export function selectStatementFamilyAccounts(opts: {
  familyAccounts: StatementFamilyAccount[];
  snapshotsByRef: Record<string, FamilyAccountAgeAnalysisSnapshot | undefined>;
  ledger: BillingLedgerEntry[];
  linkedFamilyAccountIds: Set<string>;
  includeRetired?: boolean;
  accountRefFilter?: string;
}): StatementFamilyAccount[] {
  const filter = String(opts.accountRefFilter || "").trim().toUpperCase();
  const out: StatementFamilyAccount[] = [];

  for (const fa of opts.familyAccounts) {
    const identity = describeStatementIdentity(fa);
    if (filter) {
      const match =
        identity.legacyRef.toUpperCase() === filter ||
        (identity.currentAccountNo && identity.currentAccountNo.toUpperCase() === filter) ||
        String(fa.id).trim() === filter;
      if (!match) continue;
    }

    const snap = resolveSnapshotForFamily(fa, opts.snapshotsByRef);
    const entries = collectLedgerEntriesForFamily(fa, opts.ledger);
    const include = shouldIncludeFamilyInStatements(fa, {
      hasLinkedLearners: opts.linkedFamilyAccountIds.has(fa.id),
      hasLedger: entries.length > 0,
      hasSnapshot: Boolean(snap),
      includeRetired: opts.includeRetired,
    });
    if (include) out.push(fa);
  }

  return out;
}

/**
 * Snapshot keys that have no matching FamilyAccount.accountRef / accountNo.
 * Kept as orphan statement rows for migration edge cases (existing behaviour).
 */
export function orphanSnapshotRefs(
  snapshotsByRef: Record<string, FamilyAccountAgeAnalysisSnapshot | undefined>,
  familyAccounts: StatementFamilyAccount[]
): string[] {
  const covered = new Set<string>();
  for (const fa of familyAccounts) {
    const join = resolveLedgerJoinAccountRef(fa).toUpperCase();
    const edu = resolveEduClearAccountNo(fa).toUpperCase();
    if (join) covered.add(join);
    if (edu) covered.add(edu);
  }
  return Object.keys(snapshotsByRef)
    .map((k) => k.toUpperCase())
    .filter((k) => k && !covered.has(k) && !String(snapshotsByRef[k]?.mergedIntoAccountRef || "").trim());
}

/** Dry-run: FAs that are current/billing-relevant but missing from age-analysis universe. */
export function listFamilyAccountsMissingAgeAnalysisSnapshot(opts: {
  familyAccounts: StatementFamilyAccount[];
  snapshotsByRef: Record<string, FamilyAccountAgeAnalysisSnapshot | undefined>;
  ledger: BillingLedgerEntry[];
  linkedFamilyAccountIds: Set<string>;
}): Array<{
  faId: string;
  currentAccountNo: string | null;
  legacyRef: string;
  reason: string;
  proposedSnapshotKey: string;
}> {
  const missing: Array<{
    faId: string;
    currentAccountNo: string | null;
    legacyRef: string;
    reason: string;
    proposedSnapshotKey: string;
  }> = [];

  for (const fa of opts.familyAccounts) {
    if (isFamilyAccountRetired(fa)) continue;
    const identity = describeStatementIdentity(fa);
    if (!identity.legacyRef) continue;
    const snap = resolveSnapshotForFamily(fa, opts.snapshotsByRef);
    if (snap) continue;
    const entries = collectLedgerEntriesForFamily(fa, opts.ledger);
    const hasLearners = opts.linkedFamilyAccountIds.has(fa.id);
    if (!hasLearners && !entries.length) continue;
    missing.push({
      faId: fa.id,
      currentAccountNo: identity.currentAccountNo,
      legacyRef: identity.legacyRef,
      reason: hasLearners
        ? "current FA with linked learner(s) but no age-analysis snapshot key"
        : "current FA with ledger activity but no age-analysis snapshot key",
      proposedSnapshotKey: identity.legacyRef.toUpperCase(),
    });
  }
  return missing;
}
