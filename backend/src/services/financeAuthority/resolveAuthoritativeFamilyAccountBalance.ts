/**
 * Phase 1I — Single shared family-account balance authority.
 *
 * Authoritative Account Balance =
 *   accepted migration / age-analysis baseline
 *   + eligible post-baseline live ledger movements
 *
 * Statements, Fee Check, and Migration Finance gates must all consume this.
 * Do not invent a second ledger or copy balances into competing fields.
 */

import {
  resolveAuthoritativeAccountBalance,
  resolveAuthoritativeAccountBalanceFromSnapshot,
  roundStatementMoney,
} from "../statementAccounts";
import {
  readSchoolFamilyAccountAgeAnalysisSnapshots,
  type FamilyAccountAgeAnalysisSnapshot,
} from "../../utils/familyAccountAgeAnalysisStore";
import {
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../../utils/billingLedgerStore";
import { randToCents } from "../migration/finance/moneyCents";

export type AuthoritativeBalanceSource =
  | "AGE_ANALYSIS_BASELINE_PLUS_DELTA"
  | "LEDGER_LIVE_ONLY"
  | "NONE";

export type AuthoritativeFamilyAccountBalance = {
  schoolId: string;
  accountRef: string;
  balanceRand: number;
  balanceCents: number;
  hasBaseline: boolean;
  baselineSource: string | null;
  baselineImportedAt: string | null;
  authoritySource: AuthoritativeBalanceSource;
};

/**
 * The one reusable authority for family-account outstanding position.
 * Prefer this over Parent.outstandingAmount and over ad-hoc ledger sums.
 */
export async function resolveAuthoritativeFamilyAccountBalance(
  schoolId: string,
  accountRef: string,
  opts: { ledger?: BillingLedgerEntry[] } = {}
): Promise<AuthoritativeFamilyAccountBalance> {
  const sid = String(schoolId || "").trim();
  const ref = String(accountRef || "").trim().toUpperCase();
  if (!sid || !ref) {
    return {
      schoolId: sid,
      accountRef: ref,
      balanceRand: 0,
      balanceCents: 0,
      hasBaseline: false,
      baselineSource: null,
      baselineImportedAt: null,
      authoritySource: "NONE",
    };
  }

  const snapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(sid);
  const snap =
    snapshots[ref] ??
    Object.values(snapshots).find(
      (row) => String(row.accountRef || "").trim().toUpperCase() === ref
    );

  const ledger = opts.ledger ?? readSchoolLedger(sid);
  const accountEntries = ledger.filter(
    (e) => String(e.accountNo || "").trim().toUpperCase() === ref
  );

  const balanceRand = resolveAuthoritativeAccountBalanceFromSnapshot(snap, accountEntries);

  return {
    schoolId: sid,
    accountRef: ref,
    balanceRand: roundStatementMoney(balanceRand),
    balanceCents: randToCents(balanceRand),
    hasBaseline: Boolean(snap),
    baselineSource: snap ? String(snap.source || "") : null,
    baselineImportedAt: snap?.importedAt || null,
    authoritySource: snap
      ? "AGE_ANALYSIS_BASELINE_PLUS_DELTA"
      : "LEDGER_LIVE_ONLY",
  };
}

/** Sync helper when snapshot + entries already loaded. */
export function resolveAuthoritativeFamilyAccountBalanceFromParts(
  schoolId: string,
  accountRef: string,
  snap: FamilyAccountAgeAnalysisSnapshot | undefined,
  accountEntries: BillingLedgerEntry[]
): AuthoritativeFamilyAccountBalance {
  const balanceRand = resolveAuthoritativeAccountBalanceFromSnapshot(snap, accountEntries);
  return {
    schoolId,
    accountRef: String(accountRef || "").trim().toUpperCase(),
    balanceRand: roundStatementMoney(balanceRand),
    balanceCents: randToCents(balanceRand),
    hasBaseline: Boolean(snap),
    baselineSource: snap ? String(snap.source || "") : null,
    baselineImportedAt: snap?.importedAt || null,
    authoritySource: snap
      ? "AGE_ANALYSIS_BASELINE_PLUS_DELTA"
      : "LEDGER_LIVE_ONLY",
  };
}

export { resolveAuthoritativeAccountBalance };
