/**
 * Migration-time learner enrollment tier (Universal Migration Framework).
 * Distinct from Prisma `LearnerEnrollmentStatus` — UNENROLLED/UNKNOWN are reviewed at import.
 */
export type MigrationLearnerStatus = "ACTIVE" | "HISTORICAL" | "UNENROLLED" | "UNKNOWN";

export const MIGRATION_LEARNER_STATUSES: readonly MigrationLearnerStatus[] = [
  "ACTIVE",
  "HISTORICAL",
  "UNENROLLED",
  "UNKNOWN",
] as const;

/** ACTIVE counts toward learner head count and billing eligibility. */
export function countsTowardActiveHeadCount(status: MigrationLearnerStatus): boolean {
  return status === "ACTIVE";
}

/** HISTORICAL is preserved for old records only — never active head count. */
export function isHistoricalMigrationStatus(status: MigrationLearnerStatus): boolean {
  return status === "HISTORICAL";
}

/** UNENROLLED is preserved but does not count as active. */
export function isUnenrolledMigrationStatus(status: MigrationLearnerStatus): boolean {
  return status === "UNENROLLED";
}

/** UNKNOWN must be reviewed before apply. */
export function requiresReviewBeforeApply(status: MigrationLearnerStatus): boolean {
  return status === "UNKNOWN";
}

const HISTORICAL_TOKENS = /\b(historical|inactive|former|archived|legacy|left school|no longer)\b/i;
const UNENROLLED_TOKENS = /\b(unenrolled|withdrawn|withdrawal|left|departed|transferred out|not returning)\b/i;
const ACTIVE_TOKENS = /\b(active|current|enrolled|present)\b/i;
const CLOSED_ACCOUNT_TOKENS = /\b(closed|inactive|archived|terminated|cancelled|canceled)\b/i;

export function parseMigrationLearnerStatus(
  raw: string | null | undefined,
  hints?: { fileCategory?: string }
): MigrationLearnerStatus {
  const s = String(raw || "").trim();
  const category = String(hints?.fileCategory || "").trim().toLowerCase();

  if (category === "historical") return "HISTORICAL";

  if (!s) return "UNKNOWN";

  const upper = s.toUpperCase();
  if (upper === "ACTIVE") return "ACTIVE";
  if (upper === "HISTORICAL") return "HISTORICAL";
  if (upper === "UNENROLLED") return "UNENROLLED";
  if (upper === "UNKNOWN") return "UNKNOWN";

  if (HISTORICAL_TOKENS.test(s)) return "HISTORICAL";
  if (UNENROLLED_TOKENS.test(s)) return "UNENROLLED";
  if (ACTIVE_TOKENS.test(s)) return "ACTIVE";

  return "UNKNOWN";
}

export function isClosedOrInactiveAccountStatus(raw: string | null | undefined): boolean {
  const s = String(raw || "").trim();
  if (!s) return false;
  return CLOSED_ACCOUNT_TOKENS.test(s);
}
