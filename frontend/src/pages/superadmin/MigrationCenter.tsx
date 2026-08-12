import { useState } from "react";
import MigrationSystemsRegistry from "../../components/migration/MigrationSystemsRegistry";
import UniversalMigrationApplySection from "./UniversalMigrationApplySection";
import UniversalMigrationImportAuditSection from "./UniversalMigrationImportAuditSection";
import UniversalMigrationUpload from "./UniversalMigrationUpload";
import UniversalMigrationSourceAnalysisSection from "./UniversalMigrationSourceAnalysisSection";
import UniversalMigrationPlanSection from "./UniversalMigrationPlanSection";
import UniversalMigrationValidationSection from "./UniversalMigrationValidationSection";
import UniversalMigrationStagingSection from "./UniversalMigrationStagingSection";
import UniversalMigrationParentReviewSection from "./UniversalMigrationParentReviewSection";
import UniversalMigrationFinanceCheckSection from "./UniversalMigrationFinanceCheckSection";
import UniversalMigrationStatementCheckSection from "./UniversalMigrationStatementCheckSection";
import UniversalMigrationFeeCheckSection from "./UniversalMigrationFeeCheckSection";
import UniversalMigrationAgingCheckSection from "./UniversalMigrationAgingCheckSection";
import UniversalMigrationFinancialSequence from "./UniversalMigrationFinancialSequence";
import UniversalMigrationAcceptSection from "./UniversalMigrationAcceptSection";
import UniversalMigrationAcademicReviewSection from "./UniversalMigrationAcademicReviewSection";
import UniversalMigrationParentFamilySection from "./UniversalMigrationParentFamilySection";
import UniversalMigrationOrchestratorSection from "./UniversalMigrationOrchestratorSection";
import type {
  MigrationAgingCheck,
  MigrationFeeCheckAuthorityCheck,
  MigrationFinanceReconciliation,
  MigrationStatementAuthorityCheck,
} from "../../superAdmin/utils/universalMigrationFinance";
import {
  postAgingCheck,
  postFeeCheckAuthority,
  postStatementAuthorityCheck,
} from "../../superAdmin/utils/universalMigrationFinance";
import { UniversalMigrationWorkflowProvider } from "./UniversalMigrationWorkflowContext";
import UniversalMigrationCenterNav from "./UniversalMigrationCenterNav";
import "./MigrationCenter.css";

export default function MigrationCenter() {
  const [applyNotice, setApplyNotice] = useState<string | null>(null);
  const [financeRecon, setFinanceRecon] = useState<MigrationFinanceReconciliation | null>(null);
  const [statementCheck, setStatementCheck] =
    useState<MigrationStatementAuthorityCheck | null>(null);
  const [feeCheck, setFeeCheck] = useState<MigrationFeeCheckAuthorityCheck | null>(null);
  const [agingCheck, setAgingCheck] = useState<MigrationAgingCheck | null>(null);
  const [seqBusy, setSeqBusy] = useState(false);
  const [focusSection, setFocusSection] = useState<string | null>(null);

  async function runFinancialChecks() {
    if (!financeRecon) return;
    setSeqBusy(true);
    try {
      const stmt = await postStatementAuthorityCheck({
        stageId: financeRecon.stageId,
        reconciliationId: financeRecon.reconciliationId,
        targetSchoolId: financeRecon.targetSchoolId,
      });
      setStatementCheck(stmt.check);
      setFeeCheck(null);
      setAgingCheck(null);
      if (!stmt.check.statementAuthorityMatch) {
        setApplyNotice("Statement balances need attention before Fee Check.");
        return;
      }
      const fee = await postFeeCheckAuthority({
        stageId: financeRecon.stageId,
        reconciliationId: financeRecon.reconciliationId,
        statementAuthorityCheckId: stmt.check.checkId,
        targetSchoolId: financeRecon.targetSchoolId,
      });
      setFeeCheck(fee.check);
      const aging = await postAgingCheck({
        stageId: financeRecon.stageId,
        reconciliationId: financeRecon.reconciliationId,
        targetSchoolId: financeRecon.targetSchoolId,
      });
      setAgingCheck(aging.check);
      setApplyNotice(
        fee.check.feeCheckAuthorityMatch
          ? "Financial checks complete."
          : "Fee Check still needs attention."
      );
    } catch (e: unknown) {
      setApplyNotice(e instanceof Error ? e.message : "Financial checks failed");
    } finally {
      setSeqBusy(false);
    }
  }

  function openReview(section: string) {
    setFocusSection(section);
    const el = document.getElementById(`uc-adv-${section}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <UniversalMigrationWorkflowProvider>
      <div className="uc-migration-center">
        <header className="uc-migration-center-header">
          <h1 className="page-title">Universal Migration Center</h1>
          <p className="uc-migration-center-subtitle">
            Upload → Review exceptions → Complete Migration. Super Admin only.
          </p>
        </header>

        <UniversalMigrationCenterNav />

        <div className="uc-migration-center-sections">
          <section className="uc-migration-center-section" aria-labelledby="uc-mig-main">
            <div className="uc-migration-center-section-accent" aria-hidden="true" />
            <span className="uc-migration-center-section-num">1</span>
            <h2 id="uc-mig-main" className="uc-migration-center-section-title">
              School Migration
            </h2>
            <p className="uc-migration-center-section-hint">
              Choose the school, upload the export files, and let EduClear analyse everything
              automatically. Review only genuine exceptions, then Complete Migration.
            </p>
            <UniversalMigrationUpload />
            <UniversalMigrationOrchestratorSection
              onNotice={setApplyNotice}
              onOpenReviewSection={openReview}
              autoPrepareAfterUpload
            />
            {applyNotice ? (
              <p className="uc-migration-dry-run-hint" role="status">
                {applyNotice}
              </p>
            ) : null}
          </section>

          <details className="uc-migration-center-section" open={Boolean(focusSection)}>
            <summary className="uc-migration-center-section-title">
              Advanced tools (only when needed)
            </summary>
            <p className="uc-migration-center-section-hint">
              Detailed diagnostics and manual controls. Normal migrations should not require these.
            </p>

            <div id="uc-adv-packageAnalysis">
              <h3>Package Analysis</h3>
              <UniversalMigrationSourceAnalysisSection onNotice={setApplyNotice} />
            </div>
            <div>
              <h3>Migration Plan</h3>
              <UniversalMigrationPlanSection onNotice={setApplyNotice} />
            </div>
            <div>
              <h3>Validation</h3>
              <UniversalMigrationValidationSection />
            </div>
            <div>
              <h3>Dry run (manual)</h3>
              <UniversalMigrationStagingSection />
            </div>
            <div id="uc-adv-parentReview">
              <h3>Parent Review</h3>
              <UniversalMigrationParentReviewSection onNotice={setApplyNotice} />
            </div>
            <div>
              <h3>Apply Migration (manual)</h3>
              <UniversalMigrationApplySection onNotice={setApplyNotice} />
            </div>
            <div id="uc-adv-academic">
              <h3>Academic Structure</h3>
              <UniversalMigrationAcademicReviewSection onNotice={setApplyNotice} />
            </div>
            <div id="uc-adv-parentsFamilies">
              <h3>Parents & Families</h3>
              <UniversalMigrationParentFamilySection onNotice={setApplyNotice} />
            </div>
            <div id="uc-adv-finance">
              <h3>Finance</h3>
              <UniversalMigrationFinancialSequence
                reconciliation={financeRecon}
                statementCheck={statementCheck}
                feeCheck={feeCheck}
                agingCheck={agingCheck}
                busy={seqBusy}
                onRunFinancialChecks={() => void runFinancialChecks()}
              />
              <UniversalMigrationFinanceCheckSection
                onNotice={setApplyNotice}
                onReconciliation={(r) => {
                  setFinanceRecon(r);
                  setStatementCheck(null);
                  setFeeCheck(null);
                  setAgingCheck(null);
                }}
              />
            </div>
            <div id="uc-adv-statements">
              <h3>Statements</h3>
              <UniversalMigrationStatementCheckSection
                reconciliation={financeRecon}
                onNotice={setApplyNotice}
                onStatementCheck={(c) => {
                  setStatementCheck(c);
                  setFeeCheck(null);
                  setAgingCheck(null);
                }}
              />
            </div>
            <div id="uc-adv-feeCheck">
              <h3>Fee Check</h3>
              <UniversalMigrationFeeCheckSection
                reconciliation={financeRecon}
                statementCheck={statementCheck}
                onNotice={setApplyNotice}
                onFeeCheck={setFeeCheck}
              />
            </div>
            <div>
              <h3>Aging</h3>
              <UniversalMigrationAgingCheckSection
                reconciliation={financeRecon}
                onNotice={setApplyNotice}
                onAgingCheck={setAgingCheck}
              />
            </div>
            <div>
              <h3>Accept Migration (manual)</h3>
              <UniversalMigrationAcceptSection
                reconciliation={financeRecon}
                statementCheck={statementCheck}
                feeCheck={feeCheck}
                onNotice={setApplyNotice}
              />
            </div>
            <div>
              <h3>Systems Registry</h3>
              <MigrationSystemsRegistry />
            </div>
            <div>
              <h3>Import Audit</h3>
              <UniversalMigrationImportAuditSection onNotice={setApplyNotice} />
            </div>
          </details>
        </div>
      </div>
    </UniversalMigrationWorkflowProvider>
  );
}
