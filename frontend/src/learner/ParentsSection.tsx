import { useMemo, useState } from "react";
import ParentFormPanel from "./ParentFormPanel";
import type { ParentRecord } from "./parentFormTypes";
import {
  emptyParentDraft,
  normalizeParentRecord,
  parentDisplayName,
  parentToApiPayload,
  validateParentForSave,
} from "./parentFormUtils";

export type ParentsSectionProps = {
  parents: ParentRecord[];
  onChange: (parents: ParentRecord[]) => void;
  schoolParents?: ParentRecord[];
  defaultSurname?: string;
  onSendEmail?: (parent: ParentRecord) => void;
  onSendSms?: (parent: ParentRecord) => void;
  onPersistParent?: (parent: ParentRecord) => Promise<ParentRecord | void>;
  className?: string;
};

type ParentMode = "none" | "add" | "existing" | "manage";

export default function ParentsSection({
  parents,
  onChange,
  schoolParents = [],
  defaultSurname = "",
  onSendEmail,
  onSendSms,
  onPersistParent,
  className = "",
}: ParentsSectionProps) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [parentMode, setParentMode] = useState<ParentMode>("none");
  const [parentDraft, setParentDraft] = useState<ParentRecord>(emptyParentDraft());
  const [existingPickId, setExistingPickId] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedParent = useMemo(
    () => parents.find((p) => String(p.id || "") === String(selectedId)) || null,
    [parents, selectedId]
  );

  const startAdd = () => {
    setParentMode("add");
    setSelectedId("");
    setParentDraft(
      emptyParentDraft({
        surname: defaultSurname,
        isPrimary: parents.length === 0,
      })
    );
  };

  const startManage = () => {
    if (!selectedParent) {
      window.alert("Please select a parent from the list first.");
      return;
    }
    setParentMode("manage");
    setParentDraft({ ...selectedParent });
  };

  const startExisting = () => {
    setParentMode("existing");
    setExistingPickId("");
  };

  const cancelForm = () => {
    setParentMode("none");
    setParentDraft(emptyParentDraft());
    setExistingPickId("");
  };

  const commitParent = async () => {
    const err = validateParentForSave(parentDraft);
    if (err) {
      window.alert(err);
      return;
    }

    setSaving(true);
    try {
      let saved = { ...parentDraft };
      if (onPersistParent) {
        const result = await onPersistParent(parentDraft);
        if (result) saved = normalizeParentRecord(result as Record<string, unknown>);
        if (parentMode === "manage" && selectedParent) {
          setSelectedId(String(saved.id || selectedParent.id || ""));
        } else if (parentMode === "add") {
          setSelectedId(String(saved.id || ""));
        }
        cancelForm();
        return;
      }

      if (parentMode === "add") {
        const id = saved.id || `local-parent-${Date.now()}`;
        const row = { ...saved, id };
        onChange([...parents, row]);
        setSelectedId(String(id));
      } else if (parentMode === "manage" && selectedParent) {
        const id = selectedParent.id || saved.id;
        const row = { ...saved, id };
        onChange(parents.map((p) => (String(p.id) === String(id) ? row : p)));
        setSelectedId(String(id));
      }
      cancelForm();
    } finally {
      setSaving(false);
    }
  };

  const linkExisting = () => {
    const found = schoolParents.find((p) => String(p.id) === String(existingPickId));
    if (!found) {
      window.alert("Please select an existing parent first.");
      return;
    }
    const normalized = normalizeParentRecord(found as Record<string, unknown>);
    if (parents.some((p) => String(p.id) === String(normalized.id))) {
      window.alert("This parent is already linked.");
      return;
    }
    onChange([...parents, { ...normalized, isPrimary: parents.length === 0 }]);
    setSelectedId(String(normalized.id || ""));
    cancelForm();
  };

  const removeSelected = () => {
    if (!selectedParent) {
      window.alert("Please select a parent first.");
      return;
    }
    const ok = window.confirm("Remove this parent from the learner?");
    if (!ok) return;
    onChange(parents.filter((p) => String(p.id) !== String(selectedParent.id)));
    setSelectedId("");
    setParentMode("none");
  };

  const deleteSelected = () => {
    removeSelected();
  };

  const formTitle =
    parentMode === "add"
      ? "Add Parent"
      : parentMode === "manage"
        ? "Manage Parent"
        : parentMode === "existing"
          ? "Add Existing Parent"
          : "";

  return (
    <section className={`add-learner-card ${className}`.trim()} aria-labelledby="parents-section-heading">
      <div className="add-learner-section-header">
        <div className="add-learner-section-header-main">
          <span className="add-learner-section-accent" aria-hidden="true" />
          <h2 id="parents-section-heading" className="add-learner-section-title">
            Parents
          </h2>
          <span className="parents-section__count">{parents.length} linked</span>
        </div>
      </div>

      <div className="parents-section__toolbar">
        <button type="button" className="add-learner-btn add-learner-btn--gold-outline" onClick={startAdd}>
          Add Parent
        </button>
        <button type="button" className="add-learner-btn add-learner-btn--gold-outline" onClick={startExisting}>
          Add Existing Parent
        </button>
        <button type="button" className="add-learner-btn add-learner-btn--secondary" onClick={startManage}>
          Manage
        </button>
        <button type="button" className="add-learner-btn add-learner-btn--secondary" onClick={removeSelected}>
          Remove
        </button>
        <div className="parents-section__more-wrap">
          <button
            type="button"
            className="add-learner-btn add-learner-btn--outline"
            onClick={() => setMoreOpen((o) => !o)}
          >
            More Actions ▾
          </button>
          {moreOpen && (
            <div className="parents-section__more-menu">
              <button
                type="button"
                disabled={!selectedParent}
                onClick={() => {
                  setMoreOpen(false);
                  if (selectedParent && onSendEmail) onSendEmail(selectedParent);
                  else window.alert("Select a parent with an email address first.");
                }}
              >
                Send Email
              </button>
              <button
                type="button"
                disabled={!selectedParent}
                onClick={() => {
                  setMoreOpen(false);
                  if (selectedParent && onSendSms) onSendSms(selectedParent);
                  else window.alert("Select a parent with a cell number first.");
                }}
              >
                Send SMS
              </button>
              <button
                type="button"
                className="parents-section__more-danger"
                disabled={!selectedParent}
                onClick={() => {
                  setMoreOpen(false);
                  deleteSelected();
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {parentMode !== "none" && (
        <div className="parents-section__form-wrap">
          {parentMode === "existing" ? (
            <div className="parents-section__existing">
              <label className="add-learner-label">Select existing parent</label>
              <div className="parents-section__existing-row">
                <select
                  className="add-learner-select parents-section__existing-select"
                  value={existingPickId}
                  onChange={(e) => setExistingPickId(e.target.value)}
                >
                  <option value="">Choose a parent…</option>
                  {schoolParents.map((p, idx) => (
                    <option key={p.id || idx} value={p.id || ""}>
                      {parentDisplayName(p)} — {p.cellNo || p.cell || "no cell"}
                      {p.email ? ` — ${p.email}` : ""}
                    </option>
                  ))}
                </select>
                <button type="button" className="add-learner-btn add-learner-btn--save" onClick={linkExisting}>
                  Link Selected Parent
                </button>
                <button type="button" className="add-learner-btn add-learner-btn--outline" onClick={cancelForm}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <ParentFormPanel
              draft={parentDraft}
              onChange={setParentDraft}
              formTitle={formTitle}
              onSave={() => void commitParent()}
              onCancel={cancelForm}
              saving={saving}
            />
          )}
        </div>
      )}

      <div className="parents-section__table-wrap">
        <table className="parents-section__table">
          <thead>
            <tr>
              <th>Relationship</th>
              <th>Name</th>
              <th>Surname</th>
              <th>ID Number</th>
              <th>Cell</th>
              <th>Email</th>
              <th>Work</th>
            </tr>
          </thead>
          <tbody>
            {parents.length === 0 ? (
              <tr>
                <td colSpan={7} className="parents-section__empty">
                  No parents linked yet. Use Add Parent to capture full contact details.
                </td>
              </tr>
            ) : (
              parents.map((parent, index) => {
                const isSelected = String(selectedId) === String(parent.id || index);
                return (
                  <tr
                    key={parent.id || parent.idNumber || parent.email || index}
                    className={isSelected ? "parents-section__row--selected" : ""}
                    onClick={() => {
                      setSelectedId(String(parent.id || index));
                      setParentMode("none");
                    }}
                  >
                    <td>{parent.relationship || "—"}</td>
                    <td>{parent.firstName || "—"}</td>
                    <td>{parent.surname || "—"}</td>
                    <td>{parent.idNumber || "—"}</td>
                    <td>{parent.cellNo || parent.cell || parent.phone || "—"}</td>
                    <td>{parent.email || "—"}</td>
                    <td>{parent.workNo || parent.work || "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export { parentToApiPayload };
