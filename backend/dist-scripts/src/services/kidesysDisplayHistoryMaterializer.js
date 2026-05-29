"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildHistoryEntriesFromLedger = buildHistoryEntriesFromLedger;
exports.materializeKidesysDisplayHistory = materializeKidesysDisplayHistory;
const daSilvaTransactionHistory_1 = require("./daSilvaMigration/daSilvaTransactionHistory");
const kidesysTransactionHistoryStore_1 = require("../utils/kidesysTransactionHistoryStore");
const billingLedgerStore_1 = require("../utils/billingLedgerStore");
const ageAnalysisParser_1 = require("./daSilvaMigration/ageAnalysisParser");
function round2(n) {
    return Math.round(n * 100) / 100;
}
function parseTransactionNo(reference, id) {
    const ref = String(reference || "").trim();
    const m = ref.match(/(\d+)/);
    if (m?.[1])
        return m[1];
    const fromId = String(id || "").replace(/^kidesys-(invoice|payment|journal)-/, "");
    return fromId || ref || id;
}
/** Build display-only history rows from imported Kid-e-Sys ledger entries (invoice/payment). */
function buildHistoryEntriesFromLedger(schoolId, ledger, importedAt = new Date().toISOString()) {
    const seen = new Set();
    const entries = [];
    for (const row of ledger) {
        if (row.type !== "invoice" && row.type !== "payment")
            continue;
        const accountNo = String(row.accountNo || "").trim().toUpperCase();
        if (!accountNo || !(0, ageAnalysisParser_1.isKidESysSourceAccountRef)(accountNo))
            continue;
        const source = String(row.source || "");
        if (!source.includes("kideesys") && !String(row.id || "").startsWith("kidesys-"))
            continue;
        const transactionNo = parseTransactionNo(String(row.reference || ""), String(row.id || ""));
        const amount = round2(Math.abs(Number(row.amount) || 0));
        const txn = {
            kind: row.type,
            transactionNo,
            accountNo,
            date: String(row.date || "").slice(0, 10),
            amount,
            signedAmount: row.type === "payment" ? -amount : amount,
            reference: String(row.reference || `${row.type} ${transactionNo}`).trim(),
            notes: String(row.description || "").trim(),
            fullName: "",
            sourceFileRow: 0,
            direction: row.type === "payment" ? "credit" : "debit",
        };
        const entry = (0, daSilvaTransactionHistory_1.mapParsedTransactionToHistoryEntry)(schoolId, txn, importedAt);
        if (seen.has(entry.id))
            continue;
        seen.add(entry.id);
        entries.push(entry);
    }
    return entries;
}
/**
 * Ensure kidesys-transaction-history.json has display rows for last invoice/payment.
 * Merges parsed transaction file rows with ledger-derived rows (idempotent by entry id).
 */
function materializeKidesysDisplayHistory(opts) {
    const schoolId = String(opts.schoolId || "").trim();
    const importedAt = new Date().toISOString();
    const previous = (0, kidesysTransactionHistoryStore_1.readSchoolKidesysHistory)(schoolId);
    const byId = new Map();
    for (const row of previous)
        byId.set(row.id, row);
    if (opts.transactions?.length) {
        for (const entry of (0, daSilvaTransactionHistory_1.buildHistoryEntriesFromTransactions)(schoolId, opts.transactions, importedAt)) {
            byId.set(entry.id, entry);
        }
    }
    const ledger = (0, billingLedgerStore_1.readSchoolLedger)(schoolId);
    for (const entry of buildHistoryEntriesFromLedger(schoolId, ledger, importedAt)) {
        if (!byId.has(entry.id))
            byId.set(entry.id, entry);
    }
    const merged = Array.from(byId.values()).filter((e) => String(e.source || "") === kidesysTransactionHistoryStore_1.KIDESYS_DISPLAY_HISTORY_SOURCE);
    const written = !opts.dryRun && merged.length > 0;
    if (written)
        (0, kidesysTransactionHistoryStore_1.writeSchoolKidesysHistory)(schoolId, merged);
    return {
        schoolId,
        previousCount: previous.length,
        mergedCount: merged.length,
        written,
    };
}
