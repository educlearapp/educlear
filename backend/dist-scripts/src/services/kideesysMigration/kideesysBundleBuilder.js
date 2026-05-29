"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createKideesysProjectId = createKideesysProjectId;
exports.buildKideesysMigrationPreview = buildKideesysMigrationPreview;
const crypto_1 = __importDefault(require("crypto"));
const daSilvaMigrationService_1 = require("../daSilvaMigration/daSilvaMigrationService");
const kideesysHistorical_1 = require("./kideesysHistorical");
const parsers_1 = require("../daSilvaMigration/parsers");
const sasamsParsers_1 = require("../daSilvaMigration/sasamsParsers");
const kideesysSpreadsheet_1 = require("../../utils/kideesysSpreadsheet");
function uniqueLearnersByMatchKey(learners) {
    const map = new Map();
    for (const l of learners) {
        if (!map.has(l.matchKey))
            map.set(l.matchKey, l);
    }
    return Array.from(map.values());
}
function uniqueBillingKeys(items) {
    const keys = new Set();
    for (const item of items)
        keys.add(item.matchKey);
    return Array.from(keys);
}
function buildActiveCountValidation(classLearners, contactCount, billingItems, accounts) {
    const errors = [];
    const classCount = uniqueLearnersByMatchKey(classLearners).length;
    const billingCount = uniqueBillingKeys(billingItems).length;
    if (classCount !== contactCount) {
        errors.push(`Active class list learners (${classCount}) ≠ contact list learners (${contactCount})`);
    }
    if (classCount !== billingCount) {
        errors.push(`Active class list learners (${classCount}) ≠ billing plan learners (${billingCount})`);
    }
    if (contactCount !== billingCount) {
        errors.push(`Contact list learners (${contactCount}) ≠ billing plan learners (${billingCount})`);
    }
    return {
        learnersFromClassList: classCount,
        learnersFromContactList: contactCount,
        learnersFromBillingPlan: billingCount,
        billingAccountsFromAgeAnalysis: accounts.length,
        countsMatch: errors.length === 0,
        errors,
    };
}
function findDuplicateAccounts(accounts) {
    const byNo = new Map();
    for (const a of accounts) {
        const set = byNo.get(a.accountNo) || new Set();
        set.add(a.fullName);
        byNo.set(a.accountNo, set);
    }
    return [...byNo.entries()]
        .filter(([, names]) => names.size > 1)
        .map(([accountNo, names]) => ({ accountNo, names: [...names] }));
}
function findDuplicateActiveLearners(learners) {
    const byKey = new Map();
    let idx = 0;
    for (const l of learners.filter((x) => x.enrollmentTier !== "HISTORICAL")) {
        idx += 1;
        const key = `${(0, kideesysSpreadsheet_1.normalizeMatchText)(l.fullName)}|${l.accountNo}`;
        const rows = byKey.get(key) || [];
        rows.push(idx);
        byKey.set(key, rows);
    }
    return [...byKey.entries()]
        .filter(([, rows]) => rows.length > 1)
        .map(([key, rowIndexes]) => ({
        key,
        label: key,
        rowIndexes,
    }));
}
function createKideesysProjectId() {
    return `kideesys-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function buildKideesysMigrationPreview(opts) {
    const base = (0, daSilvaMigrationService_1.buildDaSilvaMigrationBundle)(opts);
    const { learners: sasamsClassLearners } = (0, sasamsParsers_1.parseSasamsClassListDirectory)(opts.paths.classListDir);
    const classLearners = (0, sasamsParsers_1.sasamsLearnersToParsedLearners)(sasamsClassLearners);
    const contacts = (0, parsers_1.parseContactListFile)(opts.paths.contactList);
    const billingItems = (0, parsers_1.parseBillingPlanFile)(opts.paths.billingPlan);
    const accounts = (0, parsers_1.parseAgeAnalysisFile)(opts.paths.ageAnalysis);
    const transactions = (0, parsers_1.parseTransactionListFile)(opts.paths.transactions);
    const planByKey = new Map();
    for (const item of billingItems) {
        const list = planByKey.get(item.matchKey) || [];
        list.push({ feeDescription: item.feeDescription, amount: item.amount });
        planByKey.set(item.matchKey, list);
    }
    const accountByName = new Map();
    const accountBalanceByNo = new Map();
    for (const a of accounts) {
        accountByName.set((0, kideesysSpreadsheet_1.normalizeMatchText)(a.fullName), a.accountNo);
        accountBalanceByNo.set(a.accountNo, a.balance);
    }
    const activeLearners = base.learners.map((l) => ({
        ...l,
        enrollmentTier: "ACTIVE",
    }));
    const historicalLearners = (0, kideesysHistorical_1.buildHistoricalStagedLearners)({
        activeClassLearners: classLearners,
        accounts,
        billingItems,
        transactions,
        planByKey,
        accountByName,
        accountBalanceByNo,
    });
    const allLearners = [...activeLearners, ...historicalLearners];
    const activeCountValidation = buildActiveCountValidation(classLearners, contacts.length, billingItems, accounts);
    const varianceRows = base.reconciliation.rows.filter((r) => Math.abs(r.variance) > 0.01);
    const maxVariance = varianceRows.reduce((m, r) => Math.max(m, Math.abs(r.variance)), 0);
    const issues = activeCountValidation.errors.map((err, i) => ({
        id: `active-count-${i + 1}`,
        issue: err,
        severity: "error",
        record: "Active learner counts",
        suggestedFix: "Class list is the active source of truth — align contact list and billing plan to current class lists",
        category: "learner",
    }));
    if (historicalLearners.length) {
        issues.push({
            id: "historical-summary",
            issue: `${historicalLearners.length} historical/unenrolled learner(s) will import from billing and transactions (not in class lists)`,
            severity: "info",
            record: "Classification",
            suggestedFix: "Historical learners keep billing history but are excluded from dashboard and class counts",
            category: "learner",
        });
    }
    for (const row of varianceRows.slice(0, 50)) {
        issues.push({
            id: `balance-variance-${row.accountNo}`,
            issue: `Account ${row.accountNo}: age analysis R${row.ageAnalysisBalance.toFixed(2)} vs ledger R${row.ledgerBalanceFromImport.toFixed(2)} (variance R${row.variance.toFixed(2)})`,
            severity: Math.abs(row.variance) > 1 ? "warning" : "info",
            record: row.fullName || row.accountNo,
            suggestedFix: "Balances are derived from transaction history and age analysis — review before apply",
            category: "balance",
        });
    }
    const duplicateLearners = findDuplicateActiveLearners(activeLearners);
    for (const dup of duplicateLearners) {
        issues.push({
            id: `dup-learner-${dup.key}`,
            issue: `Duplicate active learner: ${dup.label}`,
            severity: "error",
            record: dup.label,
            suggestedFix: "Resolve duplicate names in class lists before apply",
            category: "duplicate",
        });
    }
    const duplicateAccounts = findDuplicateAccounts(accounts);
    for (const dup of duplicateAccounts) {
        issues.push({
            id: `dup-account-${dup.accountNo}`,
            issue: `Account ${dup.accountNo} has multiple names in age analysis`,
            severity: "warning",
            record: dup.accountNo,
            suggestedFix: "Verify merged family account mapping",
            category: "duplicate",
        });
    }
    const blockingErrors = activeCountValidation.errors.length + duplicateLearners.length;
    const canStage = blockingErrors === 0;
    const canApply = canStage && activeCountValidation.countsMatch;
    const bundle = {
        ...base,
        source: "kideesys-dasilva",
        learners: allLearners,
        countValidation: activeCountValidation,
        canImport: canApply,
        confirmToken: crypto_1.default
            .createHash("sha256")
            .update(`${opts.projectId}:${canApply}:${activeLearners.length}:${historicalLearners.length}:${transactions.length}`)
            .digest("hex")
            .slice(0, 24),
    };
    const classifications = allLearners.map((l) => ({
        matchKey: l.matchKey,
        fullName: l.fullName,
        accountNo: l.accountNo,
        tier: l.enrollmentTier === "HISTORICAL" ? "HISTORICAL" : "ACTIVE",
        className: l.canonicalClassName,
        ageAnalysisBalance: l.ageAnalysisBalance,
    }));
    return {
        projectId: opts.projectId,
        schoolId: opts.schoolId,
        source: "kideesys",
        createdAt: new Date().toISOString(),
        bundle,
        activeLearnerCount: activeLearners.length,
        historicalLearnerCount: historicalLearners.length,
        classifications,
        issues,
        columnMappings: [
            { slot: "01_transactions", sourceFile: "transaction_list.xls", eduClearTarget: "Ledger + payments + invoices", status: "required" },
            { slot: "02_age_analysis", sourceFile: "account_list age analysis", eduClearTarget: "Opening balances + family accounts", status: "required" },
            { slot: "03_billing_plan", sourceFile: "billing_plan_summary_by_child.xls", eduClearTarget: "Learner fee plans", status: "required" },
            { slot: "04_contact_list", sourceFile: "contact_list.xls", eduClearTarget: "Parents + relationships", status: "required" },
            { slot: "05_class_list", sourceFile: "Grade_*.xls", eduClearTarget: "Active learners + classrooms", status: "required" },
            { slot: "06_employees", sourceFile: "employee_contact_list.xls", eduClearTarget: "Staff directory", status: "required" },
        ],
        duplicateLearners,
        duplicateAccounts,
        balanceValidation: {
            accountsChecked: base.reconciliation.rows.length,
            varianceCount: varianceRows.length,
            maxVariance,
            canImportBalances: varianceRows.every((r) => Math.abs(r.variance) <= 500),
        },
        canStage,
        canApply,
        confirmToken: bundle.confirmToken,
    };
}
