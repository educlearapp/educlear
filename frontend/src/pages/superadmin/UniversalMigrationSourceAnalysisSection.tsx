import { useCallback, useMemo, useState } from "react";
import {
  confirmSourceAnalysisField,
  operatorFieldStatusLabel,
  runUniversalMigrationSourceAnalysis,
  type DiscoveredSourceField,
  type MigrationSourceAnalysis,
} from "../../superAdmin/utils/universalMigrationSourceAnalysis";
import { useUniversalMigrationWorkflow } from "./UniversalMigrationWorkflowContext";

type Props = {
  onNotice?: (message: string) => void;
};

export default function UniversalMigrationSourceAnalysisSection({ onNotice }: Props) {
  const {
    selectedSessionSchoolId,
    targetSchools,
    uploadedFiles,
    previews,
    sourceSystem,
    dryRunStage,
    setSourceAnalysisId,
    setCompiledPlanId,
    setCompiledPlan,
  } = useUniversalMigrationWorkflow();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<MigrationSourceAnalysis | null>(null);

  const schoolName =
    targetSchools.find((s) => s.id === selectedSessionSchoolId)?.name ||
    dryRunStage?.targetSchoolName ||
    "";

  const boundSchoolId =
    String(dryRunStage?.targetSchoolId || selectedSessionSchoolId || "").trim();

  const runAnalysis = useCallback(async () => {
    if (!boundSchoolId) {
      setError("Select the Migration Target school before analysing files.");
      return;
    }
    if (previews.length === 0 && uploadedFiles.length === 0) {
      setError("Upload export files first, then run package analysis.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const previewById = new Map(previews.map((p) => [p.fileId, p]));
      const files = (previews.length > 0 ? previews : []).map((p) => {
        const upload = uploadedFiles.find((u) => u.id === p.fileId);
        return {
          fileId: p.fileId,
          filename: p.filename,
          path: p.path || upload?.path,
          category: p.category,
          columns: p.columns,
          sampleRows: p.sampleRows as Record<string, unknown>[],
          rowCount: p.rowCount,
        };
      });
      // If only uploads without previews yet, synthesise minimal file descriptors
      if (files.length === 0) {
        for (const u of uploadedFiles) {
          const p = previewById.get(u.id);
          files.push({
            fileId: u.id,
            filename: u.filename,
            path: u.path,
            category: u.category,
            columns: p?.columns || [],
            sampleRows: (p?.sampleRows as Record<string, unknown>[]) || [],
            rowCount: p?.rowCount || 0,
          });
        }
      }

      const result = await runUniversalMigrationSourceAnalysis({
        targetSchoolId: boundSchoolId,
        targetSchoolName: schoolName || undefined,
        stageId: dryRunStage?.stageId,
        systemIdHint: sourceSystem || undefined,
        priorAnalysisId: analysis?.analysisId,
        files,
      });
      setAnalysis(result);
      setSourceAnalysisId(result.analysisId);
      // Analysis changed — previous compiled plan is stale until recompile
      setCompiledPlanId(null);
      setCompiledPlan(null);
      onNotice?.(
        `Package analysed: ${result.summary.totalFields} fields · ${result.summary.autoMapped} mapped automatically · ${result.summary.confirmMapping} need confirmation. Next: compile the Migration Plan.`
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setBusy(false);
    }
  }, [
    boundSchoolId,
    schoolName,
    dryRunStage?.stageId,
    sourceSystem,
    previews,
    uploadedFiles,
    analysis?.analysisId,
    onNotice,
    setSourceAnalysisId,
    setCompiledPlanId,
    setCompiledPlan,
  ]);

  const confirmFields = useMemo(
    () =>
      (analysis?.discoveredFields || []).filter(
        (f) => f.status === "CONFIRM_MAPPING" || f.status === "SOURCE_ONLY_PRESERVED"
      ),
    [analysis]
  );

  const handleConfirm = useCallback(
    async (
      field: DiscoveredSourceField,
      action: "ACCEPT" | "CHOOSE" | "UNSUPPORTED",
      target?: string | null
    ) => {
      if (!analysis) return;
      setBusy(true);
      setError(null);
      try {
        const next = await confirmSourceAnalysisField({
          analysisId: analysis.analysisId,
          targetSchoolId: analysis.targetSchoolId,
          fieldKey: field.fieldKey,
          action,
          target,
        });
        setAnalysis(next);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Confirmation failed");
      } finally {
        setBusy(false);
      }
    },
    [analysis]
  );

  const summary = analysis?.summary;

  return (
    <div className="uc-migration-source-analysis">
      <p className="uc-migration-dry-run-hint">
        Upload the school&apos;s exports as they are. EduClear analyses the package, maps known
        fields, and asks only about uncertain items. No school data is written during analysis.
      </p>

      <div className="uc-migration-apply-stage-row">
        <button
          type="button"
          className="uc-migration-template-toolbar-btn"
          disabled={busy || !boundSchoolId}
          onClick={() => void runAnalysis()}
        >
          {busy ? "Analysing package…" : "Analyse migration package"}
        </button>
      </div>

      {error ? (
        <p className="uc-migration-upload-error" role="alert">
          {error}
        </p>
      ) : null}

      {summary && analysis ? (
        <section className="uc-migration-parent-review-summary" aria-label="Package analysis summary">
          <h3 className="uc-migration-validation-section-title">Migration package analysed</h3>
          <p className="uc-migration-dry-run-hint" role="status">
            Locked to <strong>{analysis.targetSchoolName || schoolName || "selected school"}</strong>
            {" · "}
            {analysis.detectedSourceSystemLabel}
          </p>
          <ul className="uc-migration-parent-review-summary-list">
            <li>
              {summary.fileCount} files · {summary.totalRows.toLocaleString()} rows ·{" "}
              {summary.totalFields} source fields
            </li>
            <li>
              {summary.estimatedLearners.toLocaleString()} learners detected ·{" "}
              {summary.estimatedParents.toLocaleString()} guardian records ·{" "}
              {summary.estimatedClassrooms.toLocaleString()} classrooms ·{" "}
              {summary.estimatedFamilyAccounts.toLocaleString()} family accounts
            </li>
            <li>
              <strong>{summary.autoMapped}</strong> fields mapped automatically ·{" "}
              <strong>{summary.confirmMapping}</strong> require confirmation ·{" "}
              <strong>{summary.unsupported + summary.sourceOnlyPreserved}</strong> unsupported /
              unidentified · {summary.relationshipCount} cross-file links suggested
            </li>
          </ul>
        </section>
      ) : null}

      {confirmFields.length > 0 ? (
        <div className="uc-migration-parent-review-queue">
          <h3 className="uc-migration-validation-section-title">Fields needing your attention</h3>
          {confirmFields.map((field) => (
            <article key={field.fieldKey} className="uc-migration-parent-review-card">
              <header className="uc-migration-parent-review-card-header">
                <h4>{field.sourceColumn}</h4>
                <span className="uc-migration-parent-review-badge">
                  {operatorFieldStatusLabel(field.status)}
                </span>
              </header>
              <p className="uc-migration-upload-empty">
                Source file: {field.filename}
                {field.sheetName ? ` · sheet ${field.sheetName}` : ""}
              </p>
              <p className="uc-migration-upload-empty">
                Suggested EduClear field:{" "}
                <strong>{field.suggestedTarget || "None yet"}</strong>
              </p>
              {field.sampleValues.length > 0 ? (
                <p className="uc-migration-upload-empty">
                  Samples: {field.sampleValues.slice(0, 3).join(" · ")}
                </p>
              ) : null}
              <p className="uc-migration-dry-run-hint">{field.reason}</p>
              <div className="uc-migration-parent-review-actions">
                {field.suggestedTarget ? (
                  <button
                    type="button"
                    className="uc-migration-template-toolbar-btn"
                    disabled={busy}
                    onClick={() => void handleConfirm(field, "ACCEPT")}
                  >
                    Accept suggestion
                  </button>
                ) : null}
                <button
                  type="button"
                  className="uc-migration-upload-clear"
                  disabled={busy}
                  onClick={() => void handleConfirm(field, "UNSUPPORTED")}
                >
                  Mark unsupported
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : analysis ? (
        <p className="uc-migration-parent-review-clean" role="status">
          No field confirmations pending ✓ — continue to Validation / Staging.
        </p>
      ) : null}

      {analysis && analysis.relationshipCandidates.length > 0 ? (
        <section className="uc-migration-parent-review-summary">
          <h3 className="uc-migration-validation-section-title">Related files</h3>
          <ul className="uc-migration-parent-review-summary-list">
            {analysis.relationshipCandidates.slice(0, 12).map((rel, idx) => {
              const left = analysis.files.find((f) => f.fileId === rel.leftFileId)?.filename;
              const right = analysis.files.find((f) => f.fileId === rel.rightFileId)?.filename;
              return (
                <li key={`${rel.leftFileId}-${rel.rightFileId}-${idx}`}>
                  {left} ↔ {right} via {rel.leftColumn} / {rel.rightColumn} (
                  {rel.keyKind.replace(/_/g, " ")})
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
