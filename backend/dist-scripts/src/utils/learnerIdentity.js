"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveLearnerAccountNo = resolveLearnerAccountNo;
exports.cleanString = cleanString;
exports.getSurnamePrefix = getSurnamePrefix;
exports.normaliseDateForInput = normaliseDateForInput;
exports.calculateLearnerAge = calculateLearnerAge;
function resolveLearnerAccountNo(learner) {
    if (!learner)
        return "";
    const admission = String(learner.admissionNo || "").trim();
    const admissionBase = admission && admission.includes("-") ? admission.slice(0, admission.indexOf("-")) : admission;
    return (String(learner.familyAccount?.accountRef || "").trim() ||
        admissionBase ||
        admission ||
        String(learner.accountNo || learner.accountNumber || "").trim() ||
        "");
}
function cleanString(value) {
    return typeof value === "string" ? value.trim() : "";
}
function getSurnamePrefix(surname) {
    const parts = cleanString(surname).toUpperCase().split(/\s+/).filter(Boolean);
    const lastWord = parts[parts.length - 1] || "ACC";
    return lastWord.replace(/[^A-Z]/g, "").slice(0, 3).padEnd(3, "X");
}
function normaliseDateForInput(value) {
    if (value === null || value === undefined)
        return "";
    const raw = String(value).trim();
    if (!raw)
        return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw))
        return raw;
    const slashMatch = raw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (slashMatch) {
        const [, y, m, d] = slashMatch;
        return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    const d = new Date(raw.includes("/") ? raw.replace(/\//g, "-") : raw);
    if (Number.isNaN(d.getTime()))
        return "";
    return d.toISOString().slice(0, 10);
}
function calculateLearnerAge(value) {
    const birthDate = normaliseDateForInput(value);
    if (!birthDate)
        return "-";
    const dob = new Date(birthDate);
    const today = new Date();
    if (Number.isNaN(dob.getTime()))
        return "-";
    let years = today.getFullYear() - dob.getFullYear();
    let months = today.getMonth() - dob.getMonth();
    if (months < 0 || (months === 0 && today.getDate() < dob.getDate())) {
        years -= 1;
        months += 12;
    }
    if (today.getDate() < dob.getDate()) {
        months -= 1;
        if (months < 0) {
            years -= 1;
            months += 12;
        }
    }
    if (years < 0)
        return "-";
    if (years <= 0)
        return `${months} months`;
    return `${years} years${months > 0 ? ` and ${months} months` : ""}`;
}
