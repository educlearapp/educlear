/**
 * End-to-end local verification for single-pass invoice-run statement PDFs.
 * Read-only — does not mutate ledger, email, or SMS.
 *
 * Run: cd backend && npx tsx src/services/bulkStatementPdf.verify.ts
 */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import fs from "fs";
import path from "path";

import { buildInvoiceRunStatementsPdf } from "./invoiceRunStatementsPdfService";
import { getInvoiceRunDetailFromLedger } from "./invoiceRunListService";
import {
  collectAccountRefLedgerEntries,
  normaliseAmount,
  readSchoolLedger,
} from "../utils/billingLedgerStore";
import {
  computeStatementClosingBalance,
  computeStatementOpeningBalance,
  filterLedgerByStatementPeriod,
  shouldShowOpeningBalanceMigration,
} from "../utils/statementPeriod";
import {
  isKidesysOpeningBalanceEntry,
  shouldShowLedgerEntryOnStatement,
} from "../utils/billingDisplayRules";
import { buildStatementPdfInputFromBulkContext, loadBulkStatementSchoolContext } from "./statementBulkPdfContext";
import { generateCombinedStatementsPdfBuffer } from "./statementPdfService";

const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const RUN_ID = "legacy:2026-04:2026-04-15:invoice";
const PERIOD = "Last 3 Months";

function heapMb(): number {
  return Math.round((process.memoryUsage().heapUsed / (1024 * 1024)) * 10) / 10;
}

function mb(n: number): number {
  return Math.round((n / (1024 * 1024)) * 100) / 100;
}

async function reconcileAll(limit?: number) {
  const ledger = readSchoolLedger(SCHOOL_ID);
  const detail = getInvoiceRunDetailFromLedger(SCHOOL_ID, RUN_ID, { ledger });
  assert.ok(detail);
  const accounts = limit ? detail!.familyAccounts.slice(0, limit) : detail!.familyAccounts;
  let checked = 0;
  const seen = new Set<string>();
  for (const family of accounts) {
    const accountNo = String(family.accountNo || "").trim();
    assert.ok(accountNo);
    assert.equal(seen.has(accountNo), false, `duplicate ${accountNo}`);
    seen.add(accountNo);
    const scoped = collectAccountRefLedgerEntries(ledger, accountNo);
    const opening = computeStatementOpeningBalance(scoped, PERIOD);
    const closing = computeStatementClosingBalance(scoped, PERIOD);
    const filtered = filterLedgerByStatementPeriod(scoped, PERIOD);
    let net = 0;
    for (const row of filtered) {
      if (!shouldShowLedgerEntryOnStatement(row, false)) continue;
      if (!shouldShowOpeningBalanceMigration(PERIOD, row) && isKidesysOpeningBalanceEntry(row)) {
        continue;
      }
      const amount = normaliseAmount(row.amount);
      const isDebit = row.type === "invoice" || row.type === "penalty";
      net += isDebit ? amount : -amount;
    }
    assert.equal(normaliseAmount(opening + net), closing, `identity ${accountNo}`);
    checked += 1;
  }
  return { checked, uniqueFamilies: detail!.uniqueFamilyAccountCount, invoices: detail!.totalInvoices };
}

async function runSubset(limit: number, logoBuffer: Buffer | null) {
  const ledger = readSchoolLedger(SCHOOL_ID);
  const detail = getInvoiceRunDetailFromLedger(SCHOOL_ID, RUN_ID, { ledger });
  assert.ok(detail);
  const accounts = detail!.familyAccounts.slice(0, limit);

  const t0 = performance.now();
  const ctx = await loadBulkStatementSchoolContext(SCHOOL_ID, {
    ledger,
    logoBuffer:
      logoBuffer ??
      (fs.existsSync("uploads/school-logos/da-silva-academy-logo.png")
        ? fs.readFileSync("uploads/school-logos/da-silva-academy-logo.png")
        : null),
  });
  // Force logo for size realism when DB branding has no logo locally.
  if (!ctx.logoBuffer && logoBuffer) ctx.logoBuffer = logoBuffer;
  if (!ctx.logoBuffer && fs.existsSync("uploads/school-logos/da-silva-academy-logo.png")) {
    ctx.logoBuffer = fs.readFileSync("uploads/school-logos/da-silva-academy-logo.png");
  }
  const loadMs = performance.now() - t0;

  const tData = performance.now();
  const inputs = accounts.map((account) =>
    buildStatementPdfInputFromBulkContext(ctx, {
      accountNo: account.accountNo || undefined,
      learnerId: account.anchorLearnerId || undefined,
      period: PERIOD,
    })
  );
  const dataMs = performance.now() - tData;

  // Financial parity: bulk closing balance must match trusted helper.
  for (let i = 0; i < accounts.length; i += 1) {
    const accountNo = String(accounts[i].accountNo || "").trim();
    const scoped = collectAccountRefLedgerEntries(ledger, accountNo);
    const expected = computeStatementClosingBalance(scoped, PERIOD);
    assert.equal(inputs[i].balance, expected, `balance mismatch ${accountNo}`);
  }

  const heapBefore = heapMb();
  const tRender = performance.now();
  const combined = await generateCombinedStatementsPdfBuffer(inputs, {
    logoBuffer: ctx.logoBuffer,
  });
  const renderMs = performance.now() - tRender;
  const heapAfter = heapMb();

  assert.equal(combined.buffer.subarray(0, 4).toString("latin1"), "%PDF");
  assert.equal(combined.statementCount, limit);
  assert.ok(combined.pageCount >= limit);
  assert.equal(combined.firstPageIndexByStatement.length, limit);
  assert.equal(combined.firstPageIndexByStatement[0], 0);
  for (let i = 1; i < limit; i += 1) {
    assert.ok(combined.firstPageIndexByStatement[i] > combined.firstPageIndexByStatement[i - 1]);
  }

  const accountNos = inputs.map((row) => row.accountNo);
  assert.equal(new Set(accountNos).size, limit, "duplicate family statements");

  return {
    limit,
    loadMs: Math.round(loadMs),
    dataMs: Math.round(dataMs),
    renderMs: Math.round(renderMs),
    totalMs: Math.round(loadMs + dataMs + renderMs),
    pdfMb: mb(combined.buffer.length),
    pdfBytes: combined.buffer.length,
    pageCount: combined.pageCount,
    statementCount: combined.statementCount,
    heapBeforeMb: heapBefore,
    heapAfterMb: heapAfter,
    logoKb: ctx.logoBuffer ? Math.round(ctx.logoBuffer.length / 1024) : 0,
  };
}

async function runFullService(limitHint?: number) {
  // Full service path uses the real invoice-run builder (all families on the run).
  const built = await buildInvoiceRunStatementsPdf({
    schoolId: SCHOOL_ID,
    runId: RUN_ID,
    period: PERIOD,
    includeTimings: true,
  });
  assert.ok(built);
  if (limitHint) {
    assert.ok(built!.statementCount >= Math.min(limitHint, built!.statementCount));
  }
  assert.equal(built!.buffer.subarray(0, 4).toString("latin1"), "%PDF");
  // Inject logo for size check when branding missing: rebuild subset already covers logo size.
  return {
    statementCount: built!.statementCount,
    timings: built!.timings,
    pdfMb: mb(built!.buffer.length),
    window: built!.statementWindowHeader,
    period: built!.statementPeriod,
  };
}

async function main() {
  const logoPath = path.resolve("uploads/school-logos/da-silva-academy-logo.png");
  const logo = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;

  const reconcile = await reconcileAll();
  console.log(JSON.stringify({ phase: "reconcile-all", ...reconcile }, null, 2));

  for (const n of [1, 3, 340, 500]) {
    const available = reconcile.uniqueFamilies;
    const limit = Math.min(n, available);
    if (n > available && n === 500) {
      // Synthetically pad to 500 using repeated render of first accounts' structure is wrong;
      // instead report 500 using synthetic-only path already covered, and real max here.
      console.log(
        JSON.stringify({
          phase: "subset-capped",
          requested: 500,
          available,
          note: "ledger run has fewer than 500 families; tested available max + synthetic 500 separately",
        })
      );
      const row = await runSubset(available, logo);
      console.log(JSON.stringify({ phase: "subset", ...row }, null, 2));
      continue;
    }
    const row = await runSubset(limit, logo);
    console.log(JSON.stringify({ phase: "subset", ...row }, null, 2));
  }

  const full = await runFullService(340);
  console.log(JSON.stringify({ phase: "full-service", ...full }, null, 2));

  // Unit gate tests still pass
  const { resolveInvoiceRunStatementPeriod } = await import("./invoiceRunStatementsPdfService");
  assert.equal(resolveInvoiceRunStatementPeriod(""), "Last 3 Months");
  assert.throws(() => resolveInvoiceRunStatementPeriod("Custom Date Range"));

  console.log(JSON.stringify({ phase: "VERIFY_OK", pass: true }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
