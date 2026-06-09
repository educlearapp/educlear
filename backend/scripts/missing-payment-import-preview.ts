/**
 * Read-only: preview import of Kid-e-Sys payments missing from EduClear.
 *
 * Usage:
 *   npx ts-node scripts/missing-payment-import-preview.ts [schoolId]
 *
 * Outputs:
 *   backend/storage/missing-payment-import-preview.csv
 *
 * DO NOT import payments.
 * DO NOT modify billing data.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import {
  buildAccountsFromAgeAnalysisSnapshots,
  roundStatementMoney,
} from "../src/services/statementAccounts";
import { parseKideesysSpreadsheetFile } from "../src/utils/kideesysSpreadsheet";

const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";

type MissingPayment = {
  accountNo: string;
  date: string;
  amount: number;
  amountCents: number;
  reference: string;
  description: string;
  sourceLine: string;
};

function csvEscape(value: string | number): string {
  const raw = String(value ?? "");
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

function parseCsvFile(filePath: string): { headers: string[]; rows: string[][] } {
  const raw = fs.readFileSync(filePath, "utf8");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
      continue;
    }
    if (ch !== "\r") cell += ch;
  }
  row.push(cell);
  rows.push(row);

  const headers = (rows.shift() || []).map((h) => String(h || "").trim());
  return { headers, rows };
}

function moneyCents(value: string): number {
  const n = Number(String(value || "").replace(/,/g, "").trim());
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.abs(n) * 100);
}

function formatMoney(amount: number): string {
  return roundStatementMoney(amount).toFixed(2);
}

function loadMissingFromDiff(diffPath: string): MissingPayment[] {
  const { headers, rows } = parseCsvFile(diffPath);
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

  return rows
    .filter((r) => r[idx.Issue] === "KIDE_MISSING_IN_EDU")
    .map((r) => {
      const amount = roundStatementMoney(Number(r[idx.Amount] || 0));
      return {
        accountNo: String(r[idx["Account Number"]] || "").trim().toUpperCase(),
        date: String(r[idx["Payment Date"]] || "").trim(),
        amount,
        amountCents: moneyCents(r[idx.Amount]),
        reference: String(r[idx["Reference / Receipt Number"]] || "").trim(),
        description: "",
        sourceLine: String(r[idx["Source Line"]] || "").trim(),
      };
    });
}

function parseKidEsysReportPaymentRows(matrix: string[][]): Map<string, string> {
  const sectionIdx = matrix.findIndex(
    (r) => String(r?.[0] ?? "").trim().toLowerCase() === "payment"
  );
  const descriptions = new Map<string, string>();
  if (sectionIdx === -1) return descriptions;

  for (let i = sectionIdx + 1; i < matrix.length; i++) {
    const cells = matrix[i] || [];
    const first = String(cells[0] ?? "").trim();
    const second = String(cells[1] ?? "").trim();

    if (
      first &&
      !/^\d+$/.test(first) &&
      /to/i.test(first) &&
      cells.slice(1).every((c) => !String(c ?? "").trim())
    ) {
      continue;
    }
    if (cells.every((c) => !String(c ?? "").trim())) continue;

    const sectionTitle = first.toLowerCase();
    const looksLikeSectionHeader =
      ["invoice", "payment", "credit_note", "credit note", "debit_note", "debit note"].includes(
        sectionTitle
      ) && cells.slice(1).every((c) => !String(c ?? "").trim());
    if (looksLikeSectionHeader) break;

    if (!/^\d+$/.test(first)) continue;
    if (/total/i.test(second)) continue;

    const accountNo = String(cells[3] ?? "").trim().toUpperCase();
    const date = String(cells[2] ?? "")
      .replace(/\//g, "-")
      .slice(0, 10);
    const amount = formatMoney(Math.abs(Number(String(cells[6] ?? "").replace(/,/g, "")) || 0));
    const reference = second;
    const description = String(cells[4] ?? "").trim();
    const key = [accountNo, date, amount, reference].join("|");
    descriptions.set(key, description);
  }

  return descriptions;
}

async function main() {
  const schoolId = process.argv[2]?.trim() || DA_SILVA_SCHOOL_ID;
  const storageDir = path.join(process.cwd(), "storage");
  const diffPath = path.join(storageDir, "payment-reconciliation-diff.csv");
  const kidXlsxPath = path.join(storageDir, "kideesys-payments-from-2026-06-01.xlsx");

  if (!fs.existsSync(diffPath)) {
    throw new Error(`Diff CSV not found: ${diffPath}`);
  }

  let descriptionByKey = new Map<string, string>();
  if (fs.existsSync(kidXlsxPath)) {
    const sheet = parseKideesysSpreadsheetFile(kidXlsxPath);
    descriptionByKey = parseKidEsysReportPaymentRows(sheet.rows);
  }

  const missing = loadMissingFromDiff(diffPath).map((row) => {
    const key = [row.accountNo, row.date, formatMoney(row.amount), row.reference].join("|");
    const description = descriptionByKey.get(key) || "";
    return { ...row, description };
  });

  const accounts = await buildAccountsFromAgeAnalysisSnapshots(schoolId);
  const accountIndex = new Map(
    accounts.map((row) => [String(row.accountNo || "").trim().toUpperCase(), row])
  );

  const headers = [
    "Account Number",
    "Account Holder",
    "Learner(s)",
    "Payment Date",
    "Amount",
    "Reference Number",
    "Matching EduClear Account Exists",
    "Account Status",
    "Current Balance Before Payment",
    "Predicted Balance After Payment",
    "Import Readiness",
    "Notes",
  ];

  let readyCount = 0;
  let reviewCount = 0;
  let readyValue = 0;
  const accountsNotFound = new Set<string>();

  const lines = [headers.join(",")];

  for (const payment of missing.sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp) return dateCmp;
    return a.reference.localeCompare(b.reference);
  })) {
    const account = accountIndex.get(payment.accountNo);
    const accountExists = Boolean(account);
    const currentBalance = accountExists ? roundStatementMoney(account!.balance) : 0;
    const predictedBalance = accountExists
      ? roundStatementMoney(currentBalance - payment.amount)
      : 0;

    const accountHolder = accountExists
      ? String(account!.accountHolder || account!.familyName || "—").trim() || "—"
      : payment.description || "—";

    const learners = accountExists
      ? Array.isArray(account!.memberNames) && account!.memberNames.length
        ? account!.memberNames.join(" · ")
        : `${account!.name || ""} ${account!.surname || ""}`.trim() || payment.description || "—"
      : payment.description || "—";

    const status = accountExists ? String(account!.status || "—") : "—";
    const readiness = accountExists ? "Ready" : "Manual Review";
    const notes = accountExists
      ? ""
      : "EduClear account not found in age-analysis statement accounts";

    if (accountExists) {
      readyCount++;
      readyValue += payment.amount;
    } else {
      reviewCount++;
      accountsNotFound.add(payment.accountNo);
    }

    lines.push(
      [
        csvEscape(payment.accountNo),
        csvEscape(accountHolder),
        csvEscape(learners),
        csvEscape(payment.date),
        csvEscape(formatMoney(payment.amount)),
        csvEscape(payment.reference),
        csvEscape(accountExists ? "Yes" : "No"),
        csvEscape(status),
        csvEscape(accountExists ? formatMoney(currentBalance) : ""),
        csvEscape(accountExists ? formatMoney(predictedBalance) : ""),
        csvEscape(readiness),
        csvEscape(notes),
      ].join(",")
    );
  }

  const outPath = path.join(storageDir, "missing-payment-import-preview.csv");
  fs.mkdirSync(storageDir, { recursive: true });
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");

  const summary = {
    schoolId,
    generatedAt: new Date().toISOString(),
    totalMissingPayments: missing.length,
    totalMissingValue: roundStatementMoney(missing.reduce((s, p) => s + p.amount, 0)),
    paymentsReadyToImport: readyCount,
    paymentsRequiringManualReview: reviewCount,
    totalValueReadyToImport: roundStatementMoney(readyValue),
    accountsNotFound: accountsNotFound.size,
    accountsNotFoundList: [...accountsNotFound].sort(),
    outputCsv: outPath,
  };

  console.log("=== Missing payment import preview (read-only) ===");
  console.log(`School:                         ${schoolId}`);
  console.log(`Total missing payments:         ${summary.totalMissingPayments}`);
  console.log(`Total missing value:            R${summary.totalMissingValue.toFixed(2)}`);
  console.log(`Payments ready to import:        ${summary.paymentsReadyToImport}`);
  console.log(`Payments requiring manual review:${summary.paymentsRequiringManualReview}`);
  console.log(`Total value ready to import:    R${summary.totalValueReadyToImport.toFixed(2)}`);
  console.log(`Accounts not found:             ${summary.accountsNotFound}`);
  if (summary.accountsNotFoundList.length) {
    console.log(`Accounts not found list:        ${summary.accountsNotFoundList.join(", ")}`);
  }
  console.log(`Preview CSV:                    ${outPath}`);
  console.log(JSON.stringify(summary, null, 2));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
