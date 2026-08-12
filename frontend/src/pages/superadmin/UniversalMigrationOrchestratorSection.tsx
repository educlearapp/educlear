import { useEffect, useRef, useState } from "react";
import {
  getOrchestratorReadiness,
  postOrchestratorComplete,
  postOrchestratorPrepare,
  type AttentionItem,
  type OrchestratorRun,
  type UniversalMigrationReadiness,
} from "../../superAdmin/utils/universalMigrationOrchestrator";
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
        "COMPLETE MIGRATION — CONFIRM TARGET SCHOOL",
        "",
        `Target school: ${schoolName}`,
        `School id: ${targetSchoolId}`,
        `Source files: ${fileCount} uploaded${fileNames ? ` — ${fileNames}${moreFiles}` : ""}`,
        `Readiness: ${readiness.plainLanguageOverall}`,
        `Blocking issues: ${readiness.blockingIssueCount}`,
        `Finance in this migration: ${financeApplicable ? "YES — R0.00 required" : "No finance domain detected"}`,
        "",
        "This will WRITE learners, parents, academics, and (if applicable) finance into the target school above.",
        "Press Cancel if the school or files look wrong.",
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
      onNotice?.(result.plainLanguage);
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

  return (
    <div className="uc-migration-orchestrator">
      {analysing ? (
        <p className="uc-migration-dry-run-hint" role="status">
          Analysing school information…
        </p>
      ) : null}

      <div className="uc-migration-apply-stage-row">
        <button
          type="button"
          className="uc-migration-upload-clear"
          disabled={busy || !targetSchoolId || !uploadedFiles?.length}
          onClick={() => void prepare()}
        >
          {busy && analysing ? "Analysing…" : "Re-analyse files"}
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
          disabled={busy || !readiness?.readyToComplete || isComplete}
          onClick={() => void complete()}
        >
          Complete Migration
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
            {readiness.domains.map((d) => (
              <li key={d.domainId}>
                {d.applicable ? "✓ " : "– "}
                <strong>{d.label}</strong> — {d.plainLanguage}
              </li>
            ))}
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
        <div className="uc-migration-finance-summary" role="status">
          <h3>Progress</h3>
          <p>
            {STEP_LABELS[run.currentStep] || run.currentStep} ({run.status})
            {run.idempotentReplay ? " — safe replay" : ""}
          </p>
          {isComplete ? (
            <ul>
              <li>Learners: {String(run.summary.learners ?? "—")}</li>
              <li>Parents: {String(run.summary.parents ?? "—")}</li>
              <li>Classes: {String(run.summary.classrooms ?? "—")}</li>
              <li>Subjects: {String(run.summary.subjects ?? "—")}</li>
              {Array.isArray(run.summary.warnings)
                ? (run.summary.warnings as string[]).map((w) => <li key={w}>{w}</li>)
                : null}
            </ul>
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
