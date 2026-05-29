"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveStatementContactForDisplay = resolveStatementContactForDisplay;
exports.resolveStatementBillingContact = resolveStatementBillingContact;
exports.buildStatementPdfInput = buildStatementPdfInput;
exports.buildAndGenerateStatementPdf = buildAndGenerateStatementPdf;
exports.formatMoney = formatMoney;
const prisma_1 = require("../prisma");
const learnerIdentity_1 = require("../utils/learnerIdentity");
const billingLedgerStore_1 = require("../utils/billingLedgerStore");
const statementPdfService_1 = require("./statementPdfService");
const statementTransactionBuilder_1 = require("./statementTransactionBuilder");
const statementPeriod_1 = require("../utils/statementPeriod");
function formatMoney(value) {
    return `R ${(0, billingLedgerStore_1.normaliseAmount)(value).toLocaleString("en-ZA", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}
function parentDisplayName(parent) {
    return `${parent.firstName || ""} ${parent.surname || ""}`.trim() || "Parent / Guardian";
}
function resolveAccountScope(learners, anchorLearnerId) {
    const anchor = learners.find((l) => l.id === anchorLearnerId);
    if (!anchor)
        return null;
    const familyId = String(anchor.familyAccountId || anchor.familyAccount?.id || "").trim();
    const accountRef = (0, learnerIdentity_1.resolveLearnerAccountNo)(anchor);
    let group = [anchor];
    if (familyId) {
        group = learners.filter((l) => String(l.familyAccountId || l.familyAccount?.id || "") === familyId);
    }
    else if (accountRef) {
        group = learners.filter((l) => (0, learnerIdentity_1.resolveLearnerAccountNo)(l) === accountRef);
    }
    return {
        accountRef,
        learners: group,
        learnerIds: group.map((l) => l.id),
        isFamilyAccount: group.length > 1 || Boolean(familyId),
    };
}
function isStatementBillingContact(parent, link) {
    if (link.billingStatement === false)
        return false;
    if (parent.communicationBilling === false)
        return false;
    if (parent.communicationByEmail === false)
        return false;
    return Boolean(String(parent.email || "").trim());
}
function contactScore(link, parent) {
    let score = 0;
    if (link.isPrimary)
        score += 10;
    if (link.isPayingPerson)
        score += 6;
    if (parent.communicationBilling !== false)
        score += 2;
    return score;
}
function displayContactScore(link) {
    let score = 0;
    if (link.isPrimary)
        score += 10;
    if (link.isPayingPerson)
        score += 6;
    return score;
}
/** Parent/guardian for PDF display (does not require email). */
async function resolveStatementContactForDisplay(schoolId, learnerIds, accountNo) {
    const ids = learnerIds.filter(Boolean);
    if (!ids.length)
        return null;
    const parents = await prisma_1.prisma.parent.findMany({
        where: { schoolId },
        include: {
            links: {
                where: { learnerId: { in: ids } },
                select: {
                    learnerId: true,
                    isPrimary: true,
                    isPayingPerson: true,
                    billingStatement: true,
                    relation: true,
                },
            },
        },
    });
    const seenParentIds = new Set();
    const candidates = [];
    for (const parent of parents) {
        for (const link of parent.links) {
            if (!ids.includes(link.learnerId))
                continue;
            if (link.billingStatement === false)
                continue;
            const parentId = String(parent.id || "").trim();
            if (parentId && seenParentIds.has(parentId))
                continue;
            if (parentId)
                seenParentIds.add(parentId);
            candidates.push({ parent, link });
        }
    }
    if (!candidates.length)
        return null;
    candidates.sort((a, b) => displayContactScore(b.link) - displayContactScore(a.link));
    const names = candidates.map((c) => parentDisplayName(c.parent));
    const uniqueNames = [...new Set(names.filter(Boolean))];
    const best = candidates[0];
    const email = String(best.parent.email || "").trim() || undefined;
    const cellphone = String(best.parent.cellNo || "").trim() || undefined;
    return {
        name: uniqueNames.join(" · ") || parentDisplayName(best.parent),
        email,
        cellphone,
        relationship: String(best.link.relation || "Parent"),
        accountNo: accountNo || "—",
    };
}
async function resolveStatementBillingContact(schoolId, learnerIds) {
    const ids = learnerIds.filter(Boolean);
    if (!ids.length)
        return null;
    const parents = await prisma_1.prisma.parent.findMany({
        where: { schoolId },
        include: {
            links: {
                where: { learnerId: { in: ids } },
                select: {
                    learnerId: true,
                    isPrimary: true,
                    isPayingPerson: true,
                    billingStatement: true,
                    relation: true,
                },
            },
        },
    });
    const candidates = [];
    for (const parent of parents) {
        for (const link of parent.links) {
            if (!ids.includes(link.learnerId))
                continue;
            if (!isStatementBillingContact(parent, link))
                continue;
            candidates.push({ parent, link });
        }
    }
    if (!candidates.length)
        return null;
    candidates.sort((a, b) => {
        const scoreA = contactScore(a.link, a.parent);
        const scoreB = contactScore(b.link, b.parent);
        return scoreB - scoreA;
    });
    const best = candidates[0];
    return {
        name: parentDisplayName(best.parent),
        email: String(best.parent.email || "").trim(),
        relationship: String(best.link.relation || "Parent"),
    };
}
async function loadSchoolBranding(schoolId) {
    const school = await prisma_1.prisma.school.findUnique({
        where: { id: schoolId },
        select: { name: true, email: true, phone: true, cellNo: true, address: true, logoUrl: true },
    });
    return {
        name: String(school?.name || "School").trim() || "School",
        email: String(school?.email || "").trim() || undefined,
        phone: String(school?.phone || "").trim() || undefined,
        cellNo: String(school?.cellNo || "").trim() || undefined,
        address: String(school?.address || "").trim() || undefined,
        logoUrl: String(school?.logoUrl || "").trim() || undefined,
    };
}
async function buildStatementPdfInput(options) {
    const schoolId = String(options.schoolId || "").trim();
    const learnerId = String(options.learnerId || "").trim();
    const period = (0, statementPeriod_1.normalizeStatementPeriod)(options.period || statementPeriod_1.DEFAULT_STATEMENT_PERIOD);
    if (!schoolId || !learnerId) {
        throw new Error("Missing schoolId or learnerId for statement PDF");
    }
    const learners = await prisma_1.prisma.learner.findMany({
        where: { schoolId },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            grade: true,
            familyAccountId: true,
            familyAccount: { select: { id: true, accountRef: true, familyName: true } },
        },
        orderBy: { lastName: "asc" },
    });
    const scope = resolveAccountScope(learners, learnerId);
    if (!scope)
        throw new Error("Learner not found for statement PDF");
    const ledger = (0, billingLedgerStore_1.readSchoolLedger)(schoolId);
    const scopedEntries = (0, billingLedgerStore_1.collectFamilyAccountEntries)(ledger, {
        accountRef: scope.accountRef,
        learnerIds: scope.learnerIds,
    });
    const filtered = (0, statementPeriod_1.filterLedgerByStatementPeriod)(scopedEntries, period);
    const balance = (0, billingLedgerStore_1.calculateBalanceFromEntries)(filtered);
    const nameByLearnerId = new Map(scope.learners.map((l) => [l.id, `${l.firstName} ${l.lastName}`.trim()]));
    const anchor = scope.learners.find((l) => l.id === learnerId) || scope.learners[0];
    const accountLabel = scope.isFamilyAccount
        ? `Family account ${scope.accountRef || "—"}`
        : `${anchor.firstName} ${anchor.lastName}`.trim();
    const contact = await resolveStatementContactForDisplay(schoolId, scope.learnerIds, scope.accountRef || "—");
    const school = await loadSchoolBranding(schoolId);
    const transactions = (0, statementTransactionBuilder_1.buildStatementTransactions)({
        schoolId,
        accountRef: scope.accountRef,
        ledgerEntries: filtered,
        period,
        nameByLearnerId,
    });
    return {
        school,
        accountNo: scope.accountRef || "—",
        accountLabel,
        children: scope.learners.map((l) => ({
            name: `${l.firstName} ${l.lastName}`.trim(),
            grade: l.grade || "—",
        })),
        contact,
        period: (0, statementPeriod_1.formatStatementPeriodHeaderLabel)(period),
        statementDate: new Date().toLocaleDateString("en-ZA"),
        balance,
        transactions,
        statementNote: options.statementNote,
        isFamilyAccount: scope.isFamilyAccount,
    };
}
async function buildAndGenerateStatementPdf(options) {
    const input = await buildStatementPdfInput(options);
    const buffer = await (0, statementPdfService_1.generateStatementPdfBuffer)(input);
    return {
        buffer,
        filename: (0, statementPdfService_1.statementPdfFilename)(input.accountNo),
        input,
    };
}
