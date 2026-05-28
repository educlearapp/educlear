import { normalizeMatchText, splitFullName } from "../../utils/kideesysSpreadsheet";
import {
  buildLearnerMatchKey,
  type ParsedBillingAccount,
  type ParsedBillingPlanItem,
  type ParsedLearner,
  type ParsedTransaction,
} from "../daSilvaMigration/parsers";
import { splitMergedAccountNames } from "../daSilvaMigration/daSilvaMergedFamily";
import type { DaSilvaStagedLearner } from "../daSilvaMigration/daSilvaMigrationService";
import type { StoredBillingPlanItem } from "../../utils/learnerBillingPlanStore";

const HISTORICAL_CLASS_LABEL = "Historical / Unenrolled";

function normNameKey(name: string): string {
  return normalizeMatchText(name).replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function activeNameKeys(activeLearners: ParsedLearner[]): Set<string> {
  const keys = new Set<string>();
  for (const l of activeLearners) {
    keys.add(normalizeMatchText(l.fullName));
    keys.add(normNameKey(l.fullName));
    keys.add(l.matchKey);
  }
  return keys;
}

function isActiveName(fullName: string, activeKeys: Set<string>): boolean {
  const n = normalizeMatchText(fullName);
  const nk = normNameKey(fullName);
  return activeKeys.has(n) || activeKeys.has(nk);
}

export type HistoricalNameCandidate = {
  fullName: string;
  accountNo: string;
  source: "age_analysis" | "billing_plan" | "transaction";
};

function collectHistoricalCandidates(
  activeKeys: Set<string>,
  accounts: ParsedBillingAccount[],
  billingItems: ParsedBillingPlanItem[],
  transactions: ParsedTransaction[]
): Map<string, HistoricalNameCandidate> {
  const map = new Map<string, HistoricalNameCandidate>();

  const add = (fullName: string, accountNo: string, source: HistoricalNameCandidate["source"]) => {
    const name = String(fullName || "").trim();
    const acc = String(accountNo || "").trim();
    if (!name || isActiveName(name, activeKeys)) return;
    const key = `${acc}|${normNameKey(name)}`;
    if (!map.has(key)) {
      map.set(key, { fullName: name, accountNo: acc, source });
    }
  };

  for (const account of accounts) {
    const names = splitMergedAccountNames(account.fullName);
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

export function buildHistoricalStagedLearners(opts: {
  activeClassLearners: ParsedLearner[];
  accounts: ParsedBillingAccount[];
  billingItems: ParsedBillingPlanItem[];
  transactions: ParsedTransaction[];
  planByKey: Map<string, StoredBillingPlanItem[]>;
  accountByName: Map<string, string>;
  accountBalanceByNo: Map<string, number>;
}): DaSilvaStagedLearner[] {
  const uniqueActive = new Map<string, ParsedLearner>();
  for (const l of opts.activeClassLearners) {
    if (!uniqueActive.has(l.matchKey)) uniqueActive.set(l.matchKey, l);
  }
  const activeKeys = activeNameKeys([...uniqueActive.values()]);
  const candidates = collectHistoricalCandidates(
    activeKeys,
    opts.accounts,
    opts.billingItems,
    opts.transactions
  );

  const staged: DaSilvaStagedLearner[] = [];

  for (const candidate of candidates.values()) {
    const { firstName, lastName } = splitFullName(candidate.fullName);
    let accountNo = candidate.accountNo;
    if (!accountNo) {
      accountNo =
        opts.accountByName.get(normalizeMatchText(candidate.fullName)) ||
        "";
    }
    const matchKey = `historical|${accountNo}|${normNameKey(candidate.fullName)}`;
    const billingPlan = opts.planByKey.get(
      buildLearnerMatchKey(candidate.fullName, HISTORICAL_CLASS_LABEL)
    ) || [];

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
