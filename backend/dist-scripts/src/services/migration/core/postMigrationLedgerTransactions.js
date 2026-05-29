"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.learnerMatchKeysInPriorityOrder = void 0;
exports.buildApplyLearnerMatchIndex = buildApplyLearnerMatchIndex;
exports.postSingleMigrationLedgerTransaction = postSingleMigrationLedgerTransaction;
exports.mapRawRecord = mapRawRecord;
exports.buildTargetToSource = buildTargetToSource;
exports.resolveIndexEntry = resolveIndexEntry;
const billingLedgerStore_1 = require("../../../utils/billingLedgerStore");
const classifyLedgerTransaction_1 = require("./classifyLedgerTransaction");
const computeTransactionReadiness_1 = require("./computeTransactionReadiness");
Object.defineProperty(exports, "learnerMatchKeysInPriorityOrder", { enumerable: true, get: function () { return computeTransactionReadiness_1.learnerMatchKeysInPriorityOrder; } });
function cleanString(v) {
    return String(v ?? "").trim();
}
function mapRawRecord(raw, targetToSource) {
    const out = {};
    for (const [target, sourceCol] of targetToSource) {
        const value = cleanString(raw[sourceCol]);
        if (value)
            out[target] = value;
    }
    return out;
}
function buildTargetToSource(mappings) {
    const map = new Map();
    for (const m of mappings) {
        const target = String(m.targetField || "").trim();
        const source = String(m.sourceColumn || "").trim();
        if (target && source)
            map.set(target, source);
    }
    return map;
}
function resolveIndexEntry(mapped, index) {
    const targetToSource = new Map();
    for (const [field, value] of Object.entries(mapped)) {
        if (value)
            targetToSource.set(field, field);
    }
    const row = { ...mapped };
    const keys = (0, computeTransactionReadiness_1.learnerMatchKeysInPriorityOrder)(row, targetToSource);
    for (const key of keys) {
        const entry = index.get(key);
        if (entry)
            return { entry, matched: true };
    }
    return { entry: null, matched: keys.length > 0 };
}
function prismaEnrollmentToMigrationStatus(enrollmentStatus) {
    const upper = String(enrollmentStatus || "").toUpperCase();
    if (upper === "ACTIVE")
        return "ACTIVE";
    if (upper === "HISTORICAL")
        return "HISTORICAL";
    return "HISTORICAL";
}
async function buildApplyLearnerMatchIndex(tx, schoolId, stage, rowsByFileId) {
    const mappingsByFile = new Map(stage.mappings.map((m) => [m.fileId, m]));
    const previews = stage.files.map((f) => ({
        fileId: f.fileId,
        filename: f.filename,
        category: f.category,
        rowCount: f.rowCount,
        columns: [],
        sampleRows: [],
        warnings: [],
        path: f.path,
    }));
    const stagedIndex = (0, computeTransactionReadiness_1.buildMigrationLearnerMatchIndex)(previews, mappingsByFile, rowsByFileId);
    const dbLearners = await tx.learner.findMany({
        where: { schoolId },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            idNumber: true,
            grade: true,
            className: true,
            enrollmentStatus: true,
            familyAccount: { select: { accountRef: true } },
        },
    });
    for (const learner of dbLearners) {
        const status = prismaEnrollmentToMigrationStatus(learner.enrollmentStatus);
        const entry = {
            status,
            grade: learner.grade || undefined,
            classroom: learner.className || undefined,
        };
        const nameKey = `name:${learner.firstName.toLowerCase()} ${learner.lastName.toLowerCase()}`.trim();
        const idKey = learner.idNumber
            ? `id:${String(learner.idNumber).toLowerCase()}`
            : "";
        const acct = learner.familyAccount?.accountRef
            ? `acct:${learner.familyAccount.accountRef.toLowerCase()}`
            : "";
        const merge = (key) => {
            if (!key)
                return;
            const existing = stagedIndex.get(key);
            if (!existing || status === "ACTIVE")
                stagedIndex.set(key, entry);
        };
        merge(nameKey);
        merge(idKey);
        merge(acct);
    }
    return stagedIndex;
}
function ledgerEntryTypeForPosting(postingType) {
    switch (postingType) {
        case "invoice":
        case "journal_debit":
            return "invoice";
        case "payment":
            return "payment";
        case "journal_credit":
            return "credit";
        default:
            return "invoice";
    }
}
function migrationLedgerEntryId(postingType, accountRef, date, reference, amount) {
    const safeRef = (reference || "norefnomig").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const safeAcct = accountRef.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    return `umig-tx-${postingType}-${safeAcct}-${date}-${safeRef}-${amount}`;
}
function duplicateKeySeen(seen, key) {
    if (!key)
        return false;
    const s = (0, classifyLedgerTransaction_1.formatLedgerDuplicateKey)(key);
    if (seen.has(s))
        return true;
    seen.add(s);
    return false;
}
function bumpTransactionOutcome(outcomes, bucket) {
    outcomes[bucket] += 1;
}
async function postSingleMigrationLedgerTransaction(ctx, input) {
    const { mapped, sourceFileId, sourceFilename, rowNumber } = input;
    const { entry, matched } = resolveIndexEntry(mapped, ctx.learnerIndex);
    const accountStatus = cleanString(mapped.status) || entry?.accountStatus;
    const decision = (0, classifyLedgerTransaction_1.classifyLedgerTransaction)({
        mapped,
        cutoverDate: ctx.cutoverDate,
        learnerEntry: entry,
        hasLearnerOrAccountMatch: matched,
        accountStatus,
    });
    const reportBase = {
        entityType: "transaction",
        sourceFileId,
        sourceFilename,
        rowNumber,
        key: decision.duplicateKey ? (0, classifyLedgerTransaction_1.formatLedgerDuplicateKey)(decision.duplicateKey) : undefined,
    };
    if (decision.historicalOnly || decision.bucket === "historicalOnly") {
        ctx.report.push({
            ...reportBase,
            status: "not_applied",
            message: decision.reason,
        });
        bumpTransactionOutcome(ctx.transactionOutcomes, "historicalNotApplied");
        return;
    }
    if (decision.bucket === "unmatched") {
        ctx.report.push({
            ...reportBase,
            status: "failed",
            message: decision.reason,
        });
        ctx.failedCounts.transactions += 1;
        bumpTransactionOutcome(ctx.transactionOutcomes, "unmatched");
        return;
    }
    if (!decision.canPost) {
        const status = decision.bucket === "blocked" ? "failed" : "skipped";
        ctx.report.push({
            ...reportBase,
            status,
            message: decision.reason,
        });
        if (status === "failed")
            ctx.failedCounts.transactions += 1;
        else
            ctx.skippedCounts.transactions += 1;
        bumpTransactionOutcome(ctx.transactionOutcomes, "blocked");
        return;
    }
    if (duplicateKeySeen(ctx.seenDuplicateKeys, decision.duplicateKey)) {
        ctx.report.push({
            ...reportBase,
            status: "skipped",
            message: "Duplicate transaction skipped (account, date, reference, amount, type)",
            key: decision.duplicateKey ? (0, classifyLedgerTransaction_1.formatLedgerDuplicateKey)(decision.duplicateKey) : undefined,
        });
        ctx.skippedCounts.transactions += 1;
        bumpTransactionOutcome(ctx.transactionOutcomes, "duplicateSkipped");
        return;
    }
    const accountRef = cleanString(mapped.accountNumber);
    const familyAccount = await ctx.tx.familyAccount.findFirst({
        where: { schoolId: ctx.schoolId, accountRef },
        select: { id: true, accountRef: true },
    });
    if (!familyAccount) {
        ctx.report.push({
            ...reportBase,
            status: "failed",
            message: "Billing account not found at target school — transaction not posted",
        });
        ctx.failedCounts.transactions += 1;
        bumpTransactionOutcome(ctx.transactionOutcomes, "blocked");
        return;
    }
    const activeLearner = await ctx.tx.learner.findFirst({
        where: {
            schoolId: ctx.schoolId,
            familyAccountId: familyAccount.id,
            enrollmentStatus: "ACTIVE",
        },
        select: { id: true, grade: true, className: true, enrollmentStatus: true },
        orderBy: { createdAt: "asc" },
    });
    if (!activeLearner) {
        ctx.report.push({
            ...reportBase,
            status: "failed",
            message: "No ACTIVE learner on billing account — transaction not posted (head count protected)",
        });
        ctx.failedCounts.transactions += 1;
        bumpTransactionOutcome(ctx.transactionOutcomes, "blocked");
        return;
    }
    const postingType = decision.postingType;
    const ledgerType = ledgerEntryTypeForPosting(postingType);
    const entryId = migrationLedgerEntryId(postingType, accountRef, decision.date, decision.reference, decision.amount);
    const ledgerEntry = {
        id: entryId,
        schoolId: ctx.schoolId,
        learnerId: activeLearner.id,
        accountNo: familyAccount.accountRef,
        type: ledgerType,
        amount: (0, billingLedgerStore_1.normaliseAmount)(decision.amount),
        date: decision.date,
        reference: decision.reference || entryId,
        description: cleanString(mapped.description) ||
            cleanString(mapped.transactionType) ||
            `Migration import ${postingType}`,
        source: "universal_migration_phase14",
        createdAt: new Date().toISOString(),
    };
    (0, billingLedgerStore_1.appendSchoolEntry)(ctx.schoolId, ledgerEntry);
    ctx.report.push({
        ...reportBase,
        status: "created",
        message: `Posted ${postingType} to billing ledger (${ledgerType}, R${ledgerEntry.amount.toFixed(2)})`,
        recordId: entryId,
        key: (0, classifyLedgerTransaction_1.formatLedgerDuplicateKey)(decision.duplicateKey),
    });
    ctx.createdCounts.transactions += 1;
    bumpTransactionOutcome(ctx.transactionOutcomes, "posted");
}
