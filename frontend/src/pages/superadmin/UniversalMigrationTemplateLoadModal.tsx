import { useCallback, useEffect, useState } from "react";
import {
  fetchMigrationTemplates,
  type MigrationMappingTemplate,
} from "../../superAdmin/utils/universalMigrationTemplates";

type Props = {
  onClose: () => void;
  onApply: (template: MigrationMappingTemplate) => void;
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function UniversalMigrationTemplateLoadModal({ onClose, onApply }: Props) {
  const [templates, setTemplates] = useState<MigrationMappingTemplate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const list = await fetchMigrationTemplates();
      setTemplates(list);
      setSelectedId((prev) => {
        if (prev && list.some((t) => t.id === prev)) return prev;
        return list[0]?.id ?? "";
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load templates");
      setTemplates([]);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const selected = templates.find((t) => t.id === selectedId);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !busy) onClose();
  };

  const handleApply = () => {
    if (!selected) {
      setError("Select a template to apply.");
      return;
    }
    onApply(selected);
    onClose();
  };

  return (
    <div className="uc-migration-template-overlay" role="presentation" onClick={handleBackdropClick}>
      <div
        className="uc-migration-template-modal uc-migration-template-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="uc-template-load-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="uc-migration-template-modal-accent" aria-hidden="true" />
        <h2 id="uc-template-load-title" className="uc-migration-template-modal-title">
          Load mapping template
        </h2>
        <p className="uc-migration-template-modal-hint">
          Applies saved rules to the current upload by matching source column names. Columns without a
          match stay on auto-suggestions and show as Needs review.
        </p>

        {busy ? (
          <p className="uc-migration-template-loading" aria-live="polite">
            Loading templates…
          </p>
        ) : templates.length === 0 ? (
          <p className="uc-migration-template-empty">No saved templates yet. Save one from the mapping section.</p>
        ) : (
          <div className="uc-migration-template-list-wrap">
            <ul className="uc-migration-template-list" role="listbox" aria-label="Saved mapping templates">
              {templates.map((template) => {
                const isSelected = template.id === selectedId;
                return (
                  <li key={template.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`uc-migration-template-list-item${isSelected ? " uc-migration-template-list-item--selected" : ""}`}
                      onClick={() => setSelectedId(template.id)}
                    >
                      <span className="uc-migration-template-list-name">{template.name}</span>
                      <span className="uc-migration-template-list-meta">
                        {template.sourceSystem} · {template.mappings.length} rule
                        {template.mappings.length === 1 ? "" : "s"} · {formatDate(template.updatedAt)}
                      </span>
                      {template.description ? (
                        <span className="uc-migration-template-list-desc">{template.description}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>

            {selected ? (
              <div className="uc-migration-template-preview">
                <h3 className="uc-migration-template-preview-title">Selected rules</h3>
                <ul className="uc-migration-template-preview-rules">
                  {selected.mappings.slice(0, 12).map((rule) => (
                    <li key={`${rule.sourceColumn}-${rule.targetField}`}>
                      <span className="uc-migration-template-rule-source">{rule.sourceColumn}</span>
                      <span className="uc-migration-template-rule-arrow" aria-hidden="true">
                        →
                      </span>
                      <span className="uc-migration-template-rule-target">{rule.targetField}</span>
                    </li>
                  ))}
                  {selected.mappings.length > 12 ? (
                    <li className="uc-migration-template-preview-more">
                      +{selected.mappings.length - 12} more rules
                    </li>
                  ) : null}
                </ul>
              </div>
            ) : null}
          </div>
        )}

        {error ? (
          <p className="uc-migration-template-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="uc-migration-template-modal-actions">
          <button
            type="button"
            className="uc-migration-template-btn uc-migration-template-btn--gold"
            onClick={handleApply}
            disabled={busy || templates.length === 0}
          >
            Apply to current files
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
