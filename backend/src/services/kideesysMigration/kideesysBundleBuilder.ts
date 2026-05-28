import crypto from "crypto";
import {
  buildDaSilvaMigrationBundle,
  type DaSilvaCountValidation,
  type DaSilvaIngestPaths,
  type DaSilvaMigrationBundle,
  type DaSilvaStagedLearner,
} from "../daSilvaMigration/daSilvaMigrationService";
import { buildHistoricalStagedLearners } from "./kideesysHistorical";
import {
  parseAgeAnalysisFile,
  parseBillingPlanFile,
  parseContactListFile,
  parseTransactionListFile,
  type ParsedBillingAccount,
  type ParsedBillingPlanItem,
  type ParsedLearner,
} from "../daSilvaMigration/parsers";
import {
  parseSasamsClassListDirectory,
  sasamsLearnersToParsedLearners,
} from "../daSilvaMigration/sasamsParsers";
import { normalizeMatchText } from "../../utils/kideesysSpreadsheet";
import type { StoredBillingPlanItem } from "../../utils/learnerBillingPlanStore";

export type KideesysMigrationIssue = {
  id: string;
  issue: string;
  severity: "error" | "warning" | "info";
  record: string;
  suggestedFix: string;
  category: "upload" | "mapping" | "learner" | "balance" | "duplicate";
};

export type KideesysLearnerClassification = {
  matchKey: string;
  fullName: string;
  accountNo: string;
  tier: "ACTIVE" | "HISTORICAL";
  className: string;
  ageAnalysisBalance: number;
};

export type KideesysMigrationPreview = {
  projectId: string;
  schoolId: string;
  source: "kideesys";
  createdAt: string;
  bundle: DaSilvaMigrationBundle;
  activeLearnerCount: number;
  historicalLearnerCount: number;
  classifications: KideesysLearnerClassification[];
  issues: KideesysMigrationIssue[];
  columnMappings: Array<{
    slot: string;
    sourceFile: string;
    eduClearTarget: string;
    status: "mapped" | "required" | "optional";
  }>;
  duplicateLearners: Array<{ key: string; label: string; rowIndexes: number[] }>;
  duplicateAccounts: Array<{ accountNo: string; names: string[] }>;
  balanceValidation: {
    accountsChecked: number;
    varianceCount: number;
    maxVariance: number;
    canImportBalances: boolean;
  };
  canStage: boolean;
  canApply: boolean;
  confirmToken: string;
};

function uniqueLearnersByMatchKey(learners: ParsedLearner[]): ParsedLearner[] {
  const map = new Map<string, ParsedLearner>();
  for (const l of learners) {
    if (!map.has(l.matchKey)) map.set(l.matchKey, l);
  }
  return Array.from(map.values());
}

function uniqueBillingKeys(items: ParsedBillingPlanItem[]): string[] {
  const keys = new Set<string>();
  for (const item of items) keys.add(item.matchKey);
  return Array.from(keys);
}

function buildActiveCountValidation(
  classLearners: ParsedLearner[],
  contactCount: number,
  billingItems: ParsedBillingPlanItem[],
  accounts: ParsedBillingAccount[]
): DaSilvaCountValidation {
  const errors: string[] = [];
  const classCount = uniqueLearnersByMatchKey(classLearners).length;
  const billingCount = uniqueBillingKeys(billingItems).length;

  if (classCount !== contactCount) {
    errors.push(
      `Active class list learners (${classCount}) ≠ contact list learners (${contactCount})`
    );
  }
  if (classCount !== billingCount) {
    errors.push(
      `Active class list learners (${classCount}) ≠ billing plan learners (${billingCount})`
    );
  }
  if (contactCount !== billingCount) {
    errors.push(
      `Contact list learners (${contactCount}) ≠ billing plan learners (${billingCount})`
    );
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

function findDuplicateAccounts(accounts: ParsedBillingAccount[]): KideesysMigrationPreview["duplicateAccounts"] {
  const byNo = new Map<string, Set<string>>();
  for (const a of accounts) {
    const set = byNo.get(a.accountNo) || new Set();
    set.add(a.fullName);
    byNo.set(a.accountNo, set);
  }
  return [...byNo.entries()]
    .filter(([, names]) => names.size > 1)
    .map(([accountNo, names]) => ({ accountNo, names: [...names] }));
}

function findDuplicateActiveLearners(
  learners: DaSilvaStagedLearner[]
): KideesysMigrationPreview["duplicateLearners"] {
  const byKey = new Map<string, number[]>();
  let idx = 0;
  for (const l of learners.filter((x) => x.enrollmentTier !== "HISTORICAL")) {
    idx += 1;
    const key = `${normalizeMatchText(l.fullName)}|${l.accountNo}`;
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

export function createKideesysProjectId(): string {
  return `kideesys-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildKideesysMigrationPreview(opts: {
  schoolId: string;
  projectId: string;
  paths: DaSilvaIngestPaths;
}): KideesysMigrationPreview {
  const base = buildDaSilvaMigrationBundle(opts);
  const { learners: sasamsClassLearners } = parseSasamsClassListDirectory(opts.paths.classListDir);
  const classLearners = sasamsLearnersToParsedLearners(sasamsClassLearners);
  const contacts = parseContactListFile(opts.paths.contactList);
  const billingItems = parseBillingPlanFile(opts.paths.billingPlan);
  const accounts = parseAgeAnalysisFile(opts.paths.ageAnalysis);
  const transactions = parseTransactionListFile(opts.paths.transactions);

  const planByKey = new Map<string, StoredBillingPlanItem[]>();
  for (const item of billingItems) {
    const list = planByKey.get(item.matchKey) || [];
    list.push({ feeDescription: item.feeDescription, amount: item.amount });
    planByKey.set(item.matchKey, list);
  }
  const accountByName = new Map<string, string>();
  const accountBalanceByNo = new Map<string, number>();
  for (const a of accounts) {
    accountByName.set(normalizeMatchText(a.fullName), a.accountNo);
    accountBalanceByNo.set(a.accountNo, a.balance);
  }

  const activeLearners: DaSilvaStagedLearner[] = base.learners.map((l) => ({
    ...l,
    enrollmentTier: "ACTIVE" as const,
  }));

  const historicalLearners = buildHistoricalStagedLearners({
    activeClassLearners: classLearners,
    accounts,
    billingItems,
    transactions,
    planByKey,
    accountByName,
    accountBalanceByNo,
  });

  const allLearners = [...activeLearners, ...historicalLearners];
  const activeCountValidation = buildActiveCountValidation(
    classLearners,
    contacts.length,
    billingItems,
    accounts
  );

  const varianceRows = base.reconciliation.rows.filter((r) => Math.abs(r.variance) > 0.01);
  const maxVariance = varianceRows.reduce(
    (m, r) => Math.max(m, Math.abs(r.variance)),
    0
  );

  const issues: KideesysMigrationIssue[] = activeCountValidation.errors.map((err, i) => ({
    id: `active-count-${i + 1}`,
    issue: err,
    severity: "error",
    record: "Active learner counts",
    suggestedFix:
      "Class list is the active source of truth — align contact list and billing plan to current class lists",
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

  const blockingErrors =
    activeCountValidation.errors.length + duplicateLearners.length;
  const canStage = blockingErrors === 0;
  const canApply = canStage && activeCountValidation.countsMatch;

  const bundle: DaSilvaMigrationBundle = {
    ...base,
    source: "kideesys-dasilva",
    learners: allLearners,
    countValidation: activeCountValidation,
    canImport: canApply,
    confirmToken: crypto
      .createHash("sha256")
      .update(
        `${opts.projectId}:${canApply}:${activeLearners.length}:${historicalLearners.length}:${transactions.length}`
      )
      .digest("hex")
      .slice(0, 24),
  };

  const classifications: KideesysLearnerClassification[] = allLearners.map((l) => ({
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
