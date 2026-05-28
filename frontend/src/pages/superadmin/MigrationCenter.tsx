import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import MigrationSystemsRegistry from "../../components/migration/MigrationSystemsRegistry";
import UniversalMigrationApplySection from "./UniversalMigrationApplySection";
import UniversalMigrationImportAuditSection from "./UniversalMigrationImportAuditSection";
import UniversalMigrationUpload from "./UniversalMigrationUpload";
import UniversalMigrationValidationSection from "./UniversalMigrationValidationSection";
import UniversalMigrationStagingSection from "./UniversalMigrationStagingSection";
import { UniversalMigrationWorkflowProvider } from "./UniversalMigrationWorkflowContext";
import DaSilvaPilotValidationSection from "./DaSilvaPilotValidationSection";
import DaSilvaPilotRunbookSection from "./DaSilvaPilotRunbookSection";
import DaSilvaPreflightDashboardSection from "./DaSilvaPreflightDashboardSection";
import "./MigrationCenter.css";

const SECTIONS = [
  {
    num: 1,
    title: "Migration Sources",
    hint: "Select the legacy school system. Adapter detection will run against uploaded files.",
    placeholder: "Source picker and adapter registry — coming soon.",
  },
  {
    num: 2,
    title: "Upload Area",
    hint: "Upload export bundles from the selected source. Preview shows columns and sample rows only — no live import.",
    isUpload: true,
  },
  {
    num: 3,
    title: "Systems Registry",
    hint: "South African source systems — export types, migration domains, and adapter readiness.",
    isResearch: true,
  },
  {
    num: 4,
    title: "Validation",
    hint: "Review mapping issues, duplicates, and blocking errors before staging.",
    isValidation: true,
  },
  {
    num: 5,
    title: "Staging",
    hint: "Create dry-run packages in the Upload Area after validation — JSON snapshots only, no live import.",
    isStaging: true,
  },
  {
    num: 6,
    title: "Apply Migration",
    hint: "Commit staged data to the target school after all gates pass.",
    isApply: true,
  },
  {
    num: 7,
    title: "Import Audit & Rollback",
    hint: "Review past universal apply batches and safely roll back records created by a batch.",
    isAudit: true,
  },
  {
    num: 8,
    title: "Da Silva Pilot Validation",
    hint: "Track real Da Silva / Kid-e-Sys pilot runs against Universal Migration outputs — validation, dry run, and reconciliation only.",
    isPilot: true,
  },
  {
    num: 9,
    title: "Da Silva Pilot Runbook",
    hint: "Operational checklist for a real Da Silva migration — manual step tracking linked to pilot execution. No automatic apply.",
    isRunbook: true,
  },
  {
    num: 10,
    title: "Da Silva Preflight Dashboard",
    hint: "Single executive view of pilot readiness and go-live status — runbook, pilot, validation, dry run, batch, reconciliation, and sign-off. Read-only aggregation.",
    isPreflight: true,
  },
] as const;

export default function MigrationCenter() {
  const [applyNotice, setApplyNotice] = useState<string | null>(null);
  const location = useLocation();
  const onCenter =
    location.pathname.startsWith("/super-admin/migration") &&
    !location.pathname.includes("/research") &&
    !location.pathname.includes("/legacy");

  return (
    <UniversalMigrationWorkflowProvider>
      <div className="uc-migration-center">
        <header className="uc-migration-center-header">
          <h1 className="page-title">Universal Migration Center</h1>
          <p className="uc-migration-center-subtitle">
            EduClear framework for school data migration — Super Admin only. Layout foundation; pipeline wiring
            follows adapter contracts.
          </p>
        </header>

        <nav className="uc-migration-center-nav" aria-label="Migration navigation">
          <Link
            to="/super-admin/migration"
            className={`uc-migration-center-nav-link${onCenter ? " uc-migration-center-nav-link--active" : ""}`}
          >
            Migration Center
          </Link>
          <Link
            to="/super-admin/migration/research"
            className={`uc-migration-center-nav-link${!onCenter ? " uc-migration-center-nav-link--active" : ""}`}
          >
            Systems Registry
          </Link>
          <Link
            to="/super-admin/migration/legacy"
            className={`uc-migration-center-nav-link${location.pathname.includes("/legacy") ? " uc-migration-center-nav-link--active" : ""}`}
          >
            Legacy migration
          </Link>
        </nav>

        <div className="uc-migration-center-sections">
          {SECTIONS.map((section) => (
            <section
              key={section.num}
              className={`uc-migration-center-section${"isApply" in section && section.isApply ? " uc-migration-center-apply" : ""}`}
              aria-labelledby={`uc-migration-section-${section.num}`}
            >
              <div className="uc-migration-center-section-accent" aria-hidden="true" />
              <span className="uc-migration-center-section-num">{section.num}</span>
              <h2 id={`uc-migration-section-${section.num}`} className="uc-migration-center-section-title">
                {section.title}
              </h2>
              <p className="uc-migration-center-section-hint">{section.hint}</p>

              {"isUpload" in section && section.isUpload ? <UniversalMigrationUpload /> : null}

              {"isResearch" in section && section.isResearch ? (
                <div className="uc-migration-center-research-preview">
                  <MigrationSystemsRegistry />
                </div>
              ) : null}

              {"placeholder" in section && section.placeholder ? (
                <div className="uc-migration-center-placeholder">{section.placeholder}</div>
              ) : null}

              {"isValidation" in section && section.isValidation ? (
                <UniversalMigrationValidationSection />
              ) : null}

              {"isStaging" in section && section.isStaging ? <UniversalMigrationStagingSection /> : null}

              {"isApply" in section && section.isApply ? (
                <>
                  <UniversalMigrationApplySection onNotice={setApplyNotice} />
                  {applyNotice ? (
                    <p className="uc-migration-dry-run-hint" role="status">
                      {applyNotice}
                    </p>
                  ) : null}
                </>
              ) : null}

              {"isAudit" in section && section.isAudit ? (
                <UniversalMigrationImportAuditSection onNotice={setApplyNotice} />
              ) : null}

              {"isPilot" in section && section.isPilot ? <DaSilvaPilotValidationSection /> : null}

              {"isRunbook" in section && section.isRunbook ? <DaSilvaPilotRunbookSection /> : null}

              {"isPreflight" in section && section.isPreflight ? (
                <DaSilvaPreflightDashboardSection />
              ) : null}
            </section>
          ))}
        </div>
      </div>
    </UniversalMigrationWorkflowProvider>
  );
}
