import { useCallback, useEffect, useState } from "react";
import AdmissionsStatusBadge from "./AdmissionsStatusBadge";
import { getEnrolmentStatusLabel } from "./conversionDecision";
import { listApplications } from "./staffAdmissionsApi";
import type { StaffApplicationListItem } from "./staffAdmissionsTypes";
import "./admissionsStaff.css";

const DEFAULT_STATUS =
  "SUBMITTED,UNDER_REVIEW,INFO_REQUESTED,ACCEPTED,DECLINED,WITHDRAWN,CANCELLED";

const STATUS_OPTIONS = [
  { value: DEFAULT_STATUS, label: "Active pipeline" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "UNDER_REVIEW", label: "Under review" },
  { value: "INFO_REQUESTED", label: "Info requested" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "DECLINED,WITHDRAWN,CANCELLED", label: "Closed" },
  { value: "DRAFT", label: "Drafts (incomplete — not submitted)" },
];

const DRAFT_STATUS = "DRAFT";

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Props = {
  onOpenApplication: (applicationId: string) => void;
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function learnerName(row: StaffApplicationListItem): string {
  const name = `${row.learnerFirstName || ""} ${row.learnerLastName || ""}`.trim();
  return name || "—";
}

function paymentLabel(row: StaffApplicationListItem): string {
  if (!row.feeRequired) return "Not required";
  return (row.paymentStatus || "Pending").replace(/_/g, " ");
}

export default function AdmissionsListPage({ onOpenApplication }: Props) {
  const [statusFilter, setStatusFilter] = useState(DEFAULT_STATUS);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState<StaffApplicationListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [loadedFilter, setLoadedFilter] = useState<string | null>(null);
  const pageSize = 20;
  const viewingDrafts = statusFilter === DRAFT_STATUS;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await listApplications({ status: DRAFT_STATUS, page: 1, pageSize: 1 });
        if (!cancelled) setDraftCount(result.total);
      } catch {
        if (!cancelled) setDraftCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [statusFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await listApplications({
        status: statusFilter,
        q: search.trim() || undefined,
        page,
        pageSize,
      });
      setItems(result.items);
      setTotal(result.total);
      setLoadedFilter(statusFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load applications");
      setItems([]);
      setTotal(0);
      setLoadedFilter(statusFilter);
    } finally {
      setLoading(false);
    }
  }, [page, search, statusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, search]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="admissions-staff-page">
      <header className="admissions-staff-header">
        <div className="admissions-staff-header-main">
          <h1 className="page-title">Admissions</h1>
          <p className="admissions-staff-subtitle">
            Review applications and enrol accepted learners into EduClear.
          </p>
        </div>
      </header>

      <div className="admissions-staff-filters">
        <label className="admissions-staff-filter">
          <span className="admissions-staff-filter-label">Status</span>
          <select
            className="admissions-staff-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="admissions-staff-filter">
          <span className="admissions-staff-filter-label">Search</span>
          <input
            type="search"
            className="admissions-staff-input"
            placeholder="Application no., learner, guardian…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search applications"
          />
        </label>
      </div>

      {viewingDrafts ? (
        <div
          className="admissions-staff-alert admissions-staff-alert--info"
          data-testid="admissions-drafts-notice"
        >
          Drafts are applications a parent started but has not submitted. They are not admissions,
          have no application number, and are not counted in your submitted applications. Only the
          parent can complete and submit a draft, on the device they started it on.
        </div>
      ) : draftCount != null && draftCount > 0 ? (
        <div
          className="admissions-staff-alert admissions-staff-alert--info"
          data-testid="admissions-drafts-count"
        >
          <span>
            {draftCount} incomplete draft{draftCount === 1 ? "" : "s"} not yet submitted by
            parents (not included below).
          </span>
          <button
            type="button"
            className="admissions-staff-btn admissions-staff-btn--outline"
            onClick={() => setStatusFilter(DRAFT_STATUS)}
          >
            View drafts
          </button>
        </div>
      ) : null}

      {error ? <div className="admissions-staff-alert admissions-staff-alert--error">{error}</div> : null}

      <div className="admissions-staff-table-card">
        {loading || loadedFilter !== statusFilter ? (
          <div className="admissions-staff-loading">Loading applications…</div>
        ) : items.length === 0 ? (
          <div className="admissions-staff-empty">
            {viewingDrafts ? "No incomplete drafts." : "No applications match your filters."}
          </div>
        ) : viewingDrafts ? (
          <>
            <table className="admissions-staff-table" data-testid="admissions-drafts-table">
              <thead>
                <tr>
                  <th scope="col">Draft</th>
                  <th scope="col">Learner</th>
                  <th scope="col">Grade</th>
                  <th scope="col">Primary guardian</th>
                  <th scope="col">Status</th>
                  <th scope="col">Started</th>
                  <th scope="col">Last saved</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr
                    key={row.id}
                    className="admissions-staff-table-row"
                    tabIndex={0}
                    onClick={() => onOpenApplication(row.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpenApplication(row.id);
                      }
                    }}
                  >
                    <td>{row.id.slice(0, 8)}</td>
                    <td>{learnerName(row)}</td>
                    <td>{row.requestedGrade || "—"}</td>
                    <td>{row.primaryGuardianName || "—"}</td>
                    <td>
                      <AdmissionsStatusBadge status={row.status} />
                    </td>
                    <td>{formatDateTime(row.createdAt)}</td>
                    <td>{row.lastSavedAt ? formatDateTime(row.lastSavedAt) : "Not saved yet"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="admissions-staff-pagination">
              <span>
                {total} draft{total === 1 ? "" : "s"} (not submitted)
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="admissions-staff-btn admissions-staff-btn--outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <span style={{ alignSelf: "center", fontSize: "0.86rem" }}>
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  className="admissions-staff-btn admissions-staff-btn--outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <table className="admissions-staff-table">
              <thead>
                <tr>
                  <th scope="col">Application</th>
                  <th scope="col">Learner</th>
                  <th scope="col">Grade</th>
                  <th scope="col">Status</th>
                  <th scope="col">Payment</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Enrolment</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const enrolHint = getEnrolmentStatusLabel(row.status, row.promotedLearnerId);
                  return (
                    <tr
                      key={row.id}
                      className="admissions-staff-table-row"
                      tabIndex={0}
                      onClick={() => onOpenApplication(row.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenApplication(row.id);
                        }
                      }}
                    >
                      <td>{row.applicationNumber || row.id.slice(0, 8)}</td>
                      <td>{learnerName(row)}</td>
                      <td>{row.requestedGrade || "—"}</td>
                      <td>
                        <AdmissionsStatusBadge status={row.status} />
                      </td>
                      <td>{paymentLabel(row)}</td>
                      <td>{formatDate(row.submittedAt)}</td>
                      <td>
                        {enrolHint ? (
                          <span
                            className={`admissions-staff-enrol-hint ${
                              row.promotedLearnerId ? "admissions-staff-enrol-hint--done" : ""
                            }`}
                          >
                            {enrolHint}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="admissions-staff-pagination">
              <span>
                {total} application{total === 1 ? "" : "s"}
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="admissions-staff-btn admissions-staff-btn--outline"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <span style={{ alignSelf: "center", fontSize: "0.86rem" }}>
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  className="admissions-staff-btn admissions-staff-btn--outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
