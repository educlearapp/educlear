import { useCallback, useState } from "react";
import SchoolsSummaryCards from "../superAdmin/components/SchoolsSummaryCards";
import SchoolsTable from "../superAdmin/components/SchoolsTable";
import SchoolsToolbar from "../superAdmin/components/SchoolsToolbar";
import { updateSuperAdminSchool } from "../superAdmin/api/schoolsApi";
import { useSchoolsManagement } from "../superAdmin/hooks/useSchoolsManagement";
import type { SchoolRecord } from "../superAdmin/types/schools";
import { formatSchoolDate, formatSchoolDateTime } from "../superAdmin/utils/formatSchoolDates";
import "./SuperAdminSchoolsPage.css";

type Notice = {
  title: string;
  message: string;
};

type ConfirmModalProps = {
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
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

function ConfirmModal({
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onCancel();
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
          {title}
        </h2>
        <p className="sa-schools-modal-message">{message}</p>
        <div className="sa-schools-modal-actions" style={{ gap: 12 }}>
          <button type="button" className="sa-schools-btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="sa-schools-btn sa-schools-btn--gold" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

type ManageModalProps = {
  school: SchoolRecord;
  saving?: boolean;
  onClose: () => void;
  onRequestSave: (next: { status: SchoolRecord["status"]; package: SchoolRecord["package"] }) => void;
};

function ManageSchoolModal({ school, saving = false, onClose, onRequestSave }: ManageModalProps) {
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const [status, setStatus] = useState<SchoolRecord["status"]>(school.status);
  const [pkg, setPkg] = useState<SchoolRecord["package"]>(school.package);

  return (
    <div className="sa-schools-modal-overlay" role="presentation" onClick={handleBackdropClick}>
      <div
        className="sa-schools-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sa-schools-manage-title"
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(620px, 100%)" }}
      >
        <div className="sa-schools-modal-accent" aria-hidden="true" />
        <h2 id="sa-schools-manage-title" className="sa-schools-modal-title">
          Manage — {school.schoolName}
        </h2>

        <div style={{ display: "grid", gap: 14, marginBottom: 18 }}>
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: "1px solid rgba(212, 175, 55, 0.28)",
              background: "rgba(212, 175, 55, 0.06)",
              color: "rgba(255,255,255,0.92)",
              whiteSpace: "pre-line",
              lineHeight: 1.5,
              fontSize: "0.95rem",
            }}
          >
            {schoolDetailMessage(school)}
          </div>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: "0.78rem", fontWeight: 800, letterSpacing: "0.04em", color: "#d4af37" }}>
              Status
            </span>
            <select
              className="sa-schools-select"
              value={status}
              onChange={(e) => setStatus(e.target.value as SchoolRecord["status"])}
              disabled={saving}
              style={{ background: "#0a0a0a", color: "#ffffff", borderColor: "rgba(212,175,55,0.35)" }}
            >
              <option value="Active">Active</option>
              <option value="Trial">Trial</option>
              <option value="Suspended">Suspended</option>
            </select>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: "0.78rem", fontWeight: 800, letterSpacing: "0.04em", color: "#d4af37" }}>
              Package
            </span>
            <select
              className="sa-schools-select"
              value={pkg}
              onChange={(e) => setPkg(e.target.value as SchoolRecord["package"])}
              disabled={saving}
              style={{ background: "#0a0a0a", color: "#ffffff", borderColor: "rgba(212,175,55,0.35)" }}
            >
              <option value="Starter">Starter</option>
              <option value="Unlimited">Unlimited</option>
            </select>
          </label>
        </div>

        <div className="sa-schools-modal-actions" style={{ gap: 12 }}>
          <button type="button" className="sa-schools-btn" onClick={onClose} disabled={saving}>
            Close
          </button>
          <button
            type="button"
            className="sa-schools-btn sa-schools-btn--gold"
            onClick={() => onRequestSave({ status, package: pkg })}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save changes"}
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
    `Contact: ${school.contactPhone || "—"}`,
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
  const [manageSchool, setManageSchool] = useState<SchoolRecord | null>(null);
  const [savingManage, setSavingManage] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    run: () => void;
  } | null>(null);

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
      setConfirm({
        title: "Reactivate school?",
        message: `This will restore access for “${school.schoolName}”.`,
        confirmLabel: "Reactivate",
        run: () => {
          void onActivateSchool(school)
            .then(() => showNotice("School reactivated", `“${school.schoolName}” is active again.`))
            .catch((err: unknown) =>
              showNotice(
                "Could not reactivate",
                err instanceof Error ? err.message : "Could not reactivate this school."
              )
            );
        },
      });
    },
    [onActivateSchool, showNotice]
  );

  const handleSuspend = useCallback(
    (school: SchoolRecord) => {
      setConfirm({
        title: "Suspend school?",
        message:
          `This will block school users from normal dashboard access.\n\n` +
          `School data will not be deleted.`,
        confirmLabel: "Suspend",
        run: () => {
          void onSuspendSchool(school)
            .then(() => showNotice("School suspended", `“${school.schoolName}” has been suspended.`))
            .catch((err: unknown) =>
              showNotice(
                "Could not suspend",
                err instanceof Error ? err.message : "Could not suspend this school."
              )
            );
        },
      });
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
    showNotice(
      "Add School",
      "Schools are added automatically when they complete school registration."
    );
  }, [onAddSchool, showNotice]);

  const handleOpenDashboard = useCallback(
    (school: SchoolRecord) => {
      onOpenDashboard(school);
    },
    [onOpenDashboard]
  );

  const handleManage = useCallback((school: SchoolRecord) => {
    setManageSchool(school);
  }, []);

  const requestSaveManage = useCallback(
    (school: SchoolRecord, next: { status: SchoolRecord["status"]; package: SchoolRecord["package"] }) => {
      const statusChanged = next.status !== school.status;
      const isSuspending = statusChanged && next.status === "Suspended";
      const isReactivating = statusChanged && school.status === "Suspended" && next.status !== "Suspended";

      const run = async () => {
        setSavingManage(true);
        try {
          await updateSuperAdminSchool(school.id, { status: next.status, package: next.package });
          await reload();
          setManageSchool(null);
          showNotice("School updated", `Changes saved for “${school.schoolName}”.`);
        } catch (err: unknown) {
          showNotice(
            "Could not update school",
            err instanceof Error ? err.message : "Could not update this school."
          );
        } finally {
          setSavingManage(false);
        }
      };

      if (isSuspending) {
        setConfirm({
          title: "Suspend school?",
          message:
            `This will block school users from normal dashboard access.\n\n` +
            `School data will not be deleted.`,
          confirmLabel: "Suspend",
          run: () => void run(),
        });
        return;
      }

      if (isReactivating) {
        setConfirm({
          title: "Reactivate school?",
          message: `This will restore access for “${school.schoolName}”.`,
          confirmLabel: "Reactivate",
          run: () => void run(),
        });
        return;
      }

      void run();
    },
    [reload, showNotice]
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
        loadError={error}
        loading={loading}
        onManage={handleManage}
        onView={handleView}
        onActivate={handleActivate}
        onSuspend={handleSuspend}
        onChangePackage={handleChangePackage}
        onResetPassword={handleResetPassword}
        onOpenDashboard={handleOpenDashboard}
      />

      {notice ? <NoticeModal notice={notice} onClose={() => setNotice(null)} /> : null}
      {manageSchool ? (
        <ManageSchoolModal
          school={manageSchool}
          saving={savingManage}
          onClose={() => {
            if (!savingManage) setManageSchool(null);
          }}
          onRequestSave={(next) => requestSaveManage(manageSchool, next)}
        />
      ) : null}
      {confirm ? (
        <ConfirmModal
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const run = confirm.run;
            setConfirm(null);
            run();
          }}
        />
      ) : null}
    </div>
  );
}
