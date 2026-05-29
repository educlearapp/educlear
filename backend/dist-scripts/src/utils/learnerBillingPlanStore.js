"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readSchoolBillingPlans = readSchoolBillingPlans;
exports.upsertLearnerBillingPlan = upsertLearnerBillingPlan;
exports.upsertSchoolBillingPlans = upsertSchoolBillingPlans;
exports.removeSchoolBillingPlans = removeSchoolBillingPlans;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const daSilvaSchoolResolve_1 = require("../services/daSilvaSchoolResolve");
const DATA_DIR = path_1.default.join(process.cwd(), "data");
const PLAN_FILE = path_1.default.join(DATA_DIR, "learner-billing-plans.json");
function ensureStore() {
    if (!fs_1.default.existsSync(DATA_DIR))
        fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs_1.default.existsSync(PLAN_FILE)) {
        fs_1.default.writeFileSync(PLAN_FILE, JSON.stringify({}, null, 2), "utf8");
    }
}
function readAll() {
    ensureStore();
    try {
        const raw = fs_1.default.readFileSync(PLAN_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch {
        return {};
    }
}
function writeAll(data) {
    ensureStore();
    fs_1.default.writeFileSync(PLAN_FILE, JSON.stringify(data, null, 2), "utf8");
}
function readSchoolBillingPlans(schoolId) {
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
function upsertLearnerBillingPlan(schoolId, learnerId, items) {
    const schoolKey = String(schoolId || "").trim();
    const learnerKey = String(learnerId || "").trim();
    if (!schoolKey || !learnerKey)
        return;
    const all = readAll();
    if (!all[schoolKey])
        all[schoolKey] = {};
    all[schoolKey][learnerKey] = items;
    writeAll(all);
}
function upsertSchoolBillingPlans(schoolId, plans) {
    const schoolKey = String(schoolId || "").trim();
    if (!schoolKey)
        return;
    const all = readAll();
    all[schoolKey] = { ...(all[schoolKey] || {}), ...plans };
    writeAll(all);
}
function removeSchoolBillingPlans(schoolId, learnerIds) {
    const schoolKey = String(schoolId || "").trim();
    if (!schoolKey || !learnerIds.length)
        return;
    const all = readAll();
    const school = all[schoolKey];
    if (!school)
        return;
    for (const id of learnerIds)
        delete school[id];
    writeAll(all);
}
