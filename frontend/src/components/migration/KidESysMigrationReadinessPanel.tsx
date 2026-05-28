import type {
  KidESysCrossValidationWarning,
  KidESysMigrationReadinessResult,
  KidESysReadinessCategory,
} from "../../superAdmin/utils/universalMigrationKidESysReadiness";
import "./KidESysMigrationReadinessPanel.css";

function formatCount(n: number): string {
  return n.toLocaleString("en-ZA");
}

function categoryIcon(cat: KidESysReadinessCategory): string {
  if (cat.status === "missing" && cat.required) return "✕";
  if (cat.status === "found") return "✓";
  return "○";
}

function badgeClass(cat: KidESysReadinessCategory): string {
  if (cat.statusBadge === "ready") return "uc-kideesys-readiness-badge--ready";
  if (cat.statusBadge === "missing") return "uc-kideesys-readiness-badge--missing";
  return "uc-kideesys-readiness-badge--optional";
}

type Props = {
  result: KidESysMigrationReadinessResult | null;
  busy?: boolean;
  error?: string | null;
  /** When true, show proceed banner above migration actions (staging). */
  showProceedBanner?: boolean;
};

export default function KidESysMigrationReadinessPanel({
  result,
  busy = false,
  error = null,
  showProceedBanner = false,
}: Props) {
  if (busy && !result) {
    return (
      <p className="uc-kideesys-readiness-status" role="status">
        Evaluating Kid-e-Sys readiness…
      </p>
    );
  }

  if (error) {
    return (
      <p className="uc-kideesys-readiness-error" role="alert">
        {error}
      </p>
    );
  }

  if (!result) {
    return (
      <p className="uc-kideesys-readiness-status" role="note">
        Upload Kid-e-Sys exports and complete previews to see readiness and validation.
      </p>
    );
  }

  const proceedReady = result.proceedStatus === "ready";

  return (
    <div className="uc-kideesys-readiness-panel" aria-label="Kid-e-Sys migration readiness">
      {showProceedBanner ? (
        <div
          className={`uc-kideesys-readiness-proceed${proceedReady ? " uc-kideesys-readiness-proceed--ready" : " uc-kideesys-readiness-proceed--blocked"}`}
          role="status"
        >
          <span className="uc-kideesys-readiness-proceed-label">{result.proceedMessage}</span>
          {!proceedReady ? (
            <span className="uc-kideesys-readiness-proceed-hint">
              Required: Learners and Parents. Billing, Transactions, and Staff are optional.
            </span>
          ) : null}
        </div>
      ) : null}

      <section className="uc-kideesys-readiness-card" aria-labelledby="uc-kideesys-readiness-card-title">
        <h4 id="uc-kideesys-readiness-card-title" className="uc-kideesys-readiness-card-title">
          Kid-e-Sys readiness
        </h4>
        <ul className="uc-kideesys-readiness-categories">
          {result.categories.map((cat) => (
            <li key={cat.key} className="uc-kideesys-readiness-category">
              <span className="uc-kideesys-readiness-category-label">
                {cat.label}
                <span className={`uc-kideesys-readiness-badge ${badgeClass(cat)}`}>
                  {cat.status === "found" ? "Found" : cat.required ? "Missing" : "Optional"}
                </span>
              </span>
              <span className="uc-kideesys-readiness-category-detail" title={cat.detailLine}>
                <span className="uc-kideesys-readiness-category-icon" aria-hidden="true">
                  {categoryIcon(cat)}
                </span>
                {cat.detailLine}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section
        className="uc-kideesys-readiness-summary-card"
        aria-labelledby="uc-kideesys-migration-summary-title"
      >
        <h4 id="uc-kideesys-migration-summary-title" className="uc-kideesys-readiness-card-title">
          Migration summary
        </h4>
        <dl className="uc-kideesys-readiness-totals">
          <div>
            <dt>Total learners</dt>
            <dd>{formatCount(result.totals.learners)}</dd>
          </div>
          <div>
            <dt>Total parents</dt>
            <dd>{formatCount(result.totals.parents)}</dd>
          </div>
          <div>
            <dt>Total staff</dt>
            <dd>{formatCount(result.totals.staff)}</dd>
          </div>
          <div>
            <dt>Total billing rows</dt>
            <dd>{formatCount(result.totals.billingRows)}</dd>
          </div>
          <div>
            <dt>Total transaction rows</dt>
            <dd>{formatCount(result.totals.transactionRows)}</dd>
          </div>
        </dl>
        <p className="uc-kideesys-readiness-scope-hint" role="note">
          Cross-validation scope:{" "}
          {result.crossValidationScope === "full_file" ? "full file" : "preview sample"} (advisory
          only).
        </p>
      </section>

      {result.crossValidationWarnings.length > 0 ? (
        <CrossValidationWarnings warnings={result.crossValidationWarnings} />
      ) : (
        <p className="uc-kideesys-readiness-status" role="note">
          No cross-validation warnings in the current scope.
        </p>
      )}
    </div>
  );
}

function CrossValidationWarnings({ warnings }: { warnings: KidESysCrossValidationWarning[] }) {
  return (
    <section
      className="uc-kideesys-readiness-warnings"
      aria-labelledby="uc-kideesys-cross-validation-title"
    >
      <h4 id="uc-kideesys-cross-validation-title" className="uc-kideesys-readiness-card-title">
        Cross-validation warnings
      </h4>
      <p className="uc-kideesys-readiness-warnings-hint">
        Advisory only — these do not block migration preview or staging.
      </p>
      <ul className="uc-kideesys-readiness-warnings-list">
        {warnings.map((w) => (
          <li key={`${w.checkId}-${w.category}`}>
            <span className="uc-kideesys-readiness-warning-message">{w.message}</span>
            {w.count > 0 ? (
              <span className="uc-kideesys-readiness-warning-count">
                {formatCount(w.count)} affected
              </span>
            ) : null}
            {w.samples && w.samples.length > 0 ? (
              <ul className="uc-kideesys-readiness-warning-samples">
                {w.samples.map((sample) => (
                  <li key={sample}>{sample}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
