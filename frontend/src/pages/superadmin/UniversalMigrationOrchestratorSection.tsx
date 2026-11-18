import { useEffect, useRef, useState } from "react";
import {
  getOrchestratorReadiness,
  postOrchestratorComplete,
  postOrchestratorPrepare,
  type AttentionItem,
  type OrchestratorRun,
  type UniversalMigrationReadiness,
} from "../../superAdmin/utils/universalMigrationOrchestrator";
import { fetchUniversalMigrationImportBatches } from "../../superAdmin/utils/universalMigrationImportBatches";
import {
  exportUniversalMigrationImportBatchReport,
  exportUniversalMigrationReconciliationReport,
} from "../../superAdmin/utils/universalMigrationReportExport";
import { useUniversalMigrationWorkflow } from "./UniversalMigrationWorkflowContext";

type Props = {
  onNotice?: (message: string) => void;
  onOpenReviewSection?: (section: string) => void;
  autoPrepareAfterUpload?: boolean;
};

const STEP_LABELS: Record<string, string> = {
  PREPARING_LEARNERS: "Preparing learners",
  LINKING_PARENTS: "Linking parents and families",
  PREPARING_ACADEMIC: "Preparing classes and subjects",
  CHECKING_ACCOUNTS: "Checking school accounts",
  VERIFYING_STATEMENTS: "Verifying statements",
  VERIFYING_FEE_CHECK: "Verifying Fee Check",
  FINAL_SAFETY_CHECK: "Final safety check",
  COMPLETE: "Complete",
  FAILED: "Stopped",
};

export default function UniversalMigrationOrchestratorSection({
  onNotice,
  onOpenReviewSection,
  autoPrepareAfterUpload = false,
}: Props) {
  const {
    dryRunStage,
    selectedSessionSchoolId,
    uploadedFiles,
    setDryRunStage,
    cutoverDate,
    sourceSystem,
  } = useUniversalMigrationWorkflow() as any;
  const stageId = dryRunStage?.stageId || "";
  const targetSchoolId =
    dryRunStage?.targetSchoolId || selectedSessionSchoolId || "";
  const [busy, setBusy] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<UniversalMigrationReadiness | null>(null);
  const [run, setRun] = useState<OrchestratorRun | null>(null);
  const [analysisSteps, setAnalysisSteps] = useState<string[]>([]);
  const [exportBusy, setExportBusy] = useState(false);
  const lastPrepareKey = useRef<string>("");

  async function refresh() {
    if (!stageId || !targetSchoolId) return;
    const result = await getOrchestratorReadiness({ stageId, targetSchoolId });
    setReadiness(result.readiness);
    setRun(result.run);
  }

  useEffect(() => {
    if (!stageId || !targetSchoolId) return;
    void refresh().catch(() => undefined);
    const t = window.setInterval(() => {
      void refresh().catch(() => undefined);
    }, 8000);
    return () => window.clearInterval(t);
  }, [stageId, targetSchoolId]);

  async function prepare() {
    if (!targetSchoolId) {
      setError("Choose the target school first.");
      return;
    }
    if (!uploadedFiles?.length) {
      setError("Upload the school’s export files first.");
      return;
    }
    setAnalysing(true);
    setBusy(true);
    setError(null);
    try {
      const result = await postOrchestratorPrepare({
        targetSchoolId,
        cutoverDate: cutoverDate || undefined,
        sourceSystem: sourceSystem || undefined,
      });
      if (result.stage && setDryRunStage) {
        setDryRunStage(result.stage as any);
      }
      setReadiness(result.readiness);
      setAnalysisSteps(result.steps || []);
      onNotice?.(result.plainLanguage || result.readiness.plainLanguageOverall);
    } catch (e: unknown) {
      setError(
        e instanceof Error
          ? e.message
          : "EduClear could not analyse the uploaded school files."
      );
    } finally {
      setBusy(false);
      setAnalysing(false);
    }
  }

  // Auto-prepare after upload when files change and no stage yet
  useEffect(() => {
    if (!autoPrepareAfterUpload) return;
    if (!targetSchoolId || !uploadedFiles?.length) return;
    const key = `${targetSchoolId}:${uploadedFiles.map((f: any) => f.id).join(",")}`;
    if (key === lastPrepareKey.current) return;
    if (stageId && dryRunStage) {
      lastPrepareKey.current = key;
      return;
    }
    lastPrepareKey.current = key;
    void prepare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrepareAfterUpload, targetSchoolId, uploadedFiles?.length, stageId]);

  async function complete() {
    if (!stageId || !targetSchoolId || !readiness?.readyToComplete) return;
    const schoolName =
      dryRunStage?.targetSchoolName ||
      readiness.summaryLines?.find((l) => /school/i.test(l)) ||
      targetSchoolId;
    const financeDomain = readiness.domains.find((d) => d.domainId === "FINANCE");
    const financeApplicable = Boolean(financeDomain?.applicable);
    const fileCount = uploadedFiles?.length ?? 0;
    const fileNames = (uploadedFiles || [])
      .slice(0, 8)
      .map((f: { filename?: string; name?: string }) => f.filename || f.name || "file")
      .join(", ");
    const moreFiles =
      fileCount > 8 ? ` (+${fileCount - 8} more)` : fileCount ? "" : " (none listed)";
    const confirmed = window.confirm(
      [
        "Approve & Import — final confirmation",
        "",
        `Destination school: ${schoolName}`,
        `School id: ${targetSchoolId}`,
        `Files ready: ${fileCount}${fileNames ? ` — ${fileNames}${moreFiles}` : ""}`,
        `Check result: ${readiness.plainLanguageOverall}`,
        `Problems blocking import: ${readiness.blockingIssueCount}`,
        `Money check: ${financeApplicable ? "Yes — totals must match (R0.00 difference)" : "No money files in this upload"}`,
        "",
        "This will import learners, families, classes and (if included) money into the destination school only.",
        "Press Cancel if the school name or files look wrong.",
      ].join("\n")
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await postOrchestratorComplete({
        stageId,
        targetSchoolId,
        confirmation: true,
      });
      setRun(result.run);
      setReadiness(result.readiness);
      const failed = Array.isArray(result.run?.domainsFailed)
        ? result.run.domainsFailed
        : [];
      if (result.run?.status === "BLOCKED" || failed.length > 0) {
        const why =
          failed
            .map((f) => String(f?.reason || "").trim())
            .filter(Boolean)
            .join(" ") || "EduClear stopped the import to protect school data.";
        setError(
          `Import did not finish: ${why} Nothing was left half-imported — fix the Check items, then try Approve & Import again.`
        );
        onNotice?.("Import stopped safely. Existing school data was not overwritten.");
      } else {
        onNotice?.(result.plainLanguage);
      }
    } catch (e: unknown) {
      setError(
        e instanceof Error
          ? e.message
          : "EduClear could not finish the migration. Nothing has been duplicated — you can retry."
      );
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const blocking = readiness?.attentionItems.filter((a) => a.severity === "BLOCKING") || [];
  const warnings = readiness?.attentionItems.filter((a) => a.severity === "WARNING") || [];
  const isComplete =
    readiness?.overallStatus === "COMPLETE" ||
    readiness?.overallStatus === "COMPLETE_ACCEPTED" ||
    readiness?.overallStatus === "COMPLETE_SUPPLIED_DATA" ||
    run?.status === "COMPLETE_ACCEPTED" ||
    run?.status === "COMPLETE_SUPPLIED_DATA";

  const financeDomain = readiness?.domains.find((d) => d.domainId === "FINANCE");
  const financePhase = String(financeDomain?.metrics?.reconciliationPhase || "");
  const financeVerified = financeDomain?.status === "VERIFIED" && financePhase === "verified";
  const financeDiffBlocking =
    Boolean(financeDomain?.applicable) &&
    financePhase !== "projected" &&
    typeof financeDomain?.metrics?.differenceCents === "number" &&
    financeDomain.metrics.differenceCents !== 0;
  const financeBlocking =
    financeDiffBlocking ||
    (Boolean(financeDomain?.applicable) &&
      (financeDomain?.status === "BLOCKED" || financeDomain?.status === "FAILED") &&
      Boolean(
        blocking.some((b) =>
          /finance|balance|R0|reconcil|account/i.test(`${b.title} ${b.message}`)
        )
      ));
  const canApprove =
    Boolean(readiness?.readyToComplete) &&
    blocking.length === 0 &&
    !financeDiffBlocking &&
    !financeBlocking &&
    readiness?.overallStatus !== "NEEDS_ATTENTION" &&
    !isComplete;

  const mandatoryFailed =
    run?.status === "BLOCKED" ||
    run?.status === "FAILED" ||
    (Array.isArray(run?.domainsFailed) && run.domainsFailed.length > 0) ||
    blocking.length > 0 ||
    financeDiffBlocking ||
    financeBlocking;

  const financeMetrics = financeDomain?.metrics || {};
  const differenceCents =
    financePhase === "projected"
      ? null
      : typeof financeMetrics.differenceCents === "number"
        ? financeMetrics.differenceCents
        : typeof run?.summary?.differenceCents === "number"
          ? (run.summary.differenceCents as number)
          : null;

  async function downloadAuditReport() {
    if (!targetSchoolId || !stageId) return;
    setExportBusy(true);
    setError(null);
    try {
      const batches = await fetchUniversalMigrationImportBatches();
      const match =
        batches.find((b) => b.stageId === stageId && b.targetSchoolId === targetSchoolId) ||
        batches.find((b) => b.targetSchoolId === targetSchoolId);
      if (!match?.batchId) {
        throw new Error("No import audit batch found yet for this migration.");
      }
      await exportUniversalMigrationImportBatchReport(match.batchId);
      try {
        await exportUniversalMigrationReconciliationReport(match.batchId, targetSchoolId);
      } catch {
        // Reconciliation export is optional when finance was not supplied.
      }
      onNotice?.("Audit report download started.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not download the audit report.");
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <div className="uc-migration-orchestrator">
      {analysing ? (
        <p className="uc-migration-dry-run-hint" role="status">
          Step 2 — Checking uploaded school information…
        </p>
      ) : null}

      <div className="uc-migration-apply-stage-row">
        <button
          type="button"
          className="uc-migration-upload-clear"
          disabled={busy || !targetSchoolId || !uploadedFiles?.length}
          onClick={() => void prepare()}
        >
          {busy && analysing ? "Checking…" : "Re-check files"}
        </button>
        <button
          type="button"
          className="uc-migration-upload-clear"
          disabled={busy || !stageId}
          onClick={() => void refresh()}
        >
          Refresh status
        </button>
        <button
          type="button"
          className="uc-migration-upload-primary"
          disabled={busy || !canApprove}
          onClick={() => void complete()}
          title={
            !readiness?.readyToComplete
              ? "Fix the Check problems first. Money totals must match (R0.00) before Approve & Import."
              : "Approve the destination school and start the import"
          }
        >
          {isComplete && !mandatoryFailed
            ? "Import complete"
            : run?.status === "BLOCKED" || run?.status === "FAILED"
              ? "Import stopped — fix & retry"
              : "Approve & Import"}
        </button>
      </div>

      {error ? (
        <p className="uc-migration-error" role="alert">
          {error}
        </p>
      ) : null}

      {readiness ? (
        <div className="uc-migration-finance-summary" role="status">
          <h3>School Migration</h3>
          <p>
            <strong>Status:</strong> {readiness.plainLanguageOverall}
          </p>
          <ul className="uc-migration-finance-totals">
            {readiness.domains.map((d) => {
              const phase = String(d.metrics?.reconciliationPhase || "");
              const moneyDomain =
                d.domainId === "FINANCE" ||
                d.domainId === "STATEMENTS" ||
                d.domainId === "FEE_CHECK";
              // Never show financial success (✓) before post-import verification.
              const mark = !d.applicable
                ? "–"
                : d.status === "VERIFIED"
                  ? "✓"
                  : d.status === "BLOCKED" || d.status === "FAILED"
                    ? "✗"
                    : moneyDomain && (phase === "projected" || !phase || d.status === "READY")
                      ? "…"
                      : d.status === "READY" || d.status === "APPLIED"
                        ? "✓"
                        : "!";
              return (
                <li key={d.domainId}>
                  {mark}{" "}
                  <strong>{d.label}</strong> — {d.plainLanguage}
                </li>
              );
            })}
          </ul>
        </div>
      ) : uploadedFiles?.length ? (
        <p className="uc-migration-dry-run-hint">
          Upload finished. EduClear will analyse the files automatically.
        </p>
      ) : (
        <p className="uc-migration-dry-run-hint">Upload the school’s export files to begin.</p>
      )}

      {blocking.length > 0 ? (
        <div className="uc-migration-finance-summary">
          <h3>
            {blocking.length} item{blocking.length === 1 ? "" : "s"} need your attention
          </h3>
          <ul>
            {blocking.map((item: AttentionItem) => (
              <li key={item.attentionId}>
                <strong>{item.title}</strong> — {item.message}{" "}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onOpenReviewSection?.(item.reviewSection)}
                >
                  Review
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="uc-migration-finance-summary">
          <h3>Notes</h3>
          <ul>
            {warnings.map((item) => (
              <li key={item.attentionId}>
                {item.title}: {item.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {run ? (
        <div
          className={`uc-migration-finance-summary${
            isComplete && !mandatoryFailed
              ? " uc-migration-completion-card"
              : run.status === "BLOCKED" || run.status === "FAILED"
                ? " uc-migration-completion-card uc-migration-completion-card--blocked"
                : ""
          }`}
          role="status"
        >
          <h3>
            {run.status === "BLOCKED" || run.status === "FAILED"
              ? "Import stopped"
              : isComplete && !mandatoryFailed
                ? "Import finished"
                : "Progress"}
          </h3>
          <p>
            {STEP_LABELS[run.currentStep] || run.currentStep} ({run.status})
            {run.idempotentReplay ? " — safe replay" : ""}
          </p>
          {Array.isArray(run.domainsFailed) && run.domainsFailed.length > 0 ? (
            <ul>
              {run.domainsFailed.map((f) => (
                <li key={`${f.domainId}-${f.reason}`}>
                  {f.reason || `Problem in ${f.domainId}`}
                </li>
              ))}
            </ul>
          ) : null}
          {isComplete || run.status === "BLOCKED" ? (
            <>
              <ul className="uc-migration-completion-totals">
                <li>Learners imported: {String(run.summary.learners ?? "—")}</li>
                <li>
                  Parents and families imported: {String(run.summary.parents ?? "—")}
                  {run.summary.links != null ? ` · links ${String(run.summary.links)}` : ""}
                </li>
                <li>Classes created: {String(run.summary.classrooms ?? "—")}</li>
                <li>Subjects prepared: {String(run.summary.subjects ?? "—")}</li>
                <li>
                  Financial records:{" "}
                  {financeDomain?.applicable
                    ? String(
                        run.summary.accounts ??
                          financeMetrics.accounts ??
                          "checked"
                      )
                    : "None supplied"}
                </li>
                <li>
                  Financial difference:{" "}
                  {financeDomain?.applicable
                    ? financePhase === "projected" || differenceCents == null
                      ? isComplete && financeVerified
                        ? "R0.00 — verified after import"
                        : "Pending post-import verification (projected only before import)"
                      : differenceCents === 0 && financeVerified
                        ? "R0.00 — verified after import"
                        : differenceCents === 0
                          ? "R0.00 — pending confirmation"
                          : `R${(Math.abs(differenceCents) / 100).toFixed(2)} — must be fixed`
                    : "N/A (no finance files)"}
                </li>
                {Array.isArray(run.summary.warnings)
                  ? (run.summary.warnings as string[]).map((w) => (
                      <li key={w}>Needs attention: {w}</li>
                    ))
                  : null}
              </ul>
              {isComplete && !mandatoryFailed ? (
                <div className="uc-migration-completion-actions">
                  <button
                    type="button"
                    className="uc-migration-upload-clear"
                    disabled={exportBusy || !stageId || !targetSchoolId}
                    onClick={() => void downloadAuditReport()}
                  >
                    {exportBusy ? "Preparing report…" : "Download audit report"}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {analysisSteps.length > 0 ? (
        <details className="uc-migration-dry-run-hint">
          <summary>What EduClear did automatically</summary>
          <ul>
            {analysisSteps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
