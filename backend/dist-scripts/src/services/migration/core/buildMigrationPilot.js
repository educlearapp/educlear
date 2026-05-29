"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MigrationPilotError = void 0;
exports.hasPilotCriticalFailures = hasPilotCriticalFailures;
exports.isDryRunClean = isDryRunClean;
exports.computeMigrationPilotStatus = computeMigrationPilotStatus;
exports.buildPilotVerificationChecks = buildPilotVerificationChecks;
exports.buildMigrationPilot = buildMigrationPilot;
const staging_1 = require("../staging");
const migrationImportBatchStore_1 = require("./migrationImportBatchStore");
const reconcileMigrationBatch_1 = require("./reconcileMigrationBatch");
const migrationSignoffStore_1 = require("./migrationSignoffStore");
class MigrationPilotError extends Error {
    constructor(message) {
        super(message);
        this.name = "MigrationPilotError";
    }
}
exports.MigrationPilotError = MigrationPilotError;
function cleanString(v) {
    return String(v ?? "").trim();
}
function emptyValidationSummary() {
    return {
        mode: "preview",
        rowsChecked: 0,
        totalIssues: 0,
        errors: 0,
        warnings: 0,
        info: 0,
        canProceed: false,
        issuesShown: 0,
    };
}
function defaultDryRunSummary(sourceSystem) {
    return {
        stageCreated: false,
        sourceSystem,
        canApply: false,
        validationErrors: 0,
        validationWarnings: 0,
        stagedCounts: {
            learners: 0,
            parents: 0,
            billingAccounts: 0,
            transactions: 0,
            staff: 0,
            historical: 0,
        },
        transactionReadiness: {
            historicalOnlyTransactions: 0,
            eligibleActiveTransactions: 0,
            blockedTransactions: 0,
            unmatchedTransactions: 0,
        },
        dryRunWarnings: [],
        headCountProtected: false,
        historicalLearnersProtected: false,
    };
}
function defaultReconciliationSummary() {
    return {
        run: false,
        passed: 0,
        warnings: 0,
        failed: 0,
        total: 0,
        headCountProtected: false,
        historicalLearnersProtected: false,
        messages: [],
    };
}
function hydrateValidationSummary(input, partial) {
    const base = partial ?? input.validationSummary ?? {};
    const stage = input.stageId ? (0, staging_1.getStage)(input.stageId) : null;
    const fromStage = stage?.validationSummary;
    const merged = {
        ...emptyValidationSummary(),
        ...(fromStage ?? {}),
        ...base,
    };
    return {
        ...merged,
        capturedAt: cleanString(base.capturedAt) || new Date().toISOString(),
        stageId: cleanString(base.stageId) || input.stageId || stage?.stageId,
    };
}
function hydrateDryRunSummary(input) {
    const defaults = defaultDryRunSummary(cleanString(input.sourceSystem) || "unknown");
    const partial = input.dryRunSummary ?? {};
    const stageId = cleanString(input.stageId) || cleanString(partial.stageId);
    const stage = stageId ? (0, staging_1.getStage)(stageId) : null;
    if (!stage) {
        return {
            ...defaults,
            ...partial,
            sourceSystem: cleanString(partial.sourceSystem) || defaults.sourceSystem,
            stageCreated: Boolean(partial.stageCreated),
        };
    }
    const validationErrors = stage.validationSummary.errors;
    const validationWarnings = stage.validationSummary.warnings;
    const blocked = stage.transactionReadiness.blockedTransactions;
    const unmatched = stage.transactionReadiness.unmatchedTransactions;
    const dryRunWarnings = [...(stage.warnings ?? [])];
    if (blocked > 0) {
        dryRunWarnings.push(`${blocked} transaction(s) blocked in dry-run readiness.`);
    }
    if (unmatched > 0) {
        dryRunWarnings.push(`${unmatched} transaction(s) unmatched in dry-run readiness.`);
    }
    const headCountProtected = validationErrors === 0 &&
        stage.canApply &&
        blocked === 0 &&
        (stage.stagedCounts.historical ?? 0) >= 0;
    const historicalLearnersProtected = (stage.stagedCounts.historical ?? 0) > 0 ||
        stage.transactionReadiness.historicalOnlyTransactions > 0;
    return {
        ...defaults,
        ...partial,
        stageId: stage.stageId,
        stageCreated: true,
        sourceSystem: stage.sourceSystem,
        canApply: stage.canApply,
        validationErrors,
        validationWarnings,
        stagedCounts: { ...stage.stagedCounts },
        transactionReadiness: { ...stage.transactionReadiness },
        dryRunWarnings,
        headCountProtected,
        historicalLearnersProtected,
    };
}
async function hydrateReconciliationSummary(input) {
    const partial = input.reconciliationSummary ?? {};
    const batchId = cleanString(input.batchId) || cleanString(partial.batchId);
    const schoolId = cleanString(input.schoolId);
    if (!batchId) {
        return {
            ...defaultReconciliationSummary(),
            ...partial,
            run: Boolean(partial.run),
        };
    }
    const batch = (0, migrationImportBatchStore_1.getImportBatch)(batchId);
    if (!batch)
        throw new MigrationPilotError("Import batch not found");
    if (batch.targetSchoolId !== schoolId) {
        throw new MigrationPilotError("schoolId does not match this import batch");
    }
    let reconciliation;
    try {
        reconciliation = await (0, reconcileMigrationBatch_1.reconcileMigrationBatch)({ batchId, targetSchoolId: schoolId });
    }
    catch (e) {
        if (e instanceof reconcileMigrationBatch_1.MigrationReconciliationError) {
            throw new MigrationPilotError(e.message);
        }
        throw e;
    }
    const headCheck = reconciliation.checks.find((c) => c.id === "active_learner_head_count");
    const historicalCheck = reconciliation.checks.find((c) => c.id === "historical_excluded_from_head_count");
    const messages = [];
    for (const check of reconciliation.checks) {
        if (check.status === "warning" || check.status === "fail") {
            messages.push(`${check.check}: ${check.message}`);
        }
    }
    return {
        ...defaultReconciliationSummary(),
        ...partial,
        run: true,
        batchId,
        stageId: batch.stageId,
        overallStatus: reconciliation.overallStatus,
        passed: reconciliation.summary.passed,
        warnings: reconciliation.summary.warnings,
        failed: reconciliation.summary.failed,
        total: reconciliation.summary.total,
        headCountProtected: headCheck?.status === "pass",
        historicalLearnersProtected: historicalCheck?.status === "pass",
        reconciledAt: reconciliation.reconciledAt,
        messages,
    };
}
function hasPilotCriticalFailures(input) {
    if (input.validationSummary.errors > 0)
        return true;
    if (!input.validationSummary.canProceed && input.validationSummary.mode === "full") {
        return true;
    }
    if (input.reconciliationSummary.run && input.reconciliationSummary.overallStatus === "fail") {
        return true;
    }
    if (input.reconciliationSummary.run && (input.reconciliationSummary.failed ?? 0) > 0) {
        return true;
    }
    if (input.reconciliationSummary.run &&
        input.reconciliationSummary.headCountProtected === false) {
        return true;
    }
    return false;
}
function isDryRunClean(dryRunSummary) {
    if (!dryRunSummary.stageCreated)
        return false;
    if (!dryRunSummary.canApply)
        return false;
    if (dryRunSummary.validationErrors > 0)
        return false;
    if (dryRunSummary.transactionReadiness.blockedTransactions > 0)
        return false;
    return true;
}
function computeMigrationPilotStatus(input) {
    const critical = hasPilotCriticalFailures(input);
    const dryRunClean = isDryRunClean(input.dryRunSummary);
    const recon = input.reconciliationSummary;
    if (!recon.run) {
        if (critical)
            return "failed";
        if (!dryRunClean)
            return "warning";
        if (input.validationSummary.mode !== "full")
            return "draft";
        return "draft";
    }
    if (critical || recon.overallStatus === "fail")
        return "failed";
    if (recon.overallStatus === "pass" &&
        recon.headCountProtected &&
        recon.historicalLearnersProtected &&
        dryRunClean &&
        !critical) {
        return "passed";
    }
    if (recon.overallStatus === "warning" ||
        (recon.warnings ?? 0) > 0 ||
        recon.messages.length > 0 ||
        !dryRunClean ||
        input.dryRunSummary.dryRunWarnings.length > 0) {
        return "warning";
    }
    if (recon.overallStatus === "pass" && dryRunClean)
        return "passed";
    return "failed";
}
function collectStatusReasons(input) {
    const reasons = [];
    const { validationSummary, dryRunSummary, reconciliationSummary } = input;
    if (validationSummary.errors > 0) {
        reasons.push(`${validationSummary.errors} validation error(s) recorded.`);
    }
    if (validationSummary.mode !== "full") {
        reasons.push("Full validation has not been captured (mode is not full).");
    }
    if (!dryRunSummary.stageCreated) {
        reasons.push("No dry-run stage package linked.");
    }
    else if (!dryRunSummary.canApply) {
        reasons.push("Dry-run stage is not eligible for apply (canApply=false).");
    }
    if (dryRunSummary.transactionReadiness.blockedTransactions > 0) {
        reasons.push(`${dryRunSummary.transactionReadiness.blockedTransactions} blocked transaction(s) in readiness review.`);
    }
    if (!reconciliationSummary.run) {
        reasons.push("Reconciliation has not been run against an import batch.");
    }
    else {
        reasons.push(`Reconciliation overall: ${String(reconciliationSummary.overallStatus ?? "unknown").toUpperCase()}.`);
        if (!reconciliationSummary.headCountProtected) {
            reasons.push("Active learner head count check did not pass.");
        }
        if (!reconciliationSummary.historicalLearnersProtected) {
            reasons.push("Historical learner protection check did not pass.");
        }
    }
    if (input.status === "passed") {
        reasons.push("All pilot gates satisfied: reconciliation PASS, head count protected, dry run clean.");
    }
    return reasons;
}
function hasSignoffForBatch(batchId, schoolId) {
    if (!batchId)
        return false;
    const signoffs = (0, migrationSignoffStore_1.listSignoffs)();
    return signoffs.some((s) => s.batchId === batchId && s.schoolId === schoolId);
}
function buildPilotVerificationChecks(input) {
    const uploadOk = input.uploadedFiles.length > 0;
    const fullValidation = input.validationSummary.mode === "full" &&
        input.validationSummary.canProceed &&
        input.validationSummary.errors === 0;
    const dryRunReviewed = input.dryRunSummary.stageCreated && input.dryRunSummary.validationErrors === 0;
    const transactionReadinessReviewed = input.dryRunSummary.stageCreated &&
        input.dryRunSummary.transactionReadiness.blockedTransactions === 0 &&
        input.dryRunSummary.transactionReadiness.unmatchedTransactions === 0;
    const reconciliationCompleted = input.reconciliationSummary.run && Boolean(input.reconciliationSummary.overallStatus);
    const signoffGenerated = hasSignoffForBatch(input.batchId, input.schoolId);
    const checks = [
        {
            key: "uploadSuccessful",
            label: "Upload successful",
            advisory: true,
            satisfied: uploadOk,
            hint: uploadOk ? undefined : "Attach at least one uploaded export file reference.",
        },
        {
            key: "mappingReviewed",
            label: "Mapping reviewed",
            advisory: true,
            satisfied: Boolean(input.mappingReviewed),
            hint: "Confirm column mappings were reviewed in the Universal Migration upload flow.",
        },
        {
            key: "fullValidationCompleted",
            label: "Full validation completed",
            advisory: true,
            satisfied: fullValidation,
            hint: fullValidation ? undefined : "Run full validation with no blocking errors.",
        },
        {
            key: "dryRunReviewed",
            label: "Dry run reviewed",
            advisory: true,
            satisfied: dryRunReviewed,
            hint: dryRunReviewed ? undefined : "Create and review a dry-run stage package.",
        },
        {
            key: "historicalLearnersProtected",
            label: "Historical learners protected",
            advisory: true,
            satisfied: input.dryRunSummary.historicalLearnersProtected ||
                input.reconciliationSummary.historicalLearnersProtected,
            hint: "Historical learners must be staged separately and excluded from active head count.",
        },
        {
            key: "headCountProtected",
            label: "Head count protected",
            advisory: true,
            satisfied: input.reconciliationSummary.headCountProtected || input.dryRunSummary.headCountProtected,
            hint: "Reconciliation head-count check must pass after apply, or dry-run gates must be clean pre-apply.",
        },
        {
            key: "transactionReadinessReviewed",
            label: "Transaction readiness reviewed",
            advisory: true,
            satisfied: transactionReadinessReviewed,
            hint: "Review blocked and unmatched transactions in the dry-run readiness panel.",
        },
        {
            key: "reconciliationCompleted",
            label: "Reconciliation completed",
            advisory: true,
            satisfied: reconciliationCompleted,
            hint: reconciliationCompleted
                ? undefined
                : "Run batch reconciliation in Import Audit (read-only) and link batchId.",
        },
        {
            key: "signoffGenerated",
            label: "Sign-off generated",
            advisory: true,
            satisfied: signoffGenerated,
            hint: signoffGenerated
                ? undefined
                : "Generate a sign-off pack for the import batch when reconciliation is satisfactory.",
        },
    ];
    return checks;
}
/** Read-only — summarises actual migration pipeline results; no school table writes. */
async function buildMigrationPilot(input) {
    const schoolId = cleanString(input.schoolId);
    const schoolName = cleanString(input.schoolName);
    const sourceSystem = cleanString(input.sourceSystem);
    if (!schoolId)
        throw new MigrationPilotError("schoolId is required");
    if (!schoolName)
        throw new MigrationPilotError("schoolName is required");
    if (!sourceSystem)
        throw new MigrationPilotError("sourceSystem is required");
    const uploadedFiles = Array.isArray(input.uploadedFiles)
        ? input.uploadedFiles.map((f) => ({
            fileId: cleanString(f.fileId),
            filename: cleanString(f.filename),
            category: cleanString(f.category) || "unknown",
            sizeBytes: typeof f.sizeBytes === "number" ? f.sizeBytes : undefined,
        }))
        : [];
    if (uploadedFiles.length === 0) {
        throw new MigrationPilotError("uploadedFiles must include at least one file");
    }
    const validationSummary = hydrateValidationSummary(input);
    const dryRunSummary = hydrateDryRunSummary(input);
    const reconciliationSummary = await hydrateReconciliationSummary(input);
    const status = computeMigrationPilotStatus({
        validationSummary,
        dryRunSummary,
        reconciliationSummary,
    });
    const verificationChecks = buildPilotVerificationChecks({
        uploadedFiles,
        validationSummary,
        dryRunSummary,
        reconciliationSummary,
        batchId: reconciliationSummary.batchId,
        schoolId,
        mappingReviewed: Boolean(input.dryRunSummary?.stageCreated) || dryRunSummary.stageCreated,
    });
    const statusReasons = collectStatusReasons({
        status,
        validationSummary,
        dryRunSummary,
        reconciliationSummary,
    });
    return {
        status,
        validationSummary,
        dryRunSummary,
        reconciliationSummary,
        verificationChecks,
        statusReasons,
    };
}
