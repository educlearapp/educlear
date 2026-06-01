import type { SchoolRecord } from "../types/schools";
import { formatSchoolDate, formatSchoolDateTime } from "../utils/formatSchoolDates";
import SchoolActionsMenu from "./SchoolActionsMenu";
import SchoolStatusBadge from "./SchoolStatusBadge";

const TABLE_COLUMNS = [
  "School Name",
  "Owner",
  "Email",
  "Package",
  "Status",
  "Learners",
  "Parents",
  "Registration Date",
  "Last Login",
  "Actions",
] as const;

type Props = {
  schools: SchoolRecord[];
  hasRegisteredSchools: boolean;
  loading?: boolean;
  onView: (school: SchoolRecord) => void;
  onActivate: (school: SchoolRecord) => void;
  onSuspend: (school: SchoolRecord) => void;
  onChangePackage: (school: SchoolRecord) => void;
  onResetPassword: (school: SchoolRecord) => void;
  onOpenDashboard?: (school: SchoolRecord) => void;
};

export default function SchoolsTable({
  schools,
  hasRegisteredSchools,
  loading = false,
  onView,
  onActivate,
  onSuspend,
  onChangePackage,
  onResetPassword,
  onOpenDashboard,
}: Props) {
  const colSpan = TABLE_COLUMNS.length;

  return (
    <div className="sa-schools-table-wrap">
      <div className="sa-schools-table-scroll">
        <table className="sa-schools-table">
          <thead>
            <tr>
              {TABLE_COLUMNS.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colSpan} className="sa-schools-table-empty">
                  <div className="sa-schools-empty-state">
                    <p className="sa-schools-empty-title">Loading schools…</p>
                  </div>
                </td>
              </tr>
            ) : !hasRegisteredSchools ? (
              <tr>
                <td colSpan={colSpan} className="sa-schools-table-empty">
                  <div className="sa-schools-empty-state">
                    <p className="sa-schools-empty-title">No schools registered yet.</p>
                    <p className="sa-schools-empty-text">
                      Schools will appear here once they register on the EduClear platform.
                    </p>
                  </div>
                </td>
              </tr>
            ) : schools.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="sa-schools-table-empty">
                  No schools match your filters.
                </td>
              </tr>
            ) : (
              schools.map((school) => (
                <tr key={school.id}>
                  <td className="sa-schools-cell sa-schools-cell--name">{school.schoolName}</td>
                  <td>{school.ownerName}</td>
                  <td className="sa-schools-cell sa-schools-cell--email">{school.email}</td>
                  <td>
                    <span className="sa-schools-package-pill">{school.package}</span>
                  </td>
                  <td>
                    <SchoolStatusBadge status={school.status} />
                  </td>
                  <td className="sa-schools-cell sa-schools-cell--numeric">{school.learnerCount}</td>
                  <td className="sa-schools-cell sa-schools-cell--numeric">{school.parentCount}</td>
                  <td>{formatSchoolDate(school.registeredAt)}</td>
                  <td>{formatSchoolDateTime(school.lastLoginAt)}</td>
                  <td className="sa-schools-cell sa-schools-cell--actions">
                    <SchoolActionsMenu
                      school={school}
                      onView={onView}
                      onActivate={onActivate}
                      onSuspend={onSuspend}
                      onChangePackage={onChangePackage}
                      onResetPassword={onResetPassword}
                      onOpenDashboard={onOpenDashboard}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
