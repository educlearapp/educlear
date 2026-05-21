import { useState } from "react";
import {
  PARENT_FORM_TABS,
  RELATIONSHIP_OPTIONS,
  TITLE_OPTIONS,
  type ParentFormTab,
  type ParentRecord,
} from "./parentFormTypes";
import "./ParentFormPanel.css";

type Props = {
  draft: ParentRecord;
  onChange: (next: ParentRecord) => void;
  formTitle?: string;
  showActions?: boolean;
  onSave?: () => void;
  onCancel?: () => void;
  saving?: boolean;
};

function patch(draft: ParentRecord, key: keyof ParentRecord, value: unknown): ParentRecord {
  return { ...draft, [key]: value };
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="parent-form-panel__check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export default function ParentFormPanel({
  draft,
  onChange,
  formTitle = "Parent details",
  showActions = true,
  onSave,
  onCancel,
  saving = false,
}: Props) {
  const [tab, setTab] = useState<ParentFormTab>("general");

  const set = (key: keyof ParentRecord, value: unknown) => onChange(patch(draft, key, value));

  return (
    <div className="parent-form-panel">
      <div className="parent-form-panel__head">
        <h3 className="parent-form-panel__title">{formTitle}</h3>
        <div className="parent-form-panel__tabs" role="tablist">
          {PARENT_FORM_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`parent-form-panel__tab${tab === t.id ? " parent-form-panel__tab--active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="parent-form-panel__body">
        {tab === "general" && (
          <div className="parent-form-panel__grid">
            <div className="parent-form-panel__field">
              <label className="parent-form-panel__label">Relationship</label>
              <select
                className="parent-form-panel__select"
                value={draft.relationship || "Parent"}
                onChange={(e) => set("relationship", e.target.value)}
              >
                {RELATIONSHIP_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div className="parent-form-panel__field">
              <label className="parent-form-panel__label">Title</label>
              <select
                className="parent-form-panel__select"
                value={draft.title || ""}
                onChange={(e) => set("title", e.target.value)}
              >
                {TITLE_OPTIONS.map((o) => (
                  <option key={o || "none"} value={o}>
                    {o || "—"}
                  </option>
                ))}
              </select>
            </div>
            <div className="parent-form-panel__field">
              <label className="parent-form-panel__label">First Name</label>
              <input
                className="parent-form-panel__input"
                value={draft.firstName || ""}
                onChange={(e) => set("firstName", e.target.value)}
                placeholder="First name"
              />
            </div>
            <div className="parent-form-panel__field">
              <label className="parent-form-panel__label">Surname</label>
              <input
                className="parent-form-panel__input"
                value={draft.surname || ""}
                onChange={(e) => set("surname", e.target.value)}
                placeholder="Surname"
              />
            </div>
            <div className="parent-form-panel__field">
              <label className="parent-form-panel__label">ID Number</label>
              <input
                className="parent-form-panel__input"
                value={draft.idNumber || ""}
                onChange={(e) => set("idNumber", e.target.value)}
                placeholder="13-digit ID number"
              />
            </div>
            <div className="parent-form-panel__field">
              <label className="parent-form-panel__label">Primary contact</label>
              <label className="parent-form-panel__check" style={{ marginTop: 10 }}>
                <input
                  type="checkbox"
                  checked={draft.isPrimary !== false}
                  onChange={(e) => set("isPrimary", e.target.checked)}
                />
                <span>Mark as primary parent / guardian</span>
              </label>
            </div>
          </div>
        )}

        {tab === "contact" && (
          <div className="parent-form-panel__grid">
            <div className="parent-form-panel__field">
              <label className="parent-form-panel__label">Cell Number</label>
              <input
                className="parent-form-panel__input"
                value={draft.cellNo || draft.cell || draft.phone || ""}
                onChange={(e) => {
                  const v = e.target.value;
                  onChange({ ...draft, cellNo: v, cell: v, phone: v });
                }}
                placeholder="Mobile number"
              />
            </div>
            <div className="parent-form-panel__field">
              <label className="parent-form-panel__label">Work Number</label>
              <input
                className="parent-form-panel__input"
                value={draft.workNo || draft.work || ""}
                onChange={(e) => {
                  const v = e.target.value;
                  onChange({ ...draft, workNo: v, work: v });
                }}
                placeholder="Work phone"
              />
            </div>
            <div className="parent-form-panel__field parent-form-panel__field--full">
              <label className="parent-form-panel__label">Email</label>
              <input
                className="parent-form-panel__input"
                type="email"
                value={draft.email || ""}
                onChange={(e) => set("email", e.target.value)}
                placeholder="parent@email.com"
              />
            </div>
            <div className="parent-form-panel__field">
              <label className="parent-form-panel__label">Home phone (optional)</label>
              <input
                className="parent-form-panel__input"
                value={draft.homeNo || ""}
                onChange={(e) => set("homeNo", e.target.value)}
                placeholder="Home landline"
              />
            </div>
          </div>
        )}

        {tab === "address" && (
          <div className="parent-form-panel__grid">
            <div className="parent-form-panel__field parent-form-panel__field--full">
              <label className="parent-form-panel__label">Home Address</label>
              <textarea
                className="parent-form-panel__textarea"
                value={draft.homeAddress || ""}
                onChange={(e) => set("homeAddress", e.target.value)}
                placeholder="Street, suburb, city, postal code"
              />
            </div>
          </div>
        )}

        {tab === "billing" && (
          <div className="parent-form-panel__grid">
            <span className="parent-form-panel__section-label">Billing preferences</span>
            <div className="parent-form-panel__checks parent-form-panel__field--full">
              <CheckRow
                label="Paying Person"
                checked={Boolean(draft.isPayingPerson)}
                onChange={(v) => set("isPayingPerson", v)}
              />
              <CheckRow
                label="Statement"
                checked={draft.billingStatement !== false}
                onChange={(v) => set("billingStatement", v)}
              />
              <CheckRow
                label="Invoice"
                checked={draft.billingInvoice !== false}
                onChange={(v) => set("billingInvoice", v)}
              />
              <CheckRow
                label="Receipt"
                checked={draft.billingReceipt !== false}
                onChange={(v) => set("billingReceipt", v)}
              />
            </div>
          </div>
        )}

        {tab === "other" && (
          <div className="parent-form-panel__grid">
            <span className="parent-form-panel__section-label">Communication</span>
            <div className="parent-form-panel__checks parent-form-panel__field--full">
              <CheckRow
                label="Administration Communications"
                checked={draft.communicationAdministration !== false}
                onChange={(v) => set("communicationAdministration", v)}
              />
              <CheckRow
                label="Billing Communications"
                checked={draft.communicationBilling !== false}
                onChange={(v) => set("communicationBilling", v)}
              />
              <CheckRow
                label="Email"
                checked={draft.communicationByEmail !== false}
                onChange={(v) => set("communicationByEmail", v)}
              />
              <CheckRow
                label="SMS"
                checked={draft.communicationBySMS !== false}
                onChange={(v) => set("communicationBySMS", v)}
              />
              <CheckRow
                label="Print"
                checked={draft.communicationByPrint !== false}
                onChange={(v) => set("communicationByPrint", v)}
              />
            </div>
          </div>
        )}

        {tab === "extra" && (
          <div className="parent-form-panel__grid">
            <div className="parent-form-panel__field parent-form-panel__field--full">
              <label className="parent-form-panel__label">Notes</label>
              <textarea
                className="parent-form-panel__textarea"
                value={draft.notes || ""}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="Additional notes about this parent or guardian"
              />
            </div>
          </div>
        )}

        {showActions && (onSave || onCancel) && (
          <div className="parent-form-panel__actions">
            {onCancel && (
              <button type="button" className="add-learner-btn add-learner-btn--outline" onClick={onCancel}>
                Cancel
              </button>
            )}
            {onSave && (
              <button
                type="button"
                className="add-learner-btn add-learner-btn--save"
                onClick={onSave}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save Parent"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
