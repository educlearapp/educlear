export type InvoiceRunListSource = "ledger" | "browser-draft";

export const INVOICE_RUN_DRAFTS_STORAGE_KEY = "educlearInvoiceRuns";

export type InvoiceRunListRow = {
  id: string;
  runId?: string;
  schoolId?: string;
  source?: InvoiceRunListSource;
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

const INVOICE_RUN_CANDIDATE_VIEWS = new Set([
  "wizardChildren",
  "wizardFees",
  "wizardPreview",
  "wizardCreate",
]);

export function normalisePeriodKey(value: unknown): string {
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

export function resolveDraftPeriod(draft: InvoiceRunListRow): string {
  return (
    normalisePeriodKey(draft.invoicePeriod) ||
    normalisePeriodKey(draft.period) ||
    normalisePeriodKey(draft.month) ||
    normalisePeriodKey(draft.description)
  );
}

/** Build learner rows / download ledger only on steps that display candidates. */
export function shouldBuildInvoiceRunCandidates(view: unknown): boolean {
  return INVOICE_RUN_CANDIDATE_VIEWS.has(String(view || ""));
}

export function shouldSyncInvoiceRunLedger(view: unknown): boolean {
  return shouldBuildInvoiceRunCandidates(view);
}

/** Official FamilyAccount link only — unlinked learners must not enter the candidate set. */
export function learnerHasOfficialLinkedFamilyAccount(learner: unknown): boolean {
  const row = learner as {
    familyAccountId?: unknown;
    familyAccount?: { id?: unknown } | null;
  } | null | undefined;
  return Boolean(String(row?.familyAccountId || row?.familyAccount?.id || "").trim());
}

export function isUnexecutedBrowserDraft(draft: InvoiceRunListRow): boolean {
  return !(
    draft.executed === true ||
    Number(draft.totalInvoices || 0) > 0 ||
    Number(draft.totalAmount || 0) > 0 ||
    Boolean(draft.executeResult)
  );
}

/** Stamp unscoped legacy drafts with the current school. Does not delete or collapse rows. */
export function stampLegacyInvoiceRunDrafts(
  drafts: InvoiceRunListRow[],
  schoolId: string
): InvoiceRunListRow[] {
  const sid = String(schoolId || "").trim();
  if (!sid) return Array.isArray(drafts) ? drafts.slice() : [];
  return (drafts || []).map((draft) => {
    if (String(draft?.schoolId || "").trim()) return draft;
    return { ...draft, schoolId: sid };
  });
}

export function listSchoolInvoiceRunDrafts(
  drafts: InvoiceRunListRow[],
  schoolId: string
): InvoiceRunListRow[] {
  const sid = String(schoolId || "").trim();
  if (!sid) return [];
  return (drafts || []).filter((draft) => String(draft?.schoolId || "").trim() === sid);
}

export function findUnexecutedDraftForSchoolPeriod(
  drafts: InvoiceRunListRow[],
  schoolId: string,
  periodOrMonth: string
): InvoiceRunListRow | null {
  const sid = String(schoolId || "").trim();
  const period = normalisePeriodKey(periodOrMonth);
  if (!sid || !period) return null;
  return (
    (drafts || []).find((draft) => {
      if (String(draft?.schoolId || "").trim() !== sid) return false;
      if (!isUnexecutedBrowserDraft(draft)) return false;
      return resolveDraftPeriod(draft) === period;
    }) || null
  );
}

export function upsertUnexecutedInvoiceRunDraft(
  drafts: InvoiceRunListRow[],
  incoming: InvoiceRunListRow,
  schoolId: string
): InvoiceRunListRow[] {
  const sid = String(schoolId || incoming.schoolId || "").trim();
  const withSchool = { ...incoming, schoolId: sid };
  const period = resolveDraftPeriod(withSchool);
  const out: InvoiceRunListRow[] = [];
  let replaced = false;
  for (const draft of drafts || []) {
    const sameSchool = String(draft.schoolId || "").trim() === sid;
    const samePeriod = Boolean(period) && resolveDraftPeriod(draft) === period;
    if (sid && period && sameSchool && samePeriod && isUnexecutedBrowserDraft(draft)) {
      if (!replaced) {
        out.push({
          ...withSchool,
          id: String(draft.id || withSchool.id),
        });
        replaced = true;
      }
      continue;
    }
    out.push(draft);
  }
  if (!replaced) out.unshift(withSchool);
  return out;
}

export function persistInvoiceRunDraft(
  drafts: InvoiceRunListRow[],
  incoming: InvoiceRunListRow,
  schoolId: string
): InvoiceRunListRow[] {
  const sid = String(schoolId || incoming.schoolId || "").trim();
  const withSchool = { ...incoming, schoolId: sid };
  if (isUnexecutedBrowserDraft(withSchool)) {
    return upsertUnexecutedInvoiceRunDraft(drafts, withSchool, sid);
  }
  const id = String(withSchool.id || withSchool.runId || "");
  const exists = (drafts || []).some((draft) => String(draft.id || draft.runId || "") === id);
  if (exists) {
    return (drafts || []).map((draft) =>
      String(draft.id || draft.runId || "") === id ? withSchool : draft
    );
  }
  return [withSchool, ...(drafts || [])];
}

/**
 * + Add: reuse one in-memory unexecuted draft per school+period.
 * Does not write localStorage — caller must not persist until settings exist.
 */
export function beginInvoiceRunWizard(args: {
  drafts: InvoiceRunListRow[];
  schoolId: string;
  month: string;
}): {
  drafts: InvoiceRunListRow[];
  selectedRun: InvoiceRunListRow;
  persisted: false;
  reused: boolean;
} {
  const schoolId = String(args.schoolId || "").trim();
  const month = String(args.month || "").trim();
  const period = normalisePeriodKey(month);
  const existing = findUnexecutedDraftForSchoolPeriod(args.drafts, schoolId, month);
  if (existing) {
    return {
      drafts: args.drafts,
      selectedRun: { ...existing, schoolId },
      persisted: false,
      reused: true,
    };
  }
  return {
    drafts: args.drafts,
    selectedRun: {
      id: `draft:${schoolId}:${period || "pending"}`,
      schoolId,
      month,
      period: month,
      invoicePeriod: period,
      description: `Invoice Run For ${month}`,
      totalInvoices: 0,
      totalAmount: 0,
      executed: false,
      rows: [],
    },
    persisted: false,
    reused: false,
  };
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
