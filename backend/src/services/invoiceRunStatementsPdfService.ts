/**
 * Combined printable statements for one completed invoice run.
 * Read-only against the billing ledger + existing statement PDF engine.
 * Does not create invoices, mutate ledger rows, or email statements.
 */
import { PDFDocument as PdfLibDocument } from "pdf-lib";

import {
  getInvoiceRunDetailFromLedger,
  type InvoiceRunDetail,
  type InvoiceRunFamilyAccountSummary,
} from "./invoiceRunListService";
import { buildAndGenerateStatementPdf } from "./statementPdfData";
import {
  DEFAULT_STATEMENT_PERIOD,
  formatStatementPeriodHeaderLabel,
  normalizeStatementPeriod,
  resolveStatementPeriodCutoff,
  type StatementPeriodOption,
} from "../utils/statementPeriod";
import type { BillingLedgerEntry } from "../utils/billingLedgerStore";

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
  const windowLabel = formatStatementPeriodHeaderLabel(period);
  return (
    `Accounts are limited to unique family accounts on invoice run ${runPeriod}. ` +
    `Transaction history uses statement period ${windowLabel}. ` +
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
}): Promise<InvoiceRunStatementsPdfResult | null> {
  const schoolId = String(opts.schoolId || "").trim();
  const runId = String(opts.runId || "").trim();
  if (!schoolId || !runId) return null;

  const statementPeriod = resolveInvoiceRunStatementPeriod(opts.period);
  const detail = getInvoiceRunDetailFromLedger(schoolId, runId, { ledger: opts.ledger });
  if (!detail || !detail.familyAccounts.length) return null;

  const familyAccounts = detail.familyAccounts;
  const expectedCount = familyAccounts.length;
  const merged = await PdfLibDocument.create();
  const includedAccountNos: string[] = [];
  let firstPageIndexByAccount: number[] = [];

  for (let i = 0; i < familyAccounts.length; i += 1) {
    const account = familyAccounts[i];
    const pdf = await generateOneAccountStatementPdf(
      schoolId,
      account,
      statementPeriod,
      opts.statementNote
    );
    if (!pdf || pdf.length < 8) {
      throw new Error(
        `Incomplete statement PDF for family account ${account.accountNo || account.anchorLearnerId || i + 1} (${i + 1}/${expectedCount}). Combined download aborted to prevent a corrupted file.`
      );
    }
    const donor = await PdfLibDocument.load(pdf);
    const pageIndices = donor.getPageIndices();
    if (!pageIndices.length) {
      throw new Error(
        `Empty statement PDF page set for family account ${account.accountNo || account.anchorLearnerId || i + 1}. Combined download aborted.`
      );
    }
    firstPageIndexByAccount.push(merged.getPageCount());
    const pages = await merged.copyPages(donor, pageIndices);
    for (const page of pages) merged.addPage(page);
    includedAccountNos.push(String(account.accountNo || account.anchorLearnerId || "").trim());
    // Donor released when leaving this iteration; merged retains copied pages only.
  }

  if (merged.getPageCount() === 0 || includedAccountNos.length === 0) return null;
  if (includedAccountNos.length !== expectedCount) {
    throw new Error(
      `Combined statement PDF incomplete: expected ${expectedCount} family statements, built ${includedAccountNos.length}.`
    );
  }
  // Each family statement must begin on a new page (first statement at page 0; subsequent after prior pages).
  for (let i = 1; i < firstPageIndexByAccount.length; i += 1) {
    if (firstPageIndexByAccount[i] <= firstPageIndexByAccount[i - 1]) {
      throw new Error("Family statements are not separated onto new pages.");
    }
  }

  const buffer = Buffer.from(await merged.save());
  if (!buffer.length || buffer.subarray(0, 4).toString("latin1") !== "%PDF") {
    throw new Error("Combined statement PDF failed integrity check (missing %PDF header).");
  }

  const safeRun = runId.replace(/[^\w.-]+/g, "_").slice(0, 80) || "run";
  const safePeriod = statementPeriod.toLowerCase().replace(/\s+/g, "");
  return {
    buffer,
    filename: `invoice-run-${safeRun}-statements-${safePeriod}.pdf`,
    detail,
    statementCount: includedAccountNos.length,
    statementPeriod,
    statementCutoffNote: invoiceRunStatementCutoffNote(
      detail.invoicePeriod || detail.period,
      statementPeriod
    ),
    statementWindowLabel: formatStatementPeriodHeaderLabel(statementPeriod),
  };
}

async function generateOneAccountStatementPdf(
  schoolId: string,
  account: InvoiceRunFamilyAccountSummary,
  period: StatementPeriodOption,
  statementNote?: string
): Promise<Buffer | null> {
  const accountNo = String(account.accountNo || "").trim();
  const learnerId = String(account.anchorLearnerId || "").trim();
  if (!accountNo && !learnerId) return null;
  try {
    const { buffer } = await buildAndGenerateStatementPdf({
      schoolId,
      accountNo: accountNo || undefined,
      learnerId: learnerId || undefined,
      period: period || DEFAULT_STATEMENT_PERIOD,
      statementNote,
      closingBalanceSource: "period-ledger",
    });
    return buffer;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to generate statement for ${accountNo || learnerId}: ${message}`
    );
  }
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
