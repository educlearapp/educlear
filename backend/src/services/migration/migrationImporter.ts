import { applyMigrationStage, MigrationApplyError } from "./core/applyMigrationStage";
import { getStage } from "./staging/migrationStageStore";
import { createMigrationSchoolBackup } from "./migrationSchoolBackup";
import { buildPostImportAudit } from "./migrationAudit";
import {
  loadMigrationProjectManifest,
  saveMigrationProjectManifest,
} from "./migrationProjectPaths";
import type { MigrationDryRunResult, MigrationImportResult } from "./migrationTypes";

export type MigrationImportInput = {
  schoolId: string;
  projectId: string;
  stageId: string;
  confirmDryRunPassed?: boolean;
  proceedWithEligibleActiveOnly?: boolean;
};

export async function runMigrationImport(
  input: MigrationImportInput
): Promise<MigrationImportResult> {
  const manifest = loadMigrationProjectManifest(input.schoolId, input.projectId);
  if (!manifest) {
    throw new Error(`Migration project not found: ${input.projectId}`);
  }

  if (!input.confirmDryRunPassed && manifest.lastDryRunPassed !== true) {
    throw new Error(
      "Dry run must pass before import. Run dry run and fix validation errors first."
    );
  }

  if (manifest.lastDryRunId && manifest.lastDryRunId !== input.stageId) {
    throw new Error(
      `Stage ${input.stageId} does not match last passed dry run (${manifest.lastDryRunId}). Re-run dry run.`
    );
  }

  const stage = getStage(input.stageId);
  if (!stage) {
    throw new Error(`Dry run stage not found: ${input.stageId}`);
  }
  if (!stage.canApply) {
    throw new MigrationApplyError(
      "Stage validation did not pass — cannot apply. Re-run dry run after fixing issues."
    );
  }

  const backupPath = await createMigrationSchoolBackup(
    input.schoolId,
    input.projectId
  );

  const apply = await applyMigrationStage({
    stageId: input.stageId,
    targetSchoolId: input.schoolId,
    confirmationText: "CONFIRM",
    proceedWithEligibleActiveOnly: input.proceedWithEligibleActiveOnly ?? false,
  });

  const audit = await buildPostImportAudit({
    schoolId: input.schoolId,
    projectId: input.projectId,
    batchId: apply.batchId,
    apply,
  });

  saveMigrationProjectManifest({
    ...manifest,
    lastImportBatchId: apply.batchId,
  });

  return {
    projectId: input.projectId,
    schoolId: input.schoolId,
    source: (stage.sourceSystem as MigrationImportResult["source"]) || "unknown",
    batchId: apply.batchId,
    backupPath,
    apply,
    auditPath: `uploads/migration-staging/${input.schoolId}/${input.projectId}/audits/post-import-${apply.batchId}.json`,
  };
}

export function dryRunResultToImportGate(dryRun: MigrationDryRunResult): {
  canImport: boolean;
  stageId: string;
  errors: string[];
} {
  return {
    canImport: dryRun.passed && dryRun.stage.canApply,
    stageId: dryRun.dryRunId,
    errors: dryRun.validation.blockingErrors,
  };
}
