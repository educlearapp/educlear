import type { FieldMappingRow } from "../../types/migration";

type Props = {
  rows: FieldMappingRow[];
  hasUploadedFiles: boolean;
};

export default function MigrationMappingTable({ rows, hasUploadedFiles }: Props) {
  const showEmpty = rows.length === 0;

  return (
    <section className="sa-migration-section">
      <h2 className="sa-migration-section-title">5. Mapping &amp; Validation</h2>
      <div className="sa-migration-table-wrap">
        <div className="sa-migration-table-scroll">
          <table className="sa-migration-table">
            <thead>
              <tr>
                <th>Source Field</th>
                <th>EduClear Field</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {showEmpty ? (
                <tr>
                  <td colSpan={4} className="sa-migration-table-empty">
                    {hasUploadedFiles
                      ? "No field mappings yet. Run validation to generate mappings."
                      : "Upload migration files to begin mapping and validation."}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.sourceField}</td>
                    <td>{row.eduClearField}</td>
                    <td>{row.status}</td>
                    <td>{row.notes}</td>
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
