import type { MigrationApplyCounts, MigrationImportBatch } from "../types/MigrationApply";
import type {
  MigrationReconciliationResult,
  MigrationReconciliationStatus,
} from "../types/MigrationReconciliation";
import type {
  MigrationExportedReport,
  MigrationSignoffBuildInput,
  MigrationSignoffCounts,
  MigrationSignoffPack,
  MigrationSignoffStatus,
} from "../types/MigrationSignoff";
import { getImportBatch } from "./migrationImportBatchStore";
import {
  reconcileMigrationBatch,
  MigrationReconciliationError,
} from "./reconcileMigrationBatch";
import { exportImportBatchReport } from "./exportImportBatchReport";
import { exportMigrationReconciliationReport } from "./exportMigrationReconciliationReport";

export class MigrationSignoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationSignoffError";
  }
}

function cleanString(v: unknown): string {
  return String(v ?? "").trim();
}

function emptyCounts(): MigrationApplyCounts {
  return {
    learners: 0,
    parents: 0,
    employees: 0,
    billingAccounts: 0,
    transactions: 0,
    classrooms: 0,
    parentLearnerLinks: 0,
  };
}

function sumCounts(counts: MigrationApplyCounts): number {
  return (
    counts.learners +
    counts.parents +
    counts.employees +
    counts.billingAccounts +
    counts.transactions +
    counts.classrooms +
    counts.parentLearnerLinks
  );
}

function hydrateBatchCounts(batch: MigrationImportBatch): MigrationSignoffCounts {
  return {
    created: batch.createdCounts ?? emptyCounts(),
    skipped: batch.skippedCounts ?? emptyCounts(),
    failed: batch.failedCounts ?? emptyCounts(),
  };
}

/** Critical = reconciliation failures, apply failures, or batch not successfully completed. */
export function hasMigrationCriticalFailures(
  reconciliation: MigrationReconciliationResult,
  batch: MigrationImportBatch
): boolean {
  if (reconciliation.summary.failed > 0) return true;
  if (batch.status === "failed" || batch.status === "rolled_back") return true;
  if (batch.status !== "completed") return true;
  const failed = batch.failedCounts ?? emptyCounts();
  if (sumCounts(failed) > 0) return true;
  return false;
}

export function computeApprovedForGoLive(
  reconciliationStatus: MigrationReconciliationStatus,
  criticalFailures: boolean
): boolean {
  if (criticalFailures) return false;
  if (reconciliationStatus === "fail") return false;
  if (reconciliationStatus === "warning") return false;
  if (reconciliationStatus === "pass") return true;
  return false;
}

export function computeSignoffStatus(input: {
  reconciliationStatus: MigrationReconciliationStatus;
  criticalFailures: boolean;
  approvalConfirmed: boolean;
  approvedForGoLive: boolean;
}): MigrationSignoffStatus {
  if (input.reconciliationStatus === "fail" || input.criticalFailures) {
    return "blocked";
  }
  if (input.approvedForGoLive && input.approvalConfirmed) {
    return "approved";
  }
  return "draft";
}

function collectWarnings(
  reconciliation: MigrationReconciliationResult,
  batch: MigrationImportBatch
): string[] {
  const warnings: string[] = [];
  for (const check of reconciliation.checks) {
    if (check.status === "warning") {
      warnings.push(`${check.check}: ${check.message}`);
    }
    if (check.status === "fail") {
      warnings.push(`${check.check}: ${check.message}`);
    }
  }
  if (batch.status === "rolled_back") {
    warnings.push("Import batch status is rolled_back — not eligible for go-live.");
  }
  if (batch.status !== "completed") {
    warnings.push(`Import batch status is ${batch.status} — expected completed for go-live.`);
  }
  const failed = batch.failedCounts ?? emptyCounts();
  if (sumCounts(failed) > 0) {
    warnings.push(
      `Apply report has failed records (learners ${failed.learners}, parents ${failed.parents}, billing ${failed.billingAccounts}, transactions ${failed.transactions}).`
    );
  }
  return warnings;
}

function loadExportedReports(
  batchId: string,
  reconciliation: MigrationReconciliationResult
): MigrationExportedReport[] {
  const reports: MigrationExportedReport[] = [];

  try {
    const batchExport = exportImportBatchReport(batchId);
    reports.push({
      label: "Import batch report (CSV)",
      filename: batchExport.filename,
      downloadPath: batchExport.downloadPath,
    });
  } catch {
    /* batch export optional if report empty */
  }

  try {
    const reconExport = exportMigrationReconciliationReport(reconciliation);
    reports.push({
      label: "Reconciliation report (CSV)",
      filename: reconExport.filename,
      downloadPath: reconExport.downloadPath,
    });
  } catch {
    /* reconciliation CSV always generated when reconciliation exists */
  }

  return reports;
}

export async function buildMigrationSignoffPack(
  input: MigrationSignoffBuildInput
): Promise<Omit<MigrationSignoffPack, "signoffId" | "createdAt">> {
  const batchId = cleanString(input.batchId);
  const targetSchoolId = cleanString(input.targetSchoolId);
  const operatorName = cleanString(input.operatorName);
  const operatorEmail = cleanString(input.operatorEmail);
  const notes = cleanString(input.notes);
  const approvalConfirmed = Boolean(input.approvalConfirmed);

  if (!batchId) throw new MigrationSignoffError("batchId is required");
  if (!targetSchoolId) throw new MigrationSignoffError("targetSchoolId is required");
  if (!operatorName) throw new MigrationSignoffError("operatorName is required");
  if (!operatorEmail) throw new MigrationSignoffError("operatorEmail is required");
  if (!approvalConfirmed) {
    throw new MigrationSignoffError("approvalConfirmed is required");
  }

  const batch = getImportBatch(batchId);
  if (!batch) throw new MigrationSignoffError("Import batch not found");
  if (batch.targetSchoolId !== targetSchoolId) {
    throw new MigrationSignoffError("targetSchoolId does not match this import batch");
  }

  let reconciliation: MigrationReconciliationResult;
  try {
    reconciliation = await reconcileMigrationBatch({ batchId, targetSchoolId });
  } catch (e: unknown) {
    if (e instanceof MigrationReconciliationError) {
      throw new MigrationSignoffError(e.message);
    }
    throw e;
  }

  const criticalFailures = hasMigrationCriticalFailures(reconciliation, batch);
  const approvedForGoLive = computeApprovedForGoLive(
    reconciliation.overallStatus,
    criticalFailures
  );
  const signoffStatus = computeSignoffStatus({
    reconciliationStatus: reconciliation.overallStatus,
    criticalFailures,
    approvalConfirmed,
    approvedForGoLive,
  });

  const exportedReports = loadExportedReports(batchId, reconciliation);
  const counts = hydrateBatchCounts(batch);
  const warnings = collectWarnings(reconciliation, batch);

  return {
    batchId: batch.batchId,
    stageId: batch.stageId,
    schoolId: batch.targetSchoolId,
    schoolName: batch.targetSchoolName,
    operatorName,
    operatorEmail,
    signoffStatus,
    reconciliationStatus: reconciliation.overallStatus,
    migrationStatus: batch.status,
    counts,
    warnings,
    exportedReports,
    notes,
    approvedForGoLive,
    approvalConfirmed,
    reconciledAt: reconciliation.reconciledAt,
  };
}
