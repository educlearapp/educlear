"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transactionsForAccount = transactionsForAccount;
exports.isHistoricalLedgerOnlyMovement = isHistoricalLedgerOnlyMovement;
exports.learnersPerAccount = learnersPerAccount;
exports.isMergedFamilyAccount = isMergedFamilyAccount;
exports.classifyVarianceGroup = classifyVarianceGroup;
const daSilvaMergedFamily_1 = require("./daSilvaMergedFamily");
/** Notes that indicate closed / removed / refund ledger lines (not active debt). */
const HISTORICAL_MOVEMENT_NOTE = /\b(removed|refund|closed|not returning|relocat|write[\s-]?off|learner left|no longer|cancelled|canceled|credit note|discount|not doing|left school|historical|jamf)\b/i;
function transactionsForAccount(accountNo, transactions) {
    return transactions.filter((t) => t.accountNo === accountNo);
}
function isHistoricalLedgerOnlyMovement(accountNo, transactions, inAgeAnalysis) {
    const txns = transactionsForAccount(accountNo, transactions);
    if (txns.length === 0)
        return false;
    if (!inAgeAnalysis)
        return true;
    return txns.every((t) => {
        const note = String(t.notes || "").trim();
        if (!note)
            return true;
        return HISTORICAL_MOVEMENT_NOTE.test(note);
    });
}
function learnersPerAccount(learners) {
    const counts = new Map();
    for (const learner of learners) {
        if (!learner.accountNo)
            continue;
        counts.set(learner.accountNo, (counts.get(learner.accountNo) || 0) + 1);
    }
    return counts;
}
function isMergedFamilyAccount(accountNo, fullName, learnerCountByAccount, mergedFamilyAccountNos) {
    if (mergedFamilyAccountNos.has(accountNo))
        return true;
    if ((0, daSilvaMergedFamily_1.splitMergedAccountNames)(fullName).length > 1)
        return true;
    return (learnerCountByAccount.get(accountNo) || 0) > 1;
}
function classifyVarianceGroup(row, inAgeAnalysis, transactions, mergedFamily) {
    if (mergedFamily && Math.abs(row.ageAnalysisBalance) > 0.01) {
        return "mergedFamilyLedgerGap";
    }
    if (Math.abs(row.ageAnalysisBalance) > 0.01) {
        return "activeAgeAnalysisMismatch";
    }
    if (row.ledgerBalanceFromImport < -0.01) {
        return "overpaidCredit";
    }
    if (row.ledgerBalanceFromImport > 0.01 &&
        isHistoricalLedgerOnlyMovement(row.accountNo, transactions, inAgeAnalysis)) {
        return "zeroBalanceHistoricalLedgerOnly";
    }
    return "activeAgeAnalysisMismatch";
}
