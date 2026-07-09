import { DA_SILVA_ACADEMY_SCHOOL_ID } from "./activateDaSilvaSubscription";
import {
  buildDaSilvaPenaltyIdempotencyKey,
  buildDaSilvaPenaltyPreview,
  isDaSilvaLatePenaltySchoolAllowed,
  normalizePenaltyMonth,
  roundPenaltyMoney,
  type DaSilvaBillingPlanFee,
  type DaSilvaPenaltyAccountInput,
  type DaSilvaPenaltyLearner,
  type DaSilvaPenaltyPreviewRow,
} from "./daSilvaLatePenaltyEngine";
import { readSchoolBillingPlansResolved } from "./learnerBillingPlanDbStore";
import { buildAccountsFromAgeAnalysisSnapshots } from "./statementAccounts";
import { calculateBillingSummary } from "./billingSummary";
import { prisma } from "../prisma";
import { readSchoolLedger, type BillingLedgerEntry } from "../utils/billingLedgerStore";

export type DaSilvaLatePenaltyPreviewSummary = {
  totalAccounts: number;
  eligibleCount: number;
  alreadyAppliedCount: number;
  notEligibleCount: number;
  totalPenaltyAmount: number;
  statementsSummary: ReturnType<typeof calculateBillingSummary>;
};

export type DaSilvaLatePenaltyPreviewResult = {
  schoolAllowed: boolean;
  previewOnly: true;
  applyBlocked: true;
  penaltyMonth: string;
  rows: DaSilvaPenaltyPreviewRow[];
  summary: DaSilvaLatePenaltyPreviewSummary;
};

export type DaSilvaStatementAccountSnapshot = {
  accountNo: string;
  balance: number;
  accountHolder?: string;
  memberLearnerIds?: string[];
  memberNames?: string[];
  status?: string;
  kidesysSection?: string;
};

export type DaSilvaLearnerSnapshot = {
  id: string;
  enrollmentStatus?: string;
  firstName?: string;
  lastName?: string;
  billingPlan?: Array<{
    feeDescription?: string;
    description?: string;
    amount?: number;
    type?: string;
    feeType?: string;
    frequency?: string;
  }>;
};

/** Collect month-based penalty idempotency keys already present on the ledger (read-only). */
export function collectAppliedDaSilvaPenaltyKeys(
  schoolId: string,
  ledger: BillingLedgerEntry[]
): Set<string> {
  const sid = String(schoolId || "").trim();
  const prefix = `penalty-${sid}-`;
  const monthSuffix = /-\d{4}-\d{2}$/;
  const keys = new Set<string>();
  for (const entry of ledger) {
    if (entry.type !== "penalty") continue;
    const id = String(entry.id || "").trim();
    if (id.startsWith(prefix) && monthSuffix.test(id)) {
      keys.add(id);
    }
  }
  return keys;
}

function planLineToFee(
  fee: NonNullable<DaSilvaLearnerSnapshot["billingPlan"]>[number]
): DaSilvaBillingPlanFee {
  return {
    feeDescription: String(fee?.feeDescription || fee?.description || "").trim(),
    amount: Number(fee?.amount) || 0,
    type: String(fee?.type || fee?.feeType || "").trim() || undefined,
    frequency: String(fee?.frequency || "").trim() || undefined,
  };
}

export function assembleDaSilvaPenaltyAccountInputs(input: {
  statementAccounts: DaSilvaStatementAccountSnapshot[];
  learnersById: Map<string, DaSilvaLearnerSnapshot>;
  plansByLearnerId?: Record<string, DaSilvaBillingPlanFee[]>;
  accountRefs?: string[];
}): DaSilvaPenaltyAccountInput[] {
  const filter = new Set(
    (input.accountRefs || []).map((ref) => String(ref || "").trim().toUpperCase()).filter(Boolean)
  );

  return (input.statementAccounts || [])
    .filter((stmt) => {
      const ref = String(stmt.accountNo || "").trim().toUpperCase();
      if (!ref || ref === "-") return false;
      if (filter.size && !filter.has(ref)) return false;
      return true;
    })
    .map((stmt) => {
      const accountRef = String(stmt.accountNo || "").trim().toUpperCase();
      const memberIds = Array.from(
        new Set((stmt.memberLearnerIds || []).map((id) => String(id || "").trim()).filter(Boolean))
      );

      const learners: DaSilvaPenaltyLearner[] = memberIds.map((learnerId) => {
        const learner = input.learnersById.get(learnerId);
        const fromApiPlan = (learner?.billingPlan || []).map(planLineToFee).filter((f) => f.feeDescription);
        const fromDbPlan = input.plansByLearnerId?.[learnerId] || [];
        const planFees = fromApiPlan.length ? fromApiPlan : fromDbPlan;
        const learnerName = learner
          ? `${String(learner.firstName || "").trim()} ${String(learner.lastName || "").trim()}`.trim()
          : "";
        return {
          id: learnerId,
          enrollmentStatus: learner?.enrollmentStatus,
          learnerName: learnerName || undefined,
          planFees,
        };
      });

      return {
        accountRef,
        accountHolder: String(stmt.accountHolder || "").trim(),
        learnerNames: (stmt.memberNames || []).map((name) => String(name || "").trim()).filter(Boolean),
        outstandingBalance: roundPenaltyMoney(Number(stmt.balance) || 0),
        learners,
      };
    });
}

function summarizePreviewRows(
  rows: DaSilvaPenaltyPreviewRow[],
  statementsSummary: ReturnType<typeof calculateBillingSummary>
): DaSilvaLatePenaltyPreviewSummary {
  const eligible = rows.filter((row) => row.eligible);
  return {
    totalAccounts: rows.length,
    eligibleCount: eligible.length,
    alreadyAppliedCount: rows.filter((row) => row.alreadyApplied).length,
    notEligibleCount: rows.filter((row) => !row.eligible && !row.alreadyApplied).length,
    totalPenaltyAmount: roundPenaltyMoney(
      eligible.reduce((sum, row) => sum + (Number(row.penaltyAmount) || 0), 0)
    ),
    statementsSummary,
  };
}

/** Force preview-only response — never allow apply in phase 2. */
export function toPreviewOnlyRows(rows: DaSilvaPenaltyPreviewRow[]): DaSilvaPenaltyPreviewRow[] {
  return rows.map((row) => ({
    ...row,
    apply: false,
  }));
}

export function buildDaSilvaLatePenaltyPreviewFromSnapshot(input: {
  schoolId: string;
  penaltyMonth: string;
  statementAccounts: DaSilvaStatementAccountSnapshot[];
  learners: DaSilvaLearnerSnapshot[];
  ledgerEntries?: BillingLedgerEntry[];
  plansByLearnerId?: Record<string, DaSilvaBillingPlanFee[]>;
  accountRefs?: string[];
}): DaSilvaLatePenaltyPreviewResult {
  const schoolId = String(input.schoolId || "").trim();
  const penaltyMonth = normalizePenaltyMonth(input.penaltyMonth) || new Date().toISOString().slice(0, 7);
  const learnersById = new Map(input.learners.map((learner) => [learner.id, learner]));
  const accounts = assembleDaSilvaPenaltyAccountInputs({
    statementAccounts: input.statementAccounts,
    learnersById,
    plansByLearnerId: input.plansByLearnerId,
    accountRefs: input.accountRefs,
  });
  const appliedIdempotencyKeys = collectAppliedDaSilvaPenaltyKeys(
    schoolId,
    input.ledgerEntries || []
  );
  const preview = buildDaSilvaPenaltyPreview({
    schoolId,
    accounts,
    penaltyMonth,
    appliedIdempotencyKeys,
  });
  const statementsSummary = calculateBillingSummary(
    input.statementAccounts.map((row) => ({
      accountNo: row.accountNo,
      balance: row.balance,
      status: row.status,
      kidesysSection: row.kidesysSection,
    }))
  );

  return {
    schoolAllowed: preview.schoolAllowed,
    previewOnly: true,
    applyBlocked: true,
    penaltyMonth,
    rows: toPreviewOnlyRows(preview.rows),
    summary: summarizePreviewRows(preview.rows, statementsSummary),
  };
}

/**
 * Read-only Da Silva late penalty preview using local DB + billing JSON stores.
 * No ledger writes, no billing mutations.
 */
export async function previewDaSilvaLatePenalties(input: {
  schoolId: string;
  penaltyMonth: string;
  accountRefs?: string[];
}): Promise<DaSilvaLatePenaltyPreviewResult> {
  const schoolId = String(input.schoolId || "").trim();
  const penaltyMonth = normalizePenaltyMonth(input.penaltyMonth);
  if (!penaltyMonth) {
    throw new Error("penaltyMonth must be YYYY-MM");
  }

  if (!isDaSilvaLatePenaltySchoolAllowed(schoolId)) {
    return {
      schoolAllowed: false,
      previewOnly: true,
      applyBlocked: true,
      penaltyMonth,
      rows: [],
      summary: {
        totalAccounts: 0,
        eligibleCount: 0,
        alreadyAppliedCount: 0,
        notEligibleCount: 0,
        totalPenaltyAmount: 0,
        statementsSummary: {
          accountsCount: 0,
          totalOutstanding: 0,
          recentlyOwing: 0,
          badDebt: 0,
          overPaid: 0,
        },
      },
    };
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

  return buildDaSilvaLatePenaltyPreviewFromSnapshot({
    schoolId,
    penaltyMonth,
    statementAccounts: statementAccounts.map((row) => ({
      accountNo: row.accountNo,
      balance: row.balance,
      accountHolder: row.accountHolder,
      memberLearnerIds: row.memberLearnerIds,
      memberNames: row.memberNames,
      status: row.status,
      kidesysSection: row.kidesysSection,
    })),
    learners: learnerSnapshots,
    ledgerEntries: ledger,
    plansByLearnerId,
    accountRefs: input.accountRefs,
  });
}

export function isPreviewOnlyDaSilvaPenaltySchool(schoolId: string): boolean {
  return schoolId === DA_SILVA_ACADEMY_SCHOOL_ID || isDaSilvaLatePenaltySchoolAllowed(schoolId);
}

export { buildDaSilvaPenaltyIdempotencyKey };
