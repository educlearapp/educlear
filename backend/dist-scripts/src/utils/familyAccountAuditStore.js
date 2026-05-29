"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendFamilyAccountAudit = appendFamilyAccountAudit;
exports.listFamilyAccountAudit = listFamilyAccountAudit;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DATA_DIR = path_1.default.join(process.cwd(), "data");
const AUDIT_FILE = path_1.default.join(DATA_DIR, "family-account-audit.json");
function ensureStore() {
    if (!fs_1.default.existsSync(DATA_DIR))
        fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs_1.default.existsSync(AUDIT_FILE))
        fs_1.default.writeFileSync(AUDIT_FILE, JSON.stringify({}, null, 2), "utf8");
}
function readAll() {
    ensureStore();
    try {
        const raw = fs_1.default.readFileSync(AUDIT_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch {
        return {};
    }
}
function writeAll(data) {
    ensureStore();
    fs_1.default.writeFileSync(AUDIT_FILE, JSON.stringify(data, null, 2), "utf8");
}
function appendFamilyAccountAudit(entry) {
    const schoolId = String(entry.schoolId || "").trim();
    if (!schoolId)
        return null;
    const row = {
        ...entry,
        id: `faa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        createdAt: new Date().toISOString(),
    };
    const all = readAll();
    const list = Array.isArray(all[schoolId]) ? all[schoolId] : [];
    list.unshift(row);
    all[schoolId] = list.slice(0, 500);
    writeAll(all);
    return row;
}
function listFamilyAccountAudit(schoolId, limit = 50) {
    const key = String(schoolId || "").trim();
    if (!key)
        return [];
    const all = readAll();
    const list = Array.isArray(all[key]) ? all[key] : [];
    return list.slice(0, Math.max(1, Math.min(limit, 200)));
}
