"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrationDryRun = runMigrationDryRun;
exports.registerStagedFileRecord = registerStagedFileRecord;
const crypto_1 = require("crypto");
const readMigrationFilePreview_1 = require("./core/readMigrationFilePreview");
const readMigrationFileRows_1 = require("./core/readMigrationFileRows");
const buildMigrationStage_1 = require("./staging/buildMigrationStage");
const migrationStageStore_1 = require("./staging/migrationStageStore");
const migrationColumnMapper_1 = require("./migrationColumnMapper");
const migrationFileDetector_1 = require("./migrationFileDetector");
const migrationProjectPaths_1 = require("./migrationProjectPaths");
const migrationValidator_1 = require("./migrationValidator");
const migrationAudit_1 = require("./migrationAudit");
async function runMigrationDryRun(input) {
    const manifest = (0, migrationProjectPaths_1.loadMigrationProjectManifest)(input.schoolId, input.projectId);
    if (!manifest || manifest.files.length === 0) {
        throw new Error(`No staged files for school ${input.schoolId} project ${input.projectId}. Upload files first.`);
    }
    const source = input.source && input.source !== "unknown"
        ? input.source
        : manifest.source !== "unknown"
            ? manifest.source
            : (0, migrationFileDetector_1.detectSourceSystemFromFiles)(manifest.files.map((f) => f.originalFilename), new Map(manifest.files.map((f) => [f.fileId, f.columns])));
    const dataGroupsByFileId = new Map();
    const previews = [];
    const migrationFiles = [];
    for (const record of manifest.files) {
        if (record.fileKind === "zip")
            continue;
        const migrationFile = {
            id: record.fileId,
            filename: record.originalFilename,
            mimeType: "application/octet-stream",
            size: record.sizeBytes,
            uploadedAt: new Date(record.uploadedAt),
            category: record.category,
            path: record.storedPath,
        };
        const preview = await (0, readMigrationFilePreview_1.readMigrationFilePreview)(migrationFile, { sourceSystem: source });
        const dataGroup = record.dataGroup !== "unknown"
            ? record.dataGroup
            : (0, migrationFileDetector_1.detectMigrationDataGroup)({
                filename: record.originalFilename,
                columns: preview.columns ?? [],
                sourceSystem: source,
                rowCount: preview.rowCount,
            });
        dataGroupsByFileId.set(record.fileId, dataGroup);
        preview.category = (0, migrationFileDetector_1.dataGroupToFileCategory)(dataGroup);
        preview.path = record.storedPath;
        previews.push(preview);
        migrationFiles.push({
            ...migrationFile,
            category: preview.category,
        });
    }
    const { effective, reports } = (0, migrationColumnMapper_1.buildColumnMappingsForPreviews)(previews, source, dataGroupsByFileId);
    const validation = await (0, migrationValidator_1.buildMigrationValidationReport)({
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
        const dryRunId = (0, crypto_1.randomUUID)();
        const failed = {
            projectId: input.projectId,
            schoolId: input.schoolId,
            source,
            dryRunId,
            stage: (0, buildMigrationStage_1.buildMigrationStage)({
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
        failed.auditPath = (0, migrationAudit_1.writeDryRunAudit)(failed);
        (0, migrationProjectPaths_1.saveMigrationProjectManifest)({
            ...manifest,
            source,
            lastDryRunId: dryRunId,
            lastDryRunPassed: false,
        });
        return failed;
    }
    const rowsByFileId = new Map();
    for (const file of migrationFiles) {
        const full = await (0, readMigrationFileRows_1.readMigrationFileRows)(file, { sourceSystem: source });
        rowsByFileId.set(file.id, full.rows);
    }
    const stage = (0, buildMigrationStage_1.buildMigrationStage)({
        sourceSystem: source,
        previews,
        mappings: effective,
        validationSummary: validation.validationSummary,
        issues: validation.issues,
        cutoverDate: input.cutoverDate,
        rowsByFileId,
    });
    (0, migrationStageStore_1.createStage)(stage);
    const dryRunId = stage.stageId;
    const result = {
        projectId: input.projectId,
        schoolId: input.schoolId,
        source,
        dryRunId,
        stage,
        validation,
        auditPath: "",
        passed: true,
    };
    result.auditPath = (0, migrationAudit_1.writeDryRunAudit)(result);
    (0, migrationProjectPaths_1.saveMigrationProjectManifest)({
        ...manifest,
        source,
        lastDryRunId: dryRunId,
        lastDryRunPassed: true,
    });
    return result;
}
function registerStagedFileRecord(input) {
    return {
        fileId: input.fileId ?? (0, crypto_1.randomUUID)(),
        schoolId: input.schoolId,
        projectId: input.projectId,
        originalFilename: input.originalFilename,
        storedPath: input.storedPath,
        fileKind: input.fileKind ?? (0, migrationFileDetector_1.detectMigrationFileKind)(input.originalFilename),
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
