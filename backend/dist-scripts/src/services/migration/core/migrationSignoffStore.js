"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureMigrationSignoffsDir = ensureMigrationSignoffsDir;
exports.createSignoff = createSignoff;
exports.updateSignoff = updateSignoff;
exports.getSignoff = getSignoff;
exports.listSignoffs = listSignoffs;
exports.resolveMigrationSignoffFilePath = resolveMigrationSignoffFilePath;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const SIGNOFFS_DIR = path_1.default.join(process.cwd(), "storage", "migration-signoffs");
function ensureMigrationSignoffsDir() {
    if (!fs_1.default.existsSync(SIGNOFFS_DIR)) {
        fs_1.default.mkdirSync(SIGNOFFS_DIR, { recursive: true });
    }
}
function sanitizeSignoffId(id) {
    const trimmed = String(id || "").trim();
    if (!trimmed)
        return null;
    if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\"))
        return null;
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed))
        return null;
    return trimmed;
}
function signoffFilePath(id) {
    const safe = sanitizeSignoffId(id);
    if (!safe)
        throw new Error("Invalid signoff id");
    const resolved = path_1.default.resolve(SIGNOFFS_DIR, `${safe}.json`);
    if (!resolved.startsWith(path_1.default.resolve(SIGNOFFS_DIR) + path_1.default.sep)) {
        throw new Error("Invalid signoff path");
    }
    return resolved;
}
function writeSignoffFile(pack) {
    const filePath = signoffFilePath(pack.signoffId);
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs_1.default.writeFileSync(tmpPath, JSON.stringify(pack, null, 2), "utf8");
    fs_1.default.renameSync(tmpPath, filePath);
}
function createSignoff(partial) {
    ensureMigrationSignoffsDir();
    const signoffId = partial.signoffId?.trim() || (0, crypto_1.randomUUID)();
    const safeId = sanitizeSignoffId(signoffId);
    if (!safeId)
        throw new Error("Invalid signoff id");
    const filePath = signoffFilePath(safeId);
    if (fs_1.default.existsSync(filePath)) {
        throw new Error("Sign-off id already exists");
    }
    const pack = {
        ...partial,
        signoffId: safeId,
        createdAt: partial.createdAt ?? new Date().toISOString(),
    };
    writeSignoffFile(pack);
    return pack;
}
function updateSignoff(signoffId, patch) {
    const existing = getSignoff(signoffId);
    if (!existing)
        throw new Error("Sign-off not found");
    const merged = { ...existing, ...patch, signoffId: existing.signoffId };
    writeSignoffFile(merged);
    return merged;
}
function getSignoff(signoffId) {
    ensureMigrationSignoffsDir();
    const safeId = sanitizeSignoffId(signoffId);
    if (!safeId)
        return null;
    const filePath = signoffFilePath(safeId);
    if (!fs_1.default.existsSync(filePath))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(filePath, "utf8"));
    }
    catch {
        return null;
    }
}
function listSignoffs() {
    ensureMigrationSignoffsDir();
    const files = fs_1.default
        .readdirSync(SIGNOFFS_DIR)
        .filter((name) => name.endsWith(".json") && !name.includes(".tmp"));
    const packs = [];
    for (const file of files) {
        const id = file.replace(/\.json$/, "");
        const pack = getSignoff(id);
        if (pack)
            packs.push(pack);
    }
    packs.sort((a, b) => {
        const ta = new Date(a.createdAt).getTime();
        const tb = new Date(b.createdAt).getTime();
        return tb - ta;
    });
    return packs;
}
function resolveMigrationSignoffFilePath(filename) {
    const trimmed = String(filename || "").trim();
    if (!trimmed || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
        return null;
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed))
        return null;
    ensureMigrationSignoffsDir();
    const resolved = path_1.default.resolve(SIGNOFFS_DIR, trimmed);
    if (!resolved.startsWith(path_1.default.resolve(SIGNOFFS_DIR) + path_1.default.sep))
        return null;
    if (!fs_1.default.existsSync(resolved))
        return null;
    return resolved;
}
