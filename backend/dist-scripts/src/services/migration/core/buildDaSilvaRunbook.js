"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DA_SILVA_MANUAL_ONLY_STEP_IDS = void 0;
exports.buildDefaultDaSilvaSteps = buildDefaultDaSilvaSteps;
exports.computeRunbookOverallStatus = computeRunbookOverallStatus;
exports.buildDaSilvaRunbook = buildDaSilvaRunbook;
exports.isManualOnlyRunbookStep = isManualOnlyRunbookStep;
exports.assertValidRunbookStepStatus = assertValidRunbookStepStatus;
/** Steps that must never be auto-marked complete by server logic — operator only. */
exports.DA_SILVA_MANUAL_ONLY_STEP_IDS = new Set([
    "apply_migration_manual",
    "run_reconciliation",
    "generate_signoff_pack",
]);
const DEFAULT_DA_SILVA_STEPS = [
    {
        stepId: "upload_migration_files",
        title: "Upload migration files",
        description: "Upload SA-SAMS class lists, learner register, and parent register plus Kid-e-Sys billing exports (age analysis, billing plan, transactions).",
        required: true,
    },
    {
        stepId: "review_readiness",
        title: "Review readiness guidance",
        description: "Review adapter readiness checklist and export requirements for the selected source system before mapping.",
        required: true,
    },
    {
        stepId: "test_adapter_readiness",
        title: "Test adapter readiness",
        description: "Run adapter readiness test against uploaded sample files; resolve blocking readiness gaps before validation.",
        required: true,
    },
    {
        stepId: "review_mappings",
        title: "Review mappings",
        description: "Confirm SA-SAMS learner/parent columns and Kid-e-Sys billing columns map to EduClear targets; SA-SAMS owns profiles, Kid-e-Sys owns billing only.",
        required: true,
    },
    {
        stepId: "run_validation",
        title: "Run full-file validation",
        description: "Execute full-file validation on all uploaded categories; ensure validation completes without blocking errors.",
        required: true,
    },
    {
        stepId: "review_validation_issues",
        title: "Review validation issues",
        description: "Review validation errors and warnings; document accepted warnings or fix data before staging.",
        required: true,
    },
    {
        stepId: "create_dry_run",
        title: "Create dry run",
        description: "Create a migration stage (dry run) from validated uploads — JSON staging only, no live apply.",
        required: true,
    },
    {
        stepId: "review_transaction_readiness",
        title: "Review transaction readiness",
        description: "Review historical vs active transaction classification, blocked transactions, and unmatched rows.",
        required: true,
    },
    {
        stepId: "review_checklist",
        title: "Review checklist",
        description: "Complete pre-apply migration checklist (head count, historical learners, billing protection).",
        required: true,
    },
    {
        stepId: "create_pilot_record",
        title: "Create pilot record",
        description: "Create a Da Silva pilot validation record linked to stage/batch outputs for audit tracking.",
        required: true,
    },
    {
        stepId: "apply_migration_manual",
        title: "Apply migration (manual only)",
        description: "Apply staged migration to the target school only after explicit operator approval — use Apply Migration in section 6.",
        required: true,
    },
    {
        stepId: "run_reconciliation",
        title: "Run reconciliation",
        description: "Run import batch reconciliation after apply; review pass/warn/fail checks before sign-off.",
        required: true,
    },
    {
        stepId: "generate_signoff_pack",
        title: "Generate sign-off pack",
        description: "Generate migration sign-off pack (validation, batch, reconciliation exports) for stakeholder review.",
        required: true,
    },
    {
        stepId: "final_go_live",
        title: "Final go-live approval",
        description: "Record final Super Admin go-live approval after reconciliation and sign-off review.",
        required: true,
    },
];
function pendingStep(def) {
    return {
        ...def,
        status: "pending",
        notes: "",
    };
}
function buildDefaultDaSilvaSteps() {
    return DEFAULT_DA_SILVA_STEPS.map(pendingStep);
}
function computeRunbookOverallStatus(steps) {
    const required = steps.filter((s) => s.required);
    if (required.length === 0)
        return "in_progress";
    if (required.some((s) => s.status === "blocked")) {
        return "blocked";
    }
    if (required.every((s) => s.status === "completed")) {
        return "completed";
    }
    if (required.every((s) => s.status === "pending")) {
        return "pending";
    }
    return "in_progress";
}
function buildDaSilvaRunbook(input) {
    const steps = buildDefaultDaSilvaSteps();
    return {
        runbookId: input.runbookId,
        schoolId: input.schoolId,
        schoolName: input.schoolName,
        sourceSystem: input.sourceSystem,
        createdAt: input.createdAt,
        steps,
        overallStatus: computeRunbookOverallStatus(steps),
        pilotId: input.pilotId ?? "",
        notes: input.notes ?? "",
    };
}
function isManualOnlyRunbookStep(stepId) {
    return exports.DA_SILVA_MANUAL_ONLY_STEP_IDS.has(stepId);
}
function assertValidRunbookStepStatus(status) {
    return status === "pending" || status === "in_progress" || status === "completed" || status === "blocked";
}
