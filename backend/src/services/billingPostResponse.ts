import {
  isEduClearUndoCorrectionEntry,
  isUndoneLedgerEntry,
} from "../utils/billingDisplayRules";
import {
  computeOpenInvoiceLines,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import {
  buildSingleAccountFromAgeAnalysisSnapshot,
  resolveAuthoritativeAccountBalance,
  type BillingStatementAccountRow,
} from "./statementAccounts";

function collectAccountLedgerSlice(
  ledger: BillingLedgerEntry[],
  accountRef: string
): BillingLedgerEntry[] {
  const ref = String(accountRef || "").trim().toUpperCase();
  return ledger.filter(
    (entry) => String(entry.accountNo || "").trim().toUpperCase() === ref
  );
}

function activeLedgerEntriesForAccount(
  ledger: BillingLedgerEntry[],
  accountRef: string
): BillingLedgerEntry[] {
  const ref = String(accountRef || "").trim().toUpperCase();
  return ledger.filter((entry) => {
    if (String(entry.accountNo || "").trim().toUpperCase() !== ref) return false;
    if (isUndoneLedgerEntry(entry)) return false;
    if (isEduClearUndoCorrectionEntry(entry)) return false;
    return true;
  });
}

export type BillingAccountPostResponse = {
  balance: number;
  account: BillingStatementAccountRow | null;
  ledgerEntries: BillingLedgerEntry[];
  openInvoices: ReturnType<typeof computeOpenInvoiceLines>;
};

/**
 * Authoritative post-write payload for one billing account.
 * Uses age-analysis baseline + ledger delta — same source as GET /api/statements.
 */
export async function buildBillingAccountPostResponse(
  schoolId: string,
  accountRef: string,
  opts: { ledger?: BillingLedgerEntry[] } = {}
): Promise<BillingAccountPostResponse> {
  const sid = String(schoolId || "").trim();
  const ref = String(accountRef || "").trim().toUpperCase();
  const ledger = opts.ledger ?? readSchoolLedger(sid);

  const balance = await resolveAuthoritativeAccountBalance(sid, ref, { ledger });
  const account = await buildSingleAccountFromAgeAnalysisSnapshot(sid, ref, { ledger });
  const ledgerEntries = collectAccountLedgerSlice(ledger, ref);
  const openInvoices = computeOpenInvoiceLines(activeLedgerEntriesForAccount(ledger, ref), "", ref);

  return { balance, account, ledgerEntries, openInvoices };
}
