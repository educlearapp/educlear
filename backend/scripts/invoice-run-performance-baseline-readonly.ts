/**
 * Read-only Invoice Run performance baseline + integrity checksums.
 * Usage: npx tsx scripts/invoice-run-performance-baseline-readonly.ts
 */
import "dotenv/config";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { performance } from "perf_hooks";

import { prisma } from "../src/prisma";
import { executeInvoiceRun } from "../src/services/invoiceRunExecuteService";
import { invalidateOfficialBillingAccountRefsCache } from "../src/services/officialBillingAccountRef";
import {
  invalidateBillingLedgerFileCache,
  readSchoolLedger,
} from "../src/utils/billingLedgerStore";
import { invalidateFamilyAccountAgeAnalysisFileCache } from "../src/utils/familyAccountAgeAnalysisStore";

const API_BASE = String(process.env.API_BASE || "http://localhost:3000").trim();
const DA_SILVA_ID = "cmpideqeq0000108xb6ouv9zi";
const MBB_ID = "cmq4xjckq00at60gqg4eb956h";
const PREVIEW_PERIOD = "2027-03";
const OUT_DIR = path.join(process.cwd(), "storage", "invoice-run-performance");

function assertLocal() {
  const db = String(process.env.DATABASE_URL || "");
  if (!/localhost|127\.0\.0\.1/.test(db)) {
    throw new Error("ABORT — DATABASE_URL must be localhost");
  }
  const host = new URL(API_BASE).hostname.toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error("ABORT — API_BASE must be localhost");
  }
}

function sha256(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function stableLearnerChecksum(learners: unknown[]): string {
  const rows = (learners as Array<Record<string, unknown>>)
    .map((row) => ({
      learnerId: row.learnerId,
      learnerName: row.learnerName,
      accountNo: row.accountNo,
      status: row.status,
      amount: row.amount,
      skipReason: row.skipReason,
      billingGroupKey: row.billingGroupKey,
    }))
    .sort((a, b) => String(a.learnerId).localeCompare(String(b.learnerId)));
  return sha256(rows);
}

function stableInvoiceLineChecksum(invoices: unknown[] | undefined): string {
  const rows = (invoices || [])
    .map((entry) => {
      const e = entry as Record<string, unknown>;
      return {
        learnerId: e.learnerId,
        accountNo: e.accountNo,
        amount: e.amount,
        dueDate: e.dueDate,
        invoicePeriod: e.invoicePeriod,
        lineKey: e.lineKey,
      };
    })
    .sort((a, b) => String(a.learnerId).localeCompare(String(b.learnerId)));
  return sha256(rows);
}

function stableDueDateChecksum(invoices: unknown[] | undefined): string {
  const dueDates = (invoices || [])
    .map((entry) => String((entry as Record<string, unknown>).dueDate || ""))
    .sort();
  return sha256(dueDates);
}

function stableDuplicateWarningChecksum(learners: unknown[]): string {
  const dupes = (learners as Array<Record<string, unknown>>)
    .filter((row) => row.skipReason === "DUPLICATE_INVOICE")
    .map((row) => ({ learnerId: row.learnerId, skipDetail: row.skipDetail }))
    .sort((a, b) => String(a.learnerId).localeCompare(String(b.learnerId)));
  return sha256(dupes);
}

async function timeHttp(method: string, urlPath: string, body?: unknown) {
  const url = `${API_BASE}${urlPath}`;
  const t0 = performance.now();
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  const ms = performance.now() - t0;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { rawLength: text.length };
  }
  return {
    label: `${method} ${urlPath}`,
    ms,
    status: res.status,
    bytes: Buffer.byteLength(text, "utf8"),
    body: parsed,
  };
}

async function measurePageLoadEndpoints(schoolId: string) {
  const paths: Array<[string, string]> = [
    ["GET", `/api/invoices?schoolId=${schoolId}`],
    ["GET", `/api/payments?schoolId=${schoolId}`],
    ["GET", `/api/invoice-runs?schoolId=${schoolId}`],
    ["GET", `/api/statements?schoolId=${schoolId}`],
  ];
  const parallelStart = performance.now();
  const results = await Promise.all(paths.map(([m, p]) => timeHttp(m, p)));
  const parallelMs = performance.now() - parallelStart;
  const sequentialMs = results.reduce((sum, row) => sum + row.ms, 0);
  return {
    endpoints: results.map((row) => ({
      label: row.label,
      ms: +row.ms.toFixed(1),
      status: row.status,
      bytes: row.bytes,
      count: Array.isArray((row.body as { runs?: unknown[] })?.runs)
        ? (row.body as { runs: unknown[] }).runs.length
        : Array.isArray(row.body)
          ? row.body.length
          : Array.isArray((row.body as { entries?: unknown[] })?.entries)
            ? (row.body as { entries: unknown[] }).entries.length
            : null,
    })),
    parallelWallMs: +parallelMs.toFixed(1),
    sequentialSumMs: +sequentialMs.toFixed(1),
  };
}

async function measureColdWarmPreview(schoolId: string, label: string) {
  invalidateBillingLedgerFileCache();
  invalidateFamilyAccountAgeAnalysisFileCache();
  invalidateOfficialBillingAccountRefsCache(schoolId);

  const body = {
    schoolId,
    runId: `PERF-COLD-${label}-${Date.now()}`,
    invoicePeriod: PREVIEW_PERIOD,
    invoiceDate: `${PREVIEW_PERIOD}-01`,
    dryRun: true,
  };
  const cold = await timeHttp("POST", "/api/invoice-runs/preview", body);
  const warm = await timeHttp("POST", "/api/invoice-runs/preview", {
    ...body,
    runId: `PERF-WARM-${label}-${Date.now()}`,
  });
  const statements = await timeHttp("GET", `/api/statements?schoolId=${schoolId}`);
  const ledger = await timeHttp("GET", `/api/invoices/ledger?schoolId=${schoolId}`);
  return {
    coldPreviewMs: +cold.ms.toFixed(1),
    warmPreviewMs: +warm.ms.toFixed(1),
    statementsMs: +statements.ms.toFixed(1),
    statementsBytes: statements.bytes,
    ledgerMs: +ledger.ms.toFixed(1),
    ledgerBytes: ledger.bytes,
  };
}

async function measurePreviewHttp(schoolId: string, label: string) {
  const runId = `PERF-BASELINE-${label}-${Date.now()}`;
  const body = {
    schoolId,
    runId,
    invoicePeriod: PREVIEW_PERIOD,
    invoiceDate: `${PREVIEW_PERIOD}-01`,
    dryRun: true,
  };
  const http = await timeHttp("POST", "/api/invoice-runs/preview", body);
  return { http, runId };
}

async function measurePreviewDirect(schoolId: string, label: string) {
  const runId = `PERF-DIRECT-${label}-${Date.now()}`;
  const t0 = performance.now();
  const result = await executeInvoiceRun({
    schoolId,
    runId,
    invoicePeriod: PREVIEW_PERIOD,
    invoiceDate: `${PREVIEW_PERIOD}-01`,
    dryRun: true,
  });
  const ms = performance.now() - t0;
  return { ms: +ms.toFixed(1), result, runId };
}

function buildIntegrityMetrics(result: Awaited<ReturnType<typeof executeInvoiceRun>>) {
  const learners = result.learners || [];
  const invoiced = learners.filter((row) => row.status === "invoiced");
  const skipped = learners.filter((row) => row.status === "skipped");
  const totalAmount = invoiced.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  return {
    eligibleLearnerCount: result.integrity?.eligibleCount ?? 0,
    skippedCount: result.integrity?.skippedCount ?? skipped.length,
    totalInvoiceAmount: +totalAmount.toFixed(2),
    accountCount: (result.accounts || []).length,
    learnerResultChecksum: stableLearnerChecksum(learners),
    invoiceLineChecksum: stableInvoiceLineChecksum(result.invoices),
    dueDateChecksum: stableDueDateChecksum(result.invoices),
    duplicateWarningChecksum: stableDuplicateWarningChecksum(learners),
    integrityPassed: result.integrity?.passed === true,
    invoicedCount: invoiced.length,
  };
}

async function verifyNoWrites(beforeLedgerHash: string, schoolId: string) {
  const after = readSchoolLedger(schoolId);
  const afterHash = sha256(after);
  return {
    ledgerUnchanged: beforeLedgerHash === afterHash,
    ledgerEntryCount: after.length,
  };
}

async function measureSchool(schoolId: string, label: string) {
  const ledgerBefore = readSchoolLedger(schoolId);
  const ledgerHashBefore = sha256(ledgerBefore);

  const pageLoad = await measurePageLoadEndpoints(schoolId);
  const previewHttp = await measurePreviewHttp(schoolId, label);
  const previewDirect = await measurePreviewDirect(schoolId, `${label}-direct`);

  const httpBody = previewHttp.http.body as Awaited<ReturnType<typeof executeInvoiceRun>>;
  const integrityHttp = buildIntegrityMetrics(httpBody);
  const integrityDirect = buildIntegrityMetrics(previewDirect.result);
  const writeCheck = await verifyNoWrites(ledgerHashBefore, schoolId);

  return {
    schoolId,
    label,
    pageLoad,
    preview: {
      httpMs: +previewHttp.http.ms.toFixed(1),
      httpBytes: previewHttp.http.bytes,
      directMs: previewDirect.ms,
      httpIntegrity: integrityHttp,
      directIntegrity: integrityDirect,
      httpMatchesDirect:
        integrityHttp.learnerResultChecksum === integrityDirect.learnerResultChecksum &&
        integrityHttp.invoiceLineChecksum === integrityDirect.invoiceLineChecksum,
    },
    writeCheck,
    augustTestResidue: ledgerBefore.some(
      (e) =>
        e.type === "invoice" &&
        !e.undoneAt &&
        (String(e.invoicePeriod || "").includes("2026-08") ||
          String(e.description || "").toLowerCase().includes("test"))
    ),
  };
}

async function main() {
  assertLocal();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const ledgerFile = path.join(process.cwd(), "data", "billing-ledger.json");
  const ledgerMb = fs.existsSync(ledgerFile)
    ? +(fs.statSync(ledgerFile).size / 1024 / 1024).toFixed(2)
    : 0;

  console.log("=== Invoice Run Performance Baseline (READ-ONLY) ===\n");
  console.log(`API_BASE: ${API_BASE}`);
  console.log(`Ledger file: ${ledgerMb} MB\n`);

  const daSilvaColdWarm = await measureColdWarmPreview(DA_SILVA_ID, "da-silva");
  const daSilva = await measureSchool(DA_SILVA_ID, "da-silva");
  console.log("Da Silva page load (parallel wall):", daSilva.pageLoad.parallelWallMs, "ms");
  for (const ep of daSilva.pageLoad.endpoints) {
    console.log(`  ${ep.ms}ms ${ep.status} ${ep.bytes}B ${ep.label}`);
  }
  console.log(
    "Da Silva preview:",
    daSilva.preview.httpMs,
    "ms HTTP,",
    daSilva.preview.directMs,
    "ms direct"
  );
  console.log("Da Silva integrity:", daSilva.preview.httpIntegrity);
  console.log("Da Silva cold/warm:", daSilvaColdWarm);

  const mbbColdWarm = await measureColdWarmPreview(MBB_ID, "mbb");
  const mbb = await measureSchool(MBB_ID, "mbb");
  console.log("\nMBB page load (parallel wall):", mbb.pageLoad.parallelWallMs, "ms");
  for (const ep of mbb.pageLoad.endpoints) {
    console.log(`  ${ep.ms}ms ${ep.status} ${ep.bytes}B ${ep.label}`);
  }
  console.log(
    "MBB preview:",
    mbb.preview.httpMs,
    "ms HTTP,",
    mbb.preview.directMs,
    "ms direct"
  );
  console.log("MBB integrity:", mbb.preview.httpIntegrity);
  console.log("MBB cold/warm:", mbbColdWarm);

  const payload = {
    generatedAt: new Date().toISOString(),
    phase: process.env.PERF_PHASE || "baseline",
    ledgerFileMb: ledgerMb,
    daSilva: { ...daSilva, coldWarm: daSilvaColdWarm },
    mbb: { ...mbb, coldWarm: mbbColdWarm },
  };

  const phase = process.env.PERF_PHASE || "baseline";
  const outFile = path.join(OUT_DIR, `${phase}-2026-07-13.json`);
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), "utf8");

  const report = path.join(OUT_DIR, `${phase}-REPORT-2026-07-13.md`);
  fs.writeFileSync(
    report,
    `# Invoice Run Performance ${phase}\n\nGenerated: ${payload.generatedAt}\n\n## Da Silva\n- Page load parallel: ${daSilva.pageLoad.parallelWallMs}ms\n- Preview HTTP: ${daSilva.preview.httpMs}ms\n- Preview direct: ${daSilva.preview.directMs}ms\n- Learner checksum: ${daSilva.preview.httpIntegrity.learnerResultChecksum}\n\n## MBB\n- Page load parallel: ${mbb.pageLoad.parallelWallMs}ms\n- Preview HTTP: ${mbb.preview.httpMs}ms\n- Preview direct: ${mbb.preview.directMs}ms\n- Learner checksum: ${mbb.preview.httpIntegrity.learnerResultChecksum}\n`,
    "utf8"
  );

  console.log(`\nWrote ${outFile}`);
  console.log(`Wrote ${report}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
