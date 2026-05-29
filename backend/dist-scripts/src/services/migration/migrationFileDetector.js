"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIGRATION_SOURCE_PRIORITY = exports.MIGRATION_DATA_GROUP_PRIORITY = void 0;
exports.detectMigrationFileKind = detectMigrationFileKind;
exports.detectSourceSystemFromFiles = detectSourceSystemFromFiles;
exports.detectMigrationDataGroup = detectMigrationDataGroup;
exports.dataGroupToFileCategory = dataGroupToFileCategory;
exports.sortFilesByImportPriority = sortFilesByImportPriority;
const path_1 = __importDefault(require("path"));
const detectMigrationCategory_1 = require("./core/detectMigrationCategory");
const kideesysDetection_1 = require("./adapters/kideesysDetection");
const sasamsDetection_1 = require("./adapters/sasamsDetection");
const kideesysNormalization_1 = require("./adapters/kideesysNormalization");
const sasamsNormalization_1 = require("./adapters/sasamsNormalization");
const genericExcelNormalization_1 = require("./adapters/genericExcelNormalization");
function compactKey(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}
function detectMigrationFileKind(filename) {
    const ext = path_1.default.extname(String(filename || "")).toLowerCase();
    if (ext === ".csv")
        return "csv";
    if (ext === ".xls")
        return "xls";
    if (ext === ".xlsx")
        return "xlsx";
    if (ext === ".zip")
        return "zip";
    return "unknown";
}
const HEADER_RULES = [
    {
        group: "parent_learner_links",
        keys: ["parentlearner", "parentchild", "guardianlearner", "linktype", "relationship"],
        minMatches: 2,
    },
    {
        group: "transaction_history",
        keys: ["transactionno", "transactionnumber", "receiptno", "paymentno", "journalno"],
    },
    {
        group: "journals",
        keys: ["journal", "debit", "credit", "journaldate"],
        minMatches: 2,
    },
    {
        group: "invoices",
        keys: ["invoiceno", "invoicenumber", "invoicedate", "duedate"],
        minMatches: 2,
    },
    {
        group: "payments",
        keys: ["receiptno", "paymentdate", "paymentmethod", "amountpaid"],
        minMatches: 2,
    },
    {
        group: "balances",
        keys: ["ageanalysis", "currentbalance", "days30", "days60", "days90", "days120"],
        minMatches: 2,
    },
    {
        group: "billing_plans",
        keys: ["billingplan", "monthlyfee", "feeamount", "planname"],
        minMatches: 2,
    },
    {
        group: "accounts",
        keys: ["accountnumber", "accountno", "accountholder", "familyaccount"],
        minMatches: 2,
    },
    {
        group: "parents",
        keys: ["parentname", "guardian", "father", "mother", "cellno", "parentemail"],
        minMatches: 2,
    },
    {
        group: "learners",
        keys: [
            "learnername",
            "firstname",
            "surname",
            "idnumber",
            "dateofbirth",
            "admissionnumber",
            "grade",
            "class",
        ],
        minMatches: 2,
    },
    {
        group: "classrooms",
        keys: ["classroom", "registerclass", "homeroom", "classlist"],
    },
    {
        group: "staff",
        keys: ["employee", "staffname", "payroll", "teacher"],
    },
];
function normalizeHeader(column, source) {
    const trimmed = String(column || "").trim();
    if (!trimmed)
        return "";
    if (source === "kideesys") {
        const k = (0, kideesysNormalization_1.normalizeKidESysColumn)(trimmed);
        if (k)
            return compactKey(k);
    }
    if (source === "sasams") {
        const s = (0, sasamsNormalization_1.normalizeSASAMSColumn)(trimmed);
        if (s)
            return compactKey(s);
    }
    const g = (0, genericExcelNormalization_1.normalizeGenericExcelColumn)(trimmed);
    if (g)
        return compactKey(g);
    return compactKey(trimmed);
}
function scoreHeaderGroup(columns, source, rule) {
    const normalized = columns.map((c) => normalizeHeader(c, source)).filter(Boolean);
    let matches = 0;
    for (const key of rule.keys) {
        if (normalized.some((col) => col === key || col.includes(key)))
            matches += 1;
    }
    const min = rule.minMatches ?? 1;
    return matches >= min ? matches : 0;
}
function detectSourceSystemFromFiles(filenames, columnsByFile) {
    const names = filenames.map((f) => String(f).trim()).filter(Boolean);
    if ((0, sasamsDetection_1.detectSASAMSExports)(names))
        return "sasams";
    if ((0, kideesysDetection_1.detectKidESysExports)(names))
        return "kideesys";
    const allColumns = [];
    if (columnsByFile) {
        for (const cols of columnsByFile.values())
            allColumns.push(...cols);
    }
    const compactCols = allColumns.map((c) => compactKey(c));
    if (compactCols.some((c) => c.includes("sasams") || c.includes("emis")))
        return "sasams";
    if (compactCols.some((c) => c.includes("kideesys") ||
        c.includes("accountlist") ||
        c.includes("billingplan"))) {
        return "kideesys";
    }
    const hasCsvOnly = names.every((n) => /\.csv$/i.test(n));
    if (hasCsvOnly && names.length > 0)
        return "generic-csv";
    if (names.some((n) => /\.xlsx?$/i.test(n)))
        return "generic-excel";
    return "unknown";
}
function detectMigrationDataGroup(input) {
    const filename = String(input.filename || "");
    const haystack = compactKey(filename);
    const basename = path_1.default.basename(filename, path_1.default.extname(filename));
    const source = input.sourceSystem;
    const columns = input.columns ?? [];
    if ((0, detectMigrationCategory_1.isLearnerClassExportFilename)(haystack, basename) && columns.length > 0) {
        return "classrooms";
    }
    let best = { group: "unknown", score: 0 };
    for (const rule of HEADER_RULES) {
        const score = scoreHeaderGroup(columns, source, rule);
        if (score > best.score)
            best = { group: rule.group, score };
    }
    if (best.score > 0)
        return best.group;
    const filenameCategory = (0, detectMigrationCategory_1.detectMigrationCategory)(filename);
    switch (filenameCategory) {
        case "learners":
            return haystack.includes("class") && !haystack.includes("register") ? "classrooms" : "learners";
        case "parents":
            return haystack.includes("link") ? "parent_learner_links" : "parents";
        case "billing":
            return haystack.includes("age") || haystack.includes("balance") ? "balances" : "accounts";
        case "transactions":
            return haystack.includes("invoice")
                ? "invoices"
                : haystack.includes("payment") || haystack.includes("receipt")
                    ? "payments"
                    : "transaction_history";
        case "staff":
            return "staff";
        default:
            return "unknown";
    }
}
function dataGroupToFileCategory(group) {
    switch (group) {
        case "classrooms":
        case "learners":
            return "learners";
        case "parents":
        case "parent_learner_links":
            return "parents";
        case "accounts":
        case "billing_plans":
        case "balances":
            return "billing";
        case "invoices":
        case "payments":
        case "journals":
        case "transaction_history":
            return "transactions";
        case "staff":
            return "staff";
        default:
            return "unknown";
    }
}
/** Import order: demographics before billing; never derive billing from class lists. */
exports.MIGRATION_DATA_GROUP_PRIORITY = {
    classrooms: 10,
    learners: 20,
    parents: 30,
    parent_learner_links: 40,
    accounts: 50,
    billing_plans: 60,
    balances: 70,
    invoices: 80,
    payments: 90,
    journals: 95,
    transaction_history: 100,
    staff: 5,
    unknown: 999,
};
exports.MIGRATION_SOURCE_PRIORITY = {
    sasams: 100,
    kideesys: 80,
    "generic-excel": 50,
    "generic-csv": 40,
    unknown: 0,
};
function sortFilesByImportPriority(files) {
    return [...files].sort((a, b) => {
        const g = exports.MIGRATION_DATA_GROUP_PRIORITY[a.dataGroup] -
            exports.MIGRATION_DATA_GROUP_PRIORITY[b.dataGroup];
        if (g !== 0)
            return g;
        return (exports.MIGRATION_SOURCE_PRIORITY[b.sourceSystem] -
            exports.MIGRATION_SOURCE_PRIORITY[a.sourceSystem]);
    });
}
