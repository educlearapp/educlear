"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATEMENT_PERIOD_OPTIONS = exports.DEFAULT_STATEMENT_PERIOD = void 0;
exports.normalizeStatementPeriod = normalizeStatementPeriod;
exports.resolveStatementPeriodCutoff = resolveStatementPeriodCutoff;
exports.isDateInStatementPeriod = isDateInStatementPeriod;
exports.formatStatementPeriodHeaderLabel = formatStatementPeriodHeaderLabel;
exports.filterLedgerByStatementPeriod = filterLedgerByStatementPeriod;
exports.filterKidesysHistoryByStatementPeriod = filterKidesysHistoryByStatementPeriod;
exports.shouldShowOpeningBalanceMigration = shouldShowOpeningBalanceMigration;
const billingDisplayRules_1 = require("./billingDisplayRules");
exports.DEFAULT_STATEMENT_PERIOD = "Last 3 Months";
exports.STATEMENT_PERIOD_OPTIONS = [
    "Last 3 Months",
    "Last 6 Months",
    "Last 12 Months",
    "Last 18 Months",
    "Last 24 Months",
    "All Time",
];
const MONTHS_BY_PERIOD = {
    "Last 3 Months": 3,
    "Last 6 Months": 6,
    "Last 12 Months": 12,
    "Last 18 Months": 18,
    "Last 24 Months": 24,
};
const LEGACY_PERIOD_MAP = {
    "Last 10 Transactions": "Last 3 Months",
    "Last 9 Months": "Last 12 Months",
    "This Year": "Last 12 Months",
};
function formatDisplayDate(date) {
    return date.toLocaleDateString("en-ZA", {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}
function normalizeStatementPeriod(period) {
    const raw = String(period || "").trim();
    if (!raw)
        return exports.DEFAULT_STATEMENT_PERIOD;
    if (LEGACY_PERIOD_MAP[raw])
        return LEGACY_PERIOD_MAP[raw];
    if (exports.STATEMENT_PERIOD_OPTIONS.includes(raw)) {
        return raw;
    }
    return exports.DEFAULT_STATEMENT_PERIOD;
}
function resolveStatementPeriodCutoff(period, now = new Date()) {
    const normalized = normalizeStatementPeriod(period);
    if (normalized === "All Time")
        return null;
    const months = MONTHS_BY_PERIOD[normalized];
    if (!months)
        return null;
    const cutoff = new Date(now);
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setMonth(cutoff.getMonth() - months);
    return cutoff;
}
function isDateInStatementPeriod(dateRaw, period, now = new Date()) {
    const normalized = normalizeStatementPeriod(period);
    if (normalized === "All Time")
        return true;
    const cutoff = resolveStatementPeriodCutoff(normalized, now);
    if (!cutoff)
        return true;
    const entryDate = new Date(String(dateRaw || "").trim());
    if (Number.isNaN(entryDate.getTime()))
        return false;
    return entryDate >= cutoff;
}
function formatStatementPeriodHeaderLabel(period, now = new Date()) {
    const normalized = normalizeStatementPeriod(period);
    if (normalized === "All Time")
        return "All Time";
    const cutoff = resolveStatementPeriodCutoff(normalized, now);
    if (!cutoff)
        return normalized;
    const end = new Date(now);
    end.setHours(0, 0, 0, 0);
    return `${normalized} (${formatDisplayDate(cutoff)} – ${formatDisplayDate(end)})`;
}
function filterLedgerByStatementPeriod(entries, period) {
    const normalized = normalizeStatementPeriod(period);
    if (normalized === "All Time")
        return entries;
    return entries.filter((entry) => isDateInStatementPeriod(entry.date || entry.createdAt, normalized));
}
function filterKidesysHistoryByStatementPeriod(entries, period) {
    const normalized = normalizeStatementPeriod(period);
    if (normalized === "All Time")
        return entries;
    return entries.filter((entry) => isDateInStatementPeriod(entry.date, normalized));
}
function shouldShowOpeningBalanceMigration(period, entry) {
    if (!(0, billingDisplayRules_1.isKidesysOpeningBalanceEntry)(entry))
        return false;
    const normalized = normalizeStatementPeriod(period);
    if (normalized === "All Time")
        return true;
    return isDateInStatementPeriod(entry.date || entry.createdAt, normalized);
}
