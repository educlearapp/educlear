"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readSchoolFamilyAccountAgeAnalysisSnapshots = readSchoolFamilyAccountAgeAnalysisSnapshots;
exports.upsertSchoolFamilyAccountAgeAnalysisSnapshots = upsertSchoolFamilyAccountAgeAnalysisSnapshots;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const daSilvaSchoolResolve_1 = require("../services/daSilvaSchoolResolve");
const DATA_DIR = path_1.default.join(process.cwd(), "data");
const STORE_FILE = path_1.default.join(DATA_DIR, "family-account-age-analysis.json");
function ensureStore() {
    if (!fs_1.default.existsSync(DATA_DIR))
        fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs_1.default.existsSync(STORE_FILE))
        fs_1.default.writeFileSync(STORE_FILE, JSON.stringify({}, null, 2), "utf8");
}
function readAll() {
    ensureStore();
    try {
        const raw = fs_1.default.readFileSync(STORE_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch {
        return {};
    }
}
function writeAll(data) {
    ensureStore();
    fs_1.default.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), "utf8");
}
function readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId) {
    const key = String(schoolId || "").trim();
    if (!key)
        return {};
    const all = readAll();
    const storeKey = (0, daSilvaSchoolResolve_1.resolveSchoolJsonStoreKey)(key, all, (value) => {
        if (!value || typeof value !== "object")
            return false;
        return Object.keys(value).length > 0;
    });
    return all[storeKey] || {};
}
function upsertSchoolFamilyAccountAgeAnalysisSnapshots(schoolId, snapshots) {
    const key = String(schoolId || "").trim();
    if (!key)
        return;
    const all = readAll();
    all[key] = { ...(all[key] || {}), ...snapshots };
    writeAll(all);
}
