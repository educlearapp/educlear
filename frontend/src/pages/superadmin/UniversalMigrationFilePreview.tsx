import type { MigrationFilePreview } from "../../superAdmin/utils/universalMigrationPreview";
import type { FileMappingSuggestion } from "../../superAdmin/utils/universalMigrationMappings";
import {
  isKidESysClassListPreview,
  migrationPreviewColumnLabel,
} from "../../superAdmin/utils/kideesysLearnerClassListPreview";
import UniversalMigrationMappingSuggestions from "./UniversalMigrationMappingSuggestions";

const CATEGORY_LABELS: Record<string, string> = {
  learners: "Learners",
  parents: "Parents",
  billing: "Billing",
  transactions: "Transactions",
  "payment-receive-list": "Payment Receive List",
  staff: "Staff",
  historical: "Historical",
  unknown: "Unknown",
};

function formatCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

type MappingOverrides = Record<string, string>;

type Props = {
  preview: MigrationFilePreview;
  mappingSuggestion?: FileMappingSuggestion;
  mappingOverrides?: MappingOverrides;
  onMappingOverrideChange?: (sourceColumn: string, target: string) => void;
};

export default function UniversalMigrationFilePreview({
  preview,
  mappingSuggestion,
  mappingOverrides = {},
  onMappingOverrideChange,
}: Props) {
  const columns =
    preview.columns.length > 0
      ? preview.columns
      : preview.sampleRows.length > 0
        ? Object.keys(preview.sampleRows[0])
        : [];

  const categoryLabel =
    CATEGORY_LABELS[preview.category] ?? preview.category.replace(/_/g, " ");
  const kidESysClassList = isKidESysClassListPreview(preview);
  const paymentReceiveList = preview.category === "payment-receive-list";

  return (
    <article className="uc-migration-preview-card" aria-labelledby={`uc-preview-${preview.fileId}`}>
      <header className="uc-migration-preview-card-header">
        <h4 id={`uc-preview-${preview.fileId}`} className="uc-migration-preview-card-title">
          {preview.filename}
        </h4>
        <div className="uc-migration-preview-card-badges">
          <span
            className={`uc-migration-upload-badge uc-migration-upload-badge--category uc-migration-upload-badge--${preview.category}`}
          >
            {categoryLabel}
          </span>
          <span className="uc-migration-preview-row-count">{preview.rowCount.toLocaleString()} rows</span>
        </div>
      </header>

      {preview.warnings.length > 0 ? (
        <ul className="uc-migration-preview-warnings" role="status">
          {preview.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      {kidESysClassList ? (
        <p className="uc-migration-preview-kideesys-note" role="note">
          Kid-e-Sys class register — title row treated as class name; learner names mapped to{" "}
          <strong>fullName</strong>.
        </p>
      ) : null}

      {paymentReceiveList ? (
        <p className="uc-migration-preview-kideesys-note" role="note">
          Kid-e-Sys Payment Receive List PDF — optional reconciliation only. It does not affect
          balances and will not create payments, ledger rows, invoices, or statement changes.
        </p>
      ) : null}

      {columns.length > 0 ? (
        <div className="uc-migration-preview-columns">
          <span className="uc-migration-preview-label">Columns</span>
          <p className="uc-migration-preview-column-list">
            {columns.map((col) => migrationPreviewColumnLabel(col, preview)).join(" · ")}
          </p>
        </div>
      ) : null}

      {columns.length > 0 && preview.sampleRows.length > 0 ? (
        <div className="uc-migration-preview-table-wrap">
          <span className="uc-migration-preview-label">Sample rows (first {preview.sampleRows.length})</span>
          <table className="uc-migration-preview-table">
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col} scope="col">
                    {migrationPreviewColumnLabel(col, preview)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.sampleRows.map((row, rowIdx) => (
                <tr key={rowIdx}>
                  {columns.map((col) => (
                    <td key={col}>{formatCell(row[col])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : columns.length > 0 && preview.rowCount === 0 ? (
        <p className="uc-migration-preview-empty-rows">No sample rows to display.</p>
      ) : null}

      {mappingSuggestion && onMappingOverrideChange && !paymentReceiveList ? (
        <UniversalMigrationMappingSuggestions
          suggestion={mappingSuggestion}
          overrides={mappingOverrides}
          onOverrideChange={onMappingOverrideChange}
        />
      ) : null}
    </article>
  );
}
