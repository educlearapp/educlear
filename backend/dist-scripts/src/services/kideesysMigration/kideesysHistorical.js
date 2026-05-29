"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildHistoricalStagedLearners = buildHistoricalStagedLearners;
const kideesysSpreadsheet_1 = require("../../utils/kideesysSpreadsheet");
const parsers_1 = require("../daSilvaMigration/parsers");
const daSilvaMergedFamily_1 = require("../daSilvaMigration/daSilvaMergedFamily");
const HISTORICAL_CLASS_LABEL = "Historical / Unenrolled";
function normNameKey(name) {
    return (0, kideesysSpreadsheet_1.normalizeMatchText)(name).replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}
function activeNameKeys(activeLearners) {
    const keys = new Set();
    for (const l of activeLearners) {
        keys.add((0, kideesysSpreadsheet_1.normalizeMatchText)(l.fullName));
        keys.add(normNameKey(l.fullName));
        keys.add(l.matchKey);
    }
    return keys;
}
function isActiveName(fullName, activeKeys) {
    const n = (0, kideesysSpreadsheet_1.normalizeMatchText)(fullName);
    const nk = normNameKey(fullName);
    return activeKeys.has(n) || activeKeys.has(nk);
}
function collectHistoricalCandidates(activeKeys, accounts, billingItems, transactions) {
    const map = new Map();
    const add = (fullName, accountNo, source) => {
        const name = String(fullName || "").trim();
        const acc = String(accountNo || "").trim();
        if (!name || isActiveName(name, activeKeys))
            return;
        const key = `${acc}|${normNameKey(name)}`;
        if (!map.has(key)) {
            map.set(key, { fullName: name, accountNo: acc, source });
        }
    };
    for (const account of accounts) {
        const names = (0, daSilvaMergedFamily_1.splitMergedAccountNames)(account.fullName);
        const list = names.length ? names : [account.fullName];
        for (const name of list) {
            add(name, account.accountNo, "age_analysis");
        }
    }
    for (const item of billingItems) {
        add(item.fullName, "", "billing_plan");
    }
    for (const txn of transactions) {
        add(txn.fullName, txn.accountNo, "transaction");
    }
    return map;
}
function buildHistoricalStagedLearners(opts) {
    const uniqueActive = new Map();
    for (const l of opts.activeClassLearners) {
        if (!uniqueActive.has(l.matchKey))
            uniqueActive.set(l.matchKey, l);
    }
    const activeKeys = activeNameKeys([...uniqueActive.values()]);
    const candidates = collectHistoricalCandidates(activeKeys, opts.accounts, opts.billingItems, opts.transactions);
    const staged = [];
    for (const candidate of candidates.values()) {
        const { firstName, lastName } = (0, kideesysSpreadsheet_1.splitFullName)(candidate.fullName);
        let accountNo = candidate.accountNo;
        if (!accountNo) {
            accountNo =
                opts.accountByName.get((0, kideesysSpreadsheet_1.normalizeMatchText)(candidate.fullName)) ||
                    "";
        }
        const matchKey = `historical|${accountNo}|${normNameKey(candidate.fullName)}`;
        const billingPlan = opts.planByKey.get((0, parsers_1.buildLearnerMatchKey)(candidate.fullName, HISTORICAL_CLASS_LABEL)) || [];
        staged.push({
            matchKey,
            fullName: candidate.fullName,
            firstName,
            lastName,
            className: HISTORICAL_CLASS_LABEL,
            canonicalClassName: HISTORICAL_CLASS_LABEL,
            accountNo,
            billingPlan,
            billingPlanTotal: billingPlan.reduce((s, i) => s + i.amount, 0),
            ageAnalysisBalance: accountNo ? opts.accountBalanceByNo.get(accountNo) ?? 0 : 0,
            parents: [],
            enrollmentTier: "HISTORICAL",
        });
    }
    return staged.sort((a, b) => a.fullName.localeCompare(b.fullName));
}
