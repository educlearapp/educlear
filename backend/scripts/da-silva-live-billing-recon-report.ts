/**
 * Read-only: Da Silva account-level billing reconciliation report.
 * Usage: npx ts-node scripts/da-silva-live-billing-recon-report.ts [schoolId]
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import {
  buildAccountsFromAgeAnalysisSnapshots,
  filterPostImportBalanceEntries,
  roundStatementMoney,
} from "../src/services/statementAccounts";
import {
  calculateBalanceFromEntries,
  readSchoolLedger,
} from "../src/utils/billingLedgerStore";
import { readSchoolFamilyAccountAgeAnalysisSnapshots } from "../src/utils/familyAccountAgeAnalysisStore";

const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function main() {
  const schoolId = process.argv[2]?.trim() || DA_SILVA_SCHOOL_ID;
  const ledger = readSchoolLedger(schoolId);
  const snapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId);
  const accounts = await buildAccountsFromAgeAnalysisSnapshots(schoolId, { ledger });

  const rows = accounts.map((row) => {
    const accountNo = String(row.accountNo || "").trim().toUpperCase();
    const snap = snapshots[accountNo];
    const kidesysBaseline = roundStatementMoney(snap?.balance ?? 0);
    const liveBalance = roundStatementMoney(row.balance);
    const difference = roundStatementMoney(liveBalance - kidesysBaseline);

    const accountEntries = ledger.filter(
      (e) => String(e.accountNo || "").trim().toUpperCase() === accountNo
    );
    const importedAt = String(snap?.importedAt || "").trim();
    const postImportEntries = filterPostImportBalanceEntries(accountEntries, importedAt);
    const postImportDelta = roundStatementMoney(calculateBalanceFromEntries(postImportEntries));

    const postImportInvoices = postImportEntries.filter((e) => e.type === "invoice").length;
    const postImportPayments = postImportEntries.filter((e) => e.type === "payment").length;
    const postImportCredits = postImportEntries.filter((e) => e.type === "credit").length;

    const learnersLinked =
      row.memberNames?.length > 0
        ? row.memberNames.join(" · ")
        : [row.name, row.surname].filter((p) => p && p !== "-").join(" ") || "—";

    return {
      accountNo,
      accountHolder: String(row.accountHolder || row.familyName || snap?.accountHolder || "—").trim(),
      learnersLinked,
      kidesysAgeAnalysisBalance: kidesysBaseline,
      eduClearLiveBalance: liveBalance,
      difference,
      absDifference: Math.abs(difference),
      kidesysSection: String(row.kidesysSection || snap?.kidesysSection || "—").trim(),
      eduClearStatus: String(row.status || "—").trim(),
      postImportLedgerDelta: postImportDelta,
      postImportInvoiceCount: postImportInvoices,
      postImportPaymentCount: postImportPayments,
      postImportCreditCount: postImportCredits,
      hasPostImportActivity: postImportEntries.length > 0,
    };
  });

  rows.sort((a, b) => b.absDifference - a.absDifference || a.accountNo.localeCompare(b.accountNo));

  const totalKidesysBaseline = round2(
    rows.reduce((s, r) => s + r.kidesysAgeAnalysisBalance, 0)
  );
  const totalEduClearLive = round2(rows.reduce((s, r) => s + r.eduClearLiveBalance, 0));
  const totalDifference = round2(rows.reduce((s, r) => s + r.difference, 0));

  const sumByStatus = (status: string) =>
    round2(
      rows
        .filter((r) => r.eduClearStatus === status)
        .reduce((s, r) => s + r.eduClearLiveBalance, 0)
    );

  const accountsWithDifference = rows.filter((r) => Math.abs(r.difference) > 0.01);
  const accountsWithPostImport = rows.filter((r) => r.hasPostImportActivity);

  const report = {
    schoolId,
    generatedAt: new Date().toISOString(),
    accountCount: rows.length,
    accountsWithNonZeroDifference: accountsWithDifference.length,
    accountsWithPostImportActivity: accountsWithPostImport.length,
    totals: {
      totalKidesysBaselineBalance: totalKidesysBaseline,
      totalEduClearLiveBalance: totalEduClearLive,
      totalDifference,
      totalOverPaid: sumByStatus("Over Paid"),
      totalRecentlyOwing: sumByStatus("Recently Owing"),
      totalBadDebt: sumByStatus("Bad Debt"),
    },
    accounts: rows,
    top20ByAbsDifference: rows.slice(0, 20),
  };

  const outDir = path.join(process.cwd(), "storage");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "da-silva-live-billing-recon-report.json");
  const txtPath = path.join(outDir, "da-silva-live-billing-recon-report.txt");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const lines = [
    "=== Da Silva live billing reconciliation (read-only) ===",
    `Generated: ${report.generatedAt}`,
    `School: ${schoolId}`,
    `Accounts: ${report.accountCount}`,
    `Accounts with |difference| > 0.01: ${report.accountsWithNonZeroDifference}`,
    `Accounts with post-import ledger activity: ${report.accountsWithPostImportActivity}`,
    "",
    "TOTALS",
    `  Kid-e-Sys baseline balance:  R${report.totals.totalKidesysBaselineBalance.toFixed(2)}`,
    `  EduClear live balance:         R${report.totals.totalEduClearLiveBalance.toFixed(2)}`,
    `  Total difference:              R${report.totals.totalDifference.toFixed(2)}`,
    `  Total Over Paid (live status): R${report.totals.totalOverPaid.toFixed(2)}`,
    `  Total Recently Owing:          R${report.totals.totalRecentlyOwing.toFixed(2)}`,
    `  Total Bad Debt:                R${report.totals.totalBadDebt.toFixed(2)}`,
    "",
    "TOP 30 BY |DIFFERENCE|",
    "account  | age bal   | live bal  | diff     | kidesys section  | edu status       | Δ ledger | inv | pay | cr | holder",
    "---------|-----------|-----------|----------|------------------|------------------|----------|-----|-----|----|------",
  ];

  for (const r of rows.slice(0, 30)) {
    lines.push(
      `${r.accountNo.padEnd(8)} | ${String(r.kidesysAgeAnalysisBalance).padStart(9)} | ${String(r.eduClearLiveBalance).padStart(9)} | ${String(r.difference).padStart(8)} | ${r.kidesysSection.padEnd(16)} | ${r.eduClearStatus.padEnd(16)} | ${String(r.postImportLedgerDelta).padStart(8)} | ${String(r.postImportInvoiceCount).padStart(3)} | ${String(r.postImportPaymentCount).padStart(3)} | ${String(r.postImportCreditCount).padStart(2)} | ${r.accountHolder.slice(0, 40)}`
    );
  }

  lines.push("", `Full JSON: ${jsonPath}`);
  fs.writeFileSync(txtPath, lines.join("\n"), "utf8");

  console.log(JSON.stringify({ jsonPath, txtPath, totals: report.totals, accountCount: report.accountCount, accountsWithNonZeroDifference: report.accountsWithNonZeroDifference }, null, 2));
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
