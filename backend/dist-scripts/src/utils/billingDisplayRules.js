"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIGRATED_OPENING_BALANCE_OVERVIEW = exports.OPENING_BALANCE_MIGRATION_TYPE = exports.EDUCLEAR_LIVE_BILLING_DISPLAY_FROM = exports.KIDESYS_HISTORY_DESCRIPTION_FALLBACK = exports.KIDESYS_HISTORY_PAYMENT_TYPE = exports.KIDESYS_HISTORY_INVOICE_TYPE = void 0;
exports.isKidesysOpeningBalanceEntry = isKidesysOpeningBalanceEntry;
exports.isMigrationBillingSource = isMigrationBillingSource;
exports.isImportedBillingLedgerEntry = isImportedBillingLedgerEntry;
exports.isMigratedOpeningBalanceOverviewLabel = isMigratedOpeningBalanceOverviewLabel;
exports.sanitizeLiveBillingText = sanitizeLiveBillingText;
exports.formatLedgerTypeLabel = formatLedgerTypeLabel;
exports.formatLedgerReferenceDisplay = formatLedgerReferenceDisplay;
exports.formatLedgerDescriptionDisplay = formatLedgerDescriptionDisplay;
exports.formatKidesysHistoryTypeLabel = formatKidesysHistoryTypeLabel;
exports.formatKidesysHistoryReferenceDisplay = formatKidesysHistoryReferenceDisplay;
exports.formatKidesysHistoryDescriptionDisplay = formatKidesysHistoryDescriptionDisplay;
exports.KIDESYS_HISTORY_INVOICE_TYPE = "Invoice · Kid-e-Sys History · non-posting";
exports.KIDESYS_HISTORY_PAYMENT_TYPE = "Payment · Kid-e-Sys History · non-posting";
exports.KIDESYS_HISTORY_DESCRIPTION_FALLBACK = "Kid-e-Sys History · non-posting";
/** Permanent rule: EduClear live transactions from this date use normal labels only. */
exports.EDUCLEAR_LIVE_BILLING_DISPLAY_FROM = "2026-05-24";
exports.OPENING_BALANCE_MIGRATION_TYPE = "Opening Balance Migration";
exports.MIGRATED_OPENING_BALANCE_OVERVIEW = "Migrated Opening Balance";
const MIGRATION_SOURCES = new Set([
    "kidesys_migration",
    "kidesys_migration_opening_balance",
    "kidesys_csv_migration",
    "kidesys_csv_opening_balance",
    "kidesys_display_history",
    "kideesys-dasilva",
]);
const LIVE_STRIP_REGEXES = [
    /^KIDESYS-/i,
    /^kidesys-opening-/i,
    /\bKid-e-Sys\b[^\w]*History[^\w]*non-posting\b/gi,
    /\bKid-e-Sys\b/gi,
    /\bOpening Balance Migration\b/gi,
    /\bMigrated Opening Balance\b/gi,
    /\bMigration History\b[^\w]*non-posting\b/gi,
    /\bnon-posting\b/gi,
    /\bMigration\b/gi,
];
function isKidesysOpeningBalanceEntry(entry) {
    if (String(entry.source || "").trim() === "kidesys_migration_opening_balance" ||
        String(entry.source || "").trim() === "kidesys_csv_opening_balance") {
        return true;
    }
    const reference = String(entry.reference || "").trim();
    if (reference.startsWith("KIDESYS-OPENING"))
        return true;
    if (String(entry.description || "").includes("Kid-e-Sys opening balance"))
        return true;
    return false;
}
function isMigrationBillingSource(source) {
    const normalized = String(source || "").trim().toLowerCase();
    if (!normalized)
        return false;
    if (MIGRATION_SOURCES.has(normalized))
        return true;
    return normalized.startsWith("kidesys_migration");
}
function isImportedBillingLedgerEntry(entry) {
    if (isKidesysOpeningBalanceEntry(entry))
        return true;
    if (isMigrationBillingSource(entry.source))
        return true;
    return false;
}
function isMigratedOpeningBalanceOverviewLabel(label) {
    const value = String(label || "").trim();
    return value === exports.MIGRATED_OPENING_BALANCE_OVERVIEW || value === "Opening Balance";
}
function sanitizeLiveBillingText(text) {
    let value = String(text || "").trim();
    if (!value)
        return "";
    for (const re of LIVE_STRIP_REGEXES) {
        value = value.replace(re, " ");
    }
    value = value.replace(/\s+/g, " ").replace(/^[-–·|]\s*/, "").trim();
    return value;
}
function formatLedgerTypeLabel(entry) {
    if (isKidesysOpeningBalanceEntry(entry))
        return exports.OPENING_BALANCE_MIGRATION_TYPE;
    switch (entry.type) {
        case "invoice":
            return "Invoice";
        case "penalty":
            return "Penalty";
        case "credit":
            return "Credit";
        default:
            return "Payment";
    }
}
function formatLedgerReferenceDisplay(entry) {
    const raw = String(entry.reference || "").trim();
    if (!raw)
        return "";
    if (isImportedBillingLedgerEntry(entry))
        return raw;
    return sanitizeLiveBillingText(raw) || "";
}
function formatLedgerDescriptionDisplay(entry) {
    const raw = String(entry.description || "").trim();
    if (!raw) {
        if (isKidesysOpeningBalanceEntry(entry))
            return exports.MIGRATED_OPENING_BALANCE_OVERVIEW;
        return "";
    }
    if (isImportedBillingLedgerEntry(entry)) {
        if (isKidesysOpeningBalanceEntry(entry) && /Kid-e-Sys opening balance/i.test(raw)) {
            return exports.MIGRATED_OPENING_BALANCE_OVERVIEW;
        }
        return raw;
    }
    return sanitizeLiveBillingText(raw) || "";
}
function formatKidesysHistoryTypeLabel(type) {
    return type === "invoice" ? exports.KIDESYS_HISTORY_INVOICE_TYPE : exports.KIDESYS_HISTORY_PAYMENT_TYPE;
}
function formatKidesysHistoryReferenceDisplay(entry) {
    const raw = entry.kidesysReference ||
        entry.reference ||
        entry.transactionNo ||
        entry.invoiceNumber ||
        entry.paymentNumber ||
        "";
    return String(raw).trim() || "—";
}
function formatKidesysHistoryDescriptionDisplay(entry) {
    const raw = entry.description || entry.journalReference || entry.reference || "";
    const value = String(raw).trim();
    return value || exports.KIDESYS_HISTORY_DESCRIPTION_FALLBACK;
}
