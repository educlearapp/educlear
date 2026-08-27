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

const INVOICE_RUN_PREVIEW_VIEWS = new Set([
  "wizardChildren",
  "wizardFees",
  "wizardPreview",
  "wizardCreate",
]);

/** Pages that actually display historic invoices/payments and may hydrate that ledger. */
const HISTORIC_BILLING_LEDGER_PAGES = new Set([
  "statements",
  "statementManage",
  "invoices",
  "invoiceCreate",
  "payments",
  "paymentCreate",
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

/** Candidate UI may bind to server preview on these steps. Never downloads historic ledgers. */
export function shouldBuildInvoiceRunCandidates(view: unknown): boolean {
  return INVOICE_RUN_PREVIEW_VIEWS.has(String(view || ""));
}

export function shouldPrefetchInvoiceRunPreview(view: unknown): boolean {
  return INVOICE_RUN_PREVIEW_VIEWS.has(String(view || ""));
}

/** Invoice Run wizard/list must never hydrate GET /api/invoices or /api/payments. */
export function shouldSyncInvoiceRunLedger(_view?: unknown): boolean {
  return false;
}

export function shouldHydrateHistoricBillingLedger(page: unknown): boolean {
  return HISTORIC_BILLING_LEDGER_PAGES.has(String(page || ""));
}

export type InvoiceRunExtraFee = {
  feeDescription: string;
  amount: number;
};

export type InvoiceRunPreviewLearner = {
  learnerId?: string;
  learnerName?: string;
  accountNo?: string;
  status?: string;
  amount?: number;
  skipReason?: string;
  skipDetail?: string;
};

const INVOICE_RUN_PAGE_SIZE = 10;

export function invoiceRunPreviewCacheKey(run: Record<string, unknown> | null | undefined): string {
  const row = run && typeof run === "object" ? run : {};
  return JSON.stringify({
    id: row.id || "",
    all: row.extraFeesAll || [],
    byId: row.extraFeesByLearnerId || {},
    excluded: row.excludedLearnerIds || [],
    period: row.month || row.period || "",
    invoiceDate: row.invoiceDate || "",
  });
}

export function paginateInvoiceRunRows<T>(
  rows: T[],
  page: number,
  pageSize: number = INVOICE_RUN_PAGE_SIZE
): T[] {
  const list = Array.isArray(rows) ? rows : [];
  const size = Math.max(1, Number(pageSize) || INVOICE_RUN_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(list.length / size));
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (safePage - 1) * size;
  return list.slice(start, start + size);
}

function extraFeesFromRow(row: unknown): InvoiceRunExtraFee[] {
  const record = row as { fees?: unknown[]; id?: unknown; learnerId?: unknown } | null;
  const fees = Array.isArray(record?.fees) ? record.fees : [];
  return fees
    .filter(
      (fee: any) => fee?.type === "EXTRA" || String(fee?.id || "").startsWith("extra-")
    )
    .map((fee: any) => ({
      feeDescription: String(fee.description || fee.name || "Extra fee").trim(),
      amount: Number(fee.amount || 0),
    }))
    .filter((fee: InvoiceRunExtraFee) => fee.feeDescription && fee.amount > 0);
}

export function extraFeesForLearner(
  learnerId: string,
  extraFeesByLearnerId?: Record<string, InvoiceRunExtraFee[]>,
  extraFeesAll?: InvoiceRunExtraFee[]
): InvoiceRunExtraFee[] {
  const id = String(learnerId || "").trim();
  const specific = id && extraFeesByLearnerId ? extraFeesByLearnerId[id] || [] : [];
  const all = Array.isArray(extraFeesAll) ? extraFeesAll : [];
  return [...all, ...specific].filter((fee) => Number(fee.amount) > 0);
}

export function buildInvoiceRunExtraFeesByLearnerId(
  invoicedLearnerIds: string[],
  extraFeesByLearnerId?: Record<string, InvoiceRunExtraFee[]>,
  extraFeesAll?: InvoiceRunExtraFee[]
): Record<string, InvoiceRunExtraFee[]> | undefined {
  const out: Record<string, InvoiceRunExtraFee[]> = {};
  for (const learnerId of invoicedLearnerIds) {
    const id = String(learnerId || "").trim();
    if (!id) continue;
    const fees = extraFeesForLearner(id, extraFeesByLearnerId, extraFeesAll);
    if (fees.length) out[id] = fees;
  }
  return Object.keys(out).length ? out : undefined;
}

function extrasFromFatRows(
  rows: unknown[]
): Record<string, InvoiceRunExtraFee[]> {
  const out: Record<string, InvoiceRunExtraFee[]> = {};
  for (const row of rows || []) {
    const record = row as { id?: unknown; learnerId?: unknown };
    const id = String(record?.id || record?.learnerId || "").trim();
    const extras = extraFeesFromRow(row);
    if (id && extras.length) out[id] = extras;
  }
  return out;
}

/** Persist only settings, extra fees, and exclusion ids — never 441 fat candidate rows. */
export function toThinInvoiceRunDraft(
  run: InvoiceRunListRow | Record<string, unknown> | null | undefined
): InvoiceRunListRow {
  const row = (run && typeof run === "object" ? run : {}) as InvoiceRunListRow;
  const fatRows = Array.isArray(row.rows) ? row.rows : [];
  const fromRows = extrasFromFatRows(fatRows);
  const extraFeesByLearnerId = {
    ...fromRows,
    ...((row as { extraFeesByLearnerId?: Record<string, InvoiceRunExtraFee[]> })
      .extraFeesByLearnerId || {}),
  };
  const extraFeesAllRaw = row.extraFeesAll;
  const extraFeesAll = Array.isArray(extraFeesAllRaw)
    ? (extraFeesAllRaw as InvoiceRunExtraFee[])
    : [];
  const excludedRaw = row.excludedLearnerIds;
  const excludedLearnerIds = Array.isArray(excludedRaw)
    ? excludedRaw.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const executed = row.executed === true;
  return {
    id: String(row.id || row.runId || ""),
    runId: row.runId ? String(row.runId) : undefined,
    schoolId: String(row.schoolId || ""),
    source: row.source,
    month: row.month,
    period: row.period,
    invoicePeriod: row.invoicePeriod,
    description: row.description,
    date: row.date,
    invoiceDate: row.invoiceDate,
    dueDate: row.dueDate,
    invoiceMessage: (row as { invoiceMessage?: string }).invoiceMessage,
    extraFeesAll,
    extraFeesByLearnerId,
    excludedLearnerIds,
    totalInvoices: executed ? Number(row.totalInvoices || 0) : 0,
    totalAmount: executed ? Number(row.totalAmount || 0) : 0,
    executed,
    original: (row as { original?: unknown }).original,
    createdAt: (row as { createdAt?: string }).createdAt,
    rows: [],
  } as InvoiceRunListRow;
}

export function mapInvoiceRunPreviewToWizardRows(args: {
  previewLearners: InvoiceRunPreviewLearner[];
  localLearners?: Array<Record<string, unknown>>;
  extraFeesByLearnerId?: Record<string, InvoiceRunExtraFee[]>;
  extraFeesAll?: InvoiceRunExtraFee[];
  excludedLearnerIds?: string[];
  invoiceDate?: string;
}): Array<Record<string, unknown>> {
  const localById = new Map(
    (args.localLearners || []).map((learner) => [String(learner.id || ""), learner])
  );
  const excluded = new Set(
    (args.excludedLearnerIds || []).map((id) => String(id || "").trim()).filter(Boolean)
  );
  const invoiceDate = String(args.invoiceDate || "").trim();
  return (args.previewLearners || [])
    .map((preview) => {
      const learnerId = String(preview.learnerId || "").trim();
      if (!learnerId || excluded.has(learnerId)) return null;
      const local = localById.get(learnerId) || {};
      const extras = extraFeesForLearner(
        learnerId,
        args.extraFeesByLearnerId,
        args.extraFeesAll
      );
      const invoiceAmount = Number(preview.amount || 0);
      const fullName = String(preview.learnerName || "").trim();
      const nameParts = fullName.split(/\s+/).filter(Boolean);
      return {
        id: learnerId,
        learnerId,
        learnerName: fullName || String(local.firstName || ""),
        firstName: String(local.firstName || local.name || nameParts[0] || ""),
        surname: String(
          local.surname || local.lastName || nameParts.slice(1).join(" ") || ""
        ),
        classroom: String(
          local.classroom || local.className || local.grade || local.gradeName || ""
        ),
        accountNo: String(preview.accountNo || local.accountNo || ""),
        familyAccountId: local.familyAccountId,
        invoiceAmount,
        serverStatus: String(preview.status || ""),
        skipReason: preview.skipReason,
        skipDetail: preview.skipDetail,
        invoiceDate,
        extraFees: extras,
        fees: extras.map((fee, index) => ({
          id: `extra-${learnerId}-${index}`,
          type: "EXTRA",
          description: fee.feeDescription,
          name: fee.feeDescription,
          amount: fee.amount,
        })),
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;
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
