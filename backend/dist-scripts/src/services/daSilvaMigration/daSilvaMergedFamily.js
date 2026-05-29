"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitMergedAccountNames = splitMergedAccountNames;
exports.addLearnerToFamilyIndex = addLearnerToFamilyIndex;
exports.parseSiblingAccountsFile = parseSiblingAccountsFile;
exports.findAccountForLearnerName = findAccountForLearnerName;
exports.buildMergedFamilyAccountSet = buildMergedFamilyAccountSet;
exports.isMergedFamilyAccount = isMergedFamilyAccount;
exports.hasSilentBillingSibling = hasSilentBillingSibling;
exports.computeFamilyLedgerBalance = computeFamilyLedgerBalance;
exports.countActiveLearnersPerAccount = countActiveLearnersPerAccount;
exports.indexHistoricalLearners = indexHistoricalLearners;
const kideesysSpreadsheet_1 = require("../../utils/kideesysSpreadsheet");
/** Kid-e-Sys age analysis lists merged siblings on one line separated by newlines. */
function splitMergedAccountNames(fullName) {
    return String(fullName || "")
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean);
}
function addLearnerToFamilyIndex(index, accountNo, fullName) {
    if (!accountNo || !fullName)
        return;
    const key = (0, kideesysSpreadsheet_1.normalizeMatchText)(fullName);
    index.learnerNameToAccount.set(key, accountNo);
    const set = index.accountToLearnerNames.get(accountNo) || new Set();
    set.add(key);
    index.accountToLearnerNames.set(accountNo, set);
}
function parentGroupKey(parents) {
    const cells = parents
        .map((p) => String(p.cellNo || "").replace(/\s/g, ""))
        .filter(Boolean)
        .sort();
    if (!cells.length)
        return "";
    const surnames = parents
        .map((p) => (0, kideesysSpreadsheet_1.normalizeMatchText)(p.surname || ""))
        .filter(Boolean);
    return `${cells.join("|")}|${surnames.join("|")}`;
}
/** Kid-e-Sys Sibling Accounts export: Account No, learner count, semicolon-separated names. */
function parseSiblingAccountsFile(filePath) {
    const sheet = (0, kideesysSpreadsheet_1.parseKideesysSpreadsheetFile)(filePath);
    const merged = new Set();
    const accountRe = /^[A-Z]{3}\d{3}$/;
    for (const row of sheet.rows) {
        const cells = row.map((c) => String(c ?? "").trim()).filter(Boolean);
        if (!cells.length)
            continue;
        let accountNo = "";
        let learnerCount = 0;
        let namesCell = "";
        for (const cell of cells) {
            if (accountRe.test(cell)) {
                accountNo = cell;
                continue;
            }
            if (/^\d+$/.test(cell)) {
                learnerCount = Number(cell);
                continue;
            }
            if (cell.includes(";") || cell.split(/\s+/).length >= 4) {
                namesCell = cell;
            }
        }
        if (!accountNo && accountRe.test(cells[0]))
            accountNo = cells[0];
        if (!accountNo)
            continue;
        const names = namesCell
            ? namesCell.split(/;/).map((s) => s.trim()).filter(Boolean)
            : splitMergedAccountNames(namesCell);
        if (learnerCount >= 2 || names.length >= 2) {
            merged.add(accountNo);
        }
    }
    return merged;
}
function findAccountForLearnerName(fullName, accounts, index) {
    const key = (0, kideesysSpreadsheet_1.normalizeMatchText)(fullName);
    const direct = index.learnerNameToAccount.get(key);
    if (direct)
        return direct;
    for (const account of accounts) {
        const merged = splitMergedAccountNames(account.fullName);
        if (merged.some((n) => (0, kideesysSpreadsheet_1.normalizeMatchText)(n) === key)) {
            return account.accountNo;
        }
    }
    return "";
}
function deriveSiblingAccountsFromContactParents(contacts, accounts, index) {
    const byParent = new Map();
    for (const contact of contacts) {
        const key = parentGroupKey(contact.parents);
        if (!key)
            continue;
        const list = byParent.get(key) || [];
        list.push(contact);
        byParent.set(key, list);
    }
    const merged = new Set();
    for (const group of byParent.values()) {
        if (group.length < 2)
            continue;
        const accountNos = new Set();
        for (const child of group) {
            const accountNo = findAccountForLearnerName(child.fullName, accounts, index);
            if (accountNo)
                accountNos.add(accountNo);
        }
        if (accountNos.size === 1) {
            merged.add([...accountNos][0]);
        }
    }
    return merged;
}
/**
 * Kid-e-Sys keeps a shared family balance on one account when a sibling is unenrolled
 * but not unmerged. The export often shows one active learner while age analysis holds
 * the consolidated (e.g. overpaid) family total.
 */
function isConsolidatedSingleLearnerOverPaidFamily(account, txnSum, activeLearnerCount) {
    if (account.section !== "Over Paid")
        return false;
    if (activeLearnerCount < 1)
        return false;
    return Math.abs(account.balance - txnSum) > 0.01;
}
/** Accounts that must be reconciled as merged family ledgers (not per active learner only). */
function buildMergedFamilyAccountSet(input) {
    const merged = new Set(input.siblingAccountNos || []);
    for (const account of input.accounts) {
        if (splitMergedAccountNames(account.fullName).length > 1) {
            merged.add(account.accountNo);
        }
    }
    for (const [accountNo, learners] of input.index.accountToLearnerNames) {
        if (learners.size > 1) {
            merged.add(accountNo);
        }
    }
    for (const accountNo of deriveSiblingAccountsFromContactParents(input.contacts, input.accounts, input.index)) {
        merged.add(accountNo);
    }
    const activeLearnersByAccount = new Map();
    for (const learner of input.classLearners) {
        const accountNo = findAccountForLearnerName(learner.fullName, input.accounts, input.index);
        if (!accountNo)
            continue;
        activeLearnersByAccount.set(accountNo, (activeLearnersByAccount.get(accountNo) || 0) + 1);
    }
    for (const account of input.accounts) {
        const activeCount = activeLearnersByAccount.get(account.accountNo) || 0;
        const txnSum = input.txnSumByAccount.get(account.accountNo) ?? 0;
        if (isConsolidatedSingleLearnerOverPaidFamily(account, txnSum, activeCount)) {
            merged.add(account.accountNo);
        }
    }
    return merged;
}
function isMergedFamilyAccount(accountNo, account, index, mergedAccountNos, activeLearnerCount, txnSum) {
    if (mergedAccountNos.has(accountNo))
        return true;
    if (account && splitMergedAccountNames(account.fullName).length > 1)
        return true;
    if ((index.accountToLearnerNames.get(accountNo)?.size ?? 0) > 1)
        return true;
    if (account && isConsolidatedSingleLearnerOverPaidFamily(account, txnSum, activeLearnerCount)) {
        return true;
    }
    return false;
}
function hasSilentBillingSibling(accountNo, index, transactions) {
    const learners = index.accountToLearnerNames.get(accountNo);
    if (!learners || learners.size < 2)
        return false;
    let withNamedTxns = 0;
    for (const nameKey of learners) {
        const hasTxn = transactions.some((t) => {
            const mapped = index.learnerNameToAccount.get((0, kideesysSpreadsheet_1.normalizeMatchText)(t.fullName));
            const familyAccountNo = mapped || String(t.accountNo || "").trim();
            return (0, kideesysSpreadsheet_1.normalizeMatchText)(t.fullName) === nameKey && familyAccountNo === accountNo;
        });
        if (hasTxn)
            withNamedTxns++;
    }
    return withNamedTxns > 0 && withNamedTxns < learners.size;
}
/**
 * When Kid-e-Sys keeps a merged family balance, prefer age analysis if the transaction
 * export does not fully represent all siblings (including unenrolled).
 */
function computeFamilyLedgerBalance(account, txnSum, index, transactions, mergedAccountNos, activeLearnerCount) {
    const merged = isMergedFamilyAccount(account.accountNo, account, index, mergedAccountNos, activeLearnerCount, txnSum);
    if (!merged) {
        return txnSum;
    }
    if (Math.abs(txnSum - account.balance) <= 0.01) {
        return txnSum;
    }
    if (hasSilentBillingSibling(account.accountNo, index, transactions) ||
        isConsolidatedSingleLearnerOverPaidFamily(account, txnSum, activeLearnerCount)) {
        return account.balance;
    }
    if (mergedAccountNos.has(account.accountNo)) {
        return account.balance;
    }
    return txnSum;
}
function countActiveLearnersPerAccount(classLearners, accounts, index) {
    const counts = new Map();
    for (const learner of classLearners) {
        const accountNo = findAccountForLearnerName(learner.fullName, accounts, index);
        if (!accountNo)
            continue;
        counts.set(accountNo, (counts.get(accountNo) || 0) + 1);
    }
    return counts;
}
function indexHistoricalLearners(accounts, billingItems, classLearners, contacts, transactions, index) {
    for (const account of accounts) {
        const names = splitMergedAccountNames(account.fullName);
        const list = names.length ? names : [account.fullName];
        for (const name of list) {
            addLearnerToFamilyIndex(index, account.accountNo, name);
        }
    }
    for (const item of billingItems) {
        const accountNo = findAccountForLearnerName(item.fullName, accounts, index);
        if (accountNo)
            addLearnerToFamilyIndex(index, accountNo, item.fullName);
    }
    for (const learner of classLearners) {
        const accountNo = findAccountForLearnerName(learner.fullName, accounts, index);
        if (accountNo)
            addLearnerToFamilyIndex(index, accountNo, learner.fullName);
    }
    for (const contact of contacts) {
        const accountNo = findAccountForLearnerName(contact.fullName, accounts, index);
        if (accountNo)
            addLearnerToFamilyIndex(index, accountNo, contact.fullName);
    }
    for (const txn of transactions) {
        if (!txn.accountNo || !txn.fullName)
            continue;
        const mapped = findAccountForLearnerName(txn.fullName, accounts, index);
        const accountNo = mapped || txn.accountNo;
        addLearnerToFamilyIndex(index, accountNo, txn.fullName);
    }
}
