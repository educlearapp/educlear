/**
 * Phase 1H — Statement balance authority after migration.
 *
 * Authority rule (deterministic):
 *   migrated opening at cutover
 *   + eligible post-cutover movements included in Finance Check
 *   = accepted migrated account balance
 *   → written as official age-analysis baseline (existing architecture)
 *   → statement = baseline + live post-baseline delta only
 *
 * Migration ledger openings/transactions remain non-posting display rows
 * (same pattern as Kid-e-Sys openings) so they do not double-count against the baseline.
 */

export const MIGRATION_STATEMENT_AUTHORITY_VERSION = "1H.1" as const;

export type SnapshotRelativeCase =
  | "NO_SNAPSHOT"
  | "OLDER_THAN_CUTOVER"
  | "SAME_DATE_AS_CUTOVER"
  | "NEWER_THAN_CUTOVER"
  | "LIVE_SCHOOL_PROTECTED";

export type StatementAuthorityAccountRow = {
  accountRef: string;
  sourceMigratedCents: number;
  financeCheckCents: number;
  statementAuthorityCents: number;
  diffFinanceVsStatementCents: number;
  ok: boolean;
  snapshotCase: SnapshotRelativeCase;
  priorSnapshotImportedAt: string | null;
  priorSnapshotBalanceCents: number | null;
  operatorMessage: string;
};

export type MigrationStatementAuthorityCheck = {
  checkId: string;
  authorityVersion: typeof MIGRATION_STATEMENT_AUTHORITY_VERSION;
  generatedAt: string;
  migrationRunId: string;
  stageId: string;
  targetSchoolId: string;
  sourceAnalysisId: string | null;
  compiledPlanId: string | null;
  reconciliationId: string | null;
  cutoverAt: string;
  accountsChecked: number;
  matchCount: number;
  mismatchCount: number;
  perAccount: StatementAuthorityAccountRow[];
  mismatches: StatementAuthorityAccountRow[];
  liveConcurrency: Array<{
    accountRef: string;
    entryId: string;
    source: string;
    createdAt: string;
    amount: number;
    type: string;
  }>;
  statementAuthorityMatch: boolean;
  canFinalizeBaseline: boolean;
  blockedReasons: string[];
  stale: boolean;
  staleReasons: string[];
};

export type MigrationBaselineAccountRecord = {
  accountRef: string;
  acceptedMigratedBalanceCents: number;
  baselineEffectiveAt: string;
  priorSnapshotRef: {
    importedAt: string;
    balanceCents: number;
    source: string;
  } | null;
  snapshotCase: SnapshotRelativeCase;
  agingMode?: "SOURCE_BUCKETS" | "BALANCE_ONLY";
  agingOperatorMessage?: string;
};

export type MigrationStatementBaselineArtifact = {
  baselineId: string;
  authorityVersion: typeof MIGRATION_STATEMENT_AUTHORITY_VERSION;
  createdAt: string;
  migrationRunId: string;
  stageId: string;
  targetSchoolId: string;
  sourceAnalysisId: string | null;
  compiledPlanId: string | null;
  reconciliationId: string | null;
  cutoverAt: string;
  baselineEffectiveAt: string;
  archiveId: string | null;
  accounts: MigrationBaselineAccountRecord[];
  supersessionNote: string;
  idempotentReplay: boolean;
};

export type AgeAnalysisArchiveRecord = {
  archiveId: string;
  archivedAt: string;
  schoolId: string;
  migrationRunId: string;
  stageId: string;
  reason: string;
  priorSnapshots: Record<
    string,
    {
      accountRef: string;
      balance: number;
      importedAt: string;
      source: string;
      accountHolder?: string;
      buckets?: Record<string, number>;
    }
  >;
};
