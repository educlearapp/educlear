"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSasamsNumericBillingAccount = isSasamsNumericBillingAccount;
exports.buildAccountsFromAgeAnalysisSnapshots = buildAccountsFromAgeAnalysisSnapshots;
exports.buildAccountsFromLearners = buildAccountsFromLearners;
const prisma_1 = require("../prisma");
const learnerIdentity_1 = require("../utils/learnerIdentity");
const ageAnalysisParser_1 = require("./daSilvaMigration/ageAnalysisParser");
const familyAccountAgeAnalysisStore_1 = require("../utils/familyAccountAgeAnalysisStore");
const kidesysTransactionHistoryStore_1 = require("../utils/kidesysTransactionHistoryStore");
const billingLedgerStore_1 = require("../utils/billingLedgerStore");
const billingDisplayRules_1 = require("../utils/billingDisplayRules");
/** SA-SAMS numeric admission-style refs must never be billing identity. */
function isSasamsNumericBillingAccount(value) {
    const v = String(value || "").trim();
    if (!v || (0, ageAnalysisParser_1.isKidESysSourceAccountRef)(v))
        return false;
    return /^\d{4,}$/.test(v);
}
function splitDisplayName(full) {
    const raw = String(full || "").trim();
    if (!raw)
        return { name: "-", surname: "-" };
    const parts = raw.split(/\s+/).filter(Boolean);
    if (!parts.length)
        return { name: "-", surname: "-" };
    if (parts.length === 1)
        return { name: parts[0], surname: "-" };
    return { name: parts[0], surname: parts.slice(1).join(" ") };
}
function statusFromBalance(balance) {
    if (balance > 10000)
        return "Bad Debt";
    if (balance > 0)
        return "Recently Owing";
    if (balance < 0)
        return "Over Paid";
    return "Up To Date";
}
function resolveKidesysAccountRefOnly(learner) {
    const ref = String(learner.familyAccount?.accountRef || "").trim();
    return (0, ageAnalysisParser_1.isKidESysSourceAccountRef)(ref) ? ref : "";
}
function resolveBillingGroupKey(learner, mode) {
    const familyAccountId = String(learner.familyAccountId || "").trim();
    if (familyAccountId) {
        if (mode === "kidesys_accountRef_only") {
            const ref = resolveKidesysAccountRefOnly(learner);
            if (ref)
                return `family:${familyAccountId}`;
            return `learner:${learner.id}`;
        }
        return `family:${familyAccountId}`;
    }
    if (mode !== "kidesys_accountRef_only") {
        const accountNo = (0, learnerIdentity_1.resolveLearnerAccountNo)(learner);
        if (accountNo && accountNo !== "-")
            return `account:${accountNo}`;
    }
    return `learner:${learner.id}`;
}
function lastRealInvoice(entries) {
    return entries
        .filter((e) => e.type === "invoice" && !(0, billingDisplayRules_1.isKidesysOpeningBalanceEntry)(e))
        .sort((a, b) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime())[0];
}
function resolveLastInvoiceFields(accountEntries, historySummary) {
    const histInv = historySummary?.lastInvoice;
    if (histInv) {
        return {
            lastInvoice: histInv.amount ?? 0,
            lastInvoiceDate: histInv.date || "",
            lastInvoiceLabel: null,
        };
    }
    const lastInvoice = lastRealInvoice(accountEntries);
    if (lastInvoice) {
        return {
            lastInvoice: lastInvoice.amount ?? 0,
            lastInvoiceDate: lastInvoice.date || "",
            lastInvoiceLabel: null,
        };
    }
    const hasOpeningBalance = accountEntries.some((e) => e.type === "invoice" && (0, billingDisplayRules_1.isKidesysOpeningBalanceEntry)(e));
    if (hasOpeningBalance) {
        return {
            lastInvoice: 0,
            lastInvoiceDate: "",
            lastInvoiceLabel: billingDisplayRules_1.MIGRATED_OPENING_BALANCE_OVERVIEW,
        };
    }
    return {
        lastInvoice: 0,
        lastInvoiceDate: "",
        lastInvoiceLabel: null,
    };
}
function resolveLastPaymentFields(accountEntries, historySummary) {
    const histPay = historySummary?.lastPayment;
    if (histPay) {
        return {
            lastPayment: histPay.amount ?? 0,
            lastPaymentDate: histPay.date || "",
        };
    }
    const lastPayment = accountEntries
        .filter((e) => e.type === "payment")
        .sort((a, b) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime())[0];
    return {
        lastPayment: lastPayment?.amount ?? 0,
        lastPaymentDate: lastPayment?.date || "",
    };
}
/**
 * Authoritative billing account list: Kid-e-Sys Age Analysis snapshots (accountRef) +
 * ledger + display history. Never uses SA-SAMS admission numbers for accountNo.
 */
async function buildAccountsFromAgeAnalysisSnapshots(schoolId, opts = {}) {
    const sid = String(schoolId || "").trim();
    if (!sid)
        return [];
    const snapshotsByRef = (0, familyAccountAgeAnalysisStore_1.readSchoolFamilyAccountAgeAnalysisSnapshots)(sid);
    const snapshots = Object.values(snapshotsByRef || {});
    const accountRefs = snapshots
        .map((s) => String(s.accountRef || "").trim().toUpperCase())
        .filter(Boolean);
    if (!accountRefs.length)
        return [];
    const familyAccounts = await prisma_1.prisma.familyAccount.findMany({
        where: { schoolId: sid, accountRef: { in: accountRefs } },
        select: { id: true, accountRef: true, familyName: true },
    });
    const familyByRef = new Map(familyAccounts.map((fa) => [String(fa.accountRef).trim().toUpperCase(), fa]));
    const learners = await prisma_1.prisma.learner.findMany({
        where: { schoolId: sid, familyAccount: { accountRef: { in: accountRefs } } },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            familyAccount: { select: { accountRef: true } },
        },
    });
    const learnerByRef = new Map();
    for (const l of learners) {
        const ref = String(l.familyAccount?.accountRef || "").trim().toUpperCase();
        if (!ref || learnerByRef.has(ref))
            continue;
        const fullName = `${String(l.firstName || "").trim()} ${String(l.lastName || "").trim()}`.trim();
        learnerByRef.set(ref, { id: l.id, fullName: fullName || ref });
    }
    const ledger = opts.ledger ?? (0, billingLedgerStore_1.readSchoolLedger)(sid);
    const history = opts.history ?? (0, kidesysTransactionHistoryStore_1.readSchoolKidesysHistory)(sid);
    const historyIndex = (0, kidesysTransactionHistoryStore_1.buildKidesysHistoryAccountIndex)(history);
    return snapshots.map((snap) => {
        const accountRef = String(snap.accountRef || "").trim().toUpperCase();
        const ageBalance = Number(snap.balance) || 0;
        const family = familyByRef.get(accountRef);
        const learner = learnerByRef.get(accountRef);
        const label = String(family?.familyName || "").trim() ||
            String(learner?.fullName || "").trim() ||
            String(snap.accountHolder || "").trim() ||
            accountRef ||
            "-";
        const { name, surname } = splitDisplayName(label);
        const accountEntries = ledger.filter((e) => String(e.accountNo || "").trim().toUpperCase() === accountRef);
        const hist = historyIndex.get(accountRef) || { lastInvoice: null, lastPayment: null };
        const invoiceFields = resolveLastInvoiceFields(accountEntries, hist);
        const paymentFields = resolveLastPaymentFields(accountEntries, hist);
        return {
            accountNo: accountRef || "-",
            learnerId: learner?.id || "",
            schoolId: sid,
            name,
            surname,
            balance: ageBalance,
            lastInvoice: invoiceFields.lastInvoice,
            lastInvoiceDate: invoiceFields.lastInvoiceDate,
            lastInvoiceLabel: invoiceFields.lastInvoiceLabel,
            lastPayment: paymentFields.lastPayment,
            lastPaymentDate: paymentFields.lastPaymentDate,
            status: statusFromBalance(ageBalance),
            familyAccountId: family?.id || null,
            familyName: family?.familyName ?? null,
            memberLearnerIds: learner?.id ? [learner.id] : [],
            ageAnalysis: {
                accountHolder: snap.accountHolder,
                buckets: snap.buckets,
                importedAt: snap.importedAt,
                source: snap.source,
            },
        };
    });
}
/** One row per family billing account (deduped siblings). */
async function buildAccountsFromLearners(schoolId, ledger, historyOverride, opts = {}) {
    const billingIdentityMode = opts.billingIdentityMode ?? "legacy";
    const history = historyOverride !== undefined ? historyOverride : (0, kidesysTransactionHistoryStore_1.readSchoolKidesysHistory)(schoolId);
    const historyIndex = (0, kidesysTransactionHistoryStore_1.buildKidesysHistoryAccountIndex)(history);
    const learners = await prisma_1.prisma.learner.findMany({
        where: { schoolId },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            schoolId: true,
            firstName: true,
            lastName: true,
            admissionNo: true,
            familyAccountId: true,
            familyAccount: { select: { accountRef: true, familyName: true } },
        },
    });
    const groups = new Map();
    for (const learner of learners) {
        const key = resolveBillingGroupKey(learner, billingIdentityMode);
        const existing = groups.get(key);
        if (existing) {
            if (!existing.memberIds.includes(learner.id)) {
                existing.memberIds.push(learner.id);
            }
            continue;
        }
        groups.set(key, { anchor: learner, memberIds: [learner.id] });
    }
    return Array.from(groups.values()).map(({ anchor, memberIds }) => {
        const accountNo = billingIdentityMode === "kidesys_accountRef_only"
            ? resolveKidesysAccountRefOnly(anchor) || "-"
            : (0, learnerIdentity_1.resolveLearnerAccountNo)(anchor);
        const accountEntries = (0, billingLedgerStore_1.collectFamilyAccountEntries)(ledger, {
            accountRef: accountNo,
            learnerIds: memberIds,
        });
        const balance = (0, billingLedgerStore_1.calculateBalanceFromEntries)(accountEntries);
        const historySummary = historyIndex.get(accountNo) || {
            lastInvoice: null,
            lastPayment: null,
        };
        const invoiceFields = resolveLastInvoiceFields(accountEntries, historySummary);
        const paymentFields = resolveLastPaymentFields(accountEntries, historySummary);
        return {
            accountNo,
            learnerId: anchor.id,
            schoolId: anchor.schoolId,
            name: anchor.firstName || "-",
            surname: anchor.lastName || "-",
            balance,
            lastInvoice: invoiceFields.lastInvoice,
            lastInvoiceDate: invoiceFields.lastInvoiceDate,
            lastInvoiceLabel: invoiceFields.lastInvoiceLabel,
            lastPayment: paymentFields.lastPayment,
            lastPaymentDate: paymentFields.lastPaymentDate,
            status: statusFromBalance(balance),
            familyAccountId: anchor.familyAccountId,
            familyName: anchor.familyAccount?.familyName ?? null,
            memberLearnerIds: memberIds,
        };
    });
}
