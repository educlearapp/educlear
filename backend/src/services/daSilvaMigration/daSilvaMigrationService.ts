import fs from "fs";
import path from "path";
import { prisma } from "../../prisma";
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
  type BillingLedgerEntry,
  upsertSchoolEntries,
} from "../../utils/billingLedgerStore";
import { normalizeClassroomInput } from "../../utils/classroomNormalization";
import { normalizeMatchText } from "../../utils/kideesysSpreadsheet";
import { buildLearnerMatchKey } from "./parsers";
import {
  upsertSchoolBillingPlans,
  type StoredBillingPlanItem,
  removeSchoolBillingPlans,
} from "../../utils/learnerBillingPlanStore";
import { normalizeSaPhone } from "../parentPortalService";
import { syncParentThreadsForClassroom } from "../parentPortalService";
import {
  buildOpeningBalancePlan,
  type DaSilvaOpeningBalancePlan,
} from "./daSilvaOpeningBalance";
import {
  approvedOpeningBalanceAdjustments,
  assertDaSilvaFinalImportAllowed,
} from "./daSilvaFinalImportGate";
import {
  parseAgeAnalysisFile,
  parseBillingPlanFile,
  parseClassListDirectory,
  parseClassListFile,
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
};

export type DaSilvaMigrationBundle = {
  projectId: string;
  schoolId: string;
  source: "kideesys-dasilva";
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
  canImport: boolean;
  confirmToken: string;
};

export type DaSilvaImportPhase =
  | "school_base"
  | "classrooms"
  | "parents"
  | "learners"
  | "billing_accounts"
  | "transactions"
  | "opening_balances";

export type DaSilvaImportManifest = {
  projectId: string;
  schoolId: string;
  importedAt: string;
  learnerIds: string[];
  parentIds: string[];
  linkIds: string[];
  classroomIds: string[];
  employeeIds: string[];
  ledgerEntryIds: string[];
  /** `${matchKey}:${parentIndex}` → parent id (parents phase, links in learners phase) */
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
  const { classrooms, learners: classLearners } = parseClassListDirectory(opts.paths.classListDir);
  const contacts = parseContactListFile(opts.paths.contactList);
  const employees = parseEmployeesFile(opts.paths.employees);
  const billingItems = parseBillingPlanFile(opts.paths.billingPlan);
  const accounts = parseAgeAnalysisFile(opts.paths.ageAnalysis);
  const transactions = parseTransactionListFile(opts.paths.transactions);

  const contactByKey = new Map(contacts.map((c) => [c.matchKey, c]));
  const planByKey = groupBillingPlans(billingItems);
  const accountByName = new Map<string, string>();
  const accountByNo = buildAccountMap(accounts, transactions);

  for (const a of accounts) {
    accountByName.set(normalizeMatchText(a.fullName), a.accountNo);
  }
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

  for (const learner of uniqueClassLearners) {
    const norm = normalizeClassroomInput(learner.className);
    const canonicalClassName = norm.classroomName || learner.className;
    const contact = contactByKey.get(learner.matchKey);
    const billingPlan = planByKey.get(learner.matchKey) || [];
    const billingPlanTotal = billingPlan.reduce((s, i) => s + i.amount, 0);

    let accountNo =
      accountByName.get(normalizeMatchText(learner.fullName)) ||
      "";
    if (!accountNo) {
      for (const [no, meta] of accountByNo) {
        if (normalizeMatchText(meta.fullName) === normalizeMatchText(learner.fullName)) {
          accountNo = no;
          break;
        }
      }
    }
    if (!accountNo) {
      accountNo = findAccountForLearnerName(learner.fullName, accounts, familyIndex);
    }

    const ageRow = accounts.find(
      (a) =>
        a.accountNo === accountNo ||
        normalizeMatchText(a.fullName) === normalizeMatchText(learner.fullName) ||
        splitMergedAccountNames(a.fullName).some(
          (n) => normalizeMatchText(n) === normalizeMatchText(learner.fullName)
        )
    );

    stagedLearners.push({
      matchKey: learner.matchKey,
      fullName: learner.fullName,
      firstName: learner.firstName,
      lastName: learner.lastName,
      className: learner.className,
      canonicalClassName,
      accountNo: accountNo || ageRow?.accountNo || "",
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
    source: "kideesys-dasilva",
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

function loadDaSilvaManifest(schoolId: string, projectId: string): DaSilvaImportManifest | null {
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
  assertDaSilvaFinalImportAllowed(bundle, school.name);

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

    const accountFamilyNames = new Map<string, string>();
    for (const row of bundle.learners) {
      const accountNo = String(row.accountNo || "").trim();
      if (!accountNo) continue;
      if (!accountFamilyNames.has(accountNo)) {
        accountFamilyNames.set(accountNo, row.lastName || row.fullName);
      }
    }
    for (const [accountNo, familyName] of accountFamilyNames) {
      const fa = await prisma.familyAccount.upsert({
        where: { accountRef: accountNo },
        create: {
          schoolId: opts.schoolId,
          accountRef: accountNo,
          familyName,
        },
        update: {},
      });
      accountToFamilyId.set(accountNo, fa.id);
    }

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

  await runDaSilvaImportPhase(manifest, "parents", opts.schoolId, opts.projectId, async () => {
    await ensureFamilyAccountMap();
    for (const row of bundle.learners) {
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
        });
        familyAccountId = fa.id;
        accountToFamilyId.set(accountNo, fa.id);
      }

      for (let pi = 0; pi < row.parents.length; pi++) {
        const parent = row.parents[pi];
        const stageKey = parentStagingKey(row.matchKey, pi);
        if (manifest.stagedParentIds![stageKey]) continue;

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
      }
    }
  });

  await runDaSilvaImportPhase(manifest, "learners", opts.schoolId, opts.projectId, async () => {
    await ensureFamilyAccountMap();
    const existingAdmissionRows = await prisma.learner.findMany({
      where: { schoolId: opts.schoolId, admissionNo: { not: null } },
      select: { admissionNo: true },
    });
    const accountLearnerSeq = seedAccountLearnerSeqFromExisting(existingAdmissionRows);

    for (const row of bundle.learners) {
      const accountNo = String(row.accountNo || "").trim();
      const familyAccountId = accountNo ? accountToFamilyId.get(accountNo) || null : null;
      const norm = normalizeClassroomInput(row.className);

      const existingLearnerId = manifest.matchKeyToLearnerId?.[row.matchKey];
      if (existingLearnerId) {
        matchKeyToLearnerId.set(row.matchKey, existingLearnerId);
        pushUniqueId(manifest.learnerIds, existingLearnerId);
        if (accountNo && !accountToLearnerId.has(accountNo)) {
          accountToLearnerId.set(accountNo, existingLearnerId);
        }
      } else {
        let admissionNo: string | null = null;
        if (accountNo) {
          const seq = (accountLearnerSeq.get(accountNo) || 0) + 1;
          accountLearnerSeq.set(accountNo, seq);
          admissionNo = seq === 1 ? accountNo : `${accountNo}-${seq}`;
        }

        const learnerData = {
          schoolId: opts.schoolId,
          familyAccountId,
          firstName: row.firstName,
          lastName: row.lastName,
          grade: norm.gradeLabel || row.className.replace(/[A-Za-z]+$/, "").trim(),
          className: row.canonicalClassName,
          admissionNo,
          totalFee: row.billingPlanTotal,
          tuitionFee: row.billingPlanTotal,
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
                  totalFee: learnerData.totalFee,
                  tuitionFee: learnerData.tuitionFee,
                },
              })
            : await prisma.learner.create({ data: learnerData });

        pushUniqueId(manifest.learnerIds, learner.id);
        matchKeyToLearnerId.set(row.matchKey, learner.id);
        if (accountNo && !accountToLearnerId.has(accountNo)) {
          accountToLearnerId.set(accountNo, learner.id);
        }
      }

      const learnerId = matchKeyToLearnerId.get(row.matchKey)!;
      for (let pi = 0; pi < row.parents.length; pi++) {
        const parent = row.parents[pi];
        const stageKey = parentStagingKey(row.matchKey, pi);
        const parentId = manifest.stagedParentIds![stageKey];
        if (!parentId) {
          throw new Error(`Missing staged parent for ${stageKey}`);
        }

        const existingLink = await prisma.parentLearnerLink.findUnique({
          where: { parentId_learnerId: { parentId, learnerId } },
          select: { id: true },
        });
        if (existingLink) {
          pushUniqueId(manifest.linkIds, existingLink.id);
          continue;
        }

        const link = await prisma.parentLearnerLink.create({
          data: {
            schoolId: opts.schoolId,
            parentId,
            learnerId,
            relation: parent.relation,
            isPrimary: row.parents[0] === parent,
          },
          select: { id: true },
        });
        pushUniqueId(manifest.linkIds, link.id);
      }
    }

    persistLearnerMaps();
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
