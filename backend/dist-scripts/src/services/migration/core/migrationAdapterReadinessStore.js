"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedMigrationAdapterReadinessIfEmpty = seedMigrationAdapterReadinessIfEmpty;
exports.listReadinessTemplates = listReadinessTemplates;
exports.getReadinessTemplate = getReadinessTemplate;
exports.saveReadinessTemplate = saveReadinessTemplate;
exports.deleteReadinessTemplate = deleteReadinessTemplate;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const MigrationTargetField_1 = require("../types/MigrationTargetField");
const migrationAdapterReadinessSeed_1 = require("./migrationAdapterReadinessSeed");
const READINESS_DIR = path_1.default.join(process.cwd(), "storage", "migration-adapter-readiness");
/** Prevents re-entrant seeding when saveReadinessTemplate calls getReadinessTemplate before the first file is written. */
let readinessSeedInProgress = false;
const FILE_CATEGORIES = [
    "learners",
    "parents",
    "billing",
    "transactions",
    "staff",
    "historical",
    "unknown",
];
function ensureReadinessDir() {
    if (!fs_1.default.existsSync(READINESS_DIR)) {
        fs_1.default.mkdirSync(READINESS_DIR, { recursive: true });
    }
}
function sanitizeSystemId(id) {
    const trimmed = String(id || "").trim();
    if (!trimmed)
        return null;
    if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\"))
        return null;
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed))
        return null;
    return trimmed;
}
function readinessFilePath(systemId) {
    const safe = sanitizeSystemId(systemId);
    if (!safe)
        throw new Error("Invalid system id");
    const resolved = path_1.default.resolve(READINESS_DIR, `${safe}.json`);
    if (!resolved.startsWith(path_1.default.resolve(READINESS_DIR) + path_1.default.sep)) {
        throw new Error("Invalid readiness path");
    }
    return resolved;
}
function isFileCategory(value) {
    return FILE_CATEGORIES.includes(value);
}
function isTargetField(value) {
    return MigrationTargetField_1.ALL_MIGRATION_TARGET_FIELDS.includes(value);
}
function parseRequiredFile(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const o = raw;
    const fileKey = String(o.fileKey || "").trim();
    const label = String(o.label || "").trim();
    const category = String(o.category || "").trim();
    if (!fileKey || !label || !isFileCategory(category))
        return null;
    const acceptedTypes = Array.isArray(o.acceptedTypes)
        ? o.acceptedTypes.map((t) => String(t || "").trim().toLowerCase()).filter(Boolean)
        : [];
    return {
        fileKey,
        label,
        description: String(o.description || "").trim(),
        required: Boolean(o.required),
        acceptedTypes,
        category,
    };
}
function parseRequiredField(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const o = raw;
    const fieldKey = String(o.fieldKey || "").trim();
    const label = String(o.label || "").trim();
    const targetField = String(o.targetField || "").trim();
    const category = String(o.category || "").trim();
    if (!fieldKey || !label || !isTargetField(targetField) || !isFileCategory(category))
        return null;
    const aliases = Array.isArray(o.aliases)
        ? o.aliases.map((a) => String(a || "").trim()).filter(Boolean)
        : [];
    return {
        fieldKey,
        label,
        targetField,
        required: Boolean(o.required),
        category,
        aliases,
    };
}
function parseTemplateFile(raw, fileId) {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object")
            return null;
        const systemId = String(parsed.systemId || fileId).trim();
        const systemName = String(parsed.systemName || "").trim();
        if (!systemId || !systemName)
            return null;
        const requiredFiles = Array.isArray(parsed.requiredFiles)
            ? parsed.requiredFiles.map(parseRequiredFile).filter((f) => f !== null)
            : [];
        const requiredFields = Array.isArray(parsed.requiredFields)
            ? parsed.requiredFields.map(parseRequiredField).filter((f) => f !== null)
            : [];
        const optionalFields = Array.isArray(parsed.optionalFields)
            ? parsed.optionalFields.map(parseRequiredField).filter((f) => f !== null)
            : [];
        return {
            templateId: String(parsed.templateId || `readiness-${systemId}`).trim(),
            systemId,
            systemName,
            version: String(parsed.version || "1.0.0").trim(),
            requiredFiles,
            requiredFields,
            optionalFields,
            notes: String(parsed.notes || "").trim(),
            lastReviewedAt: String(parsed.lastReviewedAt || new Date().toISOString()),
        };
    }
    catch {
        return null;
    }
}
function seedMigrationAdapterReadinessIfEmpty() {
    if (readinessSeedInProgress)
        return 0;
    ensureReadinessDir();
    const hasTemplates = fs_1.default
        .readdirSync(READINESS_DIR, { withFileTypes: true })
        .some((e) => e.isFile() && e.name.endsWith(".json"));
    if (hasTemplates)
        return 0;
    readinessSeedInProgress = true;
    try {
        let written = 0;
        for (const template of migrationAdapterReadinessSeed_1.MIGRATION_ADAPTER_READINESS_SEED) {
            saveReadinessTemplate(template);
            written += 1;
        }
        return written;
    }
    finally {
        readinessSeedInProgress = false;
    }
}
function listReadinessTemplates() {
    ensureReadinessDir();
    seedMigrationAdapterReadinessIfEmpty();
    const entries = fs_1.default.readdirSync(READINESS_DIR, { withFileTypes: true });
    const templates = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json"))
            continue;
        const fileId = entry.name.replace(/\.json$/i, "");
        try {
            const raw = fs_1.default.readFileSync(path_1.default.join(READINESS_DIR, entry.name), "utf8");
            const template = parseTemplateFile(raw, fileId);
            if (template)
                templates.push(template);
        }
        catch {
            // Skip corrupt files
        }
    }
    return templates.sort((a, b) => a.systemName.localeCompare(b.systemName));
}
function getReadinessTemplate(systemId) {
    ensureReadinessDir();
    seedMigrationAdapterReadinessIfEmpty();
    const safeId = sanitizeSystemId(systemId);
    if (!safeId)
        return null;
    const filePath = readinessFilePath(safeId);
    if (!fs_1.default.existsSync(filePath))
        return null;
    try {
        const raw = fs_1.default.readFileSync(filePath, "utf8");
        return parseTemplateFile(raw, safeId);
    }
    catch {
        return null;
    }
}
function saveReadinessTemplate(input) {
    ensureReadinessDir();
    const systemIdRaw = String(input.systemId || "").trim();
    const systemName = String(input.systemName || "").trim();
    if (!systemName)
        throw new Error("systemName is required");
    const systemId = sanitizeSystemId(systemIdRaw);
    if (!systemId)
        throw new Error("Valid systemId is required");
    const requiredFiles = Array.isArray(input.requiredFiles)
        ? input.requiredFiles.map(parseRequiredFile).filter((f) => f !== null)
        : [];
    const requiredFields = Array.isArray(input.requiredFields)
        ? input.requiredFields.map(parseRequiredField).filter((f) => f !== null)
        : [];
    const optionalFields = Array.isArray(input.optionalFields)
        ? input.optionalFields.map(parseRequiredField).filter((f) => f !== null)
        : [];
    const existing = getReadinessTemplate(systemId);
    const template = {
        templateId: String(input.templateId || `readiness-${systemId}`).trim(),
        systemId,
        systemName,
        version: String(input.version || existing?.version || "1.0.0").trim(),
        requiredFiles,
        requiredFields,
        optionalFields,
        notes: String(input.notes || "").trim(),
        lastReviewedAt: String(input.lastReviewedAt || existing?.lastReviewedAt || new Date().toISOString()),
    };
    const filePath = readinessFilePath(systemId);
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs_1.default.writeFileSync(tmpPath, JSON.stringify(template, null, 2), "utf8");
    fs_1.default.renameSync(tmpPath, filePath);
    return template;
}
function deleteReadinessTemplate(systemId) {
    ensureReadinessDir();
    const safeId = sanitizeSystemId(systemId);
    if (!safeId)
        return false;
    const filePath = readinessFilePath(safeId);
    if (!fs_1.default.existsSync(filePath))
        return false;
    fs_1.default.unlinkSync(filePath);
    return true;
}
