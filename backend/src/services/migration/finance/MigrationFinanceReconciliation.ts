/**
 * Phase 1G — MigrationFinanceReconciliation artifact.
 */

export const MIGRATION_FINANCE_RECONCILIATION_VERSION = "1G.1" as const;

export type FinanceTotalsCents = {
  /** Sum of positive (debit / owed) opening + invoice amounts in cents. */
  debitCents: number;
  /** Sum of credit / payment amounts in cents (absolute). */
  creditCents: number;
  /** Net position in cents: debit − credit (matches ledger balance sign). */
  netCents: number;
  accountCount: number;
  transactionCount: number;
  openingBalanceCount: number;
};

export type PerAccountReconciliation = {
  accountRef: string;
  sourceCents: number;
  educlearCents: number;
  diffCents: number;
  ok: boolean;
};

export type MigrationFinanceReconciliation = {
  reconciliationId: string;
  reconciliationVersion: typeof MIGRATION_FINANCE_RECONCILIATION_VERSION;
  generatedAt: string;
  migrationRunId: string;
  stageId: string;
  targetSchoolId: string;
  sourceAnalysisId: string | null;
  compiledPlanId: string | null;
  sourceFingerprints: Array<{ fileId: string; filename: string; headerFingerprint: string }>;
  sourceTotals: FinanceTotalsCents;
  migratedTotals: FinanceTotalsCents;
  /**
   * Difference = source net − EduClear net (cents). Acceptance requires 0.
   */
  differenceCents: number;
  perAccount: PerAccountReconciliation[];
  mismatches: PerAccountReconciliation[];
  skippedUnsupported: Array<{ reason: string; detail?: string }>;
  canAccept: boolean;
  blockedReasons: string[];
  stale: boolean;
};

export type MigrationAcceptanceRecord = {
  acceptanceId: string;
  acceptedAt: string;
  stageId: string;
  targetSchoolId: string;
  migrationRunId: string;
  reconciliationId: string;
  statementAuthorityCheckId: string | null;
  statementBaselineId: string | null;
  feeCheckAuthorityCheckId: string | null;
  statementAuthorityMatch: true;
  feeCheckAuthorityMatch: true;
  sourceAnalysisId: string | null;
  compiledPlanId: string | null;
  operatorConfirmation: true;
  summary: {
    learners: number;
    parents: number;
    links: number;
    classrooms: number;
    accounts: number;
    openingBalances: number;
    transactions: number;
    billingPlans: number;
    unsupportedSkipped: number;
    differenceCents: number;
  };
  status: "ACCEPTED";
  rollbackNote: string;
};
