import UniversalMigrationDryRunPanel from "./UniversalMigrationDryRunPanel";
import { useUniversalMigrationWorkflow } from "./UniversalMigrationWorkflowContext";

export default function UniversalMigrationStagingSection() {
  const {
    sourceSystem,
    setSourceSystem,
    registrySystems,
    registrySystemsLoading,
    registrySystemsError,
    cutoverDate,
    setCutoverDate,
    previews,
    uploadedFiles,
    effectiveMappings,
    validationSummary,
    validationIssues,
    busy,
    validateBusy,
  } = useUniversalMigrationWorkflow();

  if (!validationSummary) {
    return (
      <p className="uc-migration-dry-run-hint" role="note">
        Complete validation in section 4 with no blocking errors, then create a dry-run stage here.
        Full-file validation is required before staging.
      </p>
    );
  }

  return (
    <div className="uc-migration-staging-section uc-migration-center-staging-panel">
      <label className="uc-migration-staging-source-label">
        Source system (staging)
        <select
          className="uc-migration-staging-source-input"
          value={sourceSystem}
          onChange={(e) => setSourceSystem(e.target.value)}
          disabled={busy || validateBusy || registrySystemsLoading || Boolean(registrySystemsError)}
        >
          {registrySystemsLoading ? (
            <option value={sourceSystem}>Loading source systems…</option>
          ) : registrySystemsError ? (
            <option value={sourceSystem}>Could not load source systems</option>
          ) : (
            registrySystems.map((s) => (
              <option key={s.systemId} value={s.systemId}>
                {s.systemName}
              </option>
            ))
          )}
        </select>
      </label>
      {registrySystemsError ? (
        <p className="uc-migration-upload-error" role="alert">
          {registrySystemsError}
        </p>
      ) : null}
      <label className="uc-migration-staging-source-label">
        Migration cutover date
        <input
          type="date"
          className="uc-migration-staging-source-input"
          value={cutoverDate}
          onChange={(e) => setCutoverDate(e.target.value)}
          disabled={busy || validateBusy}
        />
      </label>
      <p className="uc-migration-dry-run-hint" role="note">
        Transactions before the cutover date are historical-only and will not affect active head count
        or new billing.
      </p>
      <UniversalMigrationDryRunPanel
        sourceSystem={sourceSystem}
        previews={previews}
        uploadedFiles={uploadedFiles}
        mappings={effectiveMappings}
        validationSummary={validationSummary}
        validationIssues={validationIssues}
        cutoverDate={cutoverDate.trim() || undefined}
      />
    </div>
  );
}
