"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.grantSmsCreditsToSchool = grantSmsCreditsToSchool;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DATA_FILE = path_1.default.join(process.cwd(), "data", "communication-store.json");
function defaultSchoolStore() {
    return {
        settings: {},
        emailBalance: 5000,
        smsCredits: 1200,
        winSmsCredits: 800,
        emails: [],
        sms: [],
    };
}
function ensureStore() {
    const dir = path_1.default.dirname(DATA_FILE);
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
    if (!fs_1.default.existsSync(DATA_FILE)) {
        const initial = { schools: {} };
        fs_1.default.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), "utf8");
        return initial;
    }
    try {
        const parsed = JSON.parse(fs_1.default.readFileSync(DATA_FILE, "utf8"));
        return parsed && typeof parsed === "object" && parsed.schools ? parsed : { schools: {} };
    }
    catch {
        return { schools: {} };
    }
}
function writeStore(store) {
    const dir = path_1.default.dirname(DATA_FILE);
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
    fs_1.default.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}
function grantSmsCreditsToSchool(schoolId, credits) {
    if (!Number.isFinite(credits) || credits <= 0) {
        throw new Error("Credits to grant must be a positive number");
    }
    const store = ensureStore();
    if (!store.schools[schoolId]) {
        store.schools[schoolId] = defaultSchoolStore();
    }
    const schoolStore = store.schools[schoolId];
    schoolStore.smsCredits += credits;
    writeStore(store);
    return {
        smsCredits: schoolStore.smsCredits,
        winSmsCredits: schoolStore.winSmsCredits,
    };
}
