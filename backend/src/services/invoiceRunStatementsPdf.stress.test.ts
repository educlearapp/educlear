/**
 * Combined statement PDF stress + Da Silva ledger reconciliation (read-only).
 * Does not email, mutate the ledger, or touch production.
 *
 * Run: npx tsx src/services/invoiceRunStatementsPdf.stress.test.ts
 */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { PDFDocument as PdfLibDocument } from "pdf-lib";

import { generateStatementPdfBuffer } from "./statementPdfService";
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

async function mergeStatementBuffers(buffers: Buffer[]): Promise<{
  buffer: Buffer;
  pageCount: number;
  firstPageByStatement: number[];
}> {
  const merged = await PdfLibDocument.create();
  const firstPageByStatement: number[] = [];
  for (const pdf of buffers) {
    assert.ok(pdf.length >= 8, "empty donor PDF");
    assert.equal(pdf.subarray(0, 4).toString("latin1"), "%PDF");
    firstPageByStatement.push(merged.getPageCount());
    const donor = await PdfLibDocument.load(pdf);
    const pages = await merged.copyPages(donor, donor.getPageIndices());
    assert.ok(pages.length >= 1, "each statement must contribute >=1 page");
    for (const page of pages) merged.addPage(page);
  }
  const buffer = Buffer.from(await merged.save());
  assert.equal(buffer.subarray(0, 4).toString("latin1"), "%PDF");
  return { buffer, pageCount: merged.getPageCount(), firstPageByStatement };
}

async function runBatch(label: string, count: number) {
  global.gc?.();
  const heapStart = peakHeapMb();
  const t0 = performance.now();
  const accountNos: string[] = [];
  const buffers: Buffer[] = [];
  for (let i = 0; i < count; i += 1) {
    const accountNo = `ST${String(i + 1).padStart(4, "0")}`;
    accountNos.push(accountNo);
    buffers.push(await generateStatementPdfBuffer(syntheticInput(i + 1, accountNo)));
  }
  const genMs = performance.now() - t0;
  const heapAfterGen = peakHeapMb();

  const t1 = performance.now();
  const merged = await mergeStatementBuffers(buffers);
  const mergeMs = performance.now() - t1;
  const heapAfterMerge = peakHeapMb();

  // Uniqueness + order
  assert.equal(new Set(accountNos).size, count);
  assert.equal(merged.firstPageByStatement.length, count);
  assert.equal(merged.firstPageByStatement[0], 0);
  for (let i = 1; i < count; i += 1) {
    assert.ok(
      merged.firstPageByStatement[i] > merged.firstPageByStatement[i - 1],
      `${label}: statement ${i} must start on a new page`
    );
  }
  assert.ok(merged.pageCount >= count, `${label}: pageCount >= statement count`);
  assert.ok(merged.buffer.length > 1000);

  const peak = Math.max(heapStart, heapAfterGen, heapAfterMerge);
  console.log(
    JSON.stringify(
      {
        label,
        count,
        genMs: Math.round(genMs),
        mergeMs: Math.round(mergeMs),
        totalMs: Math.round(genMs + mergeMs),
        pdfBytes: merged.buffer.length,
        pageCount: merged.pageCount,
        heapStartMb: heapStart,
        heapAfterGenMb: heapAfterGen,
        heapAfterMergeMb: heapAfterMerge,
        peakHeapMb: peak,
      },
      null,
      2
    )
  );
  return { totalMs: genMs + mergeMs, peakHeapMb: peak, pdfBytes: merged.buffer.length };
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
  const batch340 = await runBatch("stress-340", 340);
  const batch500 = await runBatch("stress-500", 500);

  // Sync HTTP guidance threshold (no infra added): flag when wall time suggests proxy risk.
  const syncUnsuitable = batch340.totalMs > 45000 || batch500.totalMs > 60000;
  console.log(
    JSON.stringify(
      {
        label: "sync-suitability",
        syncUnsuitable,
        reason: syncUnsuitable
          ? "Combined generation exceeded safe synchronous window; prefer async job + download once complete (in-memory job map / temp file, no new DB)."
          : "Synthetic PDF path completed within a synchronous-friendly window; production still includes Prisma/ledger load per account — re-measure on staging before enable.",
        batch340Ms: Math.round(batch340.totalMs),
        batch500Ms: Math.round(batch500.totalMs),
        batch340PeakMb: batch340.peakHeapMb,
        batch500PeakMb: batch500.peakHeapMb,
      },
      null,
      2
    )
  );

  console.log("invoiceRunStatementsPdf.stress.test.ts: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
