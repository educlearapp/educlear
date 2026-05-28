import { useCallback, useEffect, useMemo, useState } from "react";
import MigrationDryRunReview from "../../superAdmin/components/migration/MigrationDryRunReview";
import { superAdminApiFetch } from "../../superAdmin/superAdminApi";
import type { SchoolOption } from "../../superAdmin/types/migration";
import {
  applyUniversalMigrationStage,
  UniversalMigrationApplyError,
  type MigrationApplyResult,
} from "../../superAdmin/utils/universalMigrationApply";
import {
  fetchUniversalMigrationStage,
  fetchUniversalMigrationStages,
  type MigrationStage,
  type MigrationStageListItem,
} from "../../superAdmin/utils/universalMigrationStage";
import { buildMigrationChecklist } from "../../superAdmin/utils/migrationChecklist";
import UniversalMigrationReadinessChecklist from "./UniversalMigrationReadinessChecklist";

type Props = {
  onNotice?: (message: string) => void;
};

function formatStageDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatApplyCounts(label: string, counts: MigrationApplyResult["createdCounts"]): string {
  const parts = [
    `learners ${counts.learners}`,
    `parents ${counts.parents}`,
    `billing ${counts.billingAccounts}`,
    `transactions ${counts.transactions}`,
    `classrooms ${counts.classrooms}`,
    `links ${counts.parentLearnerLinks}`,
  ];
  return `${label}: ${parts.join(", ")}`;
}

export default function UniversalMigrationApplySection({ onNotice }: Props) {
  const [schoolOptions, setSchoolOptions] = useState<SchoolOption[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [stages, setStages] = useState<MigrationStageListItem[]>([]);
  const [selectedStageId, setSelectedStageId] = useState("");
  const [stage, setStage] = useState<MigrationStage | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [stageBusy, setStageBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<MigrationApplyResult | null>(null);
  const [manualChecklist, setManualChecklist] = useState({
    warningsReviewed: false,
    mappingsReviewed: false,
    backupConfirmed: false,
    proceedWithEligibleActiveTransactionsOnly: false,
    finalConfirmationAccepted: false,
  });

  const selectedSchool = useMemo(
    () => schoolOptions.find((s) => s.id === selectedSchoolId) ?? null,
    [schoolOptions, selectedSchoolId]
  );

  const refreshStages = useCallback(async () => {
    setListBusy(true);
    setError(null);
    try {
      const list = await fetchUniversalMigrationStages();
      setStages(list);
      if (selectedStageId && !list.some((s) => s.stageId === selectedStageId)) {
        setSelectedStageId("");
        setStage(null);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load dry runs");
    } finally {
      setListBusy(false);
    }
  }, [selectedStageId]);

  useEffect(() => {
    void (async () => {
      try {
        const schools = (await superAdminApiFetch("/api/schools")) as Array<{
          id: string;
          name: string;
        }>;
        setSchoolOptions((schools || []).map((s) => ({ id: s.id, name: s.name })));
      } catch {
        setSchoolOptions([]);
      }
    })();
  }, []);

  useEffect(() => {
    void refreshStages();
  }, [refreshStages]);

  const loadStage = useCallback(async (stageId: string) => {
    if (!stageId) {
      setStage(null);
      return;
    }
    setStageBusy(true);
    setError(null);
    try {
      const loaded = await fetchUniversalMigrationStage(stageId);
      setStage(loaded);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load dry run");
      setStage(null);
    } finally {
      setStageBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadStage(selectedStageId);
    setApplyResult(null);
    setManualChecklist({
      warningsReviewed: false,
      mappingsReviewed: false,
      backupConfirmed: false,
      proceedWithEligibleActiveTransactionsOnly: false,
      finalConfirmationAccepted: false,
    });
  }, [selectedStageId, loadStage]);

  const reviewCounts = useMemo(() => {
    if (!stage) return [];
    const c = stage.stagedCounts;
    return [
      { label: "Learners", value: c.learners },
      { label: "Parents", value: c.parents },
      { label: "Billing accounts", value: c.billingAccounts },
      { label: "Transactions", value: c.transactions },
      { label: "Staff", value: c.staff },
      { label: "Historical", value: c.historical },
    ];
  }, [stage]);

  const transactionReadiness = useMemo(() => {
    if (!stage) return null;
    return (
      stage.transactionReadiness ?? {
        historicalOnlyTransactions: 0,
        eligibleActiveTransactions: 0,
        blockedTransactions: 0,
        unmatchedTransactions: 0,
      }
    );
  }, [stage]);

  const transactionGate = useMemo(() => {
    if (!stage) return null;
    const hasTransactionFiles = (stage.stagedCounts?.transactions ?? 0) > 0;
    return {
      hasTransactionFiles,
      blockedTransactions: transactionReadiness?.blockedTransactions ?? 0,
      unmatchedTransactions: transactionReadiness?.unmatchedTransactions ?? 0,
      cutoverDate: stage.cutoverDate ?? null,
    };
  }, [stage, transactionReadiness]);

  const readinessChecklist = useMemo(
    () =>
      buildMigrationChecklist(
        {
          targetSchoolId: selectedSchoolId,
          stageSelected: Boolean(stage),
          validationSummary: stage?.validationSummary ?? null,
          transactionGate,
        },
        manualChecklist
      ),
    [selectedSchoolId, stage, manualChecklist, transactionGate]
  );

  const proceedWithEligibleActiveOnly = useMemo(
    () => readinessChecklist.items.proceedWithEligibleActiveTransactionsOnly,
    [readinessChecklist.items.proceedWithEligibleActiveTransactionsOnly]
  );

  const phase14PostingEnabled = Boolean(transactionGate?.hasTransactionFiles);

  const applyBlockedReason = useMemo(() => {
    if (!selectedSchoolId) {
      return "Select the target school before applying this dry run.";
    }
    if (!stage) return "Select a dry run package.";
    if (!stage.canApply) {
      return "This dry run cannot be applied until validation passes (canApply is false).";
    }
    if (stage.validationSummary.errors > 0) {
      return `This dry run has ${stage.validationSummary.errors} validation error(s).`;
    }
    const missingPaths = stage.files.some((f) => !f.path);
    if (missingPaths) {
      return "This dry run is missing staged file paths. Re-create the dry run from Upload Area while source files are still on the server.";
    }
    if (
      transactionGate?.hasTransactionFiles &&
      !String(transactionGate.cutoverDate || "").trim()
    ) {
      return "Cutover date is required before applying transaction files. Re-stage the dry run with a cutover date.";
    }
    if (!readinessChecklist.readyForApply) {
      return "Complete Migration Readiness Checklist before apply.";
    }
    return null;
  }, [selectedSchoolId, stage, readinessChecklist.readyForApply, transactionGate]);

  const handleApply = useCallback(
    async (confirmationText: string) => {
      if (!stage || !selectedSchoolId || applyBlockedReason) return;
      const resolvedConfirmationText =
        confirmationText.trim() ||
        (readinessChecklist.readyForApply ? (selectedSchool?.name?.trim() ?? "") : "");
      if (!resolvedConfirmationText) return;
      setApplyBusy(true);
      setError(null);
      setApplyResult(null);
      try {
        const result = await applyUniversalMigrationStage({
          stageId: stage.stageId,
          targetSchoolId: selectedSchoolId,
          confirmationText: resolvedConfirmationText,
          proceedWithEligibleActiveOnly,
        });
        setApplyResult(result);
        onNotice?.(
          `Migration applied to ${result.targetSchoolName}. Batch ${result.batchId}.`
        );
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Apply failed";
        setError(message);
        if (e instanceof UniversalMigrationApplyError && e.result) {
          setApplyResult(e.result);
        }
        onNotice?.(message);
      } finally {
        setApplyBusy(false);
      }
    },
    [
      stage,
      selectedSchoolId,
      selectedSchool,
      applyBlockedReason,
      readinessChecklist.readyForApply,
      proceedWithEligibleActiveOnly,
      onNotice,
    ]
  );

  const reportPreview = applyResult?.report?.slice(0, 200) ?? [];

  return (
    <div className="uc-migration-apply-section">
      <label className="uc-migration-staging-source-label">
        Target school
        <select
          className="uc-migration-staging-source-input"
          value={selectedSchoolId}
          onChange={(e) => setSelectedSchoolId(e.target.value)}
        >
          <option value="">Choose school to apply migration into</option>
          {schoolOptions.map((school) => (
            <option key={school.id} value={school.id}>
              {school.name}
            </option>
          ))}
        </select>
      </label>

      <div className="uc-migration-apply-stage-row">
        <label className="uc-migration-staging-source-label">
          Dry run package
          <select
            className="uc-migration-staging-source-input"
            value={selectedStageId}
            onChange={(e) => setSelectedStageId(e.target.value)}
            disabled={listBusy || stages.length === 0}
          >
            <option value="">
              {stages.length === 0 ? "No dry runs — stage from Upload Area first" : "Select a dry run"}
            </option>
            {stages.map((item) => (
              <option key={item.stageId} value={item.stageId}>
                {item.sourceSystem} · {formatStageDate(item.createdAt)} · apply:{" "}
                {item.canApply ? "yes" : "no"}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="uc-migration-upload-clear"
          disabled={listBusy}
          onClick={() => void refreshStages()}
        >
          {listBusy ? "Refreshing…" : "Refresh list"}
        </button>
      </div>

      {error ? (
        <p className="uc-migration-upload-error" role="alert">
          {error}
        </p>
      ) : null}

      {stageBusy ? (
        <p className="uc-migration-upload-empty" role="status">
          Loading dry run…
        </p>
      ) : null}

      {stage ? (
        <UniversalMigrationReadinessChecklist
          checklist={readinessChecklist}
          manualChecked={manualChecklist}
          transactionGate={transactionGate}
          onManualChange={(key, checked) =>
            setManualChecklist((prev) => ({ ...prev, [key]: checked }))
          }
        />
      ) : null}

      {stage ? (
        <MigrationDryRunReview
          schoolId={selectedSchoolId}
          schoolName={selectedSchool?.name || "Selected school"}
          canApply={stage.canApply && stage.validationSummary.errors === 0}
          counts={reviewCounts}
          transactionReadiness={transactionReadiness}
          cutoverDate={stage.cutoverDate}
          warnings={stage.warnings}
          validation={{
            canApply: stage.canApply,
            errors: stage.validationSummary.errors,
            warnings: stage.validationSummary.warnings,
            info: stage.validationSummary.info,
            canProceed: stage.validationSummary.canProceed,
          }}
          applyLabel="Apply migration"
          applyBlockedReason={applyBlockedReason}
          transactionPostingWarning={
            phase14PostingEnabled
              ? "Phase 14 transaction posting is enabled. Only eligible active learner/account transactions on or after the cutover date will post. Historical, inactive, blocked, or unmatched transactions will not post."
              : null
          }
          confirmPhrase={selectedSchool?.name || "APPLY"}
          checklistReadyForApply={readinessChecklist.readyForApply}
          onApply={handleApply}
          busy={stageBusy || applyBusy}
        />
      ) : null}

      {applyResult ? (
        <section className="uc-migration-apply-result" aria-labelledby="apply-result-heading">
          <h3 id="apply-result-heading" className="uc-migration-validation-section-title">
            Import result
          </h3>
          <dl className="uc-migration-apply-result-summary">
            <div>
              <dt>Batch ID</dt>
              <dd className="uc-migration-dry-run-mono">{applyResult.batchId}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{applyResult.success ? "Completed" : "Failed"}</dd>
            </div>
            <div>
              <dt>Applied at</dt>
              <dd>{formatStageDate(applyResult.appliedAt)}</dd>
            </div>
          </dl>
          <p className="uc-migration-upload-empty">
            {formatApplyCounts("Created", applyResult.createdCounts)}
          </p>
          <p className="uc-migration-upload-empty">
            {formatApplyCounts("Skipped", applyResult.skippedCounts)}
          </p>
          <p className="uc-migration-upload-empty">
            {formatApplyCounts("Failed", applyResult.failedCounts)}
          </p>
          {applyResult.transactionOutcomes ? (
            <div className="uc-migration-apply-tx-outcomes">
              <h4 className="uc-migration-validation-section-title">Transaction import</h4>
              <ul className="uc-migration-readiness-list">
                <li>Posted: {applyResult.transactionOutcomes.posted}</li>
                <li>
                  Historical not applied: {applyResult.transactionOutcomes.historicalNotApplied}
                </li>
                <li>Blocked: {applyResult.transactionOutcomes.blocked}</li>
                <li>Unmatched: {applyResult.transactionOutcomes.unmatched}</li>
                <li>Duplicate skipped: {applyResult.transactionOutcomes.duplicateSkipped}</li>
              </ul>
            </div>
          ) : null}
          <div className="uc-migration-apply-report-wrap">
            <table className="uc-migration-apply-report-table">
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>File</th>
                  <th>Row</th>
                  <th>Status</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {reportPreview.map((row, idx) => (
                  <tr key={`${row.entityType}-${row.sourceFileId}-${row.rowNumber}-${idx}`}>
                    <td>{row.entityType}</td>
                    <td>{row.sourceFilename}</td>
                    <td>{row.rowNumber}</td>
                    <td>{row.status}</td>
                    <td>{row.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(applyResult.report?.length ?? 0) > reportPreview.length ? (
              <p className="uc-migration-upload-empty">
                Showing first {reportPreview.length} of {applyResult.report.length} report rows.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {stage ? (
        <p className="uc-migration-upload-empty">
          Stage <span className="uc-migration-dry-run-mono">{stage.stageId}</span> · source{" "}
          {stage.sourceSystem}
        </p>
      ) : null}
    </div>
  );
}
