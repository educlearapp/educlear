import { useCallback, useEffect, useState } from "react";
import AdmissionsStatusBadge from "./AdmissionsStatusBadge";
import EnrolLearnerModal from "./EnrolLearnerModal";
import PostEnrolmentChecklist from "./PostEnrolmentChecklist";
import ReactivateHistoricalLearnerModal from "./ReactivateHistoricalLearnerModal";
import {
  canConvertAdmissionApplication,
  canEditAdmissionsWorkflow,
  canManageAdmissionsDecisions,
} from "./admissionsPermissions";
import { getEnrolmentDetailLabel } from "./conversionDecision";
import {
  acceptApplication,
  getApplication,
  rejectApplication,
  requestInfo,
  resumeReview,
  startReview,
} from "./staffAdmissionsApi";
import type { StaffApplicationDetail } from "./staffAdmissionsTypes";
import "./admissionsStaff.css";

type Props = {
  applicationId: string;
  schoolId: string;
  onBack: () => void;
  onOpenLearner?: (
    learnerId: string,
    summary?: {
      firstName: string;
      lastName: string;
      grade: string;
      admissionNo: string | null;
      className?: string | null;
    },
    options?: { initialTab?: "general" | "billing" }
  ) => void;
  onOpenParentPortal?: () => void;
  onOpenClassrooms?: () => void;
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function maskId(value: string | null): string {
  if (!value) return "Not provided";
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

export default function AdmissionsDetailPage({
  applicationId,
  schoolId,
  onBack,
  onOpenLearner,
  onOpenParentPortal,
  onOpenClassrooms,
}: Props) {
  const [detail, setDetail] = useState<StaffApplicationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [showEnrolModal, setShowEnrolModal] = useState(false);
  const [showReactivateModal, setShowReactivateModal] = useState(false);

  const canEdit = canEditAdmissionsWorkflow();
  const canDecide = canManageAdmissionsDecisions();
  const canConvert = canConvertAdmissionApplication();

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const app = await getApplication(applicationId);
      setDetail(app);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load application");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const runWorkflow = async (action: () => Promise<unknown>) => {
    setActionBusy(true);
    setActionError("");
    try {
      await action();
      await loadDetail();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) {
    return <div className="admissions-staff-loading">Loading application…</div>;
  }

  if (error || !detail) {
    return (
      <div className="admissions-staff-page">
        <button type="button" className="admissions-staff-back-link" onClick={onBack}>
          ← Back to Admissions
        </button>
        <div className="admissions-staff-alert admissions-staff-alert--error">
          {error || "Application not found"}
        </div>
      </div>
    );
  }

  const enrolLabel = getEnrolmentDetailLabel(detail.status, detail.promotedLearnerId);
  const learnerName = detail.learner
    ? `${detail.learner.firstName} ${detail.learner.lastName}`.trim()
    : "—";

  return (
    <div className="admissions-staff-page">
      <button type="button" className="admissions-staff-back-link" onClick={onBack}>
        ← Back to Admissions
      </button>

      <header className="admissions-staff-header">
        <div className="admissions-staff-header-main">
          <h1 className="page-title">{detail.applicationNumber || "Application"}</h1>
          <p className="admissions-staff-subtitle">
            Intake {detail.intakeYear}
            {detail.requestedGrade ? ` · Grade ${detail.requestedGrade}` : ""}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10, alignItems: "center" }}>
            <AdmissionsStatusBadge status={detail.status} />
            {enrolLabel ? (
              <span
                className={`admissions-staff-enrol-hint ${
                  detail.promotedLearnerId ? "admissions-staff-enrol-hint--done" : ""
                }`}
              >
                {enrolLabel}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {actionError ? (
        <div className="admissions-staff-alert admissions-staff-alert--error">{actionError}</div>
      ) : null}

      <div className="admissions-staff-detail-grid">
        <section className="admissions-staff-card" aria-labelledby="admissions-learner-heading">
          <h2 id="admissions-learner-heading" className="admissions-staff-card-title">
            Learner
          </h2>
          <dl>
            <div>
              <dt>Name</dt>
              <dd>{learnerName}</dd>
            </div>
            <div>
              <dt>Date of birth</dt>
              <dd>{detail.learner?.birthDate ? formatDate(detail.learner.birthDate) : "—"}</dd>
            </div>
            <div>
              <dt>ID number</dt>
              <dd>{maskId(detail.learner?.idNumber ?? null)}</dd>
            </div>
            <div>
              <dt>Submitted</dt>
              <dd>{formatDate(detail.submittedAt)}</dd>
            </div>
          </dl>
        </section>

        <section className="admissions-staff-card" aria-labelledby="admissions-guardians-heading">
          <h2 id="admissions-guardians-heading" className="admissions-staff-card-title">
            Guardians
          </h2>
          {detail.guardians.length === 0 ? (
            <p style={{ margin: 0, color: "#64748b" }}>No guardians recorded.</p>
          ) : (
            <dl>
              {detail.guardians.map((g) => (
                <div key={g.id}>
                  <dt>
                    {g.firstName} {g.surname}
                    {g.isPrimary ? " (Primary)" : ""}
                  </dt>
                  <dd>
                    {[g.relationship, g.cellNo, g.email].filter(Boolean).join(" · ") || "—"}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <section className="admissions-staff-card" aria-labelledby="admissions-docs-heading">
          <h2 id="admissions-docs-heading" className="admissions-staff-card-title">
            Documents
          </h2>
          <dl>
            <div>
              <dt>Completeness</dt>
              <dd>
                {detail.documentCompleteness.documentsComplete
                  ? "Complete"
                  : `${detail.documentCompleteness.missingDocumentTypes.length} missing`}
              </dd>
            </div>
            {detail.documentCompleteness.missingDocumentTypes.length > 0 ? (
              <div>
                <dt>Missing</dt>
                <dd>{detail.documentCompleteness.missingDocumentTypes.join(", ")}</dd>
              </div>
            ) : null}
            <div>
              <dt>Uploaded</dt>
              <dd>{detail.documents.length} file(s)</dd>
            </div>
          </dl>
        </section>

        <section className="admissions-staff-card" aria-labelledby="admissions-payment-heading">
          <h2 id="admissions-payment-heading" className="admissions-staff-card-title">
            Payment
          </h2>
          <dl>
            <div>
              <dt>Status</dt>
              <dd>{(detail.payment?.paymentStatus || "—").replace(/_/g, " ")}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>
                {detail.payment?.amount
                  ? `${detail.payment.currency} ${detail.payment.amount}`
                  : detail.feeRequired
                    ? "Required"
                    : "Not required"}
              </dd>
            </div>
            <div>
              <dt>Proof uploaded</dt>
              <dd>{detail.payment?.proofUploaded ? "Yes" : "No"}</dd>
            </div>
          </dl>
        </section>
      </div>

      {detail.promotedLearner ? (
        <div className="admissions-staff-alert admissions-staff-alert--success" style={{ marginTop: 16 }}>
          Enrolled as {detail.promotedLearner.firstName} {detail.promotedLearner.lastName}
          {detail.promotedLearner.admissionNo ? ` (${detail.promotedLearner.admissionNo})` : ""}
          {detail.promotedLearner.grade ? ` · Grade ${detail.promotedLearner.grade}` : ""}
        </div>
      ) : null}

      {detail.status === "ACCEPTED" && detail.promotedLearnerId && detail.postEnrolment ? (
        <PostEnrolmentChecklist
          summary={detail.postEnrolment}
          onOpenLearner={onOpenLearner}
          onOpenParentPortal={onOpenParentPortal}
          onOpenClassrooms={onOpenClassrooms}
        />
      ) : null}

      <div className="admissions-staff-actions">
        {canEdit && detail.status === "SUBMITTED" ? (
          <button
            type="button"
            className="admissions-staff-btn admissions-staff-btn--outline"
            disabled={actionBusy}
            onClick={() => void runWorkflow(() => startReview(applicationId))}
          >
            Start review
          </button>
        ) : null}

        {canEdit && (detail.status === "UNDER_REVIEW" || detail.status === "SUBMITTED") ? (
          <button
            type="button"
            className="admissions-staff-btn admissions-staff-btn--outline"
            disabled={actionBusy}
            onClick={() => void runWorkflow(() => requestInfo(applicationId, { message: "Additional information required." }))}
          >
            Request info
          </button>
        ) : null}

        {canEdit && detail.status === "INFO_REQUESTED" ? (
          <button
            type="button"
            className="admissions-staff-btn admissions-staff-btn--outline"
            disabled={actionBusy}
            onClick={() => void runWorkflow(() => resumeReview(applicationId))}
          >
            Resume review
          </button>
        ) : null}

        {canDecide && detail.status === "UNDER_REVIEW" ? (
          <>
            <button
              type="button"
              className="admissions-staff-btn admissions-staff-btn--gold"
              disabled={actionBusy}
              onClick={() => void runWorkflow(() => acceptApplication(applicationId))}
            >
              Accept
            </button>
            <button
              type="button"
              className="admissions-staff-btn admissions-staff-btn--danger"
              disabled={actionBusy}
              onClick={() => {
                const reason = window.prompt("Reason for rejection (required):");
                if (reason === null) return;
                const trimmed = reason.trim();
                if (!trimmed) {
                  setActionError("A rejection reason is required.");
                  return;
                }
                void runWorkflow(() => rejectApplication(applicationId, { reason: trimmed }));
              }}
            >
              Reject
            </button>
          </>
        ) : null}

        {detail.status === "ACCEPTED" && !detail.promotedLearnerId && canConvert ? (
          <button
            type="button"
            className="admissions-staff-btn admissions-staff-btn--gold"
            onClick={() => setShowEnrolModal(true)}
          >
            Enrol Learner
          </button>
        ) : null}

        {detail.promotedLearnerId && onOpenLearner ? (
          <button
            type="button"
            className="admissions-staff-btn admissions-staff-btn--outline"
            onClick={() =>
              onOpenLearner(detail.promotedLearnerId!, {
                firstName: detail.promotedLearner?.firstName || "",
                lastName: detail.promotedLearner?.lastName || "",
                grade: detail.promotedLearner?.grade || "",
                admissionNo: detail.promotedLearner?.admissionNo ?? null,
                className: detail.promotedLearner?.className ?? null,
              })
            }
          >
            View learner
          </button>
        ) : null}
      </div>

      {showEnrolModal ? (
        <EnrolLearnerModal
          key={`enrol-${applicationId}`}
          applicationId={applicationId}
          schoolId={schoolId}
          onClose={() => setShowEnrolModal(false)}
          onSuccess={() => {
            setShowEnrolModal(false);
            void loadDetail();
          }}
          onOpenLearner={onOpenLearner}
          onRequestHistoricalReactivate={() => {
            setShowEnrolModal(false);
            setShowReactivateModal(true);
          }}
        />
      ) : null}

      {showReactivateModal ? (
        <ReactivateHistoricalLearnerModal
          key={`reactivate-${applicationId}`}
          applicationId={applicationId}
          schoolId={schoolId}
          onClose={() => setShowReactivateModal(false)}
          onSuccess={() => {
            setShowReactivateModal(false);
            void loadDetail();
          }}
          onOpenLearner={onOpenLearner}
        />
      ) : null}
    </div>
  );
}
