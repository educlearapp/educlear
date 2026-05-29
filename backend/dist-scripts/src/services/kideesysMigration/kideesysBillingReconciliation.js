"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KideesysMigrationGateError = void 0;
exports.auditKideesysMigrationHealth = auditKideesysMigrationHealth;
exports.assertKideesysMigrationCompletionGate = assertKideesysMigrationCompletionGate;
exports.reconcileKideesysBillingLinks = reconcileKideesysBillingLinks;
exports.runKideesysPostMigrationReconciliation = runKideesysPostMigrationReconciliation;
const prisma_1 = require("../../prisma");
const ageAnalysisParser_1 = require("../daSilvaMigration/ageAnalysisParser");
const daSilvaMigrationService_1 = require("../daSilvaMigration/daSilvaMigrationService");
const relinkDaSilvaLearnerBilling_1 = require("../daSilvaMigration/relinkDaSilvaLearnerBilling");
const billingLedgerRelink_1 = require("../billingLedgerRelink");
const statementAccounts_1 = require("../statementAccounts");
const learnerIdentity_1 = require("../../utils/learnerIdentity");
const billingLedgerStore_1 = require("../../utils/billingLedgerStore");
const kidesysTransactionHistoryStore_1 = require("../../utils/kidesysTransactionHistoryStore");
class KideesysMigrationGateError extends Error {
    constructor(message, audit) {
        super(message);
        this.audit = audit;
        this.name = "KideesysMigrationGateError";
    }
}
exports.KideesysMigrationGateError = KideesysMigrationGateError;
function admissionBase(admissionNo) {
    const adm = String(admissionNo || "").trim();
    if (!adm)
        return "";
    const dash = adm.indexOf("-");
    return dash === -1 ? adm : adm.slice(0, dash);
}
function resolveKidesysFamilyAccountRefOnly(learner) {
    const ref = String(learner.familyAccount?.accountRef || "").trim();
    return (0, ageAnalysisParser_1.isKidESysSourceAccountRef)(ref) ? ref : "";
}
function isSasamsNumericAccountRef(value) {
    const v = String(value || "").trim();
    if (!v)
        return false;
    if ((0, ageAnalysisParser_1.isKidESysSourceAccountRef)(v))
        return false;
    return /^\d{8,}$/.test(v);
}
function loadBundleForSchool(schoolId, projectId) {
    if (projectId) {
        const bundle = (0, daSilvaMigrationService_1.loadDaSilvaStaging)(schoolId, projectId);
        return { bundle, projectId: bundle ? projectId : null };
    }
    const latest = (0, relinkDaSilvaLearnerBilling_1.findLatestDaSilvaStagingBundle)(schoolId);
    return { bundle: latest?.bundle || null, projectId: latest?.projectId || null };
}
function sourceAccountNumbers(bundle) {
    const set = new Set();
    if (!bundle)
        return set;
    for (const row of bundle.accounts || []) {
        const accountNo = String(row.accountNo || "").trim();
        if ((0, ageAnalysisParser_1.isKidESysSourceAccountRef)(accountNo))
            set.add(accountNo);
    }
    if (set.size === 0) {
        for (const row of bundle.learners) {
            const accountNo = String(row.accountNo || "").trim();
            if ((0, ageAnalysisParser_1.isKidESysSourceAccountRef)(accountNo))
                set.add(accountNo);
        }
    }
    return set;
}
function ledgerRowResolvable(entry, accountToLearnerId) {
    const learnerId = String(entry.learnerId || "").trim();
    if (learnerId)
        return true;
    const accountNo = String(entry.accountNo || "").trim();
    if (!accountNo || accountNo === "-")
        return false;
    return Boolean(accountToLearnerId[accountNo] || accountToLearnerId[admissionBase(accountNo)]);
}
function patchLedgerAccountNumbers(schoolId, accountToLearnerId) {
    const learnerToAccountRef = {};
    for (const [ref, learnerId] of Object.entries(accountToLearnerId)) {
        if (!learnerId || learnerToAccountRef[learnerId])
            continue;
        learnerToAccountRef[learnerId] = ref;
    }
    const entries = (0, billingLedgerStore_1.readSchoolLedger)(schoolId);
    if (!entries.length)
        return 0;
    let patched = 0;
    const next = entries.map((entry) => {
        const accountNo = String(entry.accountNo || "").trim();
        const learnerId = String(entry.learnerId || "").trim();
        if (accountNo && accountNo !== "-")
            return entry;
        if (!learnerId)
            return entry;
        const ref = learnerToAccountRef[learnerId];
        if (!ref)
            return entry;
        patched += 1;
        return { ...entry, accountNo: ref };
    });
    if (patched > 0)
        (0, billingLedgerStore_1.writeSchoolLedger)(schoolId, next);
    return patched;
}
function countDuplicateKeys(rows) {
    const seen = new Map();
    let dupes = 0;
    for (const row of rows) {
        const accountNo = String(row.accountNo || "").trim();
        const key = accountNo && accountNo !== "-"
            ? `account:${accountNo}`
            : `learner:${String(row.learnerId || "").trim()}`;
        const count = (seen.get(key) || 0) + 1;
        seen.set(key, count);
        if (count === 2)
            dupes += 1;
    }
    return dupes;
}
function countDuplicatePaymentIds(schoolId) {
    const payments = (0, billingLedgerStore_1.readSchoolLedger)(schoolId).filter((e) => e.type === "payment");
    const seen = new Set();
    let dupes = 0;
    for (const entry of payments) {
        if (seen.has(entry.id))
            dupes += 1;
        else
            seen.add(entry.id);
    }
    return dupes;
}
async function auditKideesysMigrationHealth(schoolId, bundle = null) {
    const sid = String(schoolId || "").trim();
    const resolvedBundle = bundle ?? (0, relinkDaSilvaLearnerBilling_1.findLatestDaSilvaStagingBundle)(sid)?.bundle ?? null;
    const sourceAccounts = sourceAccountNumbers(resolvedBundle);
    const ageAnalysisParseAudit = resolvedBundle?.ageAnalysisParseAudit
        ? {
            ...resolvedBundle.ageAnalysisParseAudit,
            learnersMatchedFromAgeAnalysis: resolvedBundle.ageAnalysisLearnerMatchAudit?.learnersMatchedFromAgeAnalysis,
            learnersNotMatchedFromAgeAnalysis: resolvedBundle.ageAnalysisLearnerMatchAudit?.learnersNotMatchedFromAgeAnalysis,
        }
        : undefined;
    const [learners, familyAccounts, activeLearners, familyAccountsWithLearners,] = await Promise.all([
        prisma_1.prisma.learner.findMany({
            where: { schoolId: sid },
            select: {
                id: true,
                admissionNo: true,
                enrollmentStatus: true,
                familyAccountId: true,
                familyAccount: { select: { accountRef: true } },
            },
        }),
        prisma_1.prisma.familyAccount.findMany({
            where: { schoolId: sid },
            select: { id: true, accountRef: true },
        }),
        prisma_1.prisma.learner.findMany({
            where: { schoolId: sid, enrollmentStatus: "ACTIVE" },
            select: {
                id: true,
                admissionNo: true,
                familyAccountId: true,
                familyAccount: { select: { accountRef: true } },
            },
        }),
        prisma_1.prisma.familyAccount.count({
            where: { schoolId: sid, learners: { some: {} } },
        }),
    ]);
    const accountToLearnerId = await (0, billingLedgerRelink_1.buildAccountToLearnerIdMap)(sid);
    const ledger = (0, billingLedgerStore_1.readSchoolLedger)(sid);
    const history = (0, kidesysTransactionHistoryStore_1.readSchoolKidesysHistory)(sid);
    const activeLearnerIds = new Set(activeLearners.map((l) => String(l.id || "").trim()).filter(Boolean));
    let learnersWithResolvableAccountNo = 0;
    let activeShouldHaveKidesys = 0;
    let activeMissingKidesysRef = 0;
    const brokenSamples = [];
    for (const learner of learners) {
        const accountNo = resolveKidesysFamilyAccountRefOnly(learner);
        if (accountNo)
            learnersWithResolvableAccountNo += 1;
        else if (brokenSamples.length < 8) {
            brokenSamples.push({
                kind: "learner",
                id: learner.id,
                reason: "Missing Kid-e-Sys family accountRef (non-Kid refs ignored)",
            });
        }
    }
    const learnerHasKidesysLedgerActivity = new Set();
    for (const entry of ledger) {
        const learnerId = String(entry.learnerId || "").trim();
        const accountNo = String(entry.accountNo || "").trim();
        if (!learnerId)
            continue;
        if ((0, ageAnalysisParser_1.isKidESysSourceAccountRef)(accountNo))
            learnerHasKidesysLedgerActivity.add(learnerId);
    }
    for (const learner of activeLearners) {
        const kidesysRef = resolveKidesysFamilyAccountRefOnly(learner);
        const shouldHaveKidesysBilling = learnerHasKidesysLedgerActivity.has(String(learner.id || "").trim()) ||
            Boolean(history.length > 0 && String(learner.familyAccountId || "").trim());
        if (shouldHaveKidesysBilling)
            activeShouldHaveKidesys += 1;
        if (shouldHaveKidesysBilling && !kidesysRef) {
            activeMissingKidesysRef += 1;
            if (brokenSamples.length < 12) {
                brokenSamples.push({
                    kind: "activeLearner",
                    id: learner.id,
                    reason: "Active learner should have Kid-e-Sys billing but no Kid-e-Sys FamilyAccount.accountRef is linked",
                });
            }
        }
    }
    const familyOrphaned = familyAccounts.length - familyAccountsWithLearners;
    if (familyOrphaned > 0 && brokenSamples.length < 15) {
        brokenSamples.push({
            kind: "familyAccount",
            reason: `${familyOrphaned} family account(s) have no linked learners`,
        });
    }
    let ledgerLinkedByAccount = 0;
    let ledgerLinkedByLearner = 0;
    let ledgerUnresolvable = 0;
    let ledgerUnresolvableActive = 0;
    let sasamsNumericAccountRefRowsIgnored = 0;
    for (const entry of ledger) {
        const accountNo = String(entry.accountNo || "").trim();
        const learnerId = String(entry.learnerId || "").trim();
        if (learnerId)
            ledgerLinkedByLearner += 1;
        if (accountNo && accountNo !== "-" && accountToLearnerId[accountNo]) {
            ledgerLinkedByAccount += 1;
        }
        if (isSasamsNumericAccountRef(accountNo)) {
            sasamsNumericAccountRefRowsIgnored += 1;
        }
        if (!ledgerRowResolvable(entry, accountToLearnerId)) {
            ledgerUnresolvable += 1;
            const wouldResolveToActiveLearner = Boolean(learnerId && activeLearnerIds.has(learnerId)) ||
                Boolean(accountNo && accountNo !== "-" && activeLearnerIds.has(String(accountToLearnerId[accountNo] || "").trim())) ||
                Boolean(accountNo &&
                    accountNo !== "-" &&
                    activeLearnerIds.has(String(accountToLearnerId[admissionBase(accountNo)] || "").trim()));
            if (wouldResolveToActiveLearner)
                ledgerUnresolvableActive += 1;
            if (brokenSamples.length < 20) {
                brokenSamples.push({
                    kind: "ledger",
                    id: entry.id,
                    accountNo: entry.accountNo,
                    learnerId: entry.learnerId,
                    reason: "Ledger row cannot be resolved to a learner or billing account",
                });
            }
        }
    }
    const statementAccounts = await (0, statementAccounts_1.buildAccountsFromLearners)(sid, ledger, undefined, {
        billingIdentityMode: "kidesys_accountRef_only",
    });
    const statementDash = statementAccounts.filter((r) => !String(r.accountNo || "").trim() || String(r.accountNo) === "-").length;
    const duplicateStatementKeys = countDuplicateKeys(statementAccounts.map((r) => ({ accountNo: r.accountNo, learnerId: r.learnerId })));
    const duplicatePaymentIds = countDuplicatePaymentIds(sid);
    const nonZeroBalances = statementAccounts.filter((r) => Math.abs(Number(r.balance) || 0) > 0.01)
        .length;
    const statementsWithBalance = statementAccounts.filter((r) => Math.abs(Number(r.balance) || 0) > 0.01).length;
    const statementsWithLastInvoice = statementAccounts.filter((r) => Number(r.lastInvoice || 0) !== 0 || String(r.lastInvoiceLabel || "").trim()).length;
    const statementsWithLastPayment = statementAccounts.filter((r) => Number(r.lastPayment || 0) !== 0)
        .length;
    const familyAccountRefs = new Set(familyAccounts
        .map((fa) => String(fa.accountRef || "").trim())
        .filter((ref) => (0, ageAnalysisParser_1.isKidESysSourceAccountRef)(ref)));
    const statementAccountRefs = new Set(statementAccounts
        .map((r) => String(r.accountNo || "").trim())
        .filter((ref) => (0, ageAnalysisParser_1.isKidESysSourceAccountRef)(ref)));
    let missingFamilyAccountAccountRefForStatementAccounts = 0;
    for (const ref of statementAccountRefs) {
        if (!familyAccountRefs.has(ref))
            missingFamilyAccountAccountRefForStatementAccounts += 1;
    }
    const familyAccountAccountRefRows = familyAccounts.filter((fa) => (0, ageAnalysisParser_1.isKidESysSourceAccountRef)(String(fa.accountRef || "").trim())).length;
    if (duplicateStatementKeys > 0 && brokenSamples.length < 22) {
        brokenSamples.push({
            kind: "statement",
            reason: `${duplicateStatementKeys} duplicate statement account key(s) from billing joins`,
        });
    }
    if (duplicatePaymentIds > 0 && brokenSamples.length < 24) {
        brokenSamples.push({
            kind: "payment",
            reason: `${duplicatePaymentIds} duplicate payment ledger id(s)`,
        });
    }
    const gateErrors = [];
    if (activeLearners.length > 0 && activeMissingKidesysRef > 0) {
        gateErrors.push(`${activeMissingKidesysRef} active learner(s) should have Kid-e-Sys billing but have no Kid-e-Sys FamilyAccount.accountRef linked`);
    }
    if (familyAccounts.length > 0 && familyAccountsWithLearners === 0) {
        gateErrors.push("Family accounts exist but none are linked to learners");
    }
    if (missingFamilyAccountAccountRefForStatementAccounts > 0) {
        gateErrors.push(`${missingFamilyAccountAccountRefForStatementAccounts} statement accountRef(s) have no matching FamilyAccount.accountRef`);
    }
    if (ledger.length > 0 && ledgerUnresolvableActive > 0) {
        gateErrors.push(`${ledgerUnresolvableActive} active-linked ledger/history row(s) cannot be resolved to learners or accounts`);
    }
    if (duplicateStatementKeys > 0) {
        gateErrors.push(`${duplicateStatementKeys} duplicate statement row(s) from billing account joins`);
    }
    if (duplicatePaymentIds > 0) {
        gateErrors.push(`${duplicatePaymentIds} duplicate payment ledger row(s)`);
    }
    if (history.length > 0 &&
        activeLearners.length >= 50 &&
        learnersWithResolvableAccountNo === 0) {
        gateErrors.push("Kid-e-Sys transaction history exists but no learners have resolvable account numbers");
    }
    if (history.length > 0 &&
        statementAccounts.length >= 50 &&
        nonZeroBalances === 0 &&
        ledger.some((e) => e.type === "payment" || e.type === "invoice")) {
        gateErrors.push("Ledger contains invoices/payments but all statement balances are R0 — billing links likely broken");
    }
    return {
        schoolId: sid,
        auditedAt: new Date().toISOString(),
        learnersTotal: learners.length,
        learnersWithAdmissionNo: learners.filter((l) => String(l.admissionNo || "").trim()).length,
        learnersWithResolvableAccountNo,
        learnersWithFamilyAccountId: learners.filter((l) => l.familyAccountId).length,
        activeLearnersTotal: activeLearners.length,
        activeLearnersShouldHaveKidesysBilling: activeShouldHaveKidesys,
        activeLearnersMissingKidesysAccountRef: activeMissingKidesysRef,
        falseActiveUnresolvedRemoved: Math.max(0, activeLearners.length - activeShouldHaveKidesys) + 0,
        familyAccountsTotal: familyAccounts.length,
        familyAccountsLinkedToLearners: familyAccountsWithLearners,
        familyAccountsOrphaned: familyOrphaned,
        ledgerRowsTotal: ledger.length,
        ledgerRowsLinkedByAccountNo: ledgerLinkedByAccount,
        ledgerRowsLinkedByLearnerId: ledgerLinkedByLearner,
        ledgerRowsUnresolvable: ledgerUnresolvable,
        ledgerRowsUnresolvableActive: ledgerUnresolvableActive,
        ledgerRowsUnresolvableHistoricalOrFamilyOnly: Math.max(0, ledgerUnresolvable - ledgerUnresolvableActive),
        kidesysHistoryRowsTotal: history.length,
        familyAccountAccountRefRows: familyAccountAccountRefRows,
        sasamsNumericAccountRefRowsIgnored,
        statementsWithBalance,
        statementsWithLastInvoice,
        statementsWithLastPayment,
        missingFamilyAccountAccountRefForStatementAccounts,
        statementRowsWithAccountDash: statementDash,
        duplicateStatementAccountKeys: duplicateStatementKeys,
        duplicatePaymentLedgerIds: duplicatePaymentIds,
        nonZeroBalanceAccountCount: nonZeroBalances,
        sourceAccountNumbersInBundle: sourceAccounts.size,
        ageAnalysisParseAudit,
        brokenSamples,
        gatePassed: gateErrors.length === 0,
        gateErrors,
    };
}
function assertKideesysMigrationCompletionGate(audit) {
    if (audit.gatePassed)
        return;
    throw new KideesysMigrationGateError(`Kid-e-Sys migration completion gate failed: ${audit.gateErrors.join("; ")}`, audit);
}
/**
 * For learners that still have no billing identity after bundle-/db-relink,
 * create a KID-MISSING-{seq} FamilyAccount and assign admissionNo + familyAccountId.
 * Only operates on active learners with no resolvable accountNo.
 * Safe to rerun — already-repaired learners are skipped.
 */
async function createFallbackBillingIdentitiesForBrokenLearners(schoolId) {
    const brokenLearners = await prisma_1.prisma.learner.findMany({
        where: {
            schoolId,
            enrollmentStatus: "ACTIVE",
            familyAccountId: null,
        },
        select: {
            id: true,
            admissionNo: true,
            firstName: true,
            lastName: true,
            familyAccount: { select: { accountRef: true } },
        },
    });
    // Filter to those truly without a resolvable account (no admissionNo either).
    const truly_broken = brokenLearners.filter((l) => !(0, learnerIdentity_1.resolveLearnerAccountNo)(l) || (0, learnerIdentity_1.resolveLearnerAccountNo)(l) === "-");
    if (truly_broken.length === 0)
        return { learnersRepaired: 0, familyAccountsCreated: 0 };
    // Determine next sequence number for KID-MISSING accounts in this school.
    const existingFallbacks = await prisma_1.prisma.familyAccount.findMany({
        where: {
            schoolId,
            accountRef: { startsWith: "KID-MISSING-" },
        },
        select: { accountRef: true },
    });
    let maxSeq = 0;
    for (const fa of existingFallbacks) {
        const parts = fa.accountRef.split("-");
        const seqStr = parts[parts.length - 1];
        const seq = parseInt(seqStr, 10);
        if (!isNaN(seq) && seq > maxSeq)
            maxSeq = seq;
    }
    let learnersRepaired = 0;
    let familyAccountsCreated = 0;
    for (const learner of truly_broken) {
        maxSeq += 1;
        const accountRef = `KID-MISSING-${String(maxSeq).padStart(4, "0")}`;
        const familyName = [learner.firstName, learner.lastName].filter(Boolean).join(" ") || "Unknown";
        const fa = await prisma_1.prisma.familyAccount.create({
            data: { schoolId, accountRef, familyName },
            select: { id: true },
        });
        familyAccountsCreated += 1;
        await prisma_1.prisma.learner.update({
            where: { id: learner.id },
            data: {
                familyAccountId: fa.id,
            },
        });
        learnersRepaired += 1;
    }
    return { learnersRepaired, familyAccountsCreated };
}
/**
 * Universal post-apply reconciliation for Kid-e-Sys migrations.
 * Repairs learner ↔ family ↔ ledger links, then enforces the completion gate.
 */
async function reconcileKideesysBillingLinks(opts) {
    const schoolId = String(opts.schoolId || "").trim();
    const { bundle, projectId } = loadBundleForSchool(schoolId, opts.projectId);
    const auditBefore = await auditKideesysMigrationHealth(schoolId, bundle);
    const repairs = {};
    if (!opts.apply) {
        return {
            mode: "dry-run",
            schoolId,
            usedStagingBundle: Boolean(bundle),
            stagingProjectId: projectId,
            repairs,
            auditBefore,
            auditAfter: auditBefore,
        };
    }
    if (bundle) {
        const matchKeyToLearnerId = new Map();
        const accountToLearnerId = new Map();
        const manifest = {
            projectId: bundle.projectId,
            schoolId: bundle.schoolId,
            importedAt: new Date().toISOString(),
            learnerIds: [],
            parentIds: [],
            linkIds: [],
            classroomIds: [],
            employeeIds: [],
            ledgerEntryIds: [],
            matchKeyToLearnerId: {},
            accountToLearnerId: {},
        };
        repairs.bundleRelink = await (0, relinkDaSilvaLearnerBilling_1.relinkDaSilvaLearnerBillingFromBundle)({
            schoolId,
            bundle,
            manifest,
            matchKeyToLearnerId,
            accountToLearnerId,
        });
    }
    else {
        repairs.dbRelink = await (0, relinkDaSilvaLearnerBilling_1.relinkSchoolLearnersToFamilyAccountsByDb)(schoolId);
    }
    // Repair any active learners that still have no billing identity after bundle/db relink.
    const fallbackRepairs = await createFallbackBillingIdentitiesForBrokenLearners(schoolId);
    if (fallbackRepairs.learnersRepaired > 0) {
        repairs.fallbackBillingIdentities = fallbackRepairs;
    }
    const accountToLearnerId = await (0, billingLedgerRelink_1.buildAccountToLearnerIdMap)(schoolId);
    repairs.ledgerAccountNoPatched = patchLedgerAccountNumbers(schoolId, accountToLearnerId);
    const relink = await (0, billingLedgerRelink_1.relinkSchoolBillingLedger)(schoolId);
    repairs.ledgerLearnerRelink = relink.ledgerRowsUpdated;
    const auditAfter = await auditKideesysMigrationHealth(schoolId, bundle);
    if (!opts.skipGate) {
        assertKideesysMigrationCompletionGate(auditAfter);
    }
    return {
        mode: "apply",
        schoolId,
        usedStagingBundle: Boolean(bundle),
        stagingProjectId: projectId,
        repairs,
        auditBefore,
        auditAfter,
    };
}
/** Run after full Kid-e-Sys import commit (learners, billing, ledger). */
async function runKideesysPostMigrationReconciliation(opts) {
    return reconcileKideesysBillingLinks({
        schoolId: opts.schoolId,
        projectId: opts.projectId,
        apply: true,
    });
}
