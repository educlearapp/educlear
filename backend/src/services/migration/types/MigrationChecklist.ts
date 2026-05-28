export type MigrationChecklistItemKey =
  | "targetSchoolConfirmed"
  | "fullValidationPassed"
  | "dryRunCreated"
  | "warningsReviewed"
  | "mappingsReviewed"
  | "backupConfirmed"
  | "proceedWithEligibleActiveTransactionsOnly"
  | "finalConfirmationAccepted";

export const MIGRATION_CHECKLIST_ITEM_KEYS: MigrationChecklistItemKey[] = [
  "targetSchoolConfirmed",
  "fullValidationPassed",
  "dryRunCreated",
  "warningsReviewed",
  "mappingsReviewed",
  "backupConfirmed",
  "proceedWithEligibleActiveTransactionsOnly",
  "finalConfirmationAccepted",
];

export type MigrationChecklistItems = Record<MigrationChecklistItemKey, boolean>;

export type MigrationChecklist = {
  items: MigrationChecklistItems;
  completedItems: number;
  totalItems: number;
  readyForApply: boolean;
};

export function buildMigrationChecklist(items: MigrationChecklistItems): MigrationChecklist {
  const totalItems = MIGRATION_CHECKLIST_ITEM_KEYS.length;
  const completedItems = MIGRATION_CHECKLIST_ITEM_KEYS.filter((key) => items[key]).length;
  const readyForApply = completedItems === totalItems;
  return {
    items,
    completedItems,
    totalItems,
    readyForApply,
  };
}
