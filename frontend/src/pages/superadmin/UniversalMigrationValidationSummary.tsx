import type { MigrationValidationSummary } from "../../superAdmin/utils/universalMigrationValidate";

type Props = {
  summary: MigrationValidationSummary;
};

function formatMode(mode?: MigrationValidationSummary["mode"]): string {
  if (mode === "full") return "Full-file";
  if (mode === "preview") return "Preview";
  return "—";
}

export default function UniversalMigrationValidationSummary({ summary }: Props) {
  const rowsChecked = summary.rowsChecked ?? 0;
  const issuesShown = summary.issuesShown ?? summary.totalIssues;

  return (
    <div className="uc-migration-validation-summary-wrap">
      <dl className="uc-migration-validation-meta">
        <div>
          <dt>Mode</dt>
          <dd>{formatMode(summary.mode)}</dd>
        </div>
        <div>
          <dt>Rows checked</dt>
          <dd>{rowsChecked.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Issues shown</dt>
          <dd>
            {issuesShown.toLocaleString()} of {summary.totalIssues.toLocaleString()}
          </dd>
        </div>
      </dl>
      {summary.issuesTruncated && summary.truncationMessage ? (
        <p className="uc-migration-validation-truncation" role="status">
          {summary.truncationMessage}
        </p>
      ) : null}
      <div className="uc-migration-validation-summary" role="group" aria-label="Validation summary">
        <article
          className={`uc-migration-validation-card uc-migration-validation-card--error${summary.errors > 0 ? " uc-migration-validation-card--active" : ""}`}
        >
          <p className="uc-migration-validation-card-label">Errors</p>
          <p className="uc-migration-validation-card-value">{summary.errors}</p>
        </article>
        <article
          className={`uc-migration-validation-card uc-migration-validation-card--warning${summary.warnings > 0 ? " uc-migration-validation-card--active" : ""}`}
        >
          <p className="uc-migration-validation-card-label">Warnings</p>
          <p className="uc-migration-validation-card-value">{summary.warnings}</p>
        </article>
        <article
          className={`uc-migration-validation-card uc-migration-validation-card--info${summary.info > 0 ? " uc-migration-validation-card--active" : ""}`}
        >
          <p className="uc-migration-validation-card-label">Info</p>
          <p className="uc-migration-validation-card-value">{summary.info}</p>
        </article>
        <article
          className={`uc-migration-validation-card uc-migration-validation-card--proceed${summary.canProceed ? " uc-migration-validation-card--ok" : " uc-migration-validation-card--blocked"}`}
        >
          <p className="uc-migration-validation-card-label">Can proceed</p>
          <p className="uc-migration-validation-card-value">{summary.canProceed ? "Yes" : "No"}</p>
        </article>
      </div>
    </div>
  );
}
