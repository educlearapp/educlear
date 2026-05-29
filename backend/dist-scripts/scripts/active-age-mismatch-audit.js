"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Audit-only: sub-classify active age-analysis balance mismatches.
 * Usage: npx ts-node scripts/active-age-mismatch-audit.ts [desktopRoot]
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const daSilvaMigrationService_1 = require("../src/services/daSilvaMigration/daSilvaMigrationService");
const daSilvaMergedFamily_1 = require("../src/services/daSilvaMigration/daSilvaMergedFamily");
const kideesysSpreadsheet_1 = require("../src/utils/kideesysSpreadsheet");
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
function isMergedFamilyCandidate(accountNo, fullName, learnerCountByAccount, mergedFamilyAccountNos) {
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
function classifyActiveMismatchReason(row, opts) {
    if (!opts.inAgeAnalysis ||
        (opts.inAgeAnalysis && Math.abs(row.ageAnalysisBalance) <= 0.01 && Math.abs(row.ledgerBalanceFromImport) > 0.01)) {
        return "orphanLedgerOnly";
    }
    if (opts.mergedFamilyCandidate ||
        opts.silentSibling ||
        (0, daSilvaMergedFamily_1.splitMergedAccountNames)(row.fullName).length > 1 ||
        opts.activeLearnerCount === 0) {
        return "historicalMergedFamily";
    }
    if (opts.section === "Over Paid" ||
        row.ageAnalysisBalance < -0.01 ||
        opts.duplicateNameAccountNos.length > 1 ||
        opts.historicalLedgerOnly ||
        (opts.ledgerTxnCount > 0 && row.ledgerBalanceFromImport < -0.01 && row.ageAnalysisBalance > 0.01)) {
        return "possibleDuplicateOrHistoricalCredit";
    }
    return "trueBalanceMismatch";
}
const desktopRoot = process.argv[2] || path_1.default.join(process.env.HOME || "", "Desktop");
const bundle = (0, daSilvaMigrationService_1.buildDaSilvaBundleFromDesktopLayout)("audit-school", "audit-project", desktopRoot);
const classLearners = bundle.learners.map((l) => ({
    fullName: l.fullName,
    firstName: l.firstName,
    lastName: l.lastName,
    className: l.className,
    matchKey: `${l.fullName}|${l.className}`,
    sourceFile: "staged",
}));
const familyIndex = {
    learnerNameToAccount: new Map(),
    accountToLearnerNames: new Map(),
};
(0, daSilvaMergedFamily_1.indexHistoricalLearners)(bundle.accounts, [], classLearners, [], bundle.transactions, familyIndex);
const varianceRows = bundle.reconciliation.rows.filter((r) => Math.abs(r.variance) > 0.01);
const ageAnalysisAccountNos = new Set(bundle.accounts.map((a) => a.accountNo));
const mergedFamilyAccountNos = new Set(bundle.mergedFamilyAccountNos || []);
const activeLearnersByAccount = (0, daSilvaMergedFamily_1.countActiveLearnersPerAccount)(classLearners, bundle.accounts, familyIndex);
const learnerCountByAccount = new Map();
for (const learner of bundle.learners) {
    if (!learner.accountNo)
        continue;
    learnerCountByAccount.set(learner.accountNo, (learnerCountByAccount.get(learner.accountNo) || 0) + 1);
}
const nameToAccounts = new Map();
for (const account of bundle.accounts) {
    const names = (0, daSilvaMergedFamily_1.splitMergedAccountNames)(account.fullName);
    const list = names.length ? names : [account.fullName];
    for (const name of list) {
        const key = (0, kideesysSpreadsheet_1.normalizeMatchText)(name);
        if (!key)
            continue;
        const list = nameToAccounts.get(key) || [];
        if (!list.includes(account.accountNo))
            list.push(account.accountNo);
        nameToAccounts.set(key, list);
    }
}
const activeMismatches = varianceRows
    .filter((row) => {
    const account = bundle.accounts.find((a) => a.accountNo === row.accountNo);
    const fullName = row.fullName || account?.fullName || "";
    const mergedFamily = isMergedFamilyCandidate(row.accountNo, fullName, learnerCountByAccount, mergedFamilyAccountNos);
    const inAgeAnalysis = ageAnalysisAccountNos.has(row.accountNo);
    return (classifyVarianceGroup({ ...row, fullName }, inAgeAnalysis, bundle.transactions, mergedFamily) === "activeAgeAnalysisMismatch");
})
    .map((row) => {
    const account = bundle.accounts.find((a) => a.accountNo === row.accountNo);
    const fullName = row.fullName || account?.fullName || "";
    const inAgeAnalysis = ageAnalysisAccountNos.has(row.accountNo);
    const activeLearnerCount = activeLearnersByAccount.get(row.accountNo) || 0;
    const mergedFamilyCandidate = isMergedFamilyCandidate(row.accountNo, fullName, learnerCountByAccount, mergedFamilyAccountNos);
    const silentSibling = (0, daSilvaMergedFamily_1.hasSilentBillingSibling)(row.accountNo, familyIndex, bundle.transactions);
    const duplicateNameAccountNos = [];
    for (const name of (0, daSilvaMergedFamily_1.splitMergedAccountNames)(fullName).length
        ? (0, daSilvaMergedFamily_1.splitMergedAccountNames)(fullName)
        : [fullName]) {
        const key = (0, kideesysSpreadsheet_1.normalizeMatchText)(name);
        const accounts = nameToAccounts.get(key) || [];
        for (const acct of accounts) {
            if (!duplicateNameAccountNos.includes(acct))
                duplicateNameAccountNos.push(acct);
        }
    }
    const auditReason = classifyActiveMismatchReason({ ...row, fullName }, {
        inAgeAnalysis,
        activeLearnerCount,
        mergedFamilyCandidate,
        silentSibling,
        duplicateNameAccountNos,
        section: account?.section || "",
        historicalLedgerOnly: isHistoricalLedgerOnlyMovement(row.accountNo, bundle.transactions, inAgeAnalysis),
        ledgerTxnCount: transactionsForAccount(row.accountNo, bundle.transactions).length,
    });
    return {
        accountNo: row.accountNo,
        fullName,
        ageAnalysisBalance: row.ageAnalysisBalance,
        ledgerBalanceFromImport: row.ledgerBalanceFromImport,
        variance: row.variance,
        absVariance: Math.abs(row.variance),
        inAgeAnalysis,
        activeLearnerCount,
        mergedFamilyCandidate,
        silentSibling,
        duplicateAccountNos: duplicateNameAccountNos,
        section: account?.section || "",
        auditReason,
    };
})
    .sort((a, b) => b.absVariance - a.absVariance);
const reasonCounts = {
    historicalMergedFamily: 0,
    trueBalanceMismatch: 0,
    orphanLedgerOnly: 0,
    possibleDuplicateOrHistoricalCredit: 0,
};
for (const row of activeMismatches) {
    reasonCounts[row.auditReason]++;
}
const outDir = path_1.default.join(__dirname, "..");
const jsonPath = path_1.default.join(outDir, "active-age-mismatches.json");
const txtPath = path_1.default.join(outDir, "active-age-mismatch-audit.txt");
const report = {
    generatedAt: new Date().toISOString(),
    desktopRoot,
    activeMismatchCount: activeMismatches.length,
    reasonCounts,
    mismatches: activeMismatches,
};
fs_1.default.writeFileSync(jsonPath, JSON.stringify(activeMismatches, null, 2), "utf8");
const lines = [
    "=== Active age-analysis mismatch audit (audit only) ===",
    `Generated: ${report.generatedAt}`,
    `Desktop root: ${desktopRoot}`,
    `Active mismatches: ${activeMismatches.length}`,
    "",
    "Reason breakdown:",
    `  historicalMergedFamily: ${reasonCounts.historicalMergedFamily}`,
    `  trueBalanceMismatch: ${reasonCounts.trueBalanceMismatch}`,
    `  orphanLedgerOnly: ${reasonCounts.orphanLedgerOnly}`,
    `  possibleDuplicateOrHistoricalCredit: ${reasonCounts.possibleDuplicateOrHistoricalCredit}`,
    "",
    "Top 30 by |variance|:",
    "",
    "accountNo | auditReason | age | ledger | variance | name",
    "--------- | ----------- | --- | ------ | -------- | ----",
];
for (const row of activeMismatches.slice(0, 30)) {
    const name = String(row.fullName || "").replace(/\n/g, " / ").slice(0, 40);
    lines.push(`${row.accountNo.padEnd(9)} | ${row.auditReason.padEnd(35)} | ${String(row.ageAnalysisBalance).padStart(8)} | ${String(row.ledgerBalanceFromImport).padStart(8)} | ${String(row.variance).padStart(8)} | ${name}`);
}
fs_1.default.writeFileSync(txtPath, lines.join("\n"), "utf8");
console.log(lines.join("\n"));
console.log(`\nExported ${activeMismatches.length} rows to active-age-mismatches.json`);
console.log(`Summary written to active-age-mismatch-audit.txt`);
