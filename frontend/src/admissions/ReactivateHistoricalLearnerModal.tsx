import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api";
import {
  buildReactivationDecisionDto,
  describeReactivationBlocker,
  initialReactivationFamilyDecision,
  initialReactivationGuardianDecisions,
  isReactivationFinanceBaselineWarningOnly,
  validateReactivationUiState,
  type ReactivationFamilyUiDecision,
  type ReactivationGuardianUiDecision,
  type ReactivationUiState,
} from "./reactivationDecision";
import { getReactivationPreflight, reactivateHistoricalLearner } from "./staffAdmissionsApi";
import type {
  ReactivationPreflight,
  ReactivationResult,
  StaffAdmissionsApiError,
} from "./staffAdmissionsTypes";
import "./admissionsStaff.css";

type Props = {
  applicationId: string;
  schoolId: string;
  onClose: () => void;
  onSuccess: () => void;
  onOpenLearner?: (learnerId: string) => void;
};

type Step = "loading" | "decisions" | "confirm" | "success" | "blocked";

type ClassroomOption = { id: string; name: string };

export default function ReactivateHistoricalLearnerModal({
  applicationId,
  schoolId,
  onClose,
  onSuccess,
  onOpenLearner,
}: Props) {
  const [step, setStep] = useState<Step>("loading");
  const [preflight, setPreflight] = useState<ReactivationPreflight | null>(null);
  const [loadError, setLoadError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ReactivationResult | null>(null);
  const submittingRef = useRef(false);

  const [guardianDecisions, setGuardianDecisions] = useState<
    Record<string, ReactivationGuardianUiDecision>
  >({});
  const [familyDecision, setFamilyDecision] = useState<ReactivationFamilyUiDecision>({
    mode: "KEEP_EXISTING",
  });
  const [grade, setGrade] = useState("");
  const [className, setClassName] = useState("");
  const [acknowledgeBillingPlan, setAcknowledgeBillingPlan] = useState(false);
  const [classrooms, setClassrooms] = useState<ClassroomOption[]>([]);

  const safeClose = useCallback(() => {
    if (submittingRef.current) return;
    onClose();
  }, [onClose]);

  const loadPreflight = useCallback(async () => {
    setStep("loading");
    setLoadError("");
    setSubmitError("");
    try {
      const data = await getReactivationPreflight(applicationId);
      setPreflight(data);
      setGuardianDecisions(initialReactivationGuardianDecisions(data));
      setFamilyDecision(initialReactivationFamilyDecision(data));
      setGrade(data.placement.proposedGrade || data.placement.requestedGrade || "");
      setClassName("");
      setAcknowledgeBillingPlan(false);
      if (data.application.alreadyEnrolled) {
        setStep("success");
        setResult({
          action: "reactivate_historical_learner",
          idempotent: true,
          learnerId: data.application.promotedLearnerId || "",
          familyAccountId: data.application.promotedFamilyAccountId || "",
          admissionNo: null,
          accountRef: null,
          familyMode: "kept",
          guardianOutcomes: [],
          grade: data.placement.proposedGrade || "",
          className: null,
          financeBaselineRegistered: true,
        });
      } else if (!data.canReactivate || data.blockers.length > 0) {
        setStep("blocked");
      } else {
        setStep("decisions");
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load reactivation preflight");
      setStep("blocked");
    }
  }, [applicationId]);

  useEffect(() => {
    void loadPreflight();
  }, [loadPreflight]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/schools/${encodeURIComponent(schoolId)}/classrooms`);
        const data = (await res.json().catch(() => ({}))) as {
          classrooms?: Array<{ id?: string; name?: string }>;
        };
        if (cancelled) return;
        const rows = Array.isArray(data.classrooms) ? data.classrooms : [];
        setClassrooms(
          rows
            .map((c) => ({ id: String(c.id || ""), name: String(c.name || "").trim() }))
            .filter((c) => c.id && c.name)
        );
      } catch {
        if (!cancelled) setClassrooms([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  const uiState: ReactivationUiState = useMemo(
    () => ({
      guardians: guardianDecisions,
      family: familyDecision,
      grade,
      className,
      acknowledgeExistingBillingPlan: acknowledgeBillingPlan,
    }),
    [guardianDecisions, familyDecision, grade, className, acknowledgeBillingPlan]
  );

  const goConfirm = () => {
    if (!preflight || submittingRef.current) return;
    const validation = validateReactivationUiState(preflight, uiState);
    if (!validation.ok) {
      setSubmitError(validation.message);
      return;
    }
    setSubmitError("");
    setStep("confirm");
  };

  const submit = async () => {
    if (!preflight || submittingRef.current) return;
    const validation = validateReactivationUiState(preflight, uiState);
    if (!validation.ok) {
      setSubmitError(validation.message);
      setStep("decisions");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    try {
      const dto = buildReactivationDecisionDto(preflight, uiState);
      const reactivation = await reactivateHistoricalLearner(applicationId, dto);
      setResult(reactivation);
      setStep("success");
      onSuccess();
    } catch (err) {
      const apiErr = err as StaffAdmissionsApiError;
      setSubmitError(apiErr.message || "Reactivation failed");
      setStep("decisions");
      if (
        apiErr.code === "HISTORICAL_LEARNER_ALREADY_REACTIVATED" ||
        apiErr.code === "AMBIGUOUS_HISTORICAL_LEARNER_MATCH" ||
        apiErr.code === "LEARNER_IDENTITY_CONFLICT"
      ) {
        await loadPreflight();
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const titleId = "reactivate-historical-title";

  return (
    <div className="admissions-staff-modal-backdrop" role="presentation" onClick={safeClose}>
      <div
        className="admissions-staff-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="admissions-staff-modal-close" onClick={safeClose}>
          ×
        </button>

        {step === "loading" ? (
          <>
            <h2 id={titleId} className="admissions-staff-modal-title">
              Reactivate Existing Learner
            </h2>
            <p className="admissions-staff-modal-subtitle">Loading reactivation preflight…</p>
          </>
        ) : null}

        {loadError ? (
          <div className="admissions-staff-alert admissions-staff-alert--error">{loadError}</div>
        ) : null}

        {step === "blocked" && preflight ? (
          <>
            <h2 id={titleId} className="admissions-staff-modal-title">
              Historical reactivation blocked
            </h2>
            {preflight.blockers.map((b) => (
              <p key={b.code} className="admissions-staff-blocker" role="alert">
                {describeReactivationBlocker(b.code, b.message)}
              </p>
            ))}
            {preflight.blockers.some((b) => b.code === "AMBIGUOUS_HISTORICAL_LEARNER_MATCH") ? (
              <p className="admissions-staff-match-warning">
                Multiple possible historical learner records were found. Staff must resolve records
                manually. Reactivation is not available.
              </p>
            ) : null}
            <div className="admissions-staff-modal-actions">
              <button type="button" className="admissions-staff-btn admissions-staff-btn--outline" onClick={safeClose}>
                Close
              </button>
            </div>
          </>
        ) : null}

        {step === "decisions" && preflight?.historicalLearner ? (
          <>
            <h2 id={titleId} className="admissions-staff-modal-title">
              Reactivate Existing Learner
            </h2>
            <p className="admissions-staff-modal-subtitle">
              HISTORICAL LEARNER FOUND — no duplicate learner will be created.
            </p>

            {submitError ? (
              <div className="admissions-staff-alert admissions-staff-alert--error">{submitError}</div>
            ) : null}

            {preflight.warnings.map((w) => (
              <p key={w.code} className="admissions-staff-match-warning">
                Warning: {w.message}
              </p>
            ))}
            {preflight.identityWarnings.map((w) => (
              <p key={w.code} className="admissions-staff-match-warning">
                Identity: {w.message}
              </p>
            ))}

            <section className="admissions-staff-modal-section">
              <h3 className="admissions-staff-modal-section-title">Historical learner</h3>
              <p>
                {preflight.historicalLearner.firstName} {preflight.historicalLearner.lastName}
              </p>
              <p>Admission no: {preflight.historicalLearner.admissionNo || "—"} (preserved)</p>
              <p>
                Old placement: {preflight.historicalLearner.historicalGrade || "—"}
                {preflight.historicalLearner.historicalClassName
                  ? ` / ${preflight.historicalLearner.historicalClassName}`
                  : ""}
              </p>
              {preflight.match ? (
                <p>
                  Match: {preflight.match.matchReason === "idNumber" ? "Exact ID" : "Name + DOB"}{" "}
                  (strong)
                  {preflight.match.caution === "NAME_DOB" ? " — extra caution required" : ""}
                </p>
              ) : null}
            </section>

            <section className="admissions-staff-modal-section">
              <h3 className="admissions-staff-modal-section-title">Family</h3>
              {preflight.currentFamily ? (
                <p>
                  Current: {preflight.currentFamily.familyName} ({preflight.currentFamily.accountRef})
                </p>
              ) : null}
              {(preflight.finance.warningCode === "FAMILY_POSITIVE_BALANCE" ||
                preflight.finance.warningCode === "FAMILY_CREDIT_BALANCE") &&
              preflight.finance.warningMessage ? (
                <p className="admissions-staff-blocker" role="alert">
                  {preflight.finance.warningMessage}
                </p>
              ) : null}
              <label className="admissions-staff-filter">
                <span className="admissions-staff-filter-label">Family decision</span>
                <select
                  className="admissions-staff-select"
                  value={familyDecision.mode}
                  onChange={(e) =>
                    setFamilyDecision((prev) => ({
                      ...prev,
                      mode: e.target.value as ReactivationFamilyUiDecision["mode"],
                    }))
                  }
                >
                  <option value="KEEP_EXISTING">Keep existing family</option>
                  <option value="USE_EXISTING">Use another existing family</option>
                </select>
              </label>
              {familyDecision.mode === "USE_EXISTING" ? (
                <>
                  <label className="admissions-staff-filter">
                    <span className="admissions-staff-filter-label">Existing family</span>
                    <select
                      className="admissions-staff-select"
                      value={familyDecision.familyAccountId || ""}
                      onChange={(e) =>
                        setFamilyDecision((prev) => ({
                          ...prev,
                          familyAccountId: e.target.value,
                        }))
                      }
                    >
                      <option value="">Select…</option>
                      {preflight.family.candidates.map((c) => (
                        <option key={c.familyAccountId} value={c.familyAccountId}>
                          {c.familyName} ({c.accountRef}){c.isCurrent ? " — current" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  {familyDecision.familyAccountId &&
                  familyDecision.familyAccountId !== preflight.currentFamily?.familyAccountId ? (
                    <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                      <input
                        type="checkbox"
                        checked={Boolean(familyDecision.acknowledgeHistoricalFamilyChange)}
                        onChange={(e) =>
                          setFamilyDecision((prev) => ({
                            ...prev,
                            acknowledgeHistoricalFamilyChange: e.target.checked,
                          }))
                        }
                      />
                      <span>
                        I understand the learner pointer will change, old ledger history stays on the
                        previous FamilyAccount, invoices/payments are not migrated, and old Parent
                        rows are not moved automatically.
                      </span>
                    </label>
                  ) : null}
                </>
              ) : null}
              <p className="admissions-staff-match-warning">CREATE_NEW family is not available here.</p>
            </section>

            <section className="admissions-staff-modal-section">
              <h3 className="admissions-staff-modal-section-title">Existing guardian links</h3>
              <p className="admissions-staff-match-warning">
                {preflight.preserveExistingParentLinksWarning.message}
              </p>
              {preflight.existingParentLinks.length === 0 ? (
                <p>No existing links.</p>
              ) : (
                preflight.existingParentLinks.map((p) => (
                  <p key={p.parentId}>
                    {p.firstName} {p.surname}
                    {p.isPrimary ? " · Primary" : ""}
                    {p.isPayingPerson ? " · Paying" : ""}
                  </p>
                ))
              )}
            </section>

            <section className="admissions-staff-modal-section">
              <h3 className="admissions-staff-modal-section-title">Application guardians</h3>
              {preflight.guardians.map((g) => {
                const decision = guardianDecisions[g.admissionGuardianId] || { mode: "" };
                return (
                  <div key={g.admissionGuardianId} style={{ marginBottom: 12 }}>
                    <p style={{ margin: "0 0 4px", fontWeight: 700 }}>
                      {g.firstName} {g.surname}
                      {g.alreadyLinkedToLearner ? " · already linked" : ""}
                    </p>
                    {g.matchStrength === "STRONG" ? (
                      <p className="admissions-staff-match-strong">Strong match — must LINK_EXISTING</p>
                    ) : null}
                    {g.matchStrength === "PROBABLE" ? (
                      <p className="admissions-staff-match-warning">Probable match — review required</p>
                    ) : null}
                    <select
                      className="admissions-staff-select"
                      value={decision.mode}
                      onChange={(e) =>
                        setGuardianDecisions((prev) => ({
                          ...prev,
                          [g.admissionGuardianId]: {
                            ...prev[g.admissionGuardianId],
                            mode: e.target.value as ReactivationGuardianUiDecision["mode"],
                          },
                        }))
                      }
                    >
                      <option value="">Choose…</option>
                      <option value="LINK_EXISTING">Link existing</option>
                      <option value="CREATE_NEW" disabled={g.matchStrength === "STRONG"}>
                        Create new
                      </option>
                    </select>
                    {decision.mode === "LINK_EXISTING" ? (
                      <select
                        className="admissions-staff-select"
                        style={{ marginTop: 6 }}
                        value={decision.existingParentId || ""}
                        onChange={(e) =>
                          setGuardianDecisions((prev) => ({
                            ...prev,
                            [g.admissionGuardianId]: {
                              ...prev[g.admissionGuardianId],
                              mode: "LINK_EXISTING",
                              existingParentId: e.target.value,
                            },
                          }))
                        }
                      >
                        <option value="">Select parent…</option>
                        {g.candidates.map((c) => (
                          <option key={c.parentId} value={c.parentId}>
                            {c.firstName} {c.surname}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    {decision.mode === "CREATE_NEW" && g.matchStrength === "PROBABLE" ? (
                      <label style={{ display: "flex", gap: 8, marginTop: 6 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(decision.confirmCreateDespiteMatch)}
                          onChange={(e) =>
                            setGuardianDecisions((prev) => ({
                              ...prev,
                              [g.admissionGuardianId]: {
                                ...prev[g.admissionGuardianId],
                                mode: "CREATE_NEW",
                                confirmCreateDespiteMatch: e.target.checked,
                              },
                            }))
                          }
                        />
                        <span>Confirm create despite probable match</span>
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </section>

            <section className="admissions-staff-modal-section">
              <h3 className="admissions-staff-modal-section-title">Current placement</h3>
              <p className="admissions-staff-match-warning">
                Historical grade/class is not reused automatically — confirm current grade.
              </p>
              <label className="admissions-staff-filter">
                <span className="admissions-staff-filter-label">Grade (required)</span>
                <input
                  className="admissions-staff-input"
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                />
              </label>
              <label className="admissions-staff-filter">
                <span className="admissions-staff-filter-label">Class (optional)</span>
                <select
                  className="admissions-staff-select"
                  value={className}
                  onChange={(e) => setClassName(e.target.value)}
                >
                  <option value="">None</option>
                  {classrooms.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            {preflight.billingPlan.requiresAcknowledgeExistingBillingPlan ? (
              <section className="admissions-staff-modal-section">
                <h3 className="admissions-staff-modal-section-title">Billing plan warning</h3>
                <p className="admissions-staff-blocker" role="alert">
                  This learner has an existing billing plan from the historical enrolment. Review the
                  plan before the next invoice run.
                </p>
                {preflight.billingPlan.summary.length ? (
                  <ul>
                    {preflight.billingPlan.summary.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : null}
                <label style={{ display: "flex", gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={acknowledgeBillingPlan}
                    onChange={(e) => setAcknowledgeBillingPlan(e.target.checked)}
                  />
                  <span>
                    I understand this plan must be reviewed before the next invoice run (this does not
                    mean the plan is correct).
                  </span>
                </label>
              </section>
            ) : null}

            <div className="admissions-staff-modal-actions">
              <button type="button" className="admissions-staff-btn admissions-staff-btn--outline" onClick={safeClose}>
                Cancel
              </button>
              <button
                type="button"
                className="admissions-staff-btn admissions-staff-btn--gold"
                onClick={goConfirm}
              >
                Review & confirm
              </button>
            </div>
          </>
        ) : null}

        {step === "confirm" && preflight?.historicalLearner ? (
          <>
            <h2 id={titleId} className="admissions-staff-modal-title">
              YOU ARE REACTIVATING AN EXISTING LEARNER
            </h2>
            {submitError ? (
              <div className="admissions-staff-alert admissions-staff-alert--error">{submitError}</div>
            ) : null}
            <ul>
              <li>
                Learner: {preflight.historicalLearner.firstName}{" "}
                {preflight.historicalLearner.lastName}
              </li>
              <li>Admission number preserved: {preflight.historicalLearner.admissionNo || "—"}</li>
              <li>
                Family:{" "}
                {familyDecision.mode === "KEEP_EXISTING"
                  ? "retained"
                  : familyDecision.familyAccountId === preflight.currentFamily?.familyAccountId
                    ? "retained"
                    : "switched (ledger stays on old account)"}
              </li>
              <li>
                Placement: {grade}
                {className ? ` / ${className}` : ""}
              </li>
              <li>Existing guardian links preserved</li>
              {preflight.finance.warningMessage ? <li>{preflight.finance.warningMessage}</li> : null}
              {preflight.billingPlan.warningMessage ? (
                <li>{preflight.billingPlan.warningMessage}</li>
              ) : null}
            </ul>
            <p className="admissions-staff-match-warning">
              No duplicate learner will be created. No invoice will be generated. No Parent Portal
              message will be sent. No admission fee will be posted to the family ledger.
            </p>
            <div className="admissions-staff-modal-actions">
              <button
                type="button"
                className="admissions-staff-btn admissions-staff-btn--outline"
                disabled={submitting}
                onClick={() => setStep("decisions")}
              >
                Back
              </button>
              <button
                type="button"
                className="admissions-staff-btn admissions-staff-btn--gold"
                disabled={submitting}
                onClick={() => void submit()}
              >
                {submitting ? "Reactivating…" : "Confirm reactivation"}
              </button>
            </div>
          </>
        ) : null}

        {step === "success" && result ? (
          <>
            <h2 id={titleId} className="admissions-staff-modal-title">
              Learner reactivated
            </h2>
            {isReactivationFinanceBaselineWarningOnly(result) ? (
              <div className="admissions-staff-alert admissions-staff-alert--warning">
                Reactivation succeeded, but finance baseline sync failed. Do not reactivate again —
                finance can be reconciled separately.
              </div>
            ) : (
              <div className="admissions-staff-alert admissions-staff-alert--success">
                Historical learner is now active and linked to this application.
              </div>
            )}
            <div className="admissions-staff-modal-actions">
              {result.learnerId && onOpenLearner ? (
                <button
                  type="button"
                  className="admissions-staff-btn admissions-staff-btn--outline"
                  onClick={() => onOpenLearner(result.learnerId)}
                >
                  View learner
                </button>
              ) : null}
              <button type="button" className="admissions-staff-btn admissions-staff-btn--gold" onClick={safeClose}>
                Done
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
