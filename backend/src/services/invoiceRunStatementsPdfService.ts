/**
 * Combined printable statements for one completed invoice run.
 * Read-only against the billing ledger + existing statement PDF engine.
 * Does not create invoices, mutate ledger rows, or email statements.
 *
 * Architecture (perf):
 * 1. Load school ledger / branding / logo / DB indexes once.
 * 2. Calculate each family statement with trusted financial helpers.
 * 3. Render all statements into one PDFKit document (shared logo/fonts).
 * 4. Each family starts on a new page — no per-family pdf-lib merge.
 */
import {
  getInvoiceRunDetailFromLedger,
  type InvoiceRunDetail,
} from "./invoiceRunListService";
import { generateCombinedStatementsPdfBuffer } from "./statementPdfService";
import {
  buildStatementPdfInputFromBulkContext,
  loadBulkStatementSchoolContext,
} from "./statementBulkPdfContext";
import {
  DEFAULT_STATEMENT_PERIOD,
  formatStatementPeriodHeaderLabel,
  formatStatementPeriodHttpWindow,
  normalizeStatementPeriod,
  resolveStatementPeriodCutoff,
  type StatementPeriodOption,
} from "../utils/statementPeriod";
import type { BillingLedgerEntry } from "../utils/billingLedgerStore";
import { readSchoolLedger } from "../utils/billingLedgerStore";
import { readSchoolKidesysHistory } from "../utils/kidesysTransactionHistoryStore";
import { loadSchoolLogoBuffer } from "../utils/schoolLogo";
import type { StatementPdfInput } from "./statementPdfTypes";

/** Default for invoice-run bulk print when the client omits period. */
export const INVOICE_RUN_STATEMENT_DEFAULT_PERIOD: StatementPeriodOption = "Last 3 Months";

const ENGINE_PERIODS = new Set<string>([
  "Last 1 Month",
  "Last 3 Months",
  "Last 6 Months",
  "Last 12 Months",
  "Last 9 Months",
  "Last 18 Months",
  "Last 24 Months",
  "All Time",
]);

export type InvoiceRunStatementsPdfResult = {
  buffer: Buffer;
  filename: string;
  detail: InvoiceRunDetail;
  statementCount: number;
  statementPeriod: string;
  statementCutoffNote: string;
  statementWindowLabel: string;
  /** ASCII-safe window for HTTP headers (ISO dates). */
  statementWindowHeader: string;
  /** Optional timing diagnostics (local/profile only). */
  timings?: {
    loadMs: number;
    dataMs: number;
    renderMs: number;
    totalMs: number;
    pdfBytes: number;
    pageCount: number;
  };
};

export function resolveInvoiceRunStatementPeriod(raw?: string | null): StatementPeriodOption {
  const value = String(raw || "").trim();
  if (!value) return INVOICE_RUN_STATEMENT_DEFAULT_PERIOD;
  if (!ENGINE_PERIODS.has(value)) {
    // Unknown / unsupported choices must not silently fall through to All Time.
    throw new Error(
      `Unsupported statement period for invoice-run bulk print: ${value}. Use Last 1/3/6/12 Months or All Time.`
    );
  }
  return normalizeStatementPeriod(value);
}

export function invoiceRunStatementCutoffNote(
  invoicePeriod: string,
  statementPeriod: string
): string {
  const runPeriod = String(invoicePeriod || "").trim() || "the selected run";
  const period = normalizeStatementPeriod(statementPeriod || INVOICE_RUN_STATEMENT_DEFAULT_PERIOD);
  // Use ASCII window in notes that may also be copied into HTTP headers.
  const windowLabel = formatStatementPeriodHttpWindow(period);
  return (
    `Accounts are limited to unique family accounts on invoice run ${runPeriod}. ` +
    `Transaction history uses statement period ${period} (${windowLabel}). ` +
    `Opening balances for Last N Months are ledger activity before the period start. ` +
    `Closing balances are period-end ledger totals (opening + in-period net), not the current Age Analysis snapshot. ` +
    `Balances are not reconstructed as of the invoice-run posting date alone.`
  );
}

export async function buildInvoiceRunStatementsPdf(opts: {
  schoolId: string;
  runId: string;
  period?: string | null;
  ledger?: BillingLedgerEntry[];
  statementNote?: string;
  /** When true, attach timing diagnostics on the result. */
  includeTimings?: boolean;
}): Promise<InvoiceRunStatementsPdfResult | null> {
  const schoolId = String(opts.schoolId || "").trim();
  const runId = String(opts.runId || "").trim();
  if (!schoolId || !runId) return null;

  const t0 = performance.now();
  const statementPeriod = resolveInvoiceRunStatementPeriod(opts.period);
  const ledger = opts.ledger ?? readSchoolLedger(schoolId);
  const detail = getInvoiceRunDetailFromLedger(schoolId, runId, { ledger });
  if (!detail || !detail.familyAccounts.length) return null;

  const sharedKidesysHistory = readSchoolKidesysHistory(schoolId);
  const ctx = await loadBulkStatementSchoolContext(schoolId, {
    ledger,
    kidesysHistory: sharedKidesysHistory,
  });
  // Prefer logo from context; fall back to explicit load if branding URL present but buffer null.
  if (!ctx.logoBuffer && ctx.branding.logoUrl) {
    ctx.logoBuffer = await loadSchoolLogoBuffer(ctx.branding.logoUrl);
  }
  const loadMs = performance.now() - t0;

  const familyAccounts = detail.familyAccounts;
  const expectedCount = familyAccounts.length;

  const tData0 = performance.now();
  const inputs: StatementPdfInput[] = [];
  const includedAccountNos: string[] = [];

  for (let i = 0; i < familyAccounts.length; i += 1) {
    const account = familyAccounts[i];
    const accountNo = String(account.accountNo || "").trim();
    const learnerId = String(account.anchorLearnerId || "").trim();
    if (!accountNo && !learnerId) {
      throw new Error(
        `Incomplete statement identity for family account at index ${i + 1}/${expectedCount}. Combined download aborted.`
      );
    }
    try {
      const input = buildStatementPdfInputFromBulkContext(ctx, {
        accountNo: accountNo || undefined,
        learnerId: learnerId || undefined,
        period: statementPeriod || DEFAULT_STATEMENT_PERIOD,
        statementNote: opts.statementNote,
      });
      inputs.push(input);
      includedAccountNos.push(String(input.accountNo || accountNo || learnerId).trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to generate statement for ${accountNo || learnerId}: ${message}`
      );
    }
  }
  const dataMs = performance.now() - tData0;

  if (inputs.length !== expectedCount || includedAccountNos.length !== expectedCount) {
    throw new Error(
      `Combined statement PDF incomplete: expected ${expectedCount} family statements, built ${inputs.length}.`
    );
  }

  const tRender0 = performance.now();
  const combined = await generateCombinedStatementsPdfBuffer(inputs, {
    logoBuffer: ctx.logoBuffer,
  });
  const renderMs = performance.now() - tRender0;

  if (!combined.buffer.length || combined.buffer.subarray(0, 4).toString("latin1") !== "%PDF") {
    throw new Error("Combined statement PDF failed integrity check (missing %PDF header).");
  }
  if (combined.statementCount !== expectedCount) {
    throw new Error(
      `Combined statement PDF incomplete: expected ${expectedCount} family statements, rendered ${combined.statementCount}.`
    );
  }
  for (let i = 1; i < combined.firstPageIndexByStatement.length; i += 1) {
    if (combined.firstPageIndexByStatement[i] <= combined.firstPageIndexByStatement[i - 1]) {
      throw new Error("Family statements are not separated onto new pages.");
    }
  }

  const safeRun = runId.replace(/[^\w.-]+/g, "_").slice(0, 80) || "run";
  const safePeriod = statementPeriod.toLowerCase().replace(/\s+/g, "");
  const totalMs = performance.now() - t0;

  return {
    buffer: combined.buffer,
    filename: `invoice-run-${safeRun}-statements-${safePeriod}.pdf`,
    detail,
    statementCount: combined.statementCount,
    statementPeriod,
    statementCutoffNote: invoiceRunStatementCutoffNote(
      detail.invoicePeriod || detail.period,
      statementPeriod
    ),
    statementWindowLabel: formatStatementPeriodHeaderLabel(statementPeriod),
    statementWindowHeader: formatStatementPeriodHttpWindow(statementPeriod),
    timings: opts.includeTimings
      ? {
          loadMs: Math.round(loadMs),
          dataMs: Math.round(dataMs),
          renderMs: Math.round(renderMs),
          totalMs: Math.round(totalMs),
          pdfBytes: combined.buffer.length,
          pageCount: combined.pageCount,
        }
      : undefined,
  };
}

/** Test helper: rolling window start for confirmation / headers. */
export function invoiceRunStatementWindowStart(
  period: string,
  now: Date = new Date()
): string | null {
  const normalized = resolveInvoiceRunStatementPeriod(period);
  if (normalized === "All Time") return null;
  const cutoff = resolveStatementPeriodCutoff(normalized, now);
  if (!cutoff) return null;
  const y = cutoff.getFullYear();
  const m = String(cutoff.getMonth() + 1).padStart(2, "0");
  const day = String(cutoff.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
