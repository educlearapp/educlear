import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api";
import {
  buildConversionDecisionDto,
  describeBlockerCode,
  hasConversionBlocker,
  initialFamilyDecision,
  initialGuardianDecisions,
  isFinanceBaselineWarningOnly,
  validateConversionUiState,
  type ConversionUiState,
  type FamilyUiDecision,
  type GuardianUiDecision,
} from "./conversionDecision";
import { convertToLearner, getConversionPreflight } from "./staffAdmissionsApi";
import type { ConversionPreflight, ConversionResult, StaffAdmissionsApiError } from "./staffAdmissionsTypes";
import "./admissionsStaff.css";

type Props = {
  applicationId: string;
  schoolId: string;
  onClose: () => void;
  onSuccess: () => void;
  onOpenLearner?: (learnerId: string) => void;
  /** OA-05B — open dedicated historical reactivation flow instead of dead blocker. */
  onRequestHistoricalReactivate?: () => void;
};

type Step = "loading" | "decisions" | "confirm" | "success";

type ClassroomOption = { id: string; name: string };

function maskIdPresent(hasIdNumber: boolean): string {
  return hasIdNumber ? "On file (masked)" : "Not provided";
}

function contactSummary(g: ConversionPreflight["guardians"][number]): string {
  const parts: string[] = [];
  if (g.hasIdNumber) parts.push("ID on file");
  if (g.hasEmail) parts.push("Email on file");
  if (g.hasCellNo) parts.push("Mobile on file");
  return parts.length ? parts.join(" · ") : "No contact/identity on file";
}

export default function EnrolLearnerModal({
  applicationId,
  schoolId,
  onClose,
  onSuccess,
  onOpenLearner,
  onRequestHistoricalReactivate,
}: Props) {
  const [step, setStep] = useState<Step>("loading");
  const [preflight, setPreflight] = useState<ConversionPreflight | null>(null);
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [staleNotice, setStaleNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const submittingRef = useRef(false);

  const [guardianDecisions, setGuardianDecisions] = useState<Record<string, GuardianUiDecision>>({});
  const [familyDecision, setFamilyDecision] = useState<FamilyUiDecision>({ mode: "" });
  const [grade, setGrade] = useState("");
  const [className, setClassName] = useState("");
  const [classrooms, setClassrooms] = useState<ClassroomOption[]>([]);
  const [classroomsLoading, setClassroomsLoading] = useState(false);

  const safeClose = useCallback(() => {
    if (submittingRef.current) return;
    onClose();
  }, [onClose]);

  const loadPreflight = useCallback(
    async (opts?: { preserveSelections?: boolean; staleMessage?: string }) => {
      setStep("loading");
      setLoadError("");
      setSubmitError("");
      if (opts?.staleMessage) {
        setStaleNotice(opts.staleMessage);
      } else if (!opts?.preserveSelections) {
        setStaleNotice("");
      }
      try {
        const data = await getConversionPreflight(applicationId);
        setPreflight(data);
        if (!opts?.preserveSelections) {
          setGuardianDecisions(initialGuardianDecisions(data));
          setFamilyDecision(initialFamilyDecision(data));
          setGrade(data.placement.proposedGrade || data.placement.requestedGrade || "");
          setClassName("");
        } else {
          // Drop link selections that are no longer in candidate lists after reload.
          setGuardianDecisions((prev) => {
            const next: Record<string, GuardianUiDecision> = {};
            for (const g of data.guardians) {
              const prior = prev[g.admissionGuardianId] || { mode: "" as const };
              const parentStillValid =
                prior.mode === "LINK_EXISTING" &&
                Boolean(prior.existingParentId) &&
                g.candidates.some((c) => c.parentId === prior.existingParentId);
              next[g.admissionGuardianId] = {
                mode: prior.mode || "",
                confirmCreateDespiteMatch: prior.confirmCreateDespiteMatch,
                existingParentId: parentStillValid ? prior.existingParentId : "",
              };
            }
            return next;
          });
          setFamilyDecision((prev) => {
            if (prev.mode !== "USE_EXISTING") {
              return {
                mode: prev.mode || "",
                acknowledgeCreateNewFamilyDespiteSiblingDeclaration:
                  prev.acknowledgeCreateNewFamilyDespiteSiblingDeclaration,
              };
            }
            const stillValid =
              Boolean(prev.existingFamilyAccountId) &&
              data.family.candidates.some((c) => c.familyAccountId === prev.existingFamilyAccountId);
            return {
              mode: "USE_EXISTING",
              existingFamilyAccountId: stillValid ? prev.existingFamilyAccountId : "",
            };
          });
        }
        setStep("decisions");
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Failed to load enrolment preflight");
        setPreflight(null);
      }
    },
    [applicationId]
  );

  useEffect(() => {
    void loadPreflight();
  }, [loadPreflight]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        safeClose();
      }
    };
    window.addEventListener("keydown", onKey);
    // Prefer focusing the first actionable control once the dialog mounts.
    window.setTimeout(() => {
      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelector<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      (focusable || closeButtonRef.current || root).focus();
    }, 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [safeClose]);

  useEffect(() => {
    if (!schoolId) {
      setClassrooms([]);
      setClassroomsLoading(false);
      return;
    }
    let cancelled = false;
    setClassroomsLoading(true);
    void apiFetch(`/api/classrooms?schoolId=${encodeURIComponent(schoolId)}`)
      .then((data: { classrooms?: Array<{ id?: string; name?: string; className?: string }> }) => {
        if (cancelled) return;
        const rows = Array.isArray(data?.classrooms) ? data.classrooms : [];
        const options = rows
          .map((row) => ({
            id: String(row?.id || ""),
            name: String(row?.name || row?.className || "").trim(),
          }))
          .filter((row) => row.name)
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        setClassrooms(options);
      })
      .catch(() => {
        // Classroom list is optional — conversion must still proceed without it.
        if (!cancelled) setClassrooms([]);
      })
      .finally(() => {
        if (!cancelled) setClassroomsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  const uiState: ConversionUiState = useMemo(
    () => ({
      guardians: guardianDecisions,
      family: familyDecision,
      grade,
      className,
    }),
    [className, familyDecision, grade, guardianDecisions]
  );

  const blocked = preflight ? hasConversionBlocker(preflight) : false;

  const selectedFamilyLabel = useMemo(() => {
    if (familyDecision.mode !== "USE_EXISTING") return "Create new";
    const match = preflight?.family.candidates.find(
      (c) => c.familyAccountId === familyDecision.existingFamilyAccountId
    );
    if (match) return `Use ${match.accountRef || match.familyName}`;
    return "Use existing";
  }, [familyDecision, preflight]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) safeClose();
  };

  const updateGuardian = (id: string, patch: Partial<GuardianUiDecision>) => {
    setGuardianDecisions((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...patch },
    }));
  };

  const goToConfirm = () => {
    if (!preflight || submittingRef.current) return;
    const validation = validateConversionUiState(preflight, uiState);
    if (!validation.ok) {
      setSubmitError(validation.message);
      return;
    }
    setSubmitError("");
    setStaleNotice("");
    setStep("confirm");
  };

  const handleConvert = async () => {
    if (!preflight || submittingRef.current) return;
    const validation = validateConversionUiState(preflight, uiState);
    if (!validation.ok) {
      setSubmitError(validation.message);
      setStep("decisions");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      const dto = buildConversionDecisionDto(uiState);
      const conversion = await convertToLearner(applicationId, dto);
      setResult(conversion);
      setStep("success");
    } catch (err) {
      const apiErr = err as StaffAdmissionsApiError;
      const code = apiErr.code || "";
      if (
        code === "LEARNER_IDENTITY_CONFLICT" ||
        code === "HISTORICAL_LEARNER_REQUIRES_REACTIVATION" ||
        code === "CONVERSION_CONFLICT" ||
        code === "STALE_PREFLIGHT" ||
        /changed|conflict|stale/i.test(apiErr.message || "")
      ) {
        setSubmitError(
          apiErr.message ||
            "Canonical records changed after preflight. Review decisions again before continuing."
        );
        await loadPreflight({
          preserveSelections: true,
          staleMessage:
            "Records changed since the last preflight. Please review match candidates and your selections again.",
        });
      } else {
        setSubmitError(apiErr.message || "Enrolment failed");
        setStep("decisions");
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const titleId = "enrol-learner-modal-title";
  const siblingDeclared =
    Boolean(preflight?.family.declaredExistingSibling) ||
    Boolean(preflight?.family.declaredExistingFamily);

  return (
    <div
      className="admissions-staff-modal-overlay"
      role="presentation"
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        className="admissions-staff-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admissions-staff-modal-accent" aria-hidden="true" />

        {step === "loading" ? (
          <>
            <h2 id={titleId} className="admissions-staff-modal-title">
              Enrol Learner
            </h2>
            <p className="admissions-staff-modal-subtitle">Loading conversion preflight…</p>
            {loadError ? (
              <>
                <div className="admissions-staff-alert admissions-staff-alert--error">{loadError}</div>
                <div className="admissions-staff-modal-actions">
                  <button
                    ref={closeButtonRef}
                    type="button"
                    className="admissions-staff-btn admissions-staff-btn--outline"
                    onClick={safeClose}
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    className="admissions-staff-btn admissions-staff-btn--gold"
                    onClick={() => void loadPreflight()}
                  >
                    Retry
                  </button>
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {step === "decisions" && preflight ? (
          <>
            <h2 id={titleId} className="admissions-staff-modal-title">
              Enrol Learner — Decisions
            </h2>
            <p className="admissions-staff-modal-subtitle">
              Application {preflight.application.applicationNumber || applicationId}
            </p>

            {staleNotice ? (
              <div className="admissions-staff-alert admissions-staff-alert--warning" role="status">
                {staleNotice}
              </div>
            ) : null}

            {preflight.blockers.map((b) => (
              <p key={b.code} className="admissions-staff-blocker" role="alert">
                {describeBlockerCode(b.code, b.message)}
              </p>
            ))}
            {preflight.warnings.map((w) => (
              <p key={w.code} className="admissions-staff-match-warning">
                Warning: {w.message}
              </p>
            ))}

            <section className="admissions-staff-modal-section" aria-labelledby="enrol-learner-section">
              <h3 id="enrol-learner-section" className="admissions-staff-modal-section-title">
                Learner
              </h3>
              <p>
                {preflight.learner.firstName} {preflight.learner.lastName}
              </p>
              <p>DOB: {preflight.learner.birthDate || "—"}</p>
              <p>ID: {maskIdPresent(preflight.learner.hasIdNumber)}</p>
              <p>Requested grade: {preflight.learner.requestedGrade || "—"}</p>
              <p>Intake: {preflight.learner.intakeYear}</p>
              {preflight.learner.duplicate ? (
                <div className="admissions-staff-blocker" role="alert">
                  <p style={{ margin: "0 0 8px" }}>
                    {preflight.learner.duplicate.blockerCode ===
                    "HISTORICAL_LEARNER_REQUIRES_REACTIVATION"
                      ? "HISTORICAL LEARNER FOUND — "
                      : preflight.learner.duplicate.blockerCode === "LEARNER_IDENTITY_CONFLICT"
                        ? "EXISTING LEARNER FOUND — "
                        : "POSSIBLE DUPLICATE — "}
                    {describeBlockerCode(
                      preflight.learner.duplicate.blockerCode,
                      "Conversion is blocked."
                    )}
                  </p>
                  {preflight.learner.duplicate.blockerCode ===
                    "HISTORICAL_LEARNER_REQUIRES_REACTIVATION" &&
                  onRequestHistoricalReactivate ? (
                    <button
                      type="button"
                      className="admissions-staff-btn admissions-staff-btn--gold"
                      onClick={onRequestHistoricalReactivate}
                    >
                      Reactivate Existing Learner
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>

            <section className="admissions-staff-modal-section" aria-labelledby="enrol-guardians-section">
              <h3 id="enrol-guardians-section" className="admissions-staff-modal-section-title">
                Guardians
              </h3>
              {preflight.guardians.map((g) => {
                const decision = guardianDecisions[g.admissionGuardianId] || { mode: "" };
                const isProbable = g.matchStrength === "PROBABLE" || g.matchStrength === "AMBIGUOUS";
                const isStrong = g.matchStrength === "STRONG";
                return (
                  <div key={g.admissionGuardianId} style={{ marginBottom: 14 }}>
                    <p style={{ margin: "0 0 4px", fontWeight: 700 }}>
                      {g.firstName} {g.surname}
                      {g.isPrimary ? " · Primary" : ""}
                      {g.isPayingPerson ? " · Paying person" : ""}
                    </p>
                    <p style={{ margin: "0 0 6px", fontSize: "0.82rem", opacity: 0.8 }}>
                      {g.relationship || "Relationship not set"} · {contactSummary(g)}
                    </p>
                    {isProbable ? (
                      <p className="admissions-staff-match-warning" role="status">
                        POSSIBLE MATCH — REVIEW REQUIRED
                      </p>
                    ) : null}
                    {isStrong ? (
                      <p className="admissions-staff-match-strong" role="status">
                        Strong ID match — link the existing parent (create new is not allowed).
                      </p>
                    ) : null}
                    <div
                      className="admissions-staff-radio-row"
                      role="radiogroup"
                      aria-label={`Guardian decision for ${g.firstName} ${g.surname}`}
                    >
                      <label>
                        <input
                          type="radio"
                          name={`guardian-${g.admissionGuardianId}`}
                          checked={decision.mode === "CREATE_NEW"}
                          onChange={() =>
                            updateGuardian(g.admissionGuardianId, {
                              mode: "CREATE_NEW",
                              existingParentId: undefined,
                            })
                          }
                          disabled={isStrong}
                        />
                        Create new parent
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`guardian-${g.admissionGuardianId}`}
                          checked={decision.mode === "LINK_EXISTING"}
                          onChange={() =>
                            updateGuardian(g.admissionGuardianId, {
                              mode: "LINK_EXISTING",
                              existingParentId: "",
                            })
                          }
                          disabled={g.candidates.length === 0}
                        />
                        Link existing parent
                      </label>
                    </div>
                    {decision.mode === "LINK_EXISTING" ? (
                      <label className="admissions-staff-field">
                        <span className="admissions-staff-field-label">Existing parent</span>
                        <select
                          className="admissions-staff-select admissions-staff-select--dark"
                          value={decision.existingParentId || ""}
                          onChange={(e) =>
                            updateGuardian(g.admissionGuardianId, {
                              existingParentId: e.target.value,
                            })
                          }
                        >
                          <option value="">Select candidate…</option>
                          {g.candidates.map((c) => (
                            <option key={c.parentId} value={c.parentId}>
                              {c.firstName} {c.surname} ·{" "}
                              {c.maskedIdNumber || c.maskedCellphone || c.maskedEmail}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    {decision.mode === "CREATE_NEW" && isProbable ? (
                      <label
                        style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.86rem" }}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(decision.confirmCreateDespiteMatch)}
                          onChange={(e) =>
                            updateGuardian(g.admissionGuardianId, {
                              confirmCreateDespiteMatch: e.target.checked,
                            })
                          }
                        />
                        I confirm creating a new parent record despite the probable match.
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </section>

            <section className="admissions-staff-modal-section" aria-labelledby="enrol-family-section">
              <h3 id="enrol-family-section" className="admissions-staff-modal-section-title">
                Family account
              </h3>
              {siblingDeclared ? (
                <div className="admissions-staff-alert admissions-staff-alert--warning" role="status">
                  The application indicates an existing sibling or family account.
                  {preflight.family.declaredSiblingLearnerName
                    ? ` Declared sibling: ${preflight.family.declaredSiblingLearnerName}`
                    : ""}
                  {preflight.family.declaredSiblingAdmissionNo
                    ? ` (${preflight.family.declaredSiblingAdmissionNo})`
                    : ""}
                  . Creating a new family account may separate related learners.
                </div>
              ) : null}
              <div
                className="admissions-staff-radio-row"
                role="radiogroup"
                aria-label="Family account decision"
              >
                <label>
                  <input
                    type="radio"
                    name="family-mode"
                    checked={familyDecision.mode === "CREATE_NEW"}
                    onChange={() =>
                      setFamilyDecision({
                        mode: "CREATE_NEW",
                        existingFamilyAccountId: undefined,
                        acknowledgeCreateNewFamilyDespiteSiblingDeclaration: false,
                      })
                    }
                  />
                  Create new family account
                </label>
                <label>
                  <input
                    type="radio"
                    name="family-mode"
                    checked={familyDecision.mode === "USE_EXISTING"}
                    onChange={() =>
                      setFamilyDecision({
                        mode: "USE_EXISTING",
                        existingFamilyAccountId: "",
                        acknowledgeCreateNewFamilyDespiteSiblingDeclaration: false,
                      })
                    }
                    disabled={preflight.family.candidates.length === 0}
                  />
                  Use existing family account
                </label>
              </div>
              {familyDecision.mode === "USE_EXISTING" ? (
                <label className="admissions-staff-field">
                  <span className="admissions-staff-field-label">Existing family</span>
                  <select
                    className="admissions-staff-select admissions-staff-select--dark"
                    value={familyDecision.existingFamilyAccountId || ""}
                    onChange={(e) =>
                      setFamilyDecision((prev) => ({
                        ...prev,
                        existingFamilyAccountId: e.target.value,
                      }))
                    }
                  >
                    <option value="">Select family…</option>
                    {preflight.family.candidates.map((c) => (
                      <option key={c.familyAccountId} value={c.familyAccountId}>
                        {c.accountRef} · {c.familyName} ({c.strength})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {familyDecision.mode === "CREATE_NEW" &&
              preflight.family.requiresAckForCreateNewDespiteSiblingDeclaration ? (
                <label
                  style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.86rem" }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(
                      familyDecision.acknowledgeCreateNewFamilyDespiteSiblingDeclaration
                    )}
                    onChange={(e) =>
                      setFamilyDecision((prev) => ({
                        ...prev,
                        acknowledgeCreateNewFamilyDespiteSiblingDeclaration: e.target.checked,
                      }))
                    }
                  />
                  I have checked the existing family details and intentionally want to create a new
                  family account.
                </label>
              ) : null}
            </section>

            <section className="admissions-staff-modal-section" aria-labelledby="enrol-placement-section">
              <h3 id="enrol-placement-section" className="admissions-staff-modal-section-title">
                Placement
              </h3>
              <label className="admissions-staff-field">
                <span className="admissions-staff-field-label">Grade (required)</span>
                <input
                  type="text"
                  className="admissions-staff-input admissions-staff-input--dark"
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  required
                  aria-required="true"
                />
              </label>
              <label className="admissions-staff-field">
                <span className="admissions-staff-field-label">Classroom (optional)</span>
                <select
                  className="admissions-staff-select admissions-staff-select--dark"
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                  disabled={classroomsLoading}
                >
                  <option value="">Not assigned</option>
                  {classrooms.map((c) => (
                    <option key={c.id || c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            {submitError ? (
              <div className="admissions-staff-alert admissions-staff-alert--error" role="alert">
                {submitError}
              </div>
            ) : null}

            <div className="admissions-staff-modal-actions">
              <button
                type="button"
                className="admissions-staff-btn admissions-staff-btn--outline"
                onClick={safeClose}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="admissions-staff-btn admissions-staff-btn--gold"
                onClick={goToConfirm}
                disabled={blocked || !preflight.canConvert || submitting}
              >
                Review &amp; confirm
              </button>
            </div>
          </>
        ) : null}

        {step === "confirm" && preflight ? (
          <>
            <h2 id={titleId} className="admissions-staff-modal-title">
              Confirm Enrolment
            </h2>
            <p className="admissions-staff-modal-subtitle">
              Review your decisions before creating the EduClear learner record.
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.88rem" }}>
              <li>
                Learner: {preflight.learner.firstName} {preflight.learner.lastName}
              </li>
              <li>Grade: {grade.trim()}</li>
              <li>Class: {className.trim() || "Not assigned"}</li>
              <li>Family: {selectedFamilyLabel}</li>
              {preflight.guardians.map((g) => {
                const d = guardianDecisions[g.admissionGuardianId];
                let outcome = "Unresolved";
                if (d?.mode === "CREATE_NEW") outcome = "Create new";
                if (d?.mode === "LINK_EXISTING") {
                  const cand = g.candidates.find((c) => c.parentId === d.existingParentId);
                  outcome = cand
                    ? `Link existing ${cand.firstName} ${cand.surname}`
                    : "Link existing";
                }
                return (
                  <li key={g.admissionGuardianId}>
                    Guardian {g.firstName} {g.surname} → {outcome}
                  </li>
                );
              })}
              {preflight.warnings.length > 0 ? (
                <li>
                  Warnings: {preflight.warnings.map((w) => w.message).join("; ")}
                </li>
              ) : null}
            </ul>
            {submitError ? (
              <div className="admissions-staff-alert admissions-staff-alert--error" role="alert">
                {submitError}
              </div>
            ) : null}
            <div className="admissions-staff-modal-actions">
              <button
                type="button"
                className="admissions-staff-btn admissions-staff-btn--outline"
                onClick={() => setStep("decisions")}
                disabled={submitting}
              >
                Back
              </button>
              <button
                type="button"
                className="admissions-staff-btn admissions-staff-btn--gold"
                onClick={() => void handleConvert()}
                disabled={submitting || blocked}
                aria-busy={submitting}
              >
                {submitting ? "Enrolling…" : "Confirm & enrol learner"}
              </button>
            </div>
          </>
        ) : null}

        {step === "success" && result ? (
          <>
            <h2 id={titleId} className="admissions-staff-modal-title">
              Learner enrolled successfully
            </h2>
            {result.idempotent ? (
              <p className="admissions-staff-modal-subtitle">
                This application was already converted (idempotent result).
              </p>
            ) : (
              <p className="admissions-staff-modal-subtitle">
                Learner enrolment completed successfully.
              </p>
            )}
            <div className="admissions-staff-alert admissions-staff-alert--success">
              Admission no: {result.admissionNo || "—"}
              <br />
              Account ref: {result.accountRef || "—"}
              <br />
              Family: {result.familyMode === "reused" ? "Existing family reused" : "New family created"}
              {result.guardianOutcomes?.length ? (
                <>
                  <br />
                  Guardians:{" "}
                  {result.guardianOutcomes
                    .map((g) => (g.mode === "linked" ? "Linked" : "Created"))
                    .join(", ")}
                </>
              ) : null}
            </div>
            {isFinanceBaselineWarningOnly(result) ? (
              <div className="admissions-staff-alert admissions-staff-alert--warning" role="alert">
                Finance baseline sync needs attention. Do not enrol again — follow up with an admin /
                finance repair if billing looks incomplete.
              </div>
            ) : null}
            <div className="admissions-staff-modal-actions">
              <button
                type="button"
                className="admissions-staff-btn admissions-staff-btn--outline"
                onClick={() => {
                  onSuccess();
                }}
              >
                Done
              </button>
              {onOpenLearner ? (
                <button
                  type="button"
                  className="admissions-staff-btn admissions-staff-btn--gold"
                  onClick={() => {
                    onOpenLearner(result.learnerId);
                    onSuccess();
                  }}
                >
                  View learner
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
