"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listTemplates = listTemplates;
exports.getTemplate = getTemplate;
exports.saveTemplate = saveTemplate;
exports.deleteTemplate = deleteTemplate;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const TEMPLATES_DIR = path_1.default.join(process.cwd(), "storage", "migration-templates");
function ensureTemplatesDir() {
    if (!fs_1.default.existsSync(TEMPLATES_DIR)) {
        fs_1.default.mkdirSync(TEMPLATES_DIR, { recursive: true });
    }
}
/** Safe filename segment — rejects path traversal and invalid ids. */
function sanitizeTemplateId(id) {
    const trimmed = String(id || "").trim();
    if (!trimmed)
        return null;
    if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\"))
        return null;
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed))
        return null;
    return trimmed;
}
function templateFilePath(id) {
    const safe = sanitizeTemplateId(id);
    if (!safe)
        throw new Error("Invalid template id");
    const resolved = path_1.default.resolve(TEMPLATES_DIR, `${safe}.json`);
    if (!resolved.startsWith(path_1.default.resolve(TEMPLATES_DIR) + path_1.default.sep)) {
        throw new Error("Invalid template path");
    }
    return resolved;
}
function parseTemplateFile(raw, fileId) {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object")
            return null;
        const id = String(parsed.id || fileId).trim();
        const name = String(parsed.name || "").trim();
        const sourceSystem = String(parsed.sourceSystem || "").trim();
        if (!id || !name || !sourceSystem)
            return null;
        const mappings = Array.isArray(parsed.mappings)
            ? parsed.mappings
                .map((m) => ({
                sourceColumn: String(m.sourceColumn || "").trim(),
                targetField: String(m.targetField || "").trim(),
            }))
                .filter((m) => m.sourceColumn && m.targetField)
            : [];
        return {
            id,
            name,
            sourceSystem,
            description: String(parsed.description || "").trim(),
            mappings,
            createdAt: String(parsed.createdAt || new Date().toISOString()),
            updatedAt: String(parsed.updatedAt || new Date().toISOString()),
        };
    }
    catch {
        return null;
    }
}
function listTemplates() {
    ensureTemplatesDir();
    const entries = fs_1.default.readdirSync(TEMPLATES_DIR, { withFileTypes: true });
    const templates = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json"))
            continue;
        const fileId = entry.name.replace(/\.json$/i, "");
        try {
            const raw = fs_1.default.readFileSync(path_1.default.join(TEMPLATES_DIR, entry.name), "utf8");
            const template = parseTemplateFile(raw, fileId);
            if (template)
                templates.push(template);
        }
        catch {
            // Skip corrupt files — do not crash list
        }
    }
    return templates.sort((a, b) => a.name.localeCompare(b.name));
}
function getTemplate(id) {
    ensureTemplatesDir();
    const safeId = sanitizeTemplateId(id);
    if (!safeId)
        return null;
    const filePath = templateFilePath(safeId);
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
function saveTemplate(input) {
    ensureTemplatesDir();
    const name = String(input.name || "").trim();
    const sourceSystem = String(input.sourceSystem || "").trim();
    if (!name)
        throw new Error("Template name is required");
    if (!sourceSystem)
        throw new Error("Source system is required");
    const requestedId = String(input.id || "").trim();
    const id = requestedId ? sanitizeTemplateId(requestedId) : null;
    const templateId = id ?? (0, crypto_1.randomUUID)();
    const mappings = Array.isArray(input.mappings)
        ? input.mappings
            .map((m) => ({
            sourceColumn: String(m.sourceColumn || "").trim(),
            targetField: String(m.targetField || "").trim(),
        }))
            .filter((m) => m.sourceColumn && m.targetField)
        : [];
    const existing = requestedId && id ? getTemplate(id) : null;
    const now = new Date().toISOString();
    const template = {
        id: templateId,
        name,
        sourceSystem,
        description: String(input.description || "").trim(),
        mappings,
        createdAt: existing?.createdAt ?? input.createdAt ?? now,
        updatedAt: now,
    };
    const filePath = templateFilePath(templateId);
    if (!existing && fs_1.default.existsSync(filePath)) {
        throw new Error("Template id already exists");
    }
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs_1.default.writeFileSync(tmpPath, JSON.stringify(template, null, 2), "utf8");
    fs_1.default.renameSync(tmpPath, filePath);
    return template;
}
function deleteTemplate(id) {
    ensureTemplatesDir();
    const safeId = sanitizeTemplateId(id);
    if (!safeId)
        return false;
    const filePath = templateFilePath(safeId);
    if (!fs_1.default.existsSync(filePath))
        return false;
    fs_1.default.unlinkSync(filePath);
    return true;
}
