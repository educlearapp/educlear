"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeSuperAdminEmail = normalizeSuperAdminEmail;
exports.parseSuperAdminEmails = parseSuperAdminEmails;
exports.isPlatformSuperAdminEmail = isPlatformSuperAdminEmail;
function normalizeSuperAdminEmail(email) {
    return String(email || "").trim().toLowerCase();
}
function stripEnvQuotes(value) {
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
}
function parseSuperAdminEmails(raw) {
    return stripEnvQuotes(String(raw ?? process.env.SUPER_ADMIN_EMAILS ?? ""))
        .split(",")
        .map((entry) => normalizeSuperAdminEmail(stripEnvQuotes(entry)))
        .filter(Boolean);
}
function isPlatformSuperAdminEmail(email) {
    const allowed = parseSuperAdminEmails();
    return allowed.includes(normalizeSuperAdminEmail(email));
}
