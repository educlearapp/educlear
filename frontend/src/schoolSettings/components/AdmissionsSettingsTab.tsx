import { useEffect, useState } from "react";
import {
  fetchAdmissionsSettings,
  saveAdmissionsSettings,
  type AdmissionsRequiredDocument,
  type AdmissionsSettings,
} from "../../admissions/admissionsSettingsApi";
import { listApplications } from "../../admissions/staffAdmissionsApi";
import { hasPermission } from "../../users/permissions";
import { getSchoolSessionUser } from "../../auth/schoolSession";
import {
  BUILTIN_DOCUMENT_KEYS,
  BUILTIN_DOCUMENTS,
  newDocumentRequirement,
  requiredDocumentValidation,
} from "../admissionsRequiredDocuments";

type Props = {
  canManage: boolean;
  onSaved?: () => void;
};

const ACTIVE_APPLICATION_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "INFO_REQUESTED",
] as const;

function emptyDraft(schoolId: string): AdmissionsSettings {
  return {
    id: null,
    schoolId,
    enabled: false,
    publicSlug: "",
    applicationsOpenAt: null,
    applicationsCloseAt: null,
    intakeYear: new Date().getFullYear() + 1,
    acceptedGrades: [],
    admissionFeeRequired: false,
    defaultAdmissionFeeAmount: "",
    currency: "ZAR",
    proofOfPaymentRequired: false,
    paymentVerificationRequired: true,
    requirePaymentVerifiedBeforeAccept: true,
    bankName: "",
    accountHolder: "",
    accountNumber: "",
    branchCode: "",
    accountType: "",
    paymentInstructions: "",
    admissionContactEmail: "",
    admissionContactPhone: "",
    requiredDocuments: [],
    applicationQuestions: [],
    notificationRecipientUserIds: [],
    privacyNoticeVersion: null,
    declarationText: null,
    createdAt: null,
    updatedAt: null,
  };
}

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function fromDateInput(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  return new Date(`${v}T00:00:00.000Z`).toISOString();
}

export default function AdmissionsSettingsTab({ canManage, onSaved }: Props) {
  const schoolId = typeof localStorage !== "undefined" ? localStorage.getItem("schoolId") || "" : "";
  const [draft, setDraft] = useState<AdmissionsSettings>(() => emptyDraft(schoolId));
  const [gradesText, setGradesText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savedRequiredDocuments, setSavedRequiredDocuments] = useState("[]");
  const [activeApplicationCount, setActiveApplicationCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAdmissionsSettings()
      .then((settings) => {
        if (cancelled) return;
        setDraft({
          ...settings,
          publicSlug: settings.publicSlug || "",
          defaultAdmissionFeeAmount: settings.defaultAdmissionFeeAmount || "",
          bankName: settings.bankName || "",
          accountHolder: settings.accountHolder || "",
          accountNumber: settings.accountNumber || "",
          branchCode: settings.branchCode || "",
          accountType: settings.accountType || "",
          paymentInstructions: settings.paymentInstructions || "",
          admissionContactEmail: settings.admissionContactEmail || "",
          admissionContactPhone: settings.admissionContactPhone || "",
        });
        setGradesText((settings.acceptedGrades || []).join(", "));
        setSavedRequiredDocuments(JSON.stringify(settings.requiredDocuments || []));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load settings");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    Promise.all(
      ACTIVE_APPLICATION_STATUSES.map((status) =>
        listApplications({ status, includeDrafts: true, pageSize: 1 }).then(
          (result) => result.total
        )
      )
    )
      .then((totals) => {
        if (!cancelled) setActiveApplicationCount(totals.reduce((sum, total) => sum + total, 0));
      })
      .catch(() => {
        if (!cancelled) setActiveApplicationCount(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function patch<K extends keyof AdmissionsSettings>(key: K, value: AdmissionsSettings[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setMessage(null);
  }

  function patchRequiredDocument(
    index: number,
    next: Partial<AdmissionsRequiredDocument>
  ) {
    patch(
      "requiredDocuments",
      draft.requiredDocuments.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...next } : item
      )
    );
  }

  async function handleSave() {
    if (!canManage) return;
    const documentError = requiredDocumentValidation(draft.requiredDocuments || []);
    if (documentError) {
      setError(documentError);
      return;
    }
    const documentsChanged =
      JSON.stringify(draft.requiredDocuments || []) !== savedRequiredDocuments;
    if (documentsChanged) {
      const warning =
        activeApplicationCount === null
          ? "Active or pending applications could not be checked. Changing required documents can affect staff acceptance. Continue?"
          : activeApplicationCount > 0
            ? `Changing required documents can affect ${activeApplicationCount} active or pending application${activeApplicationCount === 1 ? "" : "s"} at staff acceptance. Continue?`
            : null;
      if (warning && !window.confirm(warning)) return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const acceptedGrades = gradesText
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean);
      const saved = await saveAdmissionsSettings({
        enabled: draft.enabled,
        publicSlug: String(draft.publicSlug || "").trim() || null,
        applicationsOpenAt: draft.applicationsOpenAt,
        applicationsCloseAt: draft.applicationsCloseAt,
        intakeYear: draft.intakeYear,
        acceptedGrades,
        admissionFeeRequired: draft.admissionFeeRequired,
        defaultAdmissionFeeAmount: draft.admissionFeeRequired
          ? String(draft.defaultAdmissionFeeAmount || "").trim() || null
          : String(draft.defaultAdmissionFeeAmount || "").trim() || null,
        currency: draft.currency || "ZAR",
        proofOfPaymentRequired: draft.proofOfPaymentRequired,
        paymentVerificationRequired: draft.paymentVerificationRequired,
        requirePaymentVerifiedBeforeAccept: draft.requirePaymentVerifiedBeforeAccept,
        bankName: String(draft.bankName || "").trim() || null,
        accountHolder: String(draft.accountHolder || "").trim() || null,
        accountNumber: String(draft.accountNumber || "").trim() || null,
        branchCode: String(draft.branchCode || "").trim() || null,
        accountType: String(draft.accountType || "").trim() || null,
        paymentInstructions: String(draft.paymentInstructions || "").trim() || null,
        admissionContactEmail: String(draft.admissionContactEmail || "").trim() || null,
        admissionContactPhone: String(draft.admissionContactPhone || "").trim() || null,
        requiredDocuments: draft.requiredDocuments,
      });
      setDraft({
        ...saved,
        publicSlug: saved.publicSlug || "",
        defaultAdmissionFeeAmount: saved.defaultAdmissionFeeAmount || "",
        bankName: saved.bankName || "",
        accountHolder: saved.accountHolder || "",
        accountNumber: saved.accountNumber || "",
        branchCode: saved.branchCode || "",
        accountType: saved.accountType || "",
        paymentInstructions: saved.paymentInstructions || "",
        admissionContactEmail: saved.admissionContactEmail || "",
        admissionContactPhone: saved.admissionContactPhone || "",
      });
      setGradesText((saved.acceptedGrades || []).join(", "));
      setSavedRequiredDocuments(JSON.stringify(saved.requiredDocuments || []));
      setMessage("Admissions settings saved.");
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="school-settings-card-hint">Loading admissions settings…</p>;
  }

  return (
    <section className="school-settings-card" aria-labelledby="admissions-settings-heading">
      <h2 id="admissions-settings-heading" className="school-settings-card-title">
        Online Admissions
      </h2>
      <p className="school-settings-card-hint">
        Configure the public admissions module for this school. Applicants stay in a staging domain
        until accepted. Fee amounts are per-school — there is no EduClear-wide default.
      </p>

      {error ? (
        <p className="school-settings-card-hint" style={{ color: "#b42318" }} role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="school-settings-card-hint" style={{ color: "#027a48" }}>
          {message}
        </p>
      ) : null}

      <div className="school-settings-checklist" style={{ display: "grid", gap: 14 }}>
        <label className="school-settings-checkbox">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={!canManage}
            onChange={(e) => patch("enabled", e.target.checked)}
          />
          <span>Enable Online Admissions</span>
        </label>

        <label>
          <span className="school-settings-card-hint">Public slug (URL: /admissions/&#123;slug&#125;)</span>
          <input
            className="school-settings-input"
            value={String(draft.publicSlug || "")}
            disabled={!canManage}
            onChange={(e) => patch("publicSlug", e.target.value.toLowerCase())}
            placeholder="e.g. da-silva-academy"
            style={{ display: "block", width: "100%", marginTop: 6, padding: "8px 10px" }}
          />
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label>
            <span className="school-settings-card-hint">Applications open</span>
            <input
              type="date"
              className="school-settings-input"
              value={toDateInput(draft.applicationsOpenAt)}
              disabled={!canManage}
              onChange={(e) => patch("applicationsOpenAt", fromDateInput(e.target.value))}
              style={{ display: "block", width: "100%", marginTop: 6, padding: "8px 10px" }}
            />
          </label>
          <label>
            <span className="school-settings-card-hint">Applications close</span>
            <input
              type="date"
              className="school-settings-input"
              value={toDateInput(draft.applicationsCloseAt)}
              disabled={!canManage}
              onChange={(e) => patch("applicationsCloseAt", fromDateInput(e.target.value))}
              style={{ display: "block", width: "100%", marginTop: 6, padding: "8px 10px" }}
            />
          </label>
        </div>

        <label>
          <span className="school-settings-card-hint">Intake year</span>
          <input
            type="number"
            className="school-settings-input"
            value={draft.intakeYear ?? ""}
            disabled={!canManage}
            onChange={(e) =>
              patch("intakeYear", e.target.value === "" ? null : Number(e.target.value))
            }
            style={{ display: "block", width: "100%", marginTop: 6, padding: "8px 10px" }}
          />
        </label>

        <label>
          <span className="school-settings-card-hint">Accepted grades (comma-separated)</span>
          <input
            className="school-settings-input"
            value={gradesText}
            disabled={!canManage}
            onChange={(e) => setGradesText(e.target.value)}
            placeholder="Grade R, Grade 1, Grade 2"
            style={{ display: "block", width: "100%", marginTop: 6, padding: "8px 10px" }}
          />
        </label>

        <h3 className="school-settings-card-title" style={{ fontSize: "1rem", marginTop: 8 }}>
          Required documents
        </h3>
        <p className="school-settings-card-hint">
          Configure supporting documents only. Proof of payment remains in the separate
          post-submission payment flow.
        </p>
        {activeApplicationCount !== null && activeApplicationCount > 0 ? (
          <p className="school-settings-card-hint" style={{ color: "#92400e" }}>
            Changes can affect staff acceptance checks for {activeApplicationCount} active or
            pending application{activeApplicationCount === 1 ? "" : "s"}.
          </p>
        ) : null}
        {draft.requiredDocuments.length === 0 ? (
          <p className="school-settings-card-hint">
            No supporting document requirements have been configured yet.
          </p>
        ) : null}
        {draft.requiredDocuments.map((document, index) => {
          const builtIn = BUILTIN_DOCUMENT_KEYS.has(
            document.key as (typeof BUILTIN_DOCUMENTS)[number][0]
          );
          return (
            <div
              key={`${document.key}-${index}`}
              style={{
                display: "grid",
                gap: 10,
                padding: 12,
                border: "1px solid rgba(0,0,0,0.12)",
                borderRadius: 8,
              }}
            >
              <label>
                <span className="school-settings-card-hint">Document key</span>
                <select
                  className="school-settings-input"
                  value={builtIn ? document.key : "__custom__"}
                  disabled={!canManage}
                  onChange={(event) => {
                    const key = event.target.value;
                    if (key === "__custom__") {
                      patchRequiredDocument(index, { key: "" });
                      return;
                    }
                    const label =
                      BUILTIN_DOCUMENTS.find(([candidate]) => candidate === key)?.[1] ||
                      document.label;
                    patchRequiredDocument(index, { key, label });
                  }}
                  style={{ display: "block", width: "100%", marginTop: 6, padding: "8px 10px" }}
                >
                  {BUILTIN_DOCUMENTS.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label} ({key})
                    </option>
                  ))}
                  <option value="__custom__">Custom document key</option>
                </select>
              </label>
              {!builtIn ? (
                <label>
                  <span className="school-settings-card-hint">Custom key</span>
                  <input
                    className="school-settings-input"
                    value={document.key}
                    disabled={!canManage}
                    onChange={(event) =>
                      patchRequiredDocument(index, {
                        key: event.target.value.trim().toLowerCase(),
                      })
                    }
                    placeholder="e.g. previous_school_testimonial"
                    style={{ display: "block", width: "100%", marginTop: 6, padding: "8px 10px" }}
                  />
                </label>
              ) : null}
              <label>
                <span className="school-settings-card-hint">Display label</span>
                <input
                  className="school-settings-input"
                  value={document.label}
                  disabled={!canManage}
                  onChange={(event) =>
                    patchRequiredDocument(index, { label: event.target.value })
                  }
                  style={{ display: "block", width: "100%", marginTop: 6, padding: "8px 10px" }}
                />
              </label>
              <label className="school-settings-checkbox">
                <input
                  type="checkbox"
                  checked={document.required}
                  disabled={!canManage}
                  onChange={(event) =>
                    patchRequiredDocument(index, { required: event.target.checked })
                  }
                />
                <span>Required</span>
              </label>
              <label>
                <span className="school-settings-card-hint">Requirement condition</span>
                <select
                  className="school-settings-input"
                  value={document.condition?.type || ""}
                  disabled={!canManage}
                  onChange={(event) =>
                    patchRequiredDocument(index, {
                      condition: event.target.value
                        ? { type: "learner_citizenship_not_south_african" }
                        : null,
                      ...(event.target.value ? { required: true } : {}),
                    })
                  }
                  style={{ display: "block", width: "100%", marginTop: 6, padding: "8px 10px" }}
                >
                  <option value="">Always</option>
                  <option value="learner_citizenship_not_south_african">
                    Learner citizenship is not South African
                  </option>
                </select>
              </label>
              <label className="school-settings-checkbox">
                <input
                  type="checkbox"
                  checked={document.allowMultiple}
                  disabled={!canManage}
                  onChange={(event) =>
                    patchRequiredDocument(index, {
                      allowMultiple: event.target.checked,
                      maxCount: event.target.checked
                        ? Math.max(2, Number(document.maxCount) || 10)
                        : 1,
                    })
                  }
                />
                <span>Allow multiple files</span>
              </label>
              {document.allowMultiple ? (
                <label>
                  <span className="school-settings-card-hint">Maximum files (1–20)</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    className="school-settings-input"
                    value={document.maxCount}
                    disabled={!canManage}
                    onChange={(event) =>
                      patchRequiredDocument(index, {
                        maxCount: Number(event.target.value),
                      })
                    }
                    style={{ display: "block", width: "100%", marginTop: 6, padding: "8px 10px" }}
                  />
                </label>
              ) : null}
              {canManage ? (
                <button
                  type="button"
                  className="school-settings-btn school-settings-btn--outline"
                  onClick={() =>
                    patch(
                      "requiredDocuments",
                      draft.requiredDocuments.filter((_, itemIndex) => itemIndex !== index)
                    )
                  }
                >
                  Remove requirement
                </button>
              ) : null}
            </div>
          );
        })}
        {canManage ? (
          <button
            type="button"
            className="school-settings-btn school-settings-btn--outline"
            onClick={() =>
              patch("requiredDocuments", [
                ...draft.requiredDocuments,
                newDocumentRequirement(draft.requiredDocuments.length),
              ])
            }
          >
            Add document requirement
          </button>
        ) : null}

        <h3 className="school-settings-card-title" style={{ fontSize: "1rem", marginTop: 8 }}>
          Admission fee
        </h3>
        <label className="school-settings-checkbox">
          <input
            type="checkbox"
            checked={draft.admissionFeeRequired}
            disabled={!canManage}
            onChange={(e) => patch("admissionFeeRequired", e.target.checked)}
          />
          <span>Admission fee required</span>
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px", gap: 12 }}>
          <label>
            <span className="school-settings-card-hint">Fee amount (school-specific)</span>
            <input
              className="school-settings-input"
              value={String(draft.defaultAdmissionFeeAmount || "")}
              disabled={!canManage}
              onChange={(e) => patch("defaultAdmissionFeeAmount", e.target.value)}
              placeholder="e.g. 1600.00"
              style={{ display: "block", width: "100%", marginTop: 6, padding: "8px 10px" }}
            />
          </label>
          <label>
            <span className="school-settings-card-hint">Currency</span>
            <input
              className="school-settings-input"
              value={draft.currency || "ZAR"}
              disabled={!canManage}
              onChange={(e) => patch("currency", e.target.value.toUpperCase())}
              style={{ display: "block", width: "100%", marginTop: 6, padding: "8px 10px" }}
            />
          </label>
        </div>
        <label className="school-settings-checkbox">
          <input
            type="checkbox"
            checked={draft.proofOfPaymentRequired}
            disabled={!canManage}
            onChange={(e) => patch("proofOfPaymentRequired", e.target.checked)}
          />
          <span>Proof of payment required</span>
        </label>
        <label className="school-settings-checkbox">
          <input
            type="checkbox"
            checked={draft.paymentVerificationRequired}
            disabled={!canManage}
            onChange={(e) => patch("paymentVerificationRequired", e.target.checked)}
          />
          <span>Payment verification required</span>
        </label>
        <label className="school-settings-checkbox">
          <input
            type="checkbox"
            checked={draft.requirePaymentVerifiedBeforeAccept}
            disabled={!canManage}
            onChange={(e) => patch("requirePaymentVerifiedBeforeAccept", e.target.checked)}
          />
          <span>Require verified (or waived) payment before acceptance</span>
        </label>

        <h3 className="school-settings-card-title" style={{ fontSize: "1rem", marginTop: 8 }}>
          Bank details (EFT)
        </h3>
        <p className="school-settings-card-hint">
          Leave blank until the school provides official banking details. Do not invent values.
        </p>
        {(
          [
            ["bankName", "Bank name"],
            ["accountHolder", "Account holder"],
            ["accountNumber", "Account number"],
            ["branchCode", "Branch code"],
            ["accountType", "Account type"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            <span className="school-settings-card-hint">{label}</span>
            <input
              className="school-settings-input"
              value={String(draft[key] || "")}
              disabled={!canManage}
              onChange={(e) => patch(key, e.target.value)}
              style={{ display: "block", width: "100%", marginTop: 6, padding: "8px 10px" }}
            />
          </label>
        ))}
        <label>
          <span className="school-settings-card-hint">Payment instructions</span>
          <textarea
            className="school-settings-input"
            value={String(draft.paymentInstructions || "")}
            disabled={!canManage}
            onChange={(e) => patch("paymentInstructions", e.target.value)}
            rows={3}
            style={{ display: "block", width: "100%", marginTop: 6, padding: "8px 10px" }}
          />
        </label>

        <h3 className="school-settings-card-title" style={{ fontSize: "1rem", marginTop: 8 }}>
          Admissions contact
        </h3>
        <label>
          <span className="school-settings-card-hint">Contact email</span>
          <input
            className="school-settings-input"
            value={String(draft.admissionContactEmail || "")}
            disabled={!canManage}
            onChange={(e) => patch("admissionContactEmail", e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 6, padding: "8px 10px" }}
          />
        </label>
        <label>
          <span className="school-settings-card-hint">Contact phone</span>
          <input
            className="school-settings-input"
            value={String(draft.admissionContactPhone || "")}
            disabled={!canManage}
            onChange={(e) => patch("admissionContactPhone", e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 6, padding: "8px 10px" }}
          />
        </label>
      </div>

      {canManage ? (
        <div style={{ marginTop: 20 }}>
          <button
            type="button"
            className="school-settings-btn school-settings-btn--gold"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save Admissions Settings"}
          </button>
        </div>
      ) : (
        <p className="school-settings-card-hint" style={{ marginTop: 16 }}>
          You can view admissions settings. Saving requires admissions manage permission.
        </p>
      )}
    </section>
  );
}

/** Helper for page gate — unused import guard for tree consumers. */
// eslint-disable-next-line react-refresh/only-export-components
export function sessionCanManageAdmissions() {
  return hasPermission(getSchoolSessionUser(), "admissions", "manage");
}
