export type InvoiceRunListSource = "ledger" | "browser-draft";

export type InvoiceRunListRow = {
  id: string;
  runId?: string;
  source: InvoiceRunListSource;
  description?: string;
  period?: string;
  month?: string;
  invoicePeriod?: string;
  date?: string;
  invoiceDate?: string;
  dueDate?: string;
  totalInvoices?: number;
  totalAmount?: number;
  executed?: boolean;
  rows?: unknown[];
  [key: string]: unknown;
};

function normalisePeriodKey(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const lower = raw.toLowerCase();
  const months: Record<string, string> = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };
  for (const [name, mm] of Object.entries(months)) {
    if (!lower.includes(name)) continue;
    const yearMatch = raw.match(/\b(20\d{2})\b/);
    if (yearMatch) return `${yearMatch[1]}-${mm}`;
  }
  return "";
}

function resolveDraftPeriod(draft: InvoiceRunListRow): string {
  return (
    normalisePeriodKey(draft.invoicePeriod) ||
    normalisePeriodKey(draft.period) ||
    normalisePeriodKey(draft.month) ||
    normalisePeriodKey(draft.description)
  );
}

/** Browser-only drafts that are not already represented on the server ledger list. */
export function listBrowserDraftInvoiceRuns(
  drafts: InvoiceRunListRow[],
  serverRuns: InvoiceRunListRow[],
  invoicePeriodCounts: Record<string, number> = {}
): InvoiceRunListRow[] {
  const serverRunIds = new Set(
    serverRuns
      .map((run) => String(run.runId || run.id || "").trim())
      .filter(Boolean)
  );

  return (drafts || []).filter((draft) => {
    const id = String(draft.id || draft.runId || "").trim();
    if (id && serverRunIds.has(id)) return false;

    const period = resolveDraftPeriod(draft);
    if (period && (invoicePeriodCounts[period] ?? 0) === 0) {
      const looksExecuted =
        draft.executed === true ||
        Number(draft.totalInvoices || 0) > 0 ||
        Number(draft.totalAmount || 0) > 0 ||
        Boolean(draft.executeResult);
      if (looksExecuted) return false;
    }

    return true;
  });
}

export function mergeInvoiceRunLists(
  serverRuns: InvoiceRunListRow[],
  localDrafts: InvoiceRunListRow[],
  invoicePeriodCounts: Record<string, number> = {}
): {
  serverRuns: InvoiceRunListRow[];
  browserDraftRuns: InvoiceRunListRow[];
  allVisibleRuns: InvoiceRunListRow[];
} {
  const ledgerRuns = (serverRuns || []).map((run) => ({
    ...run,
    source: "ledger" as const,
  }));
  const browserDraftRuns = listBrowserDraftInvoiceRuns(
    localDrafts,
    ledgerRuns,
    invoicePeriodCounts
  ).map((run) => ({
    ...run,
    source: "browser-draft" as const,
  }));

  return {
    serverRuns: ledgerRuns,
    browserDraftRuns,
    allVisibleRuns: [...ledgerRuns, ...browserDraftRuns],
  };
}

export function isLedgerBackedInvoiceRun(run: InvoiceRunListRow | null | undefined): boolean {
  return String(run?.source || "") === "ledger";
}
