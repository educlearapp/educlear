"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KIDESYS_ADAPTER_READINESS_PATH = void 0;
exports.handleKidESysMigrationReadiness = handleKidESysMigrationReadiness;
const buildKidESysMigrationReadiness_1 = require("../services/migration/core/buildKidESysMigrationReadiness");
/** Mounted under /api/migration — POST /api/migration/adapters/kideesys/readiness */
exports.KIDESYS_ADAPTER_READINESS_PATH = "/adapters/kideesys/readiness";
function jsonError(res, status, message) {
    return res.status(status).json({ error: message });
}
/** Kid-e-Sys adapter readiness + migration validation (read-only, no DB writes). */
async function handleKidESysMigrationReadiness(req, res) {
    console.log("Kid-e-Sys readiness endpoint hit");
    try {
        const rawPreviews = req.body?.previews;
        const rawMappings = req.body?.mappings;
        const rawFiles = req.body?.uploadedFiles;
        const fullFileChecks = req.body?.fullFileChecks === true;
        const rawFilePaths = req.body?.filePaths;
        if (!Array.isArray(rawPreviews) || rawPreviews.length === 0) {
            return jsonError(res, 400, "previews array required");
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
        const uploadedFiles = Array.isArray(rawFiles)
            ? rawFiles.map((raw) => ({
                id: String(raw?.id || "").trim(),
                filename: String(raw?.filename || "").trim(),
                mimeType: String(raw?.mimeType || "application/octet-stream"),
                size: Number(raw?.size) || 0,
                uploadedAt: new Date(),
                category: String(raw?.category || "unknown").trim(),
                path: String(raw?.path || "").trim(),
            }))
            : [];
        const filePaths = {};
        if (rawFilePaths && typeof rawFilePaths === "object" && !Array.isArray(rawFilePaths)) {
            for (const [key, value] of Object.entries(rawFilePaths)) {
                const pathStr = String(value || "").trim();
                if (key && pathStr)
                    filePaths[key] = pathStr;
            }
        }
        const result = await (0, buildKidESysMigrationReadiness_1.buildKidESysMigrationReadiness)({
            uploadedFiles,
            previews,
            mappings,
            fullFileChecks,
            filePaths,
        });
        return res.json({ success: true, result });
    }
    catch (e) {
        console.error("migration/adapters/kideesys/readiness", e);
        const message = e instanceof Error ? e.message : "Kid-e-Sys readiness check failed";
        return jsonError(res, 500, message);
    }
}
