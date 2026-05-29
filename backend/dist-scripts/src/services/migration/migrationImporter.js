"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrationImport = runMigrationImport;
exports.dryRunResultToImportGate = dryRunResultToImportGate;
const applyMigrationStage_1 = require("./core/applyMigrationStage");
const migrationStageStore_1 = require("./staging/migrationStageStore");
const migrationSchoolBackup_1 = require("./migrationSchoolBackup");
const migrationAudit_1 = require("./migrationAudit");
const migrationProjectPaths_1 = require("./migrationProjectPaths");
async function runMigrationImport(input) {
    const manifest = (0, migrationProjectPaths_1.loadMigrationProjectManifest)(input.schoolId, input.projectId);
    if (!manifest) {
        throw new Error(`Migration project not found: ${input.projectId}`);
    }
    if (!input.confirmDryRunPassed && manifest.lastDryRunPassed !== true) {
        throw new Error("Dry run must pass before import. Run dry run and fix validation errors first.");
    }
    if (manifest.lastDryRunId && manifest.lastDryRunId !== input.stageId) {
        throw new Error(`Stage ${input.stageId} does not match last passed dry run (${manifest.lastDryRunId}). Re-run dry run.`);
    }
    const stage = (0, migrationStageStore_1.getStage)(input.stageId);
    if (!stage) {
        throw new Error(`Dry run stage not found: ${input.stageId}`);
    }
    if (!stage.canApply) {
        throw new applyMigrationStage_1.MigrationApplyError("Stage validation did not pass — cannot apply. Re-run dry run after fixing issues.");
    }
    const backupPath = await (0, migrationSchoolBackup_1.createMigrationSchoolBackup)(input.schoolId, input.projectId);
    const apply = await (0, applyMigrationStage_1.applyMigrationStage)({
        stageId: input.stageId,
        targetSchoolId: input.schoolId,
        confirmationText: "CONFIRM",
        proceedWithEligibleActiveOnly: input.proceedWithEligibleActiveOnly ?? false,
    });
    const audit = await (0, migrationAudit_1.buildPostImportAudit)({
        schoolId: input.schoolId,
        projectId: input.projectId,
        batchId: apply.batchId,
        apply,
    });
    (0, migrationProjectPaths_1.saveMigrationProjectManifest)({
        ...manifest,
        lastImportBatchId: apply.batchId,
    });
    return {
        projectId: input.projectId,
        schoolId: input.schoolId,
        source: stage.sourceSystem || "unknown",
        batchId: apply.batchId,
        backupPath,
        apply,
        auditPath: `uploads/migration-staging/${input.schoolId}/${input.projectId}/audits/post-import-${apply.batchId}.json`,
    };
}
function dryRunResultToImportGate(dryRun) {
    return {
        canImport: dryRun.passed && dryRun.stage.canApply,
        stageId: dryRun.dryRunId,
        errors: dryRun.validation.blockingErrors,
    };
}
