import {
  canEditBillingPlan,
  canEditLearnerPlacement,
  canOpenLearnerProfile,
  canViewBillingPlan,
  canViewClassrooms,
  canViewParentPortalGuidance,
} from "./admissionsPermissions";
import type { PostEnrolmentSummary } from "./staffAdmissionsTypes";

export type OpenLearnerOptions = {
  initialTab?: "general" | "billing";
};

type Props = {
  summary: PostEnrolmentSummary;
  onOpenLearner?: (
    learnerId: string,
    summary?: {
      firstName: string;
      lastName: string;
      grade: string;
      admissionNo: string | null;
      className?: string | null;
    },
    options?: OpenLearnerOptions
  ) => void;
  onOpenParentPortal?: () => void;
  onOpenClassrooms?: () => void;
};

function statusClass(kind: "ok" | "action" | "warn" | "info"): string {
  switch (kind) {
    case "ok":
      return "admissions-staff-checklist-status admissions-staff-checklist-status--ok";
    case "action":
      return "admissions-staff-checklist-status admissions-staff-checklist-status--action";
    case "warn":
      return "admissions-staff-checklist-status admissions-staff-checklist-status--warn";
    default:
      return "admissions-staff-checklist-status admissions-staff-checklist-status--info";
  }
}

export default function PostEnrolmentChecklist({
  summary,
  onOpenLearner,
  onOpenParentPortal,
  onOpenClassrooms,
}: Props) {
  const canLearner = canOpenLearnerProfile();
  const canPlacement = canEditLearnerPlacement();
  const canSeePlan = canViewBillingPlan();
  const canAssignPlan = canEditBillingPlan();
  const canPortal = canViewParentPortalGuidance();
  const canRooms = canViewClassrooms();

  const openLearner = (options?: OpenLearnerOptions) => {
    if (!onOpenLearner || !canLearner) return;
    onOpenLearner(
      summary.learner.id,
      {
        firstName: summary.learner.firstName,
        lastName: summary.learner.lastName,
        grade: summary.learner.grade,
        admissionNo: summary.learner.admissionNo,
        className: summary.learner.className,
      },
      options
    );
  };

  const placementKind =
    summary.placement.status === "COMPLETE" ? "ok" : "action";
  const billingKind = summary.billingPlan.status === "ASSIGNED" ? "ok" : "action";
  const financeKind =
    summary.finance.status === "READY"
      ? "ok"
      : summary.finance.status === "BASELINE_MISSING"
        ? "warn"
        : "warn";

  return (
    <section className="admissions-staff-checklist" aria-labelledby="post-enrolment-heading">
      <h2 id="post-enrolment-heading" className="admissions-staff-card-title">
        Post-enrolment setup
      </h2>
      <p className="admissions-staff-checklist-intro">
        The learner is enrolled in EduClear. Complete the independent setup steps below using
        existing school workflows.
      </p>

      <div className="admissions-staff-checklist-summary" role="list">
        <div role="listitem">
          <span>Enrolment record</span>
          <span className={statusClass("ok")}>Complete</span>
        </div>
        <div role="listitem">
          <span>Class placement</span>
          <span className={statusClass(placementKind)}>
            {summary.placement.status === "COMPLETE" ? "Complete" : "Action recommended"}
          </span>
        </div>
        <div role="listitem">
          <span>Billing plan</span>
          <span className={statusClass(billingKind)}>
            {summary.billingPlan.status === "ASSIGNED" ? "Assigned" : "Required"}
          </span>
        </div>
        <div role="listitem">
          <span>Finance account</span>
          <span className={statusClass(financeKind)}>{summary.finance.label}</span>
        </div>
        <div role="listitem">
          <span>Parent Portal</span>
          <span className={statusClass("info")}>
            {summary.guardians.length === 0
              ? "No linked parents"
              : summary.guardians.every((g) => g.portalStatus === "READY")
                ? "Ready"
                : "Review guardians"}
          </span>
        </div>
        <div role="listitem">
          <span>Invoicing</span>
          <span className={statusClass("info")}>{summary.invoicing.label}</span>
        </div>
      </div>

      <div className="admissions-staff-checklist-grid">
        <article className="admissions-staff-checklist-card">
          <h3>Enrolment record</h3>
          <p className={statusClass("ok")}>Complete</p>
          <dl>
            <div>
              <dt>Learner</dt>
              <dd>
                {summary.learner.firstName} {summary.learner.lastName}
              </dd>
            </div>
            <div>
              <dt>Admission no.</dt>
              <dd>{summary.learner.admissionNo || "—"}</dd>
            </div>
            <div>
              <dt>Grade</dt>
              <dd>{summary.learner.grade || "—"}</dd>
            </div>
            <div>
              <dt>Class</dt>
              <dd>{summary.learner.className || "Not assigned"}</dd>
            </div>
            <div>
              <dt>Family account</dt>
              <dd>
                {summary.family
                  ? `${summary.family.accountRef}${
                      summary.family.mode === "reused"
                        ? " (existing)"
                        : summary.family.mode === "created"
                          ? " (new)"
                          : ""
                    }`
                  : "—"}
              </dd>
            </div>
          </dl>
          {canLearner && onOpenLearner ? (
            <button
              type="button"
              className="admissions-staff-btn admissions-staff-btn--outline"
              onClick={() => openLearner({ initialTab: "general" })}
            >
              View learner
            </button>
          ) : null}
        </article>

        <article className="admissions-staff-checklist-card">
          <h3>Class / placement</h3>
          <p className={statusClass(placementKind)}>{summary.placement.label}</p>
          <p className="admissions-staff-checklist-note">
            Missing class is not an enrolment failure. Confirm placement in learner profile or
            Classrooms when ready.
          </p>
          <div className="admissions-staff-checklist-actions">
            {canPlacement && onOpenLearner ? (
              <button
                type="button"
                className="admissions-staff-btn admissions-staff-btn--outline"
                onClick={() => openLearner({ initialTab: "general" })}
              >
                Confirm on learner
              </button>
            ) : null}
            {canRooms && onOpenClassrooms ? (
              <button
                type="button"
                className="admissions-staff-btn admissions-staff-btn--outline"
                onClick={onOpenClassrooms}
              >
                Open classrooms
              </button>
            ) : null}
          </div>
        </article>

        <article className="admissions-staff-checklist-card">
          <h3>Billing plan</h3>
          <p className={statusClass(billingKind)}>{summary.billingPlan.label}</p>
          <p className="admissions-staff-checklist-note">
            {summary.billingPlan.lineCount > 0
              ? `${summary.billingPlan.lineCount} plan line(s) on this learner.`
              : "Assign a learner billing plan in Manage Learner before invoicing."}
          </p>
          {canSeePlan && onOpenLearner ? (
            <button
              type="button"
              className="admissions-staff-btn admissions-staff-btn--gold"
              onClick={() => openLearner({ initialTab: "billing" })}
            >
              {canAssignPlan && summary.billingPlan.status === "REQUIRED"
                ? "Assign billing plan"
                : "View billing plan"}
            </button>
          ) : (
            <p className="admissions-staff-checklist-note">
              You can see this status, but billing-plan editing requires billing authority.
            </p>
          )}
        </article>

        <article className="admissions-staff-checklist-card">
          <h3>Finance account</h3>
          <p className={statusClass(financeKind)}>{summary.finance.label}</p>
          <p className="admissions-staff-checklist-note">{summary.finance.note}</p>
          <p className="admissions-staff-checklist-note">
            Account ref: {summary.finance.accountRef || "—"}
          </p>
        </article>

        <article className="admissions-staff-checklist-card">
          <h3>Parent Portal</h3>
          {summary.guardians.length === 0 ? (
            <p className="admissions-staff-checklist-note">No parents linked to this learner yet.</p>
          ) : (
            <ul className="admissions-staff-checklist-guardians">
              {summary.guardians.map((g) => (
                <li key={g.parentId}>
                  <strong>
                    {g.firstName} {g.surname}
                  </strong>
                  {g.isPrimary ? " · Primary" : ""}
                  {g.isPayingPerson ? " · Paying" : ""}
                  <span
                    className={statusClass(
                      g.portalStatus === "READY"
                        ? "ok"
                        : g.portalStatus === "CONTACT_REQUIRED"
                          ? "warn"
                          : "action"
                    )}
                  >
                    {g.portalLabel}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="admissions-staff-checklist-note">
            Do not send OTP or invitations from Admissions. Parents complete portal registration
            themselves when contact details are available.
          </p>
          {canPortal && onOpenParentPortal ? (
            <button
              type="button"
              className="admissions-staff-btn admissions-staff-btn--outline"
              onClick={onOpenParentPortal}
            >
              Open Parent Portal
            </button>
          ) : null}
        </article>

        <article className="admissions-staff-checklist-card">
          <h3>Invoicing</h3>
          <p className={statusClass("info")}>{summary.invoicing.label}</p>
          <p className="admissions-staff-checklist-note">{summary.invoicing.note}</p>
        </article>

        <article className="admissions-staff-checklist-card">
          <h3>Admission fee</h3>
          <p className={statusClass("info")}>{summary.admissionFee.label}</p>
          <p className="admissions-staff-checklist-note">{summary.admissionFee.note}</p>
        </article>
      </div>
    </section>
  );
}
