"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMigrationPreflightDashboard = buildMigrationPreflightDashboard;
const prisma_1 = require("../../../prisma");
const buildMigrationSignoffPack_1 = require("./buildMigrationSignoffPack");
const migrationImportBatchStore_1 = require("./migrationImportBatchStore");
const migrationPilotStore_1 = require("./migrationPilotStore");
const reconcileMigrationBatch_1 = require("./reconcileMigrationBatch");
const migrationRunbookStore_1 = require("./migrationRunbookStore");
const migrationSignoffStore_1 = require("./migrationSignoffStore");
const staging_1 = require("../staging");
function cleanString(v) {
    return String(v ?? "").trim();
}
function latestRunbookForSchool(schoolId) {
    const match = (0, migrationRunbookStore_1.listRunbooks)().filter((r) => r.schoolId === schoolId);
    return match[0] ?? null;
}
function latestPilotForSchool(schoolId) {
    const match = (0, migrationPilotStore_1.listPilots)().filter((p) => p.schoolId === schoolId);
    return match[0] ?? null;
}
function latestBatchForSchool(schoolId) {
    const match = (0, migrationImportBatchStore_1.listImportBatches)().filter((b) => b.targetSchoolId === schoolId);
    return match[0] ?? null;
}
function latestSignoffForSchool(schoolId, batchId) {
    const signoffs = (0, migrationSignoffStore_1.listSignoffs)().filter((s) => s.schoolId === schoolId);
    if (batchId) {
        const forBatch = signoffs.find((s) => s.batchId === batchId);
        if (forBatch)
            return forBatch;
    }
    return signoffs[0] ?? null;
}
function addBlocker(blockers, blockerId, title, severity, message) {
    if (blockers.some((b) => b.blockerId === blockerId))
        return;
    blockers.push({ blockerId, title, severity, message });
}
function formatRunbookStatus(runbook) {
    if (!runbook)
        return "missing";
    return runbook.overallStatus;
}
function formatPilotStatus(pilot) {
    if (!pilot)
        return "missing";
    return pilot.status;
}
function formatValidationStatus(pilot, stage) {
    if (pilot) {
        const vs = pilot.validationSummary;
        if (vs.errors > 0)
            return "failed";
        if (!vs.canProceed)
            return "blocked";
        if (vs.warnings > 0)
            return "warning";
        if (vs.mode === "full" && vs.errors === 0)
            return "passed";
        return vs.mode === "preview" ? "preview_only" : "incomplete";
    }
    if (stage) {
        const vs = stage.validationSummary;
        if (vs.errors > 0)
            return "failed";
        if (!vs.canProceed)
            return "blocked";
        if (vs.warnings > 0)
            return "warning";
        return "passed";
    }
    return "missing";
}
function formatDryRunStatus(pilot, stage) {
    const dry = pilot?.dryRunSummary;
    if (dry?.stageCreated) {
        if (dry.validationErrors > 0)
            return "blocked";
        if (!dry.canApply)
            return "not_eligible";
        if (dry.dryRunWarnings.length > 0)
            return "warning";
        return "ready";
    }
    if (stage) {
        if (stage.validationSummary.errors > 0)
            return "blocked";
        if (!stage.canApply)
            return "not_eligible";
        if (stage.warnings.length > 0)
            return "warning";
        return "ready";
    }
    return "missing";
}
function formatBatchStatus(batch) {
    if (!batch)
        return "missing";
    return batch.status;
}
function formatReconciliationStatus(reconciliation, pilot) {
    if (reconciliation)
        return reconciliation.overallStatus;
    if (pilot?.reconciliationSummary.run && pilot.reconciliationSummary.overallStatus) {
        return pilot.reconciliationSummary.overallStatus;
    }
    return "missing";
}
function formatSignoffStatus(signoff) {
    if (!signoff)
        return "missing";
    return signoff.signoffStatus;
}
async function loadLiveReconciliation(batch, schoolId) {
    if (!batch || batch.status !== "completed")
        return null;
    try {
        return await (0, reconcileMigrationBatch_1.reconcileMigrationBatch)({
            batchId: batch.batchId,
            targetSchoolId: schoolId,
        });
    }
    catch (e) {
        if (e instanceof reconcileMigrationBatch_1.MigrationReconciliationError)
            return null;
        throw e;
    }
}
function collectBlockers(input) {
    const blockers = [];
    const { runbook, pilot, stage, batch, reconciliation, signoff } = input;
    if (!runbook) {
        addBlocker(blockers, "runbook_missing", "Runbook", "warning", "No Da Silva pilot runbook exists for this school.");
    }
    else if (runbook.overallStatus === "blocked") {
        addBlocker(blockers, "runbook_blocked", "Runbook blocked", "critical", "Runbook overall status is blocked — resolve blocked steps before go-live.");
    }
    else if (runbook.overallStatus !== "completed") {
        addBlocker(blockers, "runbook_incomplete", "Runbook incomplete", "warning", `Runbook status is "${runbook.overallStatus}" — all required steps must be completed.`);
    }
    if (!pilot) {
        addBlocker(blockers, "pilot_missing", "Pilot", "warning", "No pilot validation record exists for this school.");
    }
    else if (pilot.status === "failed") {
        addBlocker(blockers, "pilot_failed", "Pilot failed", "critical", "Latest pilot validation run failed — review validation, dry run, and reconciliation.");
    }
    const validationStatus = formatValidationStatus(pilot, stage);
    if (validationStatus === "failed") {
        addBlocker(blockers, "validation_failed", "Validation errors", "critical", "Validation has unresolved errors — fix before go-live.");
    }
    else if (validationStatus === "missing") {
        addBlocker(blockers, "validation_missing", "Validation missing", "warning", "No validation summary is available from pilot or dry-run stage.");
    }
    else if (validationStatus === "preview_only" || validationStatus === "incomplete") {
        addBlocker(blockers, "validation_incomplete", "Validation incomplete", "warning", "Full validation has not been recorded (preview-only or incomplete mode).");
    }
    const dryRunStatus = formatDryRunStatus(pilot, stage);
    if (dryRunStatus === "missing") {
        addBlocker(blockers, "dry_run_missing", "Dry run missing", "warning", "No dry-run stage package is linked to the latest pilot or batch.");
    }
    else if (dryRunStatus === "blocked" || dryRunStatus === "not_eligible") {
        addBlocker(blockers, "dry_run_blocked", "Dry run not ready", "critical", "Dry-run stage is missing, has validation errors, or is not eligible for apply.");
    }
    if (batch?.status === "failed" || batch?.status === "rolled_back") {
        addBlocker(blockers, "batch_failed", "Import batch", "critical", `Latest import batch status is "${batch.status}".`);
    }
    const reconStatus = formatReconciliationStatus(reconciliation, pilot);
    if (reconStatus === "missing") {
        if (batch?.status === "completed") {
            addBlocker(blockers, "reconciliation_missing", "Reconciliation missing", "critical", "Import batch is completed but reconciliation could not be computed.");
        }
        else {
            addBlocker(blockers, "reconciliation_not_run", "Reconciliation not run", "warning", "Reconciliation has not been run for a completed import batch.");
        }
    }
    else if (reconStatus === "fail") {
        addBlocker(blockers, "reconciliation_failed", "Reconciliation failed", "critical", "Latest reconciliation overall status is FAIL.");
    }
    else if (reconStatus === "warning") {
        addBlocker(blockers, "reconciliation_warning", "Reconciliation warnings", "warning", "Reconciliation reported warnings — review before go-live.");
    }
    if (batch?.status === "completed") {
        if (!signoff) {
            addBlocker(blockers, "signoff_missing", "Sign-off missing", "critical", "A completed import batch exists but no sign-off pack was found.");
        }
        else if (signoff.signoffStatus === "blocked") {
            addBlocker(blockers, "signoff_blocked", "Sign-off blocked", "critical", "Sign-off pack is blocked — reconciliation or batch gates failed.");
        }
        else if (signoff.signoffStatus !== "approved" || !signoff.approvedForGoLive) {
            addBlocker(blockers, "signoff_not_approved", "Sign-off not approved", "critical", "Sign-off exists but is not approved for go-live.");
        }
    }
    else if (!signoff) {
        addBlocker(blockers, "signoff_absent", "Sign-off", "info", "No sign-off pack yet (expected after a successful apply and reconciliation).");
    }
    if (pilot?.status === "warning") {
        addBlocker(blockers, "pilot_warning", "Pilot warnings", "warning", "Latest pilot validation status is warning — review dry run and reconciliation summaries.");
    }
    return blockers;
}
function hasCriticalBlockers(blockers) {
    return blockers.some((b) => b.severity === "critical");
}
function computeOverallStatus(input) {
    const { runbook, pilot, stage, batch, reconciliation, signoff, blockers } = input;
    const hasFrameworkData = Boolean(runbook || pilot || batch || signoff);
    if (!hasFrameworkData)
        return "unknown";
    const validationStatus = formatValidationStatus(pilot, stage);
    const reconStatus = formatReconciliationStatus(reconciliation, pilot);
    if (hasCriticalBlockers(blockers))
        return "blocked";
    if (runbook?.overallStatus === "blocked")
        return "blocked";
    if (pilot?.status === "failed")
        return "blocked";
    if (validationStatus === "failed")
        return "blocked";
    if (reconStatus === "fail")
        return "blocked";
    if (batch?.status === "completed" && (!signoff || signoff.signoffStatus !== "approved")) {
        return "blocked";
    }
    const runbookComplete = runbook?.overallStatus === "completed";
    const reconPass = reconStatus === "pass";
    const signoffApproved = signoff?.signoffStatus === "approved" &&
        signoff.approvedForGoLive &&
        signoff.approvalConfirmed;
    if (runbookComplete &&
        reconPass &&
        signoffApproved &&
        blockers.filter((b) => b.severity !== "info").length === 0) {
        return "ready";
    }
    if (!runbook && !pilot && !batch)
        return "unknown";
    if (blockers.some((b) => b.severity === "warning"))
        return "warning";
    if (!runbookComplete || !reconPass || !signoffApproved)
        return "warning";
    if (pilot?.status === "warning")
        return "warning";
    return "warning";
}
function computeGoLiveReady(overallStatus, runbook, reconciliation, signoff, batch) {
    if (overallStatus !== "ready")
        return false;
    if (runbook?.overallStatus !== "completed")
        return false;
    if (!reconciliation || reconciliation.overallStatus !== "pass")
        return false;
    if (!signoff?.approvedForGoLive || signoff.signoffStatus !== "approved")
        return false;
    if (!batch)
        return false;
    const critical = (0, buildMigrationSignoffPack_1.hasMigrationCriticalFailures)(reconciliation, batch);
    if (!(0, buildMigrationSignoffPack_1.computeApprovedForGoLive)(reconciliation.overallStatus, critical))
        return false;
    return true;
}
async function buildMigrationPreflightDashboard(input) {
    const schoolId = cleanString(input.schoolId);
    if (!schoolId) {
        throw new Error("schoolId is required");
    }
    const runbook = latestRunbookForSchool(schoolId);
    const pilot = latestPilotForSchool(schoolId);
    const batch = latestBatchForSchool(schoolId);
    const batchId = batch?.batchId ?? pilot?.reconciliationSummary.batchId;
    const signoff = latestSignoffForSchool(schoolId, batchId);
    const stageId = cleanString(pilot?.dryRunSummary.stageId) ||
        cleanString(batch?.stageId) ||
        cleanString(signoff?.stageId);
    const stage = stageId ? (0, staging_1.getStage)(stageId) : null;
    const reconciliation = await loadLiveReconciliation(batch, schoolId);
    let schoolName = runbook?.schoolName || pilot?.schoolName || batch?.targetSchoolName || signoff?.schoolName || "";
    if (!schoolName) {
        const school = await prisma_1.prisma.school.findUnique({
            where: { id: schoolId },
            select: { name: true },
        });
        schoolName = school?.name ?? "Unknown school";
    }
    const sourceSystem = cleanString(pilot?.sourceSystem) ||
        cleanString(runbook?.sourceSystem) ||
        cleanString(batch?.sourceSystem) ||
        cleanString(stage?.sourceSystem) ||
        "unknown";
    const blockers = collectBlockers({
        runbook,
        pilot,
        stage,
        batch,
        reconciliation,
        signoff,
    });
    const overallStatus = computeOverallStatus({
        runbook,
        pilot,
        stage,
        batch,
        reconciliation,
        signoff,
        blockers,
    });
    const goLiveReady = computeGoLiveReady(overallStatus, runbook, reconciliation, signoff, batch);
    return {
        schoolId,
        schoolName,
        sourceSystem,
        overallStatus,
        runbookStatus: formatRunbookStatus(runbook),
        pilotStatus: formatPilotStatus(pilot),
        validationStatus: formatValidationStatus(pilot, stage),
        dryRunStatus: formatDryRunStatus(pilot, stage),
        batchStatus: formatBatchStatus(batch),
        reconciliationStatus: formatReconciliationStatus(reconciliation, pilot),
        signoffStatus: formatSignoffStatus(signoff),
        blockers,
        goLiveReady,
        generatedAt: new Date().toISOString(),
        ...(runbook?.runbookId ? { runbookId: runbook.runbookId } : {}),
        ...(pilot?.pilotId ? { pilotId: pilot.pilotId } : {}),
        ...(stageId ? { stageId } : {}),
        ...(batch?.batchId ? { batchId: batch.batchId } : {}),
        ...(signoff?.signoffId ? { signoffId: signoff.signoffId } : {}),
    };
}
