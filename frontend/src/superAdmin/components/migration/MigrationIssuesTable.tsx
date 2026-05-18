import type { MigrationIssueRow } from "../../types/migration";

type Props = {
  issues: MigrationIssueRow[];
};

export default function MigrationIssuesTable({ issues }: Props) {
  const showEmpty = issues.length === 0;

  return (
    <section className="sa-migration-section">
      <h2 className="sa-migration-section-title">6. Review Issues</h2>
      <div className="sa-migration-table-wrap">
        <div className="sa-migration-table-scroll">
          <table className="sa-migration-table">
            <thead>
              <tr>
                <th>Issue</th>
                <th>Severity</th>
                <th>Record</th>
                <th>Suggested Fix</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {showEmpty ? (
                <tr>
                  <td colSpan={5} className="sa-migration-table-empty">
                    No validation issues yet. Validate files to review issues here.
                  </td>
                </tr>
              ) : (
                issues.map((issue) => (
                  <tr key={issue.id}>
                    <td>{issue.issue}</td>
                    <td>{issue.severity}</td>
                    <td>{issue.record}</td>
                    <td>{issue.suggestedFix}</td>
                    <td>{issue.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
