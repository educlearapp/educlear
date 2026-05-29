"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeLearnerGender = normalizeLearnerGender;
exports.inferGenderFromSouthAfricanId = inferGenderFromSouthAfricanId;
exports.resolveLearnerGender = resolveLearnerGender;
exports.isMaleGender = isMaleGender;
exports.isFemaleGender = isFemaleGender;
/**
 * Normalize learner gender for storage/API (Male / Female) and stats (isMale / isFemale).
 * Handles Kid-e-Sys, SA-SAMS, and legacy single-letter values (M, F).
 */
function normalizeLearnerGender(raw) {
    const v = String(raw || "").trim();
    if (!v)
        return null;
    const lower = v.toLowerCase();
    if (lower === "m" ||
        lower === "male" ||
        lower === "boy" ||
        lower === "boys" ||
        lower === "man") {
        return "Male";
    }
    if (lower === "f" ||
        lower === "female" ||
        lower === "girl" ||
        lower === "girls" ||
        lower === "woman") {
        return "Female";
    }
    if (lower.startsWith("m"))
        return "Male";
    if (lower.startsWith("f"))
        return "Female";
    return null;
}
/** Infer gender from SA ID sequence digits (7–10): 0000–4999 female, 5000–9999 male. */
function inferGenderFromSouthAfricanId(idNumber) {
    const clean = String(idNumber || "").replace(/\D/g, "");
    if (clean.length < 10)
        return null;
    const seq = parseInt(clean.slice(6, 10), 10);
    if (!Number.isFinite(seq))
        return null;
    return seq >= 5000 ? "Male" : "Female";
}
function resolveLearnerGender(opts) {
    return normalizeLearnerGender(opts.gender) || inferGenderFromSouthAfricanId(opts.idNumber);
}
function isMaleGender(raw) {
    return normalizeLearnerGender(raw) === "Male";
}
function isFemaleGender(raw) {
    return normalizeLearnerGender(raw) === "Female";
}
