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
  { id: "rollbackImport", label: "Rollback Last Import", variant: "outline" },
  { id: "repairClassrooms", label: "Repair Classroom Names", variant: "outline" },
];

type Props = {
  onAction: (actionId: MigrationActionId) => void;
  busy?: boolean;
  validateUploadProgress?: number | null;
  validateUploadPhase?: "idle" | "uploading" | "validating";
};

export default function MigrationActions({
  onAction,
  busy = false,
  validateUploadProgress = null,
  validateUploadPhase = "idle",
}: Props) {
  const uploadActive = validateUploadPhase !== "idle";
  const progressValue =
    validateUploadPhase === "validating" ? 100 : validateUploadProgress ?? 0;

  return (
    <section className="sa-migration-section sa-migration-section--actions">
      <h2 className="sa-migration-section-title">7. Migration Actions</h2>
      {uploadActive ? (
        <div className="sa-migration-upload-status" role="status" aria-live="polite">
          <p className="sa-migration-upload-status-label">
            {validateUploadPhase === "validating"
              ? "Upload complete — validating Kid-e-Sys exports…"
              : "Uploading Kid-e-Sys exports… keep this tab open."}
          </p>
          <div className="sa-migration-upload-progress" aria-hidden="true">
            <div
              className="sa-migration-upload-progress-fill"
              style={{ width: `${progressValue}%` }}
            />
          </div>
        </div>
      ) : null}
      <div className="sa-migration-actions-bar">
        {ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            className={`sa-migration-btn sa-migration-btn--${action.variant}`}
            disabled={busy || uploadActive}
            onClick={() => onAction(action.id)}
          >
            {action.id === "validateFiles" && uploadActive
              ? validateUploadPhase === "validating"
                ? "Validating…"
                : `Uploading… ${progressValue}%`
              : action.label}
          </button>
        ))}
      </div>
    </section>
  );
}
