"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureMigrationPilotsDir = ensureMigrationPilotsDir;
exports.createPilot = createPilot;
exports.updatePilot = updatePilot;
exports.getPilot = getPilot;
exports.listPilots = listPilots;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const PILOTS_DIR = path_1.default.join(process.cwd(), "storage", "migration-pilots");
function ensureMigrationPilotsDir() {
    if (!fs_1.default.existsSync(PILOTS_DIR)) {
        fs_1.default.mkdirSync(PILOTS_DIR, { recursive: true });
    }
}
function sanitizePilotId(id) {
    const trimmed = String(id || "").trim();
    if (!trimmed)
        return null;
    if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\"))
        return null;
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed))
        return null;
    return trimmed;
}
function pilotFilePath(id) {
    const safe = sanitizePilotId(id);
    if (!safe)
        throw new Error("Invalid pilot id");
    const resolved = path_1.default.resolve(PILOTS_DIR, `${safe}.json`);
    if (!resolved.startsWith(path_1.default.resolve(PILOTS_DIR) + path_1.default.sep)) {
        throw new Error("Invalid pilot path");
    }
    return resolved;
}
function writePilotFile(pilot) {
    const filePath = pilotFilePath(pilot.pilotId);
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    fs_1.default.writeFileSync(tmpPath, JSON.stringify(pilot, null, 2), "utf8");
    fs_1.default.renameSync(tmpPath, filePath);
}
function createPilot(partial) {
    ensureMigrationPilotsDir();
    const pilotId = partial.pilotId?.trim() || (0, crypto_1.randomUUID)();
    const safeId = sanitizePilotId(pilotId);
    if (!safeId)
        throw new Error("Invalid pilot id");
    const filePath = pilotFilePath(safeId);
    if (fs_1.default.existsSync(filePath)) {
        throw new Error("Pilot id already exists");
    }
    const pilot = {
        ...partial,
        pilotId: safeId,
        createdAt: partial.createdAt ?? new Date().toISOString(),
    };
    writePilotFile(pilot);
    return pilot;
}
function updatePilot(pilotId, patch) {
    const existing = getPilot(pilotId);
    if (!existing)
        throw new Error("Pilot not found");
    const merged = { ...existing, ...patch, pilotId: existing.pilotId };
    writePilotFile(merged);
    return merged;
}
function getPilot(pilotId) {
    ensureMigrationPilotsDir();
    const safeId = sanitizePilotId(pilotId);
    if (!safeId)
        return null;
    const filePath = pilotFilePath(safeId);
    if (!fs_1.default.existsSync(filePath))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(filePath, "utf8"));
    }
    catch {
        return null;
    }
}
function listPilots() {
    ensureMigrationPilotsDir();
    const files = fs_1.default
        .readdirSync(PILOTS_DIR)
        .filter((name) => name.endsWith(".json") && !name.includes(".tmp"));
    const pilots = [];
    for (const file of files) {
        const id = file.replace(/\.json$/, "");
        const pilot = getPilot(id);
        if (pilot)
            pilots.push(pilot);
    }
    pilots.sort((a, b) => {
        const ta = new Date(a.createdAt).getTime();
        const tb = new Date(b.createdAt).getTime();
        return tb - ta;
    });
    return pilots;
}
