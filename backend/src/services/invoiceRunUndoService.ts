import fs from "fs";
import path from "path";

import {
  ledgerHasRunId,
  readSchoolLedger,
  removeSchoolEntriesByIds,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import { isProductionRuntime } from "./runtime";

export const INVOICE_RUN_UNDO_PRODUCTION_ENV = "CONFIRM_INVOICE_RUN_UNDO_PRODUCTION";

export type InvoiceRunUndoResult = {
  success: boolean;
  alreadyUndone?: boolean;
  runId: string;
  schoolId: string;
  removedCount: number;
  removedEntryIds: string[];
  totalAmount: number;
  invoicePeriod?: string;
  error?: string;
  errorCode?: string;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function assertInvoiceRunUndoEnvironmentAllowed(): void {
  if (!isProductionRuntime()) return;
  const flag = String(process.env[INVOICE_RUN_UNDO_PRODUCTION_ENV] || "")
    .trim()
    .toLowerCase();
  if (flag === "true") return;
  throw new Error(
    `Invoice run undo is disabled on production. Set ${INVOICE_RUN_UNDO_PRODUCTION_ENV}=true on the server to allow.`
  );
}

function collectRunInvoiceEntries(
  schoolId: string,
  runId: string
): BillingLedgerEntry[] {
  const rid = String(runId || "").trim();
  return readSchoolLedger(schoolId).filter(
    (entry) =>
      entry.type === "invoice" &&
      !entry.undoneAt &&
      String(entry.runId || "").trim() === rid
  );
}

function allocationReferencesInvoiceIds(
  schoolId: string,
  invoiceIds: Set<string>
): string[] {
  if (!invoiceIds.size) return [];
  const hits: string[] = [];
  const storeKey = String(schoolId || "").trim();
  if (!storeKey) return hits;
  const dataDir = path.join(process.cwd(), "data");
  const allocationFile = path.join(dataDir, "payment-allocations.json");
  if (!fs.existsSync(allocationFile)) return hits;
  try {
    const all = JSON.parse(fs.readFileSync(allocationFile, "utf8")) as Record<
      string,
      Record<string, Array<{ invoiceId?: string | null }>>
    >;
    const school = all[storeKey];
    if (!school || typeof school !== "object") return hits;
    for (const rows of Object.values(school)) {
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const invoiceId = String(row.invoiceId || "").trim();
        if (invoiceId && invoiceIds.has(invoiceId)) hits.push(invoiceId);
      }
    }
  } catch {
    /* ignore malformed allocation file */
  }
  return hits;
}

export function undoInvoiceRun(input: {
  schoolId: string;
  runId: string;
  expectedCount?: number;
  expectedTotal?: number;
}): InvoiceRunUndoResult {
  const schoolId = String(input.schoolId || "").trim();
  const runId = String(input.runId || "").trim();

  if (!schoolId || !runId) {
    return {
      success: false,
      runId,
      schoolId,
      removedCount: 0,
      removedEntryIds: [],
      totalAmount: 0,
      error: "Missing schoolId or runId",
      errorCode: "INVALID_REQUEST",
    };
  }

  assertInvoiceRunUndoEnvironmentAllowed();

  if (!ledgerHasRunId(readSchoolLedger(schoolId), runId)) {
    return {
      success: true,
      alreadyUndone: true,
      runId,
      schoolId,
      removedCount: 0,
      removedEntryIds: [],
      totalAmount: 0,
      error: "Invoice run not found or already undone",
      errorCode: "NOT_FOUND",
    };
  }

  const targets = collectRunInvoiceEntries(schoolId, runId);
  if (!targets.length) {
    return {
      success: true,
      alreadyUndone: true,
      runId,
      schoolId,
      removedCount: 0,
      removedEntryIds: [],
      totalAmount: 0,
      error: "Invoice run not found or already undone",
      errorCode: "NOT_FOUND",
    };
  }

  const nonInvoice = readSchoolLedger(schoolId).filter(
    (entry) => String(entry.runId || "").trim() === runId && entry.type !== "invoice"
  );
  if (nonInvoice.length) {
    return {
      success: false,
      runId,
      schoolId,
      removedCount: 0,
      removedEntryIds: [],
      totalAmount: 0,
      error: `Run ${runId} contains ${nonInvoice.length} non-invoice ledger row(s); refusing partial undo`,
      errorCode: "AMBIGUOUS_RUN",
    };
  }

  const targetIds = new Set(targets.map((entry) => entry.id));
  const allocationHits = allocationReferencesInvoiceIds(schoolId, targetIds);
  if (allocationHits.length) {
    return {
      success: false,
      runId,
      schoolId,
      removedCount: 0,
      removedEntryIds: [],
      totalAmount: 0,
      error: `Run ${runId} has payment allocation(s) against ${allocationHits.length} invoice row(s)`,
      errorCode: "ALLOCATION_CONFLICT",
    };
  }

  const totalAmount = roundMoney(targets.reduce((sum, entry) => sum + Number(entry.amount || 0), 0));
  const invoicePeriod = String(targets[0]?.invoicePeriod || "").trim() || undefined;

  if (
    typeof input.expectedCount === "number" &&
    input.expectedCount >= 0 &&
    input.expectedCount !== targets.length
  ) {
    return {
      success: false,
      runId,
      schoolId,
      removedCount: 0,
      removedEntryIds: [],
      totalAmount,
      invoicePeriod,
      error: `Expected ${input.expectedCount} invoice row(s) but found ${targets.length}`,
      errorCode: "COUNT_MISMATCH",
    };
  }

  if (
    typeof input.expectedTotal === "number" &&
    input.expectedTotal >= 0 &&
    roundMoney(input.expectedTotal) !== totalAmount
  ) {
    return {
      success: false,
      runId,
      schoolId,
      removedCount: 0,
      removedEntryIds: [],
      totalAmount,
      invoicePeriod,
      error: `Expected total R ${roundMoney(input.expectedTotal)} but run total is R ${totalAmount}`,
      errorCode: "TOTAL_MISMATCH",
    };
  }

  console.info("[invoice-run-undo]", {
    environment: isProductionRuntime() ? "production" : "local",
    schoolId,
    runId,
    rowCount: targets.length,
    totalAmount,
    invoicePeriod,
  });

  const { removed, removedCount } = removeSchoolEntriesByIds(
    schoolId,
    targets.map((entry) => entry.id)
  );

  if (removedCount !== targets.length) {
    return {
      success: false,
      runId,
      schoolId,
      removedCount,
      removedEntryIds: removed.map((entry) => entry.id),
      totalAmount,
      invoicePeriod,
      error: "Ledger removal verification failed",
      errorCode: "LEDGER_WRITE_FAILED",
    };
  }

  return {
    success: true,
    runId,
    schoolId,
    removedCount,
    removedEntryIds: removed.map((entry) => entry.id),
    totalAmount,
    invoicePeriod,
  };
}
