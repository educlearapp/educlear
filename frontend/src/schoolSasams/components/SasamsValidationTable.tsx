import type { SasamsValidationRow } from "../types/sasamsReport";

type Props = {
  rows: SasamsValidationRow[];
  hasUploadedFiles: boolean;
};

export default function SasamsValidationTable({ rows, hasUploadedFiles }: Props) {
  const showEmpty = rows.length === 0;

  return (
    <section className="sasams-report-section">
      <h2 className="sasams-report-section-title">3. Validation Preview</h2>
      <div className="sasams-report-table-wrap">
        <div className="sasams-report-table-scroll">
          <table className="sasams-report-table">
            <thead>
              <tr>
                <th>Learner</th>
                <th>Grade/Class</th>
                <th>Subjects Found</th>
                <th>Parent Email</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {showEmpty ? (
                <tr>
                  <td colSpan={6} className="sasams-report-table-empty">
                    {hasUploadedFiles
                      ? "No validation results yet. Run Validate File to preview learner matches."
                      : "Upload a SASAMS file to start validation."}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.learner}</td>
                    <td>{row.gradeClass}</td>
                    <td>{row.subjectsFound}</td>
                    <td>{row.parentEmail}</td>
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
