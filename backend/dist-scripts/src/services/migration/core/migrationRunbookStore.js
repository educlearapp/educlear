"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureMigrationRunbooksDir = ensureMigrationRunbooksDir;
exports.createRunbook = createRunbook;
exports.getRunbook = getRunbook;
exports.listRunbooks = listRunbooks;
exports.updateRunbook = updateRunbook;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const buildDaSilvaRunbook_1 = require("./buildDaSilvaRunbook");
const RUNBOOKS_DIR = path_1.default.join(process.cwd(), "storage", "migration-runbooks");
function ensureMigrationRunbooksDir() {
    if (!fs_1.default.existsSync(RUNBOOKS_DIR)) {
        fs_1.default.mkdirSync(RUNBOOKS_DIR, { recursive: true });
    }
}
function sanitizeRunbookId(id) {
    const trimmed = String(id || "").trim();
    if (!trimmed)
        return null;
    if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\"))
        return null;
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed))
        return null;
    return trimmed;
}
function runbookFilePath(id) {
    const safe = sanitizeRunbookId(id);
    if (!safe)
        throw new Error("Invalid runbook id");
    const resolved = path_1.default.resolve(RUNBOOKS_DIR, `${safe}.json`);
    if (!resolved.startsWith(path_1.default.resolve(RUNBOOKS_DIR) + path_1.default.sep)) {
        throw new Error("Invalid runbook path");
    }
    return resolved;
}
function writeRunbookFile(runbook) {
    const filePath = runbookFilePath(runbook.runbookId);
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs_1.default.writeFileSync(tmpPath, JSON.stringify(runbook, null, 2), "utf8");
    fs_1.default.renameSync(tmpPath, filePath);
}
function createRunbook(input) {
    ensureMigrationRunbooksDir();
    const runbookId = input.runbookId?.trim() || (0, crypto_1.randomUUID)();
    const safeId = sanitizeRunbookId(runbookId);
    if (!safeId)
        throw new Error("Invalid runbook id");
    const filePath = runbookFilePath(safeId);
    if (fs_1.default.existsSync(filePath)) {
        throw new Error("Runbook id already exists");
    }
    const runbook = (0, buildDaSilvaRunbook_1.buildDaSilvaRunbook)({
        runbookId: safeId,
        schoolId: String(input.schoolId || "").trim(),
        schoolName: String(input.schoolName || "").trim(),
        sourceSystem: String(input.sourceSystem || "kideesys").trim() || "kideesys",
        pilotId: String(input.pilotId || "").trim(),
        notes: String(input.notes || "").trim(),
        createdAt: input.createdAt ?? new Date().toISOString(),
    });
    writeRunbookFile(runbook);
    return runbook;
}
function getRunbook(runbookId) {
    ensureMigrationRunbooksDir();
    const safeId = sanitizeRunbookId(runbookId);
    if (!safeId)
        return null;
    const filePath = runbookFilePath(safeId);
    if (!fs_1.default.existsSync(filePath))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(filePath, "utf8"));
    }
    catch {
        return null;
    }
}
function listRunbooks() {
    ensureMigrationRunbooksDir();
    const files = fs_1.default
        .readdirSync(RUNBOOKS_DIR)
        .filter((name) => name.endsWith(".json") && !name.includes(".tmp"));
    const runbooks = [];
    for (const file of files) {
        const id = file.replace(/\.json$/, "");
        const runbook = getRunbook(id);
        if (runbook)
            runbooks.push(runbook);
    }
    runbooks.sort((a, b) => {
        const ta = new Date(a.createdAt).getTime();
        const tb = new Date(b.createdAt).getTime();
        return tb - ta;
    });
    return runbooks;
}
function updateRunbook(runbookId, patch) {
    const existing = getRunbook(runbookId);
    if (!existing)
        throw new Error("Runbook not found");
    let steps = [...existing.steps];
    if (Array.isArray(patch.steps)) {
        for (const stepPatch of patch.steps) {
            const stepId = String(stepPatch.stepId || "").trim();
            if (!stepId)
                continue;
            const index = steps.findIndex((s) => s.stepId === stepId);
            if (index < 0)
                continue;
            const current = steps[index];
            steps[index] = {
                ...current,
                ...(stepPatch.status !== undefined ? { status: stepPatch.status } : {}),
                ...(stepPatch.notes !== undefined ? { notes: String(stepPatch.notes) } : {}),
            };
        }
    }
    const overallStatus = (0, buildDaSilvaRunbook_1.computeRunbookOverallStatus)(steps);
    const merged = {
        ...existing,
        steps,
        overallStatus,
        ...(patch.notes !== undefined ? { notes: String(patch.notes) } : {}),
        ...(patch.pilotId !== undefined
            ? { pilotId: patch.pilotId == null ? "" : String(patch.pilotId).trim() }
            : {}),
    };
    writeRunbookFile(merged);
    return merged;
}
