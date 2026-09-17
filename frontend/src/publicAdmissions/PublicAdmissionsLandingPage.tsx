import { Link } from "react-router-dom";
import {
  canStartPublicApplication,
  formatAdmissionFeeSummary,
  formatPublicDate,
} from "./derivePublicAdmissionsShellState";
import type {
  PublicAdmissionsConfig,
  PublicAdmissionsShellState,
} from "./publicAdmissionsTypes";

type Props = {
  publicSlug: string;
  state: PublicAdmissionsShellState;
  config: PublicAdmissionsConfig | null;
};

function StatusPanel({
  title,
  body,
  contact,
}: {
  title: string;
  body: string;
  contact?: PublicAdmissionsConfig | null;
}) {
  return (
    <section className="pa-card" aria-labelledby="pa-status-heading">
      <h2 id="pa-status-heading" className="pa-section-title">
        {title}
      </h2>
      <p className="pa-body">{body}</p>
      <ContactBlock config={contact || null} />
    </section>
  );
}

function ContactBlock({ config }: { config: PublicAdmissionsConfig | null }) {
  if (!config) return null;
  const email = String(config.admissionContactEmail || "").trim();
  const phone = String(config.admissionContactPhone || "").trim();
  if (!email && !phone) return null;
  return (
    <div className="pa-contact" data-testid="pa-contact">
      <h3 className="pa-subsection-title">Admissions contact</h3>
      <ul className="pa-contact-list">
        {email ? (
          <li>
            <a href={`mailto:${email}`}>{email}</a>
          </li>
        ) : null}
        {phone ? (
          <li>
            <a href={`tel:${phone.replace(/\s+/g, "")}`}>{phone}</a>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function WindowSummary({ config }: { config: PublicAdmissionsConfig }) {
  const open = formatPublicDate(config.applicationsOpenAt);
  const close = formatPublicDate(config.applicationsCloseAt);
  if (!open && !close) return null;
  return (
    <li>
      <span className="pa-label">Application period</span>
      <span className="pa-value">
        {open && close ? `${open} – ${close}` : open ? `Opens ${open}` : `Closes ${close}`}
      </span>
    </li>
  );
}

export default function PublicAdmissionsLandingPage({
  publicSlug,
  state,
  config,
}: Props) {
  if (state === "LOADING") {
    return (
      <section className="pa-card" aria-busy="true" aria-live="polite">
        <h2 className="pa-section-title">Loading admissions</h2>
        <p className="pa-body">Please wait while we load this school’s admissions information.</p>
      </section>
    );
  }

  if (state === "NOT_FOUND") {
    return (
      <StatusPanel
        title="Admissions unavailable"
        body="We could not find an admissions page for this link. Please check the address or contact the school for the correct admissions URL."
      />
    );
  }

  if (state === "ERROR") {
    return (
      <StatusPanel
        title="Temporarily unavailable"
        body="We could not load admissions information right now. Please try again shortly, or contact the school if the problem continues."
      />
    );
  }

  if (state === "DISABLED") {
    return (
      <StatusPanel
        title="Applications are currently closed"
        body="Online admissions are not open for this school at the moment."
        contact={config}
      />
    );
  }

  if (
    state === "CLOSED" ||
    state === "CLOSED_BEFORE_WINDOW" ||
    state === "CLOSED_AFTER_WINDOW"
  ) {
    let body =
      "Applications are currently closed. Please check back later or contact the school for more information.";
    if (state === "CLOSED_BEFORE_WINDOW" && config?.applicationsOpenAt) {
      const open = formatPublicDate(config.applicationsOpenAt);
      body = open
        ? `Applications are not open yet. The application period begins on ${open}.`
        : body;
    } else if (state === "CLOSED_AFTER_WINDOW" && config?.applicationsCloseAt) {
      const close = formatPublicDate(config.applicationsCloseAt);
      body = close
        ? `The application period closed on ${close}. Please contact the school if you need further assistance.`
        : body;
    }
    return (
      <section className="pa-card" aria-labelledby="pa-status-heading">
        <h2 id="pa-status-heading" className="pa-section-title">
          Applications are currently closed
        </h2>
        <p className="pa-body">{body}</p>
        {config ? (
          <ul className="pa-summary-list">
            <WindowSummary config={config} />
          </ul>
        ) : null}
        <ContactBlock config={config} />
      </section>
    );
  }

  // OPEN
  if (!config) {
    return (
      <StatusPanel
        title="Temporarily unavailable"
        body="We could not load admissions information right now."
      />
    );
  }

  const feeSummary = formatAdmissionFeeSummary(config);
  const grades = Array.isArray(config.acceptedGrades)
    ? config.acceptedGrades.map((g) => String(g).trim()).filter(Boolean)
    : [];
  const showStart = canStartPublicApplication(state);

  return (
    <section className="pa-card" aria-labelledby="pa-open-heading" data-testid="pa-open">
      <h2 id="pa-open-heading" className="pa-section-title">
        Apply for admission
      </h2>
      <p className="pa-body">
        Review the information below, then start your application when you are ready.
      </p>

      <ul className="pa-summary-list" data-testid="pa-intake-summary">
        {config.intakeYear != null ? (
          <li>
            <span className="pa-label">Intake year</span>
            <span className="pa-value">{config.intakeYear}</span>
          </li>
        ) : null}
        {grades.length > 0 ? (
          <li>
            <span className="pa-label">Grades accepting applications</span>
            <span className="pa-value">{grades.join(", ")}</span>
          </li>
        ) : null}
        <WindowSummary config={config} />
        {feeSummary ? (
          <li data-testid="pa-fee-summary">
            <span className="pa-label">Admission fee</span>
            <span className="pa-value">{feeSummary}</span>
          </li>
        ) : null}
        {config.admissionFeeRequired && config.proofOfPaymentRequired ? (
          <li>
            <span className="pa-label">Payment proof</span>
            <span className="pa-value">Proof of payment will be required during your application.</span>
          </li>
        ) : null}
        {config.admissionFeeRequired && config.paymentVerificationRequired ? (
          <li>
            <span className="pa-label">Payment verification</span>
            <span className="pa-value">
              Payment may need to be verified before your application can be accepted.
            </span>
          </li>
        ) : null}
      </ul>

      <ContactBlock config={config} />

      {showStart ? (
        <div className="pa-cta-row">
          <Link
            to={`/admissions/${encodeURIComponent(publicSlug)}/apply`}
            className="pa-cta"
            data-testid="pa-start-application"
          >
            Start Application
          </Link>
        </div>
      ) : null}
    </section>
  );
}
