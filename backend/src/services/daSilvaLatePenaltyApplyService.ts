import {
  buildDaSilvaPenaltyPreview,
  calculateDaSilvaPenaltyAmount,
  isActivePenaltyLearner,
  isDaSilvaLatePenaltySchoolAllowed,
  isOutstandingEligibleForPenalty,
  normalizePenaltyMonth,
  roundPenaltyMoney,
  type DaSilvaPenaltyAccountInput,
  type DaSilvaPenaltyPreviewRow,
} from "./daSilvaLatePenaltyEngine";
import {
  assembleDaSilvaPenaltyAccountInputs,
  collectAppliedDaSilvaPenaltyKeys,
  type DaSilvaLearnerSnapshot,
  type DaSilvaStatementAccountSnapshot,
} from "./daSilvaLatePenaltyPreviewService";
import { readSchoolBillingPlansResolved } from "./learnerBillingPlanDbStore";
import { buildAccountsFromAgeAnalysisSnapshots } from "./statementAccounts";
import { prisma } from "../prisma";
import {
  appendSchoolEntrySafe,
  readSchoolLedger,
  type AppendSchoolEntryResult,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";

export type DaSilvaPenaltyApplyRowStatus = "posted" | "skipped" | "error";

export type DaSilvaPenaltyApplyRowResult = {
  accountRef: string;
  status: DaSilvaPenaltyApplyRowStatus;
  reason: string;
  penaltyAmount?: number;
  idempotencyKey?: string;
  ledgerEntryId?: string;
};

export type DaSilvaPenaltyApplyResult = {
  success: boolean;
  schoolAllowed: boolean;
  penaltyMonth: string;
  postedCount: number;
  skippedCount: number;
  errorCount: number;
  totalPostedAmount: number;
  rows: DaSilvaPenaltyApplyRowResult[];
};

export type DaSilvaPenaltyApplyAppendFn = (
  entry: BillingLedgerEntry
) => AppendSchoolEntryResult;

/** Last calendar day of penalty month as YYYY-MM-DD ledger date. */
export function penaltyMonthToLedgerDate(penaltyMonth: string): string {
  const month = normalizePenaltyMonth(penaltyMonth);
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText);
  if (!year || !monthIndex) return new Date().toISOString().slice(0, 10);
  const lastDay = new Date(year, monthIndex, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

export function resolveAnchorLearnerId(account: DaSilvaPenaltyAccountInput): string {
  const active = (account.learners || []).filter(isActivePenaltyLearner);
  const first = active[0] || account.learners?.[0];
  return String(first?.id || "").trim();
}

export function buildDaSilvaPenaltyLedgerEntry(input: {
  schoolId: string;
  row: DaSilvaPenaltyPreviewRow;
  anchorLearnerId: string;
  penaltyAmount: number;
  createdAt?: string;
}): BillingLedgerEntry {
  const { schoolId, row, anchorLearnerId } = input;
  const penaltyMonth = normalizePenaltyMonth(row.penaltyMonth);
  const outstanding = roundPenaltyMoney(row.outstandingBalance);
  const threshold = roundPenaltyMoney(row.monthlyFeeThreshold);
  const amount = roundPenaltyMoney(input.penaltyAmount);
  const date = penaltyMonthToLedgerDate(penaltyMonth);

  return {
    id: row.idempotencyKey,
    schoolId,
    learnerId: anchorLearnerId,
    accountNo: row.accountRef,
    type: "penalty",
    amount,
    date,
    dueDate: date,
    reference: `PEN-${penaltyMonth}`,
    description: `Da Silva late payment penalty (10%) — outstanding R${outstanding}, threshold R${threshold}, month ${penaltyMonth}`,
    invoicePeriod: penaltyMonth,
    source: "da-silva-late-penalty",
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

function normalizeSelectedAccountRefs(accountRefs: string[]): string[] {
  return Array.from(
    new Set(accountRefs.map((ref) => String(ref || "").trim().toUpperCase()).filter(Boolean))
  );
}

/**
 * Apply selected account refs using authoritative preview rows (never trust client amounts).
 * Injectable append fn supports isolated in-memory tests.
 */
export function applySelectedDaSilvaPenaltyRows(input: {
  schoolId: string;
  penaltyMonth: string;
  selectedAccountRefs: string[];
  authoritativeRowsByRef: Map<string, DaSilvaPenaltyPreviewRow>;
  anchorLearnerByRef: Map<string, string>;
  appendEntry: DaSilvaPenaltyApplyAppendFn;
}): DaSilvaPenaltyApplyResult {
  const schoolId = String(input.schoolId || "").trim();
  const penaltyMonth = normalizePenaltyMonth(input.penaltyMonth);
  const selected = normalizeSelectedAccountRefs(input.selectedAccountRefs);
  const rows: DaSilvaPenaltyApplyRowResult[] = [];

  if (!isDaSilvaLatePenaltySchoolAllowed(schoolId)) {
    return {
      success: false,
      schoolAllowed: false,
      penaltyMonth,
      postedCount: 0,
      skippedCount: selected.length,
      errorCount: 0,
      totalPostedAmount: 0,
      rows: selected.map((accountRef) => ({
        accountRef,
        status: "skipped",
        reason: "school_not_allowed",
      })),
    };
  }

  for (const accountRef of selected) {
    const row = input.authoritativeRowsByRef.get(accountRef);
    if (!row) {
      rows.push({
        accountRef,
        status: "skipped",
        reason: "invalid_account_ref",
      });
      continue;
    }

    if (row.alreadyApplied) {
      rows.push({
        accountRef,
        status: "skipped",
        reason: "already_applied",
        idempotencyKey: row.idempotencyKey,
      });
      continue;
    }

    if (!row.eligible || row.reason !== "eligible") {
      rows.push({
        accountRef,
        status: "skipped",
        reason: row.reason || "not_eligible",
        idempotencyKey: row.idempotencyKey,
      });
      continue;
    }

    if (!isOutstandingEligibleForPenalty(row.outstandingBalance, row.monthlyFeeThreshold)) {
      rows.push({
        accountRef,
        status: "skipped",
        reason: "not_eligible_at_apply",
        idempotencyKey: row.idempotencyKey,
      });
      continue;
    }

    const authoritativeAmount = calculateDaSilvaPenaltyAmount(row.outstandingBalance);
    if (authoritativeAmount <= 0) {
      rows.push({
        accountRef,
        status: "skipped",
        reason: "zero_penalty_amount",
        idempotencyKey: row.idempotencyKey,
      });
      continue;
    }

    const anchorLearnerId = String(input.anchorLearnerByRef.get(accountRef) || "").trim();
    if (!anchorLearnerId) {
      rows.push({
        accountRef,
        status: "skipped",
        reason: "missing_anchor_learner",
        idempotencyKey: row.idempotencyKey,
      });
      continue;
    }

    try {
      const entry = buildDaSilvaPenaltyLedgerEntry({
        schoolId,
        row,
        anchorLearnerId,
        penaltyAmount: authoritativeAmount,
      });
      const result = input.appendEntry(entry);
      if (result.created) {
        rows.push({
          accountRef,
          status: "posted",
          reason: "posted",
          penaltyAmount: entry.amount,
          idempotencyKey: entry.id,
          ledgerEntryId: result.entry.id,
        });
      } else {
        rows.push({
          accountRef,
          status: "skipped",
          reason: result.duplicateReason === "id" ? "already_applied" : "duplicate_entry",
          penaltyAmount: result.entry.amount,
          idempotencyKey: result.entry.id,
          ledgerEntryId: result.entry.id,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "apply_failed";
      rows.push({
        accountRef,
        status: "error",
        reason: message,
        idempotencyKey: row.idempotencyKey,
      });
    }
  }

  const posted = rows.filter((row) => row.status === "posted");
  const skipped = rows.filter((row) => row.status === "skipped");
  const errors = rows.filter((row) => row.status === "error");

  return {
    success: errors.length === 0,
    schoolAllowed: true,
    penaltyMonth,
    postedCount: posted.length,
    skippedCount: skipped.length,
    errorCount: errors.length,
    totalPostedAmount: roundPenaltyMoney(
      posted.reduce((sum, row) => sum + (Number(row.penaltyAmount) || 0), 0)
    ),
    rows,
  };
}

async function loadAuthoritativeApplyContext(input: {
  schoolId: string;
  penaltyMonth: string;
  accountRefs?: string[];
}): Promise<{
  penaltyMonth: string;
  accounts: DaSilvaPenaltyAccountInput[];
  rows: DaSilvaPenaltyPreviewRow[];
}> {
  const schoolId = String(input.schoolId || "").trim();
  const penaltyMonth = normalizePenaltyMonth(input.penaltyMonth);
  if (!penaltyMonth) {
    throw new Error("penaltyMonth must be YYYY-MM");
  }

  const [statementAccounts, plansByLearnerId, ledger] = await Promise.all([
    buildAccountsFromAgeAnalysisSnapshots(schoolId),
    readSchoolBillingPlansResolved(schoolId),
    Promise.resolve(readSchoolLedger(schoolId)),
  ]);

  const learnerIds = new Set<string>();
  for (const account of statementAccounts) {
    for (const id of account.memberLearnerIds || []) {
      if (id) learnerIds.add(id);
    }
  }

  const learners =
    learnerIds.size > 0
      ? await prisma.learner.findMany({
          where: { schoolId, id: { in: Array.from(learnerIds) } },
          select: {
            id: true,
            enrollmentStatus: true,
            firstName: true,
            lastName: true,
          },
        })
      : [];

  const learnerSnapshots: DaSilvaLearnerSnapshot[] = learners.map((learner) => ({
    id: learner.id,
    enrollmentStatus: learner.enrollmentStatus,
    firstName: learner.firstName,
    lastName: learner.lastName,
    billingPlan: (plansByLearnerId[learner.id] || []).map((fee) => ({
      feeDescription: fee.feeDescription,
      amount: fee.amount,
    })),
  }));

  const learnersById = new Map(learnerSnapshots.map((learner) => [learner.id, learner]));
  const accounts = assembleDaSilvaPenaltyAccountInputs({
    statementAccounts: statementAccounts.map((row) => ({
      accountNo: row.accountNo,
      balance: row.balance,
      accountHolder: row.accountHolder,
      memberLearnerIds: row.memberLearnerIds,
      memberNames: row.memberNames,
      status: row.status,
      kidesysSection: row.kidesysSection,
    })) as DaSilvaStatementAccountSnapshot[],
    learnersById,
    plansByLearnerId,
    accountRefs: input.accountRefs,
  });

  const appliedIdempotencyKeys = collectAppliedDaSilvaPenaltyKeys(schoolId, ledger);
  const preview = buildDaSilvaPenaltyPreview({
    schoolId,
    accounts,
    penaltyMonth,
    appliedIdempotencyKeys,
  });

  return {
    penaltyMonth,
    accounts,
    rows: preview.rows,
  };
}

/** Manual apply — re-evaluates each selected account before posting. */
export async function applyDaSilvaLatePenalties(input: {
  schoolId: string;
  penaltyMonth: string;
  selectedAccountRefs: string[];
}): Promise<DaSilvaPenaltyApplyResult> {
  const schoolId = String(input.schoolId || "").trim();
  const penaltyMonth = normalizePenaltyMonth(input.penaltyMonth);
  const selectedAccountRefs = normalizeSelectedAccountRefs(input.selectedAccountRefs || []);

  if (!schoolId) {
    throw new Error("Missing schoolId");
  }
  if (!penaltyMonth) {
    throw new Error("penaltyMonth must be YYYY-MM");
  }
  if (!selectedAccountRefs.length) {
    throw new Error("No accounts selected for apply");
  }

  if (!isDaSilvaLatePenaltySchoolAllowed(schoolId)) {
    return {
      success: false,
      schoolAllowed: false,
      penaltyMonth,
      postedCount: 0,
      skippedCount: selectedAccountRefs.length,
      errorCount: 0,
      totalPostedAmount: 0,
      rows: selectedAccountRefs.map((accountRef) => ({
        accountRef,
        status: "skipped",
        reason: "school_not_allowed",
      })),
    };
  }

  const context = await loadAuthoritativeApplyContext({
    schoolId,
    penaltyMonth,
    accountRefs: selectedAccountRefs,
  });

  const authoritativeRowsByRef = new Map(
    context.rows.map((row) => [row.accountRef.toUpperCase(), row])
  );
  const anchorLearnerByRef = new Map(
    context.accounts.map((account) => [
      account.accountRef.toUpperCase(),
      resolveAnchorLearnerId(account),
    ])
  );

  return applySelectedDaSilvaPenaltyRows({
    schoolId,
    penaltyMonth,
    selectedAccountRefs,
    authoritativeRowsByRef,
    anchorLearnerByRef,
    appendEntry: (entry) => appendSchoolEntrySafe(schoolId, entry),
  });
}
