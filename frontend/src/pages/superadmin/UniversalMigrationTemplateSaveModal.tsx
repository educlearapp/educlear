import { useState } from "react";
import {
  MIGRATION_TEMPLATE_SOURCE_SYSTEMS,
  saveMigrationTemplate,
  type MigrationTemplateMappingRule,
} from "../../superAdmin/utils/universalMigrationTemplates";

type Props = {
  defaultSourceSystem?: string;
  mappings: MigrationTemplateMappingRule[];
  onClose: () => void;
  onSaved: () => void;
};

export default function UniversalMigrationTemplateSaveModal({
  defaultSourceSystem = "",
  mappings,
  onClose,
  onSaved,
}: Props) {
  const [name, setName] = useState("");
  const [sourceSystem, setSourceSystem] = useState(defaultSourceSystem);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !busy) onClose();
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Template name is required.");
      return;
    }
    if (!sourceSystem.trim()) {
      setError("Source system is required.");
      return;
    }
    if (mappings.length === 0) {
      setError("No mapped columns to save. Map at least one column before saving a template.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await saveMigrationTemplate({
        name: name.trim(),
        sourceSystem: sourceSystem.trim(),
        description: description.trim(),
        mappings,
      });
      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save template");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="uc-migration-template-overlay" role="presentation" onClick={handleBackdropClick}>
      <div
        className="uc-migration-template-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="uc-template-save-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="uc-migration-template-modal-accent" aria-hidden="true" />
        <h2 id="uc-template-save-title" className="uc-migration-template-modal-title">
          Save mapping template
        </h2>
        <p className="uc-migration-template-modal-hint">
          Saves column mapping rules only ({mappings.length} rule{mappings.length === 1 ? "" : "s"}). No
          school data or file contents.
        </p>

        <label className="uc-migration-template-field">
          <span className="uc-migration-template-label">Template name</span>
          <input
            type="text"
            className="uc-migration-template-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            placeholder="e.g. Kid-e-Sys class list — learners"
          />
        </label>

        <label className="uc-migration-template-field">
          <span className="uc-migration-template-label">Source system</span>
          <select
            className="uc-migration-template-input"
            value={sourceSystem}
            onChange={(e) => setSourceSystem(e.target.value)}
            disabled={busy}
          >
            <option value="">— Select source —</option>
            {MIGRATION_TEMPLATE_SOURCE_SYSTEMS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="uc-migration-template-field">
          <span className="uc-migration-template-label">Description (optional)</span>
          <textarea
            className="uc-migration-template-input uc-migration-template-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            rows={3}
            placeholder="Notes for future migrations using this template"
          />
        </label>

        {error ? (
          <p className="uc-migration-template-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="uc-migration-template-modal-actions">
          <button
            type="button"
            className="uc-migration-template-btn uc-migration-template-btn--gold"
            onClick={() => void handleSave()}
            disabled={busy}
          >
            {busy ? "Saving…" : "Save template"}
          </button>
          <button
            type="button"
            className="uc-migration-template-btn uc-migration-template-btn--ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
