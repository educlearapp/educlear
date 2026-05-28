import "../../components/migration/KidESysMigrationReadinessPanel.css";
import UniversalMigrationValidationIssuesTable from "./UniversalMigrationValidationIssuesTable";
import UniversalMigrationValidationSummary from "./UniversalMigrationValidationSummary";
import { useUniversalMigrationWorkflow } from "./UniversalMigrationWorkflowContext";

export default function UniversalMigrationValidationSection() {
  const {
    previews,
    mappingSuggestions,
    busy,
    previewBusy,
    mappingBusy,
    validateBusy,
    validationMode,
    setValidationMode,
    resetValidationResults,
    validationSummary,
    validationIssues,
    validationNotice,
    exportBusy,
    handleValidate,
    handleExportValidation,
    sourceSystem,
    kidESysReadiness,
  } = useUniversalMigrationWorkflow();

  const isKidESys = sourceSystem.trim() === "kideesys";

  if (previews.length === 0) {
    return (
      <p className="uc-migration-dry-run-hint" role="note">
        Upload files and complete column mapping in the Upload Area (section 2) before running
        validation.
      </p>
    );
  }

  return (
    <div className="uc-migration-validation-section uc-migration-center-validation-panel">
      {isKidESys && kidESysReadiness ? (
        <div
          className={`uc-kideesys-readiness-proceed uc-kideesys-readiness-proceed--inline${kidESysReadiness.proceedStatus === "ready" ? " uc-kideesys-readiness-proceed--ready" : " uc-kideesys-readiness-proceed--blocked"}`}
          role="status"
        >
          <span className="uc-kideesys-readiness-proceed-label">{kidESysReadiness.proceedMessage}</span>
        </div>
      ) : null}

      <div className="uc-migration-preview-section-actions">
        <fieldset className="uc-migration-validation-mode">
          <legend className="uc-migration-validation-mode-legend">Validation mode</legend>
          <label className="uc-migration-validation-mode-option">
            <input
              type="radio"
              name="migrationCenterValidationMode"
              value="preview"
              checked={validationMode === "preview"}
              onChange={() => {
                setValidationMode("preview");
                resetValidationResults();
              }}
              disabled={busy || validateBusy}
            />
            Preview validation
          </label>
          <label className="uc-migration-validation-mode-option">
            <input
              type="radio"
              name="migrationCenterValidationMode"
              value="full"
              checked={validationMode === "full"}
              onChange={() => {
                setValidationMode("full");
                resetValidationResults();
              }}
              disabled={busy || validateBusy}
            />
            Full-file validation
          </label>
        </fieldset>
        <button
          type="button"
          className="uc-migration-template-toolbar-btn uc-migration-template-toolbar-btn--validate"
          onClick={() => void handleValidate()}
          disabled={
            busy ||
            previewBusy ||
            mappingBusy ||
            validateBusy ||
            mappingSuggestions.length === 0
          }
        >
          {validateBusy
            ? validationMode === "full"
              ? "Validating full file…"
              : "Validating…"
            : validationMode === "full"
              ? "Validate full file"
              : "Validate preview"}
        </button>
        {previewBusy || mappingBusy ? (
          <span className="uc-migration-preview-loading" aria-live="polite">
            {previewBusy ? "Loading preview…" : "Suggesting mappings…"}
          </span>
        ) : null}
      </div>

      {validationNotice ? (
        <p className="uc-migration-validation-notice" role="alert">
          {validationNotice}
        </p>
      ) : null}

      {validationSummary ? (
        <>
          <div className="uc-migration-validation-export-row">
            <h4 className="uc-migration-validation-section-title">Validation results</h4>
            <button
              type="button"
              className="uc-migration-export-btn"
              disabled={exportBusy || validateBusy}
              onClick={() => void handleExportValidation()}
            >
              {exportBusy ? "Exporting…" : "Export Validation Report"}
            </button>
          </div>
          <UniversalMigrationValidationSummary summary={validationSummary} />
          <UniversalMigrationValidationIssuesTable issues={validationIssues} />
        </>
      ) : (
        <p className="uc-migration-dry-run-hint" role="note">
          Run validation after mappings are in place. Results appear here before dry-run staging.
        </p>
      )}
    </div>
  );
}
