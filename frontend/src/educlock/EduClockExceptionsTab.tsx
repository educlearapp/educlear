import { useCallback, useEffect, useState } from "react";
import { fetchOwnerEduClockExceptions } from "./educlockApi";
import { friendlyReadinessLabel } from "./educlockOwnerUi";

const EXCEPTION_LABELS: Record<string, string> = {
  MISSING_CLOCK_OUT: "Missing Clock Out",
  DUPLICATE_CLOCK_ATTEMPT: "Duplicate Clock Attempt",
  INVALID_EVENT_SEQUENCE: "Invalid Event Sequence",
  MANUAL_CORRECTION: "Manual Correction",
  ACTIVATION_BLOCKED: "Activation Blocked",
  OPEN: "Open",
  RESOLVED: "Resolved",
};

export default function EduClockExceptionsTab(props: {
  emptyTitle?: string;
  emptyBody?: string;
} = {}) {
  const emptyTitle = props.emptyTitle || "No attendance exceptions.";
  const emptyBody =
    props.emptyBody || "Exceptions will appear automatically when required.";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState("OPEN");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchOwnerEduClockExceptions({
        schoolLocalDate: date || undefined,
        status: status === "ALL" ? "ALL" : status,
        page,
        pageSize: 25,
      });
      setRows(data.rows || []);
      setTotal(Number(data.total || 0));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load exceptions");
    } finally {
      setLoading(false);
    }
  }, [date, status, page]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const pageCount = Math.max(1, Math.ceil(total / 25));

  return (
    <div>
      <p style={{ color: "#64748b", maxWidth: 800 }}>
        Lifecycle exceptions for Build 3 (Missing Clock Out, duplicates, invalid sequence, manual
        corrections, activation blocked). GPS exceptions are not included yet.
      </p>
      {error ? (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {error}
        </p>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <input
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setPage(0);
          }}
          style={{ padding: 8 }}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
          style={{ padding: 8 }}
        >
          <option value="OPEN">Open</option>
          <option value="RESOLVED">Resolved</option>
          <option value="ALL">All</option>
        </select>
        <button type="button" onClick={() => void reload()}>
          Refresh
        </button>
      </div>
      {loading ? (
        <p style={{ marginTop: 16 }}>Loading…</p>
      ) : rows.length === 0 ? (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            background: "#fff",
            maxWidth: 720,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16 }}>{emptyTitle}</h3>
          <p style={{ marginTop: 8, color: "#64748b", lineHeight: 1.5 }}>{emptyBody}</p>
        </div>
      ) : (
        <div style={{ overflowX: "auto", marginTop: 12, WebkitOverflowScrolling: "touch" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #e5e7eb" }}>
                <th style={{ padding: "12px 8px" }}>Employee</th>
                <th style={{ padding: "12px 8px" }}>Number</th>
                <th style={{ padding: "12px 8px" }}>Date</th>
                <th style={{ padding: "12px 8px" }}>Type</th>
                <th style={{ padding: "12px 8px" }}>Details</th>
                <th style={{ padding: "12px 8px" }}>Status</th>
                <th style={{ padding: "12px 8px" }}>Resolved by</th>
                <th style={{ padding: "12px 8px" }}>Resolved at</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.id)} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "12px 8px" }}>{String(row.employeeName)}</td>
                  <td style={{ padding: "12px 8px" }}>{String(row.employeeNumber || "—")}</td>
                  <td style={{ padding: "12px 8px" }}>{String(row.schoolLocalDate)}</td>
                  <td style={{ padding: "12px 8px" }}>
                    {EXCEPTION_LABELS[String(row.exceptionType)] ||
                      friendlyReadinessLabel(String(row.exceptionType))}
                  </td>
                  <td style={{ padding: "12px 8px" }}>{String(row.details)}</td>
                  <td style={{ padding: "12px 8px" }}>
                    {EXCEPTION_LABELS[String(row.status)] || String(row.status)}
                  </td>
                  <td style={{ padding: "12px 8px" }}>{String(row.resolvedByUserId || "—")}</td>
                  <td style={{ padding: "12px 8px" }}>{String(row.resolvedAt || "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button type="button" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
          Previous
        </button>
        <span style={{ fontSize: 13 }}>
          Page {page + 1} / {pageCount}
        </span>
        <button
          type="button"
          disabled={page + 1 >= pageCount}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
