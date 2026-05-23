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

  const manifest: DaSilvaImportManifest = {
    projectId: opts.projectId,
    schoolId: opts.schoolId,
    importedAt: new Date().toISOString(),
    learnerIds: [],
    parentIds: [],
    linkIds: [],
    classroomIds: [],
    employeeIds: [],
    ledgerEntryIds: [],
  };

  const matchKeyToLearnerId = new Map<string, string>();
  const accountToLearnerId = new Map<string, string>();
  const accountLearnerSeq = new Map<string, number>();

  await prisma.$transaction(async (tx) => {
    for (const classroom of bundle.classrooms) {
      const norm = normalizeClassroomInput(classroom.className);
      const name = norm.classroomName || classroom.className;
      if (!name) continue;
      const record = await tx.classroom.upsert({
        where: { schoolId_name: { schoolId: opts.schoolId, name } },
        create: { schoolId: opts.schoolId, name },
        update: {},
      });
      if (!manifest.classroomIds.includes(record.id)) manifest.classroomIds.push(record.id);
    }

    for (const emp of bundle.employees) {
      const existing = await tx.employee.findFirst({
        where: {
          schoolId: opts.schoolId,
          OR: [
            { fullName: emp.fullName },
            {
              AND: [
                { firstName: emp.firstName },
                { lastName: emp.lastName },
              ],
            },
          ],
        },
        select: { id: true },
      });
      if (existing) {
        manifest.employeeIds.push(existing.id);
        continue;
      }
      const created = await tx.employee.create({
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
      manifest.employeeIds.push(created.id);
    }

    for (const row of bundle.learners) {
      const accountNo = String(row.accountNo || "").trim();
      let familyAccountId: string | null = null;

      if (accountNo) {
        const fa = await tx.familyAccount.upsert({
          where: { accountRef: accountNo },
          create: {
            schoolId: opts.schoolId,
            accountRef: accountNo,
            familyName: row.lastName || row.fullName,
          },
          update: {},
        });
        familyAccountId = fa.id;
      }

      const norm = normalizeClassroomInput(row.className);
      let admissionNo: string | null = null;
      if (accountNo) {
        const seq = (accountLearnerSeq.get(accountNo) || 0) + 1;
        accountLearnerSeq.set(accountNo, seq);
        admissionNo = seq === 1 ? accountNo : `${accountNo}-${seq}`;
      }
      const learner = await tx.learner.create({
        data: {
          schoolId: opts.schoolId,
          familyAccountId,
          firstName: row.firstName,
          lastName: row.lastName,
          grade: norm.gradeLabel || row.className.replace(/[A-Za-z]+$/, "").trim(),
          className: row.canonicalClassName,
          admissionNo,
          totalFee: row.billingPlanTotal,
          tuitionFee: row.billingPlanTotal,
        },
      });
      manifest.learnerIds.push(learner.id);
      matchKeyToLearnerId.set(row.matchKey, learner.id);
      if (accountNo && !accountToLearnerId.has(accountNo)) {
        accountToLearnerId.set(accountNo, learner.id);
      }

      for (const parent of row.parents) {
        const phone = normalizeSaPhone(parent.cellNo || parent.homeNo || "");
        const createdParent = await tx.parent.create({
          data: {
            schoolId: opts.schoolId,
            familyAccountId,
            firstName: parent.firstName,
            surname: parent.surname,
            cellNo: phone?.localCell || parent.cellNo || "",
            email: parent.email || null,
            relationship: parent.relation,
            workNo: parent.workNo || null,
            homeNo: parent.homeNo || null,
            outstandingAmount: row.ageAnalysisBalance,
          },
        });
        if (!manifest.parentIds.includes(createdParent.id)) {
          manifest.parentIds.push(createdParent.id);
        }
        const link = await tx.parentLearnerLink.create({
          data: {
            schoolId: opts.schoolId,
            parentId: createdParent.id,
            learnerId: learner.id,
            relation: parent.relation,
            isPrimary: row.parents[0] === parent,
          },
        });
        manifest.linkIds.push(link.id);
      }
    }
  });

  const billingPlans: Record<string, StoredBillingPlanItem[]> = {};
  for (const row of bundle.learners) {
    const learnerId = matchKeyToLearnerId.get(row.matchKey);
    if (learnerId && row.billingPlan.length) {
      billingPlans[learnerId] = row.billingPlan;
    }
  }
  upsertSchoolBillingPlans(opts.schoolId, billingPlans);

  const ledgerEntries: BillingLedgerEntry[] = [];
  for (const txn of bundle.transactions) {
    const learnerId =
      accountToLearnerId.get(txn.accountNo) ||
      matchKeyToLearnerId.get(
        buildLearnerMatchKey(
          txn.fullName,
          bundle.learners.find((l) => l.accountNo === txn.accountNo)?.className || ""
        )
      ) ||
      "";

    const entry: BillingLedgerEntry = {
      id: ledgerEntryId(txn.kind, txn.transactionNo),
      schoolId: opts.schoolId,
      learnerId,
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
    manifest.ledgerEntryIds.push(entry.id);
  }

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
    manifest.ledgerEntryIds.push(entry.id);
  }

  upsertSchoolEntries(opts.schoolId, ledgerEntries);

  for (const classroomId of manifest.classroomIds) {
    await syncParentThreadsForClassroom(opts.schoolId, classroomId);
  }

  ensureDir(path.join(STAGING_ROOT, opts.schoolId));
  fs.writeFileSync(
    manifestPath(opts.schoolId, opts.projectId),
    JSON.stringify(manifest, null, 2)
  );

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
