import type {
  MigrationRunbook,
  MigrationRunbookOverallStatus,
  MigrationRunbookStep,
  MigrationRunbookStepStatus,
} from "../types/MigrationRunbook";

export const MIGRATION_MANUAL_ONLY_STEP_IDS = new Set([
  "apply_migration_manual",
  "run_reconciliation",
  "generate_signoff_pack",
]);

const DEFAULT_MIGRATION_STEPS: Array<
  Pick<MigrationRunbookStep, "stepId" | "title" | "description" | "required">
> = [
  {
    stepId: "upload_migration_files",
    title: "Upload migration files",
    description:
      "Upload the export files supplied for this school and source system only.",
    required: true,
  },
  {
    stepId: "review_readiness",
    title: "Review readiness guidance",
    description:
      "Review adapter readiness checklist and export requirements for the selected source system before mapping.",
    required: true,
  },
  {
    stepId: "test_adapter_readiness",
    title: "Test adapter readiness",
    description:
      "Run adapter readiness test against uploaded sample files; resolve blocking readiness gaps before validation.",
    required: true,
  },
  {
    stepId: "review_mappings",
    title: "Review mappings",
    description:
      "Confirm uploaded source columns map to EduClear learner, parent, billing, transaction, and staff targets.",
    required: true,
  },
  {
    stepId: "run_validation",
    title: "Run full-file validation",
    description:
      "Execute full-file validation on all uploaded categories; ensure validation completes without blocking errors.",
    required: true,
  },
  {
    stepId: "review_validation_issues",
    title: "Review validation issues",
    description:
      "Review validation errors and warnings; document accepted warnings or fix data before staging.",
    required: true,
  },
  {
    stepId: "create_dry_run",
    title: "Create dry run",
    description:
      "Create a migration stage from validated uploads. This writes a dry-run package only, not live school data.",
    required: true,
  },
  {
    stepId: "review_transaction_readiness",
    title: "Review transaction readiness",
    description:
      "Review historical vs active transaction classification, blocked transactions, and unmatched rows.",
    required: true,
  },
  {
    stepId: "review_checklist",
    title: "Review checklist",
    description:
      "Complete pre-apply migration checklist, including backups, warnings, mappings, and transaction readiness.",
    required: true,
  },
  {
    stepId: "create_pilot_record",
    title: "Create pilot record",
    description:
      "Create a pilot validation record linked to stage and batch outputs for audit tracking.",
    required: true,
  },
  {
    stepId: "apply_migration_manual",
    title: "Apply migration (manual only)",
    description:
      "Apply staged migration to the target school only after explicit operator approval.",
    required: true,
  },
  {
    stepId: "run_reconciliation",
    title: "Run reconciliation",
    description:
      "Run import batch reconciliation after apply; review pass, warning, and fail checks before sign-off.",
    required: true,
  },
  {
    stepId: "generate_signoff_pack",
    title: "Generate sign-off pack",
    description:
      "Generate migration sign-off pack with validation, batch, and reconciliation exports for stakeholder review.",
    required: true,
  },
  {
    stepId: "final_go_live",
    title: "Final go-live approval",
    description:
      "Record final Super Admin go-live approval after reconciliation and sign-off review.",
    required: true,
  },
];

function pendingStep(
  def: Pick<MigrationRunbookStep, "stepId" | "title" | "description" | "required">
): MigrationRunbookStep {
  return {
    ...def,
    status: "pending",
    notes: "",
  };
}

export function buildDefaultMigrationSteps(): MigrationRunbookStep[] {
  return DEFAULT_MIGRATION_STEPS.map(pendingStep);
}

export function computeRunbookOverallStatus(
  steps: MigrationRunbookStep[]
): MigrationRunbookOverallStatus {
  const required = steps.filter((s) => s.required);
  if (required.length === 0) return "in_progress";
  if (required.some((s) => s.status === "blocked")) return "blocked";
  if (required.every((s) => s.status === "completed")) return "completed";
  if (required.every((s) => s.status === "pending")) return "pending";
  return "in_progress";
}

export function buildMigrationRunbook(input: {
  runbookId: string;
  schoolId: string;
  schoolName: string;
  sourceSystem: string;
  createdAt: string;
  pilotId?: string;
  notes?: string;
}): MigrationRunbook {
  const steps = buildDefaultMigrationSteps();
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

export function isManualOnlyRunbookStep(stepId: string): boolean {
  return MIGRATION_MANUAL_ONLY_STEP_IDS.has(stepId);
}

export function assertValidRunbookStepStatus(status: string): status is MigrationRunbookStepStatus {
  return status === "pending" || status === "in_progress" || status === "completed" || status === "blocked";
}
