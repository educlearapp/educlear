"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isLearnerClassExportFilename = isLearnerClassExportFilename;
exports.detectMigrationCategory = detectMigrationCategory;
const CATEGORY_KEYWORDS = [
    {
        category: "historical",
        keywords: ["archive", "historical", "inactive"],
    },
    {
        category: "transactions",
        keywords: ["transaction", "payment", "receipt", "invoice"],
    },
    {
        category: "billing",
        keywords: ["billing", "fee", "age_analysis", "age-analysis", "billing_plan"],
    },
    {
        category: "learners",
        keywords: ["learner", "student", "classlist", "class_list", "class-list", "child"],
    },
    {
        category: "parents",
        keywords: ["parent", "guardian", "contact"],
    },
    {
        category: "staff",
        keywords: ["staff", "employee", "teacher", "payroll"],
    },
];
/**
 * Heuristic category detection from filename only (no file parsing).
 */
function compactAlphanumeric(value) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function fileBasename(filename) {
    const leaf = String(filename || "")
        .trim()
        .split(/[/\\]/)
        .pop();
    return String(leaf || "").replace(/\.[^.]+$/i, "");
}
function haystackIncludesKeyword(haystack, keyword) {
    return haystack.includes(compactAlphanumeric(keyword));
}
/** Staff / employee exports must win before parent "contact" heuristics (e.g. employee_contact_list.xls). */
function isStaffFilename(haystack, basename) {
    const base = basename.toLowerCase();
    if (haystackIncludesKeyword(haystack, "employee") || base.includes("employee"))
        return true;
    if (haystackIncludesKeyword(haystack, "staff") || base.includes("staff"))
        return true;
    if (haystackIncludesKeyword(haystack, "teacher") || base.includes("teacher"))
        return true;
    if (haystackIncludesKeyword(haystack, "payroll") || base.includes("payroll"))
        return true;
    return false;
}
/**
 * Kid-e-Sys per-grade / per-class learner register exports (Grade_1A.xls, creche.xls, etc.).
 */
function isLearnerClassExportFilename(haystack, basename) {
    const base = basename.trim();
    const lower = base.toLowerCase();
    const compactBase = compactAlphanumeric(base);
    if (/^grade[_\s-]/i.test(base) || /^grade\s+\d/i.test(base))
        return true;
    if (/^grade[_\s-]?r[a-z]?$/i.test(base))
        return true;
    if (/^grade[_\s-]?\d+[a-z]?$/i.test(base))
        return true;
    if (/^grade\d+[a-z]?$/i.test(compactBase))
        return true;
    if (/^gr[_\s-]/i.test(base) || /^gr\s+\d/i.test(base))
        return true;
    if (/^gr\d+[a-z]?$/i.test(compactBase))
        return true;
    if (/^class[_\s-]/i.test(base) && !/class[\s_-]*list/i.test(base))
        return true;
    if (/^class\s+\d/i.test(base))
        return true;
    if (/^(creche|preschool|pre[_\s-]?school|reception|rrr|rr)$/i.test(lower))
        return true;
    if (/^(creche|preschool|reception|rrr|rr)$/.test(haystack))
        return true;
    if (haystack.includes("creche") || haystack.includes("preschool")) {
        return true;
    }
    if (haystack.includes("reception"))
        return true;
    if (/^grade(r\d+[a-z]?|\d+[a-z]?)$/.test(haystack))
        return true;
    if (/^gr(r?\d+[a-z]?)$/.test(haystack))
        return true;
    return false;
}
function detectMigrationCategory(filename) {
    const haystack = compactAlphanumeric(filename);
    if (!haystack)
        return "unknown";
    const basename = fileBasename(filename);
    for (const { category, keywords } of CATEGORY_KEYWORDS) {
        if (category === "learners" || category === "parents" || category === "staff")
            continue;
        if (keywords.some((kw) => haystackIncludesKeyword(haystack, kw))) {
            return category;
        }
    }
    if (isStaffFilename(haystack, basename)) {
        return "staff";
    }
    if (isLearnerClassExportFilename(haystack, basename)) {
        return "learners";
    }
    for (const { category, keywords } of CATEGORY_KEYWORDS) {
        if (category !== "learners")
            continue;
        if (keywords.some((kw) => haystackIncludesKeyword(haystack, kw))) {
            return category;
        }
    }
    for (const { category, keywords } of CATEGORY_KEYWORDS) {
        if (category !== "parents")
            continue;
        if (keywords.some((kw) => haystackIncludesKeyword(haystack, kw))) {
            return category;
        }
    }
    return "unknown";
}
