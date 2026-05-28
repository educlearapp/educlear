import type {
  MigrationAdapterTestResult,
  MigrationAdapterTestStatus,
} from "../../superAdmin/utils/universalMigrationAdapterTest";
import {
  adapterTestRecommendationLabel,
  adapterTestStatusLabel,
} from "../../superAdmin/utils/universalMigrationAdapterTest";
import "./UniversalMigrationAdapterTestPanel.css";

type Props = {
  result: MigrationAdapterTestResult | null;
  busy?: boolean;
};

function overallClass(status: MigrationAdapterTestStatus): string {
  return `uc-migration-adapter-test-overall uc-migration-adapter-test-overall--${status}`;
}

export default function UniversalMigrationAdapterTestPanel({ result, busy }: Props) {
  if (busy) {
    return (
      <p className="uc-migration-adapter-test-status" role="status">
        Running adapter readiness test…
      </p>
    );
  }

  if (!result) return null;

  return (
    <div className="uc-migration-adapter-test" role="region" aria-label="Adapter test results">
      <div className="uc-migration-adapter-test-header">
        <h4 className="uc-migration-validation-section-title">Adapter test results</h4>
        <span className={overallClass(result.overallStatus)}>
          Overall: {adapterTestStatusLabel(result.overallStatus)}
        </span>
        <span
          className={`uc-migration-adapter-test-recommendation uc-migration-adapter-test-recommendation--${result.recommendation}`}
        >
          Recommendation: {adapterTestRecommendationLabel(result.recommendation)}
        </span>
      </div>

      <p className="uc-migration-adapter-test-meta" role="note">
        Tested {new Date(result.testedAt).toLocaleString()} · read-only harness (no staging or live
        writes)
      </p>

      <div className="uc-migration-adapter-test-summary">
        <span className="uc-migration-adapter-test-pill uc-migration-adapter-test-pill--pass">
          Passed: {result.passed.length}
        </span>
        <span className="uc-migration-adapter-test-pill uc-migration-adapter-test-pill--warning">
          Warnings: {result.warnings.length}
        </span>
        <span className="uc-migration-adapter-test-pill uc-migration-adapter-test-pill--fail">
          Failed: {result.failed.length}
        </span>
        <span className="uc-migration-adapter-test-pill uc-migration-adapter-test-pill--muted">
          Not supported: {result.notSupported.length}
        </span>
      </div>

      <div className="uc-migration-adapter-test-table-wrap">
        <table className="uc-migration-adapter-test-table">
          <thead>
            <tr>
              <th>Check</th>
              <th>Status</th>
              <th>Message</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {result.checks.map((check) => (
              <tr key={check.id} className={`uc-migration-adapter-test-row--${check.status}`}>
                <td>{check.label}</td>
                <td>
                  <span
                    className={`uc-migration-adapter-test-badge uc-migration-adapter-test-badge--${check.status}`}
                  >
                    {adapterTestStatusLabel(check.status)}
                  </span>
                </td>
                <td>{check.message}</td>
                <td className="uc-migration-adapter-test-details">{check.details || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
