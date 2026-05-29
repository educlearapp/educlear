"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DA_SILVA_MIGRATION_CUTOVER_DATE = exports.KIDESYS_OPENING_BALANCE_LABEL = void 0;
exports.countAgeAnalysisVarianceAfterAdjustments = countAgeAnalysisVarianceAfterAdjustments;
exports.buildPhase4OpeningBalancesFromAgeAnalysis = buildPhase4OpeningBalancesFromAgeAnalysis;
exports.buildOpeningBalancePlan = buildOpeningBalancePlan;
const daSilvaConstants_1 = require("./daSilvaConstants");
const daSilvaVarianceClassification_1 = require("./daSilvaVarianceClassification");
const PHASE4_OPENING_EXCLUDED = new Set(daSilvaConstants_1.DA_SILVA_OPENING_BALANCE_EXCLUDED_ACCOUNTS);
exports.KIDESYS_OPENING_BALANCE_LABEL = "Kid-e-Sys opening balance adjustment";
exports.DA_SILVA_MIGRATION_CUTOVER_DATE = "2026-05-23";
function roundMoney(n) {
    return Math.round(n * 100) / 100;
}
function openingBalanceReference(accountNo) {
    return `KIDESYS-OPENING-${accountNo}`;
}
/**
 * Age-analysis accounts with a Kid-e-Sys balance still out of line after opening adjustments.
 * Skips zero-balance / overpaid-credit rows (no age-analysis debt to align).
 */
function countAgeAnalysisVarianceAfterAdjustments(reconciliationRows, adjustments, ageAnalysisAccountNos) {
    const adjustmentByAccount = new Map(adjustments.map((a) => [a.accountNo, a.adjustmentAmount]));
    let remaining = 0;
    for (const row of reconciliationRows) {
        if (!ageAnalysisAccountNos.has(row.accountNo))
            continue;
        if (Math.abs(row.ageAnalysisBalance) <= 0.01)
            continue;
        const adjustmentAmount = adjustmentByAccount.get(row.accountNo) || 0;
        const projectedLedger = roundMoney(row.ledgerBalanceFromImport + adjustmentAmount);
        const variance = roundMoney(row.ageAnalysisBalance - projectedLedger);
        if (Math.abs(variance) > 0.01)
            remaining++;
    }
    return remaining;
}
/**
 * Phase 4: set ledger opening balance = Kid-e-Sys age analysis (no transaction history).
 */
function buildPhase4OpeningBalancesFromAgeAnalysis(opts) {
    const cutoverDate = opts.cutoverDate || exports.DA_SILVA_MIGRATION_CUTOVER_DATE;
    const adjustments = [];
    for (const account of opts.accounts) {
        if (PHASE4_OPENING_EXCLUDED.has(account.accountNo))
            continue;
        const afterBalance = roundMoney(account.balance);
        if (Math.abs(afterBalance) <= 0.01)
            continue;
        const beforeBalance = 0;
        const adjustmentAmount = afterBalance;
        const entryType = adjustmentAmount > 0 ? "invoice" : "credit";
        adjustments.push({
            accountNo: account.accountNo,
            fullName: account.fullName,
            varianceGroup: "activeAgeAnalysisMismatch",
            beforeBalance,
            afterBalance,
            adjustmentAmount,
            entryType,
            date: cutoverDate,
            description: exports.KIDESYS_OPENING_BALANCE_LABEL,
            reference: openingBalanceReference(account.accountNo),
        });
    }
    adjustments.sort((a, b) => a.accountNo.localeCompare(b.accountNo));
    return adjustments;
}
function buildOpeningBalancePlan(opts) {
    const cutoverDate = opts.cutoverDate || exports.DA_SILVA_MIGRATION_CUTOVER_DATE;
    const ageAnalysisAccountNos = new Set(opts.accounts.map((a) => a.accountNo));
    const mergedFamilyAccountNos = new Set(opts.mergedFamilyAccountNos);
    const learnerCountByAccount = (0, daSilvaVarianceClassification_1.learnersPerAccount)(opts.learners);
    const accountNameByNo = new Map(opts.accounts.map((a) => [a.accountNo, a.fullName]));
    const adjustments = [];
    for (const row of opts.reconciliationRows) {
        if (!ageAnalysisAccountNos.has(row.accountNo))
            continue;
        const fullName = row.fullName || accountNameByNo.get(row.accountNo) || "";
        const inAgeAnalysis = true;
        const mergedFamily = (0, daSilvaVarianceClassification_1.isMergedFamilyAccount)(row.accountNo, fullName, learnerCountByAccount, mergedFamilyAccountNos);
        const varianceInput = {
            accountNo: row.accountNo,
            fullName,
            ageAnalysisBalance: row.ageAnalysisBalance,
            ledgerBalanceFromImport: row.ledgerBalanceFromImport,
            variance: row.variance,
        };
        const varianceGroup = (0, daSilvaVarianceClassification_1.classifyVarianceGroup)(varianceInput, inAgeAnalysis, opts.transactions, mergedFamily);
        if (varianceGroup !== "activeAgeAnalysisMismatch")
            continue;
        const beforeBalance = roundMoney(row.ledgerBalanceFromImport);
        const afterBalance = roundMoney(row.ageAnalysisBalance);
        const adjustmentAmount = roundMoney(afterBalance - beforeBalance);
        if (Math.abs(adjustmentAmount) <= 0.01)
            continue;
        const entryType = adjustmentAmount > 0 ? "invoice" : "credit";
        adjustments.push({
            accountNo: row.accountNo,
            fullName,
            varianceGroup: "activeAgeAnalysisMismatch",
            beforeBalance,
            afterBalance,
            adjustmentAmount,
            entryType,
            date: cutoverDate,
            description: exports.KIDESYS_OPENING_BALANCE_LABEL,
            reference: openingBalanceReference(row.accountNo),
        });
    }
    adjustments.sort((a, b) => a.accountNo.localeCompare(b.accountNo));
    const totalBeforeBalance = roundMoney(adjustments.reduce((s, a) => s + a.beforeBalance, 0));
    const totalAfterBalance = roundMoney(adjustments.reduce((s, a) => s + a.afterBalance, 0));
    const netAdjustmentValue = roundMoney(adjustments.reduce((s, a) => s + a.adjustmentAmount, 0));
    const totalAdjustmentValue = roundMoney(adjustments.reduce((s, a) => s + Math.abs(a.adjustmentAmount), 0));
    const allAdjustmentsBalanceToAgeAnalysis = adjustments.every((a) => Math.abs(a.beforeBalance + a.adjustmentAmount - a.afterBalance) <= 0.01);
    const ageAnalysisRemainingVarianceCount = countAgeAnalysisVarianceAfterAdjustments(opts.reconciliationRows, adjustments, ageAnalysisAccountNos);
    return {
        label: exports.KIDESYS_OPENING_BALANCE_LABEL,
        summary: {
            cutoverDate,
            adjustmentCount: adjustments.length,
            totalAdjustmentValue,
            netAdjustmentValue,
            totalBeforeBalance,
            totalAfterBalance,
            ageAnalysisRemainingVarianceCount,
        },
        adjustments,
        allAdjustmentsBalanceToAgeAnalysis,
    };
}
