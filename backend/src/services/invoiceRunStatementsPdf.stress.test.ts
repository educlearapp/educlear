/**
 * Combined statement PDF stress + Da Silva ledger reconciliation (read-only).
 * Does not email, mutate the ledger, or touch production.
 *
 * Run: npx tsx src/services/invoiceRunStatementsPdf.stress.test.ts
 */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import fs from "fs";

import { generateCombinedStatementsPdfBuffer } from "./statementPdfService";
import type { StatementPdfInput } from "./statementPdfTypes";
import { getInvoiceRunDetailFromLedger } from "./invoiceRunListService";
import {
  collectAccountRefLedgerEntries,
  readSchoolLedger,
} from "../utils/billingLedgerStore";
import {
  computeStatementClosingBalance,
  computeStatementOpeningBalance,
  filterLedgerByStatementPeriod,
} from "../utils/statementPeriod";
import { shouldShowLedgerEntryOnStatement } from "../utils/billingDisplayRules";
import { normaliseAmount } from "../utils/billingLedgerStore";
import { isKidesysOpeningBalanceEntry } from "../utils/billingDisplayRules";
import { shouldShowOpeningBalanceMigration } from "../utils/statementPeriod";

const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
/** Local sanitised ledger replica — production-like volume (≥340 unique families). */
const DA_SILVA_LARGE_RUN = "legacy:2026-04:2026-04-15:invoice";

function peakHeapMb(): number {
  return Math.round((process.memoryUsage().heapUsed / (1024 * 1024)) * 10) / 10;
}

function syntheticInput(index: number, accountNo: string): StatementPdfInput {
  return {
    school: { name: "Stress Test Academy", email: "billing@example.test" },
    accountNo,
    accountLabel: `Family Account ${accountNo}`,
    children: [
      { name: `Learner ${index}A`, grade: "Grade 3" },
      { name: `Learner ${index}B`, grade: "Grade 5" },
    ],
    contact: {
      name: `Parent ${index}`,
      email: `parent${index}@example.test`,
      relationship: "Mother",
      accountNo,
    },
    period: "Last 3 Months (10 Aug 2026 – 10 Nov 2026)",
    statementDate: "10/11/2026",
    balance: 1000 + (index % 50) * 10,
    transactions: [
      {
        date: "2026-09-01",
        type: "Invoice",
        reference: `INV-${index}`,
        description: "Tuition",
        amountIn: 1200,
        amountOut: 0,
        balance: 1200,
      },
      {
        date: "2026-10-01",
        type: "Payment",
        reference: `PAY-${index}`,
        description: "EFT",
        amountIn: 0,
        amountOut: 200,
        balance: 1000,
      },
    ],
    isFamilyAccount: true,
  };
}

async function runBatch(label: string, count: number, logoBuffer: Buffer | null) {
  global.gc?.();
  const heapStart = peakHeapMb();
  const t0 = performance.now();
  const accountNos: string[] = [];
  const inputs: StatementPdfInput[] = [];
  for (let i = 0; i < count; i += 1) {
    const accountNo = `ST${String(i + 1).padStart(4, "0")}`;
    accountNos.push(accountNo);
    inputs.push(syntheticInput(i + 1, accountNo));
  }
  const combined = await generateCombinedStatementsPdfBuffer(inputs, { logoBuffer });
  const totalMs = performance.now() - t0;
  const heapAfter = peakHeapMb();

  assert.equal(new Set(accountNos).size, count);
  assert.equal(combined.statementCount, count);
  assert.equal(combined.firstPageIndexByStatement.length, count);
  assert.equal(combined.firstPageIndexByStatement[0], 0);
  for (let i = 1; i < count; i += 1) {
    assert.ok(
      combined.firstPageIndexByStatement[i] > combined.firstPageIndexByStatement[i - 1],
      `${label}: statement ${i} must start on a new page`
    );
  }
  assert.ok(combined.pageCount >= count, `${label}: pageCount >= statement count`);
  assert.ok(combined.buffer.length > 1000);
  assert.equal(combined.buffer.subarray(0, 4).toString("latin1"), "%PDF");

  console.log(
    JSON.stringify(
      {
        label,
        count,
        totalMs: Math.round(totalMs),
        pdfBytes: combined.buffer.length,
        pdfMb: Math.round((combined.buffer.length / (1024 * 1024)) * 100) / 100,
        pageCount: combined.pageCount,
        heapStartMb: heapStart,
        heapAfterMb: heapAfter,
        peakHeapMb: Math.max(heapStart, heapAfter),
      },
      null,
      2
    )
  );
  return { totalMs, peakHeapMb: Math.max(heapStart, heapAfter), pdfBytes: combined.buffer.length };
}

function reconcileDaSilvaFamilyStatements() {
  const detail = getInvoiceRunDetailFromLedger(DA_SILVA_SCHOOL_ID, DA_SILVA_LARGE_RUN);
  assert.ok(detail, "Da Silva large invoice run detail missing from local ledger");
  assert.ok(
    detail!.uniqueFamilyAccountCount >= 340,
    `expected ≥340 unique families, got ${detail!.uniqueFamilyAccountCount}`
  );
  assert.equal(detail!.familyAccounts.length, detail!.uniqueFamilyAccountCount);

  const ledger = readSchoolLedger(DA_SILVA_SCHOOL_ID);
  const period = "Last 3 Months";
  let checked = 0;
  let maxAbsClosing = 0;
  const seen = new Set<string>();

  for (const family of detail!.familyAccounts) {
    const accountNo = String(family.accountNo || "").trim();
    assert.ok(accountNo, "family account missing accountNo");
    assert.equal(seen.has(accountNo), false, `duplicate family account ${accountNo}`);
    seen.add(accountNo);

    const scoped = collectAccountRefLedgerEntries(ledger, accountNo);
    const opening = computeStatementOpeningBalance(scoped, period);
    const closing = computeStatementClosingBalance(scoped, period);
    const filtered = filterLedgerByStatementPeriod(scoped, period);
    let net = 0;
    for (const row of filtered) {
      if (!shouldShowLedgerEntryOnStatement(row, false)) continue;
      if (!shouldShowOpeningBalanceMigration(period, row) && isKidesysOpeningBalanceEntry(row)) {
        continue;
      }
      const amount = normaliseAmount(row.amount);
      const isDebit = row.type === "invoice" || row.type === "penalty";
      net += isDebit ? amount : -amount;
    }
    assert.equal(normaliseAmount(opening + net), closing, `identity failed for ${accountNo}`);
    maxAbsClosing = Math.max(maxAbsClosing, Math.abs(closing));
    checked += 1;
  }

  assert.ok(checked >= 340);
  console.log(
    JSON.stringify(
      {
        label: "da-silva-family-reconciliation",
        runId: DA_SILVA_LARGE_RUN,
        uniqueFamilies: checked,
        period,
        maxAbsClosing,
        invoiceLines: detail!.totalInvoices,
      },
      null,
      2
    )
  );
}

async function main() {
  reconcileDaSilvaFamilyStatements();
  const logoPath = "uploads/school-logos/da-silva-academy-logo.png";
  const logoBuffer = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;

  await runBatch("stress-1", 1, logoBuffer);
  await runBatch("stress-3", 3, logoBuffer);
  const batch340 = await runBatch("stress-340", 340, logoBuffer);
  const batch500 = await runBatch("stress-500", 500, logoBuffer);

  // Single-pass should stay well under former sync-proxy risk thresholds.
  assert.ok(batch340.totalMs < 10000, `340-family render exceeded 10s: ${batch340.totalMs}ms`);
  assert.ok(batch500.totalMs < 15000, `500-family render exceeded 15s: ${batch500.totalMs}ms`);
  assert.ok(
    batch340.pdfBytes < 10 * 1024 * 1024,
    `340-family PDF exceeded 10MB: ${batch340.pdfBytes}`
  );

  console.log(
    JSON.stringify(
      {
        label: "stress-summary",
        batch340Ms: Math.round(batch340.totalMs),
        batch500Ms: Math.round(batch500.totalMs),
        batch340Mb: Math.round((batch340.pdfBytes / (1024 * 1024)) * 100) / 100,
        batch500Mb: Math.round((batch500.pdfBytes / (1024 * 1024)) * 100) / 100,
        pass: true,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
