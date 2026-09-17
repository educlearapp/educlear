import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  clearApplicantSession,
  readApplicantSession,
  writeApplicantSession,
} from "./applicantSession";
import {
  buildUpdateDraftBody,
  createEmptyDraftForm,
  emptyGuardianRow,
  hasClientErrors,
  hydrateDraftFormFromApplication,
  setPayingGuardian,
  setPrimaryGuardian,
  validateDraftFormClient,
  type DraftFormClientErrors,
} from "./draftFormState";
import {
  createPublicDraftApplication,
  fetchPublicAdmissionsConfig,
  fetchPublicDraftApplication,
  PublicAdmissionsApiError,
  updatePublicDraftApplication,
} from "./publicAdmissionsApi";
import PublicAdmissionsDocumentsStep from "./PublicAdmissionsDocumentsStep";
import PublicAdmissionsLayout from "./PublicAdmissionsLayout";
import PublicAdmissionsReviewStep from "./PublicAdmissionsReviewStep";
import PublicAdmissionsStatusView from "./PublicAdmissionsStatusView";
import { isEditableDraftStatus, isPostSubmitStatus } from "./reviewReadiness";
import type {
  ApplicantApplicationView,
  ApplyWizardStep,
  DraftApplicationFormState,
  DraftSaveUiState,
  PublicAdmissionsConfig,
} from "./publicAdmissionsTypes";
import "./publicAdmissions.css";

type ApplyPhase =
  | "booting"
  | "need_start"
  | "creating"
  | "loading_resume"
  | "form"
  | "session_invalid"
  | "closed"
  | "config_error"
  | "not_found";

function parentFacingCreateError(err: unknown): { kind: "closed" | "error"; message: string } {
  if (err instanceof PublicAdmissionsApiError) {
    if (err.code === "ADMISSIONS_CLOSED" || err.status === 403) {
      return {
        kind: "closed",
        message:
          "Applications are no longer open. Please contact the school if you need further assistance.",
      };
    }
    if (err.status === 404) {
      return {
        kind: "error",
        message: "Admissions are unavailable for this link.",
      };
    }
  }
  return {
    kind: "error",
    message: "We could not start your application right now. Please try again shortly.",
  };
}

function FieldError({ id, message }: { id?: string; message?: string }) {
  if (!message) return null;
  return (
    <p className="pa-field-error" id={id} role="alert">
      {message}
    </p>
  );
}

/**
 * OA-06C/D/E/F draft → review → submit → status + payment.
 */
export default function PublicAdmissionsApplyPage() {
  const { publicSlug = "" } = useParams<{ publicSlug: string }>();
  const slug = String(publicSlug || "").trim().toLowerCase();
  const formId = useId();

  const [phase, setPhase] = useState<ApplyPhase>("booting");
  const [activeStep, setActiveStep] = useState<ApplyWizardStep>("details");
  const [config, setConfig] = useState<PublicAdmissionsConfig | null>(null);
  const [form, setForm] = useState<DraftApplicationFormState>(() => createEmptyDraftForm(null));
  const [application, setApplication] = useState<ApplicantApplicationView | null>(null);
  const [publicAccessId, setPublicAccessId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<DraftSaveUiState>("clean");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [clientErrors, setClientErrors] = useState<DraftFormClientErrors>({});
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [stepNavBusy, setStepNavBusy] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [statusRefreshing, setStatusRefreshing] = useState(false);

  const createInFlight = useRef(false);
  const bootGeneration = useRef(0);

  useEffect(() => {
    const gen = ++bootGeneration.current;
    let cancelled = false;

    setPhase("booting");
    setActiveStep("details");
    setBannerError(null);
    setSaveState("clean");
    setSaveMessage(null);
    setClientErrors({});
    setPublicAccessId(null);
    setAccessToken(null);
    setApplication(null);
    setJustSubmitted(false);

    if (!slug) {
      setPhase("not_found");
      return;
    }

    void (async () => {
      try {
        const nextConfig = await fetchPublicAdmissionsConfig(slug);
        if (cancelled || bootGeneration.current !== gen) return;
        setConfig(nextConfig);

        const session = readApplicantSession(slug);
        if (session) {
          setPhase("loading_resume");
          try {
            const application = await fetchPublicDraftApplication(
              slug,
              session.publicAccessId,
              session.accessToken
            );
            if (cancelled || bootGeneration.current !== gen) return;
            setPublicAccessId(session.publicAccessId);
            setAccessToken(session.accessToken);
            setApplication(application);
            setForm(hydrateDraftFormFromApplication(application, nextConfig));
            setSaveState("clean");
            if (isPostSubmitStatus(application.status)) {
              setJustSubmitted(false);
              setPhase("form");
              setActiveStep("review");
            } else {
              setPhase("form");
            }
          } catch {
            if (cancelled || bootGeneration.current !== gen) return;
            clearApplicantSession(slug);
            setPublicAccessId(null);
            setAccessToken(null);
            setPhase("session_invalid");
          }
          return;
        }

        setForm(createEmptyDraftForm(nextConfig));
        setPhase("need_start");
      } catch (err) {
        if (cancelled || bootGeneration.current !== gen) return;
        if (err instanceof PublicAdmissionsApiError && err.status === 404) {
          setPhase("not_found");
        } else {
          setPhase("config_error");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function handleBeginApplication() {
    if (!slug || createInFlight.current || phase === "creating") return;
    createInFlight.current = true;
    setPhase("creating");
    setBannerError(null);
    try {
      const intakeYear =
        config?.intakeYear != null && Number.isFinite(Number(config.intakeYear))
          ? Number(config.intakeYear)
          : undefined;
      const created = await createPublicDraftApplication(slug, {
        ...(intakeYear != null ? { intakeYear } : {}),
      });
      writeApplicantSession({
        publicSlug: slug,
        publicAccessId: created.application.publicAccessId,
        accessToken: created.accessToken,
        accessTokenExpiresAt: created.accessTokenExpiresAt,
      });
      setPublicAccessId(created.application.publicAccessId);
      setAccessToken(created.accessToken);
      setApplication(created.application);
      setForm(hydrateDraftFormFromApplication(created.application, config));
      setSaveState("clean");
      setPhase("form");
      setActiveStep("details");
    } catch (err) {
      const mapped = parentFacingCreateError(err);
      if (mapped.kind === "closed") {
        setPhase("closed");
        setBannerError(mapped.message);
      } else {
        setPhase("need_start");
        setBannerError(mapped.message);
      }
    } finally {
      createInFlight.current = false;
    }
  }

  function markDirty(
    updater: (prev: DraftApplicationFormState) => DraftApplicationFormState
  ) {
    setForm(updater);
    setSaveState((prev) => (prev === "saving" ? prev : "dirty"));
    setSaveMessage(null);
  }

  async function handleSave(opts?: { silent?: boolean }): Promise<boolean> {
    if (!slug || !publicAccessId || !accessToken || saveState === "saving") return false;
    const grades = Array.isArray(config?.acceptedGrades) ? config!.acceptedGrades : [];
    const errors = validateDraftFormClient(form, grades);
    setClientErrors(errors);
    if (hasClientErrors(errors)) {
      setSaveState("dirty");
      setSaveMessage("Please fix the highlighted fields before saving.");
      setActiveStep("details");
      return false;
    }

    setSaveState("saving");
    setSaveMessage(null);
    setBannerError(null);
    try {
      const updated = await updatePublicDraftApplication(
        slug,
        publicAccessId,
        accessToken,
        buildUpdateDraftBody(form)
      );
      setApplication(updated);
      setForm(hydrateDraftFormFromApplication(updated, config));
      setSaveState("saved");
      if (!opts?.silent) {
        setSaveMessage("Saved. You can continue later on this device.");
      }
      return true;
    } catch (err) {
      if (err instanceof PublicAdmissionsApiError && err.status === 404) {
        clearApplicantSession(slug);
        setPhase("session_invalid");
        setSaveState("failed");
        setSaveMessage(null);
        return false;
      }
      setSaveState("failed");
      setSaveMessage(
        "We could not save your progress. Your entries are still on this screen — please try again."
      );
      return false;
    }
  }

  async function goToDocumentsStep() {
    if (stepNavBusy) return;
    if (saveState === "dirty" || saveState === "failed") {
      setStepNavBusy(true);
      const ok = await handleSave({ silent: true });
      setStepNavBusy(false);
      if (!ok) {
        setSaveMessage(
          (prev) =>
            prev ||
            "Please save your details successfully before continuing to documents."
        );
        return;
      }
    }
    setActiveStep("documents");
  }

  async function goToReviewStep() {
    if (stepNavBusy) return;
    if (saveState === "dirty" || saveState === "failed") {
      setStepNavBusy(true);
      const ok = await handleSave({ silent: true });
      setStepNavBusy(false);
      if (!ok) {
        setSaveMessage(
          (prev) =>
            prev || "Please save your details successfully before continuing to review."
        );
        return;
      }
    }
    // Refresh authoritative application before review
    if (slug && publicAccessId && accessToken) {
      try {
        const fresh = await fetchPublicDraftApplication(slug, publicAccessId, accessToken);
        setApplication(fresh);
        setForm(hydrateDraftFormFromApplication(fresh, config));
        if (!isEditableDraftStatus(fresh.status)) {
          setJustSubmitted(false);
          setActiveStep("review");
          return;
        }
      } catch (err) {
        if (err instanceof PublicAdmissionsApiError && err.status === 404) {
          handleDocumentsSessionInvalid();
          return;
        }
      }
    }
    setActiveStep("review");
  }

  const handleDocumentsSessionInvalid = useCallback(() => {
    clearApplicantSession(slug);
    setPhase("session_invalid");
  }, [slug]);

  async function refreshStatus() {
    if (!slug || !publicAccessId || !accessToken || statusRefreshing) return;
    setStatusRefreshing(true);
    try {
      const fresh = await fetchPublicDraftApplication(slug, publicAccessId, accessToken);
      setApplication(fresh);
      setJustSubmitted(false);
    } catch (err) {
      if (err instanceof PublicAdmissionsApiError && err.status === 404) {
        handleDocumentsSessionInvalid();
      }
    } finally {
      setStatusRefreshing(false);
    }
  }

  function handleStartNewAfterStale() {
    clearApplicantSession(slug);
    setPublicAccessId(null);
    setAccessToken(null);
    setForm(createEmptyDraftForm(config));
    setSaveState("clean");
    setBannerError(null);
    setPhase("need_start");
  }

  function addGuardian() {
    markDirty((prev) => ({
      ...prev,
      guardians: [...prev.guardians, emptyGuardianRow()],
    }));
  }

  function removeGuardian(clientKey: string) {
    markDirty((prev) => {
      if (prev.guardians.length <= 1) return prev;
      let next = prev.guardians.filter((g) => g.clientKey !== clientKey);
      if (!next.some((g) => g.isPrimary) && next[0]) {
        next = setPrimaryGuardian(next, next[0].clientKey);
      }
      if (!next.some((g) => g.isPayingPerson) && next[0]) {
        next = setPayingGuardian(next, next[0].clientKey);
      }
      return { ...prev, guardians: next };
    });
  }

  const acceptedGrades = Array.isArray(config?.acceptedGrades)
    ? config!.acceptedGrades.map((g) => String(g)).filter(Boolean)
    : [];

  const saveStatusText =
    saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? "Saved"
        : saveState === "failed"
          ? "Save failed"
          : saveState === "dirty"
            ? "Unsaved changes"
            : "All changes saved";

  if (phase === "booting" || phase === "loading_resume") {
    return (
      <PublicAdmissionsLayout config={config}>
        <section className="pa-card" aria-busy="true" aria-live="polite">
          <h2 className="pa-section-title">
            {phase === "loading_resume" ? "Loading your application" : "Loading admissions"}
          </h2>
          <p className="pa-body">Please wait…</p>
        </section>
      </PublicAdmissionsLayout>
    );
  }

  if (phase === "not_found") {
    return (
      <PublicAdmissionsLayout config={null}>
        <section className="pa-card">
          <h2 className="pa-section-title">Admissions unavailable</h2>
          <p className="pa-body">
            We could not find an admissions page for this link.
          </p>
        </section>
      </PublicAdmissionsLayout>
    );
  }

  if (phase === "config_error") {
    return (
      <PublicAdmissionsLayout config={config}>
        <section className="pa-card">
          <h2 className="pa-section-title">Temporarily unavailable</h2>
          <p className="pa-body">
            We could not load admissions information right now. Please try again shortly.
          </p>
          {slug ? (
            <p className="pa-body">
              <Link to={`/admissions/${encodeURIComponent(slug)}`} className="pa-text-link">
                Back to admissions information
              </Link>
            </p>
          ) : null}
        </section>
      </PublicAdmissionsLayout>
    );
  }

  if (phase === "closed") {
    return (
      <PublicAdmissionsLayout config={config}>
        <section className="pa-card">
          <h2 className="pa-section-title">Applications are no longer open</h2>
          <p className="pa-body">
            {bannerError ||
              "Applications are currently closed. Please contact the school if you need help."}
          </p>
          {slug ? (
            <p className="pa-body">
              <Link to={`/admissions/${encodeURIComponent(slug)}`} className="pa-text-link">
                Back to admissions information
              </Link>
            </p>
          ) : null}
        </section>
      </PublicAdmissionsLayout>
    );
  }

  if (phase === "session_invalid") {
    return (
      <PublicAdmissionsLayout config={config}>
        <section className="pa-card" data-testid="pa-session-invalid">
          <h2 className="pa-section-title">Application session unavailable</h2>
          <p className="pa-body">
            We could not reopen a previous application from this device. Application recovery
            (email or SMS link) is not available yet. You may start a new application if
            admissions are still open.
          </p>
          <div className="pa-cta-row pa-cta-row--stack">
            <button
              type="button"
              className="pa-cta"
              onClick={handleStartNewAfterStale}
              data-testid="pa-start-new-application"
            >
              Start New Application
            </button>
            {slug ? (
              <Link
                to={`/admissions/${encodeURIComponent(slug)}`}
                className="pa-text-link"
              >
                Back to admissions information
              </Link>
            ) : null}
          </div>
        </section>
      </PublicAdmissionsLayout>
    );
  }

  if (phase === "need_start" || phase === "creating") {
    return (
      <PublicAdmissionsLayout config={config}>
        <section className="pa-card" data-testid="pa-begin-application">
          <nav className="pa-progress" aria-label="Application progress">
            <ol className="pa-progress-list pa-progress-list--3">
              <li className="pa-progress-item is-active">Details</li>
              <li className="pa-progress-item" aria-disabled="true">
                Documents
              </li>
              <li className="pa-progress-item" aria-disabled="true">
                Review
              </li>
            </ol>
          </nav>
          <h2 className="pa-section-title">Start your application</h2>
          <p className="pa-body">
            You are about to begin a draft application
            {config?.intakeYear != null ? ` for the ${config.intakeYear} intake` : ""}. Your
            progress can be saved on this device. No application is created until you confirm
            below.
          </p>
          {bannerError ? (
            <p className="pa-banner-error" role="alert">
              {bannerError}
            </p>
          ) : null}
          <div className="pa-cta-row pa-cta-row--stack">
            <button
              type="button"
              className="pa-cta"
              onClick={() => void handleBeginApplication()}
              disabled={phase === "creating"}
              data-testid="pa-begin-draft"
            >
              {phase === "creating" ? "Starting…" : "Begin Application"}
            </button>
            {slug ? (
              <Link
                to={`/admissions/${encodeURIComponent(slug)}`}
                className="pa-text-link"
              >
                Back to admissions information
              </Link>
            ) : null}
          </div>
        </section>
      </PublicAdmissionsLayout>
    );
  }

  // form phase
  const showPostSubmit =
    application != null && isPostSubmitStatus(application.status);

  return (
    <PublicAdmissionsLayout config={config}>
      <div className="pa-apply" data-testid="pa-draft-form">
        {!showPostSubmit ? (
          <nav className="pa-progress" aria-label="Application progress">
            <ol className="pa-progress-list pa-progress-list--3">
              <li>
                <button
                  type="button"
                  className={`pa-progress-item ${activeStep === "details" ? "is-active" : ""}`}
                  onClick={() => setActiveStep("details")}
                  data-testid="pa-step-details"
                >
                  Details
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`pa-progress-item ${activeStep === "documents" ? "is-active" : ""}`}
                  onClick={() => void goToDocumentsStep()}
                  disabled={stepNavBusy || saveState === "saving"}
                  data-testid="pa-step-documents"
                >
                  Documents
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`pa-progress-item ${activeStep === "review" ? "is-active" : ""}`}
                  onClick={() => void goToReviewStep()}
                  disabled={stepNavBusy || saveState === "saving"}
                  data-testid="pa-step-review"
                >
                  Review
                </button>
              </li>
            </ol>
          </nav>
        ) : null}

        {showPostSubmit && application && publicAccessId && accessToken ? (
          <PublicAdmissionsStatusView
            application={application}
            config={config}
            justSubmitted={justSubmitted}
            onRefresh={() => void refreshStatus()}
            refreshing={statusRefreshing}
            publicSlug={slug}
            publicAccessId={publicAccessId}
            accessToken={accessToken}
            onSessionInvalid={handleDocumentsSessionInvalid}
          />
        ) : activeStep === "documents" && publicAccessId && accessToken ? (
          <PublicAdmissionsDocumentsStep
            publicSlug={slug}
            publicAccessId={publicAccessId}
            accessToken={accessToken}
            config={config}
            onSessionInvalid={handleDocumentsSessionInvalid}
            onBackToDetails={() => setActiveStep("details")}
          />
        ) : activeStep === "review" && publicAccessId && accessToken && application ? (
          <PublicAdmissionsReviewStep
            publicSlug={slug}
            publicAccessId={publicAccessId}
            accessToken={accessToken}
            config={config}
            application={application}
            onApplicationUpdated={(next) => {
              setApplication(next);
              setForm(hydrateDraftFormFromApplication(next, config));
            }}
            onSubmitted={(next) => {
              setApplication(next);
              setJustSubmitted(true);
              setSaveState("clean");
            }}
            onEditDetails={() => setActiveStep("details")}
            onEditDocuments={() => setActiveStep("documents")}
            onSessionInvalid={handleDocumentsSessionInvalid}
          />
        ) : (
          <>
        <div className="pa-save-bar" aria-live="polite">
          <span
            className={`pa-save-status pa-save-status--${saveState}`}
            data-testid="pa-save-status"
          >
            {saveStatusText}
          </span>
          {saveMessage ? <span className="pa-save-message">{saveMessage}</span> : null}
        </div>

        <form
          id={formId}
          className="pa-form"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
          noValidate
        >
          <section className="pa-card" aria-labelledby={`${formId}-learner`}>
            <h2 id={`${formId}-learner`} className="pa-section-title">
              Learner
            </h2>
            <p className="pa-body">
              Intake year:{" "}
              <strong data-testid="pa-intake-year">
                {form.intakeYear != null ? form.intakeYear : "—"}
              </strong>
            </p>

            <div className="pa-field-grid">
              <div className="pa-field">
                <label htmlFor={`${formId}-firstName`}>
                  First name <span className="pa-req">*</span>
                </label>
                <input
                  id={`${formId}-firstName`}
                  name="learnerFirstName"
                  autoComplete="given-name"
                  value={form.learner.firstName}
                  aria-invalid={Boolean(clientErrors.learnerFirstName)}
                  aria-describedby={
                    clientErrors.learnerFirstName ? `${formId}-firstName-err` : undefined
                  }
                  onChange={(e) =>
                    markDirty((prev) => ({
                      ...prev,
                      learner: { ...prev.learner, firstName: e.target.value },
                    }))
                  }
                />
                <FieldError
                  id={`${formId}-firstName-err`}
                  message={clientErrors.learnerFirstName}
                />
              </div>

              <div className="pa-field">
                <label htmlFor={`${formId}-lastName`}>
                  Surname <span className="pa-req">*</span>
                </label>
                <input
                  id={`${formId}-lastName`}
                  name="learnerLastName"
                  autoComplete="family-name"
                  value={form.learner.lastName}
                  aria-invalid={Boolean(clientErrors.learnerLastName)}
                  aria-describedby={
                    clientErrors.learnerLastName ? `${formId}-lastName-err` : undefined
                  }
                  onChange={(e) =>
                    markDirty((prev) => ({
                      ...prev,
                      learner: { ...prev.learner, lastName: e.target.value },
                    }))
                  }
                />
                <FieldError
                  id={`${formId}-lastName-err`}
                  message={clientErrors.learnerLastName}
                />
              </div>

              <div className="pa-field">
                <label htmlFor={`${formId}-grade`}>
                  Grade applying for{" "}
                  {acceptedGrades.length > 0 ? <span className="pa-req">*</span> : null}
                </label>
                {acceptedGrades.length > 0 ? (
                  <select
                    id={`${formId}-grade`}
                    name="requestedGrade"
                    value={form.requestedGrade}
                    aria-invalid={Boolean(clientErrors.requestedGrade)}
                    aria-describedby={
                      clientErrors.requestedGrade ? `${formId}-grade-err` : undefined
                    }
                    data-testid="pa-grade-select"
                    onChange={(e) =>
                      markDirty((prev) => ({
                        ...prev,
                        requestedGrade: e.target.value,
                      }))
                    }
                  >
                    <option value="">Select a grade</option>
                    {acceptedGrades.map((grade) => (
                      <option key={grade} value={grade}>
                        {grade}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="pa-body">No grades are currently listed for this intake.</p>
                )}
                <FieldError
                  id={`${formId}-grade-err`}
                  message={clientErrors.requestedGrade}
                />
              </div>

              <div className="pa-field">
                <label htmlFor={`${formId}-dob`}>Date of birth</label>
                <input
                  id={`${formId}-dob`}
                  name="birthDate"
                  type="date"
                  value={form.learner.birthDate}
                  onChange={(e) =>
                    markDirty((prev) => ({
                      ...prev,
                      learner: { ...prev.learner, birthDate: e.target.value },
                    }))
                  }
                />
              </div>

              <div className="pa-field">
                <label htmlFor={`${formId}-id`}>ID / passport number</label>
                <input
                  id={`${formId}-id`}
                  name="idNumber"
                  value={form.learner.idNumber}
                  onChange={(e) =>
                    markDirty((prev) => ({
                      ...prev,
                      learner: { ...prev.learner, idNumber: e.target.value },
                    }))
                  }
                />
              </div>

              <div className="pa-field">
                <label htmlFor={`${formId}-gender`}>Gender</label>
                <select
                  id={`${formId}-gender`}
                  name="gender"
                  value={form.learner.gender}
                  onChange={(e) =>
                    markDirty((prev) => ({
                      ...prev,
                      learner: { ...prev.learner, gender: e.target.value },
                    }))
                  }
                >
                  <option value="">Prefer not to say / select</option>
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div className="pa-field pa-field--full">
                <label htmlFor={`${formId}-prevSchool`}>Current / previous school</label>
                <input
                  id={`${formId}-prevSchool`}
                  name="previousSchoolName"
                  value={form.learner.previousSchoolName}
                  onChange={(e) =>
                    markDirty((prev) => ({
                      ...prev,
                      learner: { ...prev.learner, previousSchoolName: e.target.value },
                    }))
                  }
                />
              </div>
            </div>
          </section>

          <section className="pa-card" aria-labelledby={`${formId}-guardians`}>
            <h2 id={`${formId}-guardians`} className="pa-section-title">
              Parents / guardians
            </h2>
            <p className="pa-body">
              Add at least one guardian. Mark who is the primary contact and who is responsible
              for fees.
            </p>
            {clientErrors.guardians || clientErrors.primary || clientErrors.payer ? (
              <p className="pa-field-error" role="alert">
                {clientErrors.guardians || clientErrors.primary || clientErrors.payer}
              </p>
            ) : null}

            {form.guardians.map((g, index) => (
              <fieldset key={g.clientKey} className="pa-guardian-card">
                <legend className="pa-guardian-legend">Guardian {index + 1}</legend>
                <div className="pa-field-grid">
                  <div className="pa-field">
                    <label htmlFor={`${formId}-g-${g.clientKey}-first`}>First name</label>
                    <input
                      id={`${formId}-g-${g.clientKey}-first`}
                      value={g.firstName}
                      onChange={(e) =>
                        markDirty((prev) => ({
                          ...prev,
                          guardians: prev.guardians.map((row) =>
                            row.clientKey === g.clientKey
                              ? { ...row, firstName: e.target.value }
                              : row
                          ),
                        }))
                      }
                    />
                  </div>
                  <div className="pa-field">
                    <label htmlFor={`${formId}-g-${g.clientKey}-surname`}>Surname</label>
                    <input
                      id={`${formId}-g-${g.clientKey}-surname`}
                      value={g.surname}
                      onChange={(e) =>
                        markDirty((prev) => ({
                          ...prev,
                          guardians: prev.guardians.map((row) =>
                            row.clientKey === g.clientKey
                              ? { ...row, surname: e.target.value }
                              : row
                          ),
                        }))
                      }
                    />
                  </div>
                  <div className="pa-field">
                    <label htmlFor={`${formId}-g-${g.clientKey}-rel`}>Relationship</label>
                    <input
                      id={`${formId}-g-${g.clientKey}-rel`}
                      value={g.relationship}
                      placeholder="e.g. Mother, Father, Guardian"
                      onChange={(e) =>
                        markDirty((prev) => ({
                          ...prev,
                          guardians: prev.guardians.map((row) =>
                            row.clientKey === g.clientKey
                              ? { ...row, relationship: e.target.value }
                              : row
                          ),
                        }))
                      }
                    />
                  </div>
                  <div className="pa-field">
                    <label htmlFor={`${formId}-g-${g.clientKey}-cell`}>Cell number</label>
                    <input
                      id={`${formId}-g-${g.clientKey}-cell`}
                      type="tel"
                      autoComplete="tel"
                      value={g.cellNo}
                      onChange={(e) =>
                        markDirty((prev) => ({
                          ...prev,
                          guardians: prev.guardians.map((row) =>
                            row.clientKey === g.clientKey
                              ? { ...row, cellNo: e.target.value }
                              : row
                          ),
                        }))
                      }
                    />
                  </div>
                  <div className="pa-field">
                    <label htmlFor={`${formId}-g-${g.clientKey}-email`}>Email</label>
                    <input
                      id={`${formId}-g-${g.clientKey}-email`}
                      type="email"
                      autoComplete="email"
                      value={g.email}
                      onChange={(e) =>
                        markDirty((prev) => ({
                          ...prev,
                          guardians: prev.guardians.map((row) =>
                            row.clientKey === g.clientKey
                              ? { ...row, email: e.target.value }
                              : row
                          ),
                        }))
                      }
                    />
                  </div>
                  <div className="pa-field">
                    <label htmlFor={`${formId}-g-${g.clientKey}-id`}>ID / passport</label>
                    <input
                      id={`${formId}-g-${g.clientKey}-id`}
                      value={g.idNumber}
                      onChange={(e) =>
                        markDirty((prev) => ({
                          ...prev,
                          guardians: prev.guardians.map((row) =>
                            row.clientKey === g.clientKey
                              ? { ...row, idNumber: e.target.value }
                              : row
                          ),
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="pa-guardian-flags">
                  <label className="pa-radio">
                    <input
                      type="radio"
                      name={`${formId}-primary`}
                      checked={g.isPrimary}
                      onChange={() =>
                        markDirty((prev) => ({
                          ...prev,
                          guardians: setPrimaryGuardian(prev.guardians, g.clientKey),
                        }))
                      }
                    />
                    Primary guardian
                  </label>
                  <label className="pa-radio">
                    <input
                      type="radio"
                      name={`${formId}-payer`}
                      checked={g.isPayingPerson}
                      onChange={() =>
                        markDirty((prev) => ({
                          ...prev,
                          guardians: setPayingGuardian(prev.guardians, g.clientKey),
                        }))
                      }
                    />
                    Responsible for fees
                  </label>
                </div>

                {form.guardians.length > 1 ? (
                  <button
                    type="button"
                    className="pa-link-button"
                    onClick={() => removeGuardian(g.clientKey)}
                  >
                    Remove guardian
                  </button>
                ) : null}
              </fieldset>
            ))}

            <button
              type="button"
              className="pa-secondary-btn"
              onClick={addGuardian}
              data-testid="pa-add-guardian"
            >
              Add another guardian
            </button>
          </section>

          <section className="pa-card" aria-labelledby={`${formId}-address`}>
            <h2 id={`${formId}-address`} className="pa-section-title">
              Contact / address
            </h2>
            <div className="pa-field-grid">
              <div className="pa-field pa-field--full">
                <label htmlFor={`${formId}-homeAddress`}>Learner home address</label>
                <textarea
                  id={`${formId}-homeAddress`}
                  name="homeAddress"
                  rows={3}
                  value={form.learner.homeAddress}
                  onChange={(e) =>
                    markDirty((prev) => ({
                      ...prev,
                      learner: { ...prev.learner, homeAddress: e.target.value },
                    }))
                  }
                />
              </div>
              <div className="pa-field">
                <label htmlFor={`${formId}-homeLanguage`}>Home language</label>
                <input
                  id={`${formId}-homeLanguage`}
                  value={form.learner.homeLanguage}
                  onChange={(e) =>
                    markDirty((prev) => ({
                      ...prev,
                      learner: { ...prev.learner, homeLanguage: e.target.value },
                    }))
                  }
                />
              </div>
              <div className="pa-field">
                <label htmlFor={`${formId}-citizenship`}>Citizenship</label>
                <input
                  id={`${formId}-citizenship`}
                  value={form.learner.citizenship}
                  onChange={(e) =>
                    markDirty((prev) => ({
                      ...prev,
                      learner: { ...prev.learner, citizenship: e.target.value },
                    }))
                  }
                />
              </div>
              <div className="pa-field pa-field--full">
                <label htmlFor={`${formId}-g-home`}>
                  Primary guardian address (optional)
                </label>
                <textarea
                  id={`${formId}-g-home`}
                  rows={3}
                  value={form.guardians.find((g) => g.isPrimary)?.homeAddress || ""}
                  onChange={(e) => {
                    const primary = form.guardians.find((g) => g.isPrimary);
                    if (!primary) return;
                    markDirty((prev) => ({
                      ...prev,
                      guardians: prev.guardians.map((row) =>
                        row.clientKey === primary.clientKey
                          ? { ...row, homeAddress: e.target.value }
                          : row
                      ),
                    }));
                  }}
                />
              </div>
            </div>
          </section>

          <section className="pa-card" aria-labelledby={`${formId}-save`}>
            <h2 id={`${formId}-save`} className="pa-section-title">
              Save progress
            </h2>
            <p className="pa-body">
              Save your draft details, then continue to documents and review. Payment
              instructions, if any, become available only after submission.
            </p>
            <div className="pa-cta-row pa-cta-row--stack">
              <button
                type="submit"
                className="pa-cta"
                disabled={saveState === "saving"}
                data-testid="pa-save-draft"
              >
                {saveState === "saving" ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="pa-secondary-btn"
                disabled={saveState === "saving" || stepNavBusy}
                onClick={() => void goToDocumentsStep()}
                data-testid="pa-continue-documents"
              >
                {stepNavBusy ? "Saving…" : "Continue to documents"}
              </button>
              <button
                type="button"
                className="pa-secondary-btn"
                disabled={saveState === "saving" || stepNavBusy}
                onClick={() => void goToReviewStep()}
                data-testid="pa-continue-review"
              >
                Continue to review
              </button>
              <button
                type="button"
                className="pa-secondary-btn"
                disabled={saveState === "saving"}
                onClick={() => void handleSave()}
                data-testid="pa-save-continue-later"
              >
                Save &amp; continue later
              </button>
            </div>
            {slug ? (
              <p className="pa-body">
                <Link to={`/admissions/${encodeURIComponent(slug)}`} className="pa-text-link">
                  Back to admissions information
                </Link>
              </p>
            ) : null}
          </section>
        </form>
          </>
        )}
      </div>
    </PublicAdmissionsLayout>
  );
}
