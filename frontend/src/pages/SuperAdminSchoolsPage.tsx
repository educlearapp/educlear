import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import SchoolsSummaryCards from "../superAdmin/components/SchoolsSummaryCards";
import SchoolsTable from "../superAdmin/components/SchoolsTable";
import SchoolsToolbar from "../superAdmin/components/SchoolsToolbar";
import { useSchoolsManagement } from "../superAdmin/hooks/useSchoolsManagement";
import type { SchoolRecord } from "../superAdmin/types/schools";
import { formatSchoolDate, formatSchoolDateTime } from "../superAdmin/utils/formatSchoolDates";
import "./SuperAdminSchoolsPage.css";

type Notice = {
  title: string;
  message: string;
};

function NoticeModal({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="sa-schools-modal-overlay" role="presentation" onClick={handleBackdropClick}>
      <div
        className="sa-schools-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sa-schools-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sa-schools-modal-accent" aria-hidden="true" />
        <h2 id="sa-schools-modal-title" className="sa-schools-modal-title">
          {notice.title}
        </h2>
        <p className="sa-schools-modal-message">{notice.message}</p>
        <div className="sa-schools-modal-actions">
          <button type="button" className="sa-schools-btn sa-schools-btn--gold" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function schoolDetailMessage(school: SchoolRecord): string {
  const lines = [
    `Owner: ${school.ownerName}`,
    `Email: ${school.email}`,
    `Package: ${school.package}`,
    `Status: ${school.status}${school.isActive ? "" : " (inactive)"}`,
    `Learners: ${school.learnerCount}`,
    `Parents: ${school.parentCount}`,
    `Registered: ${formatSchoolDate(school.registeredAt)}`,
    `Last login: ${formatSchoolDateTime(school.lastLoginAt)}`,
  ];
  return lines.join("\n");
}

export default function SuperAdminSchoolsPage() {
  const navigate = useNavigate();
  const {
    filteredSchools,
    summary,
    loading,
    error,
    reload,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    packageFilter,
    setPackageFilter,
    hasRegisteredSchools,
    onActivateSchool,
    onSuspendSchool,
    onChangePackage,
    onResetPassword,
    onAddSchool,
    onOpenDashboard,
  } = useSchoolsManagement();

  const [notice, setNotice] = useState<Notice | null>(null);

  const showNotice = useCallback((title: string, message: string) => {
    setNotice({ title, message });
  }, []);

  const handleView = useCallback(
    (school: SchoolRecord) => {
      showNotice(school.schoolName, schoolDetailMessage(school));
    },
    [showNotice]
  );

  const handleActivate = useCallback(
    (school: SchoolRecord) => {
      onActivateSchool(school);
      showNotice(
        "Activate School",
        `Activation for “${school.schoolName}” will be available in a future release.`
      );
    },
    [onActivateSchool, showNotice]
  );

  const handleSuspend = useCallback(
    (school: SchoolRecord) => {
      onSuspendSchool(school);
      showNotice(
        "Suspend School",
        `Suspension for “${school.schoolName}” will be available in a future release.`
      );
    },
    [onSuspendSchool, showNotice]
  );

  const handleChangePackage = useCallback(
    (school: SchoolRecord) => {
      onChangePackage(school);
      showNotice(
        "Change Package",
        `Package changes for “${school.schoolName}” will be available in a future release.`
      );
    },
    [onChangePackage, showNotice]
  );

  const handleResetPassword = useCallback(
    (school: SchoolRecord) => {
      onResetPassword(school);
      showNotice(
        "Reset Password",
        `Owner password reset for “${school.schoolName}” will be available in a future release.`
      );
    },
    [onResetPassword, showNotice]
  );

  const handleAddSchool = useCallback(() => {
    onAddSchool();
    navigate("/register-school");
  }, [onAddSchool, navigate]);

  const handleOpenDashboard = useCallback(
    (school: SchoolRecord) => {
      onOpenDashboard(school);
    },
    [onOpenDashboard]
  );

  return (
    <div className="sa-schools-page">
      <header className="sa-schools-header">
        <h1 className="page-title">Schools Management</h1>
        <p className="sa-schools-subtitle">
          Monitor all registered schools on the EduClear platform.
        </p>
      </header>

      {error ? (
        <div className="sa-schools-alert sa-schools-alert--error" role="alert">
          <p className="sa-schools-alert-title">Could not load schools</p>
          <p className="sa-schools-alert-text">{error}</p>
          <button
            type="button"
            className="sa-schools-btn sa-schools-btn--gold"
            onClick={() => void reload()}
          >
            Retry
          </button>
        </div>
      ) : null}

      <SchoolsSummaryCards summary={summary} />

      <SchoolsToolbar
        search={search}
        statusFilter={statusFilter}
        packageFilter={packageFilter}
        onSearchChange={setSearch}
        onStatusFilterChange={setStatusFilter}
        onPackageFilterChange={setPackageFilter}
        onAddSchool={handleAddSchool}
      />

      <SchoolsTable
        schools={filteredSchools}
        hasRegisteredSchools={hasRegisteredSchools}
        loading={loading}
        onView={handleView}
        onActivate={handleActivate}
        onSuspend={handleSuspend}
        onChangePackage={handleChangePackage}
        onResetPassword={handleResetPassword}
        onOpenDashboard={handleOpenDashboard}
      />

      {notice ? <NoticeModal notice={notice} onClose={() => setNotice(null)} /> : null}
    </div>
  );
}
