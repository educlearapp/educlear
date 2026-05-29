"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIGRATION_CHECKLIST_ITEM_KEYS = void 0;
exports.buildMigrationChecklist = buildMigrationChecklist;
exports.MIGRATION_CHECKLIST_ITEM_KEYS = [
    "targetSchoolConfirmed",
    "fullValidationPassed",
    "dryRunCreated",
    "warningsReviewed",
    "mappingsReviewed",
    "backupConfirmed",
    "proceedWithEligibleActiveTransactionsOnly",
    "finalConfirmationAccepted",
];
function buildMigrationChecklist(items) {
    const totalItems = exports.MIGRATION_CHECKLIST_ITEM_KEYS.length;
    const completedItems = exports.MIGRATION_CHECKLIST_ITEM_KEYS.filter((key) => items[key]).length;
    const readyForApply = completedItems === totalItems;
    return {
        items,
        completedItems,
        totalItems,
        readyForApply,
    };
}
