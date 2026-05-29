"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIGRATION_LEARNER_STATUSES = void 0;
exports.countsTowardActiveHeadCount = countsTowardActiveHeadCount;
exports.isHistoricalMigrationStatus = isHistoricalMigrationStatus;
exports.isUnenrolledMigrationStatus = isUnenrolledMigrationStatus;
exports.requiresReviewBeforeApply = requiresReviewBeforeApply;
exports.parseMigrationLearnerStatus = parseMigrationLearnerStatus;
exports.isClosedOrInactiveAccountStatus = isClosedOrInactiveAccountStatus;
exports.MIGRATION_LEARNER_STATUSES = [
    "ACTIVE",
    "HISTORICAL",
    "UNENROLLED",
    "UNKNOWN",
];
/** ACTIVE counts toward learner head count and billing eligibility. */
function countsTowardActiveHeadCount(status) {
    return status === "ACTIVE";
}
/** HISTORICAL is preserved for old records only — never active head count. */
function isHistoricalMigrationStatus(status) {
    return status === "HISTORICAL";
}
/** UNENROLLED is preserved but does not count as active. */
function isUnenrolledMigrationStatus(status) {
    return status === "UNENROLLED";
}
/** UNKNOWN must be reviewed before apply. */
function requiresReviewBeforeApply(status) {
    return status === "UNKNOWN";
}
const HISTORICAL_TOKENS = /\b(historical|inactive|former|archived|legacy|left school|no longer)\b/i;
const UNENROLLED_TOKENS = /\b(unenrolled|withdrawn|withdrawal|left|departed|transferred out|not returning)\b/i;
const ACTIVE_TOKENS = /\b(active|current|enrolled|present)\b/i;
const CLOSED_ACCOUNT_TOKENS = /\b(closed|inactive|archived|terminated|cancelled|canceled)\b/i;
function parseMigrationLearnerStatus(raw, hints) {
    const s = String(raw || "").trim();
    const category = String(hints?.fileCategory || "").trim().toLowerCase();
    if (category === "historical")
        return "HISTORICAL";
    if (!s)
        return "UNKNOWN";
    const upper = s.toUpperCase();
    if (upper === "ACTIVE")
        return "ACTIVE";
    if (upper === "HISTORICAL")
        return "HISTORICAL";
    if (upper === "UNENROLLED")
        return "UNENROLLED";
    if (upper === "UNKNOWN")
        return "UNKNOWN";
    if (HISTORICAL_TOKENS.test(s))
        return "HISTORICAL";
    if (UNENROLLED_TOKENS.test(s))
        return "UNENROLLED";
    if (ACTIVE_TOKENS.test(s))
        return "ACTIVE";
    return "UNKNOWN";
}
function isClosedOrInactiveAccountStatus(raw) {
    const s = String(raw || "").trim();
    if (!s)
        return false;
    return CLOSED_ACCOUNT_TOKENS.test(s);
}
