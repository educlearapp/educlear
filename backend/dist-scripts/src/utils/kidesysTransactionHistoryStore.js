"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KIDESYS_DISPLAY_HISTORY_SOURCE = void 0;
exports.normaliseHistoryAmount = normaliseHistoryAmount;
exports.readSchoolKidesysHistory = readSchoolKidesysHistory;
exports.writeSchoolKidesysHistory = writeSchoolKidesysHistory;
exports.filterHistoryForAccount = filterHistoryForAccount;
exports.buildKidesysHistoryAccountIndex = buildKidesysHistoryAccountIndex;
exports.getHistorySummaryForAccount = getHistorySummaryForAccount;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const daSilvaSchoolResolve_1 = require("../services/daSilvaSchoolResolve");
exports.KIDESYS_DISPLAY_HISTORY_SOURCE = "kidesys_display_history";
const DATA_DIR = path_1.default.join(process.cwd(), "data");
const HISTORY_FILE = path_1.default.join(DATA_DIR, "kidesys-transaction-history.json");
function ensureStore() {
    if (!fs_1.default.existsSync(DATA_DIR))
        fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs_1.default.existsSync(HISTORY_FILE)) {
        fs_1.default.writeFileSync(HISTORY_FILE, JSON.stringify({}, null, 2), "utf8");
    }
}
function readAll() {
    ensureStore();
    try {
        const raw = fs_1.default.readFileSync(HISTORY_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch {
        return {};
    }
}
function writeAll(data) {
    ensureStore();
    fs_1.default.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), "utf8");
}
function normaliseHistoryAmount(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function readSchoolKidesysHistory(schoolId) {
    const key = String(schoolId || "").trim();
    if (!key)
        return [];
    const all = readAll();
    const storeKey = (0, daSilvaSchoolResolve_1.resolveSchoolJsonStoreKey)(key, all, (value) => Array.isArray(value) ? value.length > 0 : false);
    return Array.isArray(all[storeKey]) ? all[storeKey] : [];
}
function writeSchoolKidesysHistory(schoolId, entries) {
    const key = String(schoolId || "").trim();
    if (!key)
        return;
    const all = readAll();
    all[key] = entries;
    writeAll(all);
}
function filterHistoryForAccount(entries, accountNo) {
    const ref = String(accountNo || "").trim();
    if (!ref)
        return [];
    return entries.filter((e) => String(e.accountNo || "").trim() === ref);
}
/** Latest invoice/payment per account (by transaction date). */
function buildKidesysHistoryAccountIndex(entries) {
    const index = new Map();
    const entryTime = (e) => {
        const d = new Date(e.date || "");
        return Number.isNaN(d.getTime()) ? 0 : d.getTime();
    };
    for (const entry of entries) {
        const accountNo = String(entry.accountNo || "").trim();
        if (!accountNo)
            continue;
        const current = index.get(accountNo) || { lastInvoice: null, lastPayment: null };
        if (entry.type === "invoice") {
            if (!current.lastInvoice || entryTime(entry) >= entryTime(current.lastInvoice)) {
                current.lastInvoice = entry;
            }
        }
        else if (entry.type === "payment") {
            if (!current.lastPayment || entryTime(entry) >= entryTime(current.lastPayment)) {
                current.lastPayment = entry;
            }
        }
        index.set(accountNo, current);
    }
    return index;
}
function getHistorySummaryForAccount(entries, accountNo) {
    const scoped = filterHistoryForAccount(entries, accountNo);
    const index = buildKidesysHistoryAccountIndex(scoped);
    return index.get(String(accountNo || "").trim()) || { lastInvoice: null, lastPayment: null };
}
