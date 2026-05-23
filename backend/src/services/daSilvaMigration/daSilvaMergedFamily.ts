import {
  normalizeMatchText,
  parseKideesysSpreadsheetFile,
} from "../../utils/kideesysSpreadsheet";
import type {
  ParsedBillingAccount,
  ParsedBillingPlanItem,
  ParsedLearner,
  ParsedLearnerContact,
  ParsedTransaction,
} from "./parsers";

/** Kid-e-Sys age analysis lists merged siblings on one line separated by newlines. */
export function splitMergedAccountNames(fullName: string): string[] {
  return String(fullName || "")
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type FamilyAccountIndex = {
  learnerNameToAccount: Map<string, string>;
  accountToLearnerNames: Map<string, Set<string>>;
};

export function addLearnerToFamilyIndex(
  index: FamilyAccountIndex,
  accountNo: string,
  fullName: string
): void {
  if (!accountNo || !fullName) return;
  const key = normalizeMatchText(fullName);
  index.learnerNameToAccount.set(key, accountNo);
  const set = index.accountToLearnerNames.get(accountNo) || new Set<string>();
  set.add(key);
  index.accountToLearnerNames.set(accountNo, set);
}

function parentGroupKey(parents: ParsedLearnerContact["parents"]): string {
  const cells = parents
    .map((p) => String(p.cellNo || "").replace(/\s/g, ""))
    .filter(Boolean)
    .sort();
  if (!cells.length) return "";
  const surnames = parents
    .map((p) => normalizeMatchText(p.surname || ""))
    .filter(Boolean);
  return `${cells.join("|")}|${surnames.join("|")}`;
}

/** Kid-e-Sys Sibling Accounts export: Account No, learner count, semicolon-separated names. */
export function parseSiblingAccountsFile(filePath: string): Set<string> {
  const sheet = parseKideesysSpreadsheetFile(filePath);
  const merged = new Set<string>();
  const accountRe = /^[A-Z]{3}\d{3}$/;

  for (const row of sheet.rows) {
    const cells = row.map((c) => String(c ?? "").trim()).filter(Boolean);
    if (!cells.length) continue;

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

    if (!accountNo && accountRe.test(cells[0])) accountNo = cells[0];
    if (!accountNo) continue;

    const names = namesCell
      ? namesCell.split(/;/).map((s) => s.trim()).filter(Boolean)
      : splitMergedAccountNames(namesCell);

    if (learnerCount >= 2 || names.length >= 2) {
      merged.add(accountNo);
    }
  }

  return merged;
}

export function findAccountForLearnerName(
  fullName: string,
  accounts: ParsedBillingAccount[],
  index: FamilyAccountIndex
): string {
  const key = normalizeMatchText(fullName);
  const direct = index.learnerNameToAccount.get(key);
  if (direct) return direct;

  for (const account of accounts) {
    const merged = splitMergedAccountNames(account.fullName);
    if (merged.some((n) => normalizeMatchText(n) === key)) {
      return account.accountNo;
    }
  }
  return "";
}

function deriveSiblingAccountsFromContactParents(
  contacts: ParsedLearnerContact[],
  accounts: ParsedBillingAccount[],
  index: FamilyAccountIndex
): Set<string> {
  const byParent = new Map<string, ParsedLearnerContact[]>();

  for (const contact of contacts) {
    const key = parentGroupKey(contact.parents);
    if (!key) continue;
    const list = byParent.get(key) || [];
    list.push(contact);
    byParent.set(key, list);
  }

  const merged = new Set<string>();
  for (const group of byParent.values()) {
    if (group.length < 2) continue;
    const accountNos = new Set<string>();
    for (const child of group) {
      const accountNo = findAccountForLearnerName(child.fullName, accounts, index);
      if (accountNo) accountNos.add(accountNo);
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
function isConsolidatedSingleLearnerOverPaidFamily(
  account: ParsedBillingAccount,
  txnSum: number,
  activeLearnerCount: number
): boolean {
  if (account.section !== "Over Paid") return false;
  if (activeLearnerCount < 1) return false;
  return Math.abs(account.balance - txnSum) > 0.01;
}

export type BuildMergedFamilyAccountSetInput = {
  accounts: ParsedBillingAccount[];
  index: FamilyAccountIndex;
  classLearners: ParsedLearner[];
  contacts: ParsedLearnerContact[];
  txnSumByAccount: Map<string, number>;
  siblingAccountNos?: Set<string>;
};

/** Accounts that must be reconciled as merged family ledgers (not per active learner only). */
export function buildMergedFamilyAccountSet(
  input: BuildMergedFamilyAccountSetInput
): Set<string> {
  const merged = new Set<string>(input.siblingAccountNos || []);

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

  for (const accountNo of deriveSiblingAccountsFromContactParents(
    input.contacts,
    input.accounts,
    input.index
  )) {
    merged.add(accountNo);
  }

  const activeLearnersByAccount = new Map<string, number>();
  for (const learner of input.classLearners) {
    const accountNo = findAccountForLearnerName(learner.fullName, input.accounts, input.index);
    if (!accountNo) continue;
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

export function isMergedFamilyAccount(
  accountNo: string,
  account: ParsedBillingAccount | undefined,
  index: FamilyAccountIndex,
  mergedAccountNos: Set<string>,
  activeLearnerCount: number,
  txnSum: number
): boolean {
  if (mergedAccountNos.has(accountNo)) return true;
  if (account && splitMergedAccountNames(account.fullName).length > 1) return true;
  if ((index.accountToLearnerNames.get(accountNo)?.size ?? 0) > 1) return true;
  if (account && isConsolidatedSingleLearnerOverPaidFamily(account, txnSum, activeLearnerCount)) {
    return true;
  }
  return false;
}

export function hasSilentBillingSibling(
  accountNo: string,
  index: FamilyAccountIndex,
  transactions: ParsedTransaction[]
): boolean {
  const learners = index.accountToLearnerNames.get(accountNo);
  if (!learners || learners.size < 2) return false;

  let withNamedTxns = 0;
  for (const nameKey of learners) {
    const hasTxn = transactions.some((t) => {
      const mapped = index.learnerNameToAccount.get(normalizeMatchText(t.fullName));
      const familyAccountNo = mapped || String(t.accountNo || "").trim();
      return normalizeMatchText(t.fullName) === nameKey && familyAccountNo === accountNo;
    });
    if (hasTxn) withNamedTxns++;
  }
  return withNamedTxns > 0 && withNamedTxns < learners.size;
}

/**
 * When Kid-e-Sys keeps a merged family balance, prefer age analysis if the transaction
 * export does not fully represent all siblings (including unenrolled).
 */
export function computeFamilyLedgerBalance(
  account: ParsedBillingAccount,
  txnSum: number,
  index: FamilyAccountIndex,
  transactions: ParsedTransaction[],
  mergedAccountNos: Set<string>,
  activeLearnerCount: number
): number {
  const merged = isMergedFamilyAccount(
    account.accountNo,
    account,
    index,
    mergedAccountNos,
    activeLearnerCount,
    txnSum
  );

  if (!merged) {
    return txnSum;
  }

  if (Math.abs(txnSum - account.balance) <= 0.01) {
    return txnSum;
  }

  if (
    hasSilentBillingSibling(account.accountNo, index, transactions) ||
    isConsolidatedSingleLearnerOverPaidFamily(account, txnSum, activeLearnerCount)
  ) {
    return account.balance;
  }

  if (mergedAccountNos.has(account.accountNo)) {
    return account.balance;
  }

  return txnSum;
}

export function countActiveLearnersPerAccount(
  classLearners: ParsedLearner[],
  accounts: ParsedBillingAccount[],
  index: FamilyAccountIndex
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const learner of classLearners) {
    const accountNo = findAccountForLearnerName(learner.fullName, accounts, index);
    if (!accountNo) continue;
    counts.set(accountNo, (counts.get(accountNo) || 0) + 1);
  }
  return counts;
}

export function indexHistoricalLearners(
  accounts: ParsedBillingAccount[],
  billingItems: ParsedBillingPlanItem[],
  classLearners: ParsedLearner[],
  contacts: ParsedLearnerContact[],
  transactions: ParsedTransaction[],
  index: FamilyAccountIndex
): void {
  for (const account of accounts) {
    const names = splitMergedAccountNames(account.fullName);
    const list = names.length ? names : [account.fullName];
    for (const name of list) {
      addLearnerToFamilyIndex(index, account.accountNo, name);
    }
  }

  for (const item of billingItems) {
    const accountNo = findAccountForLearnerName(item.fullName, accounts, index);
    if (accountNo) addLearnerToFamilyIndex(index, accountNo, item.fullName);
  }

  for (const learner of classLearners) {
    const accountNo = findAccountForLearnerName(learner.fullName, accounts, index);
    if (accountNo) addLearnerToFamilyIndex(index, accountNo, learner.fullName);
  }

  for (const contact of contacts) {
    const accountNo = findAccountForLearnerName(contact.fullName, accounts, index);
    if (accountNo) addLearnerToFamilyIndex(index, accountNo, contact.fullName);
  }

  for (const txn of transactions) {
    if (!txn.accountNo || !txn.fullName) continue;
    const mapped = findAccountForLearnerName(txn.fullName, accounts, index);
    const accountNo = mapped || txn.accountNo;
    addLearnerToFamilyIndex(index, accountNo, txn.fullName);
  }
}
