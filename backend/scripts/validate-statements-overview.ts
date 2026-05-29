/**
 * Validate Statements overview totals (family-account rows, no sibling duplication).
 * Usage: npx ts-node scripts/validate-statements-overview.ts [schoolId]
 */
import { prisma } from "../src/prisma";
import {
  DA_SILVA_EXPECTED_HISTORY_ROW_COUNT,
  DA_SILVA_PHASE5_BALANCE_GUARDS,
} from "../src/services/daSilvaMigration/daSilvaTransactionHistory";
import { buildAccountsFromLearners } from "../src/services/statementAccounts";
import { readSchoolKidesysHistory } from "../src/utils/kidesysTransactionHistoryStore";
import { readSchoolLedger } from "../src/utils/billingLedgerStore";

const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const EXPECTED = {
  accounts: DA_SILVA_PHASE5_BALANCE_GUARDS.accounts,
  netOutstanding: DA_SILVA_PHASE5_BALANCE_GUARDS.netOutstanding,
  overPaid: DA_SILVA_PHASE5_BALANCE_GUARDS.overPaid,
  historyRows: DA_SILVA_EXPECTED_HISTORY_ROW_COUNT,
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function main() {
  const schoolId = process.argv[2]?.trim() || DA_SILVA_SCHOOL_ID;
  const ledger = readSchoolLedger(schoolId);
  const history = readSchoolKidesysHistory(schoolId);
  const accounts = await buildAccountsFromLearners(schoolId, ledger);

  const learnerCount = await prisma.learner.count({ where: { schoolId } });

  const grossOutstanding = round2(
    accounts.reduce((sum, row) => sum + Math.max(Number(row.balance) || 0, 0), 0)
  );
  const netOutstanding = round2(
    accounts.reduce((sum, row) => sum + Number(row.balance), 0)
  );
  const overPaid = round2(
    Math.abs(
      accounts
        .filter((row) => Number(row.balance) < 0)
        .reduce((sum, row) => sum + Number(row.balance), 0)
    )
  );

  const openingBalanceLabels = accounts.filter((a) => a.lastInvoiceLabel === "Opening Balance");
  const withLastInvoiceFromHistory = accounts.filter(
    (a) => Number(a.lastInvoice) > 0 && !a.lastInvoiceLabel
  ).length;
  const withLastPaymentFromHistory = accounts.filter((a) => Number(a.lastPayment) > 0).length;
  const historyInLedger = ledger.some((e) => String(e.source || "") === "kidesys_display_history");
  const fakeInvoiceDates = accounts.filter(
    (a) =>
      String(a.lastInvoiceDate || "").includes("2026-05-23") &&
      Number(a.lastInvoice) > 0 &&
      !a.lastInvoiceLabel
  );

  const report = {
    schoolId,
    learnersInDb: learnerCount,
    accountRows: accounts.length,
    expectedAccounts: EXPECTED.accounts,
    accountsMatch: accounts.length === EXPECTED.accounts,
    grossOutstanding,
    netOutstanding,
    expectedNetOutstanding: EXPECTED.netOutstanding,
    netOutstandingMatch: Math.abs(netOutstanding - EXPECTED.netOutstanding) < 0.02,
    overPaid,
    expectedOverPaid: EXPECTED.overPaid,
    overPaidMatch: Math.abs(overPaid - EXPECTED.overPaid) < 0.02,
    siblingDuplication: learnerCount > accounts.length,
    openingBalanceLabelCount: openingBalanceLabels.length,
    historyRowCount: history.length,
    expectedHistoryRows: EXPECTED.historyRows,
    historyRowCountMatch: history.length === EXPECTED.historyRows,
    accountsWithLastInvoicePopulated: withLastInvoiceFromHistory,
    accountsWithLastPaymentPopulated: withLastPaymentFromHistory,
    historyDoubleCountingInLedger: historyInLedger,
    openingBalanceShownAsInvoiceDate: fakeInvoiceDates.length,
    passed:
      accounts.length === EXPECTED.accounts &&
      Math.abs(netOutstanding - EXPECTED.netOutstanding) < 0.02 &&
      Math.abs(overPaid - EXPECTED.overPaid) < 0.02 &&
      fakeInvoiceDates.length === 0 &&
      !historyInLedger,
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
