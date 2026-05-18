import { SCHOOL_PACKAGE_OPTIONS, SCHOOL_STATUS_OPTIONS } from "../types/schools";
import type { SchoolsPackageFilter, SchoolsStatusFilter } from "../hooks/useSchoolsManagement";

type Props = {
  search: string;
  statusFilter: SchoolsStatusFilter;
  packageFilter: SchoolsPackageFilter;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: SchoolsStatusFilter) => void;
  onPackageFilterChange: (value: SchoolsPackageFilter) => void;
  onAddSchool: () => void;
};

export default function SchoolsToolbar({
  search,
  statusFilter,
  packageFilter,
  onSearchChange,
  onStatusFilterChange,
  onPackageFilterChange,
  onAddSchool,
}: Props) {
  return (
    <div className="sa-schools-toolbar">
      <div className="sa-schools-toolbar-filters">
        <label className="sa-schools-field sa-schools-field--search">
          <span className="sa-schools-field-label">Search schools</span>
          <input
            type="search"
            className="sa-schools-input"
            placeholder="Search by school, owner, or email…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </label>

        <label className="sa-schools-field">
          <span className="sa-schools-field-label">Status</span>
          <select
            className="sa-schools-select"
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value as SchoolsStatusFilter)}
          >
            <option value="all">All statuses</option>
            {SCHOOL_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>

        <label className="sa-schools-field">
          <span className="sa-schools-field-label">Package</span>
          <select
            className="sa-schools-select"
            value={packageFilter}
            onChange={(e) => onPackageFilterChange(e.target.value as SchoolsPackageFilter)}
          >
            <option value="all">All packages</option>
            {SCHOOL_PACKAGE_OPTIONS.map((pkg) => (
              <option key={pkg} value={pkg}>
                {pkg}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button type="button" className="sa-schools-btn sa-schools-btn--gold" onClick={onAddSchool}>
        + Add School
      </button>
    </div>
  );
}
