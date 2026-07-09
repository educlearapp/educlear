import { isDaSilvaSchoolId } from "./daSilvaSchoolResolve";

/** Da Silva late penalty: 10% of positive outstanding above one month's recurring fees. */
export const DA_SILVA_LATE_PENALTY_RATE = 0.1;

export type DaSilvaBillingPlanFee = {
  feeDescription: string;
  amount: number;
  type?: string;
  frequency?: string;
};

export type DaSilvaPenaltyLearner = {
  id: string;
  enrollmentStatus?: string;
  learnerName?: string;
  planFees: DaSilvaBillingPlanFee[];
};

export type DaSilvaPenaltyAccountInput = {
  accountRef: string;
  accountHolder?: string;
  learnerNames?: string[];
  outstandingBalance: number;
  learners: DaSilvaPenaltyLearner[];
};

export type DaSilvaPenaltyEligibilityReason =
  | "eligible"
  | "school_not_allowed"
  | "zero_or_negative_balance"
  | "balance_not_above_threshold"
  | "no_active_learners"
  | "no_recurring_monthly_fees"
  | "already_applied";

export type DaSilvaPenaltyPreviewRow = {
  accountRef: string;
  accountHolder: string;
  learnerNames: string[];
  /** Active learners linked to this billing account. */
  linkedLearnerCount: number;
  outstandingBalance: number;
  monthlyFeeThreshold: number;
  /** Outstanding divided by combined monthly recurring fees (null when threshold is 0). */
  monthsBehind: number | null;
  penaltyAmount: number;
  eligible: boolean;
  /** Machine-readable eligibility code. */
  reason: DaSilvaPenaltyEligibilityReason;
  /** Operator-facing explanation of eligibility outcome. */
  eligibilityReason: string;
  alreadyApplied: boolean;
  apply: boolean;
  idempotencyKey: string;
  penaltyMonth: string;
};

const ONCE_OFF_TOKENS = new Set([
  "ONCE_OFF",
  "ONCE-OFF",
  "ONCE OFF",
  "EXTRA",
  "MANUAL",
]);

const RECURRING_TOKENS = new Set([
  "MONTHLY",
  "MONTHLY_EXCL_DEC",
  "MONTHLY_EXCL_NOV_DEC",
]);

const ONCE_OFF_DESCRIPTION = /\b(once[\s-]?off|leadership\s+camp|excursion|deposit)\b/i;

function normalizeToken(value: unknown): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

export function roundPenaltyMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/** Normalise penalty month to YYYY-MM. */
export function normalizePenaltyMonth(value: string): string {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const iso = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.slice(0, 7);
  return "";
}

export function isDaSilvaLatePenaltySchoolAllowed(schoolId: string): boolean {
  return isDaSilvaSchoolId(schoolId);
}

export function assertDaSilvaLatePenaltySchool(schoolId: string): void {
  if (!isDaSilvaLatePenaltySchoolAllowed(schoolId)) {
    throw new Error("Late penalty engine is only available for Da Silva Academy.");
  }
}

/**
 * Idempotency key: one penalty per accountRef per penalty month.
 * Format: penalty-{schoolId}-{accountRef}-{YYYY-MM}
 */
export function buildDaSilvaPenaltyIdempotencyKey(
  schoolId: string,
  accountRef: string,
  penaltyMonth: string
): string {
  const sid = String(schoolId || "").trim();
  const ref = String(accountRef || "").trim().toUpperCase();
  const month = normalizePenaltyMonth(penaltyMonth);
  return `penalty-${sid}-${ref}-${month}`;
}

export function isRecurringMonthlyPlanFee(fee: DaSilvaBillingPlanFee): boolean {
  const amount = Number(fee.amount);
  if (!Number.isFinite(amount) || amount <= 0) return false;

  const tokens = [fee.frequency, fee.type].map(normalizeToken).filter(Boolean);
  for (const token of tokens) {
    if (ONCE_OFF_TOKENS.has(token)) return false;
  }
  for (const token of tokens) {
    if (RECURRING_TOKENS.has(token)) return true;
  }

  const typeLabel = String(fee.type || fee.frequency || "").toLowerCase();
  if (typeLabel.includes("once")) return false;
  if (typeLabel.includes("monthly")) return true;

  const description = String(fee.feeDescription || "");
  if (ONCE_OFF_DESCRIPTION.test(description)) return false;

  // DB-backed Da Silva plan lines store feeDescription + amount only (monthly tuition).
  return true;
}

export function isActivePenaltyLearner(learner: DaSilvaPenaltyLearner): boolean {
  const status = String(learner.enrollmentStatus || "ACTIVE").trim().toUpperCase();
  return status === "ACTIVE";
}

export function sumLearnerMonthlyRecurringFees(learner: DaSilvaPenaltyLearner): number {
  if (!isActivePenaltyLearner(learner)) return 0;
  return roundPenaltyMoney(
    (learner.planFees || [])
      .filter(isRecurringMonthlyPlanFee)
      .reduce((sum, fee) => sum + (Number(fee.amount) || 0), 0)
  );
}

export function sumAccountMonthlyRecurringFees(learners: DaSilvaPenaltyLearner[]): number {
  return roundPenaltyMoney(
    (learners || []).reduce((sum, learner) => sum + sumLearnerMonthlyRecurringFees(learner), 0)
  );
}

export function calculateDaSilvaPenaltyAmount(outstandingBalance: number): number {
  const outstanding = roundPenaltyMoney(outstandingBalance);
  if (outstanding <= 0) return 0;
  return roundPenaltyMoney(outstanding * DA_SILVA_LATE_PENALTY_RATE);
}

/** Eligible only when outstanding is strictly greater than one month's recurring fees. */
export function isOutstandingEligibleForPenalty(
  outstandingBalance: number,
  monthlyFeeThreshold: number
): boolean {
  const outstanding = roundPenaltyMoney(outstandingBalance);
  const threshold = roundPenaltyMoney(monthlyFeeThreshold);
  if (outstanding <= 0) return false;
  if (threshold <= 0) return false;
  return outstanding > threshold;
}

/** Months of fees represented by the current outstanding balance. */
export function computePenaltyMonthsBehind(
  outstandingBalance: number,
  monthlyFeeThreshold: number
): number | null {
  const outstanding = roundPenaltyMoney(outstandingBalance);
  const threshold = roundPenaltyMoney(monthlyFeeThreshold);
  if (threshold <= 0) return null;
  return roundPenaltyMoney(outstanding / threshold);
}

export function formatDaSilvaEligibilityReason(
  reason: DaSilvaPenaltyEligibilityReason,
  ctx: { outstandingBalance: number; monthlyFeeThreshold: number; penaltyAmount: number }
): string {
  const outstanding = roundPenaltyMoney(ctx.outstandingBalance);
  const threshold = roundPenaltyMoney(ctx.monthlyFeeThreshold);
  const penalty = roundPenaltyMoney(ctx.penaltyAmount);
  const monthsBehind = computePenaltyMonthsBehind(outstanding, threshold);

  switch (reason) {
    case "eligible":
      return `Eligible: outstanding R${outstanding} is more than one month's fees (R${threshold}); ~${monthsBehind} month(s) behind; penalty 10% = R${penalty}.`;
    case "school_not_allowed":
      return "Late penalty preview is only available for Da Silva Academy.";
    case "already_applied":
      return "Penalty already applied for this account in the selected penalty month.";
    case "no_active_learners":
      return "No active learners are linked to this billing account.";
    case "no_recurring_monthly_fees":
      return "No active recurring monthly billing plan fees found for this account.";
    case "zero_or_negative_balance":
      return outstanding < 0
        ? `Account is overpaid (R${outstanding}); no penalty applies.`
        : "Account has no outstanding balance; no penalty applies.";
    case "balance_not_above_threshold":
      return `Outstanding R${outstanding} is not more than one month's fees (R${threshold}); ~${monthsBehind ?? 0} month(s) behind.`;
    default:
      return String(reason);
  }
}

export function finalizeDaSilvaPenaltyPreviewRow(
  row: Omit<DaSilvaPenaltyPreviewRow, "monthsBehind" | "eligibilityReason">
): DaSilvaPenaltyPreviewRow {
  const monthsBehind = computePenaltyMonthsBehind(row.outstandingBalance, row.monthlyFeeThreshold);
  return {
    ...row,
    monthsBehind,
    eligibilityReason: formatDaSilvaEligibilityReason(row.reason, {
      outstandingBalance: row.outstandingBalance,
      monthlyFeeThreshold: row.monthlyFeeThreshold,
      penaltyAmount: row.penaltyAmount,
    }),
  };
}

export type DaSilvaPenaltyRuleVerification = {
  matches: boolean;
  checks: string[];
};

/** Verify a preview row still matches the Da Silva penalty business rules. */
export function verifyDaSilvaPenaltyPreviewRow(row: DaSilvaPenaltyPreviewRow): DaSilvaPenaltyRuleVerification {
  const checks: string[] = [];
  const outstanding = roundPenaltyMoney(row.outstandingBalance);
  const threshold = roundPenaltyMoney(row.monthlyFeeThreshold);
  const expectedPenalty = calculateDaSilvaPenaltyAmount(outstanding);
  const expectedMonths = computePenaltyMonthsBehind(outstanding, threshold);
  const ruleEligible =
    row.reason !== "school_not_allowed" &&
    row.reason !== "already_applied" &&
    row.reason !== "no_active_learners" &&
    row.reason !== "no_recurring_monthly_fees" &&
    isOutstandingEligibleForPenalty(outstanding, threshold);

  checks.push(
    row.penaltyAmount === (row.eligible ? expectedPenalty : 0)
      ? "penaltyAmount matches 10% rule"
      : `penaltyAmount mismatch (got R${row.penaltyAmount}, expected R${row.eligible ? expectedPenalty : 0})`
  );
  checks.push(
    row.monthsBehind === expectedMonths
      ? "monthsBehind matches outstanding/threshold"
      : `monthsBehind mismatch (got ${row.monthsBehind}, expected ${expectedMonths})`
  );
  checks.push(row.eligible === (row.reason === "eligible") ? "eligible flag matches reason" : `eligible=${row.eligible} reason=${row.reason}`);
  checks.push(
    row.eligible === ruleEligible || row.reason === "already_applied"
      ? "eligibility aligns with threshold rule"
      : `eligibility mismatch (eligible=${row.eligible}, ruleEligible=${ruleEligible})`
  );
  if (row.eligible) {
    checks.push(outstanding > threshold ? "outstanding > monthly threshold" : "FAIL: outstanding not above threshold");
  }

  const matches = checks.every((c) => !c.startsWith("FAIL") && !c.includes("mismatch"));
  return { matches, checks };
}

function normalizeAppliedKeys(applied?: Set<string> | string[]): Set<string> {
  if (!applied) return new Set();
  if (applied instanceof Set) return applied;
  return new Set(applied.map((key) => String(key || "").trim()).filter(Boolean));
}

function resolveLearnerNames(account: DaSilvaPenaltyAccountInput): string[] {
  if (Array.isArray(account.learnerNames) && account.learnerNames.length) {
    return account.learnerNames.map((name) => String(name || "").trim()).filter(Boolean);
  }
  return (account.learners || [])
    .map((learner) => String(learner.learnerName || "").trim())
    .filter(Boolean);
}

export function evaluateDaSilvaPenaltyAccount(input: {
  schoolId: string;
  account: DaSilvaPenaltyAccountInput;
  penaltyMonth: string;
  appliedIdempotencyKeys?: Set<string> | string[];
}): DaSilvaPenaltyPreviewRow {
  const schoolId = String(input.schoolId || "").trim();
  const penaltyMonth = normalizePenaltyMonth(input.penaltyMonth);
  const accountRef = String(input.account?.accountRef || "").trim().toUpperCase();
  const accountHolder = String(input.account?.accountHolder || "").trim();
  const learnerNames = resolveLearnerNames(input.account);
  const appliedKeys = normalizeAppliedKeys(input.appliedIdempotencyKeys);
  const idempotencyKey = buildDaSilvaPenaltyIdempotencyKey(schoolId, accountRef, penaltyMonth);

  const baseRow = {
    accountRef,
    accountHolder,
    learnerNames,
    linkedLearnerCount: (input.account?.learners || []).filter(isActivePenaltyLearner).length,
    penaltyMonth,
    idempotencyKey,
  };

  const done = (
    row: Omit<DaSilvaPenaltyPreviewRow, "monthsBehind" | "eligibilityReason">
  ): DaSilvaPenaltyPreviewRow => finalizeDaSilvaPenaltyPreviewRow(row);

  if (!isDaSilvaLatePenaltySchoolAllowed(schoolId)) {
    return done({
      ...baseRow,
      outstandingBalance: roundPenaltyMoney(input.account?.outstandingBalance ?? 0),
      monthlyFeeThreshold: 0,
      penaltyAmount: 0,
      eligible: false,
      reason: "school_not_allowed",
      alreadyApplied: false,
      apply: false,
    });
  }

  const activeLearners = (input.account?.learners || []).filter(isActivePenaltyLearner);
  const outstandingBalance = roundPenaltyMoney(input.account?.outstandingBalance ?? 0);
  const monthlyFeeThreshold = sumAccountMonthlyRecurringFees(activeLearners);
  const alreadyApplied = appliedKeys.has(idempotencyKey);

  if (alreadyApplied) {
    return done({
      ...baseRow,
      outstandingBalance,
      monthlyFeeThreshold,
      penaltyAmount: 0,
      eligible: false,
      reason: "already_applied",
      alreadyApplied: true,
      apply: false,
    });
  }

  if (!activeLearners.length) {
    return done({
      ...baseRow,
      outstandingBalance,
      monthlyFeeThreshold,
      penaltyAmount: 0,
      eligible: false,
      reason: "no_active_learners",
      alreadyApplied: false,
      apply: false,
    });
  }

  if (monthlyFeeThreshold <= 0) {
    return done({
      ...baseRow,
      outstandingBalance,
      monthlyFeeThreshold,
      penaltyAmount: 0,
      eligible: false,
      reason: "no_recurring_monthly_fees",
      alreadyApplied: false,
      apply: false,
    });
  }

  if (outstandingBalance <= 0) {
    return done({
      ...baseRow,
      outstandingBalance,
      monthlyFeeThreshold,
      penaltyAmount: 0,
      eligible: false,
      reason: "zero_or_negative_balance",
      alreadyApplied: false,
      apply: false,
    });
  }

  if (!isOutstandingEligibleForPenalty(outstandingBalance, monthlyFeeThreshold)) {
    return done({
      ...baseRow,
      outstandingBalance,
      monthlyFeeThreshold,
      penaltyAmount: 0,
      eligible: false,
      reason: "balance_not_above_threshold",
      alreadyApplied: false,
      apply: false,
    });
  }

  const penaltyAmount = calculateDaSilvaPenaltyAmount(outstandingBalance);
  return done({
    ...baseRow,
    outstandingBalance,
    monthlyFeeThreshold,
    penaltyAmount,
    eligible: true,
    reason: "eligible",
    alreadyApplied: false,
    apply: true,
  });
}

export function buildDaSilvaPenaltyPreview(input: {
  schoolId: string;
  accounts: DaSilvaPenaltyAccountInput[];
  penaltyMonth: string;
  appliedIdempotencyKeys?: Set<string> | string[];
}): { schoolAllowed: boolean; rows: DaSilvaPenaltyPreviewRow[] } {
  const schoolId = String(input.schoolId || "").trim();
  const schoolAllowed = isDaSilvaLatePenaltySchoolAllowed(schoolId);
  const rows = (input.accounts || []).map((account) =>
    evaluateDaSilvaPenaltyAccount({
      schoolId,
      account,
      penaltyMonth: input.penaltyMonth,
      appliedIdempotencyKeys: input.appliedIdempotencyKeys,
    })
  );
  return { schoolAllowed, rows };
}
