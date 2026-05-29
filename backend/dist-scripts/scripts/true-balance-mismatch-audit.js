"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Audit-only: deep analysis of trueBalanceMismatch rows (84).
 * Usage: npx ts-node scripts/true-balance-mismatch-audit.ts [desktopRoot]
 */
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const daSilvaMigrationService_1 = require("../src/services/daSilvaMigration/daSilvaMigrationService");
const daSilvaMergedFamily_1 = require("../src/services/daSilvaMigration/daSilvaMergedFamily");
const parsers_1 = require("../src/services/daSilvaMigration/parsers");
function txnFingerprint(t) {
    return `${t.kind}|${t.transactionNo}|${t.accountNo}|${t.signedAmount.toFixed(2)}|${t.date}`;
}
function sumSigned(txns) {
    return Math.round(txns.reduce((s, t) => s + t.signedAmount, 0) * 100) / 100;
}
function sumInvoices(txns) {
    return Math.round(txns.filter((t) => t.kind === "invoice").reduce((s, t) => s + t.signedAmount, 0) * 100) / 100;
}
function sumPayments(txns) {
    return Math.round(txns.filter((t) => t.kind === "payment").reduce((s, t) => s + t.signedAmount, 0) * 100) / 100;
}
function parseIsoDate(d) {
    const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m)
        return null;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
function dateRange(txns) {
    const dates = txns.map((t) => t.date).filter((d) => parseIsoDate(d) !== null);
    if (!dates.length)
        return { min: null, max: null };
    dates.sort();
    return { min: dates[0], max: dates[dates.length - 1] };
}
function findDuplicateFingerprints(txns) {
    const seen = new Map();
    const dups = [];
    for (const t of txns) {
        const fp = txnFingerprint(t);
        const n = (seen.get(fp) || 0) + 1;
        seen.set(fp, n);
        if (n === 2)
            dups.push(fp);
    }
    return dups;
}
function classifyRootCause(opts) {
    const { variance, ageBalance, primaryLedger, backupLedger, missingInPrimary, duplicateCount, primaryTxnCount } = opts;
    if (primaryTxnCount === 0)
        return "noTransactionsInPrimary";
    const missingInv = sumInvoices(missingInPrimary);
    const missingPay = sumPayments(missingInPrimary);
    const missingNet = sumSigned(missingInPrimary);
    if (duplicateCount > 0 && Math.abs(variance) > 0.01) {
        const dupAmount = duplicateCount * 0; // flagged separately; prefer structural cause if backup explains
        void dupAmount;
    }
    if (ageBalance < primaryLedger - 0.01) {
        return "ledgerExceedsAgeAnalysis";
    }
    if (backupLedger !== null && Math.abs(backupLedger - ageBalance) <= 1) {
        const invExplains = Math.abs(missingInv - variance) <= 1 && Math.abs(missingPay) < 0.01;
        const payExplains = Math.abs(Math.abs(missingPay) - variance) <= 1 && Math.abs(missingInv) < 0.01;
        const mixedExplains = Math.abs(missingNet - variance) <= 1;
        if (invExplains && missingInv > 0.01)
            return "missingInvoiceHistoryInPrimaryExport";
        if (payExplains && Math.abs(missingPay) > 0.01)
            return "missingPaymentHistoryInPrimaryExport";
        if (mixedExplains && Math.abs(missingNet) > 0.01) {
            if (missingInv > 0.01 && Math.abs(missingPay) > 0.01)
                return "missingMixedHistoryInPrimaryExport";
            if (missingInv > 0.01)
                return "missingInvoiceHistoryInPrimaryExport";
            if (Math.abs(missingPay) > 0.01)
                return "missingPaymentHistoryInPrimaryExport";
        }
        return "backupDoesNotExplainVariance";
    }
    if (Math.abs(missingNet - variance) <= 1 && Math.abs(missingNet) > 0.01) {
        if (missingInv > 0.01 && Math.abs(missingPay) > 0.01)
            return "missingMixedHistoryInPrimaryExport";
        if (missingInv > 0.01)
            return "missingInvoiceHistoryInPrimaryExport";
        if (Math.abs(missingPay) > 0.01)
            return "missingPaymentHistoryInPrimaryExport";
    }
    if (duplicateCount > 0)
        return "duplicateTransactionsInPrimary";
    return "nearMatchUnexplained";
}
const desktopRoot = process.argv[2] || path_1.default.join(process.env.HOME || "", "Desktop");
const bundle = (0, daSilvaMigrationService_1.buildDaSilvaBundleFromDesktopLayout)("audit", "audit", desktopRoot);
const mismatchPath = path_1.default.join(__dirname, "..", "active-age-mismatches.json");
const allMismatches = JSON.parse(fs_1.default.readFileSync(mismatchPath, "utf8"));
const targets = allMismatches.filter((r) => r.auditReason === "trueBalanceMismatch");
const txnDir = path_1.default.join(desktopRoot, "01_transaction_list");
const primaryPath = path_1.default.join(txnDir, "transaction_list.xls");
const backupCandidates = [
    path_1.default.join(txnDir, "transaction_list_2023_backup.xls"),
    path_1.default.join(txnDir, "transaction_list_2025_backup.xls"),
];
const backupPath = backupCandidates.find((p) => fs_1.default.existsSync(p)) || null;
const primaryTxns = bundle.transactions;
const backupTxns = backupPath ? (0, parsers_1.parseTransactionListFile)(backupPath) : [];
const primaryFp = new Set(primaryTxns.map(txnFingerprint));
const backupOnly = backupTxns.filter((t) => !primaryFp.has(txnFingerprint(t)));
const globalPrimaryDates = dateRange(primaryTxns);
const globalBackupDates = dateRange(backupTxns);
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
(0, daSilvaMergedFamily_1.indexHistoricalLearners)(bundle.accounts, [], classLearners, [], primaryTxns, familyIndex);
const activeByAccount = (0, daSilvaMergedFamily_1.countActiveLearnersPerAccount)(classLearners, bundle.accounts, familyIndex);
const audits = [];
for (const row of targets) {
    const account = bundle.accounts.find((a) => a.accountNo === row.accountNo);
    const primaryForAccount = primaryTxns.filter((t) => t.accountNo === row.accountNo);
    const backupForAccount = backupTxns.filter((t) => t.accountNo === row.accountNo);
    const missingForAccount = backupOnly.filter((t) => t.accountNo === row.accountNo);
    const primaryLedger = sumSigned(primaryForAccount);
    const backupLedger = backupTxns.length ? sumSigned(backupForAccount) : null;
    const dups = findDuplicateFingerprints(primaryForAccount);
    const rootCause = classifyRootCause({
        variance: row.variance,
        ageBalance: row.ageAnalysisBalance,
        primaryLedger,
        backupLedger,
        missingInPrimary: missingForAccount,
        duplicateCount: dups.length,
        primaryTxnCount: primaryForAccount.length,
    });
    const backupClosesGap = backupLedger !== null && Math.abs(backupLedger - row.ageAnalysisBalance) <= 1;
    audits.push({
        accountNo: row.accountNo,
        fullName: row.fullName,
        section: account?.section || "",
        ageAnalysisBalance: row.ageAnalysisBalance,
        ledgerBalanceFromImport: row.ledgerBalanceFromImport,
        variance: row.variance,
        primaryTxnCount: primaryForAccount.length,
        backupTxnCount: backupForAccount.length,
        primaryLedger,
        backupLedger,
        invoiceTotalPrimary: sumInvoices(primaryForAccount),
        paymentTotalPrimary: sumPayments(primaryForAccount),
        missingInPrimaryCount: missingForAccount.length,
        missingInvoiceSum: sumInvoices(missingForAccount),
        missingPaymentSum: sumPayments(missingForAccount),
        missingNetSum: sumSigned(missingForAccount),
        duplicateFingerprints: dups.length,
        dateRangePrimary: dateRange(primaryForAccount),
        dateRangeBackup: dateRange(backupForAccount),
        rootCause,
        backupClosesGap,
    });
}
const causeCounts = {
    missingInvoiceHistoryInPrimaryExport: 0,
    missingPaymentHistoryInPrimaryExport: 0,
    missingMixedHistoryInPrimaryExport: 0,
    backupDoesNotExplainVariance: 0,
    duplicateTransactionsInPrimary: 0,
    noTransactionsInPrimary: 0,
    ledgerExceedsAgeAnalysis: 0,
    nearMatchUnexplained: 0,
};
for (const a of audits)
    causeCounts[a.rootCause]++;
const backupClosesCount = audits.filter((a) => a.backupClosesGap).length;
const hasMissingRows = audits.filter((a) => a.missingInPrimaryCount > 0).length;
const hasDups = audits.filter((a) => a.duplicateFingerprints > 0).length;
const zeroPrimary = audits.filter((a) => a.primaryTxnCount === 0).length;
const sortedCauses = Object.entries(causeCounts).sort((a, b) => b[1] - a[1]);
const topCause = sortedCauses[0];
const report = {
    generatedAt: new Date().toISOString(),
    desktopRoot,
    trueBalanceMismatchCount: targets.length,
    transactionFiles: {
        primary: primaryPath,
        primaryExists: fs_1.default.existsSync(primaryPath),
        backup: backupPath,
        backupExists: !!backupPath,
        note: "User asked for transaction_list_2023_backup.xls; on disk: " +
            (backupPath ? path_1.default.basename(backupPath) : "no backup found"),
    },
    exportStats: {
        primaryTransactionCount: primaryTxns.length,
        backupTransactionCount: backupTxns.length,
        backupOnlyTransactionCount: backupOnly.length,
        primaryDateRange: globalPrimaryDates,
        backupDateRange: globalBackupDates,
    },
    summary: {
        backupLedgerMatchesAgeWithin1Rand: backupClosesCount,
        accountsWithRowsInBackupNotInPrimary: hasMissingRows,
        accountsWithDuplicateFingerprintsInPrimary: hasDups,
        accountsWithZeroPrimaryTransactions: zeroPrimary,
        rootCauseCounts: causeCounts,
        topRecurringCause: topCause[0],
        topRecurringCauseCount: topCause[1],
        topRecurringCausePct: Math.round((topCause[1] / targets.length) * 1000) / 10,
    },
    audits: audits.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)),
};
const outJson = path_1.default.join(__dirname, "..", "true-balance-mismatch-audit.json");
const outTxt = path_1.default.join(__dirname, "..", "true-balance-mismatch-audit.txt");
fs_1.default.writeFileSync(outJson, JSON.stringify(report, null, 2), "utf8");
const lines = [
    "=== True balance mismatch audit (84 rows, audit only) ===",
    `Generated: ${report.generatedAt}`,
    `Desktop: ${desktopRoot}`,
    "",
    "Q1: Missing historical transactions prior to export?",
    `  Primary export date range: ${globalPrimaryDates.min || "?"} .. ${globalPrimaryDates.max || "?"}`,
    `  Backup export date range:  ${globalBackupDates.min || "?"} .. ${globalBackupDates.max || "?"}`,
    `  Backup-only rows (in backup, not in primary): ${backupOnly.length}`,
    `  Of 84 accounts: ${hasMissingRows} have backup rows missing from primary`,
    `  Backup ledger matches age analysis (±R1): ${backupClosesCount} / 84`,
    "",
    "Q2: Invoices/payments missing from backup file?",
    `  Backup file used: ${backupPath ? path_1.default.basename(backupPath) : "NONE"}`,
    `  (No transaction_list_2023_backup.xls on Desktop; compared primary vs available backup.)`,
    "",
    "Q3: Age vs transaction export (84 rows)",
    `  Sum |variance|: R${audits.reduce((s, a) => s + Math.abs(a.variance), 0).toFixed(2)}`,
    `  Sum age balances: R${audits.reduce((s, a) => s + a.ageAnalysisBalance, 0).toFixed(2)}`,
    `  Sum ledger (import): R${audits.reduce((s, a) => s + a.ledgerBalanceFromImport, 0).toFixed(2)}`,
    "",
    "Q4/Q5: Root cause patterns",
    ...sortedCauses.map(([cause, n]) => `  ${cause}: ${n} (${Math.round((n / targets.length) * 1000) / 10}%)`),
    "",
    `TOP recurring cause: ${topCause[0]} — ${topCause[1]} accounts (${report.summary.topRecurringCausePct}%)`,
    "",
    "Top 15 by |variance|:",
    "account | age | ledger | var | primaryTx | missingBackupRows | rootCause",
    ...audits.slice(0, 15).map((a) => `${a.accountNo} | ${a.ageAnalysisBalance} | ${a.ledgerBalanceFromImport} | ${a.variance} | ${a.primaryTxnCount} | ${a.missingInPrimaryCount} | ${a.rootCause}`),
];
fs_1.default.writeFileSync(outTxt, lines.join("\n"), "utf8");
console.log(lines.join("\n"));
console.log(`\nWrote ${outJson}`);
