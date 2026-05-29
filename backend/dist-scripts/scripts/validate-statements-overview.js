"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Validate Statements overview totals (family-account rows, no sibling duplication).
 * Usage: npx ts-node scripts/validate-statements-overview.ts [schoolId]
 */
const prisma_1 = require("../src/prisma");
const daSilvaTransactionHistory_1 = require("../src/services/daSilvaMigration/daSilvaTransactionHistory");
const statementAccounts_1 = require("../src/services/statementAccounts");
const kidesysTransactionHistoryStore_1 = require("../src/utils/kidesysTransactionHistoryStore");
const billingLedgerStore_1 = require("../src/utils/billingLedgerStore");
const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const EXPECTED = {
    accounts: daSilvaTransactionHistory_1.DA_SILVA_PHASE5_BALANCE_GUARDS.accounts,
    netOutstanding: daSilvaTransactionHistory_1.DA_SILVA_PHASE5_BALANCE_GUARDS.netOutstanding,
    overPaid: daSilvaTransactionHistory_1.DA_SILVA_PHASE5_BALANCE_GUARDS.overPaid,
    historyRows: daSilvaTransactionHistory_1.DA_SILVA_EXPECTED_HISTORY_ROW_COUNT,
};
function round2(n) {
    return Math.round(n * 100) / 100;
}
async function main() {
    const schoolId = process.argv[2]?.trim() || DA_SILVA_SCHOOL_ID;
    const ledger = (0, billingLedgerStore_1.readSchoolLedger)(schoolId);
    const history = (0, kidesysTransactionHistoryStore_1.readSchoolKidesysHistory)(schoolId);
    const accounts = await (0, statementAccounts_1.buildAccountsFromLearners)(schoolId, ledger);
    const learnerCount = await prisma_1.prisma.learner.count({ where: { schoolId } });
    const grossOutstanding = round2(accounts.reduce((sum, row) => sum + Math.max(Number(row.balance) || 0, 0), 0));
    const netOutstanding = round2(accounts.reduce((sum, row) => sum + Number(row.balance), 0));
    const overPaid = round2(Math.abs(accounts
        .filter((row) => Number(row.balance) < 0)
        .reduce((sum, row) => sum + Number(row.balance), 0)));
    const openingBalanceLabels = accounts.filter((a) => a.lastInvoiceLabel === "Opening Balance");
    const withLastInvoiceFromHistory = accounts.filter((a) => Number(a.lastInvoice) > 0 && !a.lastInvoiceLabel).length;
    const withLastPaymentFromHistory = accounts.filter((a) => Number(a.lastPayment) > 0).length;
    const historyInLedger = ledger.some((e) => String(e.source || "") === "kidesys_display_history");
    const fakeInvoiceDates = accounts.filter((a) => String(a.lastInvoiceDate || "").includes("2026-05-23") &&
        Number(a.lastInvoice) > 0 &&
        !a.lastInvoiceLabel);
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
        passed: accounts.length === EXPECTED.accounts &&
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
