import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { readMigrationFilePreview } from "./core/readMigrationFilePreview";
import {
  appendFilesToManifest,
  extractZipToUploads,
  loadMigrationProjectManifest,
  saveMigrationProjectManifest,
  storeUploadedFile,
} from "./migrationProjectPaths";
import {
  dataGroupToFileCategory,
  detectMigrationDataGroup,
  detectMigrationFileKind,
  detectSourceSystemFromFiles,
} from "./migrationFileDetector";
import { registerStagedFileRecord, runMigrationDryRun } from "./migrationDryRun";
import { runMigrationImport } from "./migrationImporter";
import { runMigrationRollback } from "./migrationRollback";
import type {
  MigrationPipelineRunInput,
  MigrationPipelineUploadInput,
  MigrationProjectManifest,
  MigrationSourceSystem,
} from "./migrationTypes";

export function createMigrationProjectId(): string {
  return `mig-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

export async function ingestMigrationUploads(
  input: MigrationPipelineUploadInput
): Promise<MigrationProjectManifest> {
  const existing =
    loadMigrationProjectManifest(input.schoolId, input.projectId) ??
    ({
      projectId: input.projectId,
      schoolId: input.schoolId,
      source: input.source ?? "unknown",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      files: [],
    } satisfies MigrationProjectManifest);

  const stagedRecords = [];
  const pathsForSourceDetect: string[] = [];

  for (const upload of input.filePaths) {
    const kind = detectMigrationFileKind(upload.originalFilename);
    if (kind === "zip") {
      const stored = storeUploadedFile(
        input.schoolId,
        input.projectId,
        upload.originalFilename,
        upload.absolutePath
      );
      const extracted = extractZipToUploads(
        input.schoolId,
        input.projectId,
        stored
      );
      for (const extractedPath of extracted) {
        pathsForSourceDetect.push(extractedPath);
        const record = await buildFileRecord(
          input.schoolId,
          input.projectId,
          extractedPath,
          existing.source
        );
        stagedRecords.push(record);
      }
      continue;
    }

    const stored = storeUploadedFile(
      input.schoolId,
      input.projectId,
      upload.originalFilename,
      upload.absolutePath
    );
    pathsForSourceDetect.push(stored);
    stagedRecords.push(
      await buildFileRecord(
        input.schoolId,
        input.projectId,
        stored,
        existing.source,
        upload.originalFilename,
        upload.sizeBytes
      )
    );
  }

  const source =
    input.source && input.source !== "unknown"
      ? input.source
      : detectSourceSystemFromFiles(
          stagedRecords.map((r) => r.originalFilename),
          new Map(stagedRecords.map((r) => [r.fileId, r.columns]))
        );

  const manifest = appendFilesToManifest(
    { ...existing, source },
    stagedRecords.map((r) => ({ ...r, sourceSystem: source }))
  );

  saveMigrationProjectManifest(manifest);
  return manifest;
}

async function buildFileRecord(
  schoolId: string,
  projectId: string,
  storedPath: string,
  sourceHint: MigrationSourceSystem,
  originalFilename?: string,
  sizeBytes?: number
): Promise<ReturnType<typeof registerStagedFileRecord>> {
  const filename = originalFilename ?? path.basename(storedPath);
  const source =
    sourceHint !== "unknown" ? sourceHint : detectSourceSystemFromFiles([filename]);

  const migrationFile = {
    id: randomUUID(),
    filename,
    mimeType: "application/octet-stream",
    size: sizeBytes ?? fs.statSync(storedPath).size,
    uploadedAt: new Date(),
    category: "unknown" as const,
    path: storedPath,
  };

  const preview = await readMigrationFilePreview(migrationFile, { sourceSystem: source });
  const dataGroup = detectMigrationDataGroup({
    filename,
    columns: preview.columns ?? [],
    sourceSystem: source,
    rowCount: preview.rowCount,
  });

  return registerStagedFileRecord({
    schoolId,
    projectId,
    originalFilename: filename,
    storedPath,
    fileKind: detectMigrationFileKind(filename),
    sourceSystem: source,
    dataGroup,
    category: dataGroupToFileCategory(dataGroup),
    columns: preview.columns ?? [],
    rowCount: preview.rowCount,
    sampleRows: preview.sampleRows ?? [],
    sizeBytes: sizeBytes ?? fs.statSync(storedPath).size,
  });
}

export { runMigrationDryRun, runMigrationImport, runMigrationRollback };
