/**
 * Read-only: export EduClear payments for reconciliation against Kid-e-Sys.
 * Usage: npx ts-node scripts/educlear-payments-reconciliation-export.ts [schoolId] [fromDate] [toDate]
 *
 * DO NOT modify billing data.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import { buildPaymentReconciliationExport } from "../src/services/billingTransactionExport";
import { calendarIsoToday } from "../src/utils/billingReportDateRange";

const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const DEFAULT_FROM = "2026-06-01";

function csvEscape(value: string | number): string {
  const raw = String(value ?? "");
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

function formatMoney(amount: number): string {
  return amount.toFixed(2);
}

async function main() {
  const schoolId = process.argv[2]?.trim() || DA_SILVA_SCHOOL_ID;
  const fromDate = process.argv[3]?.trim() || DEFAULT_FROM;
  const toDate = process.argv[4]?.trim() || calendarIsoToday();

  const result = await buildPaymentReconciliationExport(schoolId, fromDate, toDate);

  const headers = [
    "Account Number",
    "Account Holder",
    "Learner(s)",
    "Payment Date",
    "Amount",
    "Receipt / Reference Number",
    "Source",
    "Payment ID",
    "Created At",
  ];

  const lines = [
    headers.join(","),
    ...result.rows.map((row) =>
      [
        csvEscape(row.accountNo),
        csvEscape(row.accountHolder),
        csvEscape(row.learners),
        csvEscape(row.date),
        csvEscape(formatMoney(row.amount)),
        csvEscape(row.reference),
        csvEscape(row.source),
        csvEscape(row.id),
        csvEscape(row.createdAt),
      ].join(",")
    ),
  ];

  const outDir = path.join(process.cwd(), "storage");
  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, "educlear-payments-from-2026-06-01.csv");
  fs.writeFileSync(csvPath, lines.join("\n"), "utf8");

  const report = {
    schoolId,
    generatedAt: new Date().toISOString(),
    dateRange: { from: result.fromDate, to: result.toDate },
    totalPaymentCount: result.count,
    totalPaymentValue: result.totalAmount,
    csvPath,
  };

  console.log("=== EduClear payment reconciliation export (read-only) ===");
  console.log(`School:              ${schoolId}`);
  console.log(`Date range:          ${result.fromDate} to ${result.toDate}`);
  console.log(`Total payment count: ${result.count}`);
  console.log(`Total payment value: R${result.totalAmount.toFixed(2)}`);
  console.log(`CSV:                 ${csvPath}`);
  console.log(JSON.stringify(report, null, 2));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
