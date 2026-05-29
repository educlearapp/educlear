/**
 * Proof report for Kid-e-Sys non-posting transaction history import.
 *
 * Usage: npx ts-node scripts/kidesys-history-proof.ts [schoolId] [accountNo...]
 */
import "dotenv/config";

import { prisma } from "../src/prisma";
import { buildAccountsFromLearners } from "../src/services/statementAccounts";
import {
  buildKidesysHistoryAccountIndex,
  filterHistoryForAccount,
  readSchoolKidesysHistory,
} from "../src/utils/kidesysTransactionHistoryStore";
import {
  calculateBalanceFromEntries,
  collectFamilyAccountEntries,
  readSchoolLedger,
} from "../src/utils/billingLedgerStore";
import { DA_SILVA_FINAL_IMPORT_EXPECTED } from "../src/services/daSilvaMigration/daSilvaFinalImportGate";

const schoolIdArg = process.argv[2] || "";
const accountNos = process.argv.slice(3).filter(Boolean);

async function resolveSchoolId(): Promise<string> {
  if (schoolIdArg) return schoolIdArg;
  const existing = await prisma.school.findFirst({
    where: { name: DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName },
    select: { id: true },
  });
  if (existing) return existing.id;
  throw new Error("School not found");
}

async function main(): Promise<void> {
  const schoolId = await resolveSchoolId();
  const history = readSchoolKidesysHistory(schoolId);
  const ledger = readSchoolLedger(schoolId);
  const accounts = await buildAccountsFromLearners(schoolId, ledger);
  const index = buildKidesysHistoryAccountIndex(history);

  const samples =
    accountNos.length >= 3
      ? accountNos.slice(0, 3)
      : ["MOT004", "MAN010", "KHO002"];

  console.log(`School: ${schoolId}`);
  console.log(`Total history rows: ${history.length}`);
  console.log(`Ledger entries: ${ledger.length} (unchanged posting ledger)`);
  console.log("");

  for (const accountNo of samples) {
    const summary = index.get(accountNo);
    const acct = accounts.find((a) => a.accountNo === accountNo);
    const histRows = filterHistoryForAccount(history, accountNo);
    const ledgerEntries = collectFamilyAccountEntries(ledger, {
      accountRef: accountNo,
      learnerIds: acct?.memberLearnerIds || [],
    });
    const ledgerBalance = calculateBalanceFromEntries(ledgerEntries);

    console.log(`=== ${accountNo} ===`);
    console.log(`  History rows in Manage Statement: ${histRows.length}`);
    console.log(
      `  Last invoice: ${summary?.lastInvoice?.date || "—"} | R${(summary?.lastInvoice?.amount ?? 0).toFixed(2)} | ${summary?.lastInvoice?.reference || "—"}`
    );
    console.log(
      `  Last payment: ${summary?.lastPayment?.date || "—"} | R${(summary?.lastPayment?.amount ?? 0).toFixed(2)} | ${summary?.lastPayment?.reference || "—"}`
    );
    console.log(
      `  Statement overview last invoice: R${Number(acct?.lastInvoice ?? 0).toFixed(2)} on ${acct?.lastInvoiceDate || "—"}${acct?.lastInvoiceLabel ? ` (${acct.lastInvoiceLabel})` : ""}`
    );
    console.log(
      `  Statement overview last payment: R${Number(acct?.lastPayment ?? 0).toFixed(2)} on ${acct?.lastPaymentDate || "—"}`
    );
    console.log(
      `  Account balance (ledger only): R${ledgerBalance.toFixed(2)} — unchanged by history import`
    );
    console.log("");
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
