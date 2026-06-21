import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import SchoolsSummaryCards from "../superAdmin/components/SchoolsSummaryCards";
import SchoolsTable from "../superAdmin/components/SchoolsTable";
import SchoolsToolbar from "../superAdmin/components/SchoolsToolbar";
import { updateSuperAdminSchool } from "../superAdmin/api/schoolsApi";
import { useSchoolsManagement } from "../superAdmin/hooks/useSchoolsManagement";
import { superAdminApiFetch, superAdminApiUpload } from "../superAdmin/superAdminApi";
import type { SchoolRecord } from "../superAdmin/types/schools";
import { formatSchoolDate, formatSchoolDateTime } from "../superAdmin/utils/formatSchoolDates";
import "./SuperAdminSchoolsPage.css";

const MBB_SCHOOL_ID = "cmq4xjckq00at60gqg4eb956h";

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

type MbbGroupPreviewRow = {
  sourceFile?: string;
  sheetName?: string;
  rowNumber?: number;
  name: string;
  comments?: string;
  status?: "ready" | "skip";
  reason?: string;
};

type MbbGroupsPreviewResponse = {
  success?: boolean;
  schoolName?: string;
  groups?: MbbGroupPreviewRow[];
  importedPreviewCount?: number;
  skippedCount?: number;
  totalGroups?: number;
  error?: string;
};

type MbbGroupsImportResponse = {
  success?: boolean;
  schoolName?: string;
  importedCount?: number;
  skippedCount?: number;
  totalGroups?: number;
  error?: string;
};

type MbbCleanupGroup = {
  id: string;
  name: string;
  comments?: string;
  childrenCount?: number;
  reason?: string;
};

type MbbGroupsCleanupPreviewResponse = {
  success?: boolean;
  schoolName?: string;
  groupsToDelete?: MbbCleanupGroup[];
  protectedGroups?: MbbCleanupGroup[];
  deleteCount?: number;
  protectedCount?: number;
  error?: string;
};

type MbbGroupsCleanupResponse = {
  success?: boolean;
  schoolName?: string;
  deletedGroups?: MbbCleanupGroup[];
  protectedGroups?: MbbCleanupGroup[];
  deletedCount?: number;
  protectedCount?: number;
  error?: string;
};

type MbbGroupsLearnerLinkResponse = {
  success?: boolean;
  blocked?: boolean;
  schoolName?: string;
  learnersLinked?: number;
  learnersAlreadyLinked?: number;
  learnersSkippedNoGroup?: number;
  learnersSkippedNoLearner?: number;
  externalMembersCreated?: number;
  externalMembersAlreadyExists?: number;
  groupsUpdated?: number;
  debug?: Array<{
    uploadedFilename?: string;
    worksheetName?: string;
    derivedGroupName?: string;
    detectedTitleRow?: number;
    detectedGroupName?: string;
    matchingGroupFound?: boolean;
    matchingGroupId?: string;
    learnerNamesRead?: number;
    learnerIdsMatched?: number;
    learnerLinksCreated?: number;
    externalNamesCreated?: number;
  }>;
  unmatchedLearnerDebug?: Array<{
    uploadedFilename?: string;
    worksheetName?: string;
    rowNumber?: number;
    groupName?: string;
    nameReadFromExcel?: string;
    normalizedNameUsedForLookup?: string;
    whyMatchFailed?: string;
    closestLearners?: Array<{
      storedLearnerFullName?: string;
      storedFirstName?: string;
      storedSurname?: string;
      normalizedStoredName?: string;
      score?: number;
    }>;
  }>;
  unmatchedGroupDebug?: Array<{
    uploadedFilename?: string;
    worksheetName?: string;
    derivedGroupName?: string;
  }>;
  existingGroupNames?: string[];
  normalizationUsed?: string;
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

function formatMbbGroupsImportResult(response: MbbGroupsImportResponse): string {
  return [
    `Imported: ${response.importedCount ?? 0}`,
    `Skipped: ${response.skippedCount ?? 0}`,
    `Total Groups: ${response.totalGroups ?? 0}`,
  ].join("\n");
}

function formatCleanupGroupNames(groups: MbbCleanupGroup[], limit = 12): string {
  if (!groups.length) return "None";
  const names = groups.slice(0, limit).map((group) => `- ${group.name}`);
  if (groups.length > limit) names.push(`...and ${groups.length - limit} more`);
  return names.join("\n");
}

function formatMbbGroupsCleanupResult(response: MbbGroupsCleanupResponse): string {
  const deleted = Array.isArray(response.deletedGroups) ? response.deletedGroups : [];
  const protectedGroups = Array.isArray(response.protectedGroups) ? response.protectedGroups : [];
  return [
    `Groups deleted: ${response.deletedCount ?? deleted.length}`,
    `Groups protected/skipped: ${response.protectedCount ?? protectedGroups.length}`,
    "",
    "Deleted groups:",
    formatCleanupGroupNames(deleted),
  ].join("\n");
}

function formatMbbGroupsLearnerLinkResult(response: MbbGroupsLearnerLinkResponse): string {
  const lines = [
    `Names copied: ${response.externalMembersCreated ?? 0}`,
    `Duplicate names skipped: ${response.externalMembersAlreadyExists ?? 0}`,
    `Names skipped (no group): ${response.learnersSkippedNoGroup ?? 0}`,
    `Groups updated: ${response.groupsUpdated ?? 0}`,
    "Learner matching: not attempted",
  ];

  if (response.blocked) {
    lines.unshift(response.error || "No links were created because one or more group names did not match.");
  }

  const debugRows = Array.isArray(response.debug) ? response.debug : [];
  if (debugRows.length) {
    lines.push("");
    lines.push("Debug:");
    for (const row of debugRows.slice(0, 20)) {
      lines.push(
        `- File: ${row.uploadedFilename || "?"} | Sheet: ${row.worksheetName || "?"} | Title row: ${row.detectedTitleRow || "-"} | Detected group: ${row.detectedGroupName || row.derivedGroupName || "?"} | Group found: ${row.matchingGroupFound ? "yes" : "no"} | Group ID: ${row.matchingGroupId || "-"} | Names read: ${row.learnerNamesRead ?? 0} | Names copied: ${row.externalNamesCreated ?? 0}`
      );
    }
    if (debugRows.length > 20) lines.push(`...and ${debugRows.length - 20} more debug row(s)`);
  }

  const unmatched = Array.isArray(response.unmatchedGroupDebug) ? response.unmatchedGroupDebug : [];
  if (unmatched.length) {
    lines.push("");
    lines.push("Unmatched derived group names:");
    for (const row of unmatched.slice(0, 20)) {
      lines.push(`- ${row.derivedGroupName || "?"} (${row.uploadedFilename || "?"} / ${row.worksheetName || "?"})`);
    }
  }

  if (response.normalizationUsed) {
    lines.push("");
    lines.push(`Import rule: ${response.normalizationUsed}`);
  }

  const existing = Array.isArray(response.existingGroupNames) ? response.existingGroupNames : [];
  if (existing.length) {
    lines.push("");
    lines.push("Existing MBB group names:");
    for (const name of existing.slice(0, 60)) lines.push(`- ${name}`);
    if (existing.length > 60) lines.push(`...and ${existing.length - 60} more`);
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
  const [mbbGroupFiles, setMbbGroupFiles] = useState<File[]>([]);
  const [mbbGroupsPreview, setMbbGroupsPreview] = useState<MbbGroupsPreviewResponse | null>(null);
  const [mbbGroupsPreviewing, setMbbGroupsPreviewing] = useState(false);
  const [mbbGroupsImporting, setMbbGroupsImporting] = useState(false);
  const [mbbGroupsCleaning, setMbbGroupsCleaning] = useState(false);
  const mbbGroupsFileInputRef = useRef<HTMLInputElement | null>(null);
  const [mbbLinkFiles, setMbbLinkFiles] = useState<File[]>([]);
  const [mbbLinkingLearners, setMbbLinkingLearners] = useState(false);
  const mbbLinkFilesInputRef = useRef<HTMLInputElement | null>(null);
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

  const handleMbbGroupFilesSelected = useCallback((files: FileList | null) => {
    const nextFiles = Array.from(files || []);
    if (!nextFiles.length) return;
    setMbbGroupFiles((current) => {
      const byKey = new Map(current.map((file) => [`${file.name}:${file.size}`, file]));
      for (const file of nextFiles) byKey.set(`${file.name}:${file.size}`, file);
      return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
    });
    setMbbGroupsPreview(null);
    if (mbbGroupsFileInputRef.current) mbbGroupsFileInputRef.current.value = "";
  }, []);

  const handleMbbLinkFilesSelected = useCallback((files: FileList | null) => {
    const nextFiles = Array.from(files || []);
    if (!nextFiles.length) return;
    setMbbLinkFiles((current) => {
      const byKey = new Map(current.map((file) => [`${file.name}:${file.size}`, file]));
      for (const file of nextFiles) byKey.set(`${file.name}:${file.size}`, file);
      return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
    });
    if (mbbLinkFilesInputRef.current) mbbLinkFilesInputRef.current.value = "";
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

  const handlePreviewMbbGroups = useCallback(async () => {
    if (!mbbGroupFiles.length) {
      showNotice("Select MBB group files", "Choose Paula's MBB Groups Excel/CSV files before previewing.");
      return;
    }

    const form = new FormData();
    form.append("schoolId", MBB_SCHOOL_ID);
    for (const file of mbbGroupFiles) form.append("files", file, file.name);

    setMbbGroupsPreviewing(true);
    try {
      const response = (await superAdminApiUpload(
        "/api/super-admin/mbb-direct-import/groups/preview",
        form
      )) as MbbGroupsPreviewResponse;
      if (response.success === false) {
        throw new Error(response.error || "MBB groups preview failed.");
      }
      setMbbGroupsPreview(response);
    } catch (err: unknown) {
      setMbbGroupsPreview(null);
      showNotice(
        "MBB groups preview failed",
        err instanceof Error ? err.message : "The MBB groups preview could not be completed."
      );
    } finally {
      setMbbGroupsPreviewing(false);
    }
  }, [mbbGroupFiles, showNotice]);

  const handleImportMbbGroups = useCallback(async () => {
    const groups = Array.isArray(mbbGroupsPreview?.groups) ? mbbGroupsPreview.groups : [];
    if (!groups.length) {
      showNotice("Preview MBB groups first", "Preview the MBB group files before importing.");
      return;
    }

    setMbbGroupsImporting(true);
    try {
      const response = (await superAdminApiFetch("/api/super-admin/mbb-direct-import/groups/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schoolId: MBB_SCHOOL_ID,
          groups,
        }),
      })) as MbbGroupsImportResponse;
      if (response.success === false) {
        throw new Error(response.error || "MBB groups import failed.");
      }
      await reload();
      setMbbGroupsPreview(null);
      setMbbGroupFiles([]);
      if (mbbGroupsFileInputRef.current) mbbGroupsFileInputRef.current.value = "";
      showNotice(
        "MBB groups imported",
        `${response.schoolName || "Magical Bright Beginnings"} group import finished.\n\n${formatMbbGroupsImportResult(response)}`
      );
    } catch (err: unknown) {
      showNotice(
        "MBB groups import failed",
        err instanceof Error ? err.message : "The MBB groups import could not be completed."
      );
    } finally {
      setMbbGroupsImporting(false);
    }
  }, [mbbGroupsPreview, reload, showNotice]);

  const handleRemoveBadMbbGroupsImport = useCallback(async () => {
    setMbbGroupsCleaning(true);
    try {
      const preview = (await superAdminApiFetch(
        `/api/super-admin/mbb-direct-import/groups/cleanup-preview?schoolId=${encodeURIComponent(MBB_SCHOOL_ID)}`
      )) as MbbGroupsCleanupPreviewResponse;
      if (preview.success === false) {
        throw new Error(preview.error || "MBB groups cleanup preview failed.");
      }

      const groupsToDelete = Array.isArray(preview.groupsToDelete) ? preview.groupsToDelete : [];
      const protectedGroups = Array.isArray(preview.protectedGroups) ? preview.protectedGroups : [];
      if (!groupsToDelete.length) {
        showNotice(
          "No bad MBB groups found",
          `Groups to delete: 0\nGroups protected/skipped: ${protectedGroups.length}`
        );
        return;
      }

      setConfirm({
        title: "Remove bad MBB groups import?",
        message:
          `This cleanup is MBB-only and will delete only numeric group names with children count 0.\n\n` +
          `Groups to delete: ${groupsToDelete.length}\n` +
          `${formatCleanupGroupNames(groupsToDelete)}\n\n` +
          `Groups protected/skipped: ${protectedGroups.length}\n\n` +
          `No learners, parents, classrooms, billing, balances, transactions, or statements will be touched.`,
        confirmLabel: "Remove bad groups",
        run: () => {
          void (async () => {
            setMbbGroupsCleaning(true);
            try {
              const response = (await superAdminApiFetch(
                "/api/super-admin/mbb-direct-import/groups/cleanup-bad-import",
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ schoolId: MBB_SCHOOL_ID }),
                }
              )) as MbbGroupsCleanupResponse;
              if (response.success === false) {
                throw new Error(response.error || "MBB groups cleanup failed.");
              }
              localStorage.removeItem("educlearGroups");
              localStorage.removeItem(`educlearGroups:${MBB_SCHOOL_ID}`);
              localStorage.setItem(`educlearGroups:${MBB_SCHOOL_ID}:refreshRequestedAt`, String(Date.now()));
              window.dispatchEvent(new CustomEvent("educlear:groups-refresh", { detail: { schoolId: MBB_SCHOOL_ID } }));
              await reload();
              setMbbGroupsPreview(null);
              showNotice(
                "Bad MBB groups removed",
                `${response.schoolName || "Magical Bright Beginnings"} cleanup complete.\n\n${formatMbbGroupsCleanupResult(response)}`
              );
            } catch (err: unknown) {
              showNotice(
                "MBB groups cleanup failed",
                err instanceof Error ? err.message : "The bad MBB groups cleanup could not be completed."
              );
            } finally {
              setMbbGroupsCleaning(false);
            }
          })();
        },
      });
    } catch (err: unknown) {
      showNotice(
        "MBB groups cleanup preview failed",
        err instanceof Error ? err.message : "The MBB groups cleanup preview could not be completed."
      );
    } finally {
      setMbbGroupsCleaning(false);
    }
  }, [reload, showNotice]);

  const handleLinkMbbLearnersToGroups = useCallback(async () => {
    if (!mbbLinkFiles.length) {
      showNotice("Select MBB group files", "Choose Paula's MBB group Excel files. The title row inside each worksheet is treated as the group.");
      return;
    }

    const form = new FormData();
    form.append("schoolId", MBB_SCHOOL_ID);
    for (const file of mbbLinkFiles) form.append("files", file, file.name);

    setMbbLinkingLearners(true);
    try {
      const response = (await superAdminApiUpload(
        "/api/super-admin/mbb-direct-import/groups/link-learners",
        form
      )) as MbbGroupsLearnerLinkResponse;
      if (response.success === false) {
        throw new Error(response.error || "MBB group member copy failed.");
      }
      if (response.blocked) {
        showNotice(
          "MBB group matching blocked",
          formatMbbGroupsLearnerLinkResult(response)
        );
        return;
      }
      localStorage.removeItem("educlearGroups");
      localStorage.removeItem(`educlearGroups:${MBB_SCHOOL_ID}`);
      localStorage.setItem(`educlearGroups:${MBB_SCHOOL_ID}:refreshRequestedAt`, String(Date.now()));
      window.dispatchEvent(new CustomEvent("educlear:groups-refresh", { detail: { schoolId: MBB_SCHOOL_ID } }));
      await reload();
      setMbbLinkFiles([]);
      if (mbbLinkFilesInputRef.current) mbbLinkFilesInputRef.current.value = "";
      showNotice(
        "MBB names copied to groups",
        `${response.schoolName || "Magical Bright Beginnings"} group members updated.\n\n${formatMbbGroupsLearnerLinkResult(response)}`
      );
    } catch (err: unknown) {
      showNotice(
        "MBB group member copy failed",
        err instanceof Error ? err.message : "The MBB group member copy could not be completed."
      );
    } finally {
      setMbbLinkingLearners(false);
    }
  }, [mbbLinkFiles, reload, showNotice]);

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

  const mbbGroupsPreviewRows = Array.isArray(mbbGroupsPreview?.groups) ? mbbGroupsPreview.groups : [];
  const mbbGroupsReadyCount = mbbGroupsPreviewRows.filter((row) => row.status === "ready").length;
  const mbbGroupsSkippedCount = mbbGroupsPreviewRows.filter((row) => row.status === "skip").length;

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

      <section className="sa-schools-mbb-import" aria-label="Temporary MBB Groups Import">
        <div>
          <p className="sa-schools-mbb-import-kicker">Temporary production tool</p>
          <h2 className="sa-schools-mbb-import-title">Import MBB Groups</h2>
          <p className="sa-schools-mbb-import-text">
            Upload Paula&apos;s MBB Groups Excel/CSV files, preview the group names, then import
            only new groups into Magical Bright Beginnings. This tool skips duplicate group names
            and does not modify learners, parents, classrooms, billing, statements, or balances.
          </p>
          <p className="sa-schools-mbb-import-count">
            Selected files: <strong>{mbbGroupFiles.length}</strong>
          </p>
          {mbbGroupsPreview ? (
            <div className="sa-schools-mbb-groups-preview" aria-live="polite">
              <div className="sa-schools-mbb-groups-stats">
                <span>Ready: {mbbGroupsReadyCount}</span>
                <span>Skipped: {mbbGroupsSkippedCount}</span>
                <span>Total Groups: {mbbGroupsPreviewRows.length}</span>
              </div>
              <div className="sa-schools-mbb-groups-list">
                {mbbGroupsPreviewRows.slice(0, 30).map((group, index) => (
                  <div
                    key={`${group.sourceFile || "file"}:${group.sheetName || "sheet"}:${group.rowNumber || index}:${group.name}`}
                    className="sa-schools-mbb-groups-row"
                  >
                    <span className="sa-schools-mbb-groups-name">{group.name}</span>
                    <span className={group.status === "skip" ? "sa-schools-mbb-groups-skip" : "sa-schools-mbb-groups-ready"}>
                      {group.status === "skip" ? `Skipped${group.reason ? `: ${group.reason}` : ""}` : "Ready"}
                    </span>
                  </div>
                ))}
                {mbbGroupsPreviewRows.length > 30 ? (
                  <p className="sa-schools-mbb-groups-more">
                    Showing first 30 of {mbbGroupsPreviewRows.length} groups.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <div className="sa-schools-mbb-import-actions">
          <input
            ref={mbbGroupsFileInputRef}
            type="file"
            multiple
            accept=".csv,.xls,.xlsx"
            className="sa-schools-mbb-import-input"
            onChange={(e) => handleMbbGroupFilesSelected(e.target.files)}
          />
          <button
            type="button"
            className="sa-schools-btn"
            onClick={() => {
              setMbbGroupFiles([]);
              setMbbGroupsPreview(null);
              if (mbbGroupsFileInputRef.current) mbbGroupsFileInputRef.current.value = "";
            }}
            disabled={mbbGroupsPreviewing || mbbGroupsImporting || mbbGroupFiles.length === 0}
          >
            Clear files
          </button>
          <button
            type="button"
            className="sa-schools-btn"
            onClick={() => void handlePreviewMbbGroups()}
            disabled={mbbGroupsPreviewing || mbbGroupsImporting || mbbGroupFiles.length === 0}
          >
            {mbbGroupsPreviewing ? "Previewing…" : "Preview groups"}
          </button>
          <button
            type="button"
            className="sa-schools-btn sa-schools-btn--gold"
            onClick={() => void handleImportMbbGroups()}
            disabled={mbbGroupsPreviewing || mbbGroupsImporting || mbbGroupsCleaning || mbbGroupsReadyCount === 0}
          >
            {mbbGroupsImporting ? "Importing…" : "Import groups"}
          </button>
          <button
            type="button"
            className="sa-schools-btn sa-schools-btn--danger"
            onClick={() => void handleRemoveBadMbbGroupsImport()}
            disabled={mbbGroupsPreviewing || mbbGroupsImporting || mbbGroupsCleaning || mbbLinkingLearners}
          >
            {mbbGroupsCleaning ? "Checking cleanup…" : "Remove Bad MBB Groups Import"}
          </button>
          <div className="sa-schools-mbb-secondary-tool">
            <p className="sa-schools-mbb-import-count">
              Group member files: <strong>{mbbLinkFiles.length}</strong>
            </p>
            <input
              ref={mbbLinkFilesInputRef}
              type="file"
              multiple
              accept=".csv,.xls,.xlsx"
              className="sa-schools-mbb-import-input"
              onChange={(e) => handleMbbLinkFilesSelected(e.target.files)}
            />
            <button
              type="button"
              className="sa-schools-btn"
              onClick={() => {
                setMbbLinkFiles([]);
                if (mbbLinkFilesInputRef.current) mbbLinkFilesInputRef.current.value = "";
              }}
              disabled={mbbLinkingLearners || mbbLinkFiles.length === 0}
            >
              Clear member files
            </button>
            <button
              type="button"
              className="sa-schools-btn sa-schools-btn--gold"
              onClick={() => void handleLinkMbbLearnersToGroups()}
              disabled={mbbGroupsPreviewing || mbbGroupsImporting || mbbGroupsCleaning || mbbLinkingLearners || mbbLinkFiles.length === 0}
            >
              {mbbLinkingLearners ? "Copying names…" : "Copy Names to Imported Groups"}
            </button>
          </div>
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
