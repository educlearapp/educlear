import type { ApplicantApplicationView, PublicAdmissionsConfig } from "./publicAdmissionsTypes";
import {
  parentFacingStatusBody,
  parentFacingStatusTitle,
} from "./reviewReadiness";

type Props = {
  application: ApplicantApplicationView;
  config: PublicAdmissionsConfig | null;
  justSubmitted?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
};

function display(value: string | null | undefined): string {
  const v = String(value || "").trim();
  return v || "—";
}

/**
 * Post-submit confirmation / status surface (OA-06E).
 * No payment instructions or POP UI.
 */
export default function PublicAdmissionsStatusView({
  application,
  config,
  justSubmitted = false,
  onRefresh,
  refreshing = false,
}: Props) {
  const status = String(application.status || "").toUpperCase();
  const learnerName = [application.learner?.firstName, application.learner?.lastName]
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .join(" ");
  const schoolName = config?.schoolDisplayName || "the school";
  const title = justSubmitted
    ? "Application submitted"
    : parentFacingStatusTitle(application.status);
  const body = justSubmitted
    ? `Your application has been submitted to ${schoolName}. Please keep your application number for your records.`
    : parentFacingStatusBody(application.status);

  return (
    <div className="pa-status" data-testid="pa-status-view">
      <section className="pa-card">
        <h2 className="pa-section-title" data-testid="pa-status-title">
          {title}
        </h2>
        <p className="pa-body">{body}</p>

        <dl className="pa-review-dl">
          <div>
            <dt>School</dt>
            <dd>{display(schoolName)}</dd>
          </div>
          <div>
            <dt>Application number</dt>
            <dd data-testid="pa-application-number">
              {display(application.applicationNumber)}
            </dd>
          </div>
          <div>
            <dt>Learner</dt>
            <dd>{display(learnerName)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd data-testid="pa-application-status">{status}</dd>
          </div>
          {application.submittedAt ? (
            <div>
              <dt>Submitted</dt>
              <dd>{new Date(application.submittedAt).toLocaleString()}</dd>
            </div>
          ) : null}
        </dl>

        {status === "INFO_REQUESTED" ? (
          <div className="pa-info-request" data-testid="pa-info-requested">
            <h3 className="pa-subsection-title">Additional information requested</h3>
            {application.statusReason ? (
              <p className="pa-body">{application.statusReason}</p>
            ) : (
              <p className="pa-body">
                The school has requested more information. A secure response flow will be
                available in a later update.
              </p>
            )}
            <p className="pa-body">
              You cannot edit the full application from this screen yet.
            </p>
          </div>
        ) : null}

        {status === "DECLINED" && application.statusReason ? (
          <p className="pa-body" data-testid="pa-decline-reason">
            {application.statusReason}
          </p>
        ) : null}

        <p className="pa-body">
          Further steps, such as payment instructions where applicable, will be available after
          submission in a later update of this admissions experience.
        </p>

        {onRefresh ? (
          <div className="pa-cta-row">
            <button
              type="button"
              className="pa-secondary-btn"
              disabled={refreshing}
              onClick={onRefresh}
              data-testid="pa-refresh-status"
            >
              {refreshing ? "Refreshing…" : "Refresh status"}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
