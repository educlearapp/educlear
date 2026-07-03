/**
 * ONE-OFF surgical production rollback — test invoice run 2026-07-03.
 *
 * Removes ONLY the 395 invoice ledger entries for:
 *   runId:      RUN-1783056354816
 *   date:       2026-07-03
 *   description: Invoice Run For August 2026
 *
 * Does NOT touch payments, credits, allocations, opening balances, Kid-e-Sys
 * history, PostgreSQL, billing plans, learners, or any other invoice runs.
 *
 * ─── Dry-run (safe from local machine — default) ───────────────────────────
 *   cd backend
 *   npx tsx scripts/rollback-production-test-invoice-run-2026-07-03.ts
 *
 * ─── Apply (ONLY on Render production host with live billing-ledger.json) ─
 *   CONFIRM_PRODUCTION_WRITE=true \
 *   npx tsx scripts/rollback-production-test-invoice-run-2026-07-03.ts \
 *     --apply --execute-on-production-host
 *
 * Env:
 *   API_BASE              — default https://educlear-backend.onrender.com
 *   CONFIRM_PRODUCTION_WRITE — must be "true" for --apply
 */
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

import {
  isKidesysBlockedBillingSource,
  isKidesysHistoryIdOrReference,
  isKidesysOpeningBalanceEntry,
  isNonPostingImportedLedgerEntry,
} from "../src/utils/billingDisplayRules";
import {
  readSchoolLedger,
  removeSchoolEntry,
  type BillingLedgerEntry,
} from "../src/utils/billingLedgerStore";

// ─── Immutable rollback scope (do not widen) ─────────────────────────────────

const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const TARGET_RUN_ID = "RUN-1783056354816";
const TARGET_DATE = "2026-07-03";
const TARGET_DESC = "Invoice Run For August 2026";
const EXPECTED_REMOVE_COUNT = 395;
const EXPECTED_ID_SHA256 =
  "52840ec2330975005457227e4732935edf40fd6de829bb0cabf4fa7492b3faa4";

/** Investigation baseline — abort apply if live counts drift (ledger changed since report). */
const EXPECTED_LEDGER_TOTAL_BEFORE = 42_388;
const EXPECTED_LEDGER_TOTAL_AFTER = 41_993;
const EXPECTED_OTHER_RUN_COUNTS: Record<string, number> = {
  "RUN-1781514127700": 326,
  "RUN-1779433196491": 4,
  "RUN-1778945904059": 4,
  "RUN-1778941102171": 4,
};

const CONFIRM_ENV = "CONFIRM_PRODUCTION_WRITE";
const API_BASE = String(process.env.API_BASE || "https://educlear-backend.onrender.com").replace(
  /\/$/,
  ""
);

const MANIFEST_PATH = path.join(
  process.cwd(),
  "storage",
  "live-2026-07-03-test-invoice-run-entry-ids.txt"
);

const APPLY = process.argv.includes("--apply");
const EXECUTE_ON_HOST = process.argv.includes("--execute-on-production-host");

// ─── Types ───────────────────────────────────────────────────────────────────

type LedgerApiResponse = {
  entries?: BillingLedgerEntry[];
  success?: boolean;
};

type VerificationReport = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifestIds: string[];
  manifestSha256: string;
  liveMatches: BillingLedgerEntry[];
  ledgerTotalBefore: number;
  otherRunCounts: Record<string, number>;
  allocationHits: number;
  paymentCreditHits: number;
  openingBalanceHits: number;
  kidesysHits: number;
  backupPath: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sha256Lines(lines: string[]): string {
  return createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
}

function loadManifest(): string[] {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Manifest not found: ${MANIFEST_PATH}`);
  }
  const ids = fs
    .readFileSync(MANIFEST_PATH, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) {
    throw new Error(`Manifest contains duplicate IDs (${ids.length} lines, ${unique.length} unique)`);
  }
  return unique.sort();
}

function isTargetInvoiceEntry(entry: BillingLedgerEntry): boolean {
  if (entry.type !== "invoice") return false;
  if (String(entry.date || "").slice(0, 10) !== TARGET_DATE) return false;
  if (String(entry.runId || "").trim() !== TARGET_RUN_ID) return false;
  if (!String(entry.reference || "").trim().startsWith("INV-")) return false;
  if (!String(entry.description || "").includes(TARGET_DESC)) return false;
  if (String(entry.schoolId || "").trim() && String(entry.schoolId).trim() !== SCHOOL_ID) {
    return false;
  }
  const expectedIdPrefix = `invoice-${TARGET_RUN_ID}-`;
  if (!String(entry.id || "").startsWith(expectedIdPrefix)) return false;
  return true;
}

function isProtectedFromRemoval(entry: BillingLedgerEntry): boolean {
  if (entry.type === "payment" || entry.type === "credit") return true;
  if (isKidesysOpeningBalanceEntry(entry)) return true;
  if (isKidesysBlockedBillingSource(entry.source)) return true;
  if (isKidesysHistoryIdOrReference(entry.id, entry.reference)) return true;
  if (isNonPostingImportedLedgerEntry(entry)) return true;
  return false;
}

async function fetchLiveLedger(): Promise<BillingLedgerEntry[]> {
  const url = `${API_BASE}/api/invoices/ledger?schoolId=${encodeURIComponent(SCHOOL_ID)}`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Live ledger fetch failed ${res.status}: ${text.slice(0, 400)}`);
  }
  let body: LedgerApiResponse;
  try {
    body = JSON.parse(text) as LedgerApiResponse;
  } catch {
    throw new Error("Live ledger response is not valid JSON");
  }
  const entries = Array.isArray(body.entries) ? body.entries : [];
  if (!entries.length) {
    throw new Error("Live ledger returned zero entries — aborting (possible API failure)");
  }
  return entries;
}

function saveProductionBackup(entries: BillingLedgerEntry[]): string {
  const outDir = path.join(process.cwd(), "storage");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(
    outDir,
    `billing-ledger-production-backup-${stamp()}-pre-rollback-2026-07-03-test-run.json`
  );
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        apiBase: API_BASE,
        schoolId: SCHOOL_ID,
        entryCount: entries.length,
        entries,
      },
      null,
      2
    ),
    "utf8"
  );
  return outPath;
}

function readAllPaymentAllocations(schoolId: string): Array<{
  paymentId: string;
  invoiceId: string | null;
  ledgerInvoiceId?: string;
}> {
  const allocPath = path.join(process.cwd(), "data", "payment-allocations.json");
  if (!fs.existsSync(allocPath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(allocPath, "utf8")) as Record<
      string,
      Record<string, Array<{ invoiceId?: string | null; ledgerInvoiceId?: string }>>
    >;
    const schoolBlock = parsed[schoolId];
    if (!schoolBlock || typeof schoolBlock !== "object") return [];
    const rows: Array<{ paymentId: string; invoiceId: string | null; ledgerInvoiceId?: string }> =
      [];
    for (const [paymentId, allocations] of Object.entries(schoolBlock)) {
      if (!Array.isArray(allocations)) continue;
      for (const row of allocations) {
        rows.push({
          paymentId,
          invoiceId: row.invoiceId ?? null,
          ledgerInvoiceId: row.ledgerInvoiceId,
        });
      }
    }
    return rows;
  } catch {
    return [];
  }
}

function countByRunId(entries: BillingLedgerEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    const runId = String(entry.runId || "").trim();
    if (!runId) continue;
    counts[runId] = (counts[runId] || 0) + 1;
  }
  return counts;
}

function verifyScope(entries: BillingLedgerEntry[], manifestIds: string[]): VerificationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const manifestSha256 = sha256Lines(manifestIds);
  if (manifestIds.length !== EXPECTED_REMOVE_COUNT) {
    errors.push(
      `Manifest count ${manifestIds.length} !== expected ${EXPECTED_REMOVE_COUNT}`
    );
  }
  if (manifestSha256 !== EXPECTED_ID_SHA256) {
    errors.push(
      `Manifest SHA-256 mismatch: got ${manifestSha256}, expected ${EXPECTED_ID_SHA256}`
    );
  }

  const liveMatches = entries.filter(isTargetInvoiceEntry);
  const liveIds = liveMatches.map((e) => e.id).sort();
  const liveSha256 = sha256Lines(liveIds);

  if (liveMatches.length !== EXPECTED_REMOVE_COUNT) {
    errors.push(
      `Live ledger target rows ${liveMatches.length} !== expected ${EXPECTED_REMOVE_COUNT}`
    );
  }
  if (liveSha256 !== EXPECTED_ID_SHA256) {
    errors.push(`Live ID list SHA-256 mismatch: got ${liveSha256}, expected ${EXPECTED_ID_SHA256}`);
  }

  const manifestSet = new Set(manifestIds);
  const liveSet = new Set(liveIds);
  for (const id of manifestIds) {
    if (!liveSet.has(id)) errors.push(`Manifest ID missing from live ledger: ${id}`);
  }
  for (const id of liveIds) {
    if (!manifestSet.has(id)) errors.push(`Live target ID missing from manifest: ${id}`);
  }

  // Every matched row must pass full criteria; none may be protected type
  for (const entry of liveMatches) {
    if (!isTargetInvoiceEntry(entry)) {
      errors.push(`Row failed re-validation: ${entry.id}`);
    }
    if (isProtectedFromRemoval(entry)) {
      errors.push(`Target row is protected (Kid-e-Sys/opening/payment class): ${entry.id}`);
    }
    if (entry.undoneAt || entry.undoneByCorrectionId) {
      errors.push(`Target row already undone — manual review required: ${entry.id}`);
    }
  }

  // No non-invoice rows for this runId
  const nonInvoiceRunRows = entries.filter(
    (e) => String(e.runId || "").trim() === TARGET_RUN_ID && e.type !== "invoice"
  );
  if (nonInvoiceRunRows.length) {
    errors.push(
      `Non-invoice rows exist for ${TARGET_RUN_ID}: ${nonInvoiceRunRows.map((e) => e.id).join(", ")}`
    );
  }

  // No other invoices on same date outside scope
  const otherSameDate = entries.filter(
    (e) =>
      e.type === "invoice" &&
      String(e.date || "").slice(0, 10) === TARGET_DATE &&
      !isTargetInvoiceEntry(e)
  );
  if (otherSameDate.length) {
    errors.push(
      `Other invoices on ${TARGET_DATE} outside scope (${otherSameDate.length}) — aborting`
    );
  }

  // Payment/credit cross-references (exact id / correction links only — no substring scans)
  const targetIdSet = new Set(liveIds);
  const targetRefSet = new Set(liveMatches.map((e) => String(e.reference || "").trim()));
  const paymentCreditHitIds: string[] = [];
  for (const entry of entries) {
    if (entry.type !== "payment" && entry.type !== "credit") continue;
    if (targetIdSet.has(entry.id)) paymentCreditHitIds.push(entry.id);
    if (entry.correctsEntryId && targetIdSet.has(entry.correctsEntryId)) {
      paymentCreditHitIds.push(entry.id);
    }
    if (entry.undoneByCorrectionId && targetIdSet.has(entry.undoneByCorrectionId)) {
      paymentCreditHitIds.push(entry.id);
    }
    const ref = String(entry.reference || "").trim();
    if (ref && targetRefSet.has(ref)) paymentCreditHitIds.push(entry.id);
  }
  const paymentCreditHits = [...new Set(paymentCreditHitIds)].length;
  if (paymentCreditHits > 0) {
    errors.push(`Payment/credit rows reference target invoices (${paymentCreditHits} hits)`);
  }

  // Opening balance / Kid-e-Sys in candidate set
  let openingBalanceHits = 0;
  let kidesysHits = 0;
  for (const entry of liveMatches) {
    if (isKidesysOpeningBalanceEntry(entry)) openingBalanceHits += 1;
    if (
      isKidesysBlockedBillingSource(entry.source) ||
      isKidesysHistoryIdOrReference(entry.id, entry.reference) ||
      isNonPostingImportedLedgerEntry(entry)
    ) {
      kidesysHits += 1;
    }
  }
  if (openingBalanceHits > 0) {
    errors.push(`Opening balance rows in target set (${openingBalanceHits})`);
  }
  if (kidesysHits > 0) {
    errors.push(`Kid-e-Sys rows in target set (${kidesysHits})`);
  }

  // Payment allocations (production host file when present)
  const allocations = readAllPaymentAllocations(SCHOOL_ID);
  let allocationHits = 0;
  for (const row of allocations) {
    const invId = String(row.invoiceId || row.ledgerInvoiceId || "").trim();
    if (invId && targetIdSet.has(invId)) allocationHits += 1;
  }
  if (allocationHits > 0) {
    errors.push(`Payment allocations reference target invoice IDs (${allocationHits})`);
  } else if (!allocations.length && APPLY) {
    warnings.push(
      "No payment-allocations.json rows loaded on host — allocation check skipped (file missing or empty)"
    );
  }

  const ledgerTotalBefore = entries.length;
  if (ledgerTotalBefore !== EXPECTED_LEDGER_TOTAL_BEFORE) {
    warnings.push(
      `Live ledger total ${ledgerTotalBefore} differs from investigation baseline ${EXPECTED_LEDGER_TOTAL_BEFORE} — verify backup before apply`
    );
  }

  const otherRunCounts = countByRunId(entries);
  delete otherRunCounts[TARGET_RUN_ID];
  for (const [runId, expected] of Object.entries(EXPECTED_OTHER_RUN_COUNTS)) {
    const actual = otherRunCounts[runId] ?? 0;
    if (actual !== expected) {
      errors.push(`Other invoice run ${runId} count ${actual} !== expected ${expected}`);
    }
  }

  const backupPath = "(not yet written)";

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    manifestIds,
    manifestSha256,
    liveMatches,
    ledgerTotalBefore,
    otherRunCounts,
    allocationHits,
    paymentCreditHits,
    openingBalanceHits,
    kidesysHits,
    backupPath,
  };
}

function verifyHostLedgerMatchesApi(
  apiEntries: BillingLedgerEntry[],
  manifestIds: string[]
): string[] {
  const errors: string[] = [];
  const hostEntries = readSchoolLedger(SCHOOL_ID);
  if (hostEntries.length !== apiEntries.length) {
    errors.push(
      `Host ledger school count ${hostEntries.length} !== API count ${apiEntries.length} — host file may not be production`
    );
  }
  const hostById = new Map(hostEntries.map((e) => [e.id, e]));
  for (const id of manifestIds) {
    const apiRow = apiEntries.find((e) => e.id === id);
    const hostRow = hostById.get(id);
    if (!hostRow) {
      errors.push(`Host ledger missing target ID: ${id}`);
      continue;
    }
    if (!apiRow) {
      errors.push(`API ledger missing target ID: ${id}`);
      continue;
    }
    if (JSON.stringify(hostRow) !== JSON.stringify(apiRow)) {
      errors.push(`Host/API row mismatch for ${id}`);
    }
  }
  return errors;
}

function applyRemoval(manifestIds: string[]): { removed: string[]; failed: string[] } {
  const removed: string[] = [];
  const failed: string[] = [];

  for (const id of manifestIds) {
    const before = readSchoolLedger(SCHOOL_ID).find((e) => e.id === id);
    if (!before || !isTargetInvoiceEntry(before)) {
      failed.push(id);
      continue;
    }
    const deleted = removeSchoolEntry(SCHOOL_ID, id);
    if (!deleted) {
      failed.push(id);
      continue;
    }
    removed.push(id);
  }

  return { removed, failed };
}

function writeApplyAudit(payload: Record<string, unknown>): string {
  const outPath = path.join(
    process.cwd(),
    "storage",
    `rollback-2026-07-03-test-invoice-run-apply-audit-${stamp()}.json`
  );
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
  return outPath;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═".repeat(72));
  console.log("Surgical rollback — test invoice run 2026-07-03");
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN (read-only)"}`);
  console.log(`School: ${SCHOOL_ID}`);
  console.log(`Target runId: ${TARGET_RUN_ID}`);
  console.log(`API: ${API_BASE}`);
  console.log("═".repeat(72));

  if (APPLY) {
    if (process.env[CONFIRM_ENV] !== "true") {
      throw new Error(`${CONFIRM_ENV}=true is required for --apply`);
    }
    if (!EXECUTE_ON_HOST) {
      throw new Error(
        "--execute-on-production-host is required for --apply (prevents accidental local ledger writes)"
      );
    }
  }

  const manifestIds = loadManifest();
  console.log(`\n[1/5] Manifest loaded: ${manifestIds.length} IDs`);
  console.log(`      SHA-256: ${sha256Lines(manifestIds)}`);

  console.log("\n[2/5] Fetching live production ledger (read-only)…");
  const liveEntries = await fetchLiveLedger();
  const backupPath = saveProductionBackup(liveEntries);
  console.log(`      Backup saved: ${backupPath}`);
  console.log(`      Live entry count: ${liveEntries.length}`);

  console.log("\n[3/5] Verifying rollback scope…");
  const report = verifyScope(liveEntries, manifestIds);
  report.backupPath = backupPath;

  for (const warning of report.warnings) {
    console.warn(`  WARN: ${warning}`);
  }
  if (!report.ok) {
    console.error("\n✗ VERIFICATION FAILED — aborting");
    for (const error of report.errors) {
      console.error(`  ✗ ${error}`);
    }
    process.exit(1);
  }
  console.log("  ✓ All verification checks passed");
  console.log(`  ✓ Target rows: ${report.liveMatches.length}`);
  console.log(`  ✓ Total amount: R ${report.liveMatches.reduce((s, e) => s + Number(e.amount || 0), 0).toLocaleString("en-ZA")}`);
  console.log(`  ✓ Payment/credit hits: ${report.paymentCreditHits}`);
  console.log(`  ✓ Allocation hits: ${report.allocationHits}`);
  console.log(`  ✓ Other invoice runs unchanged`);

  if (!APPLY) {
    console.log("\n[4/5] DRY-RUN complete — no production data modified");
    console.log("\n[5/5] To apply on Render production host after approval:");
    console.log(
      "  CONFIRM_PRODUCTION_WRITE=true npx tsx scripts/rollback-production-test-invoice-run-2026-07-03.ts --apply --execute-on-production-host"
    );
    console.log(`\nExpected removal: ${EXPECTED_REMOVE_COUNT} invoice entries`);
    console.log(`Expected ledger total after: ${EXPECTED_LEDGER_TOTAL_AFTER}`);
    return;
  }

  console.log("\n[4/5] Verifying host billing-ledger.json matches live API…");
  const hostErrors = verifyHostLedgerMatchesApi(liveEntries, manifestIds);
  if (hostErrors.length) {
    console.error("\n✗ HOST/API PARITY FAILED — aborting apply");
    for (const error of hostErrors) {
      console.error(`  ✗ ${error}`);
    }
    process.exit(1);
  }
  console.log("  ✓ Host ledger matches API snapshot for all 395 target rows");

  console.log("\n[5/5] Applying surgical removal…");
  const otherBefore = countByRunId(readSchoolLedger(SCHOOL_ID));
  const { removed, failed } = applyRemoval(manifestIds);

  if (failed.length) {
    console.error(`\n✗ APPLY INCOMPLETE — ${failed.length} rows failed`);
    console.error(failed.join("\n"));
    process.exit(1);
  }

  const hostAfter = readSchoolLedger(SCHOOL_ID);
  const remainingTarget = hostAfter.filter(
    (e) => String(e.runId || "").trim() === TARGET_RUN_ID
  );
  if (remainingTarget.length > 0 || removed.length !== EXPECTED_REMOVE_COUNT) {
    console.error(
      `\n✗ POST-APPLY CHECK FAILED — removed ${removed.length}, remaining target ${remainingTarget.length}`
    );
    process.exit(1);
  }

  const otherAfter = countByRunId(hostAfter);
  for (const [runId, expected] of Object.entries(EXPECTED_OTHER_RUN_COUNTS)) {
    if ((otherAfter[runId] ?? 0) !== expected) {
      console.error(
        `\n✗ Other run ${runId} count changed: before ${otherBefore[runId]} after ${otherAfter[runId]} expected ${expected}`
      );
      process.exit(1);
    }
  }

  const auditPath = writeApplyAudit({
    appliedAt: new Date().toISOString(),
    schoolId: SCHOOL_ID,
    targetRunId: TARGET_RUN_ID,
    removedCount: removed.length,
    removedIds: removed,
    backupPath,
    ledgerTotalBefore: liveEntries.length,
    ledgerTotalAfter: hostAfter.length,
    expectedLedgerTotalAfter: EXPECTED_LEDGER_TOTAL_AFTER,
    otherRunCountsAfter: otherAfter,
  });

  console.log(`\n✓ APPLY COMPLETE — removed ${removed.length} invoice entries`);
  console.log(`  Ledger total: ${liveEntries.length} → ${hostAfter.length}`);
  console.log(`  Audit log: ${auditPath}`);
  console.log("\nPost-apply verification (read-only):");
  console.log(
    `  curl -sS "${API_BASE}/api/invoices/ledger?schoolId=${SCHOOL_ID}" | jq '[.entries[]|select(.runId=="${TARGET_RUN_ID}")]|length'`
  );
  console.log(
    `  curl -sS "${API_BASE}/api/statements?schoolId=${SCHOOL_ID}" | jq '{accounts:(.statements|length),jul3:([.statements[]|select(.lastInvoiceDate|startswith("${TARGET_DATE}"))]|length)}'`
  );
}

main().catch((error) => {
  console.error("\nFATAL:", error instanceof Error ? error.message : error);
  process.exit(1);
});
