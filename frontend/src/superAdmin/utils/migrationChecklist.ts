import type { MigrationValidationSummary } from "./universalMigrationValidate";

export type MigrationChecklistItemKey =
  | "targetSchoolConfirmed"
  | "fullValidationPassed"
  | "dryRunCreated"
  | "warningsReviewed"
  | "mappingsReviewed"
  | "backupConfirmed"
  | "proceedWithEligibleActiveTransactionsOnly"
  | "finalConfirmationAccepted";

export const MIGRATION_CHECKLIST_LABELS: Record<MigrationChecklistItemKey, string> = {
  targetSchoolConfirmed: "Target school confirmed",
  fullValidationPassed: "Full-file validation passed",
  dryRunCreated: "Dry run created",
  warningsReviewed: "Warnings reviewed",
  mappingsReviewed: "Mappings reviewed",
  backupConfirmed: "Backup confirmed",
  proceedWithEligibleActiveTransactionsOnly:
    "Proceed with eligible active transactions only; leave blocked/unmatched transactions unapplied.",
  finalConfirmationAccepted: "Final confirmation accepted",
};

export const MIGRATION_CHECKLIST_MANUAL_KEYS: MigrationChecklistItemKey[] = [
  "warningsReviewed",
  "mappingsReviewed",
  "backupConfirmed",
  "proceedWithEligibleActiveTransactionsOnly",
  "finalConfirmationAccepted",
];

export type MigrationTransactionReadinessGate = {
  hasTransactionFiles: boolean;
  blockedTransactions: number;
  unmatchedTransactions: number;
  cutoverDate?: string | null;
};

export type MigrationChecklistItems = Record<MigrationChecklistItemKey, boolean>;

export type MigrationChecklist = {
  items: MigrationChecklistItems;
  completedItems: number;
  totalItems: number;
  readyForApply: boolean;
};

export type MigrationChecklistAutoInput = {
  targetSchoolId: string;
  stageSelected: boolean;
  validationSummary: MigrationValidationSummary | null;
  transactionGate?: MigrationTransactionReadinessGate | null;
};

export function buildMigrationChecklist(
  auto: MigrationChecklistAutoInput,
  manual: Pick<
    MigrationChecklistItems,
    | "warningsReviewed"
    | "mappingsReviewed"
    | "backupConfirmed"
    | "proceedWithEligibleActiveTransactionsOnly"
    | "finalConfirmationAccepted"
  >
): MigrationChecklist {
  const fullValidationPassed = Boolean(
    auto.validationSummary &&
      auto.validationSummary.mode === "full" &&
      auto.validationSummary.canProceed &&
      auto.validationSummary.errors === 0
  );

  const gate = auto.transactionGate;
  const hasTx = Boolean(gate?.hasTransactionFiles);
  const needsProceedOverride =
    hasTx &&
    ((gate?.blockedTransactions ?? 0) > 0 || (gate?.unmatchedTransactions ?? 0) > 0);
  const cutoverOk = !hasTx || Boolean(String(gate?.cutoverDate || "").trim());
  const proceedAutoOk = !needsProceedOverride && cutoverOk;

  const items: MigrationChecklistItems = {
    targetSchoolConfirmed: Boolean(auto.targetSchoolId.trim()),
    fullValidationPassed,
    dryRunCreated: auto.stageSelected,
    warningsReviewed: manual.warningsReviewed,
    mappingsReviewed: manual.mappingsReviewed,
    backupConfirmed: manual.backupConfirmed,
    proceedWithEligibleActiveTransactionsOnly:
      proceedAutoOk || manual.proceedWithEligibleActiveTransactionsOnly,
    finalConfirmationAccepted: manual.finalConfirmationAccepted,
  };

  const keys = Object.keys(items) as MigrationChecklistItemKey[];
  const completedItems = keys.filter((key) => items[key]).length;

  return {
    items,
    completedItems,
    totalItems: keys.length,
    readyForApply: completedItems === keys.length,
  };
}
