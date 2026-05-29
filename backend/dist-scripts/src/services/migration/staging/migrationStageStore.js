"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStage = createStage;
exports.getStage = getStage;
exports.listStages = listStages;
exports.deleteStage = deleteStage;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const STAGES_DIR = path_1.default.join(process.cwd(), "storage", "migration-stages");
function ensureStagesDir() {
    if (!fs_1.default.existsSync(STAGES_DIR)) {
        fs_1.default.mkdirSync(STAGES_DIR, { recursive: true });
    }
}
function sanitizeStageId(id) {
    const trimmed = String(id || "").trim();
    if (!trimmed)
        return null;
    if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\"))
        return null;
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed))
        return null;
    return trimmed;
}
function stageFilePath(id) {
    const safe = sanitizeStageId(id);
    if (!safe)
        throw new Error("Invalid stage id");
    const resolved = path_1.default.resolve(STAGES_DIR, `${safe}.json`);
    if (!resolved.startsWith(path_1.default.resolve(STAGES_DIR) + path_1.default.sep)) {
        throw new Error("Invalid stage path");
    }
    return resolved;
}
function parseStageFile(raw, fileId) {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object")
            return null;
        const stageId = String(parsed.stageId || fileId).trim();
        const createdAt = String(parsed.createdAt || "").trim();
        const sourceSystem = String(parsed.sourceSystem || "").trim();
        if (!stageId || !createdAt || !sourceSystem)
            return null;
        const files = Array.isArray(parsed.files)
            ? parsed.files
                .map((f) => {
                const pathRaw = String(f.path || "").trim();
                return {
                    fileId: String(f.fileId || "").trim(),
                    filename: String(f.filename || "").trim(),
                    category: String(f.category || "unknown").trim(),
                    rowCount: Number(f.rowCount) || 0,
                    ...(pathRaw ? { path: pathRaw } : {}),
                };
            })
                .filter((f) => f.fileId && f.filename)
            : [];
        const mappings = Array.isArray(parsed.mappings)
            ? parsed.mappings
                .map((m) => ({
                fileId: String(m.fileId || "").trim(),
                mappings: Array.isArray(m.mappings)
                    ? (m.mappings)
                        .map((row) => ({
                        sourceColumn: String(row?.sourceColumn || "").trim(),
                        targetField: String(row?.targetField || "").trim(),
                    }))
                        .filter((row) => row.sourceColumn && row.targetField)
                    : [],
            }))
                .filter((m) => m.fileId)
            : [];
        const validationSummary = parsed.validationSummary;
        if (!validationSummary ||
            typeof validationSummary !== "object" ||
            typeof validationSummary.canProceed !== "boolean") {
            return null;
        }
        const stagedCounts = parsed.stagedCounts;
        if (!stagedCounts || typeof stagedCounts !== "object")
            return null;
        const counts = {
            learners: Number(stagedCounts.learners) || 0,
            parents: Number(stagedCounts.parents) || 0,
            billingAccounts: Number(stagedCounts.billingAccounts) || 0,
            transactions: Number(stagedCounts.transactions) || 0,
            staff: Number(stagedCounts.staff) || 0,
            historical: Number(stagedCounts.historical) || 0,
        };
        const rawReadiness = parsed.transactionReadiness;
        const transactionReadiness = {
            historicalOnlyTransactions: Number(rawReadiness
                ?.historicalOnlyTransactions) || 0,
            eligibleActiveTransactions: Number(rawReadiness
                ?.eligibleActiveTransactions) || 0,
            blockedTransactions: Number(rawReadiness?.blockedTransactions) || 0,
            unmatchedTransactions: Number(rawReadiness?.unmatchedTransactions) || 0,
        };
        const cutoverRaw = String(parsed.cutoverDate || "").trim();
        const cutoverDate = cutoverRaw && !Number.isNaN(Date.parse(cutoverRaw))
            ? new Date(cutoverRaw).toISOString().slice(0, 10)
            : undefined;
        const warnings = Array.isArray(parsed.warnings)
            ? parsed.warnings.map((w) => String(w)).filter(Boolean)
            : [];
        return {
            stageId,
            createdAt,
            sourceSystem,
            ...(cutoverDate ? { cutoverDate } : {}),
            files,
            mappings,
            validationSummary: validationSummary,
            stagedCounts: counts,
            transactionReadiness,
            warnings,
            canApply: Boolean(parsed.canApply),
        };
    }
    catch {
        return null;
    }
}
function toListItem(stage) {
    return {
        stageId: stage.stageId,
        createdAt: stage.createdAt,
        sourceSystem: stage.sourceSystem,
        stagedCounts: stage.stagedCounts,
        canApply: stage.canApply,
        fileCount: stage.files.length,
    };
}
function createStage(stage) {
    ensureStagesDir();
    const safeId = sanitizeStageId(stage.stageId);
    if (!safeId)
        throw new Error("Invalid stage id");
    const filePath = stageFilePath(safeId);
    if (fs_1.default.existsSync(filePath)) {
        throw new Error("Stage id already exists");
    }
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs_1.default.writeFileSync(tmpPath, JSON.stringify(stage, null, 2), "utf8");
    fs_1.default.renameSync(tmpPath, filePath);
    return stage;
}
function getStage(stageId) {
    ensureStagesDir();
    const safeId = sanitizeStageId(stageId);
    if (!safeId)
        return null;
    const filePath = stageFilePath(safeId);
    if (!fs_1.default.existsSync(filePath))
        return null;
    try {
        const raw = fs_1.default.readFileSync(filePath, "utf8");
        return parseStageFile(raw, safeId);
    }
    catch {
        return null;
    }
}
function listStages() {
    ensureStagesDir();
    const entries = fs_1.default.readdirSync(STAGES_DIR, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json"))
            continue;
        const fileId = entry.name.replace(/\.json$/i, "");
        try {
            const raw = fs_1.default.readFileSync(path_1.default.join(STAGES_DIR, entry.name), "utf8");
            const stage = parseStageFile(raw, fileId);
            if (stage)
                items.push(toListItem(stage));
        }
        catch {
            // Skip corrupt files
        }
    }
    return items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
function deleteStage(stageId) {
    ensureStagesDir();
    const safeId = sanitizeStageId(stageId);
    if (!safeId)
        return false;
    const filePath = stageFilePath(safeId);
    if (!fs_1.default.existsSync(filePath))
        return false;
    fs_1.default.unlinkSync(filePath);
    return true;
}
