"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Proof report for Kid-e-Sys non-posting transaction history import.
 *
 * Usage: npx ts-node scripts/kidesys-history-proof.ts [schoolId] [accountNo...]
 */
require("dotenv/config");
const prisma_1 = require("../src/prisma");
const statementAccounts_1 = require("../src/services/statementAccounts");
const kidesysTransactionHistoryStore_1 = require("../src/utils/kidesysTransactionHistoryStore");
const billingLedgerStore_1 = require("../src/utils/billingLedgerStore");
const daSilvaFinalImportGate_1 = require("../src/services/daSilvaMigration/daSilvaFinalImportGate");
const schoolIdArg = process.argv[2] || "";
const accountNos = process.argv.slice(3).filter(Boolean);
async function resolveSchoolId() {
    if (schoolIdArg)
        return schoolIdArg;
    const existing = await prisma_1.prisma.school.findFirst({
        where: { name: daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName },
        select: { id: true },
    });
    if (existing)
        return existing.id;
    throw new Error("School not found");
}
async function main() {
    const schoolId = await resolveSchoolId();
    const history = (0, kidesysTransactionHistoryStore_1.readSchoolKidesysHistory)(schoolId);
    const ledger = (0, billingLedgerStore_1.readSchoolLedger)(schoolId);
    const accounts = await (0, statementAccounts_1.buildAccountsFromLearners)(schoolId, ledger);
    const index = (0, kidesysTransactionHistoryStore_1.buildKidesysHistoryAccountIndex)(history);
    const samples = accountNos.length >= 3
        ? accountNos.slice(0, 3)
        : ["MOT004", "MAN010", "KHO002"];
    console.log(`School: ${schoolId}`);
    console.log(`Total history rows: ${history.length}`);
    console.log(`Ledger entries: ${ledger.length} (unchanged posting ledger)`);
    console.log("");
    for (const accountNo of samples) {
        const summary = index.get(accountNo);
        const acct = accounts.find((a) => a.accountNo === accountNo);
        const histRows = (0, kidesysTransactionHistoryStore_1.filterHistoryForAccount)(history, accountNo);
        const ledgerEntries = (0, billingLedgerStore_1.collectFamilyAccountEntries)(ledger, {
            accountRef: accountNo,
            learnerIds: acct?.memberLearnerIds || [],
        });
        const ledgerBalance = (0, billingLedgerStore_1.calculateBalanceFromEntries)(ledgerEntries);
        console.log(`=== ${accountNo} ===`);
        console.log(`  History rows in Manage Statement: ${histRows.length}`);
        console.log(`  Last invoice: ${summary?.lastInvoice?.date || "—"} | R${(summary?.lastInvoice?.amount ?? 0).toFixed(2)} | ${summary?.lastInvoice?.reference || "—"}`);
        console.log(`  Last payment: ${summary?.lastPayment?.date || "—"} | R${(summary?.lastPayment?.amount ?? 0).toFixed(2)} | ${summary?.lastPayment?.reference || "—"}`);
        console.log(`  Statement overview last invoice: R${Number(acct?.lastInvoice ?? 0).toFixed(2)} on ${acct?.lastInvoiceDate || "—"}${acct?.lastInvoiceLabel ? ` (${acct.lastInvoiceLabel})` : ""}`);
        console.log(`  Statement overview last payment: R${Number(acct?.lastPayment ?? 0).toFixed(2)} on ${acct?.lastPaymentDate || "—"}`);
        console.log(`  Account balance (ledger only): R${ledgerBalance.toFixed(2)} — unchanged by history import`);
        console.log("");
    }
    await prisma_1.prisma.$disconnect();
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
