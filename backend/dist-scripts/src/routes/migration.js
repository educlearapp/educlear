"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrationUploadRouter = void 0;
exports.migrationUploadErrorHandler = migrationUploadErrorHandler;
exports.migrationErrorHandler = migrationErrorHandler;
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const migrationService_1 = require("../services/migrationService");
const kideesysMigrationValidate_1 = require("../services/kideesysMigrationValidate");
const migrationLearnerFileParser_1 = require("../utils/migrationLearnerFileParser");
const crypto_1 = require("crypto");
const detectMigrationCategory_1 = require("../services/migration/core/detectMigrationCategory");
const migrationStagingPath_1 = require("../services/migration/core/migrationStagingPath");
const readMigrationFilePreview_1 = require("../services/migration/core/readMigrationFilePreview");
const readMigrationFileRows_1 = require("../services/migration/core/readMigrationFileRows");
const suggestColumnMappings_1 = require("../services/migration/core/suggestColumnMappings");
const validateMigrationPreview_1 = require("../services/migration/validation/validateMigrationPreview");
const migrationKidESysReadiness_1 = require("./migrationKidESysReadiness");
const migrationTemplateStore_1 = require("../services/migration/templates/migrationTemplateStore");
const migrationSystemRegistryStore_1 = require("../services/migration/core/migrationSystemRegistryStore");
const migrationAdapterReadinessStore_1 = require("../services/migration/core/migrationAdapterReadinessStore");
const MigrationSystemResearch_1 = require("../services/migration/types/MigrationSystemResearch");
const applyMigrationStage_1 = require("../services/migration/core/applyMigrationStage");
const computeMigrationApplyPreview_1 = require("../services/migration/core/computeMigrationApplyPreview");
const migrationImportBatchStore_1 = require("../services/migration/core/migrationImportBatchStore");
const rollbackMigrationBatch_1 = require("../services/migration/core/rollbackMigrationBatch");
const reverseMigrationLedgerBatch_1 = require("../services/migration/core/reverseMigrationLedgerBatch");
const exportValidationReport_1 = require("../services/migration/core/exportValidationReport");
const exportImportBatchReport_1 = require("../services/migration/core/exportImportBatchReport");
const reconcileMigrationBatch_1 = require("../services/migration/core/reconcileMigrationBatch");
const exportMigrationReconciliationReport_1 = require("../services/migration/core/exportMigrationReconciliationReport");
const buildMigrationSignoffPack_1 = require("../services/migration/core/buildMigrationSignoffPack");
const exportMigrationSignoffPack_1 = require("../services/migration/core/exportMigrationSignoffPack");
const migrationSignoffStore_1 = require("../services/migration/core/migrationSignoffStore");
const buildMigrationPilot_1 = require("../services/migration/core/buildMigrationPilot");
const migrationPilotStore_1 = require("../services/migration/core/migrationPilotStore");
const migrationRunbookStore_1 = require("../services/migration/core/migrationRunbookStore");
const buildDaSilvaRunbook_1 = require("../services/migration/core/buildDaSilvaRunbook");
const buildMigrationPreflightDashboard_1 = require("../services/migration/core/buildMigrationPreflightDashboard");
const staging_1 = require("../services/migration/staging");
const testMigrationAdapter_1 = require("../services/migration/core/testMigrationAdapter");
const listMigrationTargetSchools_1 = require("../services/migration/listMigrationTargetSchools");
const router = (0, express_1.Router)();
const UNIVERSAL_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
const UNIVERSAL_UPLOAD_MAX_FILES = 50;
const UNIVERSAL_ACCEPTED_EXT = new Set([".csv", ".xls", ".xlsx"]);
function isUniversalMigrationUploadFile(file) {
    const name = String(file.originalname || "").toLowerCase();
    const ext = path_1.default.extname(name);
    if (UNIVERSAL_ACCEPTED_EXT.has(ext))
        return true;
    const mime = String(file.mimetype || "").toLowerCase();
    return (mime.includes("csv") ||
        mime.includes("spreadsheet") ||
        mime.includes("excel") ||
        mime === "application/vnd.ms-excel" ||
        mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}
function uniqueStagingFilename(originalName) {
    const safe = String(originalName || "upload").replace(/[^a-zA-Z0-9._-]/g, "_");
    return `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safe}`;
}
const universalUploadDisk = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: (_req, _file, cb) => {
            (0, migrationStagingPath_1.ensureUniversalMigrationStagingDir)();
            cb(null, (0, migrationStagingPath_1.getUniversalMigrationStagingDir)());
        },
        filename: (_req, file, cb) => {
            cb(null, uniqueStagingFilename(String(file.originalname || "upload")));
        },
    }),
    limits: {
        fileSize: UNIVERSAL_UPLOAD_MAX_BYTES,
        files: UNIVERSAL_UPLOAD_MAX_FILES,
    },
});
/** Universal Migration Framework — POST /api/migration/upload */
exports.migrationUploadRouter = (0, express_1.Router)();
exports.migrationUploadRouter.post("/upload", universalUploadDisk.array("files", UNIVERSAL_UPLOAD_MAX_FILES), (req, res) => {
    try {
        const uploaded = collectUploadedFiles(req);
        if (uploaded.length === 0) {
            return jsonError(res, 400, "No files uploaded. Use multipart field name 'files'.");
        }
        const rejected = uploaded.filter((f) => !isUniversalMigrationUploadFile(f));
        if (rejected.length > 0) {
            return jsonError(res, 400, `Unsupported file type. Accepted: CSV, XLS, XLSX (${rejected.map((f) => f.originalname).join(", ")})`);
        }
        const files = uploaded.map((file) => {
            const filename = String(file.originalname || file.filename);
            const storedName = String(file.filename);
            const absolutePath = path_1.default.join((0, migrationStagingPath_1.getUniversalMigrationStagingDir)(), storedName);
            return {
                id: (0, crypto_1.randomUUID)(),
                filename,
                mimeType: String(file.mimetype || "application/octet-stream"),
                size: file.size,
                uploadedAt: new Date(),
                category: (0, detectMigrationCategory_1.detectMigrationCategory)(filename),
                path: absolutePath,
            };
        });
        return res.json({ success: true, files });
    }
    catch (e) {
        console.error("migration/upload", e);
        const message = e instanceof Error ? e.message : "Upload failed";
        return jsonError(res, 500, message);
    }
});
/** Universal Migration Framework — POST /api/migration/preview (read-only, no DB writes) */
exports.migrationUploadRouter.post("/preview", async (req, res) => {
    try {
        const rawFiles = req.body?.files;
        if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
            return jsonError(res, 400, "files array required");
        }
        const sourceSystem = String(req.body?.sourceSystem || "").trim() || undefined;
        const previews = [];
        for (const raw of rawFiles) {
            const fileId = String(raw?.id || "").trim();
            const filePath = String(raw?.path || "").trim();
            const filename = String(raw?.filename || "").trim();
            if (!fileId || !filePath || !filename) {
                return jsonError(res, 400, "Each file must include id, path, and filename");
            }
            const migrationFile = {
                id: fileId,
                filename,
                mimeType: String(raw?.mimeType || "application/octet-stream"),
                size: Number(raw?.size) || 0,
                uploadedAt: raw?.uploadedAt ? new Date(raw.uploadedAt) : new Date(),
                category: raw?.category ?? (0, detectMigrationCategory_1.detectMigrationCategory)(filename),
                path: filePath,
            };
            previews.push(await (0, readMigrationFilePreview_1.readMigrationFilePreview)(migrationFile, { sourceSystem }));
        }
        return res.json({ success: true, previews });
    }
    catch (e) {
        console.error("migration/preview", e);
        const message = e instanceof Error ? e.message : "Preview failed";
        return jsonError(res, 500, message);
    }
});
/** Universal Migration Framework — POST /api/migration/mappings/suggest (read-only, no DB writes) */
exports.migrationUploadRouter.post("/mappings/suggest", (req, res) => {
    try {
        const rawPreviews = req.body?.previews;
        if (!Array.isArray(rawPreviews) || rawPreviews.length === 0) {
            return jsonError(res, 400, "previews array required");
        }
        const systemId = String(req.body?.systemId || "").trim() || undefined;
        const suggestions = [];
        for (const raw of rawPreviews) {
            const preview = raw;
            const fileId = String(preview?.fileId || "").trim();
            const filename = String(preview?.filename || "").trim();
            const category = String(preview?.category || "unknown").trim();
            const columns = Array.isArray(preview?.columns)
                ? preview.columns.map((c) => String(c).trim()).filter(Boolean)
                : [];
            if (!fileId || !filename) {
                return jsonError(res, 400, "Each preview must include fileId and filename");
            }
            suggestions.push((0, suggestColumnMappings_1.suggestColumnMappings)({
                fileId,
                filename,
                category,
                columns,
                systemId,
            }));
        }
        return res.json({ success: true, suggestions });
    }
    catch (e) {
        console.error("migration/mappings/suggest", e);
        const message = e instanceof Error ? e.message : "Mapping suggestion failed";
        return jsonError(res, 500, message);
    }
});
/** Kid-e-Sys adapter readiness — POST /api/migration/adapters/kideesys/readiness (before :systemId routes). */
exports.migrationUploadRouter.post(migrationKidESysReadiness_1.KIDESYS_ADAPTER_READINESS_PATH, migrationKidESysReadiness_1.handleKidESysMigrationReadiness);
/** Universal Migration Framework — POST /api/migration/adapters/:systemId/test (read-only harness, no DB writes). */
exports.migrationUploadRouter.post("/adapters/:systemId/test", (req, res) => {
    try {
        const systemId = String(req.params.systemId || "").trim();
        if (!systemId)
            return jsonError(res, 400, "systemId required");
        const rawFiles = req.body?.uploadedFiles;
        const rawPreviews = req.body?.previews;
        const rawMappings = req.body?.mappings;
        const rawSummary = req.body?.validationSummary;
        const rawReadiness = req.body?.readinessTemplate;
        const uploadedFiles = Array.isArray(rawFiles)
            ? rawFiles.map((raw) => ({
                id: String(raw?.id || "").trim(),
                filename: String(raw?.filename || "").trim(),
                mimeType: String(raw?.mimeType || "application/octet-stream"),
                size: Number(raw?.size) || 0,
                uploadedAt: raw?.uploadedAt ? new Date(String(raw.uploadedAt)) : new Date(),
                category: (String(raw?.category || "unknown").trim() ||
                    (0, detectMigrationCategory_1.detectMigrationCategory)(String(raw?.filename || ""))),
                path: String(raw?.path || "").trim(),
            }))
            : [];
        const previews = Array.isArray(rawPreviews)
            ? rawPreviews.map((raw) => {
                const pathValue = String(raw?.path || "").trim();
                return {
                    fileId: String(raw?.fileId || "").trim(),
                    filename: String(raw?.filename || "").trim(),
                    category: String(raw?.category || "unknown").trim(),
                    columns: Array.isArray(raw?.columns)
                        ? raw.columns.map((c) => String(c).trim()).filter(Boolean)
                        : [],
                    sampleRows: Array.isArray(raw?.sampleRows)
                        ? raw.sampleRows
                        : [],
                    rowCount: Number(raw?.rowCount) || 0,
                    warnings: Array.isArray(raw?.warnings)
                        ? raw.warnings.map((w) => String(w))
                        : [],
                    ...(pathValue ? { path: pathValue } : {}),
                };
            })
            : [];
        const mappings = Array.isArray(rawMappings)
            ? rawMappings.map((raw) => ({
                fileId: String(raw?.fileId || "").trim(),
                mappings: Array.isArray(raw?.mappings)
                    ? raw.mappings
                        .map((m) => ({
                        sourceColumn: String(m?.sourceColumn || "").trim(),
                        targetField: String(m?.targetField || "").trim(),
                    }))
                        .filter((m) => m.sourceColumn && m.targetField)
                    : [],
            }))
            : [];
        let validationSummary = null;
        if (rawSummary && typeof rawSummary === "object") {
            const raw = rawSummary;
            validationSummary = {
                mode: raw.mode === "full" ? "full" : "preview",
                rowsChecked: Number(raw.rowsChecked) || 0,
                totalIssues: Number(raw.totalIssues) || 0,
                errors: Number(raw.errors) || 0,
                warnings: Number(raw.warnings) || 0,
                info: Number(raw.info) || 0,
                canProceed: Boolean(raw.canProceed),
                issuesShown: Number(raw.issuesShown) || 0,
                ...(raw.issuesTruncated ? { issuesTruncated: true } : {}),
                ...(raw.truncationMessage ? { truncationMessage: String(raw.truncationMessage) } : {}),
            };
        }
        let readinessTemplate = null;
        if (rawReadiness && typeof rawReadiness === "object") {
            readinessTemplate = rawReadiness;
        }
        else {
            readinessTemplate = (0, migrationAdapterReadinessStore_1.getReadinessTemplate)(systemId);
        }
        const result = (0, testMigrationAdapter_1.testMigrationAdapter)({
            systemId,
            uploadedFiles,
            previews,
            mappings,
            validationSummary,
            readinessTemplate,
        });
        return res.json({ success: true, result });
    }
    catch (e) {
        console.error("migration/adapters test", e);
        const message = e instanceof Error ? e.message : "Adapter test failed";
        return jsonError(res, 500, message);
    }
});
/** Universal Migration Framework — POST /api/migration/validate (read-only preview + mappings, no DB writes). */
exports.migrationUploadRouter.post("/validate", async (req, res) => {
    try {
        const rawPreviews = req.body?.previews;
        const rawMappings = req.body?.mappings;
        const mode = req.body?.mode === "full" ? "full" : "preview";
        const rawFilePaths = req.body?.filePaths;
        if (!Array.isArray(rawPreviews) || rawPreviews.length === 0) {
            return jsonError(res, 400, "previews array required");
        }
        if (!Array.isArray(rawMappings) || rawMappings.length === 0) {
            return jsonError(res, 400, "mappings array required");
        }
        const previews = rawPreviews.map((raw) => {
            const pathValue = String(raw?.path || "").trim();
            return {
                fileId: String(raw?.fileId || "").trim(),
                filename: String(raw?.filename || "").trim(),
                category: String(raw?.category || "unknown").trim(),
                columns: Array.isArray(raw?.columns)
                    ? raw.columns.map((c) => String(c).trim()).filter(Boolean)
                    : [],
                sampleRows: Array.isArray(raw?.sampleRows)
                    ? raw.sampleRows
                    : [],
                rowCount: Number(raw?.rowCount) || 0,
                warnings: Array.isArray(raw?.warnings)
                    ? raw.warnings.map((w) => String(w))
                    : [],
                ...(pathValue ? { path: pathValue } : {}),
            };
        });
        const mappings = rawMappings.map((raw) => ({
            fileId: String(raw?.fileId || "").trim(),
            mappings: Array.isArray(raw?.mappings)
                ? raw.mappings
                    .map((m) => ({
                    sourceColumn: String(m?.sourceColumn || "").trim(),
                    targetField: String(m?.targetField || "").trim(),
                }))
                    .filter((m) => m.sourceColumn && m.targetField)
                : [],
        }));
        const filePaths = {};
        if (rawFilePaths && typeof rawFilePaths === "object" && !Array.isArray(rawFilePaths)) {
            for (const [key, value] of Object.entries(rawFilePaths)) {
                const pathStr = String(value || "").trim();
                if (key && pathStr)
                    filePaths[key] = pathStr;
            }
        }
        if (previews.some((p) => !p.fileId || !p.filename)) {
            return jsonError(res, 400, "Each preview must include fileId and filename");
        }
        const cutoverDate = String(req.body?.cutoverDate || "").trim() || undefined;
        const { summary, issues } = await (0, validateMigrationPreview_1.validateMigration)({
            previews,
            mappings,
            mode,
            filePaths,
            cutoverDate,
        });
        return res.json({ success: true, summary, issues });
    }
    catch (e) {
        console.error("migration/validate", e);
        const message = e instanceof Error ? e.message : "Validation failed";
        return jsonError(res, 500, message);
    }
});
/** Universal Migration Framework — mapping templates (JSON files, Super Admin only via /api/migration guard). */
exports.migrationUploadRouter.get("/templates", (_req, res) => {
    try {
        const templates = (0, migrationTemplateStore_1.listTemplates)();
        return res.json({ success: true, templates });
    }
    catch (e) {
        console.error("migration/templates list", e);
        const message = e instanceof Error ? e.message : "Failed to list templates";
        return jsonError(res, 500, message);
    }
});
exports.migrationUploadRouter.get("/templates/:id", (req, res) => {
    try {
        const id = String(req.params.id || "").trim();
        if (!id)
            return jsonError(res, 400, "Template id required");
        const template = (0, migrationTemplateStore_1.getTemplate)(id);
        if (!template)
            return jsonError(res, 404, "Template not found");
        return res.json({ success: true, template });
    }
    catch (e) {
        console.error("migration/templates get", e);
        const message = e instanceof Error ? e.message : "Failed to load template";
        return jsonError(res, 500, message);
    }
});
exports.migrationUploadRouter.post("/templates", (req, res) => {
    try {
        const body = req.body ?? {};
        const name = String(body.name || "").trim();
        const sourceSystem = String(body.sourceSystem || "").trim();
        if (!name)
            return jsonError(res, 400, "name is required");
        if (!sourceSystem)
            return jsonError(res, 400, "sourceSystem is required");
        const mappings = Array.isArray(body.mappings) ? body.mappings : [];
        const requestedId = String(body.id || "").trim();
        const template = (0, migrationTemplateStore_1.saveTemplate)({
            ...(requestedId ? { id: requestedId } : {}),
            name,
            sourceSystem,
            description: String(body.description || "").trim(),
            mappings: mappings
                .map((m) => ({
                sourceColumn: String(m?.sourceColumn || "").trim(),
                targetField: String(m?.targetField || "").trim(),
            }))
                .filter((m) => m.sourceColumn && m.targetField),
        });
        return res.json({ success: true, template });
    }
    catch (e) {
        console.error("migration/templates save", e);
        const message = e instanceof Error ? e.message : "Failed to save template";
        const status = message.includes("already exists") ? 409 : 500;
        return jsonError(res, status, message);
    }
});
exports.migrationUploadRouter.delete("/templates/:id", (req, res) => {
    try {
        const id = String(req.params.id || "").trim();
        if (!id)
            return jsonError(res, 400, "Template id required");
        const removed = (0, migrationTemplateStore_1.deleteTemplate)(id);
        if (!removed)
            return jsonError(res, 404, "Template not found");
        return res.json({ success: true, id });
    }
    catch (e) {
        console.error("migration/templates delete", e);
        const message = e instanceof Error ? e.message : "Failed to delete template";
        return jsonError(res, 500, message);
    }
});
/** Universal Migration Framework — South African systems research registry (JSON files, Super Admin only). */
exports.migrationUploadRouter.get("/systems", (_req, res) => {
    try {
        const systems = (0, migrationSystemRegistryStore_1.listMigrationSystemsForApi)();
        return res.json({ success: true, systems });
    }
    catch (e) {
        console.error("migration/systems list", e);
        const message = e instanceof Error ? e.message : "Failed to list systems";
        return jsonError(res, 500, message);
    }
});
exports.migrationUploadRouter.get("/systems/:systemId", (req, res) => {
    try {
        const systemId = String(req.params.systemId || "").trim();
        if (!systemId)
            return jsonError(res, 400, "systemId required");
        const system = (0, migrationSystemRegistryStore_1.getMigrationSystemForApi)(systemId);
        if (!system)
            return jsonError(res, 404, "System not found");
        return res.json({ success: true, system });
    }
    catch (e) {
        console.error("migration/systems get", e);
        const message = e instanceof Error ? e.message : "Failed to load system";
        return jsonError(res, 500, message);
    }
});
exports.migrationUploadRouter.post("/systems", (req, res) => {
    try {
        const body = (req.body ?? {});
        const systemId = String(body.systemId || "").trim();
        const systemName = String(body.systemName || "").trim();
        if (!systemId)
            return jsonError(res, 400, "systemId is required");
        if (!systemName)
            return jsonError(res, 400, "systemName is required");
        const adapterStatus = String(body.adapterStatus || "").trim();
        if (!adapterStatus ||
            !MigrationSystemResearch_1.MIGRATION_ADAPTER_STATUSES.includes(adapterStatus)) {
            return jsonError(res, 400, `adapterStatus must be one of: ${MigrationSystemResearch_1.MIGRATION_ADAPTER_STATUSES.join(", ")}`);
        }
        const exportTypes = Array.isArray(body.exportTypes) ? body.exportTypes : [];
        for (const t of exportTypes) {
            const value = String(t || "").trim();
            if (value && !MigrationSystemResearch_1.MIGRATION_EXPORT_TYPES.includes(value)) {
                return jsonError(res, 400, `Invalid export type: ${value}`);
            }
        }
        const system = (0, migrationSystemRegistryStore_1.saveSystem)({
            systemId,
            systemName,
            vendor: String(body.vendor || "").trim(),
            country: String(body.country || "ZA").trim(),
            website: String(body.website || "").trim(),
            exportTypes: exportTypes
                .map((t) => String(t || "").trim())
                .filter((t) => MigrationSystemResearch_1.MIGRATION_EXPORT_TYPES.includes(t)),
            supportsLearners: Boolean(body.supportsLearners),
            supportsParents: Boolean(body.supportsParents),
            supportsBilling: Boolean(body.supportsBilling),
            supportsTransactions: Boolean(body.supportsTransactions),
            supportsStaff: Boolean(body.supportsStaff),
            notes: String(body.notes || "").trim(),
            adapterStatus: adapterStatus,
            templateCount: 0,
            lastReviewedAt: String(body.lastReviewedAt || new Date().toISOString()),
        });
        return res.json({ success: true, system });
    }
    catch (e) {
        console.error("migration/systems save", e);
        const message = e instanceof Error ? e.message : "Failed to save system";
        return jsonError(res, 500, message);
    }
});
exports.migrationUploadRouter.delete("/systems/:systemId", (req, res) => {
    try {
        const systemId = String(req.params.systemId || "").trim();
        if (!systemId)
            return jsonError(res, 400, "systemId required");
        const removed = (0, migrationSystemRegistryStore_1.deleteSystem)(systemId);
        if (!removed)
            return jsonError(res, 404, "System not found");
        return res.json({ success: true, systemId });
    }
    catch (e) {
        console.error("migration/systems delete", e);
        const message = e instanceof Error ? e.message : "Failed to delete system";
        return jsonError(res, 500, message);
    }
});
/** Universal Migration Framework — adapter readiness templates (JSON files, Super Admin only). */
exports.migrationUploadRouter.get("/readiness-templates", (_req, res) => {
    try {
        const templates = (0, migrationAdapterReadinessStore_1.listReadinessTemplates)();
        return res.json({ success: true, templates });
    }
    catch (e) {
        console.error("migration/readiness-templates list", e);
        const message = e instanceof Error ? e.message : "Failed to list readiness templates";
        return jsonError(res, 500, message);
    }
});
exports.migrationUploadRouter.get("/readiness-templates/:systemId", (req, res) => {
    try {
        const systemId = String(req.params.systemId || "").trim();
        if (!systemId)
            return jsonError(res, 400, "systemId required");
        const template = (0, migrationAdapterReadinessStore_1.getReadinessTemplate)(systemId);
        if (!template)
            return jsonError(res, 404, "Readiness template not found");
        return res.json({ success: true, template });
    }
    catch (e) {
        console.error("migration/readiness-templates get", e);
        const message = e instanceof Error ? e.message : "Failed to load readiness template";
        return jsonError(res, 500, message);
    }
});
exports.migrationUploadRouter.post("/readiness-templates", (req, res) => {
    try {
        const body = (req.body ?? {});
        const systemId = String(body.systemId || "").trim();
        const systemName = String(body.systemName || "").trim();
        if (!systemId)
            return jsonError(res, 400, "systemId is required");
        if (!systemName)
            return jsonError(res, 400, "systemName is required");
        const template = (0, migrationAdapterReadinessStore_1.saveReadinessTemplate)({
            templateId: String(body.templateId || `readiness-${systemId}`).trim(),
            systemId,
            systemName,
            version: String(body.version || "1.0.0").trim(),
            requiredFiles: Array.isArray(body.requiredFiles) ? body.requiredFiles : [],
            requiredFields: Array.isArray(body.requiredFields) ? body.requiredFields : [],
            optionalFields: Array.isArray(body.optionalFields) ? body.optionalFields : [],
            notes: String(body.notes || "").trim(),
            lastReviewedAt: String(body.lastReviewedAt || new Date().toISOString()),
        });
        return res.json({ success: true, template });
    }
    catch (e) {
        console.error("migration/readiness-templates save", e);
        const message = e instanceof Error ? e.message : "Failed to save readiness template";
        return jsonError(res, 500, message);
    }
});
exports.migrationUploadRouter.delete("/readiness-templates/:systemId", (req, res) => {
    try {
        const systemId = String(req.params.systemId || "").trim();
        if (!systemId)
            return jsonError(res, 400, "systemId required");
        const removed = (0, migrationAdapterReadinessStore_1.deleteReadinessTemplate)(systemId);
        if (!removed)
            return jsonError(res, 404, "Readiness template not found");
        return res.json({ success: true, systemId });
    }
    catch (e) {
        console.error("migration/readiness-templates delete", e);
        const message = e instanceof Error ? e.message : "Failed to delete readiness template";
        return jsonError(res, 500, message);
    }
});
/** Universal Migration Framework — dry-run stages (JSON on disk, no live DB writes). */
exports.migrationUploadRouter.post("/stage", async (req, res) => {
    try {
        const sourceSystem = String(req.body?.sourceSystem || "").trim();
        const rawPreviews = req.body?.previews;
        const rawMappings = req.body?.mappings;
        const rawSummary = req.body?.validationSummary;
        if (!sourceSystem)
            return jsonError(res, 400, "sourceSystem is required");
        if (!Array.isArray(rawPreviews) || rawPreviews.length === 0) {
            return jsonError(res, 400, "previews array required");
        }
        if (!Array.isArray(rawMappings) || rawMappings.length === 0) {
            return jsonError(res, 400, "mappings array required");
        }
        if (!rawSummary || typeof rawSummary !== "object") {
            return jsonError(res, 400, "validationSummary required");
        }
        const previews = rawPreviews.map((raw) => {
            const pathValue = String(raw?.path || "").trim();
            return {
                fileId: String(raw?.fileId || "").trim(),
                filename: String(raw?.filename || "").trim(),
                category: String(raw?.category || "unknown").trim(),
                columns: Array.isArray(raw?.columns)
                    ? raw.columns.map((c) => String(c).trim()).filter(Boolean)
                    : [],
                sampleRows: Array.isArray(raw?.sampleRows)
                    ? raw.sampleRows
                    : [],
                rowCount: Number(raw?.rowCount) || 0,
                warnings: Array.isArray(raw?.warnings)
                    ? raw.warnings.map((w) => String(w))
                    : [],
                ...(pathValue ? { path: pathValue } : {}),
            };
        });
        const mappings = rawMappings.map((raw) => ({
            fileId: String(raw?.fileId || "").trim(),
            mappings: Array.isArray(raw?.mappings)
                ? raw.mappings
                    .map((m) => ({
                    sourceColumn: String(m?.sourceColumn || "").trim(),
                    targetField: String(m?.targetField || "").trim(),
                }))
                    .filter((m) => m.sourceColumn && m.targetField)
                : [],
        }));
        const raw = rawSummary;
        const validationMode = raw.mode === "full" ? "full" : "preview";
        const validationSummary = {
            mode: validationMode,
            rowsChecked: Number(raw.rowsChecked) || 0,
            totalIssues: Number(raw.totalIssues) || 0,
            errors: Number(raw.errors) || 0,
            warnings: Number(raw.warnings) || 0,
            info: Number(raw.info) || 0,
            canProceed: Boolean(raw.canProceed),
            issuesShown: Number(raw.issuesShown) || 0,
            ...(raw.issuesTruncated ? { issuesTruncated: true } : {}),
            ...(raw.truncationMessage ? { truncationMessage: String(raw.truncationMessage) } : {}),
        };
        if (previews.some((p) => !p.fileId || !p.filename)) {
            return jsonError(res, 400, "Each preview must include fileId and filename");
        }
        if (validationSummary.mode !== "full") {
            return jsonError(res, 400, "Full-file validation required before staging. Run full-file validation first.");
        }
        if (validationSummary.errors > 0) {
            return jsonError(res, 400, "Fix validation errors before staging. Dry runs require canProceed (zero errors).");
        }
        const rawIssues = req.body?.issues;
        const issues = Array.isArray(rawIssues)
            ? rawIssues.map((raw) => ({
                fileId: String(raw?.fileId || "").trim(),
                filename: String(raw?.filename || "").trim(),
                rowNumber: Number(raw?.rowNumber) || 0,
                severity: String(raw?.severity || "info"),
                category: String(raw?.category || "").trim(),
                field: String(raw?.field || "").trim(),
                message: String(raw?.message || "").trim(),
                value: String(raw?.value || "").trim(),
            }))
            : [];
        const cutoverDate = String(req.body?.cutoverDate || "").trim() || undefined;
        const rowsByFileId = new Map();
        for (const preview of previews) {
            const pathValue = String(preview.path || "").trim();
            if (!pathValue) {
                rowsByFileId.set(preview.fileId, preview.sampleRows);
                continue;
            }
            try {
                const file = {
                    id: preview.fileId,
                    filename: preview.filename,
                    mimeType: "",
                    size: 0,
                    uploadedAt: new Date(),
                    category: preview.category,
                    path: pathValue,
                };
                const parsed = await (0, readMigrationFileRows_1.readMigrationFileRows)(file, { sourceSystem });
                rowsByFileId.set(preview.fileId, parsed.rows);
            }
            catch {
                rowsByFileId.set(preview.fileId, preview.sampleRows);
            }
        }
        const stage = (0, staging_1.buildMigrationStage)({
            sourceSystem,
            previews,
            mappings,
            validationSummary,
            issues,
            cutoverDate,
            rowsByFileId,
        });
        (0, staging_1.createStage)(stage);
        return res.json({ success: true, stage });
    }
    catch (e) {
        console.error("migration/stage create", e);
        const message = e instanceof Error ? e.message : "Failed to create stage";
        return jsonError(res, 500, message);
    }
});
exports.migrationUploadRouter.get("/stages", (_req, res) => {
    try {
        const stages = (0, staging_1.listStages)();
        return res.json({ success: true, stages });
    }
    catch (e) {
        console.error("migration/stages list", e);
        const message = e instanceof Error ? e.message : "Failed to list stages";
        return jsonError(res, 500, message);
    }
});
exports.migrationUploadRouter.get("/stages/:stageId", async (req, res) => {
    try {
        const stageId = String(req.params.stageId || "").trim();
        if (!stageId)
            return jsonError(res, 400, "stageId required");
        const stage = (0, staging_1.getStage)(stageId);
        if (!stage)
            return jsonError(res, 404, "Stage not found");
        const targetSchoolId = String(req.query?.targetSchoolId || "").trim();
        if (targetSchoolId) {
            const applyExpectations = await (0, computeMigrationApplyPreview_1.computeMigrationApplyPreview)(stage, targetSchoolId);
            return res.json({ success: true, stage: { ...stage, applyExpectations } });
        }
        return res.json({ success: true, stage });
    }
    catch (e) {
        console.error("migration/stages get", e);
        const message = e instanceof Error ? e.message : "Failed to load stage";
        return jsonError(res, 500, message);
    }
});
exports.migrationUploadRouter.delete("/stages/:stageId", (req, res) => {
    try {
        const stageId = String(req.params.stageId || "").trim();
        if (!stageId)
            return jsonError(res, 400, "stageId required");
        const removed = (0, staging_1.deleteStage)(stageId);
        if (!removed)
            return jsonError(res, 404, "Stage not found");
        return res.json({ success: true, stageId });
    }
    catch (e) {
        console.error("migration/stages delete", e);
        const message = e instanceof Error ? e.message : "Failed to delete stage";
        return jsonError(res, 500, message);
    }
});
/** Universal Migration Framework — apply approved dry run to one target school (Super Admin only). */
exports.migrationUploadRouter.post("/apply", async (req, res) => {
    try {
        const stageId = String(req.body?.stageId || "").trim();
        const targetSchoolId = String(req.body?.targetSchoolId || "").trim();
        const confirmationText = String(req.body?.confirmationText || "").trim();
        const proceedWithEligibleActiveOnly = Boolean(req.body?.proceedWithEligibleActiveOnly);
        if (!stageId)
            return jsonError(res, 400, "stageId is required");
        if (!targetSchoolId)
            return jsonError(res, 400, "targetSchoolId is required");
        if (!confirmationText)
            return jsonError(res, 400, "confirmationText is required");
        const result = await (0, applyMigrationStage_1.applyMigrationStage)({
            stageId,
            targetSchoolId,
            confirmationText,
            proceedWithEligibleActiveOnly,
        });
        return res.json({ success: true, result });
    }
    catch (e) {
        console.error("migration/apply", e);
        if (e instanceof applyMigrationStage_1.MigrationApplyError) {
            const status = e.message.includes("not found") ? 404 : 400;
            return res.status(status).json({
                success: false,
                error: e.message,
                result: e.result ?? null,
            });
        }
        const message = e instanceof Error ? e.message : "Apply failed";
        return jsonError(res, 500, message);
    }
});
/** Universal Migration Framework — export validation issues as CSV (read-only, Super Admin only). */
exports.migrationUploadRouter.post("/validation/export", (req, res) => {
    try {
        const rawIssues = req.body?.issues;
        if (!Array.isArray(rawIssues)) {
            return jsonError(res, 400, "issues array required");
        }
        const issues = rawIssues.map((raw) => ({
            fileId: String(raw?.fileId || "").trim(),
            filename: String(raw?.filename || "").trim(),
            rowNumber: Number(raw?.rowNumber) || 0,
            severity: String(raw?.severity || "info"),
            category: String(raw?.category || "").trim(),
            field: String(raw?.field || "").trim(),
            message: String(raw?.message || "").trim(),
            value: String(raw?.value || "").trim(),
        }));
        const rawSummary = req.body?.summary;
        const summary = rawSummary && typeof rawSummary === "object"
            ? rawSummary
            : undefined;
        const result = (0, exportValidationReport_1.exportValidationReport)({ summary, issues });
        return res.json({ success: true, downloadPath: result.downloadPath });
    }
    catch (e) {
        console.error("migration/validation/export", e);
        const message = e instanceof Error ? e.message : "Validation export failed";
        return jsonError(res, 500, message);
    }
});
/** Universal Migration Framework — download exported CSV report (Super Admin only). */
exports.migrationUploadRouter.get("/reports/:filename", (req, res) => {
    try {
        const filename = String(req.params.filename || "").trim();
        const filePath = (0, exportValidationReport_1.resolveMigrationReportPath)(filename);
        if (!filePath)
            return jsonError(res, 404, "Report not found");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.sendFile(filePath);
    }
    catch (e) {
        console.error("migration/reports get", e);
        const message = e instanceof Error ? e.message : "Failed to download report";
        return jsonError(res, 500, message);
    }
});
/** Universal Migration Framework — import batch audit list (Super Admin only). */
exports.migrationUploadRouter.get("/import-batches", (_req, res) => {
    try {
        const batches = (0, migrationImportBatchStore_1.listImportBatchSummaries)();
        return res.json({ success: true, batches });
    }
    catch (e) {
        console.error("migration/import-batches list", e);
        const message = e instanceof Error ? e.message : "Failed to list import batches";
        return jsonError(res, 500, message);
    }
});
/** Universal Migration Framework — export import batch report rows as CSV (read-only, Super Admin only). */
exports.migrationUploadRouter.get("/import-batches/:batchId/export", (req, res) => {
    try {
        const batchId = String(req.params.batchId || "").trim();
        if (!batchId)
            return jsonError(res, 400, "batchId required");
        const result = (0, exportImportBatchReport_1.exportImportBatchReport)(batchId);
        return res.json({ success: true, downloadPath: result.downloadPath });
    }
    catch (e) {
        console.error("migration/import-batches export", e);
        const message = e instanceof Error ? e.message : "Batch export failed";
        const status = message.includes("not found") ? 404 : 500;
        return jsonError(res, status, message);
    }
});
/** Universal Migration Framework — full import batch report (Super Admin only). */
exports.migrationUploadRouter.get("/import-batches/:batchId", (req, res) => {
    try {
        const batchId = String(req.params.batchId || "").trim();
        if (!batchId)
            return jsonError(res, 400, "batchId required");
        const batch = (0, migrationImportBatchStore_1.getImportBatch)(batchId);
        if (!batch)
            return jsonError(res, 404, "Import batch not found");
        const hasCreatedTransactions = (batch.reportRows ?? []).some((row) => row.status === "created" && row.entityType === "transaction");
        return res.json({ success: true, batch, hasCreatedTransactions });
    }
    catch (e) {
        console.error("migration/import-batches get", e);
        const message = e instanceof Error ? e.message : "Failed to load import batch";
        return jsonError(res, 500, message);
    }
});
/** Universal Migration Framework — rollback created records from a batch (Super Admin only). */
exports.migrationUploadRouter.post("/import-batches/:batchId/rollback", async (req, res) => {
    try {
        const batchId = String(req.params.batchId || "").trim();
        const targetSchoolId = String(req.body?.targetSchoolId || "").trim();
        const confirmationText = String(req.body?.confirmationText || "").trim();
        if (!batchId)
            return jsonError(res, 400, "batchId required");
        if (!targetSchoolId)
            return jsonError(res, 400, "targetSchoolId is required");
        if (!confirmationText)
            return jsonError(res, 400, "confirmationText is required");
        const result = await (0, rollbackMigrationBatch_1.rollbackMigrationBatch)({
            batchId,
            targetSchoolId,
            confirmationText,
        });
        return res.json({ success: true, result });
    }
    catch (e) {
        console.error("migration/import-batches rollback", e);
        if (e instanceof rollbackMigrationBatch_1.MigrationRollbackError) {
            const status = e.message.includes("not found") ? 404 : 400;
            return res.status(status).json({ success: false, error: e.message });
        }
        const message = e instanceof Error ? e.message : "Rollback failed";
        return jsonError(res, 500, message);
    }
});
/** Universal Migration Framework — final reconciliation (read-only, Super Admin only). */
exports.migrationUploadRouter.post("/import-batches/:batchId/reconcile", async (req, res) => {
    try {
        const batchId = String(req.params.batchId || "").trim();
        const targetSchoolId = String(req.body?.targetSchoolId || "").trim();
        if (!batchId)
            return jsonError(res, 400, "batchId required");
        if (!targetSchoolId)
            return jsonError(res, 400, "targetSchoolId is required");
        const reconciliation = await (0, reconcileMigrationBatch_1.reconcileMigrationBatch)({ batchId, targetSchoolId });
        return res.json({ success: true, reconciliation });
    }
    catch (e) {
        console.error("migration/import-batches reconcile", e);
        if (e instanceof reconcileMigrationBatch_1.MigrationReconciliationError) {
            const status = e.message.includes("not found") ? 404 : 400;
            return res.status(status).json({ success: false, error: e.message });
        }
        const message = e instanceof Error ? e.message : "Reconciliation failed";
        return jsonError(res, 500, message);
    }
});
/** Universal Migration Framework — export reconciliation CSV (read-only, Super Admin only). */
exports.migrationUploadRouter.get("/import-batches/:batchId/reconciliation/export", async (req, res) => {
    try {
        const batchId = String(req.params.batchId || "").trim();
        const targetSchoolId = String(req.query?.targetSchoolId || "").trim();
        if (!batchId)
            return jsonError(res, 400, "batchId required");
        if (!targetSchoolId)
            return jsonError(res, 400, "targetSchoolId query parameter is required");
        const reconciliation = await (0, reconcileMigrationBatch_1.reconcileMigrationBatch)({ batchId, targetSchoolId });
        const result = (0, exportMigrationReconciliationReport_1.exportMigrationReconciliationReport)(reconciliation);
        return res.json({ success: true, downloadPath: result.downloadPath });
    }
    catch (e) {
        console.error("migration/import-batches reconciliation/export", e);
        if (e instanceof reconcileMigrationBatch_1.MigrationReconciliationError) {
            const status = e.message.includes("not found") ? 404 : 400;
            return res.status(status).json({ success: false, error: e.message });
        }
        const message = e instanceof Error ? e.message : "Reconciliation export failed";
        return jsonError(res, 500, message);
    }
});
/** Universal Migration Framework — migration sign-off pack (read-only reporting, Super Admin only). */
exports.migrationUploadRouter.post("/import-batches/:batchId/signoff", async (req, res) => {
    try {
        const batchId = String(req.params.batchId || "").trim();
        const targetSchoolId = String(req.body?.targetSchoolId || "").trim();
        const operatorName = String(req.body?.operatorName || "").trim();
        const operatorEmail = String(req.body?.operatorEmail || "").trim();
        const notes = String(req.body?.notes || "").trim();
        const approvalConfirmed = Boolean(req.body?.approvalConfirmed);
        if (!batchId)
            return jsonError(res, 400, "batchId required");
        if (!targetSchoolId)
            return jsonError(res, 400, "targetSchoolId is required");
        if (!operatorName)
            return jsonError(res, 400, "operatorName is required");
        if (!operatorEmail)
            return jsonError(res, 400, "operatorEmail is required");
        if (!approvalConfirmed)
            return jsonError(res, 400, "approvalConfirmed is required");
        const built = await (0, buildMigrationSignoffPack_1.buildMigrationSignoffPack)({
            batchId,
            targetSchoolId,
            operatorName,
            operatorEmail,
            notes,
            approvalConfirmed,
        });
        const pack = (0, migrationSignoffStore_1.createSignoff)(built);
        const exports = await (0, exportMigrationSignoffPack_1.exportMigrationSignoffPack)(pack);
        const signoffWithExports = (0, migrationSignoffStore_1.updateSignoff)(pack.signoffId, {
            exportedReports: [
                ...pack.exportedReports,
                {
                    label: "Sign-off summary (CSV)",
                    filename: exports.csv.filename,
                    downloadPath: exports.csv.downloadPath,
                },
                {
                    label: "Sign-off summary (PDF)",
                    filename: exports.pdf.filename,
                    downloadPath: exports.pdf.downloadPath,
                },
            ],
        });
        return res.json({ success: true, signoff: signoffWithExports, exports });
    }
    catch (e) {
        console.error("migration/import-batches signoff", e);
        if (e instanceof buildMigrationSignoffPack_1.MigrationSignoffError) {
            const status = e.message.includes("not found") ? 404 : 400;
            return res.status(status).json({ success: false, error: e.message });
        }
        const message = e instanceof Error ? e.message : "Sign-off generation failed";
        return jsonError(res, 500, message);
    }
});
exports.migrationUploadRouter.get("/signoffs", (_req, res) => {
    try {
        const signoffs = (0, migrationSignoffStore_1.listSignoffs)();
        return res.json({ success: true, signoffs });
    }
    catch (e) {
        console.error("migration/signoffs list", e);
        const message = e instanceof Error ? e.message : "Failed to list sign-offs";
        return jsonError(res, 500, message);
    }
});
/** Download sign-off CSV/PDF from storage (Super Admin only). Must be registered before /signoffs/:signoffId. */
exports.migrationUploadRouter.get("/signoffs/files/:filename", (req, res) => {
    try {
        const filename = String(req.params.filename || "").trim();
        const filePath = (0, migrationSignoffStore_1.resolveMigrationSignoffFilePath)(filename);
        if (!filePath)
            return jsonError(res, 404, "File not found");
        const lower = filename.toLowerCase();
        const contentType = lower.endsWith(".pdf")
            ? "application/pdf"
            : "text/csv; charset=utf-8";
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.sendFile(filePath);
    }
    catch (e) {
        console.error("migration/signoffs/files get", e);
        const message = e instanceof Error ? e.message : "Failed to download sign-off file";
        return jsonError(res, 500, message);
    }
});
exports.migrationUploadRouter.get("/signoffs/:signoffId", (req, res) => {
    try {
        const signoffId = String(req.params.signoffId || "").trim();
        if (!signoffId)
            return jsonError(res, 400, "signoffId required");
        const signoff = (0, migrationSignoffStore_1.getSignoff)(signoffId);
        if (!signoff)
            return jsonError(res, 404, "Sign-off not found");
        return res.json({ success: true, signoff });
    }
    catch (e) {
        console.error("migration/signoffs get", e);
        const message = e instanceof Error ? e.message : "Failed to load sign-off";
        return jsonError(res, 500, message);
    }
});
/** Universal Migration Framework — Da Silva pilot validation (read-only, Super Admin only). */
exports.migrationUploadRouter.post("/pilots", async (req, res) => {
    try {
        const body = req.body;
        const built = await (0, buildMigrationPilot_1.buildMigrationPilot)(body);
        const pilot = (0, migrationPilotStore_1.createPilot)({
            schoolId: String(body.schoolId || "").trim(),
            schoolName: String(body.schoolName || "").trim(),
            sourceSystem: String(body.sourceSystem || "").trim(),
            status: built.status,
            uploadedFiles: Array.isArray(body.uploadedFiles) ? body.uploadedFiles : [],
            validationSummary: built.validationSummary,
            dryRunSummary: built.dryRunSummary,
            reconciliationSummary: built.reconciliationSummary,
            notes: String(body.notes || "").trim(),
        });
        return res.json({
            success: true,
            pilot,
            verificationChecks: built.verificationChecks,
            statusReasons: built.statusReasons,
        });
    }
    catch (e) {
        console.error("migration/pilots create", e);
        if (e instanceof buildMigrationPilot_1.MigrationPilotError) {
            const status = e.message.includes("not found") ? 404 : 400;
            return res.status(status).json({ success: false, error: e.message });
        }
        const message = e instanceof Error ? e.message : "Pilot validation record failed";
        return jsonError(res, 500, message);
    }
});
exports.migrationUploadRouter.get("/pilots", (_req, res) => {
    try {
        const pilots = (0, migrationPilotStore_1.listPilots)();
        return res.json({ success: true, pilots });
    }
    catch (e) {
        console.error("migration/pilots list", e);
        const message = e instanceof Error ? e.message : "Failed to list pilots";
        return jsonError(res, 500, message);
    }
});
exports.migrationUploadRouter.get("/pilots/:pilotId", async (req, res) => {
    try {
        const pilotId = String(req.params.pilotId || "").trim();
        if (!pilotId)
            return jsonError(res, 400, "pilotId required");
        const pilot = (0, migrationPilotStore_1.getPilot)(pilotId);
        if (!pilot)
            return jsonError(res, 404, "Pilot not found");
        const verificationChecks = (0, buildMigrationPilot_1.buildPilotVerificationChecks)({
            uploadedFiles: pilot.uploadedFiles,
            validationSummary: pilot.validationSummary,
            dryRunSummary: pilot.dryRunSummary,
            reconciliationSummary: pilot.reconciliationSummary,
            batchId: pilot.reconciliationSummary.batchId,
            schoolId: pilot.schoolId,
            mappingReviewed: pilot.dryRunSummary.stageCreated,
        });
        return res.json({ success: true, pilot, verificationChecks });
    }
    catch (e) {
        console.error("migration/pilots get", e);
        const message = e instanceof Error ? e.message : "Failed to load pilot";
        return jsonError(res, 500, message);
    }
});
/** Universal Migration Framework — Da Silva pilot preflight dashboard (read-only, Super Admin only). */
exports.migrationUploadRouter.get("/preflight/:schoolId", async (req, res) => {
    try {
        const schoolId = String(req.params.schoolId || "").trim();
        if (!schoolId)
            return jsonError(res, 400, "schoolId required");
        const dashboard = await (0, buildMigrationPreflightDashboard_1.buildMigrationPreflightDashboard)({ schoolId });
        return res.json({ success: true, dashboard });
    }
    catch (e) {
        console.error("migration/preflight get", e);
        const message = e instanceof Error ? e.message : "Failed to build preflight dashboard";
        return jsonError(res, 500, message);
    }
});
/** Universal Migration Framework — Da Silva pilot runbook (read-only tracking, Super Admin only). */
exports.migrationUploadRouter.post("/runbooks", (req, res) => {
    try {
        const body = req.body;
        const schoolId = String(body.schoolId || "").trim();
        const schoolName = String(body.schoolName || "").trim();
        if (!schoolId)
            return jsonError(res, 400, "schoolId is required");
        if (!schoolName)
            return jsonError(res, 400, "schoolName is required");
        const runbook = (0, migrationRunbookStore_1.createRunbook)({
            schoolId,
            schoolName,
            sourceSystem: String(body.sourceSystem || "kideesys").trim() || "kideesys",
            pilotId: body.pilotId ? String(body.pilotId).trim() : undefined,
            notes: body.notes ? String(body.notes).trim() : undefined,
        });
        return res.json({ success: true, runbook });
    }
    catch (e) {
        console.error("migration/runbooks create", e);
        const message = e instanceof Error ? e.message : "Failed to create runbook";
        return jsonError(res, 500, message);
    }
});
exports.migrationUploadRouter.get("/runbooks", (_req, res) => {
    try {
        const runbooks = (0, migrationRunbookStore_1.listRunbooks)();
        return res.json({ success: true, runbooks });
    }
    catch (e) {
        console.error("migration/runbooks list", e);
        const message = e instanceof Error ? e.message : "Failed to list runbooks";
        return jsonError(res, 500, message);
    }
});
exports.migrationUploadRouter.get("/runbooks/:runbookId", (req, res) => {
    try {
        const runbookId = String(req.params.runbookId || "").trim();
        if (!runbookId)
            return jsonError(res, 400, "runbookId required");
        const runbook = (0, migrationRunbookStore_1.getRunbook)(runbookId);
        if (!runbook)
            return jsonError(res, 404, "Runbook not found");
        return res.json({ success: true, runbook });
    }
    catch (e) {
        console.error("migration/runbooks get", e);
        const message = e instanceof Error ? e.message : "Failed to load runbook";
        return jsonError(res, 500, message);
    }
});
exports.migrationUploadRouter.patch("/runbooks/:runbookId", (req, res) => {
    try {
        const runbookId = String(req.params.runbookId || "").trim();
        if (!runbookId)
            return jsonError(res, 400, "runbookId required");
        const body = req.body;
        const stepPatches = Array.isArray(body.steps) ? body.steps : [];
        for (const patch of stepPatches) {
            if (patch.status !== undefined && !(0, buildDaSilvaRunbook_1.assertValidRunbookStepStatus)(String(patch.status))) {
                return jsonError(res, 400, `Invalid step status for ${patch.stepId || "step"}`);
            }
        }
        const runbook = (0, migrationRunbookStore_1.updateRunbook)(runbookId, {
            ...(Array.isArray(body.steps) ? { steps: body.steps } : {}),
            ...(body.notes !== undefined ? { notes: String(body.notes) } : {}),
            ...(body.pilotId !== undefined
                ? { pilotId: body.pilotId == null ? null : String(body.pilotId).trim() }
                : {}),
        });
        return res.json({ success: true, runbook });
    }
    catch (e) {
        console.error("migration/runbooks patch", e);
        const message = e instanceof Error ? e.message : "Failed to update runbook";
        if (message.includes("not found"))
            return jsonError(res, 404, message);
        return jsonError(res, 500, message);
    }
});
/** Universal Migration Framework — reversal rollback for posted ledger transactions (Super Admin only). */
exports.migrationUploadRouter.post("/import-batches/:batchId/reverse-ledger", async (req, res) => {
    try {
        const batchId = String(req.params.batchId || "").trim();
        const targetSchoolId = String(req.body?.targetSchoolId || "").trim();
        const confirmationText = String(req.body?.confirmationText || "").trim();
        if (!batchId)
            return jsonError(res, 400, "batchId required");
        if (!targetSchoolId)
            return jsonError(res, 400, "targetSchoolId is required");
        if (!confirmationText)
            return jsonError(res, 400, "confirmationText is required");
        const result = await (0, reverseMigrationLedgerBatch_1.reverseMigrationLedgerBatch)({
            batchId,
            targetSchoolId,
            confirmationText,
        });
        return res.json({ success: true, result });
    }
    catch (e) {
        console.error("migration/import-batches reverse-ledger", e);
        if (e instanceof reverseMigrationLedgerBatch_1.MigrationReversalError) {
            const status = e.message.includes("not found") ? 404 : 400;
            return res.status(status).json({ success: false, error: e.message });
        }
        const message = e instanceof Error ? e.message : "Reversal rollback failed";
        return jsonError(res, 500, message);
    }
});
function migrationUploadErrorHandler(err, _req, res, next) {
    if (res.headersSent)
        return next(err);
    if (err instanceof multer_1.default.MulterError) {
        const message = err.code === "LIMIT_FILE_SIZE"
            ? `Upload too large (max ${Math.round(UNIVERSAL_UPLOAD_MAX_BYTES / (1024 * 1024))}MB per file)`
            : err.code === "LIMIT_FILE_COUNT"
                ? `Too many files (max ${UNIVERSAL_UPLOAD_MAX_FILES})`
                : err.message || "Upload failed";
        return jsonError(res, err.code === "LIMIT_FILE_SIZE" ? 413 : 400, message);
    }
    const message = err instanceof Error ? err.message : "Upload failed";
    return jsonError(res, 500, message);
}
const uploadMemory = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 24 * 1024 * 1024 },
});
const kideesysUploadDir = path_1.default.join(process.cwd(), "uploads", "migration-staging", "tmp");
/** Kid-e-Sys: up to ~21 class lists + 6 export groups; transaction export can exceed 28MB. */
const KIDEESYS_MAX_FILE_BYTES = 100 * 1024 * 1024;
const KIDEESYS_MAX_FILES = 40;
const KIDEESYS_MAX_FIELDS = 32;
const KIDEESYS_UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const uploadDisk = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: (_req, _file, cb) => {
            if (!fs_1.default.existsSync(kideesysUploadDir))
                fs_1.default.mkdirSync(kideesysUploadDir, { recursive: true });
            cb(null, kideesysUploadDir);
        },
        filename: (_req, file, cb) => {
            cb(null, `${Date.now()}-${String(file.originalname || "upload").replace(/[^a-zA-Z0-9._-]/g, "_")}`);
        },
    }),
    limits: {
        fileSize: KIDEESYS_MAX_FILE_BYTES,
        files: KIDEESYS_MAX_FILES,
        fields: KIDEESYS_MAX_FIELDS,
        parts: KIDEESYS_MAX_FILES + KIDEESYS_MAX_FIELDS,
    },
});
const CORE_CATEGORIES = new Set([
    "learners",
    "parents",
    "parentRelationships",
    "classes",
]);
function parseCategories(raw) {
    const list = Array.isArray(raw) ? raw.map(String) : [];
    return list.filter((c) => CORE_CATEGORIES.has(c));
}
function isMultipartRequest(req) {
    const ct = String(req.headers["content-type"] || "").toLowerCase();
    return ct.includes("multipart/form-data");
}
function collectUploadedFiles(req) {
    const files = req.files;
    if (!files)
        return [];
    if (Array.isArray(files))
        return files;
    return Object.values(files).flat();
}
function jsonError(res, status, message) {
    return res.status(status).json({ error: message });
}
function isRequestAbortedError(err) {
    if (!(err instanceof Error))
        return false;
    const msg = err.message.toLowerCase();
    return msg === "request aborted" || msg.includes("aborted") || msg.includes("unexpected end");
}
function logValidateAbort(req, reason, extra) {
    console.warn("[migration/validate] request aborted", {
        reason,
        schoolId: String(req.body?.schoolId || "").trim() || undefined,
        projectId: String(req.body?.projectId || "").trim() || undefined,
        contentLength: req.headers["content-length"],
        ...extra,
    });
}
/** Extend socket timeouts for large Kid-e-Sys multipart uploads. */
function kideesysValidateUploadGuard(req, res, next) {
    const startedAt = Date.now();
    let uploadCompleted = false;
    req.setTimeout(KIDEESYS_UPLOAD_TIMEOUT_MS);
    res.setTimeout(KIDEESYS_UPLOAD_TIMEOUT_MS);
    if (req.socket) {
        req.socket.setTimeout(KIDEESYS_UPLOAD_TIMEOUT_MS);
        req.socket.setKeepAlive(true, 30000);
    }
    console.log("[migration/validate] upload started", {
        schoolId: String(req.body?.schoolId || req.headers["x-migration-school-id"] || "").trim() || undefined,
        projectId: String(req.body?.projectId || req.headers["x-migration-project-id"] || "").trim() || undefined,
        contentLength: req.headers["content-length"],
        contentType: req.headers["content-type"],
    });
    req.on("aborted", () => {
        if (uploadCompleted || res.headersSent)
            return;
        logValidateAbort(req, "client aborted before upload finished", {
            elapsedMs: Date.now() - startedAt,
        });
    });
    req.on("close", () => {
        if (uploadCompleted || res.headersSent)
            return;
        logValidateAbort(req, "connection closed before response", {
            elapsedMs: Date.now() - startedAt,
            destroyed: req.destroyed,
        });
    });
    res.on("finish", () => {
        uploadCompleted = true;
    });
    req.__kideesysUploadGuard = {
        markUploadComplete() {
            uploadCompleted = true;
            console.log("[migration/validate] upload completed", {
                elapsedMs: Date.now() - startedAt,
            });
        },
    };
    next();
}
/** Return JSON for multer / payload errors instead of HTML 500 pages. */
function migrationErrorHandler(err, req, res, next) {
    if (res.headersSent)
        return next(err);
    if (err instanceof multer_1.default.MulterError) {
        const message = err.code === "LIMIT_FILE_SIZE"
            ? `Upload too large (max ${Math.round(KIDEESYS_MAX_FILE_BYTES / (1024 * 1024))}MB per file). Kid-e-Sys transaction exports can be ~28MB — upload all exports via Validate Files (multipart).`
            : err.code === "LIMIT_FILE_COUNT"
                ? `Too many files (max ${KIDEESYS_MAX_FILES}). Upload all Kid-e-Sys exports in one Validate Files pass.`
                : err.message || "Upload failed";
        return jsonError(res, err.code === "LIMIT_FILE_SIZE" ? 413 : 400, message);
    }
    const entityType = err?.type;
    if (entityType === "entity.too.large") {
        return jsonError(res, 413, "Request payload too large. For Kid-e-Sys, upload exports via Validate Files (multipart) instead of sending parsed rows as JSON.");
    }
    if (isRequestAbortedError(err)) {
        logValidateAbort(req, err instanceof Error ? err.message : "request aborted");
        return jsonError(res, 408, "Upload interrupted before the server finished receiving files. Keep this tab open until validation completes — do not refresh or navigate away.");
    }
    const message = err instanceof Error ? err.message : "Migration request failed";
    console.error("migration route error", err);
    return jsonError(res, 500, message);
}
/** Legacy + universal migration — all real School rows (Da Silva ensured if missing). */
router.get("/target-schools", async (_req, res) => {
    try {
        const result = await (0, listMigrationTargetSchools_1.listMigrationTargetSchools)();
        console.log("[migration/target-schools]", {
            total: result.debug.total,
            schoolIds: result.debug.schoolIds,
            schoolNames: result.debug.schoolNames,
            ensuredDaSilva: result.debug.ensuredDaSilva,
            daSilvaCreated: result.debug.daSilvaCreated,
        });
        return res.json(result);
    }
    catch (e) {
        console.error("migration/target-schools", e);
        const message = e instanceof Error ? e.message : "Failed to list migration target schools";
        return jsonError(res, 500, message);
    }
});
router.get("/template", (_req, res) => {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="educlear-migration-learners.csv"');
    res.send(migrationService_1.MIGRATION_CSV_TEMPLATE);
});
router.post("/parse-learner-file", uploadMemory.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return jsonError(res, 400, "Learner file required (CSV, XLS, or XLSX).");
        }
        const fileName = String(req.file.originalname || "upload").trim();
        if (!(0, migrationLearnerFileParser_1.isAcceptedLearnerMigrationFileName)(fileName)) {
            return jsonError(res, 400, "Learner file must be CSV, XLS, or XLSX.");
        }
        const parsed = (0, migrationLearnerFileParser_1.parseMigrationLearnerFileBuffer)(req.file.buffer, fileName);
        if (!parsed.rows.length) {
            return jsonError(res, 400, "No learner rows found in file.");
        }
        return res.json({
            success: true,
            fileName: parsed.fileName,
            headers: parsed.headers,
            rows: parsed.rows,
        });
    }
    catch (e) {
        console.error("migration parse-learner-file", e);
        const message = e instanceof Error ? e.message : "Failed to parse learner file";
        return jsonError(res, 400, message);
    }
});
router.post("/projects", async (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        const source = String(req.body?.source || "csv").trim();
        if (!schoolId)
            return jsonError(res, 400, "schoolId required");
        const projectId = (0, migrationService_1.createProjectId)();
        return res.json({
            success: true,
            projectId,
            schoolId,
            source,
            categories: parseCategories(req.body?.categories),
        });
    }
    catch (e) {
        console.error("migration project", e);
        const message = e instanceof Error ? e.message : "Failed to create project";
        return jsonError(res, 500, message);
    }
});
router.post("/validate", (req, res, next) => {
    if (!isMultipartRequest(req))
        return next();
    kideesysValidateUploadGuard(req, res, () => {
        uploadDisk.any()(req, res, (err) => {
            const uploaded = collectUploadedFiles(req);
            console.log("[migration/validate] files received count", {
                count: uploaded.length,
                names: uploaded.map((f) => f.originalname || f.filename),
            });
            req.__kideesysUploadGuard?.markUploadComplete();
            if (err)
                return migrationErrorHandler(err, req, res, next);
            next();
        });
    });
}, async (req, res) => {
    try {
        const source = String(req.body?.source || "csv").trim();
        const schoolId = String(req.body?.schoolId || "").trim();
        const projectId = String(req.body?.projectId || (0, migrationService_1.createProjectId)()).trim();
        if (!schoolId)
            return jsonError(res, 400, "schoolId required");
        if (source === "kideesys" && isMultipartRequest(req)) {
            const uploaded = collectUploadedFiles(req);
            if (!uploaded.length) {
                return jsonError(res, 400, "Upload Kid-e-Sys .xls exports (class lists, contacts, billing, age analysis, transactions, employees) before validating.");
            }
            console.log("[migration/validate] validation started", {
                schoolId,
                projectId,
                fileCount: uploaded.length,
            });
            const result = await (0, kideesysMigrationValidate_1.validateKideesysMigrationUploads)({
                schoolId,
                projectId,
                files: uploaded,
            });
            return res.json({
                success: true,
                projectId: result.projectId,
                report: result.report,
                confirmToken: result.confirmToken,
                daSilvaConfirmToken: result.daSilvaConfirmToken,
                stagedRows: result.stagedRows,
                countValidation: result.countValidation,
                summary: result.summary,
                validated: result.report.canImport,
                fileName: `${uploaded.length} Kid-e-Sys export file(s)`,
                kideesys: true,
            });
        }
        if (source === "kideesys") {
            return jsonError(res, 400, "Kid-e-Sys validation requires multipart file upload. Upload all six export groups and click Validate Files again.");
        }
        const headers = Array.isArray(req.body?.headers)
            ? req.body.headers.map(String)
            : [];
        const rawRows = Array.isArray(req.body?.rows) ? req.body.rows : [];
        if (!rawRows.length)
            return jsonError(res, 400, "No rows to validate");
        const categories = parseCategories(req.body?.categories);
        if (categories.length &&
            !categories.some((c) => c === "learners" || c === "classes")) {
            return jsonError(res, 400, "Select Learners and/or Classes categories for this validation pass");
        }
        const mappings = headers.length > 0 ? (0, migrationService_1.buildFieldMappings)(headers) : [];
        const rows = rawRows.map((raw, i) => headers.length
            ? (0, migrationService_1.mapRawRow)(raw, i + 1, mappings)
            : {
                rowIndex: i + 1,
                firstName: String(raw.firstName || raw.first_name || "").trim(),
                lastName: String(raw.lastName || raw.last_name || raw.surname || "").trim(),
                grade: String(raw.grade || "").trim(),
                className: String(raw.className || raw.class_name || raw.class || raw.classroom || "").trim(),
                admissionNo: String(raw.admissionNo || raw.admission_no || "").trim() || undefined,
                idNumber: String(raw.idNumber || raw.id_number || "").trim() || undefined,
                birthDate: String(raw.birthDate || "").trim() || undefined,
                gender: String(raw.gender || "").trim() || undefined,
                parentFirstName: String(raw.parentFirstName || "").trim() || undefined,
                parentSurname: String(raw.parentSurname || "").trim() || undefined,
                parentMobile: String(raw.parentMobile || raw.parent_mobile || "").trim() || undefined,
                parentEmail: String(raw.parentEmail || "").trim() || undefined,
                parentIdNumber: String(raw.parentIdNumber || "").trim() || undefined,
                relation: String(raw.relation || "").trim() || undefined,
                teacherName: String(raw.teacherName || "").trim() || undefined,
                teacherEmail: String(raw.teacherEmail || "").trim() || undefined,
            });
        const report = await (0, migrationService_1.validateMigrationRows)({
            schoolId,
            source,
            projectId,
            rows,
            headers,
        });
        const confirmToken = (0, migrationService_1.buildConfirmToken)(projectId, report);
        return res.json({
            success: true,
            projectId,
            report,
            confirmToken,
            validated: report.canImport,
            summary: {
                rowCount: report.rowCount,
                blockingErrors: report.blockingErrorCount,
                warnings: report.warningCount,
                canImport: report.canImport,
                duplicateClassrooms: report.duplicateClassrooms.length,
                duplicateLearners: report.duplicateLearners.length,
                missingParents: report.missingParents.length,
                teacherWarnings: report.teacherAssignmentWarnings.length,
            },
        });
    }
    catch (e) {
        console.error("migration validate", e);
        const message = e instanceof Error ? e.message : "Validation failed";
        return jsonError(res, 500, message);
    }
});
router.post("/staging", async (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        const projectId = String(req.body?.projectId || "").trim();
        const source = String(req.body?.source || "csv").trim();
        const report = req.body?.report;
        const rows = req.body?.rows;
        if (!schoolId || !projectId || !report || !Array.isArray(rows)) {
            return jsonError(res, 400, "schoolId, projectId, report, and rows required");
        }
        await (0, migrationService_1.saveMigrationStaging)({
            projectId,
            schoolId,
            source,
            categories: parseCategories(req.body?.categories),
            createdAt: new Date().toISOString(),
            rows,
            validation: report,
        });
        return res.json({ success: true, projectId, stagedRows: rows.length });
    }
    catch (e) {
        console.error("migration staging", e);
        const message = e instanceof Error ? e.message : "Staging failed";
        return jsonError(res, 500, message);
    }
});
router.get("/staging/:projectId/preview", async (req, res) => {
    try {
        const schoolId = String(req.query.schoolId || "").trim();
        const projectId = String(req.params.projectId || "").trim();
        if (!schoolId || !projectId) {
            return jsonError(res, 400, "schoolId and projectId required");
        }
        const staging = (0, migrationService_1.loadMigrationStaging)(schoolId, projectId);
        if (!staging)
            return jsonError(res, 404, "Staging not found");
        return res.json({
            success: true,
            projectId,
            schoolId,
            report: staging.validation,
            confirmToken: (0, migrationService_1.buildConfirmToken)(projectId, staging.validation),
            normalizationPreview: staging.validation.normalizationPreview,
            canImport: staging.validation.canImport,
        });
    }
    catch (e) {
        console.error("migration preview", e);
        const message = e instanceof Error ? e.message : "Preview failed";
        return jsonError(res, 500, message);
    }
});
router.post("/import", async (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        const projectId = String(req.body?.projectId || "").trim();
        const confirmToken = String(req.body?.confirmToken || "").trim();
        const acknowledgedWarnings = req.body?.acknowledgedWarnings === true;
        if (!schoolId || !projectId || !confirmToken) {
            return jsonError(res, 400, "schoolId, projectId, and confirmToken required");
        }
        const staging = (0, migrationService_1.loadMigrationStaging)(schoolId, projectId);
        if (!staging) {
            return jsonError(res, 400, "Import staging not found — run staging import first");
        }
        if (!staging.validation.canImport) {
            return res.status(400).json({
                error: "Cannot import while validation has blocking errors",
                blockingErrorCount: staging.validation.blockingErrorCount,
            });
        }
        if (staging.validation.warningCount > 0 && !acknowledgedWarnings) {
            return res.status(400).json({
                error: "Acknowledge warnings before final import",
                warningCount: staging.validation.warningCount,
                requiresAcknowledgement: true,
                confirmToken: (0, migrationService_1.buildConfirmToken)(projectId, staging.validation),
                normalizationPreview: staging.validation.normalizationPreview,
            });
        }
        const result = await (0, migrationService_1.commitMigrationImport)({ schoolId, projectId, confirmToken });
        return res.json(result);
    }
    catch (e) {
        console.error("migration import", e);
        const message = e instanceof Error ? e.message : "Import failed";
        return jsonError(res, 500, message);
    }
});
router.post("/rollback", async (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        const projectId = String(req.body?.projectId || "").trim();
        if (!schoolId || !projectId) {
            return jsonError(res, 400, "schoolId and projectId required");
        }
        const result = await (0, migrationService_1.rollbackMigrationImport)({ schoolId, projectId });
        return res.json(result);
    }
    catch (e) {
        console.error("migration rollback", e);
        const message = e instanceof Error ? e.message : "Rollback failed";
        return jsonError(res, 500, message);
    }
});
router.post("/repair-classrooms", async (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        if (!schoolId)
            return jsonError(res, 400, "schoolId required");
        const result = await (0, migrationService_1.repairSchoolClassroomNames)(schoolId);
        return res.json({ success: true, ...result });
    }
    catch (e) {
        console.error("migration repair-classrooms", e);
        const message = e instanceof Error ? e.message : "Repair failed";
        return jsonError(res, 500, message);
    }
});
exports.default = router;
