import { relinkSchoolBillingLedger } from "./billingLedgerRelink";
import { resolveBillingAccountRef } from "./resolveBillingAccountRef";
import { resolveAccountStatementScope } from "./statementPdfData";
import {
  buildStatementManageTransactions,
  type StatementManageTransactionRow,
} from "./statementTransactionBuilder";
import {
  collectAccountRefLedgerEntries,
  readSchoolLedger,
} from "../utils/billingLedgerStore";
import {
  computeStatementOpeningBalance,
  filterLedgerByStatementPeriod,
  formatStatementPeriodHeaderLabel,
  normalizeStatementPeriod,
} from "../utils/statementPeriod";

export type BuildAccountStatementTransactionsOptions = {
  schoolId: string;
  accountNo?: string;
  learnerId?: string;
  familyAccountId?: string;
  accountIdentityType?: "familyAccountId" | "accountRef" | "accountNo" | "learnerId";
  accountIdentityValue?: string;
  period?: string;
  showCorrectionsAudit?: boolean;
};

export type AccountStatementTransactionsResult = {
  accountNo: string;
  period: string;
  periodLabel: string;
  openingBalance: number;
  transactions: StatementManageTransactionRow[];
  count: number;
};

/**
 * Account-scoped statement transactions from server ledger (canonical source for Statement Manage).
 */
export async function buildAccountStatementTransactions(
  options: BuildAccountStatementTransactionsOptions
): Promise<AccountStatementTransactionsResult | null> {
  const schoolId = String(options.schoolId || "").trim();
  const accountNo = String(options.accountNo || "").trim();
  const learnerId = String(options.learnerId || "").trim();
  const familyAccountId = String(options.familyAccountId || "").trim();
  const accountIdentityType = options.accountIdentityType;
  const accountIdentityValue = String(options.accountIdentityValue || "").trim();
  const period = normalizeStatementPeriod(options.period);
  const showCorrectionsAudit = Boolean(options.showCorrectionsAudit);

  if (
    !schoolId ||
    (!accountNo && !learnerId && !familyAccountId && !accountIdentityValue)
  ) {
    return null;
  }

  await relinkSchoolBillingLedger(schoolId);

  const resolved = await resolveAccountStatementScope(schoolId, {
    accountNo,
    learnerId,
    familyAccountId: familyAccountId || undefined,
    accountIdentityType,
    accountIdentityValue: accountIdentityValue || undefined,
  });
  let accountRef = resolved?.accountRef || "";
  let nameByLearnerId = new Map<string, string>();
  if (resolved?.scope) {
    nameByLearnerId = new Map(
      resolved.scope.learners.map((l) => [l.id, `${l.firstName} ${l.lastName}`.trim()])
    );
  }

  // Legacy ledger-only join: accountNo/accountRef only — never treat learnerId as an accountRef.
  if (!accountRef && accountNo) {
    const billingRef = await resolveBillingAccountRef(schoolId, accountNo);
    accountRef = String(billingRef?.accountRef || "").trim();
  }

  if (!accountRef) return null;

  const ledger = readSchoolLedger(schoolId);
  const scopedEntries = collectAccountRefLedgerEntries(ledger, accountRef);
  const periodFilteredEntries = filterLedgerByStatementPeriod(scopedEntries, period);
  const openingBalance = computeStatementOpeningBalance(scopedEntries, period, {
    showCorrectionsAudit,
  });

  const transactions = buildStatementManageTransactions({
    schoolId,
    accountRef,
    ledgerEntries: scopedEntries,
    periodFilteredEntries,
    period,
    openingBalance,
    nameByLearnerId,
    showCorrectionsAudit,
  });

  return {
    accountNo: accountRef,
    period,
    periodLabel: formatStatementPeriodHeaderLabel(period),
    openingBalance,
    transactions,
    count: transactions.length,
  };
}
