import { useCallback, useState } from "react";
import SchoolsSummaryCards from "../superAdmin/components/SchoolsSummaryCards";
import SchoolsTable from "../superAdmin/components/SchoolsTable";
import SchoolsToolbar from "../superAdmin/components/SchoolsToolbar";
import { useSchoolsManagement } from "../superAdmin/hooks/useSchoolsManagement";
import type { SchoolRecord } from "../superAdmin/types/schools";
import "./SuperAdminSchoolsPage.css";

type StubNotice = {
  title: string;
  message: string;
};

function StubModal({ notice, onClose }: { notice: StubNotice; onClose: () => void }) {
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

export default function SuperAdminSchoolsPage() {
  const {
    filteredSchools,
    summary,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    packageFilter,
    setPackageFilter,
    hasRegisteredSchools,
    onViewSchool,
    onActivateSchool,
    onSuspendSchool,
    onChangePackage,
    onResetPassword,
    onAddSchool,
  } = useSchoolsManagement();

  const [notice, setNotice] = useState<StubNotice | null>(null);

  const showStub = useCallback((title: string, message: string) => {
    setNotice({ title, message });
  }, []);

  const handleView = useCallback(
    (school: SchoolRecord) => {
      onViewSchool(school);
      showStub("View School", `School profile for “${school.schoolName}” will open here once connected.`);
    },
    [onViewSchool, showStub]
  );

  const handleActivate = useCallback(
    (school: SchoolRecord) => {
      onActivateSchool(school);
      showStub("Activate School", `Activation for “${school.schoolName}” will be available when the API is connected.`);
    },
    [onActivateSchool, showStub]
  );

  const handleSuspend = useCallback(
    (school: SchoolRecord) => {
      onSuspendSchool(school);
      showStub("Suspend School", `Suspension for “${school.schoolName}” will be available when the API is connected.`);
    },
    [onSuspendSchool, showStub]
  );

  const handleChangePackage = useCallback(
    (school: SchoolRecord) => {
      onChangePackage(school);
      showStub(
        "Change Package",
        `Package changes for “${school.schoolName}” will be available when the API is connected.`
      );
    },
    [onChangePackage, showStub]
  );

  const handleResetPassword = useCallback(
    (school: SchoolRecord) => {
      onResetPassword(school);
      showStub(
        "Reset Password",
        `Owner password reset for “${school.schoolName}” will be available when the API is connected.`
      );
    },
    [onResetPassword, showStub]
  );

  const handleAddSchool = useCallback(() => {
    onAddSchool();
    showStub("Add School", "School onboarding will be available when the Super Admin API is connected.");
  }, [onAddSchool, showStub]);

  return (
    <div className="sa-schools-page">
      <header className="sa-schools-header">
        <h1 className="page-title">Schools Management</h1>
        <p className="sa-schools-subtitle">
          Manage all registered schools on the EduClear platform.
        </p>
      </header>

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
        onView={handleView}
        onActivate={handleActivate}
        onSuspend={handleSuspend}
        onChangePackage={handleChangePackage}
        onResetPassword={handleResetPassword}
      />

      {notice ? <StubModal notice={notice} onClose={() => setNotice(null)} /> : null}
    </div>
  );
}
