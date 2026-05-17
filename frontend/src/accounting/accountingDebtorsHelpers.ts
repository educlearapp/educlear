import {
  buildRunDueDateMap,
  formatMoney,
  getAccountLedger,
  normaliseBillingAmount,
  normaliseIsoDate,
  resolveEntryDueDate,
  type BillingAccountRow,
  type BillingLedgerEntry,
} from "../billing/billingLedger";

export const DEBTORS_STORAGE_PREFIX = "educlearDebtors:";
export const DEBTORS_UPDATED_EVENT = "educlear-debtors-updated";

export type DebtorDisplayStatus =
  | "Up To Date"
  | "Recently Owing"
  | "Bad Debt"
  | "Legal Recovery"
  | "Payment Arrangement";

export type LegalStage =
  | "None"
  | "Section 41"
  | "Letter of Demand"
  | "Final Demand"
  | "Attorney Collection"
  | "Collection Closed";

export type LegalRecoveryTag =
  | "Section 41 Sent"
  | "Letter of Demand Sent"
  | "Final Demand Sent"
  | "Handed to Lawyer"
  | "Collections"
  | "Legal Closed";

export type AgeingBuckets = {
  current: number;
  days30: number;
  days60: number;
  days90: number;
  days120Plus: number;
};

export type PaymentArrangement = {
  id: string;
  learnerId: string;
  accountNo: string;
  amount: number;
  startDate: string;
  endDate: string;
  notes: string;
  status: "Active" | "Completed" | "Cancelled";
  createdAt: string;
};

export type LegalHandover = {
  id: string;
  learnerId: string;
  accountNo: string;
  attorneyName: string;
  handedOverDate: string;
  contactDetails: string;
  notes: string;
  status: "Active" | "Closed";
  createdAt: string;
};

export type RecoveryNoteType = "note" | "call" | "email" | "meeting" | "promise";

export type RecoveryNote = {
  id: string;
  type: RecoveryNoteType;
  date: string;
  summary: string;
  createdAt: string;
};

export type LegalHistoryRow = {
  id?: string;
  schoolId?: string;
  documentType?: string;
  generatedAt?: string;
  sentAt?: string;
  status?: string;
  learnerId?: string;
  accountNo?: string;
  learnerName?: string;
};

export type DebtorAgeingRow = {
  learnerId: string;
  accountNo: string;
  parentName: string;
  learnerName: string;
  grade: string;
  className: string;
  outstandingBalance: number;
  ageing: AgeingBuckets;
  statementStatus: string;
  displayStatus: DebtorDisplayStatus;
  legalStage: LegalStage;
  legalTags: LegalRecoveryTag[];
  lastPaymentDate: string;
  lastPaymentLabel: string;
  arrangementActive: boolean;
  daysSincePayment: number | null;
  learner: any;
};

const STAGE_RANK: Record<LegalStage, number> = {
  None: 0,
  "Section 41": 1,
  "Letter of Demand": 2,
  "Final Demand": 3,
  "Attorney Collection": 4,
  "Collection Closed": 5,
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function notifyDebtorsUpdated(schoolId?: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(DEBTORS_UPDATED_EVENT, { detail: { schoolId } })
  );
}

function arrangementsKey(schoolId: string) {
  return `${DEBTORS_STORAGE_PREFIX}arrangements:${schoolId}`;
}

function handoversKey(schoolId: string) {
  return `${DEBTORS_STORAGE_PREFIX}handovers:${schoolId}`;
}

function notesKey(schoolId: string) {
  return `${DEBTORS_STORAGE_PREFIX}notes:${schoolId}`;
}

export function loadPaymentArrangements(schoolId: string): PaymentArrangement[] {
  const rows = readJson<PaymentArrangement[]>(arrangementsKey(schoolId), []);
  return Array.isArray(rows) ? rows : [];
}

export function savePaymentArrangements(schoolId: string, rows: PaymentArrangement[]) {
  writeJson(arrangementsKey(schoolId), rows);
  notifyDebtorsUpdated(schoolId);
}

export function loadLegalHandovers(schoolId: string): LegalHandover[] {
  const rows = readJson<LegalHandover[]>(handoversKey(schoolId), []);
  return Array.isArray(rows) ? rows : [];
}

export function saveLegalHandovers(schoolId: string, rows: LegalHandover[]) {
  writeJson(handoversKey(schoolId), rows);
  notifyDebtorsUpdated(schoolId);
}

export function loadRecoveryNotes(schoolId: string): Record<string, RecoveryNote[]> {
  const data = readJson<Record<string, RecoveryNote[]>>(notesKey(schoolId), {});
  return data && typeof data === "object" ? data : {};
}

export function saveRecoveryNotes(schoolId: string, data: Record<string, RecoveryNote[]>) {
  writeJson(notesKey(schoolId), data);
  notifyDebtorsUpdated(schoolId);
}

export function accountLookupKey(learnerId: string, accountNo: string) {
  return `${String(learnerId || "").trim()}::${String(accountNo || "").trim()}`;
}

export function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = normaliseIsoDate(fromIso);
  const to = normaliseIsoDate(toIso);
  if (!from || !to) return 0;
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.floor((b - a) / (24 * 60 * 60 * 1000));
}

export function isArrangementActive(
  arrangement: PaymentArrangement | undefined,
  asOfDate: string
): boolean {
  if (!arrangement || arrangement.status !== "Active") return false;
  const asOf = normaliseIsoDate(asOfDate);
  const start = normaliseIsoDate(arrangement.startDate);
  const end = normaliseIsoDate(arrangement.endDate);
  if (!asOf || !start || !end) return false;
  return start <= asOf && end >= asOf;
}

export function getActiveArrangement(
  arrangements: PaymentArrangement[],
  learnerId: string,
  accountNo: string,
  asOfDate: string
) {
  return arrangements.find(
    (a) =>
      a.learnerId === learnerId &&
      a.accountNo === accountNo &&
      isArrangementActive(a, asOfDate)
  );
}

function documentTypeToStage(documentType: string): LegalStage | null {
  const t = String(documentType || "").trim();
  if (t === "section-41-notice") return "Section 41";
  if (t === "letter-of-demand") return "Letter of Demand";
  if (t === "final-demand") return "Final Demand";
  return null;
}

function stageToTag(stage: LegalStage): LegalRecoveryTag | null {
  if (stage === "Section 41") return "Section 41 Sent";
  if (stage === "Letter of Demand") return "Letter of Demand Sent";
  if (stage === "Final Demand") return "Final Demand Sent";
  if (stage === "Attorney Collection") return "Handed to Lawyer";
  if (stage === "Collection Closed") return "Legal Closed";
  return null;
}

export function resolveLegalStageForAccount(
  learnerId: string,
  accountNo: string,
  history: LegalHistoryRow[],
  handovers: LegalHandover[]
): { stage: LegalStage; tags: LegalRecoveryTag[] } {
  let stage: LegalStage = "None";
  const tags = new Set<LegalRecoveryTag>();

  const accountHistory = history.filter(
    (h) =>
      String(h.learnerId || "").trim() === learnerId &&
      String(h.accountNo || "").trim() === accountNo
  );

  for (const row of accountHistory) {
    const mapped = documentTypeToStage(String(row.documentType || ""));
    if (mapped && STAGE_RANK[mapped] > STAGE_RANK[stage]) stage = mapped;
    const tag = mapped ? stageToTag(mapped) : null;
    if (tag) tags.add(tag);
    if (String(row.status || "").toLowerCase() === "sent") {
      tags.add("Collections");
    }
  }

  const handover = handovers.find(
    (h) =>
      h.learnerId === learnerId &&
      h.accountNo === accountNo &&
      h.status === "Active"
  );
  if (handover) {
    if (STAGE_RANK["Attorney Collection"] > STAGE_RANK[stage]) stage = "Attorney Collection";
    tags.add("Handed to Lawyer");
    tags.add("Collections");
  }

  const closedHandover = handovers.find(
    (h) =>
      h.learnerId === learnerId &&
      h.accountNo === accountNo &&
      h.status === "Closed"
  );
  if (closedHandover) {
    stage = "Collection Closed";
    tags.add("Legal Closed");
  }

  const primaryTag = stageToTag(stage);
  if (primaryTag) tags.add(primaryTag);

  return { stage, tags: Array.from(tags) };
}

export function resolveDisplayStatus(
  statementStatus: string,
  balance: number,
  legalStage: LegalStage,
  arrangementActive: boolean
): DebtorDisplayStatus {
  if (balance <= 0) return "Up To Date";
  if (legalStage === "Collection Closed" || legalStage === "Attorney Collection") {
    return "Legal Recovery";
  }
  if (
    legalStage === "Section 41" ||
    legalStage === "Letter of Demand" ||
    legalStage === "Final Demand"
  ) {
    return "Legal Recovery";
  }
  if (arrangementActive) return "Payment Arrangement";
  if (statementStatus === "Bad Debt") return "Bad Debt";
  if (statementStatus === "Recently Owing") return "Recently Owing";
  if (balance > 0) return "Recently Owing";
  return "Up To Date";
}

export function calculateAgeingBuckets(
  ledger: BillingLedgerEntry[],
  asOfDate: string,
  runDueDates: Record<string, string>
): AgeingBuckets {
  const buckets: AgeingBuckets = {
    current: 0,
    days30: 0,
    days60: 0,
    days90: 0,
    days120Plus: 0,
  };

  const asOf = normaliseIsoDate(asOfDate) || new Date().toISOString().slice(0, 10);

  type ChargeLine = { due: string; amount: number };
  const lines: ChargeLine[] = [];

  for (const entry of ledger) {
    const amount = normaliseBillingAmount(entry.amount);
    if (!amount) continue;
    if (entry.type === "invoice") {
      const due = resolveEntryDueDate(entry, runDueDates) || normaliseIsoDate(entry.date);
      if (!due) continue;
      lines.push({ due, amount });
    } else if (entry.type === "penalty") {
      const due = normaliseIsoDate(entry.date);
      if (!due) continue;
      lines.push({ due, amount });
    }
  }

  lines.sort((a, b) => a.due.localeCompare(b.due));

  let creditPool = ledger
    .filter((e) => e.type === "payment" || e.type === "credit")
    .reduce((sum, e) => sum + normaliseBillingAmount(e.amount), 0);

  for (const line of lines) {
    let remaining = line.amount;
    const applied = Math.min(remaining, creditPool);
    remaining -= applied;
    creditPool -= applied;
    if (remaining <= 0) continue;

    const daysOverdue = daysBetweenIso(line.due, asOf);
    if (daysOverdue <= 0) buckets.current += remaining;
    else if (daysOverdue <= 30) buckets.days30 += remaining;
    else if (daysOverdue <= 60) buckets.days60 += remaining;
    else if (daysOverdue <= 90) buckets.days90 += remaining;
    else buckets.days120Plus += remaining;
  }

  return buckets;
}

function parentFromLearner(learner: any, fallbackName: string) {
  const parents = Array.isArray(learner?.parents) ? learner.parents : [];
  const links = Array.isArray(learner?.links) ? learner.links : [];
  const fromLink = links.find((l: any) => l?.parent)?.parent;
  const primary =
    parents.find((p: any) => p.isPrimary) ||
    parents[0] ||
    fromLink;
  if (!primary) return fallbackName || "Parent/Guardian";
  return (
    `${primary.firstName || primary.name || ""} ${primary.surname || primary.lastName || ""}`.trim() ||
    fallbackName ||
    "Parent/Guardian"
  );
}

export function buildDebtorAgeingRows(input: {
  schoolId: string;
  statementRows: BillingAccountRow[];
  learners: any[];
  legalHistory: LegalHistoryRow[];
  arrangements: PaymentArrangement[];
  handovers: LegalHandover[];
  asOfDate?: string;
}): DebtorAgeingRow[] {
  const asOfDate = input.asOfDate || new Date().toISOString().slice(0, 10);
  const runDueDates = buildRunDueDateMap();

  const learnerById = new Map<string, any>();
  for (const learner of input.learners || []) {
    const id = String(learner?.id || learner?.learnerId || "").trim();
    if (id) learnerById.set(id, learner);
  }

  return input.statementRows.map((row) => {
    const learnerId = String(row.learnerId || row.id || "").trim();
    const accountNo = String(row.accountNo || "").trim();
    const learner = learnerById.get(learnerId);
    const ledger = input.schoolId
      ? getAccountLedger(input.schoolId, learnerId, accountNo)
      : [];
    const balance = normaliseBillingAmount(row.balance);
    const ageing = calculateAgeingBuckets(ledger, asOfDate, runDueDates);
    const arrangement = getActiveArrangement(
      input.arrangements,
      learnerId,
      accountNo,
      asOfDate
    );
    const { stage, tags } = resolveLegalStageForAccount(
      learnerId,
      accountNo,
      input.legalHistory,
      input.handovers
    );
    const displayStatus = resolveDisplayStatus(
      String(row.status || ""),
      balance,
      stage,
      Boolean(arrangement)
    );

    const lastPaymentDate = String(row.lastPaymentDate || "").trim();
    const daysSincePayment = lastPaymentDate
      ? daysBetweenIso(lastPaymentDate, asOfDate)
      : null;

    return {
      learnerId,
      accountNo,
      parentName: parentFromLearner(
        learner,
        `${row.name || ""} ${row.surname || ""}`.trim()
      ),
      learnerName: `${row.name || ""} ${row.surname || ""}`.trim(),
      grade: String(learner?.grade || "").trim(),
      className: String(learner?.className || learner?.classroom || "").trim(),
      outstandingBalance: balance,
      ageing,
      statementStatus: String(row.status || "Up To Date"),
      displayStatus,
      legalStage: stage,
      legalTags: tags,
      lastPaymentDate,
      lastPaymentLabel: row.lastPayment || "No payments",
      arrangementActive: Boolean(arrangement),
      daysSincePayment,
      learner,
    };
  });
}

export function sumAgeingBuckets(rows: DebtorAgeingRow[]): AgeingBuckets {
  return rows.reduce(
    (acc, row) => ({
      current: acc.current + row.ageing.current,
      days30: acc.days30 + row.ageing.days30,
      days60: acc.days60 + row.ageing.days60,
      days90: acc.days90 + row.ageing.days90,
      days120Plus: acc.days120Plus + row.ageing.days120Plus,
    }),
    { current: 0, days30: 0, days60: 0, days90: 0, days120Plus: 0 }
  );
}

export { formatMoney };

export function statusColor(status: DebtorDisplayStatus): { bg: string; text: string; border: string } {
  switch (status) {
    case "Up To Date":
      return { bg: "#ecfdf5", text: "#047857", border: "#6ee7b7" };
    case "Recently Owing":
      return { bg: "#fffbeb", text: "#b45309", border: "#fcd34d" };
    case "Bad Debt":
      return { bg: "#fef2f2", text: "#b91c1c", border: "#fca5a5" };
    case "Legal Recovery":
      return { bg: "#f5f3ff", text: "#6d28d9", border: "#c4b5fd" };
    case "Payment Arrangement":
      return { bg: "#eff6ff", text: "#1d4ed8", border: "#93c5fd" };
    default:
      return { bg: "#f8fafc", text: "#475569", border: "#e2e8f0" };
  }
}
