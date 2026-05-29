import { useState } from "react";
import { canAccessMigration } from "../../auth/migrationAccess";
import { useSchoolId } from "../../useSchoolId";
import MigrationCentreBillingPlansPanel from "./MigrationCentreBillingPlansPanel";
import MigrationCentreLearnerRepairPanel from "./MigrationCentreLearnerRepairPanel";
import "./MigrationCentre.css";

type ToolView = "dashboard" | "billing" | "learners";

export default function MigrationCentrePage() {
  const schoolId = useSchoolId() || "";
  const [view, setView] = useState<ToolView>("dashboard");
  const [billingStatus, setBillingStatus] = useState("No file uploaded yet.");
  const [learnerStatus, setLearnerStatus] = useState("No file uploaded yet.");

  if (!canAccessMigration()) {
    return (
      <div className="migration-centre-page">
        <h1 className="page-title">Migration Centre</h1>
        <p className="migration-centre-denied">
          Migration Centre requires a school owner or admin account.
        </p>
      </div>
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

  if (view === "learners") {
    return <MigrationCentreLearnerRepairPanel schoolId={schoolId} onBack={() => setView("dashboard")} />;
  }

  return (
    <div className="migration-centre-page">
      <header className="migration-centre-header">
        <h1 className="page-title">Migration Centre</h1>
        <p className="migration-centre-subtitle">
          Import billing plans and repair learner data from Kid-e-Sys and SA-SAMS exports. Preview every
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
            <h2 className="migration-centre-card-title">Learner / Gender Repair</h2>
            <p className="migration-centre-card-desc">
              Upload SA-SAMS class lists or learner register to repair gender, ID number, and classroom.
              Fills optional missing fields only when empty. Never deletes learners.
            </p>
            <p className="migration-centre-status" role="status">
              {learnerStatus}
            </p>
            <div className="migration-centre-card-actions">
              <button
                type="button"
                className="migration-centre-btn migration-centre-btn--gold"
                onClick={() => {
                  setLearnerStatus("Open the learner repair tool to upload and preview.");
                  setView("learners");
                }}
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
