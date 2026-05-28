import { randomUUID } from "crypto";
import { readMigrationFilePreview } from "./core/readMigrationFilePreview";
import { readMigrationFileRows } from "./core/readMigrationFileRows";
import { buildMigrationStage } from "./staging/buildMigrationStage";
import { createStage } from "./staging/migrationStageStore";
import { buildColumnMappingsForPreviews } from "./migrationColumnMapper";
import {
  dataGroupToFileCategory,
  detectMigrationDataGroup,
  detectMigrationFileKind,
  detectSourceSystemFromFiles,
} from "./migrationFileDetector";
import {
  loadMigrationProjectManifest,
  saveMigrationProjectManifest,
} from "./migrationProjectPaths";
import type { MigrationFile } from "./types/MigrationFile";
import type {
  MigrationDryRunResult,
  MigrationPipelineRunInput,
  MigrationSourceSystem,
  MigrationStagedFileRecord,
} from "./migrationTypes";
import { buildMigrationValidationReport } from "./migrationValidator";
import { writeDryRunAudit } from "./migrationAudit";

export async function runMigrationDryRun(
  input: MigrationPipelineRunInput
): Promise<MigrationDryRunResult> {
  const manifest = loadMigrationProjectManifest(input.schoolId, input.projectId);
  if (!manifest || manifest.files.length === 0) {
    throw new Error(
      `No staged files for school ${input.schoolId} project ${input.projectId}. Upload files first.`
    );
  }

  const source: MigrationSourceSystem =
    input.source && input.source !== "unknown"
      ? input.source
      : manifest.source !== "unknown"
        ? manifest.source
        : detectSourceSystemFromFiles(
            manifest.files.map((f) => f.originalFilename),
            new Map(manifest.files.map((f) => [f.fileId, f.columns]))
          );

  const dataGroupsByFileId = new Map<string, import("./migrationTypes").MigrationDataGroup>();
  const previews = [];
  const migrationFiles: MigrationFile[] = [];

  for (const record of manifest.files) {
    if (record.fileKind === "zip") continue;

    const migrationFile: MigrationFile = {
      id: record.fileId,
      filename: record.originalFilename,
      mimeType: "application/octet-stream",
      size: record.sizeBytes,
      uploadedAt: new Date(record.uploadedAt),
      category: record.category,
      path: record.storedPath,
    };

    const preview = await readMigrationFilePreview(migrationFile, { sourceSystem: source });
    const dataGroup =
      record.dataGroup !== "unknown"
        ? record.dataGroup
        : detectMigrationDataGroup({
            filename: record.originalFilename,
            columns: preview.columns ?? [],
            sourceSystem: source,
            rowCount: preview.rowCount,
          });

    dataGroupsByFileId.set(record.fileId, dataGroup);
    preview.category = dataGroupToFileCategory(dataGroup);
    (preview as { path?: string }).path = record.storedPath;

    previews.push(preview);
    migrationFiles.push({
      ...migrationFile,
      category: preview.category as MigrationFile["category"],
    });
  }

  const { effective, reports } = buildColumnMappingsForPreviews(
    previews,
    source,
    dataGroupsByFileId
  );

  const validation = await buildMigrationValidationReport({
    schoolId: input.schoolId,
    projectId: input.projectId,
    source,
    previews,
    mappings: effective,
    fieldReports: reports,
    files: migrationFiles,
    dataGroupsByFileId,
    mode: "full",
    cutoverDate: input.cutoverDate,
  });

  if (!validation.canProceed) {
    const dryRunId = randomUUID();
    const failed: MigrationDryRunResult = {
      projectId: input.projectId,
      schoolId: input.schoolId,
      source,
      dryRunId,
      stage: buildMigrationStage({
        sourceSystem: source,
        previews,
        mappings: effective,
        validationSummary: validation.validationSummary,
        issues: validation.issues,
        cutoverDate: input.cutoverDate,
      }),
      validation,
      auditPath: "",
      passed: false,
    };
    failed.auditPath = writeDryRunAudit(failed);
    saveMigrationProjectManifest({
      ...manifest,
      source,
      lastDryRunId: dryRunId,
      lastDryRunPassed: false,
    });
    return failed;
  }

  const rowsByFileId = new Map<string, Record<string, unknown>[]>();
  for (const file of migrationFiles) {
    const full = await readMigrationFileRows(file, { sourceSystem: source });
    rowsByFileId.set(file.id, full.rows as Record<string, unknown>[]);
  }

  const stage = buildMigrationStage({
    sourceSystem: source,
    previews,
    mappings: effective,
    validationSummary: validation.validationSummary,
    issues: validation.issues,
    cutoverDate: input.cutoverDate,
    rowsByFileId,
  });

  createStage(stage);

  const dryRunId = stage.stageId;
  const result: MigrationDryRunResult = {
    projectId: input.projectId,
    schoolId: input.schoolId,
    source,
    dryRunId,
    stage,
    validation,
    auditPath: "",
    passed: true,
  };
  result.auditPath = writeDryRunAudit(result);

  saveMigrationProjectManifest({
    ...manifest,
    source,
    lastDryRunId: dryRunId,
    lastDryRunPassed: true,
  });

  return result;
}

export function registerStagedFileRecord(
  input: Omit<MigrationStagedFileRecord, "fileId" | "uploadedAt"> & { fileId?: string }
): MigrationStagedFileRecord {
  return {
    fileId: input.fileId ?? randomUUID(),
    schoolId: input.schoolId,
    projectId: input.projectId,
    originalFilename: input.originalFilename,
    storedPath: input.storedPath,
    fileKind: input.fileKind ?? detectMigrationFileKind(input.originalFilename),
    sourceSystem: input.sourceSystem,
    dataGroup: input.dataGroup,
    category: input.category,
    columns: input.columns ?? [],
    rowCount: input.rowCount ?? 0,
    sampleRows: input.sampleRows ?? [],
    uploadedAt: new Date().toISOString(),
    sizeBytes: input.sizeBytes ?? 0,
  };
}
