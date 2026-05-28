import type { MigrationValidationIssue } from "../../superAdmin/utils/universalMigrationValidate";

type Props = {
  issues: MigrationValidationIssue[];
};

function severityBadgeClass(severity: MigrationValidationIssue["severity"]): string {
  switch (severity) {
    case "error":
      return "uc-migration-validation-badge uc-migration-validation-badge--error";
    case "warning":
      return "uc-migration-validation-badge uc-migration-validation-badge--warning";
    default:
      return "uc-migration-validation-badge uc-migration-validation-badge--info";
  }
}

export default function UniversalMigrationValidationIssuesTable({ issues }: Props) {
  if (issues.length === 0) {
    return (
      <p className="uc-migration-validation-empty" role="status">
        No issues found in the preview sample.
      </p>
    );
  }

  return (
    <div className="uc-migration-validation-table-wrap">
      <table className="uc-migration-validation-table">
        <thead>
          <tr>
            <th scope="col">File</th>
            <th scope="col">Row</th>
            <th scope="col">Severity</th>
            <th scope="col">Field</th>
            <th scope="col">Message</th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue, idx) => (
            <tr key={`${issue.fileId}-${issue.rowNumber}-${issue.field}-${idx}`}>
              <td className="uc-migration-validation-col-file">{issue.filename}</td>
              <td>{issue.rowNumber > 0 ? issue.rowNumber : "—"}</td>
              <td>
                <span className={severityBadgeClass(issue.severity)}>{issue.severity}</span>
              </td>
              <td>{issue.field}</td>
              <td>{issue.message}</td>
              <td className="uc-migration-validation-col-value">
                {issue.value || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
