import { useCallback, useEffect, useState } from "react";
import type { MigrationFileColumnMappings } from "../../superAdmin/utils/buildEffectiveFileMappings";
import type { MigrationFilePreview } from "../../superAdmin/utils/universalMigrationPreview";
import type { UniversalMigrationUploadedFile } from "../../superAdmin/utils/universalMigrationUpload";
import {
  createUniversalMigrationStage,
  deleteUniversalMigrationStage,
  fetchUniversalMigrationStage,
  fetchUniversalMigrationStages,
  type MigrationStage,
  type MigrationStageListItem,
} from "../../superAdmin/utils/universalMigrationStage";
import type {
  MigrationValidationIssue,
  MigrationValidationSummary,
} from "../../superAdmin/utils/universalMigrationValidate";
import KidESysMigrationReadinessPanel from "../../components/migration/KidESysMigrationReadinessPanel";
import UniversalMigrationValidationSummary from "./UniversalMigrationValidationSummary";
import { useUniversalMigrationWorkflow } from "./UniversalMigrationWorkflowContext";

type Props = {
  sourceSystem: string;
  previews: MigrationFilePreview[];
  uploadedFiles: UniversalMigrationUploadedFile[];
  mappings: MigrationFileColumnMappings[];
  validationSummary: MigrationValidationSummary;
  validationIssues: MigrationValidationIssue[];
  cutoverDate?: string;
};

function formatStageDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

export default function UniversalMigrationDryRunPanel({
  sourceSystem,
  previews,
  uploadedFiles,
  mappings,
  validationSummary,
  validationIssues,
  cutoverDate,
}: Props) {
  const isKidESys = sourceSystem.trim() === "kideesys";
  const { kidESysReadiness, kidESysReadinessBusy, kidESysReadinessError } =
    useUniversalMigrationWorkflow();

  const [stageBusy, setStageBusy] = useState(false);
  const [listBusy, setListBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState<MigrationStage | null>(null);
  const [previousStages, setPreviousStages] = useState<MigrationStageListItem[]>([]);

  const hasValidationErrors = validationSummary.errors > 0;
  const isFullValidation = validationSummary.mode === "full";
  const canCreateStage =
    isFullValidation && validationSummary.canProceed && !hasValidationErrors;

  const refreshStageList = useCallback(async () => {
    setListBusy(true);
    try {
      const stages = await fetchUniversalMigrationStages();
      setPreviousStages(stages);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load dry runs");
    } finally {
      setListBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshStageList();
  }, [refreshStageList]);

  const handleCreateStage = useCallback(async () => {
    if (!canCreateStage) return;
    setStageBusy(true);
    setError(null);
    try {
      const filePaths = Object.fromEntries(
        uploadedFiles.map((f) => [f.id, f.path])
      );
      const stage = await createUniversalMigrationStage({
        sourceSystem: sourceSystem.trim() || "unknown",
        previews,
        filePaths,
        mappings,
        validationSummary,
        issues: validationIssues,
        ...(cutoverDate ? { cutoverDate } : {}),
      });
      setActiveStage(stage);
      await refreshStageList();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create dry run");
    } finally {
      setStageBusy(false);
    }
  }, [
    canCreateStage,
    sourceSystem,
    previews,
    uploadedFiles,
    mappings,
    validationSummary,
    validationIssues,
    cutoverDate,
    refreshStageList,
  ]);

  const handleOpenStage = useCallback(async (stageId: string) => {
    setStageBusy(true);
    setError(null);
    try {
      const stage = await fetchUniversalMigrationStage(stageId);
      setActiveStage(stage);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to open dry run");
    } finally {
      setStageBusy(false);
    }
  }, []);

  const handleDeleteStage = useCallback(
    async (stageId: string) => {
      if (!window.confirm("Delete this dry run? This cannot be undone.")) return;
      setStageBusy(true);
      setError(null);
      try {
        await deleteUniversalMigrationStage(stageId);
        if (activeStage?.stageId === stageId) setActiveStage(null);
        await refreshStageList();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to delete dry run");
      } finally {
        setStageBusy(false);
      }
    },
    [activeStage?.stageId, refreshStageList]
  );

  return (
    <div className="uc-migration-dry-run">
      {isKidESys ? (
        <KidESysMigrationReadinessPanel
          result={kidESysReadiness}
          busy={kidESysReadinessBusy}
          error={kidESysReadinessError}
          showProceedBanner
        />
      ) : null}

      <div className="uc-migration-dry-run-actions">
        <button
          type="button"
          className="uc-migration-template-toolbar-btn uc-migration-template-toolbar-btn--stage"
          disabled={!canCreateStage || stageBusy}
          onClick={() => void handleCreateStage()}
        >
          {stageBusy ? "Staging…" : "Create Dry Run / Stage Migration"}
        </button>
        {!isFullValidation ? (
          <p className="uc-migration-dry-run-blocked" role="alert">
            Run full-file validation before creating a dry run.
          </p>
        ) : null}
        {isFullValidation && hasValidationErrors ? (
          <p className="uc-migration-dry-run-blocked" role="alert">
            Fix validation errors before staging.
          </p>
        ) : null}
        {isFullValidation && !hasValidationErrors && validationSummary.canProceed ? (
          <p className="uc-migration-dry-run-hint" role="status">
            Full-file validation passed — dry run will not write to live school data.
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="uc-migration-upload-error" role="alert">
          {error}
        </p>
      ) : null}

      {activeStage ? (
        <div className="uc-migration-dry-run-detail">
          <div className="uc-migration-dry-run-detail-header">
            <h4 className="uc-migration-validation-section-title">Staged package</h4>
            <button
              type="button"
              className="uc-migration-upload-clear"
              onClick={() => setActiveStage(null)}
            >
              Close
            </button>
          </div>
          <dl className="uc-migration-dry-run-meta">
            <div>
              <dt>Stage ID</dt>
              <dd className="uc-migration-dry-run-mono">{activeStage.stageId}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatStageDate(activeStage.createdAt)}</dd>
            </div>
            <div>
              <dt>Source system</dt>
              <dd>{activeStage.sourceSystem}</dd>
            </div>
            <div>
              <dt>Can apply</dt>
              <dd>{activeStage.canApply ? "Yes" : "No"}</dd>
            </div>
            {activeStage.cutoverDate ? (
              <div>
                <dt>Cutover date</dt>
                <dd>{activeStage.cutoverDate}</dd>
              </div>
            ) : null}
          </dl>

          <h5 className="uc-migration-dry-run-subtitle">Files included</h5>
          <ul className="uc-migration-dry-run-files">
            {activeStage.files.map((file) => (
              <li key={file.fileId}>
                <span className="uc-migration-dry-run-filename">{file.filename}</span>
                <span className="uc-migration-dry-run-file-meta">
                  {file.category} · {formatCount(file.rowCount)} rows
                </span>
              </li>
            ))}
          </ul>

          <h5 className="uc-migration-dry-run-subtitle">Staged counts</h5>
          <div className="uc-migration-dry-run-counts">
            <span>Learners: {formatCount(activeStage.stagedCounts.learners)}</span>
            <span>Parents: {formatCount(activeStage.stagedCounts.parents)}</span>
            <span>Billing accounts: {formatCount(activeStage.stagedCounts.billingAccounts)}</span>
            <span>Transactions: {formatCount(activeStage.stagedCounts.transactions)}</span>
            <span>Staff: {formatCount(activeStage.stagedCounts.staff)}</span>
            <span>Historical: {formatCount(activeStage.stagedCounts.historical)}</span>
          </div>

          {activeStage.transactionReadiness ? (
            <>
              <h5 className="uc-migration-dry-run-subtitle">Transaction readiness</h5>
              <div className="uc-migration-dry-run-counts">
                <span>
                  Historical only:{" "}
                  {formatCount(activeStage.transactionReadiness.historicalOnlyTransactions)}
                </span>
                <span>
                  Eligible active:{" "}
                  {formatCount(activeStage.transactionReadiness.eligibleActiveTransactions)}
                </span>
                <span>
                  Blocked: {formatCount(activeStage.transactionReadiness.blockedTransactions)}
                </span>
                <span>
                  Unmatched: {formatCount(activeStage.transactionReadiness.unmatchedTransactions)}
                </span>
              </div>
              <p className="uc-migration-dry-run-hint" role="note">
                Historical learner transactions are preserved for history only and will not affect
                active head count or new billing.
              </p>
            </>
          ) : null}

          <h5 className="uc-migration-dry-run-subtitle">Validation summary</h5>
          <UniversalMigrationValidationSummary summary={activeStage.validationSummary} />

          {activeStage.warnings.length > 0 ? (
            <>
              <h5 className="uc-migration-dry-run-subtitle">Warnings ({activeStage.warnings.length})</h5>
              <ul className="uc-migration-dry-run-warnings">
                {activeStage.warnings.slice(0, 20).map((w) => (
                  <li key={w}>{w}</li>
                ))}
                {activeStage.warnings.length > 20 ? (
                  <li>…and {activeStage.warnings.length - 20} more</li>
                ) : null}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="uc-migration-dry-run-history">
        <div className="uc-migration-dry-run-history-header">
          <h4 className="uc-migration-validation-section-title">Previous dry runs</h4>
          <button
            type="button"
            className="uc-migration-upload-clear"
            disabled={listBusy}
            onClick={() => void refreshStageList()}
          >
            {listBusy ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {previousStages.length === 0 ? (
          <p className="uc-migration-upload-empty">No dry runs saved yet.</p>
        ) : (
          <ul className="uc-migration-dry-run-history-list">
            {previousStages.map((item) => (
              <li key={item.stageId} className="uc-migration-dry-run-history-item">
                <div className="uc-migration-dry-run-history-main">
                  <span className="uc-migration-dry-run-history-system">{item.sourceSystem}</span>
                  <span className="uc-migration-dry-run-history-date">
                    {formatStageDate(item.createdAt)}
                  </span>
                  <span className="uc-migration-dry-run-history-meta">
                    {item.fileCount} file{item.fileCount === 1 ? "" : "s"} · learners{" "}
                    {formatCount(item.stagedCounts.learners)} · can apply:{" "}
                    {item.canApply ? "Yes" : "No"}
                  </span>
                  <span className="uc-migration-dry-run-mono uc-migration-dry-run-history-id">
                    {item.stageId}
                  </span>
                </div>
                <div className="uc-migration-dry-run-history-actions">
                  <button
                    type="button"
                    className="uc-migration-template-toolbar-btn uc-migration-template-toolbar-btn--secondary"
                    disabled={stageBusy}
                    onClick={() => void handleOpenStage(item.stageId)}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className="uc-migration-upload-clear"
                    disabled={stageBusy}
                    onClick={() => void handleDeleteStage(item.stageId)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
