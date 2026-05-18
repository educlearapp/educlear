import type { MigrationActionId } from "../../types/migration";

type Action = {
  id: MigrationActionId;
  label: string;
  variant: "gold" | "outline";
};

const ACTIONS: Action[] = [
  { id: "createProject", label: "Create Migration Project", variant: "gold" },
  { id: "validateFiles", label: "Validate Files", variant: "outline" },
  { id: "importStaging", label: "Import to Staging", variant: "outline" },
  { id: "finalImport", label: "Final Import", variant: "gold" },
  { id: "downloadTemplate", label: "Download Import Template", variant: "outline" },
];

type Props = {
  onAction: (actionId: MigrationActionId) => void;
};

export default function MigrationActions({ onAction }: Props) {
  return (
    <section className="sa-migration-section sa-migration-section--actions">
      <h2 className="sa-migration-section-title">7. Migration Actions</h2>
      <div className="sa-migration-actions-bar">
        {ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            className={`sa-migration-btn sa-migration-btn--${action.variant}`}
            onClick={() => onAction(action.id)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}
