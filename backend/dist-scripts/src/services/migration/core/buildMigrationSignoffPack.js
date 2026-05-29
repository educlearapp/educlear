"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MigrationSignoffError = void 0;
exports.hasMigrationCriticalFailures = hasMigrationCriticalFailures;
exports.computeApprovedForGoLive = computeApprovedForGoLive;
exports.computeSignoffStatus = computeSignoffStatus;
exports.buildMigrationSignoffPack = buildMigrationSignoffPack;
const migrationImportBatchStore_1 = require("./migrationImportBatchStore");
const reconcileMigrationBatch_1 = require("./reconcileMigrationBatch");
const exportImportBatchReport_1 = require("./exportImportBatchReport");
const exportMigrationReconciliationReport_1 = require("./exportMigrationReconciliationReport");
class MigrationSignoffError extends Error {
    constructor(message) {
        super(message);
        this.name = "MigrationSignoffError";
    }
}
exports.MigrationSignoffError = MigrationSignoffError;
function cleanString(v) {
    return String(v ?? "").trim();
}
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
function sumCounts(counts) {
    return (counts.learners +
        counts.parents +
        counts.employees +
        counts.billingAccounts +
        counts.transactions +
        counts.classrooms +
        counts.parentLearnerLinks);
}
function hydrateBatchCounts(batch) {
    return {
        created: batch.createdCounts ?? emptyCounts(),
        skipped: batch.skippedCounts ?? emptyCounts(),
        failed: batch.failedCounts ?? emptyCounts(),
    };
}
/** Critical = reconciliation failures, apply failures, or batch not successfully completed. */
function hasMigrationCriticalFailures(reconciliation, batch) {
    if (reconciliation.summary.failed > 0)
        return true;
    if (batch.status === "failed" || batch.status === "rolled_back")
        return true;
    if (batch.status !== "completed")
        return true;
    const failed = batch.failedCounts ?? emptyCounts();
    if (sumCounts(failed) > 0)
        return true;
    return false;
}
function computeApprovedForGoLive(reconciliationStatus, criticalFailures) {
    if (criticalFailures)
        return false;
    if (reconciliationStatus === "fail")
        return false;
    if (reconciliationStatus === "warning")
        return false;
    if (reconciliationStatus === "pass")
        return true;
    return false;
}
function computeSignoffStatus(input) {
    if (input.reconciliationStatus === "fail" || input.criticalFailures) {
        return "blocked";
    }
    if (input.approvedForGoLive && input.approvalConfirmed) {
        return "approved";
    }
    return "draft";
}
function collectWarnings(reconciliation, batch) {
    const warnings = [];
    for (const check of reconciliation.checks) {
        if (check.status === "warning") {
            warnings.push(`${check.check}: ${check.message}`);
        }
        if (check.status === "fail") {
            warnings.push(`${check.check}: ${check.message}`);
        }
    }
    if (batch.status === "rolled_back") {
        warnings.push("Import batch status is rolled_back — not eligible for go-live.");
    }
    if (batch.status !== "completed") {
        warnings.push(`Import batch status is ${batch.status} — expected completed for go-live.`);
    }
    const failed = batch.failedCounts ?? emptyCounts();
    if (sumCounts(failed) > 0) {
        warnings.push(`Apply report has failed records (learners ${failed.learners}, parents ${failed.parents}, billing ${failed.billingAccounts}, transactions ${failed.transactions}).`);
    }
    return warnings;
}
function loadExportedReports(batchId, reconciliation) {
    const reports = [];
    try {
        const batchExport = (0, exportImportBatchReport_1.exportImportBatchReport)(batchId);
        reports.push({
            label: "Import batch report (CSV)",
            filename: batchExport.filename,
            downloadPath: batchExport.downloadPath,
        });
    }
    catch {
        /* batch export optional if report empty */
    }
    try {
        const reconExport = (0, exportMigrationReconciliationReport_1.exportMigrationReconciliationReport)(reconciliation);
        reports.push({
            label: "Reconciliation report (CSV)",
            filename: reconExport.filename,
            downloadPath: reconExport.downloadPath,
        });
    }
    catch {
        /* reconciliation CSV always generated when reconciliation exists */
    }
    return reports;
}
async function buildMigrationSignoffPack(input) {
    const batchId = cleanString(input.batchId);
    const targetSchoolId = cleanString(input.targetSchoolId);
    const operatorName = cleanString(input.operatorName);
    const operatorEmail = cleanString(input.operatorEmail);
    const notes = cleanString(input.notes);
    const approvalConfirmed = Boolean(input.approvalConfirmed);
    if (!batchId)
        throw new MigrationSignoffError("batchId is required");
    if (!targetSchoolId)
        throw new MigrationSignoffError("targetSchoolId is required");
    if (!operatorName)
        throw new MigrationSignoffError("operatorName is required");
    if (!operatorEmail)
        throw new MigrationSignoffError("operatorEmail is required");
    if (!approvalConfirmed) {
        throw new MigrationSignoffError("approvalConfirmed is required");
    }
    const batch = (0, migrationImportBatchStore_1.getImportBatch)(batchId);
    if (!batch)
        throw new MigrationSignoffError("Import batch not found");
    if (batch.targetSchoolId !== targetSchoolId) {
        throw new MigrationSignoffError("targetSchoolId does not match this import batch");
    }
    let reconciliation;
    try {
        reconciliation = await (0, reconcileMigrationBatch_1.reconcileMigrationBatch)({ batchId, targetSchoolId });
    }
    catch (e) {
        if (e instanceof reconcileMigrationBatch_1.MigrationReconciliationError) {
            throw new MigrationSignoffError(e.message);
        }
        throw e;
    }
    const criticalFailures = hasMigrationCriticalFailures(reconciliation, batch);
    const approvedForGoLive = computeApprovedForGoLive(reconciliation.overallStatus, criticalFailures);
    const signoffStatus = computeSignoffStatus({
        reconciliationStatus: reconciliation.overallStatus,
        criticalFailures,
        approvalConfirmed,
        approvedForGoLive,
    });
    const exportedReports = loadExportedReports(batchId, reconciliation);
    const counts = hydrateBatchCounts(batch);
    const warnings = collectWarnings(reconciliation, batch);
    return {
        batchId: batch.batchId,
        stageId: batch.stageId,
        schoolId: batch.targetSchoolId,
        schoolName: batch.targetSchoolName,
        operatorName,
        operatorEmail,
        signoffStatus,
        reconciliationStatus: reconciliation.overallStatus,
        migrationStatus: batch.status,
        counts,
        warnings,
        exportedReports,
        notes,
        approvedForGoLive,
        approvalConfirmed,
        reconciledAt: reconciliation.reconciledAt,
    };
}
