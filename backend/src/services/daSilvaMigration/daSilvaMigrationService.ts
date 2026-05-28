import fs from "fs";
import path from "path";
import { prisma } from "../../prisma";
import {
  indexAgeAnalysisAccountNames,
  isKidESysSourceAccountRef,
} from "./ageAnalysisParser";
import {
  addLearnerToFamilyIndex,
  buildMergedFamilyAccountSet,
  computeFamilyLedgerBalance,
  countActiveLearnersPerAccount,
  findAccountForLearnerName,
  indexHistoricalLearners,
  parseSiblingAccountsFile,
  splitMergedAccountNames,
  type FamilyAccountIndex,
} from "./daSilvaMergedFamily";
import {
  backfillLedgerLearnerIds,
  calculateBalanceForAccount,
  type BillingLedgerEntry,
  readSchoolLedger,
  upsertSchoolEntries,
} from "../../utils/billingLedgerStore";
import { normalizeClassroomInput } from "../../utils/classroomNormalization";
import { normalizeMatchText } from "../../utils/kideesysSpreadsheet";
import { buildLearnerMatchKey } from "./parsers";
import {
  readSchoolBillingPlans,
  upsertSchoolBillingPlans,
  type StoredBillingPlanItem,
  removeSchoolBillingPlans,
} from "../../utils/learnerBillingPlanStore";
import { normalizeSaPhone } from "../parentPortalService";
import { syncParentThreadsForClassroom } from "../parentPortalService";
import {
  buildOpeningBalancePlan,
  buildPhase4OpeningBalancesFromAgeAnalysis,
  type DaSilvaOpeningBalancePlan,
} from "./daSilvaOpeningBalance";
import {
  approvedOpeningBalanceAdjustments,
  assertDaSilvaFinalImportAllowed,
} from "./daSilvaFinalImportGate";
import {
  countDaSilvaSasamsClassrooms,
  countDaSilvaSupplementClassrooms,
  DA_SILVA_BILLING_ACCOUNT_TARGET,
  DA_SILVA_EXPECTED_CLASSROOM_LEARNER_COUNTS,
  DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT,
  DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT,
  DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT,
  DA_SILVA_EXPECTED_LEARNER_COUNT,
  DA_SILVA_EXPECTED_PARENT_COUNT,
  DA_SILVA_EXPECTED_PARENT_LINK_COUNT,
  DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT,
  DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_FILE_COUNT,
  DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT,
  DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT,
  DA_SILVA_EXPECTED_SASAMS_CLASSROOM_LEARNER_COUNTS,
  DA_SILVA_EXPECTED_UNIQUE_PARENT_COUNT,
  DA_SILVA_OPENING_BALANCE_EXCLUDED_ACCOUNTS,
  isAcceptableDaSilvaPhase2LearnerCount,
  isAcceptableDaSilvaPhase3LearnerCount,
  isAllowedDaSilvaSupplementClassroom,
} from "./daSilvaConstants";
import { assertDaSilvaMigrationGates } from "./daSilvaPhaseGates";
import { relinkDaSilvaLearnerBillingFromBundle } from "./relinkDaSilvaLearnerBilling";
import { runKideesysPostMigrationReconciliation } from "../kideesysMigration/kideesysBillingReconciliation";
import {
  parseAgeAnalysisFile,
  parseAgeAnalysisFileWithAudit,
  type AgeAnalysisParseAudit,
  parseBillingPlanFile,
  parseContactListFile,
  parseEmployeesFile,
  parseTransactionListFile,
  type ParsedBillingAccount,
  type ParsedBillingPlanItem,
  type ParsedClassroom,
  type ParsedEmployee,
  type ParsedLearner,
  type ParsedLearnerContact,
  type ParsedTransaction,
} from "./parsers";
import {
  DA_SILVA_BILLING_MATCH_MAX_UNMATCHED,
  DA_SILVA_BILLING_MATCH_MIN_MATCHED,
  DA_SILVA_BILLING_MATCH_MIN_RATIO,
  DA_SILVA_MIGRATION_STRATEGY,
  discoverBillingSecondPassPaths,
  type DaSilvaMigrationStrategy,
  type DaSilvaSasamsIngestPaths,
} from "./daSilvaMigrationStrategy";
import { writeDaSilvaMigrationAudit } from "./daSilvaMigrationAudit";
import {
  matchKideesysBillingAccountsWithSecondPass,
  groupSiblingAccounts,
} from "./daSilvaKideesysBillingMatch";
import { formatKideesysBillingReconciliationReportText } from "./daSilvaKideesysBillingReconciliationReport";
import { auditParentMatches, matchParentToLearner, buildLearnerMatchIndexes } from "./daSilvaParentLearnerMatching";
import {
  mergeSasamsLearnerSources,
  parseSasamsClassListDirectory,
  parseSasamsLearnerRegister,
  parseSasamsParentRegister,
  parseSasamsParentSources,
  sasamsLearnersToParsedLearners,
  type SasamsLearnerMergeAudit,
  type SasamsParsedLearner,
} from "./sasamsParsers";

const STAGING_ROOT = path.join(process.cwd(), "uploads", "migration-staging");

export type DaSilvaUploadSlot =
  | "classListDir"
  | "contactList"
  | "employees"
  | "billingPlan"
  | "ageAnalysis"
  | "transactions";

export type DaSilvaMigrationTotals = {
  totalLearners: number;
  totalParents: number;
  totalClasses: number;
  totalInvoices: number;
  totalPayments: number;
  totalInvoiceAmount: number;
  totalPaymentAmount: number;
  totalOutstandingBalance: number;
};

export type DaSilvaCountValidation = {
  learnersFromClassList: number;
  learnersFromContactList: number;
  learnersFromBillingPlan: number;
  billingAccountsFromAgeAnalysis: number;
  countsMatch: boolean;
  errors: string[];
};

export type DaSilvaReconciliationRow = {
  accountNo: string;
  fullName: string;
  ageAnalysisBalance: number;
  ledgerBalanceFromImport: number;
  variance: number;
};

export type DaSilvaReconciliationReport = {
  rows: DaSilvaReconciliationRow[];
  unmatchedAccounts: string[];
  unmatchedLearners: string[];
  totals: DaSilvaMigrationTotals;
};

export type DaSilvaStagedLearner = {
  matchKey: string;
  fullName: string;
  firstName: string;
  lastName: string;
  className: string;
  canonicalClassName: string;
  accountNo: string;
  billingPlan: StoredBillingPlanItem[];
  billingPlanTotal: number;
  ageAnalysisBalance: number;
  parents: ParsedLearnerContact["parents"];
  /** ACTIVE = class list; HISTORICAL = billing/ledger only (Kid-e-Sys portal). */
  enrollmentTier?: "ACTIVE" | "HISTORICAL";
};

export type DaSilvaAgeAnalysisLearnerMatchAudit = {
  learnersMatchedFromAgeAnalysis: number;
  learnersNotMatchedFromAgeAnalysis: number;
};

export type DaSilvaMigrationBundle = {
  projectId: string;
  schoolId: string;
  source: "sasams-kideesys" | "kideesys-dasilva";
  createdAt: string;
  classrooms: ParsedClassroom[];
  employees: ParsedEmployee[];
  learners: DaSilvaStagedLearner[];
  accounts: ParsedBillingAccount[];
  transactions: ParsedTransaction[];
  mergedFamilyAccountNos: string[];
  countValidation: DaSilvaCountValidation;
  reconciliation: DaSilvaReconciliationReport;
  openingBalance: DaSilvaOpeningBalancePlan;
  ageAnalysisParseAudit: AgeAnalysisParseAudit;
  ageAnalysisLearnerMatchAudit: DaSilvaAgeAnalysisLearnerMatchAudit;
  canImport: boolean;
  confirmToken: string;
};

export type DaSilvaImportPhase =
  | "school_base"
  | "classrooms"
  | "learners"
  | "parents"
  | "billing_match"
  | "billing_accounts"
  | "transactions"
  | "opening_balances";

export type DaSilvaImportManifest = {
  projectId: string;
  schoolId: string;
  strategy?: DaSilvaMigrationStrategy;
  importedAt: string;
  learnerIds: string[];
  parentIds: string[];
  linkIds: string[];
  classroomIds: string[];
  employeeIds: string[];
  ledgerEntryIds: string[];
  /** `${matchKey}:${parentIndex}` → parent id (parents phase, links in parents phase) */
  stagedParentIds?: Record<string, string>;
  matchKeyToLearnerId?: Record<string, string>;
  accountToLearnerId?: Record<string, string>;
  phasesCompleted?: DaSilvaImportPhase[];
  failedPhase?: DaSilvaImportPhase;
};

function stagingPath(schoolId: string, projectId: string) {
  return path.join(STAGING_ROOT, schoolId, `dasilva-${projectId}.json`);
}

function manifestPath(schoolId: string, projectId: string) {
  return path.join(STAGING_ROOT, schoolId, `dasilva-${projectId}.manifest.json`);
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function createDaSilvaProjectId(): string {
  return `dasilva-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueLearnersByMatchKey(learners: ParsedLearner[]): ParsedLearner[] {
  const map = new Map<string, ParsedLearner>();
  for (const l of learners) {
    if (!map.has(l.matchKey)) map.set(l.matchKey, l);
  }
  return Array.from(map.values());
}

function uniqueBillingLearners(items: ParsedBillingPlanItem[]): string[] {
  const keys = new Set<string>();
  for (const item of items) keys.add(item.matchKey);
  return Array.from(keys);
}

function buildAccountMap(
  accounts: ParsedBillingAccount[],
  transactions: ParsedTransaction[]
): Map<string, { accountNo: string; fullName: string }> {
  const map = new Map<string, { accountNo: string; fullName: string }>();
  for (const a of accounts) {
    map.set(a.accountNo, { accountNo: a.accountNo, fullName: a.fullName });
  }
  for (const t of transactions) {
    if (!map.has(t.accountNo)) {
      map.set(t.accountNo, { accountNo: t.accountNo, fullName: t.fullName });
    }
  }
  return map;
}

function groupBillingPlans(items: ParsedBillingPlanItem[]): Map<string, StoredBillingPlanItem[]> {
  const map = new Map<string, StoredBillingPlanItem[]>();
  for (const item of items) {
    const list = map.get(item.matchKey) || [];
    list.push({ feeDescription: item.feeDescription, amount: item.amount });
    map.set(item.matchKey, list);
  }
  return map;
}

function buildFamilyAccountIndex(
  accounts: ParsedBillingAccount[],
  billingItems: ParsedBillingPlanItem[],
  classLearners: ParsedLearner[],
  contacts: ParsedLearnerContact[],
  transactions: ParsedTransaction[]
): FamilyAccountIndex {
  const index: FamilyAccountIndex = {
    learnerNameToAccount: new Map(),
    accountToLearnerNames: new Map(),
  };
  indexHistoricalLearners(
    accounts,
    billingItems,
    classLearners,
    contacts,
    transactions,
    index
  );
  return index;
}

function loadSiblingAccountNos(siblingAccountsPath?: string): Set<string> {
  if (!siblingAccountsPath || !fs.existsSync(siblingAccountsPath)) {
    return new Set();
  }
  return parseSiblingAccountsFile(siblingAccountsPath);
}

function discoverSiblingAccountsPath(desktopRoot: string): string | undefined {
  const candidates = [
    path.join(desktopRoot, "07_sibling_accounts", "sibling_accounts.xls"),
    path.join(desktopRoot, "07_sibling_accounts", "sibling_accounts_(merged).xls"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function resolveFamilyAccountNo(
  txn: ParsedTransaction,
  index: FamilyAccountIndex
): string {
  const byName = index.learnerNameToAccount.get(normalizeMatchText(txn.fullName));
  if (byName) return byName;
  return String(txn.accountNo || "").trim();
}

/** Sum invoices/payments into one balance per family account (not per learner). */
function aggregateFamilyLedgerBalances(
  transactions: ParsedTransaction[],
  index: FamilyAccountIndex
): Map<string, number> {
  const ledgerByAccount = new Map<string, number>();
  for (const txn of transactions) {
    const familyAccountNo = resolveFamilyAccountNo(txn, index);
    if (!familyAccountNo) continue;
    const prev = ledgerByAccount.get(familyAccountNo) || 0;
    ledgerByAccount.set(familyAccountNo, prev + txn.signedAmount);
  }
  return ledgerByAccount;
}

function familyAccountForOrphanLedger(
  accountNo: string,
  index: FamilyAccountIndex,
  transactions: ParsedTransaction[]
): string | null {
  for (const txn of transactions) {
    if (txn.accountNo !== accountNo) continue;
    const family = resolveFamilyAccountNo(txn, index);
    if (family && family !== accountNo) return family;
  }
  return null;
}

function buildCountValidation(
  classLearners: ParsedLearner[],
  contacts: ParsedLearnerContact[],
  billingItems: ParsedBillingPlanItem[],
  accounts: ParsedBillingAccount[]
): DaSilvaCountValidation {
  const errors: string[] = [];
  const classCount = uniqueLearnersByMatchKey(classLearners).length;
  const contactCount = contacts.length;
  const billingCount = uniqueBillingLearners(billingItems).length;

  if (classCount !== contactCount) {
    errors.push(`Class list learners (${classCount}) ≠ contact list learners (${contactCount})`);
  }
  if (classCount !== billingCount) {
    errors.push(`Class list learners (${classCount}) ≠ billing plan learners (${billingCount})`);
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

function buildReconciliation(
  stagedLearners: DaSilvaStagedLearner[],
  transactions: ParsedTransaction[],
  accounts: ParsedBillingAccount[],
  familyIndex: FamilyAccountIndex,
  classLearners: ParsedLearner[],
  contacts: ParsedLearnerContact[],
  siblingAccountNos: Set<string>
): DaSilvaReconciliationReport {
  const invoices = transactions.filter((t) => t.kind === "invoice");
  const payments = transactions.filter((t) => t.kind === "payment");

  const ledgerByAccount = aggregateFamilyLedgerBalances(transactions, familyIndex);
  const mergedFamilyAccountNos = buildMergedFamilyAccountSet({
    accounts,
    index: familyIndex,
    classLearners,
    contacts,
    txnSumByAccount: ledgerByAccount,
    siblingAccountNos,
  });
  const activeLearnersByAccount = countActiveLearnersPerAccount(
    classLearners,
    accounts,
    familyIndex
  );

  const rows: DaSilvaReconciliationRow[] = [];
  const seen = new Set<string>();

  for (const account of accounts) {
    seen.add(account.accountNo);
    const txnSum = ledgerByAccount.get(account.accountNo) || 0;
    const activeLearnerCount = activeLearnersByAccount.get(account.accountNo) || 0;
    const ledgerBalance = computeFamilyLedgerBalance(
      account,
      txnSum,
      familyIndex,
      transactions,
      mergedFamilyAccountNos,
      activeLearnerCount
    );
    rows.push({
      accountNo: account.accountNo,
      fullName: account.fullName,
      ageAnalysisBalance: account.balance,
      ledgerBalanceFromImport: Math.round(ledgerBalance * 100) / 100,
      variance: Math.round((account.balance - ledgerBalance) * 100) / 100,
    });
  }

  for (const [accountNo, balance] of ledgerByAccount) {
    if (seen.has(accountNo)) continue;
    if (familyAccountForOrphanLedger(accountNo, familyIndex, transactions)) continue;
    rows.push({
      accountNo,
      fullName: "",
      ageAnalysisBalance: 0,
      ledgerBalanceFromImport: Math.round(balance * 100) / 100,
      variance: Math.round(-balance * 100) / 100,
    });
  }

  const parentCount = stagedLearners.reduce((s, l) => s + l.parents.length, 0);

  return {
    rows: rows.sort((a, b) => a.accountNo.localeCompare(b.accountNo)),
    unmatchedAccounts: [],
    unmatchedLearners: [],
    totals: {
      totalLearners: stagedLearners.length,
      totalParents: parentCount,
      totalClasses: new Set(stagedLearners.map((l) => l.className)).size,
      totalInvoices: invoices.length,
      totalPayments: payments.length,
      totalInvoiceAmount: Math.round(invoices.reduce((s, t) => s + t.amount, 0) * 100) / 100,
      totalPaymentAmount: Math.round(payments.reduce((s, t) => s + t.amount, 0) * 100) / 100,
      totalOutstandingBalance: Math.round(accounts.reduce((s, a) => s + a.balance, 0) * 100) / 100,
    },
  };
}

export type DaSilvaIngestPaths = {
  classListDir: string;
  contactList: string;
  employees: string;
  billingPlan: string;
  ageAnalysis: string;
  transactions: string;
  siblingAccounts?: string;
};

export function buildDaSilvaMigrationBundle(opts: {
  schoolId: string;
  projectId: string;
  paths: DaSilvaIngestPaths;
}): DaSilvaMigrationBundle {
  const { classrooms: sasamsClassrooms, learners: sasamsClassLearners } = parseSasamsClassListDirectory(
    opts.paths.classListDir
  );
  const classLearners = sasamsLearnersToParsedLearners(sasamsClassLearners);
  const classrooms: ParsedClassroom[] = sasamsClassrooms.map((c) => ({
    className: c.className,
    year: null,
    sourceFile: c.sourceFile,
  }));
  const contacts = parseContactListFile(opts.paths.contactList);
  const employees = parseEmployeesFile(opts.paths.employees);
  const billingItems = parseBillingPlanFile(opts.paths.billingPlan);
  const ageAnalysisParsed = parseAgeAnalysisFileWithAudit(opts.paths.ageAnalysis);
  const accounts = ageAnalysisParsed.accounts;
  const ageAnalysisParseAudit = ageAnalysisParsed.audit;
  const transactions = parseTransactionListFile(opts.paths.transactions);

  const contactByKey = new Map(contacts.map((c) => [c.matchKey, c]));
  const planByKey = groupBillingPlans(billingItems);
  const accountByName = new Map<string, string>();
  const accountByNo = buildAccountMap(accounts, transactions);

  indexAgeAnalysisAccountNames(accounts, accountByName);
  for (const t of transactions) {
    accountByName.set(normalizeMatchText(t.fullName), t.accountNo);
  }

  const uniqueClassLearners = uniqueLearnersByMatchKey(classLearners);
  const familyIndex = buildFamilyAccountIndex(
    accounts,
    billingItems,
    uniqueClassLearners,
    contacts,
    transactions
  );
  const siblingAccountNos = loadSiblingAccountNos(opts.paths.siblingAccounts);
  const stagedLearners: DaSilvaStagedLearner[] = [];
  let learnersMatchedFromAgeAnalysis = 0;
  let learnersNotMatchedFromAgeAnalysis = 0;

  // Track fallback account numbers generated in this bundle so we can reuse the
  // same one if the same learner appears twice and guarantee uniqueness otherwise.
  const fallbackByMatchKey = new Map<string, string>();
  let fallbackSeq = 0;

  /**
   * Generate a stable, deterministic fallback account number for a learner that
   * cannot be matched to any Kid-e-Sys account after Age Analysis is parsed.
   * Format: KID-MISSING-{4-digit-seq}  e.g. KID-MISSING-0001
   */
  function getFallbackAccountNo(matchKey: string): string {
    if (fallbackByMatchKey.has(matchKey)) return fallbackByMatchKey.get(matchKey)!;
    fallbackSeq += 1;
    const seq = String(fallbackSeq).padStart(4, "0");
    const fallback = `KID-MISSING-${seq}`;
    fallbackByMatchKey.set(matchKey, fallback);
    return fallback;
  }

  function resolveLearnerAccountFromAgeAnalysis(learnerFullName: string): {
    accountNo: string;
    ageRow: ParsedBillingAccount | undefined;
    matchedFromAgeAnalysis: boolean;
  } {
    let accountNo =
      accountByName.get(normalizeMatchText(learnerFullName)) ||
      findAccountForLearnerName(learnerFullName, accounts, familyIndex) ||
      "";

    if (!accountNo) {
      for (const [no, meta] of accountByNo) {
        if (normalizeMatchText(meta.fullName) === normalizeMatchText(learnerFullName)) {
          accountNo = no;
          break;
        }
      }
    }

    const ageRow = accounts.find(
      (a) =>
        a.accountNo === accountNo ||
        normalizeMatchText(a.fullName) === normalizeMatchText(learnerFullName) ||
        (a.learnerNames || splitMergedAccountNames(a.fullName)).some(
          (n) => normalizeMatchText(n) === normalizeMatchText(learnerFullName)
        )
    );

    const matchedFromAgeAnalysis = Boolean(
      ageRow?.accountNo && isKidESysSourceAccountRef(ageRow.accountNo)
    );

    return { accountNo, ageRow, matchedFromAgeAnalysis };
  }

  for (const learner of uniqueClassLearners) {
    const norm = normalizeClassroomInput(learner.className);
    const canonicalClassName = norm.classroomName || learner.className;
    const contact = contactByKey.get(learner.matchKey);
    const billingPlan = planByKey.get(learner.matchKey) || [];
    const billingPlanTotal = billingPlan.reduce((s, i) => s + i.amount, 0);

    const { accountNo, ageRow, matchedFromAgeAnalysis } = resolveLearnerAccountFromAgeAnalysis(
      learner.fullName
    );

    const resolvedAccountNo =
      (accountNo && isKidESysSourceAccountRef(accountNo) ? accountNo : "") ||
      (ageRow?.accountNo && isKidESysSourceAccountRef(ageRow.accountNo) ? ageRow.accountNo : "") ||
      getFallbackAccountNo(learner.matchKey);

    if (matchedFromAgeAnalysis || isKidESysSourceAccountRef(resolvedAccountNo)) {
      learnersMatchedFromAgeAnalysis += 1;
    } else {
      learnersNotMatchedFromAgeAnalysis += 1;
    }

    stagedLearners.push({
      matchKey: learner.matchKey,
      fullName: learner.fullName,
      firstName: learner.firstName,
      lastName: learner.lastName,
      className: learner.className,
      canonicalClassName,
      accountNo: resolvedAccountNo,
      billingPlan,
      billingPlanTotal,
      ageAnalysisBalance: ageRow?.balance ?? 0,
      parents: contact?.parents || [],
    });
  }

  const countValidation = buildCountValidation(classLearners, contacts, billingItems, accounts);
  const reconciliation = buildReconciliation(
    stagedLearners,
    transactions,
    accounts,
    familyIndex,
    uniqueClassLearners,
    contacts,
    siblingAccountNos
  );
  const ledgerByAccount = aggregateFamilyLedgerBalances(transactions, familyIndex);
  const mergedFamilyAccountNos = [
    ...buildMergedFamilyAccountSet({
      accounts,
      index: familyIndex,
      classLearners: uniqueClassLearners,
      contacts,
      txnSumByAccount: ledgerByAccount,
      siblingAccountNos,
    }),
  ].sort();
  const openingBalance = buildOpeningBalancePlan({
    accounts,
    transactions,
    reconciliationRows: reconciliation.rows,
    learners: stagedLearners,
    mergedFamilyAccountNos,
  });
  const canImport = countValidation.countsMatch;

  const confirmToken = `${opts.projectId}:${countValidation.countsMatch ? "ok" : "blocked"}:${stagedLearners.length}:${transactions.length}:${openingBalance.summary.adjustmentCount}`;

  return {
    projectId: opts.projectId,
    schoolId: opts.schoolId,
    source: "sasams-kideesys",
    createdAt: new Date().toISOString(),
    classrooms,
    employees,
    learners: stagedLearners,
    accounts,
    transactions,
    mergedFamilyAccountNos,
    countValidation,
    reconciliation,
    openingBalance,
    ageAnalysisParseAudit,
    ageAnalysisLearnerMatchAudit: {
      learnersMatchedFromAgeAnalysis,
      learnersNotMatchedFromAgeAnalysis,
    },
    canImport,
    confirmToken,
  };
}

export async function saveDaSilvaStaging(bundle: DaSilvaMigrationBundle): Promise<void> {
  ensureDir(path.join(STAGING_ROOT, bundle.schoolId));
  fs.writeFileSync(stagingPath(bundle.schoolId, bundle.projectId), JSON.stringify(bundle, null, 2));
}

export function loadDaSilvaStaging(
  schoolId: string,
  projectId: string
): DaSilvaMigrationBundle | null {
  const file = stagingPath(schoolId, projectId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as DaSilvaMigrationBundle;
}

export function saveUploadedDaSilvaFiles(
  schoolId: string,
  projectId: string,
  files: Partial<Record<DaSilvaUploadSlot, string>>
): DaSilvaIngestPaths {
  const base = path.join(STAGING_ROOT, schoolId, projectId, "uploads");
  ensureDir(base);

  const saved: Partial<DaSilvaIngestPaths> = {};

  if (files.classListDir) {
    const dest = path.join(base, "05_class_list");
    ensureDir(dest);
    const srcFiles = fs.readdirSync(files.classListDir).filter((f) => f.toLowerCase().endsWith(".xls"));
    for (const f of srcFiles) {
      fs.copyFileSync(path.join(files.classListDir, f), path.join(dest, f));
    }
    saved.classListDir = dest;
  }

  const singleFiles: Array<[DaSilvaUploadSlot, keyof DaSilvaIngestPaths, string]> = [
    ["contactList", "contactList", "04_contact_list.xls"],
    ["employees", "employees", "06_employees.xls"],
    ["billingPlan", "billingPlan", "03_billing_plan.xls"],
    ["ageAnalysis", "ageAnalysis", "02_age_analysis.xls"],
    ["transactions", "transactions", "01_transactions.xls"],
  ];

  for (const [slot, key, destName] of singleFiles) {
    const src = files[slot];
    if (!src) continue;
    const dest = path.join(base, destName);
    fs.copyFileSync(src, dest);
    saved[key] = dest;
  }

  const required: (keyof DaSilvaIngestPaths)[] = [
    "classListDir",
    "contactList",
    "employees",
    "billingPlan",
    "ageAnalysis",
    "transactions",
  ];
  for (const key of required) {
    if (!saved[key]) {
      throw new Error(`Missing upload: ${key}`);
    }
  }

  return saved as DaSilvaIngestPaths;
}

export async function previewDaSilvaMigration(opts: {
  schoolId: string;
  projectId: string;
  paths: DaSilvaIngestPaths;
}): Promise<DaSilvaMigrationBundle> {
  const bundle = buildDaSilvaMigrationBundle(opts);
  await saveDaSilvaStaging(bundle);
  return bundle;
}

function ledgerEntryId(kind: string, transactionNo: string): string {
  return `kidesys-${kind}-${transactionNo}`;
}

function parentStagingKey(matchKey: string, parentIndex: number): string {
  return `${matchKey}:${parentIndex}`;
}

function writeDaSilvaManifest(schoolId: string, projectId: string, manifest: DaSilvaImportManifest) {
  ensureDir(path.join(STAGING_ROOT, schoolId));
  fs.writeFileSync(manifestPath(schoolId, projectId), JSON.stringify(manifest, null, 2));
}

export function loadDaSilvaManifest(schoolId: string, projectId: string): DaSilvaImportManifest | null {
  const file = manifestPath(schoolId, projectId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as DaSilvaImportManifest;
  } catch {
    return null;
  }
}

function pushUniqueId(list: string[], id: string) {
  if (!list.includes(id)) list.push(id);
}

function peekNextAdmissionNo(
  accountNo: string,
  accountLearnerSeq: Map<string, number>
): string | null {
  const trimmed = String(accountNo || "").trim();
  if (!trimmed) return null;
  const seq = (accountLearnerSeq.get(trimmed) || 0) + 1;
  return seq === 1 ? trimmed : `${trimmed}-${seq}`;
}

function allocateAdmissionNo(
  accountNo: string,
  accountLearnerSeq: Map<string, number>
): string | null {
  const trimmed = String(accountNo || "").trim();
  if (!trimmed) return null;
  const seq = (accountLearnerSeq.get(trimmed) || 0) + 1;
  accountLearnerSeq.set(trimmed, seq);
  return seq === 1 ? trimmed : `${trimmed}-${seq}`;
}

/** DB lookup so import retries cannot create duplicate learners when manifest is partial. */
async function findExistingLearnerIdForImportRow(opts: {
  schoolId: string;
  firstName: string;
  lastName: string;
  className: string;
  admissionNo: string | null;
}): Promise<string | null> {
  if (opts.admissionNo) {
    const byAdm = await prisma.learner.findUnique({
      where: {
        schoolId_admissionNo: {
          schoolId: opts.schoolId,
          admissionNo: opts.admissionNo,
        },
      },
      select: { id: true },
    });
    if (byAdm) return byAdm.id;
  }
  const byName = await prisma.learner.findFirst({
    where: {
      schoolId: opts.schoolId,
      firstName: opts.firstName,
      lastName: opts.lastName,
      className: opts.className || null,
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  return byName?.id || null;
}

function seedAccountLearnerSeqFromExisting(
  existing: Array<{ admissionNo: string | null }>
): Map<string, number> {
  const accountLearnerSeq = new Map<string, number>();
  for (const row of existing) {
    const adm = String(row.admissionNo || "").trim();
    if (!adm) continue;
    const dash = adm.indexOf("-");
    if (dash === -1) {
      accountLearnerSeq.set(adm, Math.max(accountLearnerSeq.get(adm) || 0, 1));
      continue;
    }
    const base = adm.slice(0, dash);
    const seq = Number.parseInt(adm.slice(dash + 1), 10);
    if (base && Number.isFinite(seq)) {
      accountLearnerSeq.set(base, Math.max(accountLearnerSeq.get(base) || 0, seq));
    }
  }
  return accountLearnerSeq;
}

async function runDaSilvaImportPhase(
  manifest: DaSilvaImportManifest,
  phase: DaSilvaImportPhase,
  schoolId: string,
  projectId: string,
  fn: () => Promise<void>
): Promise<void> {
  if (manifest.phasesCompleted?.includes(phase)) {
    console.log(`[DaSilva import] phase "${phase}" already completed — skipping`);
    return;
  }
  console.log(`[DaSilva import] phase "${phase}" starting…`);
  try {
    await fn();
    manifest.phasesCompleted = [...(manifest.phasesCompleted || []), phase];
    delete manifest.failedPhase;
    writeDaSilvaManifest(schoolId, projectId, manifest);
    console.log(`[DaSilva import] phase "${phase}" completed (${manifest.phasesCompleted.length} total)`);
  } catch (err) {
    manifest.failedPhase = phase;
    writeDaSilvaManifest(schoolId, projectId, manifest);
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[DaSilva import] phase "${phase}" FAILED: ${message}`);
    throw new Error(`Da Silva import failed at phase "${phase}": ${message}`);
  }
}

export async function commitDaSilvaMigration(opts: {
  schoolId: string;
  projectId: string;
  confirmToken: string;
}): Promise<{
  success: boolean;
  imported: Record<string, number>;
  manifest: DaSilvaImportManifest;
  totals: DaSilvaMigrationTotals;
}> {
  const bundle = loadDaSilvaStaging(opts.schoolId, opts.projectId);
  if (!bundle) throw new Error("Staging not found — run preview first");
  if (!bundle.openingBalance?.adjustments) {
    throw new Error("Staging bundle missing opening balance plan — re-run preview first");
  }
  if (!bundle.canImport) {
    throw new Error(`Count validation failed: ${bundle.countValidation.errors.join("; ")}`);
  }
  if (opts.confirmToken !== bundle.confirmToken) {
    throw new Error("Confirm token mismatch — re-run preview before final import");
  }

  const school = await prisma.school.findUnique({
    where: { id: opts.schoolId },
    select: { name: true },
  });
  if (!school) throw new Error("School not found");
  if (/da\s*silva\s*academy/i.test(school.name.trim())) {
    assertDaSilvaFinalImportAllowed(bundle, school.name);
  }

  const existingManifest = loadDaSilvaManifest(opts.schoolId, opts.projectId);
  const manifest: DaSilvaImportManifest = existingManifest?.projectId === opts.projectId &&
    existingManifest.schoolId === opts.schoolId
    ? {
        ...existingManifest,
        learnerIds: existingManifest.learnerIds || [],
        parentIds: existingManifest.parentIds || [],
        linkIds: existingManifest.linkIds || [],
        classroomIds: existingManifest.classroomIds || [],
        employeeIds: existingManifest.employeeIds || [],
        ledgerEntryIds: existingManifest.ledgerEntryIds || [],
        stagedParentIds: existingManifest.stagedParentIds || {},
        matchKeyToLearnerId: existingManifest.matchKeyToLearnerId || {},
        accountToLearnerId: existingManifest.accountToLearnerId || {},
        phasesCompleted: existingManifest.phasesCompleted || [],
      }
    : {
        projectId: opts.projectId,
        schoolId: opts.schoolId,
        importedAt: new Date().toISOString(),
        learnerIds: [],
        parentIds: [],
        linkIds: [],
        classroomIds: [],
        employeeIds: [],
        ledgerEntryIds: [],
        stagedParentIds: {},
        matchKeyToLearnerId: {},
        accountToLearnerId: {},
        phasesCompleted: [],
      };

  if (existingManifest?.projectId === opts.projectId) {
    const done = manifest.phasesCompleted?.length || 0;
    console.log(
      `[DaSilva import] resuming project ${opts.projectId} (${done} phase(s) already completed${
        manifest.failedPhase ? `, last failure: ${manifest.failedPhase}` : ""
      })`
    );
  } else {
    console.log(`[DaSilva import] starting fresh import for project ${opts.projectId}`);
    writeDaSilvaManifest(opts.schoolId, opts.projectId, manifest);
  }

  const matchKeyToLearnerId = new Map(Object.entries(manifest.matchKeyToLearnerId || {}));
  const accountToLearnerId = new Map(Object.entries(manifest.accountToLearnerId || {}));
  const accountToFamilyId = new Map<string, string>();

  const persistLearnerMaps = () => {
    manifest.matchKeyToLearnerId = Object.fromEntries(matchKeyToLearnerId);
    manifest.accountToLearnerId = Object.fromEntries(accountToLearnerId);
  };

  const resolveLearnerIdForTxn = (txn: ParsedTransaction): string =>
    accountToLearnerId.get(txn.accountNo) ||
    matchKeyToLearnerId.get(
      buildLearnerMatchKey(
        txn.fullName,
        bundle.learners.find((l) => l.accountNo === txn.accountNo)?.className || ""
      )
    ) ||
    "";

  const ensureFamilyAccountMap = async () => {
    if (accountToFamilyId.size > 0) return;
    const accountNos = [
      ...new Set(
        bundle.learners
          .map((row) => String(row.accountNo || "").trim())
          .filter(Boolean)
      ),
    ];
    if (!accountNos.length) return;
    const rows = await prisma.familyAccount.findMany({
      where: { accountRef: { in: accountNos } },
      select: { id: true, accountRef: true },
    });
    for (const row of rows) {
      accountToFamilyId.set(row.accountRef, row.id);
    }
  };

  await runDaSilvaImportPhase(manifest, "school_base", opts.schoolId, opts.projectId, async () => {
    const schoolRecord = await prisma.school.findUnique({
      where: { id: opts.schoolId },
      select: { id: true, name: true },
    });
    if (!schoolRecord) throw new Error("School not found");

    for (const emp of bundle.employees) {
      const existing = await prisma.employee.findFirst({
        where: {
          schoolId: opts.schoolId,
          OR: [
            { fullName: emp.fullName },
            {
              AND: [{ firstName: emp.firstName }, { lastName: emp.lastName }],
            },
          ],
        },
        select: { id: true },
      });
      if (existing) {
        pushUniqueId(manifest.employeeIds, existing.id);
        continue;
      }
      const created = await prisma.employee.create({
        data: {
          schoolId: opts.schoolId,
          firstName: emp.firstName,
          lastName: emp.lastName,
          fullName: emp.fullName,
          mobileNumber: emp.mobileNumber || null,
          email: emp.email || null,
          physicalAddress: emp.physicalAddress || null,
        },
        select: { id: true },
      });
      pushUniqueId(manifest.employeeIds, created.id);
    }
  });

  await runDaSilvaImportPhase(manifest, "classrooms", opts.schoolId, opts.projectId, async () => {
    for (const classroom of bundle.classrooms) {
      const norm = normalizeClassroomInput(classroom.className);
      const name = norm.classroomName || classroom.className;
      if (!name) continue;
      const record = await prisma.classroom.upsert({
        where: { schoolId_name: { schoolId: opts.schoolId, name } },
        create: { schoolId: opts.schoolId, name },
        update: {},
      });
      pushUniqueId(manifest.classroomIds, record.id);
    }
  });

  if (!manifest.stagedParentIds) manifest.stagedParentIds = {};

  await runDaSilvaImportPhase(manifest, "learners", opts.schoolId, opts.projectId, async () => {
    const existingAdmissionRows = await prisma.learner.findMany({
      where: { schoolId: opts.schoolId, admissionNo: { not: null } },
      select: { admissionNo: true },
    });
    const accountLearnerSeq = seedAccountLearnerSeqFromExisting(existingAdmissionRows);

    let learnerRowIndex = 0;
    for (const row of bundle.learners) {
      learnerRowIndex += 1;
      const accountNo = String(row.accountNo || "").trim();
      const isHistorical = row.enrollmentTier === "HISTORICAL";
      const norm = normalizeClassroomInput(row.className);
      const canonicalClassName = isHistorical ? null : row.canonicalClassName;

      let learnerId =
        manifest.matchKeyToLearnerId?.[row.matchKey] ||
        matchKeyToLearnerId.get(row.matchKey) ||
        null;

      if (!learnerId) {
        const plannedAdmissionNo = accountNo
          ? peekNextAdmissionNo(accountNo, accountLearnerSeq)
          : null;
        learnerId = await findExistingLearnerIdForImportRow({
          schoolId: opts.schoolId,
          firstName: row.firstName,
          lastName: row.lastName,
          className: canonicalClassName || "",
          admissionNo: plannedAdmissionNo,
        });
        if (!learnerId && accountNo) {
          const byBaseAccount = await prisma.learner.findUnique({
            where: {
              schoolId_admissionNo: {
                schoolId: opts.schoolId,
                admissionNo: accountNo,
              },
            },
            select: { id: true },
          });
          learnerId = byBaseAccount?.id || null;
        }
      }

      if (learnerId) {
        await prisma.learner.update({
          where: { id: learnerId },
          data: {
            firstName: row.firstName,
            lastName: row.lastName,
            grade: isHistorical
              ? "Historical"
              : norm.gradeLabel || row.className.replace(/[A-Za-z]+$/, "").trim(),
            className: canonicalClassName,
            enrollmentStatus: isHistorical ? "HISTORICAL" : "ACTIVE",
            totalFee: 0,
            tuitionFee: 0,
          },
        });
      } else {
        const admissionNo = accountNo
          ? allocateAdmissionNo(accountNo, accountLearnerSeq)
          : null;

        const learnerData = {
          schoolId: opts.schoolId,
          familyAccountId: null as string | null,
          firstName: row.firstName,
          lastName: row.lastName,
          grade: isHistorical
            ? "Historical"
            : norm.gradeLabel || row.className.replace(/[A-Za-z]+$/, "").trim(),
          className: canonicalClassName,
          enrollmentStatus: isHistorical ? ("HISTORICAL" as const) : ("ACTIVE" as const),
          admissionNo,
          totalFee: 0,
          tuitionFee: 0,
        };

        const learner =
          admissionNo != null
            ? await prisma.learner.upsert({
                where: {
                  schoolId_admissionNo: { schoolId: opts.schoolId, admissionNo },
                },
                create: learnerData,
                update: {
                  familyAccountId: learnerData.familyAccountId,
                  firstName: learnerData.firstName,
                  lastName: learnerData.lastName,
                  grade: learnerData.grade,
                  className: learnerData.className,
                  enrollmentStatus: learnerData.enrollmentStatus,
                  totalFee: learnerData.totalFee,
                  tuitionFee: learnerData.tuitionFee,
                },
              })
            : await prisma.learner.create({ data: learnerData });

        learnerId = learner.id;
      }

      pushUniqueId(manifest.learnerIds, learnerId);
      matchKeyToLearnerId.set(row.matchKey, learnerId);
      if (accountNo && !accountToLearnerId.has(accountNo)) {
        accountToLearnerId.set(accountNo, learnerId);
      }

      if (learnerRowIndex % 40 === 0) {
        persistLearnerMaps();
        writeDaSilvaManifest(opts.schoolId, opts.projectId, manifest);
      }
    }

    persistLearnerMaps();
  });

  await runDaSilvaImportPhase(manifest, "parents", opts.schoolId, opts.projectId, async () => {
    await ensureFamilyAccountMap();
    if (!manifest.stagedParentIds) manifest.stagedParentIds = {};

    for (const row of bundle.learners) {
      const learnerId = matchKeyToLearnerId.get(row.matchKey) || "";
      if (!learnerId) {
        throw new Error(`Missing learner id for ${row.matchKey} — learners phase required before parents`);
      }

      const accountNo = String(row.accountNo || "").trim();
      let familyAccountId: string | null = accountNo ? accountToFamilyId.get(accountNo) || null : null;
      if (accountNo && !familyAccountId) {
        const fa = await prisma.familyAccount.upsert({
          where: { accountRef: accountNo },
          create: {
            schoolId: opts.schoolId,
            accountRef: accountNo,
            familyName: row.lastName || row.fullName,
          },
          update: {},
          select: { id: true },
        });
        familyAccountId = fa.id;
        accountToFamilyId.set(accountNo, fa.id);
      }

      await prisma.learner.update({
        where: { id: learnerId },
        data: { familyAccountId },
      });

      for (let pi = 0; pi < row.parents.length; pi++) {
        const parent = row.parents[pi];
        const stageKey = parentStagingKey(row.matchKey, pi);

        const phone = normalizeSaPhone(parent.cellNo || parent.homeNo || "");
        const cellNo = phone?.localCell || parent.cellNo || "";

        const existingParent = await prisma.parent.findFirst({
          where: {
            schoolId: opts.schoolId,
            firstName: parent.firstName,
            surname: parent.surname,
            cellNo,
            familyAccountId: familyAccountId ?? null,
          },
          select: { id: true },
        });

        const parentId =
          existingParent?.id ||
          (
            await prisma.parent.create({
              data: {
                schoolId: opts.schoolId,
                familyAccountId,
                firstName: parent.firstName,
                surname: parent.surname,
                cellNo,
                email: parent.email || null,
                relationship: parent.relation,
                workNo: parent.workNo || null,
                homeNo: parent.homeNo || null,
                outstandingAmount: row.ageAnalysisBalance,
              },
              select: { id: true },
            })
          ).id;

        manifest.stagedParentIds![stageKey] = parentId;
        pushUniqueId(manifest.parentIds, parentId);

        const link = await prisma.parentLearnerLink.upsert({
          where: { parentId_learnerId: { parentId, learnerId } },
          create: {
            schoolId: opts.schoolId,
            parentId,
            learnerId,
            relation: parent.relation,
            isPrimary: row.parents[0] === parent,
          },
          update: {},
          select: { id: true },
        });
        pushUniqueId(manifest.linkIds, link.id);
      }
    }
  });

  await runDaSilvaImportPhase(manifest, "billing_accounts", opts.schoolId, opts.projectId, async () => {
    const billingPlans: Record<string, StoredBillingPlanItem[]> = {};
    for (const row of bundle.learners) {
      const learnerId = matchKeyToLearnerId.get(row.matchKey);
      if (learnerId && row.billingPlan.length) {
        billingPlans[learnerId] = row.billingPlan;
      }
    }
    upsertSchoolBillingPlans(opts.schoolId, billingPlans);
  });

  await runDaSilvaImportPhase(manifest, "transactions", opts.schoolId, opts.projectId, async () => {
    const ledgerEntries: BillingLedgerEntry[] = [];
    for (const txn of bundle.transactions) {
      const entry: BillingLedgerEntry = {
        id: ledgerEntryId(txn.kind, txn.transactionNo),
        schoolId: opts.schoolId,
        learnerId: resolveLearnerIdForTxn(txn),
        accountNo: txn.accountNo,
        type: txn.kind,
        amount: txn.amount,
        date: txn.date,
        reference: txn.reference,
        description: txn.notes || txn.reference,
        source: "kidesys_migration",
        createdAt: new Date().toISOString(),
      };
      ledgerEntries.push(entry);
      pushUniqueId(manifest.ledgerEntryIds, entry.id);
    }
    upsertSchoolEntries(opts.schoolId, ledgerEntries);
  });

  const relinkResult = await relinkDaSilvaLearnerBillingFromBundle({
    schoolId: opts.schoolId,
    bundle,
    manifest,
    matchKeyToLearnerId,
    accountToLearnerId,
  });
  persistLearnerMaps();
  manifest.accountToLearnerId = relinkResult.accountToLearnerId;
  if (relinkResult.learnersUpdated > 0 || relinkResult.ledgerRowsBackfilled > 0) {
    console.log(
      `[DaSilva import] relinked ${relinkResult.learnersUpdated} learner(s), ` +
        `backfilled ${relinkResult.ledgerRowsBackfilled} ledger row(s)`
    );
  }

  await runDaSilvaImportPhase(manifest, "opening_balances", opts.schoolId, opts.projectId, async () => {
    const ledgerEntries: BillingLedgerEntry[] = [];
    for (const adj of approvedOpeningBalanceAdjustments(bundle)) {
      const learnerId = accountToLearnerId.get(adj.accountNo) || "";
      const entry: BillingLedgerEntry = {
        id: `kidesys-opening-${adj.accountNo}`,
        schoolId: opts.schoolId,
        learnerId,
        accountNo: adj.accountNo,
        type: adj.entryType,
        amount: Math.abs(adj.adjustmentAmount),
        date: adj.date,
        reference: adj.reference,
        description: adj.description,
        source: "kidesys_migration_opening_balance",
        createdAt: new Date().toISOString(),
      };
      ledgerEntries.push(entry);
      pushUniqueId(manifest.ledgerEntryIds, entry.id);
    }
    upsertSchoolEntries(opts.schoolId, ledgerEntries);
  });

  const ledgerBackfilled = backfillLedgerLearnerIds(
    opts.schoolId,
    manifest.accountToLearnerId || {}
  );
  if (ledgerBackfilled > 0) {
    console.log(
      `[DaSilva import] backfilled learnerId on ${ledgerBackfilled} ledger row(s)`
    );
  }

  console.log("[DaSilva import] running Kid-e-Sys post-migration billing reconciliation…");
  const reconciliation = await runKideesysPostMigrationReconciliation({
    schoolId: opts.schoolId,
    projectId: opts.projectId,
  });
  console.log(
    `[DaSilva import] reconciliation gate passed — ` +
      `${reconciliation.auditAfter.learnersWithResolvableAccountNo}/${reconciliation.auditAfter.learnersTotal} learners with account numbers, ` +
      `${reconciliation.auditAfter.nonZeroBalanceAccountCount} account(s) with non-zero balance`
  );

  console.log("[DaSilva import] syncing parent threads for imported classrooms…");
  for (const classroomId of manifest.classroomIds) {
    await syncParentThreadsForClassroom(opts.schoolId, classroomId);
  }

  writeDaSilvaManifest(opts.schoolId, opts.projectId, manifest);

  return {
    success: true,
    imported: {
      learners: manifest.learnerIds.length,
      parents: manifest.parentIds.length,
      links: manifest.linkIds.length,
      classrooms: manifest.classroomIds.length,
      employees: manifest.employeeIds.length,
      ledgerEntries: manifest.ledgerEntryIds.length,
    },
    manifest,
    totals: bundle.reconciliation.totals,
  };
}

export {
  DA_SILVA_BILLING_ACCOUNT_TARGET,
  DA_SILVA_EXPECTED_CLASSROOM_COUNT,
  DA_SILVA_EXPECTED_CLASSROOM_LEARNER_COUNTS,
  DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT,
  DA_SILVA_EXPECTED_CREche_SUPPLEMENT_LEARNER_COUNT,
  DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT,
  DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT,
  DA_SILVA_EXPECTED_LEARNER_COUNT,
  DA_SILVA_EXPECTED_PARENT_COUNT,
  DA_SILVA_EXPECTED_PARENT_LINK_COUNT,
  DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT,
  DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_FILE_COUNT,
  DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT,
  DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT,
  DA_SILVA_EXPECTED_SASAMS_CLASSROOM_LEARNER_COUNTS,
  DA_SILVA_EXPECTED_UNIQUE_PARENT_COUNT,
  isAllowedDaSilvaSupplementClassroom,
} from "./daSilvaConstants";
export { assertDaSilvaMigrationGates } from "./daSilvaPhaseGates";

export type DaSilvaClassroomRow = {
  sourceFile: string;
  rawClassName: string;
  canonicalName: string;
  matchKey: string;
  learnerCount: number;
};

export type DaSilvaClassroomValidation = {
  passed: boolean;
  expectedCount: number;
  sourceFileCount: number;
  uniqueCanonicalCount: number;
  uniqueMatchKeyCount: number;
  totalLearners: number;
  classrooms: DaSilvaClassroomRow[];
  duplicates: Array<{ matchKey: string; canonicalName: string; files: string[] }>;
  emptyClassFiles: string[];
  /** DB classrooms allowed as Kid-e-Sys supplements (e.g. Crèche), excluded from ghost checks. */
  ignoredSupplementClassNames: string[];
  ghostClassNames: string[];
  errors: string[];
};

function canonicalClassroomName(className: string): string {
  const norm = normalizeClassroomInput(className);
  return norm.classroomName || className;
}

/** Validate SA-SAMS class list exports before/after classroom-only import (phase 1). */
export function validateDaSilvaClassroomsFromKidESys(
  classListDir: string,
  existingDbClassroomNames: string[] = []
): DaSilvaClassroomValidation {
  const errors: string[] = [];
  const { classrooms, learners } = parseSasamsClassListDirectory(classListDir);
  const expectedFileCount = DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT;
  const expectedSasamsLearners = DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT;

  const learnerCountByCanonical = new Map<string, number>();
  for (const learner of learners) {
    const name = canonicalClassroomName(learner.className);
    learnerCountByCanonical.set(name, (learnerCountByCanonical.get(name) || 0) + 1);
  }

  const rows: DaSilvaClassroomRow[] = classrooms.map((classroom) => {
    const canonicalName = canonicalClassroomName(classroom.className);
    const norm = normalizeClassroomInput(classroom.className);
    return {
      sourceFile: classroom.sourceFile,
      rawClassName: classroom.className,
      canonicalName,
      matchKey: norm.matchKey || canonicalName.toLowerCase(),
      learnerCount: learnerCountByCanonical.get(canonicalName) || 0,
    };
  });

  const byMatchKey = new Map<string, DaSilvaClassroomRow[]>();
  for (const row of rows) {
    const list = byMatchKey.get(row.matchKey) || [];
    list.push(row);
    byMatchKey.set(row.matchKey, list);
  }

  const duplicates = [...byMatchKey.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([matchKey, list]) => ({
      matchKey,
      canonicalName: list[0].canonicalName,
      files: list.map((r) => r.sourceFile),
    }));

  const emptyClassFiles = rows.filter((r) => r.learnerCount === 0).map((r) => r.sourceFile);
  const expectedNames = new Set(rows.map((r) => r.canonicalName));
  const dbNotInSasams = existingDbClassroomNames.filter((name) => !expectedNames.has(name));
  const ignoredSupplementClassNames = dbNotInSasams.filter(isAllowedDaSilvaSupplementClassroom);
  const ghostClassNames = dbNotInSasams.filter((name) => !isAllowedDaSilvaSupplementClassroom(name));

  const sourceFileCount = rows.length;
  const uniqueCanonicalCount = new Set(rows.map((r) => r.canonicalName)).size;
  const uniqueMatchKeyCount = byMatchKey.size;
  const totalLearners = learners.length;

  if (sourceFileCount !== expectedFileCount) {
    errors.push(
      `Expected ${expectedFileCount} SA-SAMS class list files (Crèche excluded), found ${sourceFileCount} in ${classListDir}`
    );
  }
  if (uniqueCanonicalCount !== expectedFileCount) {
    errors.push(
      `Expected ${expectedFileCount} unique SA-SAMS classrooms, found ${uniqueCanonicalCount} canonical names`
    );
  }
  if (uniqueMatchKeyCount !== expectedFileCount) {
    errors.push(
      `Expected ${expectedFileCount} unique SA-SAMS match keys, found ${uniqueMatchKeyCount}`
    );
  }
  if (totalLearners !== expectedSasamsLearners) {
    errors.push(
      `Expected ${expectedSasamsLearners} SA-SAMS class-list learners, found ${totalLearners} (Crèche ${DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT} is a separate supplement → ${DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} total)`
    );
  }
  if (duplicates.length) {
    errors.push(
      `Duplicate classrooms: ${duplicates.map((d) => `${d.canonicalName} (${d.files.join(", ")})`).join("; ")}`
    );
  }
  if (emptyClassFiles.length) {
    errors.push(`Empty class files (0 learners): ${emptyClassFiles.join(", ")}`);
  }
  if (ghostClassNames.length) {
    errors.push(`Ghost classes in database (not in SA-SAMS): ${ghostClassNames.join(", ")}`);
  }

  return {
    passed: errors.length === 0,
    expectedCount: expectedFileCount,
    sourceFileCount,
    uniqueCanonicalCount,
    uniqueMatchKeyCount,
    totalLearners,
    classrooms: rows.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName)),
    duplicates,
    emptyClassFiles,
    ignoredSupplementClassNames,
    ghostClassNames,
    errors,
  };
}

/**
 * Phase 1 only: import classrooms from SA-SAMS class lists. Does not import learners, parents, or billing.
 */
export async function commitDaSilvaClassroomsOnly(opts: {
  schoolId: string;
  projectId: string;
  classListDir: string;
}): Promise<{
  success: boolean;
  validation: DaSilvaClassroomValidation;
  postImportValidation: DaSilvaClassroomValidation;
  manifest: DaSilvaImportManifest;
  imported: { classrooms: number };
}> {
  const school = await prisma.school.findUnique({
    where: { id: opts.schoolId },
    select: { id: true },
  });
  if (!school) throw new Error("School not found");

  const existingDb = await prisma.classroom.findMany({
    where: { schoolId: opts.schoolId },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  const validation = validateDaSilvaClassroomsFromKidESys(
    opts.classListDir,
    existingDb.map((c) => c.name)
  );
  console.log("[da-silva-classroom-validation]", {
    phase: "pre-import",
    expected: validation.expectedCount,
    actual: validation.sourceFileCount,
    ignoredSupplement: validation.ignoredSupplementClassNames,
    ghost: validation.ghostClassNames,
  });
  if (!validation.passed) {
    throw new Error(`Classroom validation failed: ${validation.errors.join("; ")}`);
  }

  const existingManifest = loadDaSilvaManifest(opts.schoolId, opts.projectId);
  const manifest: DaSilvaImportManifest = existingManifest?.projectId === opts.projectId &&
    existingManifest.schoolId === opts.schoolId
    ? {
        ...existingManifest,
        learnerIds: existingManifest.learnerIds || [],
        parentIds: existingManifest.parentIds || [],
        linkIds: existingManifest.linkIds || [],
        classroomIds: existingManifest.classroomIds || [],
        employeeIds: existingManifest.employeeIds || [],
        ledgerEntryIds: existingManifest.ledgerEntryIds || [],
        phasesCompleted: existingManifest.phasesCompleted || [],
      }
    : {
        projectId: opts.projectId,
        schoolId: opts.schoolId,
        strategy: DA_SILVA_MIGRATION_STRATEGY,
        importedAt: new Date().toISOString(),
        learnerIds: [],
        parentIds: [],
        linkIds: [],
        classroomIds: [],
        employeeIds: [],
        ledgerEntryIds: [],
        phasesCompleted: [],
      };

  manifest.strategy = DA_SILVA_MIGRATION_STRATEGY;

  await runDaSilvaImportPhase(manifest, "classrooms", opts.schoolId, opts.projectId, async () => {
    for (const row of validation.classrooms) {
      const record = await prisma.classroom.upsert({
        where: { schoolId_name: { schoolId: opts.schoolId, name: row.canonicalName } },
        create: { schoolId: opts.schoolId, name: row.canonicalName },
        update: {},
      });
      pushUniqueId(manifest.classroomIds, record.id);
    }
  });

  writeDaSilvaManifest(opts.schoolId, opts.projectId, manifest);

  const postDb = await prisma.classroom.findMany({
    where: { schoolId: opts.schoolId },
    select: { name: true },
    orderBy: { name: "asc" },
  });
  const postImportValidation = validateDaSilvaClassroomsFromKidESys(opts.classListDir, postDb.map((c) => c.name));
  console.log("[da-silva-classroom-validation]", {
    phase: "post-import",
    expected: postImportValidation.expectedCount,
    actual: postDb.length,
    ignoredSupplement: postImportValidation.ignoredSupplementClassNames,
    ghost: postImportValidation.ghostClassNames,
  });
  const postDbNames = postDb.map((c) => c.name);
  const supplementCount = countDaSilvaSupplementClassrooms(postDbNames);
  const sasamsDbCount = countDaSilvaSasamsClassrooms(postDbNames);
  if (sasamsDbCount !== DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT) {
    postImportValidation.passed = false;
    postImportValidation.errors.push(
      `Database has ${sasamsDbCount} SA-SAMS classrooms after import (expected ${DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT})`
    );
  }

  try {
    assertDaSilvaMigrationGates({
      phase: "classrooms",
      classroomNames: postDbNames,
      errors: postImportValidation.passed ? [] : postImportValidation.errors,
    });
  } catch (e) {
    postImportValidation.passed = false;
    if (e instanceof Error) postImportValidation.errors.push(e.message);
  }

  writeDaSilvaMigrationAudit(opts.schoolId, opts.projectId, {
    strategy: DA_SILVA_MIGRATION_STRATEGY,
    phase: "classrooms",
    generatedAt: new Date().toISOString(),
    schoolId: opts.schoolId,
    projectId: opts.projectId,
    passed: postImportValidation.passed,
    summary: {
      classrooms: postDb.length,
      sasamsClassrooms: sasamsDbCount,
      supplementClassrooms: supplementCount,
      expectedSasamsClassrooms: DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT,
    },
    unmatchedLearners: [],
    unmatchedParents: [],
    duplicateMatches: [],
    billingAccountsNotMatched: [],
    errors: postImportValidation.errors,
  });

  return {
    success: postImportValidation.passed,
    validation,
    postImportValidation,
    manifest,
    imported: { classrooms: manifest.classroomIds.length },
  };
}

export type DaSilvaSasamsLearnerIngestPaths = DaSilvaSasamsIngestPaths;

export type DaSilvaLearnerImportRow = {
  matchKey: string;
  firstName: string;
  lastName: string;
  fullName: string;
  className: string;
  canonicalClassName: string;
  grade: string;
  admissionNo: string | null;
  idNumber: string | null;
  birthDate: Date | null;
  gender: string | null;
  homeLanguage: string | null;
  citizenship: string | null;
  enrichedFromRegister: boolean;
};

export type DaSilvaLearnerParseAudit = {
  classListParsed: number;
  registerParsed: number;
  mergedTotal: number;
  enrichedFromRegister: number;
  registerOnlySkipped: number;
  missingDob: number;
  missingGender: number;
  missingId: number;
  perClassroomCounts: Array<{ classroomName: string; count: number }>;
};

export type DaSilvaLearnerImportIssue = {
  matchKey: string;
  fullName: string;
  reason: string;
};

export type DaSilvaLearnerValidation = {
  passed: boolean;
  expectedTotal: number;
  actualTotal: number;
  orphanCount: number;
  orphans: Array<{ id: string; firstName: string; lastName: string; className: string | null }>;
  classroomCounts: Array<{
    classroomName: string;
    expected: number;
    actual: number;
    match: boolean;
  }>;
  errors: string[];
};

function sasamsLearnerToImportRow(
  learner: SasamsParsedLearner,
  enrichedFromRegister = false
): DaSilvaLearnerImportRow {
  const norm = normalizeClassroomInput(learner.className);
  return {
    matchKey: learner.matchKey,
    firstName: learner.firstName,
    lastName: learner.lastName,
    fullName: learner.fullName,
    className: learner.className,
    canonicalClassName: learner.canonicalClassName,
    grade: learner.grade || norm.gradeLabel || "",
    admissionNo: learner.admissionNo,
    idNumber: learner.idNumber,
    birthDate: learner.birthDate,
    gender: learner.gender,
    homeLanguage: learner.language,
    citizenship: learner.citizenship,
    enrichedFromRegister,
  };
}

export function buildDaSilvaLearnerParseAudit(
  classListLearners: SasamsParsedLearner[],
  merged: SasamsParsedLearner[],
  mergeAudit: SasamsLearnerMergeAudit
): DaSilvaLearnerParseAudit {
  const perClassroomCounts = new Map<string, number>();
  let missingDob = 0;
  let missingGender = 0;
  let missingId = 0;

  for (const row of merged) {
    perClassroomCounts.set(
      row.canonicalClassName,
      (perClassroomCounts.get(row.canonicalClassName) || 0) + 1
    );
    if (!row.birthDate) missingDob += 1;
    if (!row.gender) missingGender += 1;
    if (!row.idNumber) missingId += 1;
  }

  return {
    classListParsed: classListLearners.length,
    registerParsed: mergeAudit.registerParsed,
    mergedTotal: merged.length,
    enrichedFromRegister: mergeAudit.enrichedFromRegister,
    registerOnlySkipped: mergeAudit.registerOnlySkipped,
    missingDob,
    missingGender,
    missingId,
    perClassroomCounts: Array.from(perClassroomCounts.entries())
      .map(([classroomName, count]) => ({ classroomName, count }))
      .sort((a, b) => a.classroomName.localeCompare(b.classroomName)),
  };
}

/** Parse learners: class lists primary, learner register enriches missing fields only. */
export function parseDaSilvaLearnersFromSasams(
  paths: DaSilvaSasamsIngestPaths,
  auditOut?: { audit: DaSilvaLearnerParseAudit }
): DaSilvaLearnerImportRow[] {
  const { learners: classListLearners } = parseSasamsClassListDirectory(paths.classListDir);
  const registerLearners = parseSasamsLearnerRegister(paths.learnerRegister);
  const mergeAudit: SasamsLearnerMergeAudit = {
    classListParsed: 0,
    registerParsed: 0,
    mergedTotal: 0,
    enrichedFromRegister: 0,
    registerOnlySkipped: 0,
  };
  const merged = mergeSasamsLearnerSources(classListLearners, registerLearners, mergeAudit);

  const byKey = new Map<string, DaSilvaLearnerImportRow>();

  for (const learner of merged) {
    byKey.set(learner.matchKey, sasamsLearnerToImportRow(learner, Boolean(learner.enrichedFromRegister)));
  }

  if (auditOut) {
    auditOut.audit = buildDaSilvaLearnerParseAudit(classListLearners, merged, mergeAudit);
  }

  return Array.from(byKey.values());
}

/** @deprecated Use parseDaSilvaLearnersFromSasams */
export function parseDaSilvaLearnersFromClassList(classListDir: string): DaSilvaLearnerImportRow[] {
  return parseDaSilvaLearnersFromSasams({
    classListDir,
    learnerRegister: classListDir,
    parentRegister: classListDir,
  });
}

/** Validate SA-SAMS learner totals before/after learners-only import. */
export async function validateDaSilvaLearnersFromKidESys(
  paths: DaSilvaSasamsIngestPaths | string,
  schoolId?: string
): Promise<DaSilvaLearnerValidation> {
  const ingest =
    typeof paths === "string"
      ? ({
          classListDir: paths,
          learnerRegister: paths,
          parentRegister: paths,
        } as DaSilvaSasamsIngestPaths)
      : paths;
  return validateDaSilvaLearnersInDatabase(ingest, schoolId);
}

async function validateDaSilvaLearnersInDatabase(
  paths: DaSilvaSasamsIngestPaths,
  schoolId?: string
): Promise<DaSilvaLearnerValidation> {
  const errors: string[] = [];
  const sourceRows = parseDaSilvaLearnersFromSasams(paths);
  const expectedByClass = new Map<string, number>();
  for (const row of sourceRows) {
    expectedByClass.set(
      row.canonicalClassName,
      (expectedByClass.get(row.canonicalClassName) || 0) + 1
    );
  }

  const expectedSasamsTotal = DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT;
  if (sourceRows.length !== expectedSasamsTotal) {
    errors.push(
      `Expected ${expectedSasamsTotal} SA-SAMS class-list learners, found ${sourceRows.length} (final roster ${DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} includes Crèche supplement ${DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT})`
    );
  }

  for (const [name, count] of Object.entries(DA_SILVA_EXPECTED_SASAMS_CLASSROOM_LEARNER_COUNTS)) {
    const actual = expectedByClass.get(name) || 0;
    if (actual !== count) {
      errors.push(`SA-SAMS ${name}: expected ${count} learners, found ${actual}`);
    }
  }
  const crecheInSasams = expectedByClass.get("Creche") || 0;
  if (crecheInSasams > 0) {
    errors.push(
      `Crèche must not appear in SA-SAMS class lists (found ${crecheInSasams}); use Kid-e-Sys supplement for ${DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT} Crèche learners`
    );
  }

  let actualTotal = sourceRows.length;
  let orphanCount = 0;
  let orphans: DaSilvaLearnerValidation["orphans"] = [];
  const actualByClass = new Map<string, number>();

  if (schoolId) {
    const dbLearners = await prisma.learner.findMany({
      where: { schoolId },
      select: { id: true, firstName: true, lastName: true, className: true },
    });
    actualTotal = dbLearners.length;
    if (!isAcceptableDaSilvaPhase2LearnerCount(actualTotal) && !isAcceptableDaSilvaPhase3LearnerCount(actualTotal)) {
      errors.push(
        `Database has ${actualTotal} learners (expected ${DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS-only, or ${DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} after Crèche supplement)`
      );
    }

    const classroomNames = new Set(
      (
        await prisma.classroom.findMany({
          where: { schoolId },
          select: { name: true },
        })
      ).map((c) => c.name)
    );

    for (const learner of dbLearners) {
      const className = String(learner.className || "").trim();
      if (!className || !classroomNames.has(className)) {
        orphanCount += 1;
        orphans.push(learner);
      } else {
        actualByClass.set(className, (actualByClass.get(className) || 0) + 1);
      }
    }

    if (orphanCount > 0) {
      errors.push(`${orphanCount} orphan learner(s) not linked to a classroom`);
    }

    for (const [name, expected] of Object.entries(DA_SILVA_EXPECTED_SASAMS_CLASSROOM_LEARNER_COUNTS)) {
      const actual = actualByClass.get(name) || 0;
      if (actual !== expected) {
        errors.push(`Database ${name}: expected ${expected} learners, found ${actual}`);
      }
    }
  }

  const classroomCounts = Object.entries(DA_SILVA_EXPECTED_SASAMS_CLASSROOM_LEARNER_COUNTS)
    .map(([classroomName, expected]) => {
      const actual = schoolId ? actualByClass.get(classroomName) || 0 : expectedByClass.get(classroomName) || 0;
      return {
        classroomName,
        expected,
        actual,
        match: actual === expected,
      };
    })
    .sort((a, b) => a.classroomName.localeCompare(b.classroomName));

  return {
    passed: errors.length === 0,
    expectedTotal: expectedSasamsTotal,
    actualTotal,
    orphanCount,
    orphans,
    classroomCounts,
    errors,
  };
}

export type DaSilvaLearnerImportAudit = {
  parse: DaSilvaLearnerParseAudit;
  learnersCreated: number;
  learnersUpdated: number;
};

/**
 * Phase 2 only: import learners from SA-SAMS class lists (primary) + learner register (enrichment).
 * Does not import parents, billing, employees, or ledger entries.
 */
export async function commitDaSilvaLearnersOnly(opts: {
  schoolId: string;
  projectId: string;
  sasamsPaths: DaSilvaSasamsIngestPaths;
}): Promise<{
  success: boolean;
  validation: DaSilvaLearnerValidation;
  postImportValidation: DaSilvaLearnerValidation;
  manifest: DaSilvaImportManifest;
  imported: { learners: number };
  audit: DaSilvaLearnerImportAudit;
  failed: DaSilvaLearnerImportIssue[];
  skipped: DaSilvaLearnerImportIssue[];
}> {
  const school = await prisma.school.findUnique({
    where: { id: opts.schoolId },
    select: { id: true },
  });
  if (!school) throw new Error("School not found");

  const classroomValidation = validateDaSilvaClassroomsFromKidESys(opts.sasamsPaths.classListDir);
  const parseAuditHolder: { audit: DaSilvaLearnerParseAudit } = {
    audit: {
      classListParsed: 0,
      registerParsed: 0,
      mergedTotal: 0,
      enrichedFromRegister: 0,
      registerOnlySkipped: 0,
      missingDob: 0,
      missingGender: 0,
      missingId: 0,
      perClassroomCounts: [],
    },
  };
  const classroomRows = parseDaSilvaLearnersFromSasams(opts.sasamsPaths, parseAuditHolder);
  if (!classroomValidation.passed) {
    throw new Error(`Classroom validation failed: ${classroomValidation.errors.join("; ")}`);
  }
  if (parseAuditHolder.audit.classListParsed !== DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT) {
    throw new Error(
      `Expected ${DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS class-list learners, found ${parseAuditHolder.audit.classListParsed}`
    );
  }

  const dbClassrooms = await prisma.classroom.findMany({
    where: { schoolId: opts.schoolId },
    select: { name: true },
  });
  const dbClassroomNames = dbClassrooms.map((c) => c.name);
  const sasamsDbClassrooms = countDaSilvaSasamsClassrooms(dbClassroomNames);
  if (sasamsDbClassrooms !== DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT) {
    throw new Error(
      `Phase 1 required: database has ${sasamsDbClassrooms} SA-SAMS classrooms (expected ${DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT}). Run da-silva-classrooms-only.ts first.`
    );
  }
  const classroomNameSet = new Set(dbClassrooms.map((c) => c.name));

  const existingParents = await prisma.parent.count({ where: { schoolId: opts.schoolId } });
  const existingEmployees = await prisma.employee.count({ where: { schoolId: opts.schoolId } });
  if (existingParents > 0) {
    throw new Error(`BLOCKED: school already has ${existingParents} parent(s) — learners-only import expects none`);
  }
  if (existingEmployees > 0) {
    throw new Error(
      `BLOCKED: school already has ${existingEmployees} employee(s) — learners-only import expects none`
    );
  }

  const existingManifest = loadDaSilvaManifest(opts.schoolId, opts.projectId);
  if (!existingManifest) {
    throw new Error(
      `No manifest for project ${opts.projectId}. Run da-silva-classrooms-only.ts first with the same project id.`
    );
  }
  if (!existingManifest.phasesCompleted?.includes("classrooms")) {
    throw new Error("Phase 1 (classrooms) not completed in manifest — run da-silva-classrooms-only.ts first.");
  }

  const manifest: DaSilvaImportManifest = {
    ...existingManifest,
    learnerIds: existingManifest.learnerIds || [],
    parentIds: existingManifest.parentIds || [],
    linkIds: existingManifest.linkIds || [],
    classroomIds: existingManifest.classroomIds || [],
    employeeIds: existingManifest.employeeIds || [],
    ledgerEntryIds: existingManifest.ledgerEntryIds || [],
    matchKeyToLearnerId: existingManifest.matchKeyToLearnerId || {},
    phasesCompleted: existingManifest.phasesCompleted || [],
  };

  const preValidation = await validateDaSilvaLearnersInDatabase(opts.sasamsPaths);
  const failed: DaSilvaLearnerImportIssue[] = [];
  const skipped: DaSilvaLearnerImportIssue[] = [];
  const matchKeyToLearnerId = new Map(Object.entries(manifest.matchKeyToLearnerId || {}));
  let learnersCreated = 0;
  let learnersUpdated = 0;

  await runDaSilvaImportPhase(manifest, "learners", opts.schoolId, opts.projectId, async () => {
    let rowIndex = 0;
    for (const row of classroomRows) {
      rowIndex += 1;
      if (!classroomNameSet.has(row.canonicalClassName)) {
        failed.push({
          matchKey: row.matchKey,
          fullName: row.fullName,
          reason: `Classroom "${row.canonicalClassName}" not found in database`,
        });
        continue;
      }

      let learnerId =
        manifest.matchKeyToLearnerId?.[row.matchKey] || matchKeyToLearnerId.get(row.matchKey) || null;

      if (!learnerId) {
        learnerId = await findExistingLearnerIdForImportRow({
          schoolId: opts.schoolId,
          firstName: row.firstName,
          lastName: row.lastName,
          className: row.canonicalClassName,
          admissionNo: row.admissionNo,
        });
      }

      const norm = normalizeClassroomInput(row.canonicalClassName);
      const learnerData = {
        schoolId: opts.schoolId,
        firstName: row.firstName,
        lastName: row.lastName,
        grade: row.grade || norm.gradeLabel || "",
        className: row.canonicalClassName,
        admissionNo: row.admissionNo,
        idNumber: row.idNumber,
        birthDate: row.birthDate,
        gender: row.gender,
        homeLanguage: row.homeLanguage,
        citizenship: row.citizenship,
        enrollmentStatus: "ACTIVE" as const,
        totalFee: 0,
        tuitionFee: 0,
      };

      try {
        if (learnerId) {
          const existing = await prisma.learner.findUnique({
            where: { id: learnerId },
            select: { className: true },
          });
          if (
            existing &&
            existing.className === row.canonicalClassName &&
            manifest.matchKeyToLearnerId?.[row.matchKey]
          ) {
            skipped.push({
              matchKey: row.matchKey,
              fullName: row.fullName,
              reason: "Already imported (manifest match)",
            });
          } else {
            await prisma.learner.update({
              where: { id: learnerId },
              data: learnerData,
            });
            learnersUpdated += 1;
          }
        } else {
          const created = await prisma.learner.create({ data: learnerData });
          learnerId = created.id;
          learnersCreated += 1;
        }
      } catch (err) {
        failed.push({
          matchKey: row.matchKey,
          fullName: row.fullName,
          reason: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      pushUniqueId(manifest.learnerIds, learnerId);
      matchKeyToLearnerId.set(row.matchKey, learnerId);

      if (rowIndex % 40 === 0) {
        manifest.matchKeyToLearnerId = Object.fromEntries(matchKeyToLearnerId);
        writeDaSilvaManifest(opts.schoolId, opts.projectId, manifest);
      }
    }

    manifest.matchKeyToLearnerId = Object.fromEntries(matchKeyToLearnerId);
  });

  writeDaSilvaManifest(opts.schoolId, opts.projectId, manifest);

  const postImportValidation = await validateDaSilvaLearnersInDatabase(
    opts.sasamsPaths,
    opts.schoolId
  );
  if (failed.length > 0) {
    postImportValidation.passed = false;
    postImportValidation.errors.push(`${failed.length} learner(s) failed to import`);
  }

  try {
    assertDaSilvaMigrationGates({
      phase: "learners",
      classroomNames: dbClassroomNames,
      learnerCount: manifest.learnerIds.length,
      phasesCompleted: manifest.phasesCompleted,
      errors: postImportValidation.passed ? [] : postImportValidation.errors,
    });
  } catch (e) {
    postImportValidation.passed = false;
    if (e instanceof Error) postImportValidation.errors.push(e.message);
  }

  writeDaSilvaMigrationAudit(opts.schoolId, opts.projectId, {
    strategy: DA_SILVA_MIGRATION_STRATEGY,
    phase: "learners",
    generatedAt: new Date().toISOString(),
    schoolId: opts.schoolId,
    projectId: opts.projectId,
    passed: postImportValidation.passed && failed.length === 0,
    summary: { learners: manifest.learnerIds.length },
    unmatchedLearners: failed.map((f) => ({ matchKey: f.matchKey, fullName: f.fullName, reason: f.reason })),
    unmatchedParents: [],
    duplicateMatches: [],
    billingAccountsNotMatched: [],
    errors: postImportValidation.errors,
  });

  const importAudit: DaSilvaLearnerImportAudit = {
    parse: parseAuditHolder.audit,
    learnersCreated,
    learnersUpdated,
  };

  return {
    success: postImportValidation.passed && failed.length === 0,
    validation: preValidation,
    postImportValidation,
    manifest,
    imported: { learners: manifest.learnerIds.length },
    audit: importAudit,
    failed,
    skipped,
  };
}

/** SA-SAMS phase 3 — parents and parent-learner links only (no Kid-e-Sys billing refs). */
export type DaSilvaParentsIngestPaths = {
  parentRegister: string;
  parentLearnerLinks: string;
};

/** Legacy Kid-e-Sys parent staging (repair scripts only). */
export type DaSilvaKideesysParentsIngestPaths = {
  classListDir: string;
  contactList: string;
  ageAnalysis: string;
};

export type DaSilvaParentsStagingValidation = {
  passed: boolean;
  expectedParentLinks: number;
  actualParentLinks: number;
  expectedUniqueParents: number;
  actualUniqueParents: number;
  expectedFamilyAccounts: number;
  actualFamilyAccounts: number;
  learnersWithoutAccount: string[];
  errors: string[];
};

export type DaSilvaParentsDbValidation = {
  passed: boolean;
  parents: number;
  familyAccounts: number;
  links: number;
  orphanParents: Array<{ id: string; firstName: string; surname: string }>;
  duplicateAccountRefs: string[];
  learnersWithoutFamilyAccount: Array<{ id: string; firstName: string; lastName: string }>;
  learnersWrongFamilyAccount: Array<{
    id: string;
    name: string;
    expectedAccountRef: string;
    actualAccountRef: string | null;
  }>;
  errors: string[];
};

/** Kid-e-Sys parents + family account refs (contact list + age analysis only — no billing/ledger). */
export function buildDaSilvaParentsStagedLearners(
  paths: DaSilvaKideesysParentsIngestPaths
): DaSilvaStagedLearner[] {
  const { learners: sasamsClassLearners } = parseSasamsClassListDirectory(paths.classListDir);
  const classLearners = sasamsLearnersToParsedLearners(sasamsClassLearners);
  const contacts = parseContactListFile(paths.contactList);
  const accounts = parseAgeAnalysisFile(paths.ageAnalysis);
  const contactByKey = new Map(contacts.map((c) => [c.matchKey, c]));
  const accountByName = new Map<string, string>();
  indexAgeAnalysisAccountNames(accounts, accountByName);
  const uniqueClassLearners = uniqueLearnersByMatchKey(classLearners);
  const familyIndex = buildFamilyAccountIndex(accounts, [], uniqueClassLearners, contacts, []);
  const staged: DaSilvaStagedLearner[] = [];

  for (const learner of uniqueClassLearners) {
    const norm = normalizeClassroomInput(learner.className);
    const canonicalClassName = norm.classroomName || learner.className;
    const contact = contactByKey.get(learner.matchKey);

    let accountNo = accountByName.get(normalizeMatchText(learner.fullName)) || "";
    if (!accountNo) {
      accountNo = findAccountForLearnerName(learner.fullName, accounts, familyIndex);
    }
    const ageRow = accounts.find(
      (a) =>
        a.accountNo === accountNo ||
        normalizeMatchText(a.fullName) === normalizeMatchText(learner.fullName) ||
        (a.learnerNames || splitMergedAccountNames(a.fullName)).some(
          (n) => normalizeMatchText(n) === normalizeMatchText(learner.fullName)
        )
    );

    staged.push({
      matchKey: learner.matchKey,
      fullName: learner.fullName,
      firstName: learner.firstName,
      lastName: learner.lastName,
      className: learner.className,
      canonicalClassName,
      accountNo:
        (accountNo && isKidESysSourceAccountRef(accountNo) ? accountNo : "") ||
        (ageRow?.accountNo && isKidESysSourceAccountRef(ageRow.accountNo) ? ageRow.accountNo : ""),
      billingPlan: [],
      billingPlanTotal: 0,
      ageAnalysisBalance: 0,
      parents: contact?.parents || [],
    });
  }

  return staged;
}

function countUniqueParentsInStaging(staged: DaSilvaStagedLearner[]): number {
  const keys = new Set<string>();
  for (const row of staged) {
    for (const parent of row.parents) {
      const phone = normalizeSaPhone(parent.cellNo || parent.homeNo || "");
      const cellNo = phone?.localCell || parent.cellNo || "";
      keys.add(
        [parent.firstName, parent.surname, cellNo, String(row.accountNo || "").trim()].join("|")
      );
    }
  }
  return keys.size;
}

export function validateDaSilvaParentsStaging(
  paths: DaSilvaKideesysParentsIngestPaths
): DaSilvaParentsStagingValidation {
  const staged = buildDaSilvaParentsStagedLearners(paths);
  const errors: string[] = [];
  const parentLinkCount = staged.reduce((s, row) => s + row.parents.length, 0);
  const uniqueParentCount = countUniqueParentsInStaging(staged);
  const accountNos = new Set(
    staged.map((row) => String(row.accountNo || "").trim()).filter(Boolean)
  );
  const learnersWithoutAccount = staged
    .filter((row) => !String(row.accountNo || "").trim())
    .map((row) => row.fullName);

  if (parentLinkCount !== DA_SILVA_EXPECTED_PARENT_LINK_COUNT) {
    errors.push(
      `Expected ${DA_SILVA_EXPECTED_PARENT_LINK_COUNT} parent slots in contact list, found ${parentLinkCount}`
    );
  }
  if (uniqueParentCount !== DA_SILVA_EXPECTED_UNIQUE_PARENT_COUNT) {
    errors.push(
      `Expected ${DA_SILVA_EXPECTED_UNIQUE_PARENT_COUNT} unique parents in contact list, found ${uniqueParentCount}`
    );
  }
  if (accountNos.size !== DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT) {
    errors.push(
      `Expected ${DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT} family account refs on learners, found ${accountNos.size}`
    );
  }
  if (learnersWithoutAccount.length) {
    errors.push(`${learnersWithoutAccount.length} learner(s) missing billing account ref`);
  }
  if (staged.length !== DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT) {
    errors.push(
      `Expected ${DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} staged learners, found ${staged.length}`
    );
  }

  return {
    passed: errors.length === 0,
    expectedParentLinks: DA_SILVA_EXPECTED_PARENT_LINK_COUNT,
    actualParentLinks: parentLinkCount,
    expectedUniqueParents: DA_SILVA_EXPECTED_UNIQUE_PARENT_COUNT,
    actualUniqueParents: uniqueParentCount,
    expectedFamilyAccounts: DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT,
    actualFamilyAccounts: accountNos.size,
    learnersWithoutAccount,
    errors,
  };
}

export async function validateDaSilvaParentsInDatabase(
  schoolId: string,
  staged: DaSilvaStagedLearner[],
  matchKeyToLearnerId: Record<string, string> = {}
): Promise<DaSilvaParentsDbValidation> {
  const errors: string[] = [];
  const parents = await prisma.parent.count({ where: { schoolId } });
  const familyAccounts = await prisma.familyAccount.count({ where: { schoolId } });
  const links = await prisma.parentLearnerLink.count({ where: { schoolId } });

  if (parents !== DA_SILVA_EXPECTED_UNIQUE_PARENT_COUNT) {
    errors.push(
      `Database has ${parents} unique parents (expected ${DA_SILVA_EXPECTED_UNIQUE_PARENT_COUNT})`
    );
  }
  if (familyAccounts !== DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT) {
    errors.push(
      `Database has ${familyAccounts} family accounts (expected ${DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT})`
    );
  }
  if (links !== DA_SILVA_EXPECTED_PARENT_LINK_COUNT) {
    errors.push(
      `Database has ${links} parent-learner links (expected ${DA_SILVA_EXPECTED_PARENT_LINK_COUNT})`
    );
  }

  const orphanParents = await prisma.parent.findMany({
    where: {
      schoolId,
      links: { none: {} },
    },
    select: { id: true, firstName: true, surname: true },
  });
  if (orphanParents.length) {
    errors.push(`${orphanParents.length} orphan parent(s) with no learner link`);
  }

  const familyRows = await prisma.familyAccount.findMany({
    where: { schoolId },
    select: { accountRef: true },
  });
  const refCounts = new Map<string, number>();
  for (const row of familyRows) {
    const ref = String(row.accountRef || "").trim();
    refCounts.set(ref, (refCounts.get(ref) || 0) + 1);
  }
  const duplicateAccountRefs = [...refCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([ref]) => ref);
  if (duplicateAccountRefs.length) {
    errors.push(`Duplicate family account refs: ${duplicateAccountRefs.join(", ")}`);
  }

  const learnersWithoutFamilyAccount = await prisma.learner.findMany({
    where: { schoolId, familyAccountId: null },
    select: { id: true, firstName: true, lastName: true },
  });
  if (learnersWithoutFamilyAccount.length) {
    errors.push(
      `${learnersWithoutFamilyAccount.length} learner(s) without a family account`
    );
  }

  const accountRefById = new Map(
    (
      await prisma.familyAccount.findMany({
        where: { schoolId },
        select: { id: true, accountRef: true },
      })
    ).map((row) => [row.id, row.accountRef])
  );
  const learnersWrongFamilyAccount: DaSilvaParentsDbValidation["learnersWrongFamilyAccount"] =
    [];
  const dbLearners = await prisma.learner.findMany({
    where: { schoolId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      familyAccountId: true,
    },
  });
  const learnerIdByMatchKey = new Map(Object.entries(matchKeyToLearnerId));

  for (const row of staged) {
    const learnerId = learnerIdByMatchKey.get(row.matchKey);
    if (!learnerId) continue;
    const expectedRef = String(row.accountNo || "").trim();
    if (!expectedRef) continue;
    const dbLearner = dbLearners.find((l) => l.id === learnerId);
    const actualRef = dbLearner?.familyAccountId
      ? accountRefById.get(dbLearner.familyAccountId) || null
      : null;
    if (actualRef !== expectedRef) {
      learnersWrongFamilyAccount.push({
        id: learnerId,
        name: row.fullName,
        expectedAccountRef: expectedRef,
        actualAccountRef: actualRef,
      });
    }
  }
  if (learnersWrongFamilyAccount.length) {
    errors.push(
      `${learnersWrongFamilyAccount.length} learner(s) linked to wrong family account`
    );
  }

  return {
    passed: errors.length === 0,
    parents,
    familyAccounts,
    links,
    orphanParents,
    duplicateAccountRefs,
    learnersWithoutFamilyAccount,
    learnersWrongFamilyAccount,
    errors,
  };
}

export type DaSilvaSasamsParentsStagingValidation = {
  passed: boolean;
  parentRows: number;
  expectedParentLinks: number;
  actualParentLinks: number;
  unmatchedParents: number;
  duplicateMatches: number;
  errors: string[];
};

async function validateDaSilvaSasamsParentsInDatabase(schoolId: string): Promise<{
  passed: boolean;
  parents: number;
  links: number;
  orphanParents: Array<{ id: string; firstName: string; surname: string }>;
  errors: string[];
}> {
  const errors: string[] = [];
  const parents = await prisma.parent.count({ where: { schoolId } });
  const links = await prisma.parentLearnerLink.count({ where: { schoolId } });
  const familyAccounts = await prisma.familyAccount.count({ where: { schoolId } });

  if (familyAccounts > 0) {
    errors.push(
      `Phase 3 must not create family accounts (${familyAccounts} found) — run phase 4 billing match first`
    );
  }
  if (links < 1) {
    errors.push("No parent-learner links created");
  } else if (links !== DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT) {
    errors.push(
      `Database has ${links} parent-learner links (expected ${DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT})`
    );
  }

  const orphanParents = await prisma.parent.findMany({
    where: { schoolId, links: { none: {} } },
    select: { id: true, firstName: true, surname: true },
  });
  if (orphanParents.length) {
    errors.push(`${orphanParents.length} orphan parent(s) with no learner link`);
  }

  return { passed: errors.length === 0, parents, links, orphanParents, errors };
}

/**
 * Phase 3 only: SA-SAMS parents/guardians and parent-learner links (archived flag ignored).
 * Does not import Kid-e-Sys billing, family accounts, ledger, or employees.
 */
export async function commitDaSilvaParentsOnly(opts: {
  schoolId: string;
  projectId: string;
  paths: DaSilvaParentsIngestPaths;
}): Promise<{
  success: boolean;
  stagingValidation: DaSilvaSasamsParentsStagingValidation;
  postImportValidation: Awaited<ReturnType<typeof validateDaSilvaSasamsParentsInDatabase>>;
  manifest: DaSilvaImportManifest;
  imported: { parents: number; familyAccounts: number; links: number };
  missingLearnerKeys: string[];
}> {
  const school = await prisma.school.findUnique({
    where: { id: opts.schoolId },
    select: { id: true },
  });
  if (!school) throw new Error("School not found");

  const sasamsParents = parseSasamsParentSources(
    opts.paths.parentRegister,
    opts.paths.parentLearnerLinks
  );
  const dbLearners = await prisma.learner.findMany({
    where: { schoolId: opts.schoolId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      className: true,
      admissionNo: true,
      idNumber: true,
    },
  });
  if (!isAcceptableDaSilvaPhase3LearnerCount(dbLearners.length)) {
    throw new Error(
      `Phase 2 required: database has ${dbLearners.length} learners (expected ${DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS or ${DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} after Crèche supplement)`
    );
  }

  const parentAudit = auditParentMatches(sasamsParents, dbLearners);
  const indexes = buildLearnerMatchIndexes(dbLearners);
  const learnersById = new Map(dbLearners.map((l) => [l.id, l]));

  const stagingErrors: string[] = [];
  if (parentAudit.unmatchedParents.length > DA_SILVA_BILLING_MATCH_MAX_UNMATCHED) {
    stagingErrors.push(
      `${parentAudit.unmatchedParents.length} SA-SAMS parent row(s) could not be matched to learners`
    );
  }
  if (parentAudit.duplicateMatches.length > 0) {
    stagingErrors.push(
      `${parentAudit.duplicateMatches.length} parent row(s) have ambiguous learner matches`
    );
  }

  const stagingValidation: DaSilvaSasamsParentsStagingValidation = {
    passed: stagingErrors.length === 0,
    parentRows: sasamsParents.length,
    expectedParentLinks: DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT,
    actualParentLinks: sasamsParents.length - parentAudit.unmatchedParents.length,
    unmatchedParents: parentAudit.unmatchedParents.length,
    duplicateMatches: parentAudit.duplicateMatches.length,
    errors: stagingErrors,
  };

  const existingParents = await prisma.parent.count({ where: { schoolId: opts.schoolId } });
  const existingEmployees = await prisma.employee.count({ where: { schoolId: opts.schoolId } });
  if (
    existingParents > 0 &&
    !loadDaSilvaManifest(opts.schoolId, opts.projectId)?.phasesCompleted?.includes("parents")
  ) {
    throw new Error(
      `BLOCKED: school already has ${existingParents} parent(s) but manifest parents phase not recorded`
    );
  }
  if (existingEmployees > 0) {
    throw new Error(
      `BLOCKED: school already has ${existingEmployees} employee(s) — parents-only import expects none`
    );
  }

  if (readSchoolLedger(opts.schoolId).length > 0) {
    throw new Error("BLOCKED: billing ledger already has entries for this school");
  }
  if (Object.keys(readSchoolBillingPlans(opts.schoolId)).length > 0) {
    throw new Error("BLOCKED: learner billing plans already exist for this school");
  }

  const existingManifest = loadDaSilvaManifest(opts.schoolId, opts.projectId);
  if (!existingManifest) {
    throw new Error(`No manifest for project ${opts.projectId}. Complete phases 1–2 first.`);
  }
  if (!existingManifest.phasesCompleted?.includes("classrooms")) {
    throw new Error("Phase 1 (classrooms) not completed.");
  }
  if (!existingManifest.phasesCompleted?.includes("learners")) {
    throw new Error("Phase 2 (learners) not completed.");
  }

  const manifest: DaSilvaImportManifest = {
    ...existingManifest,
    parentIds: existingManifest.parentIds || [],
    linkIds: existingManifest.linkIds || [],
    stagedParentIds: existingManifest.stagedParentIds || {},
    matchKeyToLearnerId: existingManifest.matchKeyToLearnerId || {},
    phasesCompleted: existingManifest.phasesCompleted || [],
  };

  const missingLearnerKeys: string[] = [];
  let parentIndex = 0;

  await runDaSilvaImportPhase(manifest, "parents", opts.schoolId, opts.projectId, async () => {
    if (!manifest.stagedParentIds) manifest.stagedParentIds = {};

    for (const parentRow of sasamsParents) {
      parentIndex += 1;
      const match = matchParentToLearner(parentRow, indexes, learnersById);
      if (!match.learnerId || match.ambiguous) continue;

      const stageKey = `sasams-parent:${parentIndex}`;
      if (manifest.stagedParentIds![stageKey]) continue;

      const phone = normalizeSaPhone(parentRow.cellNo || parentRow.homeNo || "");
      const cellNo = phone?.localCell || parentRow.cellNo || "0000000000";

      const existingParent = await prisma.parent.findFirst({
        where: {
          schoolId: opts.schoolId,
          firstName: parentRow.firstName,
          surname: parentRow.surname,
          cellNo,
          familyAccountId: null,
        },
        select: { id: true },
      });

      const parentId =
        existingParent?.id ||
        (
          await prisma.parent.create({
            data: {
              schoolId: opts.schoolId,
              familyAccountId: null,
              firstName: parentRow.firstName,
              surname: parentRow.surname,
              cellNo,
              email: parentRow.email || null,
              idNumber: parentRow.idNumber,
              relationship: parentRow.relation,
              workNo: parentRow.workNo || null,
              homeNo: parentRow.homeNo || null,
              outstandingAmount: 0,
            },
            select: { id: true },
          })
        ).id;

      manifest.stagedParentIds![stageKey] = parentId;
      pushUniqueId(manifest.parentIds, parentId);

      const link = await prisma.parentLearnerLink.upsert({
        where: { parentId_learnerId: { parentId, learnerId: match.learnerId } },
        create: {
          schoolId: opts.schoolId,
          parentId,
          learnerId: match.learnerId,
          relation: parentRow.relation,
          isPrimary: true,
        },
        update: {},
        select: { id: true },
      });
      pushUniqueId(manifest.linkIds, link.id);
    }
  });

  writeDaSilvaManifest(opts.schoolId, opts.projectId, manifest);

  const postImportValidation = await validateDaSilvaSasamsParentsInDatabase(opts.schoolId);

  try {
    assertDaSilvaMigrationGates({
      phase: "parents",
      learnerCount: dbLearners.length,
      parentLinkCount: postImportValidation.links,
      phasesCompleted: manifest.phasesCompleted,
      errors: [...stagingValidation.errors, ...postImportValidation.errors],
    });
  } catch (e) {
    postImportValidation.passed = false;
    if (e instanceof Error) postImportValidation.errors.push(e.message);
  }

  writeDaSilvaMigrationAudit(opts.schoolId, opts.projectId, {
    strategy: DA_SILVA_MIGRATION_STRATEGY,
    phase: "parents",
    generatedAt: new Date().toISOString(),
    schoolId: opts.schoolId,
    projectId: opts.projectId,
    passed: postImportValidation.passed && stagingValidation.passed,
    summary: {
      parents: manifest.parentIds.length,
      links: manifest.linkIds.length,
      unmatchedParents: parentAudit.unmatchedParents.length,
    },
    unmatchedLearners: [],
    unmatchedParents: parentAudit.unmatchedParents.map((r) => ({ ...r })),
    duplicateMatches: parentAudit.duplicateMatches.map((r) => ({ ...r })),
    billingAccountsNotMatched: [],
    errors: [...stagingValidation.errors, ...postImportValidation.errors],
  });

  return {
    success: postImportValidation.passed && stagingValidation.passed,
    stagingValidation,
    postImportValidation,
    manifest,
    imported: {
      parents: manifest.parentIds.length,
      familyAccounts: 0,
      links: manifest.linkIds.length,
    },
    missingLearnerKeys,
  };
}

export type DaSilvaBillingMatchIngestPaths = {
  classListDir: string;
  ageAnalysis: string;
};

/**
 * Phase 4: match Kid-e-Sys billing accounts to SA-SAMS learners (no profile overwrite).
 */
export async function commitDaSilvaBillingMatchOnly(opts: {
  schoolId: string;
  projectId: string;
  paths: DaSilvaBillingMatchIngestPaths;
}): Promise<{
  success: boolean;
  manifest: DaSilvaImportManifest;
  matched: number;
  totalAccounts: number;
  auditPath: string;
}> {
  const existingManifest = loadDaSilvaManifest(opts.schoolId, opts.projectId);
  if (!existingManifest) throw new Error(`No manifest for project ${opts.projectId}`);
  if (!existingManifest.phasesCompleted?.includes("parents")) {
    throw new Error("Phase 3 (parents) must complete before billing match");
  }

  const accounts = parseAgeAnalysisFile(opts.paths.ageAnalysis);
  const ageAnalysisAudit = parseAgeAnalysisFileWithAudit(opts.paths.ageAnalysis);
  if (!ageAnalysisAudit.accounts.length || ageAnalysisAudit.audit.headerRowIndex === null) {
    throw new Error("Age analysis parser failed — no accounts or header row detected");
  }

  const { learners: sasamsClassLearners } = parseSasamsClassListDirectory(opts.paths.classListDir);
  const classListLearners = sasamsLearnersToParsedLearners(sasamsClassLearners);
  const dbLearners = await prisma.learner.findMany({
    where: { schoolId: opts.schoolId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      className: true,
      idNumber: true,
      admissionNo: true,
    },
  });
  const dbForMatch = dbLearners.map((l) => ({
    id: l.id,
    firstName: l.firstName,
    lastName: l.lastName,
    className: l.className,
    matchKey: buildLearnerMatchKey(`${l.firstName} ${l.lastName}`, l.className || ""),
    idNumber: l.idNumber,
    admissionNo: l.admissionNo,
  }));

  const secondPassPaths = discoverBillingSecondPassPaths(opts.paths.ageAnalysis);
  const billingPlanItems =
    secondPassPaths.billingPlan && fs.existsSync(secondPassPaths.billingPlan)
      ? parseBillingPlanFile(secondPassPaths.billingPlan)
      : [];
  const transactions =
    secondPassPaths.transactions && fs.existsSync(secondPassPaths.transactions)
      ? parseTransactionListFile(secondPassPaths.transactions)
      : [];
  const contacts =
    secondPassPaths.contactList && fs.existsSync(secondPassPaths.contactList)
      ? parseContactListFile(secondPassPaths.contactList)
      : [];

  const { audit, report } = matchKideesysBillingAccountsWithSecondPass({
    accounts,
    dbLearners: dbForMatch,
    classListLearners,
    mergedFamilyAccountNos: [],
    billingPlanItems,
    transactions,
    contacts,
  });

  const reconciliationReportPath = path.join(
    process.cwd(),
    "kideesys-billing-reconciliation-report.txt"
  );
  const reconciliationJsonPath = path.join(
    process.cwd(),
    "kideesys-billing-reconciliation-report.json"
  );
  const school = await prisma.school.findUnique({
    where: { id: opts.schoolId },
    select: { name: true },
  });
  fs.writeFileSync(
    reconciliationReportPath,
    formatKideesysBillingReconciliationReportText(report, school?.name || opts.schoolId)
  );
  fs.writeFileSync(reconciliationJsonPath, JSON.stringify(report, null, 2));

  const matchedCount = audit.matched.filter((r) => r.learnerId).length;
  assertDaSilvaMigrationGates({
    phase: "billing_match",
    billingMatched: matchedCount,
    billingTotal: accounts.length,
    phasesCompleted: existingManifest.phasesCompleted || [],
  });

  const manifest: DaSilvaImportManifest = {
    ...existingManifest,
    accountToLearnerId: existingManifest.accountToLearnerId || {},
    phasesCompleted: existingManifest.phasesCompleted || [],
  };

  await runDaSilvaImportPhase(manifest, "billing_match", opts.schoolId, opts.projectId, async () => {
    const siblingGroups = groupSiblingAccounts(audit.matched);
    const accountToLearnerId = new Map<string, string>();

    for (const row of audit.matched) {
      if (row.learnerId) accountToLearnerId.set(row.accountNo, row.learnerId);
    }

    for (const [accountNo, learnerIds] of siblingGroups) {
      const familyName =
        dbLearners.find((l) => l.id === learnerIds[0])?.lastName || accountNo;
      const fa = await prisma.familyAccount.upsert({
        where: { accountRef: accountNo },
        create: {
          schoolId: opts.schoolId,
          accountRef: accountNo,
          familyName,
        },
        update: {},
        select: { id: true },
      });

      for (const learnerId of learnerIds) {
        await prisma.learner.update({
          where: { id: learnerId },
          data: { familyAccountId: fa.id },
        });
        accountToLearnerId.set(accountNo, learnerId);
      }
    }

    manifest.accountToLearnerId = Object.fromEntries(accountToLearnerId);
  });

  writeDaSilvaManifest(opts.schoolId, opts.projectId, manifest);

  const auditPath = writeDaSilvaMigrationAudit(opts.schoolId, opts.projectId, {
    strategy: DA_SILVA_MIGRATION_STRATEGY,
    phase: "billing_match",
    generatedAt: new Date().toISOString(),
    schoolId: opts.schoolId,
    projectId: opts.projectId,
    passed: true,
    summary: {
      matched: matchedCount,
      totalAccounts: accounts.length,
      unmatchedLearners: audit.unmatchedLearners.length,
    },
    unmatchedLearners: audit.unmatchedLearners.map((r) => ({ ...r })),
    unmatchedParents: [],
    duplicateMatches: audit.duplicateMatches.map((r) => ({ ...r })),
    billingAccountsNotMatched: audit.unmatchedAccounts.map((r) => ({ ...r })),
    billingReconciliation: {
      firstPassMatched: report.firstPassMatched,
      secondPassAutoMatched: report.secondPassAutoMatched,
      manualReviewCount: report.manualReviewRequired.length,
      stillUnmatched: report.stillUnmatched,
      reportPath: reconciliationReportPath,
    },
    errors: [],
  });

  return {
    success: true,
    manifest,
    matched: matchedCount,
    totalAccounts: accounts.length,
    auditPath,
  };
}

export type DaSilvaBillingIngestPaths = {
  classListDir: string;
  billingPlan: string;
  ageAnalysis: string;
};

export type DaSilvaBillingStagingValidation = {
  passed: boolean;
  expectedBillingAccounts: number;
  actualBillingAccounts: number;
  learnersWithBillingPlan: number;
  uniqueFeeDescriptions: number;
  ageAnalysisTotalOutstanding: number;
  errors: string[];
};

export type DaSilvaBillingDbValidation = {
  passed: boolean;
  billingPlansImported: number;
  feeStructuresImported: number;
  familyAccounts: number;
  openingBalancesImported: number;
  totalOutstandingImported: number;
  kidesysAgeAnalysisTotal: number;
  zeroBalanceAccountsWithKidesysDebt: string[];
  orphanBillingAccountRefs: string[];
  duplicateOpeningBalanceRefs: string[];
  ageAnalysisVarianceTotal: number;
  errors: string[];
};

/** Kid-e-Sys billing plan + age analysis (no transactions or employees). */
export function buildDaSilvaBillingStagedLearners(
  paths: DaSilvaBillingIngestPaths
): DaSilvaStagedLearner[] {
  const { learners: sasamsClassLearners } = parseSasamsClassListDirectory(paths.classListDir);
  const classLearners = sasamsLearnersToParsedLearners(sasamsClassLearners);
  const billingItems = parseBillingPlanFile(paths.billingPlan);
  const accounts = parseAgeAnalysisFile(paths.ageAnalysis);
  const planByKey = groupBillingPlans(billingItems);
  const accountByName = new Map<string, string>();
  indexAgeAnalysisAccountNames(accounts, accountByName);
  const uniqueClassLearners = uniqueLearnersByMatchKey(classLearners);
  const familyIndex = buildFamilyAccountIndex(accounts, billingItems, uniqueClassLearners, [], []);
  const staged: DaSilvaStagedLearner[] = [];

  for (const learner of uniqueClassLearners) {
    const norm = normalizeClassroomInput(learner.className);
    const canonicalClassName = norm.classroomName || learner.className;
    const billingPlan = planByKey.get(learner.matchKey) || [];
    const billingPlanTotal = billingPlan.reduce((s, i) => s + i.amount, 0);

    let accountNo = accountByName.get(normalizeMatchText(learner.fullName)) || "";
    if (!accountNo) {
      accountNo = findAccountForLearnerName(learner.fullName, accounts, familyIndex);
    }
    const ageRow = accounts.find(
      (a) =>
        a.accountNo === accountNo ||
        normalizeMatchText(a.fullName) === normalizeMatchText(learner.fullName) ||
        (a.learnerNames || splitMergedAccountNames(a.fullName)).some(
          (n) => normalizeMatchText(n) === normalizeMatchText(learner.fullName)
        )
    );

    staged.push({
      matchKey: learner.matchKey,
      fullName: learner.fullName,
      firstName: learner.firstName,
      lastName: learner.lastName,
      className: learner.className,
      canonicalClassName,
      accountNo:
        (accountNo && isKidESysSourceAccountRef(accountNo) ? accountNo : "") ||
        (ageRow?.accountNo && isKidESysSourceAccountRef(ageRow.accountNo) ? ageRow.accountNo : ""),
      billingPlan,
      billingPlanTotal,
      ageAnalysisBalance: ageRow?.balance ?? 0,
      parents: [],
    });
  }

  return staged;
}

export function validateDaSilvaBillingStaging(
  paths: DaSilvaBillingIngestPaths
): DaSilvaBillingStagingValidation {
  const errors: string[] = [];
  const accounts = parseAgeAnalysisFile(paths.ageAnalysis);
  const billingItems = parseBillingPlanFile(paths.billingPlan);
  const staged = buildDaSilvaBillingStagedLearners(paths);
  const expectedBillingAccounts = DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT;
  const actualBillingAccounts = accounts.length;
  const learnersWithBillingPlan = uniqueBillingLearners(billingItems).length;
  const feeDescriptions = new Set(
    billingItems.map((i) => String(i.feeDescription || "").trim()).filter(Boolean)
  );
  const ageAnalysisTotalOutstanding = Math.round(
    accounts.reduce((s, a) => s + a.balance, 0) * 100
  ) / 100;

  if (actualBillingAccounts !== expectedBillingAccounts) {
    errors.push(
      `Age analysis has ${actualBillingAccounts} accounts (expected ${expectedBillingAccounts})`
    );
  }
  if (learnersWithBillingPlan !== DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT && learnersWithBillingPlan !== DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT) {
    errors.push(
      `Billing plan covers ${learnersWithBillingPlan} learners (expected ${DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} or ${DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS-only before Crèche supplement)`
    );
  }
  if (!staged.length) {
    errors.push("No staged learners from class list + billing plan");
  }

  return {
    passed: errors.length === 0,
    expectedBillingAccounts,
    actualBillingAccounts,
    learnersWithBillingPlan,
    uniqueFeeDescriptions: feeDescriptions.size,
    ageAnalysisTotalOutstanding,
    errors,
  };
}

function inferFeeFrequency(description: string): "MONTHLY" | "ONCE_OFF" {
  if (/\b(once|registration|deposit|admission|enrol+ment|annual)\b/i.test(description)) {
    return "ONCE_OFF";
  }
  return "MONTHLY";
}

async function upsertFeeStructuresFromBillingPlan(
  schoolId: string,
  billingItems: ParsedBillingPlanItem[]
): Promise<{ created: number; existing: number; feeStructureIds: string[] }> {
  const byDescription = new Map<string, number>();
  for (const item of billingItems) {
    const desc = String(item.feeDescription || "").trim();
    if (!desc) continue;
    const amount = Number(item.amount) || 0;
    const prev = byDescription.get(desc) || 0;
    if (amount > prev) byDescription.set(desc, amount);
  }

  const existingFees = await prisma.feeStructure.findMany({
    where: { schoolId },
    select: { id: true, name: true },
  });
  const existingByName = new Map(existingFees.map((f) => [f.name.trim().toLowerCase(), f.id]));

  let created = 0;
  let existing = 0;
  const feeStructureIds: string[] = [];

  for (const [description, amount] of byDescription) {
    const key = description.toLowerCase();
    const foundId = existingByName.get(key);
    if (foundId) {
      existing += 1;
      feeStructureIds.push(foundId);
      continue;
    }
    const fee = await prisma.feeStructure.create({
      data: {
        schoolId,
        name: description,
        amount,
        frequency: inferFeeFrequency(description),
        description,
        isActive: true,
      },
      select: { id: true },
    });
    created += 1;
    feeStructureIds.push(fee.id);
    existingByName.set(key, fee.id);
  }

  return { created, existing, feeStructureIds };
}

async function buildAccountToLearnerIdFromDatabase(schoolId: string): Promise<Map<string, string>> {
  const rows = await prisma.learner.findMany({
    where: { schoolId, familyAccountId: { not: null } },
    select: {
      id: true,
      familyAccount: { select: { accountRef: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const map = new Map<string, string>();
  for (const row of rows) {
    const accountNo = String(row.familyAccount?.accountRef || "").trim();
    if (!accountNo || map.has(accountNo)) continue;
    map.set(accountNo, row.id);
  }
  return map;
}

export async function validateDaSilvaBillingInDatabase(
  schoolId: string,
  paths: DaSilvaBillingIngestPaths,
  accountToLearnerId: Record<string, string>
): Promise<DaSilvaBillingDbValidation> {
  const errors: string[] = [];
  const accounts = parseAgeAnalysisFile(paths.ageAnalysis);
  const kidesysAgeAnalysisTotal = Math.round(
    accounts.reduce((s, a) => s + a.balance, 0) * 100
  ) / 100;

  const billingPlans = readSchoolBillingPlans(schoolId);
  const billingPlansImported = Object.keys(billingPlans).length;
  const feeStructuresImported = await prisma.feeStructure.count({ where: { schoolId } });
  const familyAccounts = await prisma.familyAccount.count({ where: { schoolId } });

  const ledger = readSchoolLedger(schoolId);
  const openingEntries = ledger.filter(
    (e) => e.source === "kidesys_migration_opening_balance"
  );
  const nonOpeningEntries = ledger.filter(
    (e) => e.source !== "kidesys_migration_opening_balance"
  );
  if (nonOpeningEntries.length) {
    errors.push(
      `${nonOpeningEntries.length} non-opening ledger row(s) present (payments/invoices not allowed in phase 4)`
    );
  }

  const openingBalancesImported = openingEntries.length;
  const openingByAccount = new Map<string, number>();
  for (const entry of openingEntries) {
    const ref = String(entry.accountNo || "").trim();
    openingByAccount.set(ref, (openingByAccount.get(ref) || 0) + 1);
  }
  const duplicateOpeningBalanceRefs = [...openingByAccount.entries()]
    .filter(([, count]) => count > 1)
    .map(([ref]) => ref);

  const familyRefs = new Set(
    (
      await prisma.familyAccount.findMany({
        where: { schoolId },
        select: { accountRef: true },
      })
    ).map((r) => String(r.accountRef || "").trim())
  );
  const excludedAccounts = new Set<string>(DA_SILVA_OPENING_BALANCE_EXCLUDED_ACCOUNTS);
  const orphanBillingAccountRefs = accounts
    .map((a) => a.accountNo)
    .filter((ref) => ref && !familyRefs.has(ref));

  const zeroBalanceAccountsWithKidesysDebt: string[] = [];
  let totalOutstandingImported = 0;
  let ageAnalysisVarianceTotal = 0;
  let varianceAccountCount = 0;

  for (const account of accounts) {
    const excluded = excludedAccounts.has(account.accountNo);
    const learnerId = accountToLearnerId[account.accountNo] || "";
    const ledgerBalance = calculateBalanceForAccount(ledger, learnerId, account.accountNo);
    if (!excluded) {
      totalOutstandingImported = Math.round((totalOutstandingImported + ledgerBalance) * 100) / 100;
    }

    const kidesysBalance = Math.round(account.balance * 100) / 100;
    const variance = Math.round((kidesysBalance - ledgerBalance) * 100) / 100;
    if (!excluded) {
      ageAnalysisVarianceTotal = Math.round((ageAnalysisVarianceTotal + Math.abs(variance)) * 100) / 100;
    }

    if (!excluded && Math.abs(kidesysBalance) > 0.01 && Math.abs(ledgerBalance) <= 0.01) {
      zeroBalanceAccountsWithKidesysDebt.push(account.accountNo);
    }
    if (!excluded && Math.abs(variance) > 0.01) {
      varianceAccountCount += 1;
      if (errors.length < 15) {
        errors.push(
          `Account ${account.accountNo}: Kid-e-Sys R${kidesysBalance} ≠ ledger R${ledgerBalance}`
        );
      }
    }
  }
  if (varianceAccountCount > 15) {
    errors.push(`${varianceAccountCount} account(s) with age/ledger mismatch (first 15 listed above)`);
  }

  if (familyAccounts < DA_SILVA_BILLING_MATCH_MIN_MATCHED) {
    errors.push(
      `Family accounts: ${familyAccounts} (expected at least ${DA_SILVA_BILLING_MATCH_MIN_MATCHED} matched; ${DA_SILVA_BILLING_ACCOUNT_TARGET} total in Kid-e-Sys with manual review for remainder)`
    );
  }
  if (duplicateOpeningBalanceRefs.length) {
    errors.push(`Duplicate opening balance refs: ${duplicateOpeningBalanceRefs.join(", ")}`);
  }
  if (orphanBillingAccountRefs.length) {
    errors.push(`${orphanBillingAccountRefs.length} orphan billing account ref(s)`);
  }
  if (zeroBalanceAccountsWithKidesysDebt.length) {
    errors.push(
      `${zeroBalanceAccountsWithKidesysDebt.length} account(s) with Kid-e-Sys balance but zero ledger`
    );
  }
  const kidesysComparableTotal = Math.round(
    accounts
      .filter((a) => !excludedAccounts.has(a.accountNo))
      .reduce((s, a) => s + a.balance, 0) * 100
  ) / 100;
  if (Math.abs(kidesysComparableTotal - totalOutstandingImported) > 0.02) {
    errors.push(
      `Age analysis total R${kidesysComparableTotal} ≠ imported outstanding R${totalOutstandingImported} (excludes manual accounts: ${DA_SILVA_OPENING_BALANCE_EXCLUDED_ACCOUNTS.join(", ")})`
    );
  }

  return {
    passed: errors.length === 0,
    billingPlansImported,
    feeStructuresImported,
    familyAccounts,
    openingBalancesImported,
    totalOutstandingImported,
    kidesysAgeAnalysisTotal,
    zeroBalanceAccountsWithKidesysDebt,
    orphanBillingAccountRefs,
    duplicateOpeningBalanceRefs,
    ageAnalysisVarianceTotal,
    errors,
  };
}

/**
 * Phase 4 only: billing plans, fee structures, family billing balances, and opening balances.
 * Does not import transactions, employees, invoices, payments, or bank data.
 */
export async function commitDaSilvaBillingOnly(opts: {
  schoolId: string;
  projectId: string;
  paths: DaSilvaBillingIngestPaths;
}): Promise<{
  success: boolean;
  stagingValidation: DaSilvaBillingStagingValidation;
  postImportValidation: DaSilvaBillingDbValidation;
  manifest: DaSilvaImportManifest;
  imported: {
    billingPlans: number;
    feeStructuresCreated: number;
    feeStructuresExisting: number;
    openingBalances: number;
    learnersFeeUpdated: number;
    parentsOutstandingUpdated: number;
  };
}> {
  const school = await prisma.school.findUnique({
    where: { id: opts.schoolId },
    select: { id: true },
  });
  if (!school) throw new Error("School not found");

  const stagingValidation = validateDaSilvaBillingStaging(opts.paths);
  if (!stagingValidation.passed) {
    throw new Error(`Billing staging validation failed: ${stagingValidation.errors.join("; ")}`);
  }

  const dbLearners = await prisma.learner.count({ where: { schoolId: opts.schoolId } });
  if (!isAcceptableDaSilvaPhase3LearnerCount(dbLearners)) {
    throw new Error(
      `Phase 2 required: ${dbLearners} learners (expected ${DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS or ${DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} after Crèche supplement)`
    );
  }

  const existingEmployees = await prisma.employee.count({ where: { schoolId: opts.schoolId } });
  if (existingEmployees > 0) {
    throw new Error(`BLOCKED: ${existingEmployees} employee(s) — phase 4 does not import payroll`);
  }

  const ledgerBefore = readSchoolLedger(opts.schoolId);
  const hasNonOpeningLedger = ledgerBefore.some(
    (e) => e.source !== "kidesys_migration_opening_balance"
  );
  if (hasNonOpeningLedger) {
    throw new Error("BLOCKED: ledger contains transaction history — phase 4 allows opening balances only");
  }

  const existingManifest = loadDaSilvaManifest(opts.schoolId, opts.projectId);
  if (!existingManifest) {
    throw new Error(`No manifest for project ${opts.projectId}. Complete phases 1–3 first.`);
  }
  if (!existingManifest.phasesCompleted?.includes("classrooms")) {
    throw new Error("Phase 1 (classrooms) not completed.");
  }
  if (!existingManifest.phasesCompleted?.includes("learners")) {
    throw new Error("Phase 2 (learners) not completed.");
  }
  if (!existingManifest.phasesCompleted?.includes("parents")) {
    throw new Error("Phase 3 (parents) not completed.");
  }
  if (!existingManifest.phasesCompleted?.includes("billing_match")) {
    throw new Error("Phase 4 (billing match) not completed — run da-silva-billing-match.ts first.");
  }
  if (existingManifest.phasesCompleted?.includes("transactions")) {
    throw new Error("BLOCKED: transactions phase already completed — phase 5 must not duplicate ledger history");
  }

  const staged = buildDaSilvaBillingStagedLearners(opts.paths);
  const billingItems = parseBillingPlanFile(opts.paths.billingPlan);
  const accounts = parseAgeAnalysisFile(opts.paths.ageAnalysis);
  const openingAdjustments = buildPhase4OpeningBalancesFromAgeAnalysis({ accounts });

  const manifest: DaSilvaImportManifest = {
    ...existingManifest,
    ledgerEntryIds: existingManifest.ledgerEntryIds || [],
    matchKeyToLearnerId: existingManifest.matchKeyToLearnerId || {},
    accountToLearnerId: existingManifest.accountToLearnerId || {},
    phasesCompleted: existingManifest.phasesCompleted || [],
  };

  const matchKeyToLearnerId = new Map(Object.entries(manifest.matchKeyToLearnerId || {}));
  let billingPlansImported = 0;
  let feeStructuresCreated = 0;
  let feeStructuresExisting = 0;
  let learnersFeeUpdated = 0;
  let parentsOutstandingUpdated = 0;

  await runDaSilvaImportPhase(manifest, "billing_accounts", opts.schoolId, opts.projectId, async () => {
    const feeResult = await upsertFeeStructuresFromBillingPlan(opts.schoolId, billingItems);
    feeStructuresCreated = feeResult.created;
    feeStructuresExisting = feeResult.existing;

    const billingPlans: Record<string, StoredBillingPlanItem[]> = {};
    for (const row of staged) {
      const learnerId = matchKeyToLearnerId.get(row.matchKey);
      if (!learnerId) continue;
      if (row.billingPlan.length) {
        billingPlans[learnerId] = row.billingPlan;
      }
      await prisma.learner.update({
        where: { id: learnerId },
        data: {
          totalFee: row.billingPlanTotal,
          tuitionFee: row.billingPlanTotal,
        },
        select: { id: true },
      });
      learnersFeeUpdated += 1;
    }
    upsertSchoolBillingPlans(opts.schoolId, billingPlans);
    billingPlansImported = Object.keys(billingPlans).length;

    const accountToLearnerId = await buildAccountToLearnerIdFromDatabase(opts.schoolId);
    manifest.accountToLearnerId = Object.fromEntries(accountToLearnerId);
  });

  await runDaSilvaImportPhase(manifest, "opening_balances", opts.schoolId, opts.projectId, async () => {
    const accountToLearnerId = new Map(Object.entries(manifest.accountToLearnerId || {}));
    const balanceByAccount = new Map(accounts.map((a) => [a.accountNo, a.balance]));
    const ledgerEntries: BillingLedgerEntry[] = [];

    for (const adj of openingAdjustments) {
      const learnerId = accountToLearnerId.get(adj.accountNo) || "";
      const entry: BillingLedgerEntry = {
        id: `kidesys-opening-${adj.accountNo}`,
        schoolId: opts.schoolId,
        learnerId,
        accountNo: adj.accountNo,
        type: adj.entryType,
        amount: Math.abs(adj.adjustmentAmount),
        date: adj.date,
        reference: adj.reference,
        description: adj.description,
        source: "kidesys_migration_opening_balance",
        createdAt: new Date().toISOString(),
      };
      ledgerEntries.push(entry);
      pushUniqueId(manifest.ledgerEntryIds, entry.id);
    }
    upsertSchoolEntries(opts.schoolId, ledgerEntries);

    for (const [accountNo, balance] of balanceByAccount) {
      const family = await prisma.familyAccount.findFirst({
        where: { schoolId: opts.schoolId, accountRef: accountNo },
        select: { id: true },
      });
      if (!family) continue;
      const result = await prisma.parent.updateMany({
        where: { schoolId: opts.schoolId, familyAccountId: family.id },
        data: { outstandingAmount: Math.round(balance * 100) / 100 },
      });
      parentsOutstandingUpdated += result.count;
    }
  });

  const ledgerBackfilled = backfillLedgerLearnerIds(
    opts.schoolId,
    manifest.accountToLearnerId || {}
  );
  if (ledgerBackfilled > 0) {
    console.log(
      `[DaSilva import] backfilled learnerId on ${ledgerBackfilled} opening balance row(s)`
    );
  }

  writeDaSilvaManifest(opts.schoolId, opts.projectId, manifest);

  const postImportValidation = await validateDaSilvaBillingInDatabase(
    opts.schoolId,
    opts.paths,
    manifest.accountToLearnerId || {}
  );

  return {
    success: postImportValidation.passed,
    stagingValidation,
    postImportValidation,
    manifest,
    imported: {
      billingPlans: billingPlansImported,
      feeStructuresCreated,
      feeStructuresExisting,
      openingBalances: openingAdjustments.length,
      learnersFeeUpdated,
      parentsOutstandingUpdated,
    },
  };
}

export async function rollbackDaSilvaMigration(opts: {
  schoolId: string;
  projectId: string;
}): Promise<{ success: boolean; removed: Record<string, number> }> {
  const file = manifestPath(opts.schoolId, opts.projectId);
  if (!fs.existsSync(file)) {
    throw new Error("No Da Silva import manifest found for rollback");
  }
  const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as DaSilvaImportManifest;

  const removed = {
    ledgerEntries: 0,
    links: 0,
    learners: 0,
    parents: 0,
    classrooms: 0,
    employees: 0,
  };

  const { readSchoolLedger, writeSchoolLedger } = await import("../../utils/billingLedgerStore");
  const ledger = readSchoolLedger(opts.schoolId).filter(
    (e) => !manifest.ledgerEntryIds.includes(e.id)
  );
  writeSchoolLedger(opts.schoolId, ledger);
  removed.ledgerEntries = manifest.ledgerEntryIds.length;

  removeSchoolBillingPlans(opts.schoolId, manifest.learnerIds);

  await prisma.$transaction(async (tx) => {
    if (manifest.linkIds.length) {
      removed.links = (
        await tx.parentLearnerLink.deleteMany({
          where: { id: { in: manifest.linkIds }, schoolId: opts.schoolId },
        })
      ).count;
    }
    if (manifest.learnerIds.length) {
      removed.learners = (
        await tx.learner.deleteMany({
          where: { id: { in: manifest.learnerIds }, schoolId: opts.schoolId },
        })
      ).count;
    }
    if (manifest.parentIds.length) {
      removed.parents = (
        await tx.parent.deleteMany({
          where: { id: { in: manifest.parentIds }, schoolId: opts.schoolId },
        })
      ).count;
    }
    if (manifest.classroomIds.length) {
      removed.classrooms = (
        await tx.classroom.deleteMany({
          where: { id: { in: manifest.classroomIds }, schoolId: opts.schoolId },
        })
      ).count;
    }
    if (manifest.employeeIds.length) {
      removed.employees = (
        await tx.employee.deleteMany({
          where: { id: { in: manifest.employeeIds }, schoolId: opts.schoolId },
        })
      ).count;
    }
  });

  fs.unlinkSync(file);
  return { success: true, removed };
}

/** CLI / local preview using explicit folder paths (Desktop export layout). */
export function buildDaSilvaBundleFromDesktopLayout(
  schoolId: string,
  projectId: string,
  desktopRoot: string
): DaSilvaMigrationBundle {
  const siblingAccounts = discoverSiblingAccountsPath(desktopRoot);
  return buildDaSilvaMigrationBundle({
    schoolId,
    projectId,
    paths: {
      classListDir: path.join(desktopRoot, "05_class_list"),
      contactList: path.join(desktopRoot, "04_contact_list", "contact_list.xls"),
      employees: path.join(desktopRoot, "06_employees", "employee_contact_list.xls"),
      billingPlan: path.join(
        desktopRoot,
        "03_billing_plan_summary_by_child",
        "billing_plan_summary_by_child.xls"
      ),
      ageAnalysis: path.join(
        desktopRoot,
        "02_account_list_age_analysis",
        "account_list_(age_analysis).xls"
      ),
      transactions: path.join(desktopRoot, "01_transaction_list", "transaction_list.xls"),
      siblingAccounts,
    },
  });
}

export { splitMergedAccountNames, buildMergedFamilyAccountSet } from "./daSilvaMergedFamily";
export {
  KIDESYS_OPENING_BALANCE_LABEL,
  DA_SILVA_MIGRATION_CUTOVER_DATE,
  countAgeAnalysisVarianceAfterAdjustments,
  type DaSilvaOpeningBalancePlan,
  type DaSilvaOpeningBalanceAdjustment,
} from "./daSilvaOpeningBalance";
