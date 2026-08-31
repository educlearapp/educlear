import { SCHOOL_PACKAGE_OPTIONS } from "../types/schools";
import type { SchoolsPackageFilter, SchoolsStatusFilter } from "../hooks/useSchoolsManagement";
import type { SchoolsSummary } from "../types/schools";
import type { SchoolLifecycleFilter } from "../schoolLifecycle";

type Props = {
  search: string;
  statusFilter: SchoolsStatusFilter;
  packageFilter: SchoolsPackageFilter;
  summary: SchoolsSummary;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: SchoolsStatusFilter) => void;
  onPackageFilterChange: (value: SchoolsPackageFilter) => void;
  onAddSchool: () => void;
};

const FILTER_TABS: Array<{ value: SchoolLifecycleFilter; label: string; countKey: keyof SchoolsSummary | null }> = [
  { value: "ACTIVE", label: "Active", countKey: "active" },
  { value: "TRIAL", label: "Trial", countKey: "trial" },
  { value: "INACTIVE", label: "Inactive", countKey: "inactive" },
  { value: "ARCHIVED", label: "Archived", countKey: "archived" },
  { value: "all", label: "All", countKey: "total" },
];

export default function SchoolsToolbar({
  search,
  statusFilter,
  packageFilter,
  summary,
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

        <div className="sa-schools-field sa-schools-field--lifecycle">
          <span className="sa-schools-field-label">Lifecycle</span>
          <div className="sa-schools-lifecycle-tabs" role="tablist" aria-label="School lifecycle">
            {FILTER_TABS.map((tab) => {
              const selected = statusFilter === tab.value;
              const count = tab.countKey ? summary[tab.countKey] : null;
              return (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={
                    selected
                      ? "sa-schools-lifecycle-tab sa-schools-lifecycle-tab--on"
                      : "sa-schools-lifecycle-tab"
                  }
                  onClick={() => onStatusFilterChange(tab.value)}
                >
                  {tab.label}
                  {count != null ? <span className="sa-schools-lifecycle-tab-count">{count}</span> : null}
                </button>
              );
            })}
          </div>
        </div>

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
