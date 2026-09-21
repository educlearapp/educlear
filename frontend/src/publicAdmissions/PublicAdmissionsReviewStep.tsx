import { useEffect, useId, useState } from "react";
import {
  buildSupportingDocumentRequirements,
  documentsForType,
  evaluateRequirementApplicability,
  labelForDocumentType,
} from "./documentRequirements";
import {
  listPublicApplicantDocuments,
  PublicAdmissionsApiError,
  submitPublicApplication,
  updatePublicDraftApplication,
} from "./publicAdmissionsApi";
import PublicAdmissionsFinancialAgreement from "./PublicAdmissionsFinancialAgreement";
import {
  deriveSubmitReadiness,
  documentReviewSummary,
  financialAgreementMatchesCurrentDocuments,
  mapValidationDetailsToGuidance,
  parseApplicationQuestions,
  sectionForValidationField,
} from "./reviewReadiness";
import type {
  ApplicantApplicationView,
  ApplicantDocumentView,
  PublicAdmissionsConfig,
  PublicValidationDetail,
} from "./publicAdmissionsTypes";

type Props = {
  publicSlug: string;
  publicAccessId: string;
  accessToken: string;
  config: PublicAdmissionsConfig | null;
  application: ApplicantApplicationView;
  onApplicationUpdated: (application: ApplicantApplicationView) => void;
  onSubmitted: (application: ApplicantApplicationView) => void;
  onEditDetails: () => void;
  onEditDocuments: () => void;
  onSessionInvalid: () => void;
};

function display(value: string | null | undefined): string {
  const v = String(value || "").trim();
  return v || "—";
}

/**
 * OA-06E Review + Submit. No payment / POP calls.
 */
export default function PublicAdmissionsReviewStep({
  publicSlug,
  publicAccessId,
  accessToken,
  config,
  application,
  onApplicationUpdated,
  onSubmitted,
  onEditDetails,
  onEditDocuments,
  onSessionInvalid,
}: Props) {
  const formId = useId();
  const questions = parseApplicationQuestions(config?.applicationQuestions);
  const [documents, setDocuments] = useState<ApplicantDocumentView[]>([]);
  const [listRequiredTypes, setListRequiredTypes] = useState<string[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [privacyAccepted, setPrivacyAccepted] = useState(
    Boolean(application.privacyAcceptedAt)
  );
  const [declarationsAccepted, setDeclarationsAccepted] = useState(
    Boolean(application.declarationsAcceptedAt)
  );
  const [answerValues, setAnswerValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const a of application.answers || []) {
      const v = a.valueJson;
      initial[a.questionKey] = typeof v === "string" ? v : v == null ? "" : String(v);
    }
    return initial;
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitDetails, setSubmitDetails] = useState<PublicValidationDetail[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [clientIssues, setClientIssues] = useState<PublicValidationDetail[]>([]);

  useEffect(() => {
    let cancelled = false;
    setDocsLoading(true);
    void (async () => {
      try {
        const listed = await listPublicApplicantDocuments(
          publicSlug,
          publicAccessId,
          accessToken
        );
        if (cancelled) return;
        setDocuments(listed.documents.filter((d) => !d.isProofOfPayment));
        setListRequiredTypes(listed.requiredDocumentTypes);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof PublicAdmissionsApiError && err.status === 404) {
          onSessionInvalid();
          return;
        }
        setDocuments([]);
      } finally {
        if (!cancelled) setDocsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [publicSlug, publicAccessId, accessToken, onSessionInvalid]);

  useEffect(() => {
    setPrivacyAccepted(Boolean(application.privacyAcceptedAt));
    setDeclarationsAccepted(Boolean(application.declarationsAcceptedAt));
  }, [application.privacyAcceptedAt, application.declarationsAcceptedAt]);

  const readiness = deriveSubmitReadiness({
    application,
    config,
    privacyAccepted,
    declarationsAccepted,
    answerValues,
  });
  const docSummary = documentReviewSummary({
    config,
    documents,
    listRequiredDocumentTypes: listRequiredTypes,
    learnerCitizenship: application.learner?.citizenship,
  });
  const requirements = buildSupportingDocumentRequirements({
    config,
    listRequiredDocumentTypes: listRequiredTypes,
  });
  const visibleRequirements = requirements.filter(
    (requirement) =>
      evaluateRequirementApplicability(
        requirement,
        application.learner?.citizenship
      ) !== "not_applicable"
  );

  const learner = application.learner;
  /** School-configured declaration only — never invent legal/declaration wording. */
  const configuredDeclarationText = String(config?.declarationText || "").trim();
  const privacyVersion = String(config?.privacyNoticeVersion || "").trim();
  const applicantAccessToken = accessToken;

  async function handleSubmit() {
    if (submitting) return;
    setSubmitError(null);
    setSubmitDetails([]);
    setClientIssues(readiness.issues);
    if (!financialAgreementMatchesCurrentDocuments(application, config)) {
      return;
    }

    setSubmitting(true);
    try {
      const answersPayload = questions.map((q) => ({
        questionKey: q.key,
        questionLabelSnapshot: q.label,
        valueJson: String(answerValues[q.key] || "").trim(),
      }));

      const patched = await updatePublicDraftApplication(
        publicSlug,
        publicAccessId,
        accessToken,
        {
          privacyAccepted: privacyAccepted || Boolean(application.privacyAcceptedAt),
          declarationsAccepted:
            declarationsAccepted || Boolean(application.declarationsAcceptedAt),
          privacyNoticeVersion: privacyVersion || null,
          answers: answersPayload,
        }
      );
      onApplicationUpdated(patched);

      const result = await submitPublicApplication(
        publicSlug,
        publicAccessId,
        accessToken
      );
      onSubmitted(result.application);
    } catch (err) {
      if (err instanceof PublicAdmissionsApiError && err.status === 404) {
        onSessionInvalid();
        return;
      }
      if (err instanceof PublicAdmissionsApiError && err.code === "ADMISSIONS_CLOSED") {
        setSubmitError(
          "Applications are no longer open. Please contact the school if you need help."
        );
        return;
      }
      if (err instanceof PublicAdmissionsApiError && err.code === "VALIDATION_FAILED") {
        const details = mapValidationDetailsToGuidance(err.details);
        setSubmitDetails(details);
        setSubmitError(
          "Your application is incomplete. Please review the items below, then try again."
        );
        return;
      }
      setSubmitError(
        err instanceof PublicAdmissionsApiError
          ? "We could not submit your application right now. Please try again."
          : "We could not submit your application right now. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="pa-review" data-testid="pa-review-step">
      <section className="pa-card">
        <h2 className="pa-section-title">Review your application</h2>
        <p className="pa-body">
          Check the details below. You can go back to edit before submitting.
        </p>
      </section>

      <section className="pa-card" aria-labelledby={`${formId}-learner-sum`}>
        <div className="pa-review-head">
          <h3 id={`${formId}-learner-sum`} className="pa-subsection-title">
            Learner
          </h3>
          <button type="button" className="pa-link-button" onClick={onEditDetails}>
            Edit details
          </button>
        </div>
        <dl className="pa-review-dl">
          <div>
            <dt>Name</dt>
            <dd>
              {display(learner?.firstName)} {display(learner?.lastName)}
            </dd>
          </div>
          <div>
            <dt>Date of birth</dt>
            <dd>{display(learner?.birthDate)}</dd>
          </div>
          <div>
            <dt>ID / passport</dt>
            <dd>{display(learner?.idNumber)}</dd>
          </div>
          <div>
            <dt>Gender</dt>
            <dd>{display(learner?.gender)}</dd>
          </div>
          <div>
            <dt>Grade</dt>
            <dd>{display(application.requestedGrade)}</dd>
          </div>
          <div>
            <dt>Intake year</dt>
            <dd>{application.intakeYear}</dd>
          </div>
          <div>
            <dt>Previous school</dt>
            <dd>{display(learner?.previousSchoolName)}</dd>
          </div>
          <div>
            <dt>Home language</dt>
            <dd>{display(learner?.homeLanguage)}</dd>
          </div>
          <div>
            <dt>Citizenship</dt>
            <dd>{display(learner?.citizenship)}</dd>
          </div>
          <div className="pa-review-full">
            <dt>Home address</dt>
            <dd>{display(learner?.homeAddress)}</dd>
          </div>
        </dl>
      </section>

      <section className="pa-card" aria-labelledby={`${formId}-guardians-sum`}>
        <div className="pa-review-head">
          <h3 id={`${formId}-guardians-sum`} className="pa-subsection-title">
            Parents / guardians
          </h3>
          <button type="button" className="pa-link-button" onClick={onEditDetails}>
            Edit guardians
          </button>
        </div>
        {(application.guardians || []).length === 0 ? (
          <p className="pa-body">No guardians added yet.</p>
        ) : (
          <ul className="pa-review-guardian-list">
            {application.guardians.map((g) => (
              <li key={g.id} className="pa-review-guardian">
                <p className="pa-doc-filename">
                  {display(g.firstName)} {display(g.surname)}
                </p>
                <p className="pa-body">
                  {[
                    g.relationship,
                    g.isPrimary ? "Primary" : null,
                    g.isPayingPerson ? "Responsible for fees" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="pa-body">
                  {[g.cellNo, g.email, g.idNumber].filter(Boolean).join(" · ") || "—"}
                </p>
                {g.homeAddress ? <p className="pa-body">{g.homeAddress}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="pa-card" aria-labelledby={`${formId}-docs-sum`}>
        <div className="pa-review-head">
          <h3 id={`${formId}-docs-sum`} className="pa-subsection-title">
            Documents
          </h3>
          <button type="button" className="pa-link-button" onClick={onEditDocuments}>
            Edit documents
          </button>
        </div>
        {docsLoading ? (
          <p className="pa-body">Loading documents…</p>
        ) : (
          <>
            {docSummary.summary ? (
              <p className="pa-docs-summary" data-testid="pa-review-docs-summary">
                {docSummary.summary}
              </p>
            ) : (
              <p className="pa-body">No required supporting documents configured.</p>
            )}
            {docSummary.missingLabels.length > 0 ? (
              <p className="pa-body" data-testid="pa-review-docs-missing">
                Missing required supporting document
                {docSummary.missingLabels.length === 1 ? "" : "s"}:{" "}
                {docSummary.missingLabels.join(", ")}
              </p>
            ) : null}
            {docSummary.unresolvedLabels.length > 0 ? (
              <p className="pa-body" data-testid="pa-review-docs-conditional">
                Add learner citizenship to determine whether this document is required:{" "}
                {docSummary.unresolvedLabels.join(", ")}
              </p>
            ) : null}
            <ul className="pa-review-doc-list">
              {visibleRequirements.map((req) => {
                const matching = documentsForType(documents, req.key);
                const applicability = evaluateRequirementApplicability(
                  req,
                  application.learner?.citizenship
                );
                return (
                  <li key={req.key}>
                    <strong>{labelForDocumentType(req.key, requirements)}</strong>
                    {" — "}
                    {matching.length
                      ? matching.length === 1
                        ? `Uploaded (${matching[0].originalFileName})`
                        : `${matching.length} files uploaded`
                      : applicability === "unresolved"
                        ? "Required if learner is not South African"
                        : req.required
                        ? "Missing"
                        : "Not uploaded"}
                  </li>
                );
              })}
            </ul>
            <p className="pa-body">
              Missing supporting documents are shown for your information. Final submission is
              decided by the school’s application rules.
            </p>
          </>
        )}
      </section>

      {questions.length > 0 ? (
        <section className="pa-card" aria-labelledby={`${formId}-questions`}>
          <h3 id={`${formId}-questions`} className="pa-subsection-title">
            Application questions
          </h3>
          <div className="pa-field-grid">
            {questions.map((q) => (
              <div key={q.key} className="pa-field pa-field--full">
                <label htmlFor={`${formId}-q-${q.key}`}>
                  {q.label}
                  {q.required ? <span className="pa-req"> *</span> : null}
                </label>
                <textarea
                  id={`${formId}-q-${q.key}`}
                  rows={3}
                  value={answerValues[q.key] || ""}
                  onChange={(e) =>
                    setAnswerValues((prev) => ({ ...prev, [q.key]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="pa-card" aria-labelledby={`${formId}-declarations`}>
        <h3 id={`${formId}-declarations`} className="pa-subsection-title">
          Declarations
        </h3>
        {privacyVersion ? (
          <p className="pa-body" data-testid="pa-privacy-version">
            Privacy notice version on record: {privacyVersion}
          </p>
        ) : (
          <p className="pa-body">
            The school requires privacy notice acceptance for this application. The full privacy
            notice text is not provided in this admissions link.
          </p>
        )}
        <label className="pa-check">
          <input
            type="checkbox"
            checked={privacyAccepted}
            onChange={(e) => setPrivacyAccepted(e.target.checked)}
            data-testid="pa-privacy-accept"
          />
          <span>
            {privacyVersion
              ? `I confirm privacy notice acceptance for this admissions application (version ${privacyVersion}).`
              : "I confirm privacy notice acceptance for this admissions application."}
          </span>
        </label>
        {configuredDeclarationText ? (
          <div className="pa-declaration-box" data-testid="pa-declaration-text">
            <p className="pa-body">{configuredDeclarationText}</p>
          </div>
        ) : (
          <p className="pa-body" data-testid="pa-declaration-neutral">
            The school requires declarations acceptance for this application. No school-configured
            declaration text was provided on this admissions link.
          </p>
        )}
        <label className="pa-check">
          <input
            type="checkbox"
            checked={declarationsAccepted}
            onChange={(e) => setDeclarationsAccepted(e.target.checked)}
            data-testid="pa-declarations-accept"
          />
          <span>
            {configuredDeclarationText
              ? "I accept the declarations above."
              : "I confirm declarations acceptance for this admissions application."}
          </span>
        </label>
      </section>

      <PublicAdmissionsFinancialAgreement
        publicSlug={publicSlug}
        publicAccessId={publicAccessId}
        accessToken={applicantAccessToken}
        config={config}
        application={application}
        onSigned={onApplicationUpdated}
        onSessionInvalid={onSessionInvalid}
      />

      {(clientIssues.length > 0 || submitDetails.length > 0 || submitError) && (
        <section className="pa-card" data-testid="pa-submit-issues">
          {submitError ? (
            <p className="pa-banner-error" role="alert">
              {submitError}
            </p>
          ) : null}
          <ul className="pa-issue-list">
            {(submitDetails.length ? submitDetails : clientIssues).map((issue) => (
              <li key={`${issue.field}-${issue.message}`}>
                {issue.message}{" "}
                <button
                  type="button"
                  className="pa-link-button"
                  onClick={() => {
                    const section = sectionForValidationField(issue.field);
                    if (section === "details") onEditDetails();
                    else if (section === "documents") onEditDocuments();
                  }}
                >
                  Fix
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="pa-card">
        <h3 className="pa-subsection-title">Submit</h3>
        <p className="pa-body">
          When you submit, your application will be sent to the school. Payment instructions,
          if any, become available after submission in a later step of this experience.
        </p>
        <div className="pa-cta-row pa-cta-row--stack">
          <button
            type="button"
            className="pa-cta"
            disabled={submitting}
            onClick={() => void handleSubmit()}
            data-testid="pa-submit-application"
          >
            {submitting ? "Submitting…" : "Submit Application"}
          </button>
          <button type="button" className="pa-secondary-btn" onClick={onEditDetails}>
            Back to details
          </button>
        </div>
      </section>
    </div>
  );
}
