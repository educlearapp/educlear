"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildStatementTransactions = buildStatementTransactions;
const billingDisplayRules_1 = require("../utils/billingDisplayRules");
const billingLedgerStore_1 = require("../utils/billingLedgerStore");
const kidesysTransactionHistoryStore_1 = require("../utils/kidesysTransactionHistoryStore");
const statementPeriod_1 = require("../utils/statementPeriod");
function resolveEntryLearnerLabel(entry, nameByLearnerId, accountRef) {
    const learnerId = String(entry.learnerId || "").trim();
    const ref = String(accountRef || "").trim();
    if (learnerId && nameByLearnerId.has(learnerId)) {
        return nameByLearnerId.get(learnerId) || "";
    }
    if (entry.type === "payment" && (!learnerId || (ref && learnerId === ref))) {
        return "Family account";
    }
    return "";
}
/**
 * Builds statement transaction rows matching StatementManage (posting ledger + Kid-e-Sys history).
 */
function buildStatementTransactions(input) {
    const { schoolId, accountRef, ledgerEntries, period, nameByLearnerId } = input;
    const postingRows = [];
    const sortedPosting = [...ledgerEntries].sort((a, b) => new Date(a.date || a.createdAt).getTime() - new Date(b.date || b.createdAt).getTime());
    let running = 0;
    sortedPosting.forEach((entry) => {
        if (!(0, statementPeriod_1.shouldShowOpeningBalanceMigration)(period, entry) && (0, billingDisplayRules_1.isKidesysOpeningBalanceEntry)(entry)) {
            return;
        }
        const amount = (0, billingLedgerStore_1.normaliseAmount)(entry.amount);
        const isDebit = entry.type === "invoice" || entry.type === "penalty";
        running += isDebit ? amount : -amount;
        const isOpeningBalance = (0, billingDisplayRules_1.isKidesysOpeningBalanceEntry)(entry);
        const sortTime = new Date(entry.date || entry.createdAt).getTime();
        postingRows.push({
            key: `posting-${entry.id}`,
            date: entry.date || "—",
            type: (0, billingDisplayRules_1.formatLedgerTypeLabel)(entry),
            reference: (0, billingDisplayRules_1.formatLedgerReferenceDisplay)(entry) || "—",
            description: (0, billingDisplayRules_1.formatLedgerDescriptionDisplay)(entry) || "—",
            amountIn: isDebit ? amount : 0,
            amountOut: !isDebit ? amount : 0,
            balance: running,
            learner: resolveEntryLearnerLabel(entry, nameByLearnerId, accountRef) || undefined,
            isKidesysHistory: false,
            isOpeningBalance,
            sortTime: Number.isNaN(sortTime) ? 0 : sortTime,
        });
    });
    const kidesysAll = (0, kidesysTransactionHistoryStore_1.filterHistoryForAccount)((0, kidesysTransactionHistoryStore_1.readSchoolKidesysHistory)(schoolId), accountRef);
    const filteredKidesys = (0, statementPeriod_1.filterKidesysHistoryByStatementPeriod)(kidesysAll, period);
    const historyRows = filteredKidesys.map((entry) => {
        const amount = (0, billingLedgerStore_1.normaliseAmount)(entry.amount);
        const isDebit = entry.type === "invoice";
        const sortTime = new Date(entry.date || "").getTime();
        return {
            key: `kidesys-${entry.id}`,
            date: entry.date || "—",
            type: (0, billingDisplayRules_1.formatKidesysHistoryTypeLabel)(entry.type),
            reference: (0, billingDisplayRules_1.formatKidesysHistoryReferenceDisplay)(entry),
            description: (0, billingDisplayRules_1.formatKidesysHistoryDescriptionDisplay)(entry),
            amountIn: isDebit ? amount : 0,
            amountOut: !isDebit ? amount : 0,
            balance: null,
            learner: entry.fullName || "—",
            isKidesysHistory: true,
            isOpeningBalance: false,
            sortTime: Number.isNaN(sortTime) ? 0 : sortTime,
        };
    });
    const merged = [...postingRows, ...historyRows].sort((a, b) => {
        if (a.sortTime !== b.sortTime)
            return b.sortTime - a.sortTime;
        if (a.isKidesysHistory !== b.isKidesysHistory)
            return a.isKidesysHistory ? 1 : -1;
        return String(a.key).localeCompare(String(b.key));
    });
    const openingBalanceRows = merged.filter((row) => row.isOpeningBalance);
    const otherRows = merged.filter((row) => !row.isOpeningBalance);
    return [...openingBalanceRows, ...otherRows].map(({ key: _key, isKidesysHistory: _h, isOpeningBalance: _o, sortTime: _s, ...row }) => row);
}
