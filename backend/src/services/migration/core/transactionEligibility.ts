import {
  countsTowardActiveHeadCount,
  isClosedOrInactiveAccountStatus,
  isHistoricalMigrationStatus,
  isUnenrolledMigrationStatus,
  type MigrationLearnerStatus,
} from "../types/MigrationLearnerStatus";

export type MigrationLearnerBillingRef = {
  status: MigrationLearnerStatus;
  grade?: string | null;
  classroom?: string | null;
  accountStatus?: string | null;
};

function parseCutoverDate(cutoverDate: string | null | undefined): Date | null {
  const raw = String(cutoverDate || "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseTransactionDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(epoch.getTime() + serial * 86400000);
      d.setHours(0, 0, 0, 0);
      return d;
    }
  }
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) {
    const d = new Date(parsed);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const month = Number(dmy[2]) - 1;
    const day = Number(dmy[1]);
    const d = new Date(year, month, day);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(0, 0, 0, 0);
      return d;
    }
  }
  return null;
}

function hasActiveClassroomOrGrade(learner: MigrationLearnerBillingRef): boolean {
  const grade = String(learner.grade || "").trim();
  const classroom = String(learner.classroom || "").trim();
  return grade.length > 0 || classroom.length > 0;
}

/**
 * True only when the learner may participate in new billing / active head count.
 */
export function isLearnerEligibleForNewBilling(learner: MigrationLearnerBillingRef): boolean {
  if (!countsTowardActiveHeadCount(learner.status)) return false;
  if (isHistoricalMigrationStatus(learner.status)) return false;
  if (isUnenrolledMigrationStatus(learner.status)) return false;
  if (isClosedOrInactiveAccountStatus(learner.accountStatus)) return false;
  return hasActiveClassroomOrGrade(learner);
}

export type TransactionHistoricalOnlyInput = {
  learnerStatus?: MigrationLearnerStatus | null;
  accountStatus?: string | null;
  accountClosed?: boolean;
  transactionDate?: unknown;
  cutoverDate?: string | null;
};

/**
 * Historical-only transactions are preserved for ledger history but must not affect
 * active head count or new billing runs.
 */
export function shouldTransactionBeHistoricalOnly(input: TransactionHistoricalOnlyInput): boolean {
  const status = input.learnerStatus;
  if (status === "HISTORICAL" || status === "UNENROLLED") return true;
  if (input.accountClosed || isClosedOrInactiveAccountStatus(input.accountStatus)) {
    return true;
  }

  const cutover = parseCutoverDate(input.cutoverDate);
  const txDate = parseTransactionDate(input.transactionDate);
  if (cutover && txDate && txDate.getTime() < cutover.getTime()) {
    return true;
  }

  return false;
}

export type TransactionReadinessBucket =
  | "historicalOnly"
  | "eligibleActive"
  | "blocked"
  | "unmatched";

export type ClassifyTransactionRowInput = {
  learnerStatus?: MigrationLearnerStatus | null;
  grade?: string | null;
  classroom?: string | null;
  accountStatus?: string | null;
  accountClosed?: boolean;
  transactionDate?: unknown;
  cutoverDate?: string | null;
  hasLearnerOrAccountMatch: boolean;
  amountValid: boolean;
  datePresent: boolean;
};

export function classifyTransactionReadiness(
  input: ClassifyTransactionRowInput
): TransactionReadinessBucket {
  if (!input.hasLearnerOrAccountMatch) return "unmatched";
  if (!input.datePresent || !input.amountValid) return "blocked";

  if (shouldTransactionBeHistoricalOnly(input)) {
    return "historicalOnly";
  }

  const learner: MigrationLearnerBillingRef = {
    status: input.learnerStatus ?? "UNKNOWN",
    grade: input.grade,
    classroom: input.classroom,
    accountStatus: input.accountStatus,
  };

  if (isLearnerEligibleForNewBilling(learner)) {
    return "eligibleActive";
  }

  return "blocked";
}
