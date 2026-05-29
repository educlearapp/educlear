"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateKidESysDetection = evaluateKidESysDetection;
exports.detectKidESysExports = detectKidESysExports;
const kideesysMetadata_1 = require("./kideesysMetadata");
const kideesysNormalization_1 = require("./kideesysNormalization");
function compactKey(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}
function scoreFilenameSignals(files) {
    let score = 0;
    let hasStrongBrand = false;
    for (const file of files) {
        const h = compactKey(file);
        if (!h)
            continue;
        if (h.includes("kideesys") || (h.includes("kid") && h.includes("sys"))) {
            score += 4;
            hasStrongBrand = true;
        }
        else if (/\bkid\b/.test(file.toLowerCase()) || h.startsWith("kid") || h.includes("kid_")) {
            score += 1;
        }
        if (h.includes("accountlist") || (h.includes("account") && h.includes("list")))
            score += 2;
        if (h.includes("transactionlist") || (h.includes("transaction") && h.includes("list")))
            score += 2;
        if (h.includes("contactlist") || (h.includes("contact") && h.includes("list")))
            score += 2;
        if (h.includes("billingplan") || (h.includes("billing") && h.includes("plan")))
            score += 2;
        if (h.includes("ageanalysis") || h.includes("ageanalysis"))
            score += 2;
    }
    return { score, hasStrongBrand };
}
function columnMatchesAny(column, keys) {
    const compact = compactKey(column);
    if (!compact)
        return false;
    if (keys.some((k) => compact === k || compact.includes(k)))
        return true;
    const normalized = (0, kideesysNormalization_1.normalizeKidESysColumn)(column);
    return normalized !== null && keys.includes(normalized);
}
function countHeaderGroups(columns) {
    const learnerKeys = ["childname", "learner", "grade", "class", "fullName", "classroom"];
    const parentKeys = ["contactname", "guardian", "mobile", "email", "parentName", "parentPhone", "parentEmail"];
    const billingKeys = ["account", "balance", "outstanding", "accountNumber", "currentBalance"];
    const transactionKeys = [
        "receipt",
        "invoice",
        "transactiondate",
        "amount",
        "reference",
        "transactionDate",
        "debit",
        "credit",
    ];
    let groups = 0;
    if (columns.some((c) => columnMatchesAny(c, learnerKeys)))
        groups += 1;
    if (columns.some((c) => columnMatchesAny(c, parentKeys)))
        groups += 1;
    if (columns.some((c) => columnMatchesAny(c, billingKeys)))
        groups += 1;
    if (columns.some((c) => columnMatchesAny(c, transactionKeys)))
        groups += 1;
    return groups;
}
function evaluateKidESysDetection(input) {
    const filenames = (input.filenames || []).map((f) => String(f).trim()).filter(Boolean);
    const columns = (input.columns || []).map((c) => String(c).trim()).filter(Boolean);
    const { score: filenameScore, hasStrongBrand } = scoreFilenameSignals(filenames);
    const headerGroupsMatched = columns.length > 0 ? countHeaderGroups(columns) : 0;
    const rules = kideesysMetadata_1.KIDEESYS_CONFIDENCE_RULES;
    const filenamePass = filenameScore >= rules.minFilenameScore && (hasStrongBrand || filenameScore >= rules.minFilenameScore + 2);
    const headerAssistedPass = headerGroupsMatched >= rules.minHeaderGroups && filenameScore >= 2;
    const detected = filenamePass || headerAssistedPass;
    let reason;
    if (detected) {
        reason = headerAssistedPass
            ? `Kid-e-Sys signals: filename score ${filenameScore}, ${headerGroupsMatched} header group(s).`
            : `Kid-e-Sys export bundle filenames (score ${filenameScore}).`;
    }
    else if (filenameScore > 0 || headerGroupsMatched > 0) {
        reason = `Insufficient confidence (filename score ${filenameScore}, header groups ${headerGroupsMatched}).`;
    }
    else {
        reason = "No Kid-e-Sys filename or header signals detected.";
    }
    return { detected, filenameScore, headerGroupsMatched, reason };
}
/** Conservative detect — returns false when uncertain. */
function detectKidESysExports(filenames, columns) {
    return evaluateKidESysDetection({ filenames, columns }).detected;
}
