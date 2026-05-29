"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DA_SILVA_PHASE5_BALANCE_GUARDS = exports.DA_SILVA_EXPECTED_HISTORY_ROW_COUNT = void 0;
exports.mapParsedTransactionToHistoryEntry = mapParsedTransactionToHistoryEntry;
exports.buildHistoryEntriesFromTransactions = buildHistoryEntriesFromTransactions;
exports.validateDaSilvaTransactionHistoryImport = validateDaSilvaTransactionHistoryImport;
exports.importDaSilvaTransactionHistory = importDaSilvaTransactionHistory;
const prisma_1 = require("../../prisma");
const billingDisplayRules_1 = require("../../utils/billingDisplayRules");
const kidesysTransactionHistoryStore_1 = require("../../utils/kidesysTransactionHistoryStore");
const billingLedgerStore_1 = require("../../utils/billingLedgerStore");
const statementAccounts_1 = require("../statementAccounts");
const parsers_1 = require("./parsers");
exports.DA_SILVA_EXPECTED_HISTORY_ROW_COUNT = 40916;
exports.DA_SILVA_PHASE5_BALANCE_GUARDS = {
    accounts: 344,
    netOutstanding: 1228655.42,
    overPaid: 490355.03,
};
function round2(n) {
    return Math.round(n * 100) / 100;
}
function historyEntryId(kind, transactionNo, accountNo) {
    return `kidesys-hist-${kind}-${transactionNo}-${accountNo}`;
}
function mapParsedTransactionToHistoryEntry(schoolId, txn, importedAt) {
    const accountNo = String(txn.accountNo || "").trim();
    const journalReference = String(txn.notes || "").trim();
    const description = journalReference || txn.reference;
    return {
        id: historyEntryId(txn.kind, txn.transactionNo, accountNo),
        schoolId,
        accountNo,
        type: txn.kind,
        amount: round2(Math.abs(txn.amount)),
        date: txn.date,
        reference: txn.reference,
        transactionNo: txn.transactionNo,
        description,
        fullName: txn.fullName,
        source: kidesysTransactionHistoryStore_1.KIDESYS_DISPLAY_HISTORY_SOURCE,
        importedAt,
        invoiceNumber: txn.kind === "invoice" ? txn.transactionNo : undefined,
        paymentNumber: txn.kind === "payment" ? txn.transactionNo : undefined,
        journalReference: journalReference || undefined,
        kidesysReference: txn.reference,
        direction: txn.direction,
        sourceFileRow: txn.sourceFileRow,
    };
}
function buildHistoryEntriesFromTransactions(schoolId, transactions, importedAt = new Date().toISOString()) {
    const seen = new Set();
    const entries = [];
    for (const txn of transactions) {
        const entry = mapParsedTransactionToHistoryEntry(schoolId, txn, importedAt);
        if (seen.has(entry.id))
            continue;
        seen.add(entry.id);
        entries.push(entry);
    }
    return entries;
}
function schoolLedgerBalanceTotal(ledger) {
    const accounts = new Set();
    for (const e of ledger) {
        const ref = String(e.accountNo || "").trim();
        if (ref)
            accounts.add(ref);
    }
    let total = 0;
    for (const accountNo of accounts) {
        const scoped = ledger.filter((e) => String(e.accountNo || "").trim() === accountNo);
        total += (0, billingLedgerStore_1.calculateBalanceFromEntries)(scoped);
    }
    return round2(total);
}
/** Validate phase 5 import without mutating ledger balances. */
async function validateDaSilvaTransactionHistoryImport(opts) {
    const errors = [];
    const schoolId = String(opts.schoolId || "").trim();
    const ledgerBefore = (0, billingLedgerStore_1.readSchoolLedger)(schoolId);
    const ledgerBeforeCount = ledgerBefore.length;
    const ledgerBalanceBefore = schoolLedgerBalanceTotal(ledgerBefore);
    const parsed = (0, parsers_1.parseTransactionListFile)(opts.transactionsPath);
    const proposed = opts.proposedHistory ??
        buildHistoryEntriesFromTransactions(schoolId, parsed, new Date().toISOString());
    const idSet = new Set();
    let duplicateIds = 0;
    for (const e of proposed) {
        if (idSet.has(e.id))
            duplicateIds += 1;
        idSet.add(e.id);
    }
    const familyAccounts = await prisma_1.prisma.familyAccount.findMany({
        where: { schoolId },
        select: { accountRef: true },
    });
    const familyRefs = new Set(familyAccounts.map((a) => String(a.accountRef || "").trim()).filter(Boolean));
    const historyAccounts = new Set(proposed.map((e) => String(e.accountNo || "").trim()).filter(Boolean));
    const unlinkedAccountNos = [...historyAccounts].filter((a) => !familyRefs.has(a)).sort();
    const familyAccountsMissingHistory = [...familyRefs]
        .filter((ref) => !historyAccounts.has(ref))
        .sort();
    if (familyAccountsMissingHistory.length) {
        errors.push(`${familyAccountsMissingHistory.length} active family account(s) have no Kid-e-Sys history: ${familyAccountsMissingHistory.slice(0, 20).join(", ")}`);
    }
    const accountsAfter = await (0, statementAccounts_1.buildAccountsFromLearners)(schoolId, ledgerBefore, proposed);
    const ledgerAfter = (0, billingLedgerStore_1.readSchoolLedger)(schoolId);
    const ledgerBalanceAfter = schoolLedgerBalanceTotal(ledgerAfter);
    const netOutstanding = round2(accountsAfter.reduce((sum, row) => sum + Number(row.balance), 0));
    const overPaid = round2(Math.abs(accountsAfter
        .filter((row) => Number(row.balance) < 0)
        .reduce((sum, row) => sum + Number(row.balance), 0)));
    const historyIndex = (0, kidesysTransactionHistoryStore_1.buildKidesysHistoryAccountIndex)(proposed);
    let accountsWithHistoryLastInvoice = 0;
    let accountsWithHistoryLastPayment = 0;
    for (const row of accountsAfter) {
        const summary = historyIndex.get(String(row.accountNo || "").trim());
        if (summary?.lastInvoice)
            accountsWithHistoryLastInvoice += 1;
        if (summary?.lastPayment)
            accountsWithHistoryLastPayment += 1;
    }
    const accountsWithOpeningBalanceLabel = accountsAfter.filter((a) => (0, billingDisplayRules_1.isMigratedOpeningBalanceOverviewLabel)(a.lastInvoiceLabel)).length;
    const rowCountMatch = parsed.length === exports.DA_SILVA_EXPECTED_HISTORY_ROW_COUNT;
    if (!rowCountMatch) {
        errors.push(`Expected ${exports.DA_SILVA_EXPECTED_HISTORY_ROW_COUNT} parsed rows, got ${parsed.length}`);
    }
    if (proposed.length !== parsed.length) {
        errors.push(`Deduplicated history count ${proposed.length} ≠ parsed ${parsed.length}`);
    }
    if (duplicateIds > 0) {
        errors.push(`${duplicateIds} duplicate history id(s)`);
    }
    const accountsMatch = accountsAfter.length === exports.DA_SILVA_PHASE5_BALANCE_GUARDS.accounts;
    if (!accountsMatch) {
        errors.push(`Expected ${exports.DA_SILVA_PHASE5_BALANCE_GUARDS.accounts} statement rows, got ${accountsAfter.length}`);
    }
    const netOutstandingMatch = Math.abs(netOutstanding - exports.DA_SILVA_PHASE5_BALANCE_GUARDS.netOutstanding) < 0.02;
    if (!netOutstandingMatch) {
        errors.push(`Net outstanding R${netOutstanding} ≠ expected R${exports.DA_SILVA_PHASE5_BALANCE_GUARDS.netOutstanding}`);
    }
    const overPaidMatch = Math.abs(overPaid - exports.DA_SILVA_PHASE5_BALANCE_GUARDS.overPaid) < 0.02;
    if (!overPaidMatch) {
        errors.push(`Overpaid R${overPaid} ≠ expected R${exports.DA_SILVA_PHASE5_BALANCE_GUARDS.overPaid}`);
    }
    const ledgerEntryCountUnchanged = ledgerAfter.length === ledgerBeforeCount;
    if (!ledgerEntryCountUnchanged) {
        errors.push(`Ledger entry count changed ${ledgerBeforeCount} → ${ledgerAfter.length}`);
    }
    const ledgerBalanceUnchanged = Math.abs(ledgerBalanceAfter - ledgerBalanceBefore) < 0.02;
    if (!ledgerBalanceUnchanged) {
        errors.push(`Ledger balance total changed R${ledgerBalanceBefore} → R${ledgerBalanceAfter}`);
    }
    // History must not be written into billing ledger
    const historyInLedger = ledgerAfter.some((e) => String(e.source || "") === kidesysTransactionHistoryStore_1.KIDESYS_DISPLAY_HISTORY_SOURCE);
    const doubleCountingRisk = historyInLedger;
    if (doubleCountingRisk) {
        errors.push("Billing ledger contains kidesys_display_history rows (double-counting risk)");
    }
    const passed = errors.length === 0 &&
        rowCountMatch &&
        accountsMatch &&
        netOutstandingMatch &&
        overPaidMatch &&
        ledgerEntryCountUnchanged &&
        ledgerBalanceUnchanged &&
        !doubleCountingRisk;
    return {
        schoolId,
        dryRun: opts.dryRun,
        parsedRowCount: parsed.length,
        expectedRowCount: exports.DA_SILVA_EXPECTED_HISTORY_ROW_COUNT,
        rowCountMatch,
        historyEntryCount: proposed.length,
        duplicateIds,
        distinctAccountsInHistory: historyAccounts.size,
        familyAccountsInDb: familyRefs.size,
        unlinkedAccountNos: unlinkedAccountNos.slice(0, 50),
        unlinkedAccountCount: unlinkedAccountNos.length,
        familyAccountsMissingHistory: familyAccountsMissingHistory.slice(0, 50),
        familyAccountsMissingHistoryCount: familyAccountsMissingHistory.length,
        accounts: accountsAfter.length,
        expectedAccounts: exports.DA_SILVA_PHASE5_BALANCE_GUARDS.accounts,
        accountsMatch,
        netOutstanding,
        expectedNetOutstanding: exports.DA_SILVA_PHASE5_BALANCE_GUARDS.netOutstanding,
        netOutstandingMatch,
        overPaid,
        expectedOverPaid: exports.DA_SILVA_PHASE5_BALANCE_GUARDS.overPaid,
        overPaidMatch,
        ledgerEntryCount: ledgerAfter.length,
        ledgerEntryCountUnchanged,
        ledgerBalanceBefore,
        ledgerBalanceAfter,
        ledgerBalanceUnchanged,
        accountsWithHistoryLastInvoice,
        accountsWithHistoryLastPayment,
        accountsWithOpeningBalanceLabel,
        doubleCountingRisk,
        passed,
        errors,
    };
}
async function importDaSilvaTransactionHistory(opts) {
    const schoolId = String(opts.schoolId || "").trim();
    const parsed = (0, parsers_1.parseTransactionListFile)(opts.transactionsPath);
    const entries = buildHistoryEntriesFromTransactions(schoolId, parsed);
    const validation = await validateDaSilvaTransactionHistoryImport({
        schoolId,
        transactionsPath: opts.transactionsPath,
        dryRun: opts.dryRun,
        proposedHistory: entries,
    });
    if (!opts.dryRun && validation.passed) {
        (0, kidesysTransactionHistoryStore_1.writeSchoolKidesysHistory)(schoolId, entries);
    }
    return validation;
}
