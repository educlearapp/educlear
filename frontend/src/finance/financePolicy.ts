export type AccountHealth = "Excellent" | "Needs Attention" | "Action Required" | "Critical";

export type FinancePolicySettings = {
  monthlyFeeDueDay: number;
  gracePeriodDays: number;
  arrangementEligibilityDays: number;
  maximumArrangementDurationMonths: number;
  schoolSettlementDeadline: string;
  minimumMonthlyPayment: number;
  minimumUpfrontPayment: number;
  arrangementsAllowed: boolean;
  requireApproval: boolean;
  requireSupportingDocuments: boolean;
  autoCancelAfterMissedInstalments: number;
  reminderSchedule: string;
  accountHealthThresholds: {
    excellentMaxOverdueDays: number;
    needsAttentionMaxOverdueDays: number;
    actionRequiredMaxOverdueDays: number;
  };
};

export type FinanceTransaction = {
  id: string;
  date: string;
  type: string;
  learner?: string;
  reference?: string;
  description?: string;
  amountIn: number;
  amountOut: number;
  balance: number;
};

export type FinanceMonthStatus = {
  key: string;
  label: string;
  status: "Paid" | "Outstanding" | "Current";
  charged: number;
  paid: number;
  unpaid: number;
  dueDate: string;
};

export type FinanceHubSummary = {
  amountYouOwe: number;
  currentMonthFees: number;
  amountOverdue: number;
  lastPaymentAmount: number;
  lastPaymentDate: string;
  nextSchoolFeeDueDate: string;
  settlementDeadlineDate: string;
  oldestOutstandingDays: number;
  accountHealth: AccountHealth;
  nextAction: string;
  months: FinanceMonthStatus[];
  showArrangementButton: boolean;
  arrangementReason: string;
};

export const DEFAULT_FINANCE_POLICY: FinancePolicySettings = {
  monthlyFeeDueDay: 3,
  gracePeriodDays: 0,
  arrangementEligibilityDays: 60,
  maximumArrangementDurationMonths: 6,
  schoolSettlementDeadline: "11-03",
  minimumMonthlyPayment: 0,
  minimumUpfrontPayment: 0,
  arrangementsAllowed: false,
  requireApproval: true,
  requireSupportingDocuments: true,
  autoCancelAfterMissedInstalments: 1,
  reminderSchedule: "7 days before due date, on due date, 7 days after due date",
  accountHealthThresholds: {
    excellentMaxOverdueDays: 0,
    needsAttentionMaxOverdueDays: 30,
    actionRequiredMaxOverdueDays: 60,
  },
};

function clampNumber(value: unknown, fallback: number, min: number, max?: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const upper = typeof max === "number" ? Math.min(n, max) : n;
  return Math.max(min, upper);
}

export function normaliseFinancePolicySettings(value: unknown): FinancePolicySettings {
  const raw = value && typeof value === "object" ? (value as Partial<FinancePolicySettings>) : {};
  const thresholds =
    raw.accountHealthThresholds && typeof raw.accountHealthThresholds === "object"
      ? raw.accountHealthThresholds
      : DEFAULT_FINANCE_POLICY.accountHealthThresholds;
  return {
    monthlyFeeDueDay: Math.round(clampNumber(raw.monthlyFeeDueDay, DEFAULT_FINANCE_POLICY.monthlyFeeDueDay, 1, 31)),
    gracePeriodDays: Math.round(clampNumber(raw.gracePeriodDays, DEFAULT_FINANCE_POLICY.gracePeriodDays, 0, 31)),
    arrangementEligibilityDays: Math.round(
      clampNumber(raw.arrangementEligibilityDays, DEFAULT_FINANCE_POLICY.arrangementEligibilityDays, 1, 365)
    ),
    maximumArrangementDurationMonths: Math.round(
      clampNumber(
        raw.maximumArrangementDurationMonths,
        DEFAULT_FINANCE_POLICY.maximumArrangementDurationMonths,
        1,
        6
      )
    ),
    schoolSettlementDeadline: normaliseSettlementDeadline(raw.schoolSettlementDeadline),
    minimumMonthlyPayment: clampNumber(raw.minimumMonthlyPayment, DEFAULT_FINANCE_POLICY.minimumMonthlyPayment, 0),
    minimumUpfrontPayment: clampNumber(raw.minimumUpfrontPayment, DEFAULT_FINANCE_POLICY.minimumUpfrontPayment, 0),
    arrangementsAllowed: raw.arrangementsAllowed === true,
    requireApproval: raw.requireApproval !== false,
    requireSupportingDocuments: raw.requireSupportingDocuments !== false,
    autoCancelAfterMissedInstalments: Math.round(
      clampNumber(
        raw.autoCancelAfterMissedInstalments,
        DEFAULT_FINANCE_POLICY.autoCancelAfterMissedInstalments,
        1,
        12
      )
    ),
    reminderSchedule: String(raw.reminderSchedule || DEFAULT_FINANCE_POLICY.reminderSchedule),
    accountHealthThresholds: {
      excellentMaxOverdueDays: Math.round(
        clampNumber(
          thresholds.excellentMaxOverdueDays,
          DEFAULT_FINANCE_POLICY.accountHealthThresholds.excellentMaxOverdueDays,
          0,
          365
        )
      ),
      needsAttentionMaxOverdueDays: Math.round(
        clampNumber(
          thresholds.needsAttentionMaxOverdueDays,
          DEFAULT_FINANCE_POLICY.accountHealthThresholds.needsAttentionMaxOverdueDays,
          1,
          365
        )
      ),
      actionRequiredMaxOverdueDays: Math.round(
        clampNumber(
          thresholds.actionRequiredMaxOverdueDays,
          DEFAULT_FINANCE_POLICY.accountHealthThresholds.actionRequiredMaxOverdueDays,
          1,
          365
        )
      ),
    },
  };
}

export function formatFinanceMoney(value: unknown) {
  const n = Number(value);
  const amount = Number.isFinite(n) ? n : 0;
  return `R ${amount.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatFinanceDate(iso: string) {
  if (!iso) return "Not set";
  const date = parseIsoDate(iso);
  if (!date) return "Not set";
  return date.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

export function buildFinanceHubSummary(input: {
  transactions: FinanceTransaction[];
  balance: number;
  policy: FinancePolicySettings;
  today?: string;
  activeArrangementExists?: boolean;
}): FinanceHubSummary {
  const today = input.today || toIsoDate(new Date());
  const policy = normaliseFinancePolicySettings(input.policy);
  const balance = Math.max(0, roundMoney(input.balance));
  const rows = [...(input.transactions || [])].sort((a, b) => safeDate(a.date).localeCompare(safeDate(b.date)));
  const currentMonth = today.slice(0, 7);
  const currentMonthFees = roundMoney(
    rows
      .filter((row) => safeDate(row.date).slice(0, 7) === currentMonth)
      .reduce((sum, row) => sum + positive(row.amountOut), 0)
  );
  const lastPayment = [...rows].reverse().find((row) => positive(row.amountIn) > 0);
  const unpaidLines = allocateUnpaidCharges(rows, policy);
  const overdueLines = unpaidLines.filter((line) => line.dueDate < today);
  const amountOverdue = roundMoney(overdueLines.reduce((sum, line) => sum + line.unpaid, 0));
  const oldestOutstandingDays = overdueLines.length
    ? Math.max(...overdueLines.map((line) => daysBetween(line.dueDate, today)))
    : 0;
  const accountHealth = resolveAccountHealth(balance, oldestOutstandingDays, policy);
  const nextDue = nextSchoolFeeDueDate(today, policy);
  const settlementDeadlineDate = nextSettlementDeadline(today, policy.schoolSettlementDeadline);
  const months = buildMonthStatuses(rows, unpaidLines, policy, today);
  const arrangement = resolveArrangementVisibility({
    amountYouOwe: balance,
    amountOverdue,
    oldestOutstandingDays,
    today,
    settlementDeadlineDate,
    policy,
    activeArrangementExists: input.activeArrangementExists === true,
  });

  return {
    amountYouOwe: balance,
    currentMonthFees,
    amountOverdue,
    lastPaymentAmount: positive(lastPayment?.amountIn),
    lastPaymentDate: safeDate(lastPayment?.date),
    nextSchoolFeeDueDate: nextDue,
    settlementDeadlineDate,
    oldestOutstandingDays,
    accountHealth,
    nextAction: nextActionFor(accountHealth, balance, amountOverdue, arrangement.show),
    months,
    showArrangementButton: arrangement.show,
    arrangementReason: arrangement.reason,
  };
}

function normaliseSettlementDeadline(value: unknown) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!match) return DEFAULT_FINANCE_POLICY.schoolSettlementDeadline;
  const month = Math.min(12, Math.max(1, Number(match[1]))).toString().padStart(2, "0");
  const day = Math.min(31, Math.max(1, Number(match[2]))).toString().padStart(2, "0");
  return `${month}-${day}`;
}

function parseIsoDate(iso: string) {
  const normalized = safeDate(iso);
  if (!normalized) return null;
  const date = new Date(`${normalized}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeDate(value: unknown) {
  const raw = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function positive(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function daysBetween(fromIso: string, toIso: string) {
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIso);
  if (!from || !to) return 0;
  return Math.floor((to.getTime() - from.getTime()) / 86400000);
}

function dueDateForMonth(monthKey: string, policy: FinancePolicySettings) {
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const day = Math.min(policy.monthlyFeeDueDay, lastDay);
  const base = new Date(year, month - 1, day + policy.gracePeriodDays, 12);
  return toIsoDate(base);
}

function allocateUnpaidCharges(rows: FinanceTransaction[], policy: FinancePolicySettings) {
  const charges = rows
    .filter((row) => positive(row.amountOut) > 0)
    .map((row) => {
      const date = safeDate(row.date);
      const monthKey = date ? date.slice(0, 7) : "";
      return {
        id: row.id,
        monthKey,
        date,
        dueDate: monthKey ? dueDateForMonth(monthKey, policy) : date,
        unpaid: positive(row.amountOut),
      };
    })
    .filter((line) => line.date && line.dueDate);
  let credit = rows.reduce((sum, row) => sum + positive(row.amountIn), 0);
  for (const charge of charges) {
    const applied = Math.min(charge.unpaid, credit);
    charge.unpaid = roundMoney(charge.unpaid - applied);
    credit = roundMoney(credit - applied);
  }
  return charges.filter((charge) => charge.unpaid > 0);
}

function buildMonthStatuses(
  rows: FinanceTransaction[],
  unpaidLines: ReturnType<typeof allocateUnpaidCharges>,
  policy: FinancePolicySettings,
  today: string
): FinanceMonthStatus[] {
  const monthKeys = new Set<string>();
  for (const row of rows) {
    const date = safeDate(row.date);
    if (date) monthKeys.add(date.slice(0, 7));
  }
  monthKeys.add(today.slice(0, 7));
  return Array.from(monthKeys)
    .sort()
    .slice(-8)
    .map((key) => {
      const monthRows = rows.filter((row) => safeDate(row.date).slice(0, 7) === key);
      const charged = roundMoney(monthRows.reduce((sum, row) => sum + positive(row.amountOut), 0));
      const paid = roundMoney(monthRows.reduce((sum, row) => sum + positive(row.amountIn), 0));
      const unpaid = roundMoney(unpaidLines.filter((line) => line.monthKey === key).reduce((sum, line) => sum + line.unpaid, 0));
      return {
        key,
        label: monthLabel(key),
        status: key === today.slice(0, 7) ? "Current" : unpaid > 0 ? "Outstanding" : "Paid",
        charged,
        paid,
        unpaid,
        dueDate: dueDateForMonth(key, policy),
      };
    });
}

function monthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1, 12).toLocaleDateString("en-ZA", { month: "short", year: "numeric" });
}

function nextSchoolFeeDueDate(today: string, policy: FinancePolicySettings) {
  const currentDue = dueDateForMonth(today.slice(0, 7), policy);
  if (currentDue >= today) return currentDue;
  const current = parseIsoDate(`${today.slice(0, 7)}-01`) || new Date();
  const next = new Date(current.getFullYear(), current.getMonth() + 1, 1, 12);
  return dueDateForMonth(toIsoDate(next).slice(0, 7), policy);
}

function nextSettlementDeadline(today: string, deadline: string) {
  const [month, day] = normaliseSettlementDeadline(deadline).split("-").map(Number);
  const current = parseIsoDate(today) || new Date();
  let date = new Date(current.getFullYear(), month - 1, day, 12);
  if (toIsoDate(date) < today) date = new Date(current.getFullYear() + 1, month - 1, day, 12);
  return toIsoDate(date);
}

function addMonths(iso: string, months: number) {
  const date = parseIsoDate(iso) || new Date();
  date.setMonth(date.getMonth() + months);
  return toIsoDate(date);
}

function monthsUntil(fromIso: string, toIso: string) {
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIso);
  if (!from || !to || to < from) return 0;
  return Math.max(1, (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth() + 1);
}

function resolveAccountHealth(balance: number, oldestOutstandingDays: number, policy: FinancePolicySettings): AccountHealth {
  if (balance <= 0) return "Excellent";
  const thresholds = policy.accountHealthThresholds;
  if (oldestOutstandingDays <= thresholds.excellentMaxOverdueDays) return "Excellent";
  if (oldestOutstandingDays <= thresholds.needsAttentionMaxOverdueDays) return "Needs Attention";
  if (oldestOutstandingDays <= thresholds.actionRequiredMaxOverdueDays) return "Action Required";
  return "Critical";
}

function resolveArrangementVisibility(input: {
  amountYouOwe: number;
  amountOverdue: number;
  oldestOutstandingDays: number;
  today: string;
  settlementDeadlineDate: string;
  policy: FinancePolicySettings;
  activeArrangementExists: boolean;
}) {
  if (!input.policy.arrangementsAllowed) return { show: false, reason: "Your school has not enabled payment plans." };
  if (input.activeArrangementExists) return { show: false, reason: "An active payment plan already exists." };
  if (input.oldestOutstandingDays <= input.policy.arrangementEligibilityDays) {
    return { show: false, reason: "Payment plans open after the school arrears threshold is reached." };
  }
  if (input.amountOverdue <= 0 || input.amountYouOwe <= 0) {
    return { show: false, reason: "There are no overdue payments requiring an arrangement." };
  }
  const cappedMonths = Math.min(6, input.policy.maximumArrangementDurationMonths);
  const monthsAvailable = Math.min(cappedMonths, monthsUntil(input.today, input.settlementDeadlineDate));
  if (monthsAvailable <= 0) {
    return { show: false, reason: "The arrangement would finish after the school settlement deadline." };
  }
  if (input.policy.minimumUpfrontPayment > input.amountYouOwe) {
    return { show: false, reason: "The account does not meet the school's minimum upfront payment rule." };
  }
  return { show: true, reason: "You may request a payment plan for school review." };
}

function nextActionFor(
  accountHealth: AccountHealth,
  balance: number,
  overdue: number,
  showArrangementButton: boolean
) {
  if (balance <= 0) return "Your account is up to date. Keep your next school fee date in mind.";
  if (showArrangementButton) return "Request a payment plan or make a payment and upload proof.";
  if (overdue > 0) return "Please make a payment or contact the school finance office.";
  if (accountHealth === "Excellent") return "Plan for the next school fee due date.";
  return "Please review your balance and recent payments.";
}
