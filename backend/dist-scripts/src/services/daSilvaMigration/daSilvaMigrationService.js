"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.countAgeAnalysisVarianceAfterAdjustments = exports.DA_SILVA_MIGRATION_CUTOVER_DATE = exports.KIDESYS_OPENING_BALANCE_LABEL = exports.buildMergedFamilyAccountSet = exports.splitMergedAccountNames = exports.assertDaSilvaMigrationGates = exports.isAllowedDaSilvaSupplementClassroom = exports.DA_SILVA_EXPECTED_UNIQUE_PARENT_COUNT = exports.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_LEARNER_COUNTS = exports.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT = exports.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT = exports.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_FILE_COUNT = exports.DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT = exports.DA_SILVA_EXPECTED_PARENT_LINK_COUNT = exports.DA_SILVA_EXPECTED_PARENT_COUNT = exports.DA_SILVA_EXPECTED_LEARNER_COUNT = exports.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT = exports.DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT = exports.DA_SILVA_EXPECTED_CREche_SUPPLEMENT_LEARNER_COUNT = exports.DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT = exports.DA_SILVA_EXPECTED_CLASSROOM_LEARNER_COUNTS = exports.DA_SILVA_EXPECTED_CLASSROOM_COUNT = exports.DA_SILVA_BILLING_ACCOUNT_TARGET = void 0;
exports.createDaSilvaProjectId = createDaSilvaProjectId;
exports.buildDaSilvaMigrationBundle = buildDaSilvaMigrationBundle;
exports.saveDaSilvaStaging = saveDaSilvaStaging;
exports.loadDaSilvaStaging = loadDaSilvaStaging;
exports.saveUploadedDaSilvaFiles = saveUploadedDaSilvaFiles;
exports.previewDaSilvaMigration = previewDaSilvaMigration;
exports.loadDaSilvaManifest = loadDaSilvaManifest;
exports.commitDaSilvaMigration = commitDaSilvaMigration;
exports.validateDaSilvaClassroomsFromKidESys = validateDaSilvaClassroomsFromKidESys;
exports.commitDaSilvaClassroomsOnly = commitDaSilvaClassroomsOnly;
exports.buildDaSilvaLearnerParseAudit = buildDaSilvaLearnerParseAudit;
exports.parseDaSilvaLearnersFromSasams = parseDaSilvaLearnersFromSasams;
exports.parseDaSilvaLearnersFromClassList = parseDaSilvaLearnersFromClassList;
exports.validateDaSilvaLearnersFromKidESys = validateDaSilvaLearnersFromKidESys;
exports.commitDaSilvaLearnersOnly = commitDaSilvaLearnersOnly;
exports.buildDaSilvaParentsStagedLearners = buildDaSilvaParentsStagedLearners;
exports.validateDaSilvaParentsStaging = validateDaSilvaParentsStaging;
exports.validateDaSilvaParentsInDatabase = validateDaSilvaParentsInDatabase;
exports.commitDaSilvaParentsOnly = commitDaSilvaParentsOnly;
exports.commitDaSilvaBillingMatchOnly = commitDaSilvaBillingMatchOnly;
exports.buildDaSilvaBillingStagedLearners = buildDaSilvaBillingStagedLearners;
exports.validateDaSilvaBillingStaging = validateDaSilvaBillingStaging;
exports.validateDaSilvaBillingInDatabase = validateDaSilvaBillingInDatabase;
exports.commitDaSilvaBillingOnly = commitDaSilvaBillingOnly;
exports.rollbackDaSilvaMigration = rollbackDaSilvaMigration;
exports.buildDaSilvaBundleFromDesktopLayout = buildDaSilvaBundleFromDesktopLayout;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../../prisma");
const ageAnalysisParser_1 = require("./ageAnalysisParser");
const daSilvaMergedFamily_1 = require("./daSilvaMergedFamily");
const billingLedgerStore_1 = require("../../utils/billingLedgerStore");
const classroomNormalization_1 = require("../../utils/classroomNormalization");
const kideesysSpreadsheet_1 = require("../../utils/kideesysSpreadsheet");
const parsers_1 = require("./parsers");
const learnerBillingPlanStore_1 = require("../../utils/learnerBillingPlanStore");
const parentPortalService_1 = require("../parentPortalService");
const parentPortalService_2 = require("../parentPortalService");
const daSilvaOpeningBalance_1 = require("./daSilvaOpeningBalance");
const daSilvaFinalImportGate_1 = require("./daSilvaFinalImportGate");
const daSilvaConstants_1 = require("./daSilvaConstants");
const daSilvaPhaseGates_1 = require("./daSilvaPhaseGates");
const relinkDaSilvaLearnerBilling_1 = require("./relinkDaSilvaLearnerBilling");
const kideesysBillingReconciliation_1 = require("../kideesysMigration/kideesysBillingReconciliation");
const parsers_2 = require("./parsers");
const daSilvaMigrationStrategy_1 = require("./daSilvaMigrationStrategy");
const daSilvaMigrationAudit_1 = require("./daSilvaMigrationAudit");
const daSilvaKideesysBillingMatch_1 = require("./daSilvaKideesysBillingMatch");
const daSilvaKideesysBillingReconciliationReport_1 = require("./daSilvaKideesysBillingReconciliationReport");
const daSilvaParentLearnerMatching_1 = require("./daSilvaParentLearnerMatching");
const sasamsParsers_1 = require("./sasamsParsers");
const STAGING_ROOT = path_1.default.join(process.cwd(), "uploads", "migration-staging");
function stagingPath(schoolId, projectId) {
    return path_1.default.join(STAGING_ROOT, schoolId, `dasilva-${projectId}.json`);
}
function manifestPath(schoolId, projectId) {
    return path_1.default.join(STAGING_ROOT, schoolId, `dasilva-${projectId}.manifest.json`);
}
function ensureDir(dir) {
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
}
function createDaSilvaProjectId() {
    return `dasilva-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function uniqueLearnersByMatchKey(learners) {
    const map = new Map();
    for (const l of learners) {
        if (!map.has(l.matchKey))
            map.set(l.matchKey, l);
    }
    return Array.from(map.values());
}
function uniqueBillingLearners(items) {
    const keys = new Set();
    for (const item of items)
        keys.add(item.matchKey);
    return Array.from(keys);
}
function buildAccountMap(accounts, transactions) {
    const map = new Map();
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
function groupBillingPlans(items) {
    const map = new Map();
    for (const item of items) {
        const list = map.get(item.matchKey) || [];
        list.push({ feeDescription: item.feeDescription, amount: item.amount });
        map.set(item.matchKey, list);
    }
    return map;
}
function buildFamilyAccountIndex(accounts, billingItems, classLearners, contacts, transactions) {
    const index = {
        learnerNameToAccount: new Map(),
        accountToLearnerNames: new Map(),
    };
    (0, daSilvaMergedFamily_1.indexHistoricalLearners)(accounts, billingItems, classLearners, contacts, transactions, index);
    return index;
}
function loadSiblingAccountNos(siblingAccountsPath) {
    if (!siblingAccountsPath || !fs_1.default.existsSync(siblingAccountsPath)) {
        return new Set();
    }
    return (0, daSilvaMergedFamily_1.parseSiblingAccountsFile)(siblingAccountsPath);
}
function discoverSiblingAccountsPath(desktopRoot) {
    const candidates = [
        path_1.default.join(desktopRoot, "07_sibling_accounts", "sibling_accounts.xls"),
        path_1.default.join(desktopRoot, "07_sibling_accounts", "sibling_accounts_(merged).xls"),
    ];
    for (const candidate of candidates) {
        if (fs_1.default.existsSync(candidate))
            return candidate;
    }
    return undefined;
}
function resolveFamilyAccountNo(txn, index) {
    const byName = index.learnerNameToAccount.get((0, kideesysSpreadsheet_1.normalizeMatchText)(txn.fullName));
    if (byName)
        return byName;
    return String(txn.accountNo || "").trim();
}
/** Sum invoices/payments into one balance per family account (not per learner). */
function aggregateFamilyLedgerBalances(transactions, index) {
    const ledgerByAccount = new Map();
    for (const txn of transactions) {
        const familyAccountNo = resolveFamilyAccountNo(txn, index);
        if (!familyAccountNo)
            continue;
        const prev = ledgerByAccount.get(familyAccountNo) || 0;
        ledgerByAccount.set(familyAccountNo, prev + txn.signedAmount);
    }
    return ledgerByAccount;
}
function familyAccountForOrphanLedger(accountNo, index, transactions) {
    for (const txn of transactions) {
        if (txn.accountNo !== accountNo)
            continue;
        const family = resolveFamilyAccountNo(txn, index);
        if (family && family !== accountNo)
            return family;
    }
    return null;
}
function buildCountValidation(classLearners, contacts, billingItems, accounts) {
    const errors = [];
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
function buildReconciliation(stagedLearners, transactions, accounts, familyIndex, classLearners, contacts, siblingAccountNos) {
    const invoices = transactions.filter((t) => t.kind === "invoice");
    const payments = transactions.filter((t) => t.kind === "payment");
    const ledgerByAccount = aggregateFamilyLedgerBalances(transactions, familyIndex);
    const mergedFamilyAccountNos = (0, daSilvaMergedFamily_1.buildMergedFamilyAccountSet)({
        accounts,
        index: familyIndex,
        classLearners,
        contacts,
        txnSumByAccount: ledgerByAccount,
        siblingAccountNos,
    });
    const activeLearnersByAccount = (0, daSilvaMergedFamily_1.countActiveLearnersPerAccount)(classLearners, accounts, familyIndex);
    const rows = [];
    const seen = new Set();
    for (const account of accounts) {
        seen.add(account.accountNo);
        const txnSum = ledgerByAccount.get(account.accountNo) || 0;
        const activeLearnerCount = activeLearnersByAccount.get(account.accountNo) || 0;
        const ledgerBalance = (0, daSilvaMergedFamily_1.computeFamilyLedgerBalance)(account, txnSum, familyIndex, transactions, mergedFamilyAccountNos, activeLearnerCount);
        rows.push({
            accountNo: account.accountNo,
            fullName: account.fullName,
            ageAnalysisBalance: account.balance,
            ledgerBalanceFromImport: Math.round(ledgerBalance * 100) / 100,
            variance: Math.round((account.balance - ledgerBalance) * 100) / 100,
        });
    }
    for (const [accountNo, balance] of ledgerByAccount) {
        if (seen.has(accountNo))
            continue;
        if (familyAccountForOrphanLedger(accountNo, familyIndex, transactions))
            continue;
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
function buildDaSilvaMigrationBundle(opts) {
    const { classrooms: sasamsClassrooms, learners: sasamsClassLearners } = (0, sasamsParsers_1.parseSasamsClassListDirectory)(opts.paths.classListDir);
    const classLearners = (0, sasamsParsers_1.sasamsLearnersToParsedLearners)(sasamsClassLearners);
    const classrooms = sasamsClassrooms.map((c) => ({
        className: c.className,
        year: null,
        sourceFile: c.sourceFile,
    }));
    const contacts = (0, parsers_2.parseContactListFile)(opts.paths.contactList);
    const employees = (0, parsers_2.parseEmployeesFile)(opts.paths.employees);
    const billingItems = (0, parsers_2.parseBillingPlanFile)(opts.paths.billingPlan);
    const ageAnalysisParsed = (0, parsers_2.parseAgeAnalysisFileWithAudit)(opts.paths.ageAnalysis);
    const accounts = ageAnalysisParsed.accounts;
    const ageAnalysisParseAudit = ageAnalysisParsed.audit;
    const transactions = (0, parsers_2.parseTransactionListFile)(opts.paths.transactions);
    const contactByKey = new Map(contacts.map((c) => [c.matchKey, c]));
    const planByKey = groupBillingPlans(billingItems);
    const accountByName = new Map();
    const accountByNo = buildAccountMap(accounts, transactions);
    (0, ageAnalysisParser_1.indexAgeAnalysisAccountNames)(accounts, accountByName);
    for (const t of transactions) {
        accountByName.set((0, kideesysSpreadsheet_1.normalizeMatchText)(t.fullName), t.accountNo);
    }
    const uniqueClassLearners = uniqueLearnersByMatchKey(classLearners);
    const familyIndex = buildFamilyAccountIndex(accounts, billingItems, uniqueClassLearners, contacts, transactions);
    const siblingAccountNos = loadSiblingAccountNos(opts.paths.siblingAccounts);
    const stagedLearners = [];
    let learnersMatchedFromAgeAnalysis = 0;
    let learnersNotMatchedFromAgeAnalysis = 0;
    // Track fallback account numbers generated in this bundle so we can reuse the
    // same one if the same learner appears twice and guarantee uniqueness otherwise.
    const fallbackByMatchKey = new Map();
    let fallbackSeq = 0;
    /**
     * Generate a stable, deterministic fallback account number for a learner that
     * cannot be matched to any Kid-e-Sys account after Age Analysis is parsed.
     * Format: KID-MISSING-{4-digit-seq}  e.g. KID-MISSING-0001
     */
    function getFallbackAccountNo(matchKey) {
        if (fallbackByMatchKey.has(matchKey))
            return fallbackByMatchKey.get(matchKey);
        fallbackSeq += 1;
        const seq = String(fallbackSeq).padStart(4, "0");
        const fallback = `KID-MISSING-${seq}`;
        fallbackByMatchKey.set(matchKey, fallback);
        return fallback;
    }
    function resolveLearnerAccountFromAgeAnalysis(learnerFullName) {
        let accountNo = accountByName.get((0, kideesysSpreadsheet_1.normalizeMatchText)(learnerFullName)) ||
            (0, daSilvaMergedFamily_1.findAccountForLearnerName)(learnerFullName, accounts, familyIndex) ||
            "";
        if (!accountNo) {
            for (const [no, meta] of accountByNo) {
                if ((0, kideesysSpreadsheet_1.normalizeMatchText)(meta.fullName) === (0, kideesysSpreadsheet_1.normalizeMatchText)(learnerFullName)) {
                    accountNo = no;
                    break;
                }
            }
        }
        const ageRow = accounts.find((a) => a.accountNo === accountNo ||
            (0, kideesysSpreadsheet_1.normalizeMatchText)(a.fullName) === (0, kideesysSpreadsheet_1.normalizeMatchText)(learnerFullName) ||
            (a.learnerNames || (0, daSilvaMergedFamily_1.splitMergedAccountNames)(a.fullName)).some((n) => (0, kideesysSpreadsheet_1.normalizeMatchText)(n) === (0, kideesysSpreadsheet_1.normalizeMatchText)(learnerFullName)));
        const matchedFromAgeAnalysis = Boolean(ageRow?.accountNo && (0, ageAnalysisParser_1.isKidESysSourceAccountRef)(ageRow.accountNo));
        return { accountNo, ageRow, matchedFromAgeAnalysis };
    }
    for (const learner of uniqueClassLearners) {
        const norm = (0, classroomNormalization_1.normalizeClassroomInput)(learner.className);
        const canonicalClassName = norm.classroomName || learner.className;
        const contact = contactByKey.get(learner.matchKey);
        const billingPlan = planByKey.get(learner.matchKey) || [];
        const billingPlanTotal = billingPlan.reduce((s, i) => s + i.amount, 0);
        const { accountNo, ageRow, matchedFromAgeAnalysis } = resolveLearnerAccountFromAgeAnalysis(learner.fullName);
        const resolvedAccountNo = (accountNo && (0, ageAnalysisParser_1.isKidESysSourceAccountRef)(accountNo) ? accountNo : "") ||
            (ageRow?.accountNo && (0, ageAnalysisParser_1.isKidESysSourceAccountRef)(ageRow.accountNo) ? ageRow.accountNo : "") ||
            getFallbackAccountNo(learner.matchKey);
        if (matchedFromAgeAnalysis || (0, ageAnalysisParser_1.isKidESysSourceAccountRef)(resolvedAccountNo)) {
            learnersMatchedFromAgeAnalysis += 1;
        }
        else {
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
    const reconciliation = buildReconciliation(stagedLearners, transactions, accounts, familyIndex, uniqueClassLearners, contacts, siblingAccountNos);
    const ledgerByAccount = aggregateFamilyLedgerBalances(transactions, familyIndex);
    const mergedFamilyAccountNos = [
        ...(0, daSilvaMergedFamily_1.buildMergedFamilyAccountSet)({
            accounts,
            index: familyIndex,
            classLearners: uniqueClassLearners,
            contacts,
            txnSumByAccount: ledgerByAccount,
            siblingAccountNos,
        }),
    ].sort();
    const openingBalance = (0, daSilvaOpeningBalance_1.buildOpeningBalancePlan)({
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
async function saveDaSilvaStaging(bundle) {
    ensureDir(path_1.default.join(STAGING_ROOT, bundle.schoolId));
    fs_1.default.writeFileSync(stagingPath(bundle.schoolId, bundle.projectId), JSON.stringify(bundle, null, 2));
}
function loadDaSilvaStaging(schoolId, projectId) {
    const file = stagingPath(schoolId, projectId);
    if (!fs_1.default.existsSync(file))
        return null;
    return JSON.parse(fs_1.default.readFileSync(file, "utf8"));
}
function saveUploadedDaSilvaFiles(schoolId, projectId, files) {
    const base = path_1.default.join(STAGING_ROOT, schoolId, projectId, "uploads");
    ensureDir(base);
    const saved = {};
    if (files.classListDir) {
        const dest = path_1.default.join(base, "05_class_list");
        ensureDir(dest);
        const srcFiles = fs_1.default.readdirSync(files.classListDir).filter((f) => f.toLowerCase().endsWith(".xls"));
        for (const f of srcFiles) {
            fs_1.default.copyFileSync(path_1.default.join(files.classListDir, f), path_1.default.join(dest, f));
        }
        saved.classListDir = dest;
    }
    const singleFiles = [
        ["contactList", "contactList", "04_contact_list.xls"],
        ["employees", "employees", "06_employees.xls"],
        ["billingPlan", "billingPlan", "03_billing_plan.xls"],
        ["ageAnalysis", "ageAnalysis", "02_age_analysis.xls"],
        ["transactions", "transactions", "01_transactions.xls"],
    ];
    for (const [slot, key, destName] of singleFiles) {
        const src = files[slot];
        if (!src)
            continue;
        const dest = path_1.default.join(base, destName);
        fs_1.default.copyFileSync(src, dest);
        saved[key] = dest;
    }
    const required = [
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
    return saved;
}
async function previewDaSilvaMigration(opts) {
    const bundle = buildDaSilvaMigrationBundle(opts);
    await saveDaSilvaStaging(bundle);
    return bundle;
}
function ledgerEntryId(kind, transactionNo) {
    return `kidesys-${kind}-${transactionNo}`;
}
function parentStagingKey(matchKey, parentIndex) {
    return `${matchKey}:${parentIndex}`;
}
function writeDaSilvaManifest(schoolId, projectId, manifest) {
    ensureDir(path_1.default.join(STAGING_ROOT, schoolId));
    fs_1.default.writeFileSync(manifestPath(schoolId, projectId), JSON.stringify(manifest, null, 2));
}
function loadDaSilvaManifest(schoolId, projectId) {
    const file = manifestPath(schoolId, projectId);
    if (!fs_1.default.existsSync(file))
        return null;
    try {
        return JSON.parse(fs_1.default.readFileSync(file, "utf8"));
    }
    catch {
        return null;
    }
}
function pushUniqueId(list, id) {
    if (!list.includes(id))
        list.push(id);
}
function peekNextAdmissionNo(accountNo, accountLearnerSeq) {
    const trimmed = String(accountNo || "").trim();
    if (!trimmed)
        return null;
    const seq = (accountLearnerSeq.get(trimmed) || 0) + 1;
    return seq === 1 ? trimmed : `${trimmed}-${seq}`;
}
function allocateAdmissionNo(accountNo, accountLearnerSeq) {
    const trimmed = String(accountNo || "").trim();
    if (!trimmed)
        return null;
    const seq = (accountLearnerSeq.get(trimmed) || 0) + 1;
    accountLearnerSeq.set(trimmed, seq);
    return seq === 1 ? trimmed : `${trimmed}-${seq}`;
}
/** DB lookup so import retries cannot create duplicate learners when manifest is partial. */
async function findExistingLearnerIdForImportRow(opts) {
    if (opts.admissionNo) {
        const byAdm = await prisma_1.prisma.learner.findUnique({
            where: {
                schoolId_admissionNo: {
                    schoolId: opts.schoolId,
                    admissionNo: opts.admissionNo,
                },
            },
            select: { id: true },
        });
        if (byAdm)
            return byAdm.id;
    }
    const byName = await prisma_1.prisma.learner.findFirst({
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
function seedAccountLearnerSeqFromExisting(existing) {
    const accountLearnerSeq = new Map();
    for (const row of existing) {
        const adm = String(row.admissionNo || "").trim();
        if (!adm)
            continue;
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
async function runDaSilvaImportPhase(manifest, phase, schoolId, projectId, fn) {
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
    }
    catch (err) {
        manifest.failedPhase = phase;
        writeDaSilvaManifest(schoolId, projectId, manifest);
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[DaSilva import] phase "${phase}" FAILED: ${message}`);
        throw new Error(`Da Silva import failed at phase "${phase}": ${message}`);
    }
}
async function commitDaSilvaMigration(opts) {
    const bundle = loadDaSilvaStaging(opts.schoolId, opts.projectId);
    if (!bundle)
        throw new Error("Staging not found — run preview first");
    if (!bundle.openingBalance?.adjustments) {
        throw new Error("Staging bundle missing opening balance plan — re-run preview first");
    }
    if (!bundle.canImport) {
        throw new Error(`Count validation failed: ${bundle.countValidation.errors.join("; ")}`);
    }
    if (opts.confirmToken !== bundle.confirmToken) {
        throw new Error("Confirm token mismatch — re-run preview before final import");
    }
    const school = await prisma_1.prisma.school.findUnique({
        where: { id: opts.schoolId },
        select: { name: true },
    });
    if (!school)
        throw new Error("School not found");
    if (/da\s*silva\s*academy/i.test(school.name.trim())) {
        (0, daSilvaFinalImportGate_1.assertDaSilvaFinalImportAllowed)(bundle, school.name);
    }
    const existingManifest = loadDaSilvaManifest(opts.schoolId, opts.projectId);
    const manifest = existingManifest?.projectId === opts.projectId &&
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
        console.log(`[DaSilva import] resuming project ${opts.projectId} (${done} phase(s) already completed${manifest.failedPhase ? `, last failure: ${manifest.failedPhase}` : ""})`);
    }
    else {
        console.log(`[DaSilva import] starting fresh import for project ${opts.projectId}`);
        writeDaSilvaManifest(opts.schoolId, opts.projectId, manifest);
    }
    const matchKeyToLearnerId = new Map(Object.entries(manifest.matchKeyToLearnerId || {}));
    const accountToLearnerId = new Map(Object.entries(manifest.accountToLearnerId || {}));
    const accountToFamilyId = new Map();
    const persistLearnerMaps = () => {
        manifest.matchKeyToLearnerId = Object.fromEntries(matchKeyToLearnerId);
        manifest.accountToLearnerId = Object.fromEntries(accountToLearnerId);
    };
    const resolveLearnerIdForTxn = (txn) => accountToLearnerId.get(txn.accountNo) ||
        matchKeyToLearnerId.get((0, parsers_1.buildLearnerMatchKey)(txn.fullName, bundle.learners.find((l) => l.accountNo === txn.accountNo)?.className || "")) ||
        "";
    const ensureFamilyAccountMap = async () => {
        if (accountToFamilyId.size > 0)
            return;
        const accountNos = [
            ...new Set(bundle.learners
                .map((row) => String(row.accountNo || "").trim())
                .filter(Boolean)),
        ];
        if (!accountNos.length)
            return;
        const rows = await prisma_1.prisma.familyAccount.findMany({
            where: { accountRef: { in: accountNos } },
            select: { id: true, accountRef: true },
        });
        for (const row of rows) {
            accountToFamilyId.set(row.accountRef, row.id);
        }
    };
    await runDaSilvaImportPhase(manifest, "school_base", opts.schoolId, opts.projectId, async () => {
        const schoolRecord = await prisma_1.prisma.school.findUnique({
            where: { id: opts.schoolId },
            select: { id: true, name: true },
        });
        if (!schoolRecord)
            throw new Error("School not found");
        for (const emp of bundle.employees) {
            const existing = await prisma_1.prisma.employee.findFirst({
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
            const created = await prisma_1.prisma.employee.create({
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
            const norm = (0, classroomNormalization_1.normalizeClassroomInput)(classroom.className);
            const name = norm.classroomName || classroom.className;
            if (!name)
                continue;
            const record = await prisma_1.prisma.classroom.upsert({
                where: { schoolId_name: { schoolId: opts.schoolId, name } },
                create: { schoolId: opts.schoolId, name },
                update: {},
            });
            pushUniqueId(manifest.classroomIds, record.id);
        }
    });
    if (!manifest.stagedParentIds)
        manifest.stagedParentIds = {};
    await runDaSilvaImportPhase(manifest, "learners", opts.schoolId, opts.projectId, async () => {
        const existingAdmissionRows = await prisma_1.prisma.learner.findMany({
            where: { schoolId: opts.schoolId, admissionNo: { not: null } },
            select: { admissionNo: true },
        });
        const accountLearnerSeq = seedAccountLearnerSeqFromExisting(existingAdmissionRows);
        let learnerRowIndex = 0;
        for (const row of bundle.learners) {
            learnerRowIndex += 1;
            const accountNo = String(row.accountNo || "").trim();
            const isHistorical = row.enrollmentTier === "HISTORICAL";
            const norm = (0, classroomNormalization_1.normalizeClassroomInput)(row.className);
            const canonicalClassName = isHistorical ? null : row.canonicalClassName;
            let learnerId = manifest.matchKeyToLearnerId?.[row.matchKey] ||
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
                    const byBaseAccount = await prisma_1.prisma.learner.findUnique({
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
                await prisma_1.prisma.learner.update({
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
            }
            else {
                const admissionNo = accountNo
                    ? allocateAdmissionNo(accountNo, accountLearnerSeq)
                    : null;
                const learnerData = {
                    schoolId: opts.schoolId,
                    familyAccountId: null,
                    firstName: row.firstName,
                    lastName: row.lastName,
                    grade: isHistorical
                        ? "Historical"
                        : norm.gradeLabel || row.className.replace(/[A-Za-z]+$/, "").trim(),
                    className: canonicalClassName,
                    enrollmentStatus: isHistorical ? "HISTORICAL" : "ACTIVE",
                    admissionNo,
                    totalFee: 0,
                    tuitionFee: 0,
                };
                const learner = admissionNo != null
                    ? await prisma_1.prisma.learner.upsert({
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
                    : await prisma_1.prisma.learner.create({ data: learnerData });
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
        if (!manifest.stagedParentIds)
            manifest.stagedParentIds = {};
        for (const row of bundle.learners) {
            const learnerId = matchKeyToLearnerId.get(row.matchKey) || "";
            if (!learnerId) {
                throw new Error(`Missing learner id for ${row.matchKey} — learners phase required before parents`);
            }
            const accountNo = String(row.accountNo || "").trim();
            let familyAccountId = accountNo ? accountToFamilyId.get(accountNo) || null : null;
            if (accountNo && !familyAccountId) {
                const fa = await prisma_1.prisma.familyAccount.upsert({
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
            await prisma_1.prisma.learner.update({
                where: { id: learnerId },
                data: { familyAccountId },
            });
            for (let pi = 0; pi < row.parents.length; pi++) {
                const parent = row.parents[pi];
                const stageKey = parentStagingKey(row.matchKey, pi);
                const phone = (0, parentPortalService_1.normalizeSaPhone)(parent.cellNo || parent.homeNo || "");
                const cellNo = phone?.localCell || parent.cellNo || "";
                const existingParent = await prisma_1.prisma.parent.findFirst({
                    where: {
                        schoolId: opts.schoolId,
                        firstName: parent.firstName,
                        surname: parent.surname,
                        cellNo,
                        familyAccountId: familyAccountId ?? null,
                    },
                    select: { id: true },
                });
                const parentId = existingParent?.id ||
                    (await prisma_1.prisma.parent.create({
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
                    })).id;
                manifest.stagedParentIds[stageKey] = parentId;
                pushUniqueId(manifest.parentIds, parentId);
                const link = await prisma_1.prisma.parentLearnerLink.upsert({
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
        const billingPlans = {};
        for (const row of bundle.learners) {
            const learnerId = matchKeyToLearnerId.get(row.matchKey);
            if (learnerId && row.billingPlan.length) {
                billingPlans[learnerId] = row.billingPlan;
            }
        }
        (0, learnerBillingPlanStore_1.upsertSchoolBillingPlans)(opts.schoolId, billingPlans);
    });
    await runDaSilvaImportPhase(manifest, "transactions", opts.schoolId, opts.projectId, async () => {
        const ledgerEntries = [];
        for (const txn of bundle.transactions) {
            const entry = {
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
        (0, billingLedgerStore_1.upsertSchoolEntries)(opts.schoolId, ledgerEntries);
    });
    const relinkResult = await (0, relinkDaSilvaLearnerBilling_1.relinkDaSilvaLearnerBillingFromBundle)({
        schoolId: opts.schoolId,
        bundle,
        manifest,
        matchKeyToLearnerId,
        accountToLearnerId,
    });
    persistLearnerMaps();
    manifest.accountToLearnerId = relinkResult.accountToLearnerId;
    if (relinkResult.learnersUpdated > 0 || relinkResult.ledgerRowsBackfilled > 0) {
        console.log(`[DaSilva import] relinked ${relinkResult.learnersUpdated} learner(s), ` +
            `backfilled ${relinkResult.ledgerRowsBackfilled} ledger row(s)`);
    }
    await runDaSilvaImportPhase(manifest, "opening_balances", opts.schoolId, opts.projectId, async () => {
        const ledgerEntries = [];
        for (const adj of (0, daSilvaFinalImportGate_1.approvedOpeningBalanceAdjustments)(bundle)) {
            const learnerId = accountToLearnerId.get(adj.accountNo) || "";
            const entry = {
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
        (0, billingLedgerStore_1.upsertSchoolEntries)(opts.schoolId, ledgerEntries);
    });
    const ledgerBackfilled = (0, billingLedgerStore_1.backfillLedgerLearnerIds)(opts.schoolId, manifest.accountToLearnerId || {});
    if (ledgerBackfilled > 0) {
        console.log(`[DaSilva import] backfilled learnerId on ${ledgerBackfilled} ledger row(s)`);
    }
    console.log("[DaSilva import] running Kid-e-Sys post-migration billing reconciliation…");
    const reconciliation = await (0, kideesysBillingReconciliation_1.runKideesysPostMigrationReconciliation)({
        schoolId: opts.schoolId,
        projectId: opts.projectId,
    });
    console.log(`[DaSilva import] reconciliation gate passed — ` +
        `${reconciliation.auditAfter.learnersWithResolvableAccountNo}/${reconciliation.auditAfter.learnersTotal} learners with account numbers, ` +
        `${reconciliation.auditAfter.nonZeroBalanceAccountCount} account(s) with non-zero balance`);
    console.log("[DaSilva import] syncing parent threads for imported classrooms…");
    for (const classroomId of manifest.classroomIds) {
        await (0, parentPortalService_2.syncParentThreadsForClassroom)(opts.schoolId, classroomId);
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
var daSilvaConstants_2 = require("./daSilvaConstants");
Object.defineProperty(exports, "DA_SILVA_BILLING_ACCOUNT_TARGET", { enumerable: true, get: function () { return daSilvaConstants_2.DA_SILVA_BILLING_ACCOUNT_TARGET; } });
Object.defineProperty(exports, "DA_SILVA_EXPECTED_CLASSROOM_COUNT", { enumerable: true, get: function () { return daSilvaConstants_2.DA_SILVA_EXPECTED_CLASSROOM_COUNT; } });
Object.defineProperty(exports, "DA_SILVA_EXPECTED_CLASSROOM_LEARNER_COUNTS", { enumerable: true, get: function () { return daSilvaConstants_2.DA_SILVA_EXPECTED_CLASSROOM_LEARNER_COUNTS; } });
Object.defineProperty(exports, "DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT", { enumerable: true, get: function () { return daSilvaConstants_2.DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT; } });
Object.defineProperty(exports, "DA_SILVA_EXPECTED_CREche_SUPPLEMENT_LEARNER_COUNT", { enumerable: true, get: function () { return daSilvaConstants_2.DA_SILVA_EXPECTED_CREche_SUPPLEMENT_LEARNER_COUNT; } });
Object.defineProperty(exports, "DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT", { enumerable: true, get: function () { return daSilvaConstants_2.DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT; } });
Object.defineProperty(exports, "DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT", { enumerable: true, get: function () { return daSilvaConstants_2.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT; } });
Object.defineProperty(exports, "DA_SILVA_EXPECTED_LEARNER_COUNT", { enumerable: true, get: function () { return daSilvaConstants_2.DA_SILVA_EXPECTED_LEARNER_COUNT; } });
Object.defineProperty(exports, "DA_SILVA_EXPECTED_PARENT_COUNT", { enumerable: true, get: function () { return daSilvaConstants_2.DA_SILVA_EXPECTED_PARENT_COUNT; } });
Object.defineProperty(exports, "DA_SILVA_EXPECTED_PARENT_LINK_COUNT", { enumerable: true, get: function () { return daSilvaConstants_2.DA_SILVA_EXPECTED_PARENT_LINK_COUNT; } });
Object.defineProperty(exports, "DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT", { enumerable: true, get: function () { return daSilvaConstants_2.DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT; } });
Object.defineProperty(exports, "DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_FILE_COUNT", { enumerable: true, get: function () { return daSilvaConstants_2.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_FILE_COUNT; } });
Object.defineProperty(exports, "DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT", { enumerable: true, get: function () { return daSilvaConstants_2.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT; } });
Object.defineProperty(exports, "DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT", { enumerable: true, get: function () { return daSilvaConstants_2.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT; } });
Object.defineProperty(exports, "DA_SILVA_EXPECTED_SASAMS_CLASSROOM_LEARNER_COUNTS", { enumerable: true, get: function () { return daSilvaConstants_2.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_LEARNER_COUNTS; } });
Object.defineProperty(exports, "DA_SILVA_EXPECTED_UNIQUE_PARENT_COUNT", { enumerable: true, get: function () { return daSilvaConstants_2.DA_SILVA_EXPECTED_UNIQUE_PARENT_COUNT; } });
Object.defineProperty(exports, "isAllowedDaSilvaSupplementClassroom", { enumerable: true, get: function () { return daSilvaConstants_2.isAllowedDaSilvaSupplementClassroom; } });
var daSilvaPhaseGates_2 = require("./daSilvaPhaseGates");
Object.defineProperty(exports, "assertDaSilvaMigrationGates", { enumerable: true, get: function () { return daSilvaPhaseGates_2.assertDaSilvaMigrationGates; } });
function canonicalClassroomName(className) {
    const norm = (0, classroomNormalization_1.normalizeClassroomInput)(className);
    return norm.classroomName || className;
}
/** Validate SA-SAMS class list exports before/after classroom-only import (phase 1). */
function validateDaSilvaClassroomsFromKidESys(classListDir, existingDbClassroomNames = []) {
    const errors = [];
    const { classrooms, learners } = (0, sasamsParsers_1.parseSasamsClassListDirectory)(classListDir);
    const expectedFileCount = daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT;
    const expectedSasamsLearners = daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT;
    const learnerCountByCanonical = new Map();
    for (const learner of learners) {
        const name = canonicalClassroomName(learner.className);
        learnerCountByCanonical.set(name, (learnerCountByCanonical.get(name) || 0) + 1);
    }
    const rows = classrooms.map((classroom) => {
        const canonicalName = canonicalClassroomName(classroom.className);
        const norm = (0, classroomNormalization_1.normalizeClassroomInput)(classroom.className);
        return {
            sourceFile: classroom.sourceFile,
            rawClassName: classroom.className,
            canonicalName,
            matchKey: norm.matchKey || canonicalName.toLowerCase(),
            learnerCount: learnerCountByCanonical.get(canonicalName) || 0,
        };
    });
    const byMatchKey = new Map();
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
    const ignoredSupplementClassNames = dbNotInSasams.filter(daSilvaConstants_1.isAllowedDaSilvaSupplementClassroom);
    const ghostClassNames = dbNotInSasams.filter((name) => !(0, daSilvaConstants_1.isAllowedDaSilvaSupplementClassroom)(name));
    const sourceFileCount = rows.length;
    const uniqueCanonicalCount = new Set(rows.map((r) => r.canonicalName)).size;
    const uniqueMatchKeyCount = byMatchKey.size;
    const totalLearners = learners.length;
    if (sourceFileCount !== expectedFileCount) {
        errors.push(`Expected ${expectedFileCount} SA-SAMS class list files (Crèche excluded), found ${sourceFileCount} in ${classListDir}`);
    }
    if (uniqueCanonicalCount !== expectedFileCount) {
        errors.push(`Expected ${expectedFileCount} unique SA-SAMS classrooms, found ${uniqueCanonicalCount} canonical names`);
    }
    if (uniqueMatchKeyCount !== expectedFileCount) {
        errors.push(`Expected ${expectedFileCount} unique SA-SAMS match keys, found ${uniqueMatchKeyCount}`);
    }
    if (totalLearners !== expectedSasamsLearners) {
        errors.push(`Expected ${expectedSasamsLearners} SA-SAMS class-list learners, found ${totalLearners} (Crèche ${daSilvaConstants_1.DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT} is a separate supplement → ${daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} total)`);
    }
    if (duplicates.length) {
        errors.push(`Duplicate classrooms: ${duplicates.map((d) => `${d.canonicalName} (${d.files.join(", ")})`).join("; ")}`);
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
async function commitDaSilvaClassroomsOnly(opts) {
    const school = await prisma_1.prisma.school.findUnique({
        where: { id: opts.schoolId },
        select: { id: true },
    });
    if (!school)
        throw new Error("School not found");
    const existingDb = await prisma_1.prisma.classroom.findMany({
        where: { schoolId: opts.schoolId },
        select: { name: true },
        orderBy: { name: "asc" },
    });
    const validation = validateDaSilvaClassroomsFromKidESys(opts.classListDir, existingDb.map((c) => c.name));
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
    const manifest = existingManifest?.projectId === opts.projectId &&
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
            strategy: daSilvaMigrationStrategy_1.DA_SILVA_MIGRATION_STRATEGY,
            importedAt: new Date().toISOString(),
            learnerIds: [],
            parentIds: [],
            linkIds: [],
            classroomIds: [],
            employeeIds: [],
            ledgerEntryIds: [],
            phasesCompleted: [],
        };
    manifest.strategy = daSilvaMigrationStrategy_1.DA_SILVA_MIGRATION_STRATEGY;
    await runDaSilvaImportPhase(manifest, "classrooms", opts.schoolId, opts.projectId, async () => {
        for (const row of validation.classrooms) {
            const record = await prisma_1.prisma.classroom.upsert({
                where: { schoolId_name: { schoolId: opts.schoolId, name: row.canonicalName } },
                create: { schoolId: opts.schoolId, name: row.canonicalName },
                update: {},
            });
            pushUniqueId(manifest.classroomIds, record.id);
        }
    });
    writeDaSilvaManifest(opts.schoolId, opts.projectId, manifest);
    const postDb = await prisma_1.prisma.classroom.findMany({
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
    const supplementCount = (0, daSilvaConstants_1.countDaSilvaSupplementClassrooms)(postDbNames);
    const sasamsDbCount = (0, daSilvaConstants_1.countDaSilvaSasamsClassrooms)(postDbNames);
    if (sasamsDbCount !== daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT) {
        postImportValidation.passed = false;
        postImportValidation.errors.push(`Database has ${sasamsDbCount} SA-SAMS classrooms after import (expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT})`);
    }
    try {
        (0, daSilvaPhaseGates_1.assertDaSilvaMigrationGates)({
            phase: "classrooms",
            classroomNames: postDbNames,
            errors: postImportValidation.passed ? [] : postImportValidation.errors,
        });
    }
    catch (e) {
        postImportValidation.passed = false;
        if (e instanceof Error)
            postImportValidation.errors.push(e.message);
    }
    (0, daSilvaMigrationAudit_1.writeDaSilvaMigrationAudit)(opts.schoolId, opts.projectId, {
        strategy: daSilvaMigrationStrategy_1.DA_SILVA_MIGRATION_STRATEGY,
        phase: "classrooms",
        generatedAt: new Date().toISOString(),
        schoolId: opts.schoolId,
        projectId: opts.projectId,
        passed: postImportValidation.passed,
        summary: {
            classrooms: postDb.length,
            sasamsClassrooms: sasamsDbCount,
            supplementClassrooms: supplementCount,
            expectedSasamsClassrooms: daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT,
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
function sasamsLearnerToImportRow(learner, enrichedFromRegister = false) {
    const norm = (0, classroomNormalization_1.normalizeClassroomInput)(learner.className);
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
function buildDaSilvaLearnerParseAudit(classListLearners, merged, mergeAudit) {
    const perClassroomCounts = new Map();
    let missingDob = 0;
    let missingGender = 0;
    let missingId = 0;
    for (const row of merged) {
        perClassroomCounts.set(row.canonicalClassName, (perClassroomCounts.get(row.canonicalClassName) || 0) + 1);
        if (!row.birthDate)
            missingDob += 1;
        if (!row.gender)
            missingGender += 1;
        if (!row.idNumber)
            missingId += 1;
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
function parseDaSilvaLearnersFromSasams(paths, auditOut) {
    const { learners: classListLearners } = (0, sasamsParsers_1.parseSasamsClassListDirectory)(paths.classListDir);
    const registerLearners = (0, sasamsParsers_1.parseSasamsLearnerRegister)(paths.learnerRegister);
    const mergeAudit = {
        classListParsed: 0,
        registerParsed: 0,
        mergedTotal: 0,
        enrichedFromRegister: 0,
        registerOnlySkipped: 0,
    };
    const merged = (0, sasamsParsers_1.mergeSasamsLearnerSources)(classListLearners, registerLearners, mergeAudit);
    const byKey = new Map();
    for (const learner of merged) {
        byKey.set(learner.matchKey, sasamsLearnerToImportRow(learner, Boolean(learner.enrichedFromRegister)));
    }
    if (auditOut) {
        auditOut.audit = buildDaSilvaLearnerParseAudit(classListLearners, merged, mergeAudit);
    }
    return Array.from(byKey.values());
}
/** @deprecated Use parseDaSilvaLearnersFromSasams */
function parseDaSilvaLearnersFromClassList(classListDir) {
    return parseDaSilvaLearnersFromSasams({
        classListDir,
        learnerRegister: classListDir,
        parentRegister: classListDir,
    });
}
/** Validate SA-SAMS learner totals before/after learners-only import. */
async function validateDaSilvaLearnersFromKidESys(paths, schoolId) {
    const ingest = typeof paths === "string"
        ? {
            classListDir: paths,
            learnerRegister: paths,
            parentRegister: paths,
        }
        : paths;
    return validateDaSilvaLearnersInDatabase(ingest, schoolId);
}
async function validateDaSilvaLearnersInDatabase(paths, schoolId) {
    const errors = [];
    const sourceRows = parseDaSilvaLearnersFromSasams(paths);
    const expectedByClass = new Map();
    for (const row of sourceRows) {
        expectedByClass.set(row.canonicalClassName, (expectedByClass.get(row.canonicalClassName) || 0) + 1);
    }
    const expectedSasamsTotal = daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT;
    if (sourceRows.length !== expectedSasamsTotal) {
        errors.push(`Expected ${expectedSasamsTotal} SA-SAMS class-list learners, found ${sourceRows.length} (final roster ${daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} includes Crèche supplement ${daSilvaConstants_1.DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT})`);
    }
    for (const [name, count] of Object.entries(daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_LEARNER_COUNTS)) {
        const actual = expectedByClass.get(name) || 0;
        if (actual !== count) {
            errors.push(`SA-SAMS ${name}: expected ${count} learners, found ${actual}`);
        }
    }
    const crecheInSasams = expectedByClass.get("Creche") || 0;
    if (crecheInSasams > 0) {
        errors.push(`Crèche must not appear in SA-SAMS class lists (found ${crecheInSasams}); use Kid-e-Sys supplement for ${daSilvaConstants_1.DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT} Crèche learners`);
    }
    let actualTotal = sourceRows.length;
    let orphanCount = 0;
    let orphans = [];
    const actualByClass = new Map();
    if (schoolId) {
        const dbLearners = await prisma_1.prisma.learner.findMany({
            where: { schoolId },
            select: { id: true, firstName: true, lastName: true, className: true },
        });
        actualTotal = dbLearners.length;
        if (!(0, daSilvaConstants_1.isAcceptableDaSilvaPhase2LearnerCount)(actualTotal) && !(0, daSilvaConstants_1.isAcceptableDaSilvaPhase3LearnerCount)(actualTotal)) {
            errors.push(`Database has ${actualTotal} learners (expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS-only, or ${daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} after Crèche supplement)`);
        }
        const classroomNames = new Set((await prisma_1.prisma.classroom.findMany({
            where: { schoolId },
            select: { name: true },
        })).map((c) => c.name));
        for (const learner of dbLearners) {
            const className = String(learner.className || "").trim();
            if (!className || !classroomNames.has(className)) {
                orphanCount += 1;
                orphans.push(learner);
            }
            else {
                actualByClass.set(className, (actualByClass.get(className) || 0) + 1);
            }
        }
        if (orphanCount > 0) {
            errors.push(`${orphanCount} orphan learner(s) not linked to a classroom`);
        }
        for (const [name, expected] of Object.entries(daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_LEARNER_COUNTS)) {
            const actual = actualByClass.get(name) || 0;
            if (actual !== expected) {
                errors.push(`Database ${name}: expected ${expected} learners, found ${actual}`);
            }
        }
    }
    const classroomCounts = Object.entries(daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_LEARNER_COUNTS)
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
/**
 * Phase 2 only: import learners from SA-SAMS class lists (primary) + learner register (enrichment).
 * Does not import parents, billing, employees, or ledger entries.
 */
async function commitDaSilvaLearnersOnly(opts) {
    const school = await prisma_1.prisma.school.findUnique({
        where: { id: opts.schoolId },
        select: { id: true },
    });
    if (!school)
        throw new Error("School not found");
    const classroomValidation = validateDaSilvaClassroomsFromKidESys(opts.sasamsPaths.classListDir);
    const parseAuditHolder = {
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
    if (parseAuditHolder.audit.classListParsed !== daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT) {
        throw new Error(`Expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS class-list learners, found ${parseAuditHolder.audit.classListParsed}`);
    }
    const dbClassrooms = await prisma_1.prisma.classroom.findMany({
        where: { schoolId: opts.schoolId },
        select: { name: true },
    });
    const dbClassroomNames = dbClassrooms.map((c) => c.name);
    const sasamsDbClassrooms = (0, daSilvaConstants_1.countDaSilvaSasamsClassrooms)(dbClassroomNames);
    if (sasamsDbClassrooms !== daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT) {
        throw new Error(`Phase 1 required: database has ${sasamsDbClassrooms} SA-SAMS classrooms (expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASSROOM_COUNT}). Run da-silva-classrooms-only.ts first.`);
    }
    const classroomNameSet = new Set(dbClassrooms.map((c) => c.name));
    const existingParents = await prisma_1.prisma.parent.count({ where: { schoolId: opts.schoolId } });
    const existingEmployees = await prisma_1.prisma.employee.count({ where: { schoolId: opts.schoolId } });
    if (existingParents > 0) {
        throw new Error(`BLOCKED: school already has ${existingParents} parent(s) — learners-only import expects none`);
    }
    if (existingEmployees > 0) {
        throw new Error(`BLOCKED: school already has ${existingEmployees} employee(s) — learners-only import expects none`);
    }
    const existingManifest = loadDaSilvaManifest(opts.schoolId, opts.projectId);
    if (!existingManifest) {
        throw new Error(`No manifest for project ${opts.projectId}. Run da-silva-classrooms-only.ts first with the same project id.`);
    }
    if (!existingManifest.phasesCompleted?.includes("classrooms")) {
        throw new Error("Phase 1 (classrooms) not completed in manifest — run da-silva-classrooms-only.ts first.");
    }
    const manifest = {
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
    const failed = [];
    const skipped = [];
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
            let learnerId = manifest.matchKeyToLearnerId?.[row.matchKey] || matchKeyToLearnerId.get(row.matchKey) || null;
            if (!learnerId) {
                learnerId = await findExistingLearnerIdForImportRow({
                    schoolId: opts.schoolId,
                    firstName: row.firstName,
                    lastName: row.lastName,
                    className: row.canonicalClassName,
                    admissionNo: row.admissionNo,
                });
            }
            const norm = (0, classroomNormalization_1.normalizeClassroomInput)(row.canonicalClassName);
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
                enrollmentStatus: "ACTIVE",
                totalFee: 0,
                tuitionFee: 0,
            };
            try {
                if (learnerId) {
                    const existing = await prisma_1.prisma.learner.findUnique({
                        where: { id: learnerId },
                        select: { className: true },
                    });
                    if (existing &&
                        existing.className === row.canonicalClassName &&
                        manifest.matchKeyToLearnerId?.[row.matchKey]) {
                        skipped.push({
                            matchKey: row.matchKey,
                            fullName: row.fullName,
                            reason: "Already imported (manifest match)",
                        });
                    }
                    else {
                        await prisma_1.prisma.learner.update({
                            where: { id: learnerId },
                            data: learnerData,
                        });
                        learnersUpdated += 1;
                    }
                }
                else {
                    const created = await prisma_1.prisma.learner.create({ data: learnerData });
                    learnerId = created.id;
                    learnersCreated += 1;
                }
            }
            catch (err) {
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
    const postImportValidation = await validateDaSilvaLearnersInDatabase(opts.sasamsPaths, opts.schoolId);
    if (failed.length > 0) {
        postImportValidation.passed = false;
        postImportValidation.errors.push(`${failed.length} learner(s) failed to import`);
    }
    try {
        (0, daSilvaPhaseGates_1.assertDaSilvaMigrationGates)({
            phase: "learners",
            classroomNames: dbClassroomNames,
            learnerCount: manifest.learnerIds.length,
            phasesCompleted: manifest.phasesCompleted,
            errors: postImportValidation.passed ? [] : postImportValidation.errors,
        });
    }
    catch (e) {
        postImportValidation.passed = false;
        if (e instanceof Error)
            postImportValidation.errors.push(e.message);
    }
    (0, daSilvaMigrationAudit_1.writeDaSilvaMigrationAudit)(opts.schoolId, opts.projectId, {
        strategy: daSilvaMigrationStrategy_1.DA_SILVA_MIGRATION_STRATEGY,
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
    const importAudit = {
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
/** Kid-e-Sys parents + family account refs (contact list + age analysis only — no billing/ledger). */
function buildDaSilvaParentsStagedLearners(paths) {
    const { learners: sasamsClassLearners } = (0, sasamsParsers_1.parseSasamsClassListDirectory)(paths.classListDir);
    const classLearners = (0, sasamsParsers_1.sasamsLearnersToParsedLearners)(sasamsClassLearners);
    const contacts = (0, parsers_2.parseContactListFile)(paths.contactList);
    const accounts = (0, parsers_2.parseAgeAnalysisFile)(paths.ageAnalysis);
    const contactByKey = new Map(contacts.map((c) => [c.matchKey, c]));
    const accountByName = new Map();
    (0, ageAnalysisParser_1.indexAgeAnalysisAccountNames)(accounts, accountByName);
    const uniqueClassLearners = uniqueLearnersByMatchKey(classLearners);
    const familyIndex = buildFamilyAccountIndex(accounts, [], uniqueClassLearners, contacts, []);
    const staged = [];
    for (const learner of uniqueClassLearners) {
        const norm = (0, classroomNormalization_1.normalizeClassroomInput)(learner.className);
        const canonicalClassName = norm.classroomName || learner.className;
        const contact = contactByKey.get(learner.matchKey);
        let accountNo = accountByName.get((0, kideesysSpreadsheet_1.normalizeMatchText)(learner.fullName)) || "";
        if (!accountNo) {
            accountNo = (0, daSilvaMergedFamily_1.findAccountForLearnerName)(learner.fullName, accounts, familyIndex);
        }
        const ageRow = accounts.find((a) => a.accountNo === accountNo ||
            (0, kideesysSpreadsheet_1.normalizeMatchText)(a.fullName) === (0, kideesysSpreadsheet_1.normalizeMatchText)(learner.fullName) ||
            (a.learnerNames || (0, daSilvaMergedFamily_1.splitMergedAccountNames)(a.fullName)).some((n) => (0, kideesysSpreadsheet_1.normalizeMatchText)(n) === (0, kideesysSpreadsheet_1.normalizeMatchText)(learner.fullName)));
        staged.push({
            matchKey: learner.matchKey,
            fullName: learner.fullName,
            firstName: learner.firstName,
            lastName: learner.lastName,
            className: learner.className,
            canonicalClassName,
            accountNo: (accountNo && (0, ageAnalysisParser_1.isKidESysSourceAccountRef)(accountNo) ? accountNo : "") ||
                (ageRow?.accountNo && (0, ageAnalysisParser_1.isKidESysSourceAccountRef)(ageRow.accountNo) ? ageRow.accountNo : ""),
            billingPlan: [],
            billingPlanTotal: 0,
            ageAnalysisBalance: 0,
            parents: contact?.parents || [],
        });
    }
    return staged;
}
function countUniqueParentsInStaging(staged) {
    const keys = new Set();
    for (const row of staged) {
        for (const parent of row.parents) {
            const phone = (0, parentPortalService_1.normalizeSaPhone)(parent.cellNo || parent.homeNo || "");
            const cellNo = phone?.localCell || parent.cellNo || "";
            keys.add([parent.firstName, parent.surname, cellNo, String(row.accountNo || "").trim()].join("|"));
        }
    }
    return keys.size;
}
function validateDaSilvaParentsStaging(paths) {
    const staged = buildDaSilvaParentsStagedLearners(paths);
    const errors = [];
    const parentLinkCount = staged.reduce((s, row) => s + row.parents.length, 0);
    const uniqueParentCount = countUniqueParentsInStaging(staged);
    const accountNos = new Set(staged.map((row) => String(row.accountNo || "").trim()).filter(Boolean));
    const learnersWithoutAccount = staged
        .filter((row) => !String(row.accountNo || "").trim())
        .map((row) => row.fullName);
    if (parentLinkCount !== daSilvaConstants_1.DA_SILVA_EXPECTED_PARENT_LINK_COUNT) {
        errors.push(`Expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_PARENT_LINK_COUNT} parent slots in contact list, found ${parentLinkCount}`);
    }
    if (uniqueParentCount !== daSilvaConstants_1.DA_SILVA_EXPECTED_UNIQUE_PARENT_COUNT) {
        errors.push(`Expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_UNIQUE_PARENT_COUNT} unique parents in contact list, found ${uniqueParentCount}`);
    }
    if (accountNos.size !== daSilvaConstants_1.DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT) {
        errors.push(`Expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT} family account refs on learners, found ${accountNos.size}`);
    }
    if (learnersWithoutAccount.length) {
        errors.push(`${learnersWithoutAccount.length} learner(s) missing billing account ref`);
    }
    if (staged.length !== daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT) {
        errors.push(`Expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} staged learners, found ${staged.length}`);
    }
    return {
        passed: errors.length === 0,
        expectedParentLinks: daSilvaConstants_1.DA_SILVA_EXPECTED_PARENT_LINK_COUNT,
        actualParentLinks: parentLinkCount,
        expectedUniqueParents: daSilvaConstants_1.DA_SILVA_EXPECTED_UNIQUE_PARENT_COUNT,
        actualUniqueParents: uniqueParentCount,
        expectedFamilyAccounts: daSilvaConstants_1.DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT,
        actualFamilyAccounts: accountNos.size,
        learnersWithoutAccount,
        errors,
    };
}
async function validateDaSilvaParentsInDatabase(schoolId, staged, matchKeyToLearnerId = {}) {
    const errors = [];
    const parents = await prisma_1.prisma.parent.count({ where: { schoolId } });
    const familyAccounts = await prisma_1.prisma.familyAccount.count({ where: { schoolId } });
    const links = await prisma_1.prisma.parentLearnerLink.count({ where: { schoolId } });
    if (parents !== daSilvaConstants_1.DA_SILVA_EXPECTED_UNIQUE_PARENT_COUNT) {
        errors.push(`Database has ${parents} unique parents (expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_UNIQUE_PARENT_COUNT})`);
    }
    if (familyAccounts !== daSilvaConstants_1.DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT) {
        errors.push(`Database has ${familyAccounts} family accounts (expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT})`);
    }
    if (links !== daSilvaConstants_1.DA_SILVA_EXPECTED_PARENT_LINK_COUNT) {
        errors.push(`Database has ${links} parent-learner links (expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_PARENT_LINK_COUNT})`);
    }
    const orphanParents = await prisma_1.prisma.parent.findMany({
        where: {
            schoolId,
            links: { none: {} },
        },
        select: { id: true, firstName: true, surname: true },
    });
    if (orphanParents.length) {
        errors.push(`${orphanParents.length} orphan parent(s) with no learner link`);
    }
    const familyRows = await prisma_1.prisma.familyAccount.findMany({
        where: { schoolId },
        select: { accountRef: true },
    });
    const refCounts = new Map();
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
    const learnersWithoutFamilyAccount = await prisma_1.prisma.learner.findMany({
        where: { schoolId, familyAccountId: null },
        select: { id: true, firstName: true, lastName: true },
    });
    if (learnersWithoutFamilyAccount.length) {
        errors.push(`${learnersWithoutFamilyAccount.length} learner(s) without a family account`);
    }
    const accountRefById = new Map((await prisma_1.prisma.familyAccount.findMany({
        where: { schoolId },
        select: { id: true, accountRef: true },
    })).map((row) => [row.id, row.accountRef]));
    const learnersWrongFamilyAccount = [];
    const dbLearners = await prisma_1.prisma.learner.findMany({
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
        if (!learnerId)
            continue;
        const expectedRef = String(row.accountNo || "").trim();
        if (!expectedRef)
            continue;
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
        errors.push(`${learnersWrongFamilyAccount.length} learner(s) linked to wrong family account`);
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
async function validateDaSilvaSasamsParentsInDatabase(schoolId) {
    const errors = [];
    const parents = await prisma_1.prisma.parent.count({ where: { schoolId } });
    const links = await prisma_1.prisma.parentLearnerLink.count({ where: { schoolId } });
    const familyAccounts = await prisma_1.prisma.familyAccount.count({ where: { schoolId } });
    if (familyAccounts > 0) {
        errors.push(`Phase 3 must not create family accounts (${familyAccounts} found) — run phase 4 billing match first`);
    }
    if (links < 1) {
        errors.push("No parent-learner links created");
    }
    else if (links !== daSilvaConstants_1.DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT) {
        errors.push(`Database has ${links} parent-learner links (expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT})`);
    }
    const orphanParents = await prisma_1.prisma.parent.findMany({
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
async function commitDaSilvaParentsOnly(opts) {
    const school = await prisma_1.prisma.school.findUnique({
        where: { id: opts.schoolId },
        select: { id: true },
    });
    if (!school)
        throw new Error("School not found");
    const sasamsParents = (0, sasamsParsers_1.parseSasamsParentSources)(opts.paths.parentRegister, opts.paths.parentLearnerLinks);
    const dbLearners = await prisma_1.prisma.learner.findMany({
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
    if (!(0, daSilvaConstants_1.isAcceptableDaSilvaPhase3LearnerCount)(dbLearners.length)) {
        throw new Error(`Phase 2 required: database has ${dbLearners.length} learners (expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS or ${daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} after Crèche supplement)`);
    }
    const parentAudit = (0, daSilvaParentLearnerMatching_1.auditParentMatches)(sasamsParents, dbLearners);
    const indexes = (0, daSilvaParentLearnerMatching_1.buildLearnerMatchIndexes)(dbLearners);
    const learnersById = new Map(dbLearners.map((l) => [l.id, l]));
    const stagingErrors = [];
    if (parentAudit.unmatchedParents.length > daSilvaMigrationStrategy_1.DA_SILVA_BILLING_MATCH_MAX_UNMATCHED) {
        stagingErrors.push(`${parentAudit.unmatchedParents.length} SA-SAMS parent row(s) could not be matched to learners`);
    }
    if (parentAudit.duplicateMatches.length > 0) {
        stagingErrors.push(`${parentAudit.duplicateMatches.length} parent row(s) have ambiguous learner matches`);
    }
    const stagingValidation = {
        passed: stagingErrors.length === 0,
        parentRows: sasamsParents.length,
        expectedParentLinks: daSilvaConstants_1.DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT,
        actualParentLinks: sasamsParents.length - parentAudit.unmatchedParents.length,
        unmatchedParents: parentAudit.unmatchedParents.length,
        duplicateMatches: parentAudit.duplicateMatches.length,
        errors: stagingErrors,
    };
    const existingParents = await prisma_1.prisma.parent.count({ where: { schoolId: opts.schoolId } });
    const existingEmployees = await prisma_1.prisma.employee.count({ where: { schoolId: opts.schoolId } });
    if (existingParents > 0 &&
        !loadDaSilvaManifest(opts.schoolId, opts.projectId)?.phasesCompleted?.includes("parents")) {
        throw new Error(`BLOCKED: school already has ${existingParents} parent(s) but manifest parents phase not recorded`);
    }
    if (existingEmployees > 0) {
        throw new Error(`BLOCKED: school already has ${existingEmployees} employee(s) — parents-only import expects none`);
    }
    if ((0, billingLedgerStore_1.readSchoolLedger)(opts.schoolId).length > 0) {
        throw new Error("BLOCKED: billing ledger already has entries for this school");
    }
    if (Object.keys((0, learnerBillingPlanStore_1.readSchoolBillingPlans)(opts.schoolId)).length > 0) {
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
    const manifest = {
        ...existingManifest,
        parentIds: existingManifest.parentIds || [],
        linkIds: existingManifest.linkIds || [],
        stagedParentIds: existingManifest.stagedParentIds || {},
        matchKeyToLearnerId: existingManifest.matchKeyToLearnerId || {},
        phasesCompleted: existingManifest.phasesCompleted || [],
    };
    const missingLearnerKeys = [];
    let parentIndex = 0;
    await runDaSilvaImportPhase(manifest, "parents", opts.schoolId, opts.projectId, async () => {
        if (!manifest.stagedParentIds)
            manifest.stagedParentIds = {};
        for (const parentRow of sasamsParents) {
            parentIndex += 1;
            const match = (0, daSilvaParentLearnerMatching_1.matchParentToLearner)(parentRow, indexes, learnersById);
            if (!match.learnerId || match.ambiguous)
                continue;
            const stageKey = `sasams-parent:${parentIndex}`;
            if (manifest.stagedParentIds[stageKey])
                continue;
            const phone = (0, parentPortalService_1.normalizeSaPhone)(parentRow.cellNo || parentRow.homeNo || "");
            const cellNo = phone?.localCell || parentRow.cellNo || "0000000000";
            const existingParent = await prisma_1.prisma.parent.findFirst({
                where: {
                    schoolId: opts.schoolId,
                    firstName: parentRow.firstName,
                    surname: parentRow.surname,
                    cellNo,
                    familyAccountId: null,
                },
                select: { id: true },
            });
            const parentId = existingParent?.id ||
                (await prisma_1.prisma.parent.create({
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
                })).id;
            manifest.stagedParentIds[stageKey] = parentId;
            pushUniqueId(manifest.parentIds, parentId);
            const link = await prisma_1.prisma.parentLearnerLink.upsert({
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
        (0, daSilvaPhaseGates_1.assertDaSilvaMigrationGates)({
            phase: "parents",
            learnerCount: dbLearners.length,
            parentLinkCount: postImportValidation.links,
            phasesCompleted: manifest.phasesCompleted,
            errors: [...stagingValidation.errors, ...postImportValidation.errors],
        });
    }
    catch (e) {
        postImportValidation.passed = false;
        if (e instanceof Error)
            postImportValidation.errors.push(e.message);
    }
    (0, daSilvaMigrationAudit_1.writeDaSilvaMigrationAudit)(opts.schoolId, opts.projectId, {
        strategy: daSilvaMigrationStrategy_1.DA_SILVA_MIGRATION_STRATEGY,
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
/**
 * Phase 4: match Kid-e-Sys billing accounts to SA-SAMS learners (no profile overwrite).
 */
async function commitDaSilvaBillingMatchOnly(opts) {
    const existingManifest = loadDaSilvaManifest(opts.schoolId, opts.projectId);
    if (!existingManifest)
        throw new Error(`No manifest for project ${opts.projectId}`);
    if (!existingManifest.phasesCompleted?.includes("parents")) {
        throw new Error("Phase 3 (parents) must complete before billing match");
    }
    const accounts = (0, parsers_2.parseAgeAnalysisFile)(opts.paths.ageAnalysis);
    const ageAnalysisAudit = (0, parsers_2.parseAgeAnalysisFileWithAudit)(opts.paths.ageAnalysis);
    if (!ageAnalysisAudit.accounts.length || ageAnalysisAudit.audit.headerRowIndex === null) {
        throw new Error("Age analysis parser failed — no accounts or header row detected");
    }
    const { learners: sasamsClassLearners } = (0, sasamsParsers_1.parseSasamsClassListDirectory)(opts.paths.classListDir);
    const classListLearners = (0, sasamsParsers_1.sasamsLearnersToParsedLearners)(sasamsClassLearners);
    const dbLearners = await prisma_1.prisma.learner.findMany({
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
        matchKey: (0, parsers_1.buildLearnerMatchKey)(`${l.firstName} ${l.lastName}`, l.className || ""),
        idNumber: l.idNumber,
        admissionNo: l.admissionNo,
    }));
    const secondPassPaths = (0, daSilvaMigrationStrategy_1.discoverBillingSecondPassPaths)(opts.paths.ageAnalysis);
    const billingPlanItems = secondPassPaths.billingPlan && fs_1.default.existsSync(secondPassPaths.billingPlan)
        ? (0, parsers_2.parseBillingPlanFile)(secondPassPaths.billingPlan)
        : [];
    const transactions = secondPassPaths.transactions && fs_1.default.existsSync(secondPassPaths.transactions)
        ? (0, parsers_2.parseTransactionListFile)(secondPassPaths.transactions)
        : [];
    const contacts = secondPassPaths.contactList && fs_1.default.existsSync(secondPassPaths.contactList)
        ? (0, parsers_2.parseContactListFile)(secondPassPaths.contactList)
        : [];
    const { audit, report } = (0, daSilvaKideesysBillingMatch_1.matchKideesysBillingAccountsWithSecondPass)({
        accounts,
        dbLearners: dbForMatch,
        classListLearners,
        mergedFamilyAccountNos: [],
        billingPlanItems,
        transactions,
        contacts,
    });
    const reconciliationReportPath = path_1.default.join(process.cwd(), "kideesys-billing-reconciliation-report.txt");
    const reconciliationJsonPath = path_1.default.join(process.cwd(), "kideesys-billing-reconciliation-report.json");
    const school = await prisma_1.prisma.school.findUnique({
        where: { id: opts.schoolId },
        select: { name: true },
    });
    fs_1.default.writeFileSync(reconciliationReportPath, (0, daSilvaKideesysBillingReconciliationReport_1.formatKideesysBillingReconciliationReportText)(report, school?.name || opts.schoolId));
    fs_1.default.writeFileSync(reconciliationJsonPath, JSON.stringify(report, null, 2));
    const matchedCount = audit.matched.filter((r) => r.learnerId).length;
    (0, daSilvaPhaseGates_1.assertDaSilvaMigrationGates)({
        phase: "billing_match",
        billingMatched: matchedCount,
        billingTotal: accounts.length,
        phasesCompleted: existingManifest.phasesCompleted || [],
    });
    const manifest = {
        ...existingManifest,
        accountToLearnerId: existingManifest.accountToLearnerId || {},
        phasesCompleted: existingManifest.phasesCompleted || [],
    };
    await runDaSilvaImportPhase(manifest, "billing_match", opts.schoolId, opts.projectId, async () => {
        const siblingGroups = (0, daSilvaKideesysBillingMatch_1.groupSiblingAccounts)(audit.matched);
        const accountToLearnerId = new Map();
        for (const row of audit.matched) {
            if (row.learnerId)
                accountToLearnerId.set(row.accountNo, row.learnerId);
        }
        for (const [accountNo, learnerIds] of siblingGroups) {
            const familyName = dbLearners.find((l) => l.id === learnerIds[0])?.lastName || accountNo;
            const fa = await prisma_1.prisma.familyAccount.upsert({
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
                await prisma_1.prisma.learner.update({
                    where: { id: learnerId },
                    data: { familyAccountId: fa.id },
                });
                accountToLearnerId.set(accountNo, learnerId);
            }
        }
        manifest.accountToLearnerId = Object.fromEntries(accountToLearnerId);
    });
    writeDaSilvaManifest(opts.schoolId, opts.projectId, manifest);
    const auditPath = (0, daSilvaMigrationAudit_1.writeDaSilvaMigrationAudit)(opts.schoolId, opts.projectId, {
        strategy: daSilvaMigrationStrategy_1.DA_SILVA_MIGRATION_STRATEGY,
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
/** Kid-e-Sys billing plan + age analysis (no transactions or employees). */
function buildDaSilvaBillingStagedLearners(paths) {
    const { learners: sasamsClassLearners } = (0, sasamsParsers_1.parseSasamsClassListDirectory)(paths.classListDir);
    const classLearners = (0, sasamsParsers_1.sasamsLearnersToParsedLearners)(sasamsClassLearners);
    const billingItems = (0, parsers_2.parseBillingPlanFile)(paths.billingPlan);
    const accounts = (0, parsers_2.parseAgeAnalysisFile)(paths.ageAnalysis);
    const planByKey = groupBillingPlans(billingItems);
    const accountByName = new Map();
    (0, ageAnalysisParser_1.indexAgeAnalysisAccountNames)(accounts, accountByName);
    const uniqueClassLearners = uniqueLearnersByMatchKey(classLearners);
    const familyIndex = buildFamilyAccountIndex(accounts, billingItems, uniqueClassLearners, [], []);
    const staged = [];
    for (const learner of uniqueClassLearners) {
        const norm = (0, classroomNormalization_1.normalizeClassroomInput)(learner.className);
        const canonicalClassName = norm.classroomName || learner.className;
        const billingPlan = planByKey.get(learner.matchKey) || [];
        const billingPlanTotal = billingPlan.reduce((s, i) => s + i.amount, 0);
        let accountNo = accountByName.get((0, kideesysSpreadsheet_1.normalizeMatchText)(learner.fullName)) || "";
        if (!accountNo) {
            accountNo = (0, daSilvaMergedFamily_1.findAccountForLearnerName)(learner.fullName, accounts, familyIndex);
        }
        const ageRow = accounts.find((a) => a.accountNo === accountNo ||
            (0, kideesysSpreadsheet_1.normalizeMatchText)(a.fullName) === (0, kideesysSpreadsheet_1.normalizeMatchText)(learner.fullName) ||
            (a.learnerNames || (0, daSilvaMergedFamily_1.splitMergedAccountNames)(a.fullName)).some((n) => (0, kideesysSpreadsheet_1.normalizeMatchText)(n) === (0, kideesysSpreadsheet_1.normalizeMatchText)(learner.fullName)));
        staged.push({
            matchKey: learner.matchKey,
            fullName: learner.fullName,
            firstName: learner.firstName,
            lastName: learner.lastName,
            className: learner.className,
            canonicalClassName,
            accountNo: (accountNo && (0, ageAnalysisParser_1.isKidESysSourceAccountRef)(accountNo) ? accountNo : "") ||
                (ageRow?.accountNo && (0, ageAnalysisParser_1.isKidESysSourceAccountRef)(ageRow.accountNo) ? ageRow.accountNo : ""),
            billingPlan,
            billingPlanTotal,
            ageAnalysisBalance: ageRow?.balance ?? 0,
            parents: [],
        });
    }
    return staged;
}
function validateDaSilvaBillingStaging(paths) {
    const errors = [];
    const accounts = (0, parsers_2.parseAgeAnalysisFile)(paths.ageAnalysis);
    const billingItems = (0, parsers_2.parseBillingPlanFile)(paths.billingPlan);
    const staged = buildDaSilvaBillingStagedLearners(paths);
    const expectedBillingAccounts = daSilvaConstants_1.DA_SILVA_EXPECTED_FAMILY_ACCOUNT_COUNT;
    const actualBillingAccounts = accounts.length;
    const learnersWithBillingPlan = uniqueBillingLearners(billingItems).length;
    const feeDescriptions = new Set(billingItems.map((i) => String(i.feeDescription || "").trim()).filter(Boolean));
    const ageAnalysisTotalOutstanding = Math.round(accounts.reduce((s, a) => s + a.balance, 0) * 100) / 100;
    if (actualBillingAccounts !== expectedBillingAccounts) {
        errors.push(`Age analysis has ${actualBillingAccounts} accounts (expected ${expectedBillingAccounts})`);
    }
    if (learnersWithBillingPlan !== daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT && learnersWithBillingPlan !== daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT) {
        errors.push(`Billing plan covers ${learnersWithBillingPlan} learners (expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} or ${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS-only before Crèche supplement)`);
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
function inferFeeFrequency(description) {
    if (/\b(once|registration|deposit|admission|enrol+ment|annual)\b/i.test(description)) {
        return "ONCE_OFF";
    }
    return "MONTHLY";
}
async function upsertFeeStructuresFromBillingPlan(schoolId, billingItems) {
    const byDescription = new Map();
    for (const item of billingItems) {
        const desc = String(item.feeDescription || "").trim();
        if (!desc)
            continue;
        const amount = Number(item.amount) || 0;
        const prev = byDescription.get(desc) || 0;
        if (amount > prev)
            byDescription.set(desc, amount);
    }
    const existingFees = await prisma_1.prisma.feeStructure.findMany({
        where: { schoolId },
        select: { id: true, name: true },
    });
    const existingByName = new Map(existingFees.map((f) => [f.name.trim().toLowerCase(), f.id]));
    let created = 0;
    let existing = 0;
    const feeStructureIds = [];
    for (const [description, amount] of byDescription) {
        const key = description.toLowerCase();
        const foundId = existingByName.get(key);
        if (foundId) {
            existing += 1;
            feeStructureIds.push(foundId);
            continue;
        }
        const fee = await prisma_1.prisma.feeStructure.create({
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
async function buildAccountToLearnerIdFromDatabase(schoolId) {
    const rows = await prisma_1.prisma.learner.findMany({
        where: { schoolId, familyAccountId: { not: null } },
        select: {
            id: true,
            familyAccount: { select: { accountRef: true } },
        },
        orderBy: { createdAt: "asc" },
    });
    const map = new Map();
    for (const row of rows) {
        const accountNo = String(row.familyAccount?.accountRef || "").trim();
        if (!accountNo || map.has(accountNo))
            continue;
        map.set(accountNo, row.id);
    }
    return map;
}
async function validateDaSilvaBillingInDatabase(schoolId, paths, accountToLearnerId) {
    const errors = [];
    const accounts = (0, parsers_2.parseAgeAnalysisFile)(paths.ageAnalysis);
    const kidesysAgeAnalysisTotal = Math.round(accounts.reduce((s, a) => s + a.balance, 0) * 100) / 100;
    const billingPlans = (0, learnerBillingPlanStore_1.readSchoolBillingPlans)(schoolId);
    const billingPlansImported = Object.keys(billingPlans).length;
    const feeStructuresImported = await prisma_1.prisma.feeStructure.count({ where: { schoolId } });
    const familyAccounts = await prisma_1.prisma.familyAccount.count({ where: { schoolId } });
    const ledger = (0, billingLedgerStore_1.readSchoolLedger)(schoolId);
    const openingEntries = ledger.filter((e) => e.source === "kidesys_migration_opening_balance");
    const nonOpeningEntries = ledger.filter((e) => e.source !== "kidesys_migration_opening_balance");
    if (nonOpeningEntries.length) {
        errors.push(`${nonOpeningEntries.length} non-opening ledger row(s) present (payments/invoices not allowed in phase 4)`);
    }
    const openingBalancesImported = openingEntries.length;
    const openingByAccount = new Map();
    for (const entry of openingEntries) {
        const ref = String(entry.accountNo || "").trim();
        openingByAccount.set(ref, (openingByAccount.get(ref) || 0) + 1);
    }
    const duplicateOpeningBalanceRefs = [...openingByAccount.entries()]
        .filter(([, count]) => count > 1)
        .map(([ref]) => ref);
    const familyRefs = new Set((await prisma_1.prisma.familyAccount.findMany({
        where: { schoolId },
        select: { accountRef: true },
    })).map((r) => String(r.accountRef || "").trim()));
    const excludedAccounts = new Set(daSilvaConstants_1.DA_SILVA_OPENING_BALANCE_EXCLUDED_ACCOUNTS);
    const orphanBillingAccountRefs = accounts
        .map((a) => a.accountNo)
        .filter((ref) => ref && !familyRefs.has(ref));
    const zeroBalanceAccountsWithKidesysDebt = [];
    let totalOutstandingImported = 0;
    let ageAnalysisVarianceTotal = 0;
    let varianceAccountCount = 0;
    for (const account of accounts) {
        const excluded = excludedAccounts.has(account.accountNo);
        const learnerId = accountToLearnerId[account.accountNo] || "";
        const ledgerBalance = (0, billingLedgerStore_1.calculateBalanceForAccount)(ledger, learnerId, account.accountNo);
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
                errors.push(`Account ${account.accountNo}: Kid-e-Sys R${kidesysBalance} ≠ ledger R${ledgerBalance}`);
            }
        }
    }
    if (varianceAccountCount > 15) {
        errors.push(`${varianceAccountCount} account(s) with age/ledger mismatch (first 15 listed above)`);
    }
    if (familyAccounts < daSilvaMigrationStrategy_1.DA_SILVA_BILLING_MATCH_MIN_MATCHED) {
        errors.push(`Family accounts: ${familyAccounts} (expected at least ${daSilvaMigrationStrategy_1.DA_SILVA_BILLING_MATCH_MIN_MATCHED} matched; ${daSilvaConstants_1.DA_SILVA_BILLING_ACCOUNT_TARGET} total in Kid-e-Sys with manual review for remainder)`);
    }
    if (duplicateOpeningBalanceRefs.length) {
        errors.push(`Duplicate opening balance refs: ${duplicateOpeningBalanceRefs.join(", ")}`);
    }
    if (orphanBillingAccountRefs.length) {
        errors.push(`${orphanBillingAccountRefs.length} orphan billing account ref(s)`);
    }
    if (zeroBalanceAccountsWithKidesysDebt.length) {
        errors.push(`${zeroBalanceAccountsWithKidesysDebt.length} account(s) with Kid-e-Sys balance but zero ledger`);
    }
    const kidesysComparableTotal = Math.round(accounts
        .filter((a) => !excludedAccounts.has(a.accountNo))
        .reduce((s, a) => s + a.balance, 0) * 100) / 100;
    if (Math.abs(kidesysComparableTotal - totalOutstandingImported) > 0.02) {
        errors.push(`Age analysis total R${kidesysComparableTotal} ≠ imported outstanding R${totalOutstandingImported} (excludes manual accounts: ${daSilvaConstants_1.DA_SILVA_OPENING_BALANCE_EXCLUDED_ACCOUNTS.join(", ")})`);
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
async function commitDaSilvaBillingOnly(opts) {
    const school = await prisma_1.prisma.school.findUnique({
        where: { id: opts.schoolId },
        select: { id: true },
    });
    if (!school)
        throw new Error("School not found");
    const stagingValidation = validateDaSilvaBillingStaging(opts.paths);
    if (!stagingValidation.passed) {
        throw new Error(`Billing staging validation failed: ${stagingValidation.errors.join("; ")}`);
    }
    const dbLearners = await prisma_1.prisma.learner.count({ where: { schoolId: opts.schoolId } });
    if (!(0, daSilvaConstants_1.isAcceptableDaSilvaPhase3LearnerCount)(dbLearners)) {
        throw new Error(`Phase 2 required: ${dbLearners} learners (expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS or ${daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT} after Crèche supplement)`);
    }
    const existingEmployees = await prisma_1.prisma.employee.count({ where: { schoolId: opts.schoolId } });
    if (existingEmployees > 0) {
        throw new Error(`BLOCKED: ${existingEmployees} employee(s) — phase 4 does not import payroll`);
    }
    const ledgerBefore = (0, billingLedgerStore_1.readSchoolLedger)(opts.schoolId);
    const hasNonOpeningLedger = ledgerBefore.some((e) => e.source !== "kidesys_migration_opening_balance");
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
    const billingItems = (0, parsers_2.parseBillingPlanFile)(opts.paths.billingPlan);
    const accounts = (0, parsers_2.parseAgeAnalysisFile)(opts.paths.ageAnalysis);
    const openingAdjustments = (0, daSilvaOpeningBalance_1.buildPhase4OpeningBalancesFromAgeAnalysis)({ accounts });
    const manifest = {
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
        const billingPlans = {};
        for (const row of staged) {
            const learnerId = matchKeyToLearnerId.get(row.matchKey);
            if (!learnerId)
                continue;
            if (row.billingPlan.length) {
                billingPlans[learnerId] = row.billingPlan;
            }
            await prisma_1.prisma.learner.update({
                where: { id: learnerId },
                data: {
                    totalFee: row.billingPlanTotal,
                    tuitionFee: row.billingPlanTotal,
                },
                select: { id: true },
            });
            learnersFeeUpdated += 1;
        }
        (0, learnerBillingPlanStore_1.upsertSchoolBillingPlans)(opts.schoolId, billingPlans);
        billingPlansImported = Object.keys(billingPlans).length;
        const accountToLearnerId = await buildAccountToLearnerIdFromDatabase(opts.schoolId);
        manifest.accountToLearnerId = Object.fromEntries(accountToLearnerId);
    });
    await runDaSilvaImportPhase(manifest, "opening_balances", opts.schoolId, opts.projectId, async () => {
        const accountToLearnerId = new Map(Object.entries(manifest.accountToLearnerId || {}));
        const balanceByAccount = new Map(accounts.map((a) => [a.accountNo, a.balance]));
        const ledgerEntries = [];
        for (const adj of openingAdjustments) {
            const learnerId = accountToLearnerId.get(adj.accountNo) || "";
            const entry = {
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
        (0, billingLedgerStore_1.upsertSchoolEntries)(opts.schoolId, ledgerEntries);
        for (const [accountNo, balance] of balanceByAccount) {
            const family = await prisma_1.prisma.familyAccount.findFirst({
                where: { schoolId: opts.schoolId, accountRef: accountNo },
                select: { id: true },
            });
            if (!family)
                continue;
            const result = await prisma_1.prisma.parent.updateMany({
                where: { schoolId: opts.schoolId, familyAccountId: family.id },
                data: { outstandingAmount: Math.round(balance * 100) / 100 },
            });
            parentsOutstandingUpdated += result.count;
        }
    });
    const ledgerBackfilled = (0, billingLedgerStore_1.backfillLedgerLearnerIds)(opts.schoolId, manifest.accountToLearnerId || {});
    if (ledgerBackfilled > 0) {
        console.log(`[DaSilva import] backfilled learnerId on ${ledgerBackfilled} opening balance row(s)`);
    }
    writeDaSilvaManifest(opts.schoolId, opts.projectId, manifest);
    const postImportValidation = await validateDaSilvaBillingInDatabase(opts.schoolId, opts.paths, manifest.accountToLearnerId || {});
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
async function rollbackDaSilvaMigration(opts) {
    const file = manifestPath(opts.schoolId, opts.projectId);
    if (!fs_1.default.existsSync(file)) {
        throw new Error("No Da Silva import manifest found for rollback");
    }
    const manifest = JSON.parse(fs_1.default.readFileSync(file, "utf8"));
    const removed = {
        ledgerEntries: 0,
        links: 0,
        learners: 0,
        parents: 0,
        classrooms: 0,
        employees: 0,
    };
    const { readSchoolLedger, writeSchoolLedger } = await Promise.resolve().then(() => __importStar(require("../../utils/billingLedgerStore")));
    const ledger = readSchoolLedger(opts.schoolId).filter((e) => !manifest.ledgerEntryIds.includes(e.id));
    writeSchoolLedger(opts.schoolId, ledger);
    removed.ledgerEntries = manifest.ledgerEntryIds.length;
    (0, learnerBillingPlanStore_1.removeSchoolBillingPlans)(opts.schoolId, manifest.learnerIds);
    await prisma_1.prisma.$transaction(async (tx) => {
        if (manifest.linkIds.length) {
            removed.links = (await tx.parentLearnerLink.deleteMany({
                where: { id: { in: manifest.linkIds }, schoolId: opts.schoolId },
            })).count;
        }
        if (manifest.learnerIds.length) {
            removed.learners = (await tx.learner.deleteMany({
                where: { id: { in: manifest.learnerIds }, schoolId: opts.schoolId },
            })).count;
        }
        if (manifest.parentIds.length) {
            removed.parents = (await tx.parent.deleteMany({
                where: { id: { in: manifest.parentIds }, schoolId: opts.schoolId },
            })).count;
        }
        if (manifest.classroomIds.length) {
            removed.classrooms = (await tx.classroom.deleteMany({
                where: { id: { in: manifest.classroomIds }, schoolId: opts.schoolId },
            })).count;
        }
        if (manifest.employeeIds.length) {
            removed.employees = (await tx.employee.deleteMany({
                where: { id: { in: manifest.employeeIds }, schoolId: opts.schoolId },
            })).count;
        }
    });
    fs_1.default.unlinkSync(file);
    return { success: true, removed };
}
/** CLI / local preview using explicit folder paths (Desktop export layout). */
function buildDaSilvaBundleFromDesktopLayout(schoolId, projectId, desktopRoot) {
    const siblingAccounts = discoverSiblingAccountsPath(desktopRoot);
    return buildDaSilvaMigrationBundle({
        schoolId,
        projectId,
        paths: {
            classListDir: path_1.default.join(desktopRoot, "05_class_list"),
            contactList: path_1.default.join(desktopRoot, "04_contact_list", "contact_list.xls"),
            employees: path_1.default.join(desktopRoot, "06_employees", "employee_contact_list.xls"),
            billingPlan: path_1.default.join(desktopRoot, "03_billing_plan_summary_by_child", "billing_plan_summary_by_child.xls"),
            ageAnalysis: path_1.default.join(desktopRoot, "02_account_list_age_analysis", "account_list_(age_analysis).xls"),
            transactions: path_1.default.join(desktopRoot, "01_transaction_list", "transaction_list.xls"),
            siblingAccounts,
        },
    });
}
var daSilvaMergedFamily_2 = require("./daSilvaMergedFamily");
Object.defineProperty(exports, "splitMergedAccountNames", { enumerable: true, get: function () { return daSilvaMergedFamily_2.splitMergedAccountNames; } });
Object.defineProperty(exports, "buildMergedFamilyAccountSet", { enumerable: true, get: function () { return daSilvaMergedFamily_2.buildMergedFamilyAccountSet; } });
var daSilvaOpeningBalance_2 = require("./daSilvaOpeningBalance");
Object.defineProperty(exports, "KIDESYS_OPENING_BALANCE_LABEL", { enumerable: true, get: function () { return daSilvaOpeningBalance_2.KIDESYS_OPENING_BALANCE_LABEL; } });
Object.defineProperty(exports, "DA_SILVA_MIGRATION_CUTOVER_DATE", { enumerable: true, get: function () { return daSilvaOpeningBalance_2.DA_SILVA_MIGRATION_CUTOVER_DATE; } });
Object.defineProperty(exports, "countAgeAnalysisVarianceAfterAdjustments", { enumerable: true, get: function () { return daSilvaOpeningBalance_2.countAgeAnalysisVarianceAfterAdjustments; } });
