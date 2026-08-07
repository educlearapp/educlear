import { useEffect, useMemo, useState } from "react";
import ParentFormPanel from "./ParentFormPanel";
import type { ParentRecord } from "./parentFormTypes";
import {
  emptyParentDraft,
  normalizeParentRecord,
  parentDisplayName,
  parentToApiPayload,
  validateParentForSave,
} from "./parentFormUtils";
import {
  canViewExistingParentConflict,
  existingParentDisplayName,
  fetchParentIdOwnership,
  ParentIdConflictClientError,
  PARENT_ID_CONFLICT_MESSAGE,
  PossibleParentMatchClientError,
  type ExistingParentConflict,
  type PossibleParentMatchPayload,
} from "./parentIdConflict";

export type ParentsSectionProps = {
  parents: ParentRecord[];
  onChange: (parents: ParentRecord[]) => void;
  schoolParents?: ParentRecord[];
  defaultSurname?: string;
  onSendEmail?: (parent: ParentRecord) => void;
  onSendSms?: (parent: ParentRecord) => void;
  onPersistParent?: (
    parent: ParentRecord,
    opts?: { confirmCreateDespiteMatch?: boolean }
  ) => Promise<ParentRecord | void>;
  /** Owner/Admin: open the learner profile that owns the conflicting parent ID. */
  onViewExistingParent?: (existing: ExistingParentConflict) => void | Promise<void>;
  /** Owner/Admin: link existing Parent to this learner via dedicated API. */
  onLinkExistingParent?: (existing: ExistingParentConflict) => void | Promise<void>;
  learnerId?: string;
  schoolId?: string;
  /** Notify host when Manage/Add Parent form has an unsaved typed ID. */
  onUnsavedParentIdEditChange?: (state: {
    active: boolean;
    draftIdNumber: string;
    parentId?: string;
  }) => void;
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
  onViewExistingParent,
  onLinkExistingParent,
  learnerId,
  schoolId,
  onUnsavedParentIdEditChange,
  className = "",
}: ParentsSectionProps) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [parentMode, setParentMode] = useState<ParentMode>("none");
  const [parentDraft, setParentDraft] = useState<ParentRecord>(emptyParentDraft());
  const [existingPickId, setExistingPickId] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const pending = String(localStorage.getItem("selectedParentIdForManage") || "").trim();
    if (!pending) return;
    const match = parents.find((p) => String(p.id || "") === pending);
    if (!match) return;
    setSelectedId(String(match.id));
    setParentMode("manage");
    setParentDraft({ ...match });
    localStorage.removeItem("selectedParentIdForManage");
  }, [parents]);

  useEffect(() => {
    if (!onUnsavedParentIdEditChange) return;
    const active = parentMode === "add" || parentMode === "manage";
    onUnsavedParentIdEditChange({
      active,
      draftIdNumber: active ? (parentDraft.idNumber || "").trim() : "",
      parentId: parentDraft.id,
    });
  }, [parentMode, parentDraft, onUnsavedParentIdEditChange]);

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

  const presentIdConflict = async (existing: ExistingParentConflict | null, message?: string) => {
    window.alert(message || PARENT_ID_CONFLICT_MESSAGE);
    if (
      canViewExistingParentConflict() &&
      existing?.primaryLearnerId &&
      onViewExistingParent
    ) {
      const label = existingParentDisplayName(existing);
      const go = window.confirm(`View existing parent (${label})?`);
      if (go) await onViewExistingParent(existing);
    }
    if (canViewExistingParentConflict() && existing && onLinkExistingParent) {
      const link = window.confirm(
        `Link existing parent (${existingParentDisplayName(existing)}) to this learner instead of creating a duplicate?`
      );
      if (link) await onLinkExistingParent(existing);
    }
  };

  const presentPossibleMatch = async (payload: PossibleParentMatchPayload) => {
    const cand = payload.existingParent || null;
    const label = existingParentDisplayName(cand);
    const detail = [
      payload.message,
      cand
        ? `\nCandidate: ${label}`
        : "",
      "\n\nChoose OK to create a NEW parent (confirm different people), or Cancel to review.",
    ].join("");
    if (canViewExistingParentConflict() && cand && onLinkExistingParent) {
      const linkFirst = window.confirm(
        `${payload.message}\n\nLink existing parent (${label}) to this learner?\n\nOK = Link existing · Cancel = more options`
      );
      if (linkFirst) {
        await onLinkExistingParent(cand);
        return "linked";
      }
    }
    if (payload.allowExplicitCreate) {
      const createAnyway = window.confirm(detail);
      if (createAnyway) return "create";
    }
    if (canViewExistingParentConflict() && cand?.primaryLearnerId && onViewExistingParent) {
      const view = window.confirm(`View existing parent (${label})?`);
      if (view) await onViewExistingParent(cand);
    }
    return "cancel";
  };

  const commitParent = async (opts?: { confirmCreateDespiteMatch?: boolean }) => {
    const err = validateParentForSave(parentDraft);
    if (err) {
      window.alert(err);
      return;
    }

    const draftIdNumber = (parentDraft.idNumber || "").trim();
    if (draftIdNumber) {
      try {
        const ownership = await fetchParentIdOwnership({
          idNumber: draftIdNumber,
          excludeParentId: parentDraft.id,
          cellNo: parentDraft.cellNo || parentDraft.cell || parentDraft.phone,
          email: parentDraft.email,
        });
        if (ownership.warning) {
          const proceed = window.confirm(
            `${ownership.warning.message}\n\nContinue saving anyway?`
          );
          if (!proceed) return;
        }
      } catch {
        // Soft pre-check only — save path still authoritative for conflicts.
      }
    }

    setSaving(true);
    try {
      let saved = { ...parentDraft };
      if (onPersistParent) {
        const result = await onPersistParent(parentDraft, {
          confirmCreateDespiteMatch: Boolean(opts?.confirmCreateDespiteMatch),
        });
        if (result) saved = normalizeParentRecord(result as Record<string, unknown>);
        if (parentMode === "manage" && selectedParent) {
          setSelectedId(String(saved.id || selectedParent.id || ""));
        } else if (parentMode === "add") {
          setSelectedId(String(saved.id || ""));
        }
        cancelForm();
        window.alert("Parent saved.");
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
    } catch (error) {
      if (error instanceof ParentIdConflictClientError) {
        await presentIdConflict(error.payload.existingParent, error.payload.message);
        return;
      }
      if (error instanceof PossibleParentMatchClientError) {
        const choice = await presentPossibleMatch(error.payload);
        if (choice === "create") {
          await commitParent({ confirmCreateDespiteMatch: true });
        }
        return;
      }
      window.alert(error instanceof Error ? error.message : "Failed to save parent");
    } finally {
      setSaving(false);
    }
  };

  const linkExisting = async () => {
    const found = schoolParents.find((p) => String(p.id) === String(existingPickId));
    if (!found) {
      window.alert("Please select an existing parent first.");
      return;
    }
    if (!canViewExistingParentConflict()) {
      window.alert("Only Owner/Admin may link an existing parent.");
      return;
    }
    const normalized = normalizeParentRecord(found as Record<string, unknown>);
    if (parents.some((p) => String(p.id) === String(normalized.id))) {
      window.alert("This parent is already linked.");
      return;
    }

    if (onLinkExistingParent && normalized.id) {
      setSaving(true);
      try {
        await onLinkExistingParent({
          id: String(normalized.id),
          schoolId: String(schoolId || ""),
          firstName: normalized.firstName || "",
          surname: normalized.surname || "",
          cellNo: normalized.cellNo || "",
          email: normalized.email || null,
          idNumber: normalized.idNumber || null,
          familyAccountId: null,
          primaryLearnerId: null,
        });
        cancelForm();
        window.alert("Parent linked.");
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Failed to link parent");
      } finally {
        setSaving(false);
      }
      return;
    }

    // Local-only (Add Learner draft) — no API until learner create.
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
