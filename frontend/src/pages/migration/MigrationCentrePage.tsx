import { useState } from "react";
import AccessDenied from "../../auth/AccessDenied";
import { isSuperAdmin } from "../../auth/roles";
import { useSchoolId } from "../../useSchoolId";
import MigrationCentreBillingPlansPanel from "./MigrationCentreBillingPlansPanel";
import MigrationCentreTopupPaymentsPanel from "./MigrationCentreTopupPaymentsPanel";
import "./MigrationCentre.css";

type ToolView = "dashboard" | "billing" | "topupPayments";

export default function MigrationCentrePage() {
  const schoolId = useSchoolId() || "";
  const [view, setView] = useState<ToolView>("dashboard");
  const [billingStatus, setBillingStatus] = useState("No file uploaded yet.");

  if (!isSuperAdmin()) {
    return (
      <AccessDenied message="Access denied — Migration Center requires a platform super admin account." />
    );
  }

  if (!schoolId) {
    return (
      <div className="migration-centre-page">
        <h1 className="page-title">Migration Centre</h1>
        <p className="migration-centre-subtitle">Loading school context…</p>
      </div>
    );
  }

  if (view === "billing") {
    return <MigrationCentreBillingPlansPanel schoolId={schoolId} onBack={() => setView("dashboard")} />;
  }
  if (view === "topupPayments") {
    return <MigrationCentreTopupPaymentsPanel schoolId={schoolId} onBack={() => setView("dashboard")} />;
  }

  return (
    <div className="migration-centre-page">
      <header className="migration-centre-header">
        <h1 className="page-title">Migration Centre</h1>
        <p className="migration-centre-subtitle">
          Controlled imports that help keep EduClear matched with the live school system. Preview every
          change before apply — nothing is saved automatically.
        </p>
      </header>

      <div className="migration-centre-grid">
        <article className="migration-centre-card">
          <div className="migration-centre-card-accent" aria-hidden="true" />
          <div className="migration-centre-card-body">
            <h2 className="migration-centre-card-title">Billing Plans Import</h2>
            <p className="migration-centre-card-desc">
              Upload Kid-e-Sys Billing Plan Summary and merge fee lines onto matched live learners. Does not
              touch statements, payments, invoices, ledger, opening balances, or family accounts.
            </p>
            <p className="migration-centre-status" role="status">
              {billingStatus}
            </p>
            <div className="migration-centre-card-actions">
              <button
                type="button"
                className="migration-centre-btn migration-centre-btn--gold"
                onClick={() => {
                  setBillingStatus("Open the billing import tool to upload and preview.");
                  setView("billing");
                }}
              >
                Open
              </button>
            </div>
          </div>
        </article>

        <article className="migration-centre-card">
          <div className="migration-centre-card-accent" aria-hidden="true" />
          <div className="migration-centre-card-body">
            <h2 className="migration-centre-card-title">Top-Up Payments</h2>
            <p className="migration-centre-card-desc">
              Upload Kid-e-Sys Transaction List export to import NEW payments captured after the original
              migration. Strong duplicate detection prevents double-posting and preserves audit history.
            </p>
            <p className="migration-centre-status" role="status">
              Dry run first — apply only after confirmation.
            </p>
            <div className="migration-centre-card-actions">
              <button
                type="button"
                className="migration-centre-btn migration-centre-btn--gold"
                onClick={() => setView("topupPayments")}
              >
                Open
              </button>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
