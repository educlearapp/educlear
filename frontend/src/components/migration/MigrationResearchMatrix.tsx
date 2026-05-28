import { MIGRATION_RESEARCH_ROWS } from "./migrationResearchData";
import "./MigrationResearchMatrix.css";

export default function MigrationResearchMatrix() {
  return (
    <div className="uc-migration-research-table-wrap">
      <div className="uc-migration-research-table-scroll">
        <table className="uc-migration-research-table">
          <thead>
            <tr>
              <th>System</th>
              <th>Learners</th>
              <th>Parents</th>
              <th>Billing</th>
              <th>Transactions</th>
              <th>Export Type</th>
              <th>Difficulty</th>
              <th>Adapter Status</th>
            </tr>
          </thead>
          <tbody>
            {MIGRATION_RESEARCH_ROWS.map((row) => (
              <tr key={row.system}>
                <td className="uc-migration-research-system">{row.system}</td>
                <td>{row.learners}</td>
                <td>{row.parents}</td>
                <td>{row.billing}</td>
                <td>{row.transactions}</td>
                <td>{row.exportType}</td>
                <td>
                  <span
                    className={`uc-migration-research-pill uc-migration-research-pill--difficulty-${row.difficulty.toLowerCase().replace(/[^a-z]+/g, "-")}`}
                  >
                    {row.difficulty}
                  </span>
                </td>
                <td>
                  <span className="uc-migration-research-pill uc-migration-research-pill--status">
                    {row.adapterStatus}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
