import {
  MIGRATION_CHECKLIST_LABELS,
  MIGRATION_CHECKLIST_MANUAL_KEYS,
  type MigrationChecklist,
  type MigrationChecklistItemKey,
  type MigrationTransactionReadinessGate,
} from "../../superAdmin/utils/migrationChecklist";

export type MigrationManualChecklistState = {
  warningsReviewed: boolean;
  mappingsReviewed: boolean;
  backupConfirmed: boolean;
  proceedWithEligibleActiveTransactionsOnly: boolean;
  finalConfirmationAccepted: boolean;
};

type Props = {
  checklist: MigrationChecklist;
  manualChecked: MigrationManualChecklistState;
  onManualChange: (key: keyof MigrationManualChecklistState, checked: boolean) => void;
  transactionGate?: MigrationTransactionReadinessGate | null;
};

const ORDER: MigrationChecklistItemKey[] = [
  "targetSchoolConfirmed",
  "fullValidationPassed",
  "dryRunCreated",
  "warningsReviewed",
  "mappingsReviewed",
  "backupConfirmed",
  "proceedWithEligibleActiveTransactionsOnly",
  "finalConfirmationAccepted",
];

export default function UniversalMigrationReadinessChecklist({
  checklist,
  manualChecked,
  onManualChange,
  transactionGate,
}: Props) {
  const needsProceedOverride =
    Boolean(transactionGate?.hasTransactionFiles) &&
    ((transactionGate?.blockedTransactions ?? 0) > 0 ||
      (transactionGate?.unmatchedTransactions ?? 0) > 0);
  return (
    <section
      className="uc-migration-readiness"
      aria-labelledby="migration-readiness-heading"
    >
      <h3 id="migration-readiness-heading" className="uc-migration-validation-section-title">
        Migration Readiness Checklist
      </h3>
      <ul className="uc-migration-readiness-list">
        {ORDER.map((key) => {
          const done = checklist.items[key];
          const isManual = (MIGRATION_CHECKLIST_MANUAL_KEYS as readonly string[]).includes(key);
          const manualKey = key as keyof MigrationManualChecklistState;
          return (
            <li
              key={key}
              className={`uc-migration-readiness-item${done ? " uc-migration-readiness-item--done" : ""}`}
            >
              {isManual ? (
                <label className="uc-migration-readiness-label">
                  <input
                    type="checkbox"
                    checked={
                      key === "proceedWithEligibleActiveTransactionsOnly"
                        ? done
                        : manualChecked[manualKey]
                    }
                    onChange={(e) => onManualChange(manualKey, e.target.checked)}
                    disabled={
                      key === "proceedWithEligibleActiveTransactionsOnly" &&
                      !needsProceedOverride &&
                      Boolean(transactionGate?.hasTransactionFiles)
                    }
                  />
                  <span className="uc-migration-readiness-check" aria-hidden="true">
                    {done ? "✓" : "○"}
                  </span>
                  <span>{MIGRATION_CHECKLIST_LABELS[key]}</span>
                </label>
              ) : (
                <span className="uc-migration-readiness-auto">
                  <span className="uc-migration-readiness-check" aria-hidden="true">
                    {done ? "✓" : "○"}
                  </span>
                  <span>{MIGRATION_CHECKLIST_LABELS[key]}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="uc-migration-readiness-ready">
        Ready for Apply:{" "}
        <strong
          className={
            checklist.readyForApply
              ? "uc-migration-readiness-ready--yes"
              : "uc-migration-readiness-ready--no"
          }
        >
          {checklist.readyForApply ? "YES" : "NO"}
        </strong>
        <span className="uc-migration-readiness-progress">
          ({checklist.completedItems}/{checklist.totalItems} complete)
        </span>
      </p>
    </section>
  );
}
