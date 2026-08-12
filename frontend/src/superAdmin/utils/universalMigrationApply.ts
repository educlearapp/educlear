import { API_URL } from "../../api";
import { getSuperAdminToken } from "../../auth/superAdminSession";
import type {
  ParentIdentityPreflightCounts,
  ParentIdentityResolution,
  ParentIdentityReviewContract,
} from "./parentIdentityReview";

export type MigrationApplyCounts = {
  learners: number;
  parents: number;
  employees: number;
  billingAccounts: number;
  transactions: number;
  classrooms: number;
  parentLearnerLinks: number;
};

export type MigrationImportReportRow = {
  entityType: string;
  sourceFileId: string;
  sourceFilename: string;
  rowNumber: number;
  status: "created" | "skipped" | "failed" | "not_applied";
  message: string;
  key?: string;
  recordId?: string;
};

export type MigrationTransactionOutcomeCounts = {
  posted: number;
  historicalNotApplied: number;
  blocked: number;
  unmatched: number;
  duplicateSkipped: number;
};

export type MigrationApplyResult = {
  batchId: string;
  stageId: string;
  targetSchoolId: string;
  targetSchoolName: string;
  appliedAt: string;
  success: boolean;
  error?: string;
  migrationStatus?:
    | "APPLIED"
    | "FULL_MIGRATION_PREFLIGHT"
    | "MIGRATION_REQUIRES_REVIEW"
    | "BLOCKED_REQUIRES_REVIEW";
  createdCounts: MigrationApplyCounts;
  skippedCounts: MigrationApplyCounts;
  failedCounts: MigrationApplyCounts;
  transactionOutcomes?: MigrationTransactionOutcomeCounts;
  report: MigrationImportReportRow[];
  parentIdentityPreflight?: {
    status: "READY_TO_APPLY" | "MIGRATION_REQUIRES_REVIEW";
    message: string;
    counts: ParentIdentityPreflightCounts;
  };
  parentIdentityReview?: ParentIdentityReviewContract | null;
};

export class UniversalMigrationApplyError extends Error {
  result: MigrationApplyResult | null;
  code?: string;
  migrationStatus?: string;

  constructor(
    message: string,
    result: MigrationApplyResult | null = null,
    extras?: { code?: string; migrationStatus?: string }
  ) {
    super(message);
    this.name = "UniversalMigrationApplyError";
    this.result = result;
    this.code = extras?.code;
    this.migrationStatus = extras?.migrationStatus || result?.migrationStatus;
  }
}

async function postApply(input: {
  stageId: string;
  targetSchoolId?: string;
  confirmationText: string;
  proceedWithEligibleActiveOnly?: boolean;
  fullMigrationPreflight?: boolean;
  parentIdentityResolutions?: ParentIdentityResolution[];
}): Promise<{ result: MigrationApplyResult; httpStatus: number; body: Record<string, unknown> }> {
  const token = getSuperAdminToken();
  const res = await fetch(`${API_URL}/api/migration/apply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      stageId: input.stageId,
      ...(input.targetSchoolId ? { targetSchoolId: input.targetSchoolId } : {}),
      confirmationText: input.confirmationText,
      ...(input.proceedWithEligibleActiveOnly
        ? { proceedWithEligibleActiveOnly: true }
        : {}),
      ...(input.fullMigrationPreflight
        ? { fullMigrationPreflight: true, mode: "FULL_MIGRATION_PREFLIGHT" }
        : {}),
      ...(input.parentIdentityResolutions
        ? { parentIdentityResolutions: input.parentIdentityResolutions }
        : {}),
    }),
  });

  const text = await res.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    data = null;
  }

  const result = (data?.result as MigrationApplyResult | undefined) ?? null;
  if (!res.ok) {
    throw new UniversalMigrationApplyError(
      String(data?.error || `Migration request failed (${res.status})`),
      result,
      {
        code: data?.code ? String(data.code) : undefined,
        migrationStatus: data?.migrationStatus
          ? String(data.migrationStatus)
          : result?.migrationStatus,
      }
    );
  }

  if (!result) {
    throw new UniversalMigrationApplyError(
      String(data?.error || "Migration request failed"),
      null
    );
  }

  return { result, httpStatus: res.status, body: data || {} };
}

/** Zero-write full migration preflight (parent identity + counts). */
export async function runUniversalMigrationFullPreflight(input: {
  stageId: string;
  targetSchoolId?: string;
  confirmationText: string;
  parentIdentityResolutions?: ParentIdentityResolution[];
}): Promise<MigrationApplyResult> {
  const { result, body } = await postApply({
    ...input,
    fullMigrationPreflight: true,
  });

  // Backend returns 200 with success:true for preflight even when review is required,
  // or 409 with migrationStatus MIGRATION_REQUIRES_REVIEW on apply path.
  if (
    result.migrationStatus === "MIGRATION_REQUIRES_REVIEW" ||
    body.migrationStatus === "MIGRATION_REQUIRES_REVIEW"
  ) {
    return {
      ...result,
      success: false,
      migrationStatus: "MIGRATION_REQUIRES_REVIEW",
      parentIdentityReview:
        (body.parentIdentityReview as ParentIdentityReviewContract | null) ||
        result.parentIdentityReview ||
        null,
    };
  }

  return {
    ...result,
    parentIdentityReview:
      (body.parentIdentityReview as ParentIdentityReviewContract | null) ||
      result.parentIdentityReview ||
      null,
  };
}

export async function applyUniversalMigrationStage(input: {
  stageId: string;
  targetSchoolId: string;
  confirmationText: string;
  proceedWithEligibleActiveOnly?: boolean;
  parentIdentityResolutions?: ParentIdentityResolution[];
}): Promise<MigrationApplyResult> {
  const { result, body, httpStatus } = await postApply({
    ...input,
    fullMigrationPreflight: false,
  });

  if (
    !result.success ||
    result.migrationStatus === "MIGRATION_REQUIRES_REVIEW" ||
    body.migrationStatus === "MIGRATION_REQUIRES_REVIEW" ||
    httpStatus === 409
  ) {
    throw new UniversalMigrationApplyError(
      result.error ||
        String(body.error || "Migration requires parent review before apply"),
      {
        ...result,
        parentIdentityReview:
          (body.parentIdentityReview as ParentIdentityReviewContract | null) ||
          result.parentIdentityReview ||
          null,
      },
      { migrationStatus: "MIGRATION_REQUIRES_REVIEW" }
    );
  }

  return result;
}
