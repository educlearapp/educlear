import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SchoolsSummaryCards from "../superAdmin/components/SchoolsSummaryCards";
import SchoolsTable from "../superAdmin/components/SchoolsTable";
import SchoolsToolbar from "../superAdmin/components/SchoolsToolbar";
import { updateSuperAdminSchool } from "../superAdmin/api/schoolsApi";
import { useSchoolsManagement } from "../superAdmin/hooks/useSchoolsManagement";
import { superAdminApiUpload } from "../superAdmin/superAdminApi";
import type { SchoolRecord } from "../superAdmin/types/schools";
import { formatSchoolDate, formatSchoolDateTime } from "../superAdmin/utils/formatSchoolDates";
import "./SuperAdminSchoolsPage.css";

type Notice = {
  title: string;
  message: string;
};

type MbbMissingLearnerRepairResponse = {
  success?: boolean;
  schoolName?: string;
  createdLearners?: Array<{
    sourceFullName?: string;
    admissionNo?: string;
    className?: string;
    accountRef?: string | null;
  }>;
  counts?: Record<string, number>;
  error?: string;
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

function formatMbbRepairResult(response: MbbMissingLearnerRepairResponse): string {
  const counts = response.counts || {};
  const learners = Array.isArray(response.createdLearners) ? response.createdLearners : [];
  const lines = [
    `Learners before: ${counts.learnersBefore ?? "?"}`,
    `Learners created: ${counts.learnersCreated ?? learners.length}`,
    `Learners after: ${counts.learnersAfter ?? "?"}`,
    `Parents after: ${counts.parentsAfter ?? "?"}`,
    `Billing accounts after: ${counts.billingAccountsAfter ?? "?"}`,
    `Billing plan lines created: ${counts.billingPlanLinesCreated ?? 0}`,
  ];
  if (learners.length) {
    lines.push("");
    lines.push("Created learners:");
    for (const learner of learners) {
      lines.push(
        `- ${learner.sourceFullName || learner.admissionNo || "Learner"} · ${learner.className || "No classroom"} · ${learner.accountRef || "No account"}`
      );
    }
  }
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

  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [manageSchool, setManageSchool] = useState<SchoolRecord | null>(null);
  const [savingManage, setSavingManage] = useState(false);
  const [mbbFiles, setMbbFiles] = useState<File[]>([]);
  const [mbbRepairing, setMbbRepairing] = useState(false);
  const mbbFileInputRef = useRef<HTMLInputElement | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    run: () => void;
  } | null>(null);

  const totalFilteredSchools = filteredSchools.length;
  const totalPages = Math.max(1, Math.ceil(totalFilteredSchools / PAGE_SIZE));

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, packageFilter]);

  useEffect(() => {
    setPage((current) => Math.min(Math.max(1, current), totalPages));
  }, [totalPages]);

  const paginatedSchools = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredSchools.slice(start, start + PAGE_SIZE);
  }, [filteredSchools, page]);

  const pageRangeLabel = useMemo(() => {
    if (totalFilteredSchools === 0) return "Showing 0 of 0";
    const start = (page - 1) * PAGE_SIZE + 1;
    const end = Math.min(page * PAGE_SIZE, totalFilteredSchools);
    return `Showing ${start}–${end} of ${totalFilteredSchools}`;
  }, [page, totalFilteredSchools]);

  const showNotice = useCallback((title: string, message: string) => {
    setNotice({ title, message });
  }, []);

  const handleMbbFilesSelected = useCallback((files: FileList | null) => {
    const nextFiles = Array.from(files || []);
    if (!nextFiles.length) return;
    setMbbFiles((current) => {
      const byKey = new Map(current.map((file) => [`${file.name}:${file.size}`, file]));
      for (const file of nextFiles) byKey.set(`${file.name}:${file.size}`, file);
      return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
    });
    if (mbbFileInputRef.current) mbbFileInputRef.current.value = "";
  }, []);

  const handleRepairMissingMbbLearners = useCallback(async () => {
    if (!mbbFiles.length) {
      showNotice("Select MBB files", "Choose the MBB Kid-e-Sys export files before repairing learners.");
      return;
    }

    const form = new FormData();
    for (const file of mbbFiles) form.append("files", file, file.name);

    setMbbRepairing(true);
    try {
      const response = (await superAdminApiUpload(
        "/api/super-admin/mbb-direct-import/repair-missing-learners",
        form
      )) as MbbMissingLearnerRepairResponse;
      if (response.success === false) {
        throw new Error(response.error || "MBB missing learner repair failed.");
      }
      await reload();
      showNotice(
        "MBB missing learners repaired",
        `${response.schoolName || "Magical Bright Beginnings"} now has the repaired learner records.\n\n${formatMbbRepairResult(response)}`
      );
    } catch (err: unknown) {
      showNotice(
        "MBB repair failed",
        err instanceof Error ? err.message : "The MBB missing learner repair could not be completed."
      );
    } finally {
      setMbbRepairing(false);
    }
  }, [mbbFiles, reload, showNotice]);

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
      const current = String(school.package || "").trim();
      const next = current === "Starter" ? "Unlimited" : "Starter";
      setConfirm({
        title: "Change package?",
        message: `Switch “${school.schoolName}” from ${school.package || "—"} to ${next}?`,
        confirmLabel: "Change package",
        run: () => {
          void onChangePackage(school)
            .then(() =>
              showNotice("Package updated", `“${school.schoolName}” is now on ${next}.`)
            )
            .catch((err: unknown) =>
              showNotice(
                "Could not change package",
                err instanceof Error ? err.message : "Could not update this school's package."
              )
            );
        },
      });
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

      <section className="sa-schools-mbb-import" aria-label="Temporary MBB Missing Learner Repair">
        <div>
          <p className="sa-schools-mbb-import-kicker">Temporary production tool</p>
          <h2 className="sa-schools-mbb-import-title">Repair Missing MBB Learners</h2>
          <p className="sa-schools-mbb-import-text">
            Select the Magical Bright Beginnings Kid-e-Sys export files, then run the focused
            repair with this logged-in Super Admin session. The repair only creates exactly 3
            missing learners and refreshes the school list after completion.
          </p>
          <p className="sa-schools-mbb-import-count">
            Selected files: <strong>{mbbFiles.length}</strong>
          </p>
        </div>
        <div className="sa-schools-mbb-import-actions">
          <input
            ref={mbbFileInputRef}
            type="file"
            multiple
            accept=".xls,.xlsx,.pdf"
            className="sa-schools-mbb-import-input"
            onChange={(e) => handleMbbFilesSelected(e.target.files)}
          />
          <button
            type="button"
            className="sa-schools-btn"
            onClick={() => {
              setMbbFiles([]);
              if (mbbFileInputRef.current) mbbFileInputRef.current.value = "";
            }}
            disabled={mbbRepairing || mbbFiles.length === 0}
          >
            Clear files
          </button>
          <button
            type="button"
            className="sa-schools-btn sa-schools-btn--gold"
            onClick={() => void handleRepairMissingMbbLearners()}
            disabled={mbbRepairing || mbbFiles.length === 0}
          >
            {mbbRepairing ? "Repairing MBB…" : "Repair Missing 3 MBB Learners"}
          </button>
        </div>
      </section>

      <div className="sa-schools-pagination" role="navigation" aria-label="Schools pagination">
        <div className="sa-schools-pagination-meta" aria-live="polite">
          <span className="sa-schools-pagination-range">{pageRangeLabel}</span>
          <span className="sa-schools-pagination-page">
            Page {page} of {totalPages}
          </span>
        </div>
        <div className="sa-schools-pagination-actions">
          <button
            type="button"
            className="sa-schools-btn"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Previous
          </button>
          <button
            type="button"
            className="sa-schools-btn"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </button>
        </div>
      </div>

      <SchoolsTable
        schools={paginatedSchools}
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
