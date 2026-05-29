"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrationRollback = exports.runMigrationImport = exports.runMigrationDryRun = void 0;
exports.createMigrationProjectId = createMigrationProjectId;
exports.ingestMigrationUploads = ingestMigrationUploads;
const crypto_1 = require("crypto");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const readMigrationFilePreview_1 = require("./core/readMigrationFilePreview");
const migrationProjectPaths_1 = require("./migrationProjectPaths");
const migrationFileDetector_1 = require("./migrationFileDetector");
const migrationDryRun_1 = require("./migrationDryRun");
Object.defineProperty(exports, "runMigrationDryRun", { enumerable: true, get: function () { return migrationDryRun_1.runMigrationDryRun; } });
const migrationImporter_1 = require("./migrationImporter");
Object.defineProperty(exports, "runMigrationImport", { enumerable: true, get: function () { return migrationImporter_1.runMigrationImport; } });
const migrationRollback_1 = require("./migrationRollback");
Object.defineProperty(exports, "runMigrationRollback", { enumerable: true, get: function () { return migrationRollback_1.runMigrationRollback; } });
function createMigrationProjectId() {
    return `mig-${Date.now().toString(36)}-${(0, crypto_1.randomUUID)().slice(0, 8)}`;
}
async function ingestMigrationUploads(input) {
    const existing = (0, migrationProjectPaths_1.loadMigrationProjectManifest)(input.schoolId, input.projectId) ??
        {
            projectId: input.projectId,
            schoolId: input.schoolId,
            source: input.source ?? "unknown",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            files: [],
        };
    const stagedRecords = [];
    const pathsForSourceDetect = [];
    for (const upload of input.filePaths) {
        const kind = (0, migrationFileDetector_1.detectMigrationFileKind)(upload.originalFilename);
        if (kind === "zip") {
            const stored = (0, migrationProjectPaths_1.storeUploadedFile)(input.schoolId, input.projectId, upload.originalFilename, upload.absolutePath);
            const extracted = (0, migrationProjectPaths_1.extractZipToUploads)(input.schoolId, input.projectId, stored);
            for (const extractedPath of extracted) {
                pathsForSourceDetect.push(extractedPath);
                const record = await buildFileRecord(input.schoolId, input.projectId, extractedPath, existing.source);
                stagedRecords.push(record);
            }
            continue;
        }
        const stored = (0, migrationProjectPaths_1.storeUploadedFile)(input.schoolId, input.projectId, upload.originalFilename, upload.absolutePath);
        pathsForSourceDetect.push(stored);
        stagedRecords.push(await buildFileRecord(input.schoolId, input.projectId, stored, existing.source, upload.originalFilename, upload.sizeBytes));
    }
    const source = input.source && input.source !== "unknown"
        ? input.source
        : (0, migrationFileDetector_1.detectSourceSystemFromFiles)(stagedRecords.map((r) => r.originalFilename), new Map(stagedRecords.map((r) => [r.fileId, r.columns])));
    const manifest = (0, migrationProjectPaths_1.appendFilesToManifest)({ ...existing, source }, stagedRecords.map((r) => ({ ...r, sourceSystem: source })));
    (0, migrationProjectPaths_1.saveMigrationProjectManifest)(manifest);
    return manifest;
}
async function buildFileRecord(schoolId, projectId, storedPath, sourceHint, originalFilename, sizeBytes) {
    const filename = originalFilename ?? path_1.default.basename(storedPath);
    const source = sourceHint !== "unknown" ? sourceHint : (0, migrationFileDetector_1.detectSourceSystemFromFiles)([filename]);
    const migrationFile = {
        id: (0, crypto_1.randomUUID)(),
        filename,
        mimeType: "application/octet-stream",
        size: sizeBytes ?? fs_1.default.statSync(storedPath).size,
        uploadedAt: new Date(),
        category: "unknown",
        path: storedPath,
    };
    const preview = await (0, readMigrationFilePreview_1.readMigrationFilePreview)(migrationFile, { sourceSystem: source });
    const dataGroup = (0, migrationFileDetector_1.detectMigrationDataGroup)({
        filename,
        columns: preview.columns ?? [],
        sourceSystem: source,
        rowCount: preview.rowCount,
    });
    return (0, migrationDryRun_1.registerStagedFileRecord)({
        schoolId,
        projectId,
        originalFilename: filename,
        storedPath,
        fileKind: (0, migrationFileDetector_1.detectMigrationFileKind)(filename),
        sourceSystem: source,
        dataGroup,
        category: (0, migrationFileDetector_1.dataGroupToFileCategory)(dataGroup),
        columns: preview.columns ?? [],
        rowCount: preview.rowCount,
        sampleRows: preview.sampleRows ?? [],
        sizeBytes: sizeBytes ?? fs_1.default.statSync(storedPath).size,
    });
}
