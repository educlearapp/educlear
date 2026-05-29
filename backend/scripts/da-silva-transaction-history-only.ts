/**
 * Da Silva migration — phase 5: Kid-e-Sys transaction history (display-only, non-posting).
 *
 * Usage:
 *   npx ts-node scripts/da-silva-transaction-history-only.ts [desktopRoot] [schoolId]
 *   npx ts-node scripts/da-silva-transaction-history-only.ts [desktopRoot] [schoolId] --apply
 *
 * Dry-run by default. Writes backend/data/kidesys-transaction-history.json only when --apply.
 * Does NOT modify billing-ledger.json or opening balances.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import {
  DA_SILVA_EXPECTED_HISTORY_ROW_COUNT,
  DA_SILVA_PHASE5_BALANCE_GUARDS,
  importDaSilvaTransactionHistory,
} from "../src/services/daSilvaMigration/daSilvaTransactionHistory";
import { DA_SILVA_FINAL_IMPORT_EXPECTED } from "../src/services/daSilvaMigration/daSilvaFinalImportGate";
import { readSchoolKidesysHistory } from "../src/utils/kidesysTransactionHistoryStore";
import { readSchoolLedger } from "../src/utils/billingLedgerStore";

const desktopRoot = process.argv[2] || path.join(process.env.HOME || "", "Desktop");
const schoolIdArg = process.argv[3]?.startsWith("--") ? "" : process.argv[3] || "";
const apply = process.argv.includes("--apply");

const transactionsPath = path.join(
  desktopRoot,
  "01_transaction_list",
  "transaction_list.xls"
);

const SCHOOL_NAME = DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName;

async function resolveSchoolId(): Promise<string> {
  if (schoolIdArg) return schoolIdArg;
  const existing = await prisma.school.findFirst({
    where: { name: SCHOOL_NAME },
    select: { id: true },
  });
  if (existing) return existing.id;
  throw new Error(`School not found: ${SCHOOL_NAME}`);
}

function printReport(report: Awaited<ReturnType<typeof importDaSilvaTransactionHistory>>) {
  console.log(`\n=== Phase 5 — Kid-e-Sys transaction history (${report.dryRun ? "DRY RUN" : "APPLY"}) ===`);
  console.log(`School: ${report.schoolId}`);
  console.log(`Parsed rows: ${report.parsedRowCount} (expected ${DA_SILVA_EXPECTED_HISTORY_ROW_COUNT})`);
  console.log(`History entries: ${report.historyEntryCount}`);
  console.log(`Distinct accounts in history: ${report.distinctAccountsInHistory}`);
  console.log(`Family accounts in DB: ${report.familyAccountsInDb}`);
  console.log(
    `History on inactive/legacy account refs (not in 344 family accounts): ${report.unlinkedAccountCount}`
  );
  console.log(
    `Active family accounts missing history: ${report.familyAccountsMissingHistoryCount}`
  );
  console.log(`Statement rows: ${report.accounts} (expected ${DA_SILVA_PHASE5_BALANCE_GUARDS.accounts})`);
  console.log(
    `Net outstanding: R${report.netOutstanding.toFixed(2)} (expected R${DA_SILVA_PHASE5_BALANCE_GUARDS.netOutstanding})`
  );
  console.log(
    `Overpaid: R${report.overPaid.toFixed(2)} (expected R${DA_SILVA_PHASE5_BALANCE_GUARDS.overPaid})`
  );
  console.log(`Ledger entries unchanged: ${report.ledgerEntryCountUnchanged} (${report.ledgerEntryCount})`);
  console.log(
    `Ledger balance unchanged: ${report.ledgerBalanceUnchanged} (R${report.ledgerBalanceBefore.toFixed(2)})`
  );
  console.log(`Accounts with history last invoice: ${report.accountsWithHistoryLastInvoice}`);
  console.log(`Accounts with history last payment: ${report.accountsWithHistoryLastPayment}`);
  console.log(`Accounts showing Opening Balance (no history invoice): ${report.accountsWithOpeningBalanceLabel}`);
  console.log(`Double-counting risk: ${report.doubleCountingRisk ? "YES" : "no"}`);
  console.log(`Status: ${report.passed ? "PASS" : "FAIL"}`);
  if (report.errors.length) {
    console.log("Errors:");
    for (const err of report.errors) console.log(`  - ${err}`);
  }
  if (report.unlinkedAccountNos.length) {
    console.log("Sample unlinked account refs:", report.unlinkedAccountNos.slice(0, 10).join(", "));
  }
}

async function main(): Promise<void> {
  if (!fs.existsSync(transactionsPath)) {
    throw new Error(`transaction_list.xls not found: ${transactionsPath}`);
  }

  const schoolId = await resolveSchoolId();
  const ledgerBefore = readSchoolLedger(schoolId);
  const historyBefore = readSchoolKidesysHistory(schoolId);

  console.log(`Transaction file: ${transactionsPath}`);
  console.log(`School ID: ${schoolId}`);
  console.log(`Mode: ${apply ? "APPLY (write history store)" : "DRY RUN"}`);
  console.log(`Ledger entries before: ${ledgerBefore.length}`);
  console.log(`History entries before: ${historyBefore.length}`);

  const report = await importDaSilvaTransactionHistory({
    schoolId,
    transactionsPath,
    dryRun: !apply,
  });

  printReport(report);

  const outJson = path.join(process.cwd(), "kidesys-transaction-history-phase5-report.json");
  const outTxt = path.join(process.cwd(), "kidesys-transaction-history-phase5-report.txt");
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(
    outTxt,
    [
      `Phase 5 Kid-e-Sys transaction history — ${report.dryRun ? "DRY RUN" : "APPLIED"}`,
      `Passed: ${report.passed}`,
      `Rows: ${report.parsedRowCount}`,
      `Net outstanding: R${report.netOutstanding}`,
      `Overpaid: R${report.overPaid}`,
      ...report.errors.map((e) => `ERROR: ${e}`),
    ].join("\n"),
    "utf8"
  );
  console.log(`\nWrote ${outJson}`);
  console.log(`Wrote ${outTxt}`);

  if (apply && report.passed) {
    console.log(`\nHistory store updated: ${readSchoolKidesysHistory(schoolId).length} rows`);
  } else if (apply && !report.passed) {
    console.log("\nApply aborted — validation failed; history store not updated.");
  } else if (!apply && report.passed) {
    console.log("\nDry-run passed. Re-run with --apply to write kidesys-transaction-history.json.");
  }

  process.exit(report.passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
