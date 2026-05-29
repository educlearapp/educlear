"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DA_SILVA_BILLING_MATCH_MIN_MATCHED = exports.DA_SILVA_BILLING_MATCH_MIN_RATIO = exports.DA_SILVA_BILLING_MATCH_MAX_UNMATCHED = exports.DA_SILVA_BILLING_ACCOUNT_TARGET = exports.DA_SILVA_MIGRATION_STRATEGY = void 0;
exports.resolveDaSilvaSasamsPaths = resolveDaSilvaSasamsPaths;
exports.discoverBillingSecondPassPaths = discoverBillingSecondPassPaths;
exports.resolveDaSilvaKideesysBillingPaths = resolveDaSilvaKideesysBillingPaths;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * Da Silva Academy migration — SA-SAMS base + Kid-e-Sys billing only.
 *
 * Source of truth:
 * - SA-SAMS class lists → classrooms + class placement
 * - SA-SAMS learner register → learner master profile
 * - SA-SAMS parent/guardian → parents + parent-learner links (not archived-only)
 * - Kid-e-Sys → billing account numbers, family accounts, plans, balances, history
 *
 * Canonical Kid-e-Sys official CSV/ZIP export (child.csv, accounts.csv, …) is imported via
 * {@link importDaSilvaKidESysCsv} in daSilvaKidESysCsvImporter.ts — does not replace this path.
 */
exports.DA_SILVA_MIGRATION_STRATEGY = "sasams-kideesys";
var daSilvaConstants_1 = require("./daSilvaConstants");
Object.defineProperty(exports, "DA_SILVA_BILLING_ACCOUNT_TARGET", { enumerable: true, get: function () { return daSilvaConstants_1.DA_SILVA_BILLING_ACCOUNT_TARGET; } });
Object.defineProperty(exports, "DA_SILVA_BILLING_MATCH_MAX_UNMATCHED", { enumerable: true, get: function () { return daSilvaConstants_1.DA_SILVA_BILLING_MATCH_MAX_UNMATCHED; } });
Object.defineProperty(exports, "DA_SILVA_BILLING_MATCH_MIN_RATIO", { enumerable: true, get: function () { return daSilvaConstants_1.DA_SILVA_BILLING_MATCH_MIN_RATIO; } });
Object.defineProperty(exports, "DA_SILVA_BILLING_MATCH_MIN_MATCHED", { enumerable: true, get: function () { return daSilvaConstants_1.DA_SILVA_MIN_BILLING_MATCH_COUNT; } });
function resolveDaSilvaSasamsPaths(root) {
    const base = root.trim();
    const sasamsDir = pathExists(pathJoin(base, "sasams"))
        ? pathJoin(base, "sasams")
        : base;
    const classListDir = firstExistingDir([
        pathJoin(sasamsDir, "class_lists"),
        pathJoin(sasamsDir, "class_list"),
        pathJoin(base, "sasams_class_lists"),
        pathJoin(base, "05_class_list"),
    ]);
    const learnerRegister = firstExistingFile([
        pathJoin(sasamsDir, "learner_register.xls"),
        pathJoin(sasamsDir, "learner_register.xlsx"),
        pathJoin(sasamsDir, "learners.xls"),
        pathJoin(base, "sasams_learner_register.xls"),
    ]);
    const parentRegister = firstExistingFile([
        pathJoin(sasamsDir, "parent_register.xls"),
        pathJoin(sasamsDir, "parent_contact.xls"),
        pathJoin(sasamsDir, "parents.xls"),
        pathJoin(base, "sasams_parent_register.xls"),
    ]);
    return { classListDir, learnerRegister, parentRegister };
}
/** Optional Kid-e-Sys files used for second-pass billing reconciliation (not SA-SAMS). */
function discoverBillingSecondPassPaths(ageAnalysisPath) {
    const ageDir = path_1.default.dirname(ageAnalysisPath);
    const kideesysDir = path_1.default.basename(ageDir).toLowerCase().includes("age")
        ? path_1.default.dirname(ageDir)
        : ageDir;
    const root = path_1.default.dirname(kideesysDir);
    const billingPlan = firstExistingFileOptional([
        path_1.default.join(kideesysDir, "billing_plan_summary.xls"),
        path_1.default.join(kideesysDir, "billing_plan_summary_by_child.xls"),
        path_1.default.join(root, "03_billing_plan_summary_by_child", "billing_plan_summary_by_child.xls"),
        path_1.default.join(root, "03_billing_plan", "billing_plan.xls"),
    ]);
    const transactions = firstExistingFileOptional([
        path_1.default.join(kideesysDir, "transaction_list.xls"),
        path_1.default.join(root, "01_transaction_list", "transaction_list.xls"),
        path_1.default.join(root, "01_transactions.xls"),
    ]);
    const contactList = firstExistingFileOptional([
        path_1.default.join(kideesysDir, "contact_list.xls"),
        path_1.default.join(root, "04_contact_list", "contact_list.xls"),
        path_1.default.join(root, "04_contact_list.xls"),
    ]);
    return {
        ...(billingPlan ? { billingPlan } : {}),
        ...(transactions ? { transactions } : {}),
        ...(contactList ? { contactList } : {}),
    };
}
function resolveDaSilvaKideesysBillingPaths(root) {
    const base = root.trim();
    return {
        billingPlan: firstExistingFile([
            pathJoin(base, "03_billing_plan_summary_by_child", "billing_plan_summary_by_child.xls"),
            pathJoin(base, "03_billing_plan", "billing_plan.xls"),
        ]),
        ageAnalysis: firstExistingFile([
            pathJoin(base, "02_account_list_age_analysis", "account_list_(age_analysis).xls"),
            pathJoin(base, "02_age_analysis.xls"),
        ]),
        transactions: firstExistingFile([
            pathJoin(base, "01_transaction_list", "transaction_list.xls"),
            pathJoin(base, "01_transactions.xls"),
        ]),
    };
}
function pathJoin(...parts) {
    return path_1.default.join(...parts);
}
function pathExists(p) {
    return fs_1.default.existsSync(p);
}
function firstExistingDir(candidates) {
    for (const c of candidates) {
        if (pathExists(c))
            return c;
    }
    return candidates[0];
}
function firstExistingFile(candidates) {
    const found = firstExistingFileOptional(candidates);
    return found ?? candidates[0];
}
function firstExistingFileOptional(candidates) {
    for (const c of candidates) {
        if (pathExists(c))
            return c;
    }
    return undefined;
}
