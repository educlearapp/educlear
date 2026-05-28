import { useCallback, useMemo, useRef, useState } from "react";
import type {
  KideesysMigrationStep,
  KideesysValidationResult,
} from "../../types/kideesysMigrationPortal";
import {
  applyKideesysImport,
  approveKideesysImport,
  createKideesysProject,
  fetchKideesysPostImportReport,
  formatKideesysSummary,
  purgeSchoolForReimport,
  rollbackKideesysImport,
  validateKideesysUpload,
} from "../../utils/kideesysMigrationPortal";
import MigrationDryRunReview from "./MigrationDryRunReview";

const KIDEESYS_ACCEPT = ".xls,.xlsx,.csv";

function kideesysFileKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function mergeKideesysFiles(prev: File[], incoming: FileList | File[]): File[] {
  const byKey = new Map<string, File>();
  for (const file of prev) byKey.set(kideesysFileKey(file), file);
  for (const file of Array.from(incoming)) byKey.set(kideesysFileKey(file), file);
  return Array.from(byKey.values());
}

function formatKideesysFileBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STEPS: { id: KideesysMigrationStep; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "mapping", label: "Map columns" },
  { id: "counts", label: "Preview counts" },
  { id: "classify", label: "Active vs historical" },
  { id: "duplicates", label: "Duplicates" },
  { id: "balances", label: "Balances" },
  { id: "errors", label: "Errors" },
  { id: "review", label: "Dry run review" },
  { id: "apply", label: "Apply" },
  { id: "report", label: "Report" },
];

type Props = {
  schoolId: string;
  schoolName?: string;
  disabled?: boolean;
  onNotice: (payload: { title: string; message: string; details?: string }) => void;
};

export default function KideesysMigrationPortal({ schoolId, schoolName, disabled, onNotice }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<KideesysMigrationStep>("upload");
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [validation, setValidation] = useState<KideesysValidationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [approved, setApproved] = useState(false);
  const [postReport, setPostReport] = useState<Awaited<ReturnType<typeof fetchKideesysPostImportReport>>>(null);

  const blockingIssues = useMemo(
    () => (validation?.issues || []).filter((i) => i.severity === "error"),
    [validation]
  );

  const reviewWarnings = useMemo(() => {
    if (!validation) return [];
    const fromIssues = validation.issues
      .filter((i) => i.severity === "warning")
      .map((i) => i.issue);
    const fromCounts = validation.countValidation.errors || [];
    return [...fromIssues, ...fromCounts];
  }, [validation]);

  const reviewCounts = useMemo(() => {
    if (!validation) return [];
    return [
      { label: "Active (class lists)", value: validation.activeLearnerCount },
      { label: "Historical", value: validation.historicalLearnerCount },
      { label: "Contact list", value: validation.countValidation.learnersFromContactList },
      { label: "Billing plan", value: validation.countValidation.learnersFromBillingPlan },
      {
        label: "Age analysis accounts",
        value: validation.countValidation.billingAccountsFromAgeAnalysis,
      },
      {
        label: "Counts match",
        value: validation.countValidation.countsMatch ? "Yes" : "No",
      },
      { label: "Balance variances", value: validation.balanceValidation.varianceCount },
    ];
  }, [validation]);

  const runValidate = useCallback(async () => {
    if (!schoolId || !files.length) return;
    setBusy(true);
    setUploadProgress(0);
    try {
      const pid = projectId || (await createKideesysProject(schoolId));
      setProjectId(pid);
      const result = await validateKideesysUpload({
        schoolId,
        projectId: pid,
        files,
        onProgress: (p) => setUploadProgress(p),
      });
      setValidation(result);
      setApproved(false);
      setStep("mapping");
      onNotice({
        title: result.canApply ? "Validation passed" : "Validation needs review",
        message: `Staged import for ${schoolName || "school"}.`,
        details: formatKideesysSummary(result),
      });
    } catch (e: unknown) {
      onNotice({
        title: "Validation failed",
        message: e instanceof Error ? e.message : "Upload or validation failed",
      });
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  }, [schoolId, schoolName, files, projectId, onNotice]);

  const runApprove = useCallback(async () => {
    if (!validation || !schoolId) return;
    setBusy(true);
    try {
      await approveKideesysImport({
        schoolId,
        projectId: validation.projectId,
        confirmToken: validation.confirmToken,
      });
      setApproved(true);
      setStep("apply");
      onNotice({
        title: "Import approved",
        message: "Dry run approved. Type the school name on the Apply step to write to the live school.",
      });
    } catch (e: unknown) {
      onNotice({
        title: "Approval blocked",
        message: e instanceof Error ? e.message : "Approval failed",
      });
    } finally {
      setBusy(false);
    }
  }, [validation, schoolId, onNotice]);

  const runApply = useCallback(async () => {
    if (!validation || !schoolId || !approved) return;
    setBusy(true);
    try {
      const result = await applyKideesysImport({
        schoolId,
        projectId: validation.projectId,
        confirmToken: validation.confirmToken,
      });
      setPostReport(result.report);
      setStep("report");
      onNotice({
        title: "Import complete",
        message: `Active: ${result.report.activeLearnersInDb}, historical: ${result.report.historicalLearnersInDb}`,
        details: JSON.stringify(result.imported, null, 2),
      });
    } catch (e: unknown) {
      onNotice({
        title: "Apply failed",
        message: e instanceof Error ? e.message : "Apply failed",
      });
    } finally {
      setBusy(false);
    }
  }, [validation, schoolId, approved, onNotice]);

  const runPurge = useCallback(async () => {
    if (!schoolId || !window.confirm("Purge ALL imported data for this school? School record and owner login are kept.")) {
      return;
    }
    setBusy(true);
    try {
      await purgeSchoolForReimport(schoolId);
      setValidation(null);
      setApproved(false);
      setPostReport(null);
      setProjectId("");
      setFiles([]);
      setStep("upload");
      onNotice({
        title: "School data purged",
        message: "Ready for a clean Kid-e-Sys re-import.",
      });
    } catch (e: unknown) {
      onNotice({
        title: "Purge failed",
        message: e instanceof Error ? e.message : "Purge failed",
      });
    } finally {
      setBusy(false);
    }
  }, [schoolId, onNotice]);

  const runRollback = useCallback(async () => {
    if (!validation || !schoolId) return;
    setBusy(true);
    try {
      await rollbackKideesysImport(schoolId, validation.projectId);
      onNotice({ title: "Rollback complete", message: "Last import batch removed." });
    } catch (e: unknown) {
      onNotice({
        title: "Rollback failed",
        message: e instanceof Error ? e.message : "Rollback failed",
      });
    } finally {
      setBusy(false);
    }
  }, [validation, schoolId, onNotice]);

  const loadReport = useCallback(async () => {
    if (!validation || !schoolId) return;
    const report = await fetchKideesysPostImportReport(schoolId, validation.projectId);
    setPostReport(report);
    setStep("report");
  }, [validation, schoolId]);

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const next = Array.from(incoming);
    if (!next.length) return;
    setFiles((prev) => mergeKideesysFiles(prev, next));
  }, []);

  const removeFile = useCallback((key: string) => {
    setFiles((prev) => prev.filter((f) => kideesysFileKey(f) !== key));
  }, []);

  const clearFiles = useCallback(() => {
    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  return (
    <section className="sa-kideesys-portal">
      <h2 className="sa-migration-section-title">Kid-e-Sys Migration Portal</h2>
      <p className="sa-migration-subtitle">
        Weekend-safe import: class lists define active learners; billing and transactions bring in
        historical accounts. Stage → validate → approve → apply. Balances come from transaction
        history and age analysis — not guessed.
      </p>

      <nav className="sa-kideesys-steps" aria-label="Migration steps">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`sa-kideesys-step${s.id === step ? " sa-kideesys-step--active" : ""}${i < stepIndex ? " sa-kideesys-step--done" : ""}`}
            disabled={disabled || busy || (!validation && s.id !== "upload")}
            onClick={() => setStep(s.id)}
          >
            {i + 1}. {s.label}
          </button>
        ))}
      </nav>

      {step === "upload" ? (
        <div className="sa-kideesys-panel">
          <p className="sa-migration-subtitle sa-kideesys-upload-hint">
            Select every Kid-e-Sys export in one go (or add more in another browse): Grade_*.xls class
            lists, contact_list.xls, transaction_list.xls, account_list_(age_analysis).xls,
            billing_plan.xls, employee_contact_list.xls.
          </p>
          <div
            className={`sa-kideesys-dropzone${dragOver ? " sa-kideesys-dropzone--active" : ""}`}
            onClick={() => !disabled && !busy && fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (!disabled && !busy) fileInputRef.current?.click();
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (!disabled && !busy && e.dataTransfer.files.length > 0) {
                addFiles(e.dataTransfer.files);
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!disabled && !busy) setDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragOver(false);
            }}
            role="button"
            tabIndex={0}
            aria-label="Upload all Kid-e-Sys export files"
          >
            <input
              ref={fileInputRef}
              type="file"
              className="sa-kideesys-file-input"
              accept={KIDEESYS_ACCEPT}
              multiple
              disabled={disabled || busy}
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <span className="sa-kideesys-dropzone-icon" aria-hidden="true">
              ⬆
            </span>
            <p className="sa-kideesys-dropzone-title">All Kid-e-Sys exports (.xls, .xlsx, .csv)</p>
            <p className="sa-kideesys-dropzone-text">
              Drag and drop every export here, or click to browse — multi-select enabled
            </p>
          </div>
          <div className="sa-kideesys-file-list-wrap">
            <div className="sa-kideesys-file-list-header">
              <h3 className="sa-kideesys-file-list-title">
                Selected files ({files.length})
              </h3>
              {files.length > 0 ? (
                <button
                  type="button"
                  className="sa-kideesys-link-btn"
                  disabled={disabled || busy}
                  onClick={clearFiles}
                >
                  Clear all
                </button>
              ) : null}
            </div>
            {files.length === 0 ? (
              <p className="sa-kideesys-file-list-empty">No files selected yet.</p>
            ) : (
              <ul className="sa-kideesys-file-list">
                {files.map((file) => {
                  const key = kideesysFileKey(file);
                  return (
                    <li key={key} className="sa-kideesys-file-item">
                      <span className="sa-kideesys-file-name">{file.name}</span>
                      <span className="sa-kideesys-file-meta">{formatKideesysFileBytes(file.size)}</span>
                      <button
                        type="button"
                        className="sa-kideesys-file-remove"
                        disabled={disabled || busy}
                        onClick={() => removeFile(key)}
                        aria-label={`Remove ${file.name}`}
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {uploadProgress != null ? (
            <p className="sa-migration-upload-progress">Uploading… {uploadProgress}%</p>
          ) : null}
          <div className="sa-migration-dasilva-actions">
            <button
              type="button"
              className="sa-migration-btn sa-migration-btn--gold"
              disabled={!schoolId || !files.length || disabled || busy}
              onClick={() => void runValidate()}
            >
              {busy ? "Validating…" : "Upload & validate"}
            </button>
            <button
              type="button"
              className="sa-migration-btn"
              disabled={!schoolId || disabled || busy}
              onClick={() => void runPurge()}
            >
              Purge school data (re-import)
            </button>
          </div>
        </div>
      ) : null}

      {step === "mapping" && validation ? (
        <div className="sa-kideesys-panel">
          <table className="sa-kideesys-table">
            <thead>
              <tr>
                <th>Export slot</th>
                <th>Source file</th>
                <th>EduClear target</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {validation.columnMappings.map((m) => (
                <tr key={m.slot}>
                  <td>{m.slot}</td>
                  <td>{m.sourceFile}</td>
                  <td>{m.eduClearTarget}</td>
                  <td>{m.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="sa-migration-btn" onClick={() => setStep("counts")}>
            Next: preview counts
          </button>
        </div>
      ) : null}

      {step === "counts" && validation ? (
        <div className="sa-kideesys-panel">
          <ul className="sa-kideesys-stats">
            <li>
              <strong>Active (class lists)</strong>: {validation.activeLearnerCount}
            </li>
            <li>
              <strong>Contact list</strong>: {validation.countValidation.learnersFromContactList}
            </li>
            <li>
              <strong>Billing plan</strong>: {validation.countValidation.learnersFromBillingPlan}
            </li>
            <li>
              <strong>Age analysis accounts</strong>:{" "}
              {validation.countValidation.billingAccountsFromAgeAnalysis}
            </li>
            <li>
              <strong>Counts match</strong>: {validation.countValidation.countsMatch ? "Yes" : "No"}
            </li>
          </ul>
          <button type="button" className="sa-migration-btn" onClick={() => setStep("classify")}>
            Next: classification
          </button>
        </div>
      ) : null}

      {step === "classify" && validation ? (
        <div className="sa-kideesys-panel">
          <p>
            Active: {validation.activeLearnerCount} · Historical: {validation.historicalLearnerCount}
            (excluded from dashboard and class counts; billing history retained)
          </p>
          <div className="sa-kideesys-classify-lists">
            <div>
              <h4>Active sample</h4>
              <pre>
                {validation.classifications
                  .filter((c) => c.tier === "ACTIVE")
                  .slice(0, 15)
                  .map((c) => `${c.fullName} · ${c.className} · ${c.accountNo}`)
                  .join("\n")}
              </pre>
            </div>
            <div>
              <h4>Historical sample</h4>
              <pre>
                {validation.classifications
                  .filter((c) => c.tier === "HISTORICAL")
                  .slice(0, 15)
                  .map((c) => `${c.fullName} · ${c.accountNo} · bal R${c.ageAnalysisBalance.toFixed(2)}`)
                  .join("\n") || "(none)"}
              </pre>
            </div>
          </div>
          <button type="button" className="sa-migration-btn" onClick={() => setStep("duplicates")}>
            Next: duplicates
          </button>
        </div>
      ) : null}

      {step === "duplicates" && validation ? (
        <div className="sa-kideesys-panel">
          <p>Duplicate active learners: {validation.duplicateLearners.length}</p>
          <p>Duplicate account names: {validation.duplicateAccounts.length}</p>
          <pre className="sa-migration-dasilva-report">
            {[
              ...validation.duplicateLearners.map((d) => `Learner: ${d.label}`),
              ...validation.duplicateAccounts.map(
                (d) => `Account ${d.accountNo}: ${d.names.join(" / ")}`
              ),
            ].join("\n") || "No duplicates detected"}
          </pre>
          <button type="button" className="sa-migration-btn" onClick={() => setStep("balances")}>
            Next: balances
          </button>
        </div>
      ) : null}

      {step === "balances" && validation ? (
        <div className="sa-kideesys-panel">
          <ul className="sa-kideesys-stats">
            <li>Accounts checked: {validation.balanceValidation.accountsChecked}</li>
            <li>Variances: {validation.balanceValidation.varianceCount}</li>
            <li>Max variance: R{validation.balanceValidation.maxVariance.toFixed(2)}</li>
          </ul>
          <p className="sa-migration-subtitle">
            Ledger balances are built from the full transaction export (all years). Age analysis is
            the reconciliation target for opening balances.
          </p>
          <button type="button" className="sa-migration-btn" onClick={() => setStep("errors")}>
            Next: errors
          </button>
        </div>
      ) : null}

      {step === "errors" && validation ? (
        <div className="sa-kideesys-panel">
          <p>
            {blockingIssues.length} blocking ·{" "}
            {(validation.issues || []).filter((i) => i.severity === "warning").length} warnings
          </p>
          <ul className="sa-kideesys-issue-list">
            {validation.issues.map((issue) => (
              <li
                key={issue.id}
                className={`sa-kideesys-issue sa-kideesys-issue--${issue.severity}`}
              >
                <strong>[{issue.severity}]</strong> {issue.issue}
                <br />
                <small>{issue.suggestedFix}</small>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="sa-migration-btn sa-migration-btn--gold"
            disabled={!validation.canApply}
            onClick={() => setStep("review")}
          >
            Continue to dry run review
          </button>
        </div>
      ) : null}

      {step === "review" && validation ? (
        <div className="sa-kideesys-panel">
          <MigrationDryRunReview
            schoolId={schoolId}
            schoolName={schoolName || "Selected school"}
            canApply={validation.canApply}
            counts={reviewCounts}
            warnings={reviewWarnings}
            validation={{
              canApply: validation.canApply,
              errors: blockingIssues.length,
              warnings: reviewWarnings.length,
            }}
            applyLabel="Approve import"
            applyBlockedReason={
              validation.canApply ? null : "Resolve blocking errors before approval."
            }
            onApply={() => void runApprove()}
            busy={busy}
            requireTypedConfirmation={false}
          />
          {approved ? (
            <p className="sa-migration-subtitle" role="status">
              Approved — continue on the Apply step to write to the database.
            </p>
          ) : null}
        </div>
      ) : null}

      {step === "apply" && validation ? (
        <div className="sa-kideesys-panel">
          <MigrationDryRunReview
            schoolId={schoolId}
            schoolName={schoolName || "Selected school"}
            canApply={validation.canApply}
            counts={reviewCounts}
            warnings={reviewWarnings}
            validation={{
              canApply: validation.canApply,
              errors: blockingIssues.length,
              warnings: reviewWarnings.length,
            }}
            applyLabel="Apply import"
            applyBlockedReason={
              !approved ? "Approve the import on the dry run review step first." : null
            }
            onApply={() => void runApply()}
            busy={busy}
          />
          <div className="sa-migration-dasilva-actions">
            <button
              type="button"
              className="sa-migration-btn"
              disabled={disabled || busy}
              onClick={() => void runRollback()}
            >
              Rollback last batch
            </button>
          </div>
        </div>
      ) : null}

      {step === "report" ? (
        <div className="sa-kideesys-panel">
          {postReport ? (
            <pre className="sa-migration-dasilva-report">{JSON.stringify(postReport, null, 2)}</pre>
          ) : (
            <p>No post-import report yet.</p>
          )}
          <button
            type="button"
            className="sa-migration-btn"
            disabled={!validation}
            onClick={() => void loadReport()}
          >
            Refresh report
          </button>
        </div>
      ) : null}

      {projectId ? (
        <p className="sa-migration-subtitle sa-migration-project-id">
          Project: <strong>{projectId}</strong>
        </p>
      ) : null}
    </section>
  );
}
