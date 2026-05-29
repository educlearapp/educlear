"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MigrationRollbackError = void 0;
exports.batchHasCreatedTransactions = batchHasCreatedTransactions;
exports.rollbackMigrationBatch = rollbackMigrationBatch;
const prisma_1 = require("../../../prisma");
const migrationImportBatchStore_1 = require("./migrationImportBatchStore");
const ROLLBACK_TX_OPTIONS = { maxWait: 30000, timeout: 180000 };
function emptyCounts() {
    return {
        learners: 0,
        parents: 0,
        employees: 0,
        billingAccounts: 0,
        transactions: 0,
        classrooms: 0,
        parentLearnerLinks: 0,
    };
}
function bumpCount(counts, entity) {
    switch (entity) {
        case "learner":
            counts.learners += 1;
            break;
        case "parent":
            counts.parents += 1;
            break;
        case "employee":
            counts.employees += 1;
            break;
        case "billingAccount":
            counts.billingAccounts += 1;
            break;
        case "transaction":
            counts.transactions += 1;
            break;
        case "classroom":
            counts.classrooms += 1;
            break;
        case "parentLearnerLink":
            counts.parentLearnerLinks += 1;
            break;
        default:
            break;
    }
}
function cleanString(v) {
    return String(v ?? "").trim();
}
function createdRecordIds(rows, entityType) {
    const ids = new Set();
    for (const row of rows) {
        if (row.status !== "created" || row.entityType !== entityType)
            continue;
        const id = cleanString(row.recordId);
        if (id)
            ids.add(id);
    }
    return [...ids];
}
class MigrationRollbackError extends Error {
    constructor(message) {
        super(message);
        this.name = "MigrationRollbackError";
    }
}
exports.MigrationRollbackError = MigrationRollbackError;
function batchHasCreatedTransactions(reportRows) {
    return reportRows.some((row) => row.status === "created" && row.entityType === "transaction");
}
async function rollbackMigrationBatch(input) {
    const batchId = cleanString(input.batchId);
    const targetSchoolId = cleanString(input.targetSchoolId);
    const confirmationText = cleanString(input.confirmationText);
    if (!batchId)
        throw new MigrationRollbackError("batchId is required");
    if (!targetSchoolId)
        throw new MigrationRollbackError("targetSchoolId is required");
    if (!confirmationText)
        throw new MigrationRollbackError("confirmationText is required");
    const batch = (0, migrationImportBatchStore_1.getImportBatch)(batchId);
    if (!batch)
        throw new MigrationRollbackError("Import batch not found");
    if (batch.status !== "completed" && batch.status !== "failed") {
        throw new MigrationRollbackError(`Rollback is only allowed for completed or failed batches (current status: ${batch.status})`);
    }
    if (batch.targetSchoolId !== targetSchoolId) {
        throw new MigrationRollbackError("targetSchoolId does not match this import batch");
    }
    const expectedPhrase = cleanString(batch.targetSchoolName);
    if (confirmationText.trim().toLowerCase() !== expectedPhrase.trim().toLowerCase()) {
        throw new MigrationRollbackError(`Confirmation phrase must match the target school name exactly (${expectedPhrase})`);
    }
    const reportRows = batch.reportRows ?? [];
    if (batchHasCreatedTransactions(reportRows)) {
        throw new MigrationRollbackError("This batch contains posted ledger transactions. Use reversal rollback, not deletion rollback.");
    }
    const createdRows = reportRows.filter((row) => row.status === "created");
    const linkIds = createdRecordIds(createdRows, "parentLearnerLink");
    const learnerIds = createdRecordIds(createdRows, "learner");
    const parentIds = createdRecordIds(createdRows, "parent");
    const billingIds = createdRecordIds(createdRows, "billingAccount");
    const employeeIds = createdRecordIds(createdRows, "employee");
    const deletedCounts = emptyCounts();
    const blockedCounts = emptyCounts();
    const rollbackReport = [];
    const pushRollback = (row) => {
        rollbackReport.push(row);
        if (row.status === "deleted")
            bumpCount(deletedCounts, row.entityType);
        else
            bumpCount(blockedCounts, row.entityType);
    };
    await prisma_1.prisma.$transaction(async (tx) => {
        for (const linkId of linkIds) {
            const link = await tx.parentLearnerLink.findFirst({
                where: { id: linkId, schoolId: targetSchoolId },
                select: { id: true },
            });
            if (!link) {
                pushRollback({
                    entityType: "parentLearnerLink",
                    recordId: linkId,
                    status: "skipped",
                    message: "Parent–learner link not found at target school (already removed or never created)",
                });
                continue;
            }
            await tx.parentLearnerLink.delete({ where: { id: linkId } });
            pushRollback({
                entityType: "parentLearnerLink",
                recordId: linkId,
                status: "deleted",
                message: "Parent–learner link removed",
            });
        }
        for (const learnerId of learnerIds) {
            const learner = await tx.learner.findFirst({
                where: { id: learnerId, schoolId: targetSchoolId },
                select: { id: true },
            });
            if (!learner) {
                pushRollback({
                    entityType: "learner",
                    recordId: learnerId,
                    status: "skipped",
                    message: "Learner not found at target school (already removed or never created)",
                });
                continue;
            }
            try {
                await tx.learner.delete({ where: { id: learnerId } });
                pushRollback({
                    entityType: "learner",
                    recordId: learnerId,
                    status: "deleted",
                    message: "Learner removed",
                });
            }
            catch (e) {
                const message = e instanceof Error ? e.message : "Learner delete blocked";
                pushRollback({
                    entityType: "learner",
                    recordId: learnerId,
                    status: "blocked",
                    message,
                });
            }
        }
        for (const parentId of parentIds) {
            const parent = await tx.parent.findFirst({
                where: { id: parentId, schoolId: targetSchoolId },
                select: { id: true },
            });
            if (!parent) {
                pushRollback({
                    entityType: "parent",
                    recordId: parentId,
                    status: "skipped",
                    message: "Parent not found at target school (already removed or never created)",
                });
                continue;
            }
            const remainingLinks = await tx.parentLearnerLink.count({
                where: { parentId, schoolId: targetSchoolId },
            });
            if (remainingLinks > 0) {
                pushRollback({
                    entityType: "parent",
                    recordId: parentId,
                    status: "blocked",
                    message: "Parent still linked to learners at this school — not removed",
                });
                continue;
            }
            try {
                await tx.parent.delete({ where: { id: parentId } });
                pushRollback({
                    entityType: "parent",
                    recordId: parentId,
                    status: "deleted",
                    message: "Parent removed",
                });
            }
            catch (e) {
                const message = e instanceof Error ? e.message : "Parent delete blocked";
                pushRollback({
                    entityType: "parent",
                    recordId: parentId,
                    status: "blocked",
                    message,
                });
            }
        }
        for (const employeeId of employeeIds) {
            const employee = await tx.employee.findFirst({
                where: { id: employeeId, schoolId: targetSchoolId },
                select: { id: true },
            });
            if (!employee) {
                pushRollback({
                    entityType: "employee",
                    recordId: employeeId,
                    status: "skipped",
                    message: "Employee not found at target school (already removed or never created)",
                });
                continue;
            }
            try {
                await tx.employee.delete({ where: { id: employeeId } });
                pushRollback({
                    entityType: "employee",
                    recordId: employeeId,
                    status: "deleted",
                    message: "Staff member removed",
                });
            }
            catch (e) {
                const message = e instanceof Error ? e.message : "Employee delete blocked";
                pushRollback({
                    entityType: "employee",
                    recordId: employeeId,
                    status: "blocked",
                    message,
                });
            }
        }
        for (const accountId of billingIds) {
            const account = await tx.familyAccount.findFirst({
                where: { id: accountId, schoolId: targetSchoolId },
                select: { id: true },
            });
            if (!account) {
                pushRollback({
                    entityType: "billingAccount",
                    recordId: accountId,
                    status: "skipped",
                    message: "Billing account not found at target school (already removed or never created)",
                });
                continue;
            }
            const learnerRefs = await tx.learner.count({
                where: { familyAccountId: accountId, schoolId: targetSchoolId },
            });
            const parentRefs = await tx.parent.count({
                where: { familyAccountId: accountId, schoolId: targetSchoolId },
            });
            if (learnerRefs > 0 || parentRefs > 0) {
                pushRollback({
                    entityType: "billingAccount",
                    recordId: accountId,
                    status: "blocked",
                    message: "Billing account still referenced by learners or parents at this school",
                });
                continue;
            }
            try {
                await tx.familyAccount.delete({ where: { id: accountId } });
                pushRollback({
                    entityType: "billingAccount",
                    recordId: accountId,
                    status: "deleted",
                    message: "Billing account removed",
                });
            }
            catch (e) {
                const message = e instanceof Error ? e.message : "Billing account delete blocked";
                pushRollback({
                    entityType: "billingAccount",
                    recordId: accountId,
                    status: "blocked",
                    message,
                });
            }
        }
    }, ROLLBACK_TX_OPTIONS);
    const rolledBackAt = new Date().toISOString();
    const result = {
        batchId: batch.batchId,
        targetSchoolId: batch.targetSchoolId,
        targetSchoolName: batch.targetSchoolName,
        rolledBackAt,
        success: blockedCounts.learners === 0 &&
            blockedCounts.parents === 0 &&
            blockedCounts.billingAccounts === 0 &&
            blockedCounts.employees === 0,
        deletedCounts,
        blockedCounts,
        report: rollbackReport,
    };
    (0, migrationImportBatchStore_1.updateImportBatch)(batch.batchId, {
        status: "rolled_back",
        rolledBackAt,
        rollbackReport,
    });
    return result;
}
