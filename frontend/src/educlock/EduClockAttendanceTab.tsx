import { useCallback, useEffect, useState } from "react";
import {
  fetchOwnerEduClockAttendance,
  type EduClockAttendanceResponse,
} from "./educlockApi";
import EduClockCorrectionDialog from "./EduClockCorrectionDialog";
import {
  displayAttendanceDuration,
  targetFromAttendanceRow,
  type EduClockCorrectionTarget,
} from "./educlockCorrectionUi";
import { EduClockBadge } from "./educlockOwnerUi";

export default function EduClockAttendanceTab(props: {
  emptyTitle?: string;
  emptyBody?: string;
} = {}) {
  const emptyTitle = props.emptyTitle || "No attendance yet.";
  const emptyBody =
    props.emptyBody || "Attendance will appear once staff begin clocking in.";
  const [data, setData] = useState<EduClockAttendanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [date, setDate] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [page, setPage] = useState(0);
  const [correctTarget, setCorrectTarget] = useState<EduClockCorrectionTarget | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetchOwnerEduClockAttendance({
        schoolLocalDate: date || undefined,
        search: search || undefined,
        status: status === "ALL" ? undefined : status,
        page,
        pageSize: 25,
      });
      setData(res);
      if (!date && res.schoolLocalDate) setDate(res.schoolLocalDate);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load attendance");
    } finally {
      setLoading(false);
    }
  }, [date, search, status, page]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const pageCount = Math.max(1, Math.ceil(Number(data?.total || 0) / 25));

  return (
    <div>
      <p style={{ color: "#64748b", maxWidth: 800 }}>
        Daily attendance board (school-local date). Official times are server-created.
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
        <input
          placeholder="Search name or number"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          style={{ minWidth: 180, padding: 8 }}
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
          style={{ padding: 8 }}
        >
          <option value="ALL">All statuses</option>
          <option value="NOT_CLOCKED_IN">Not Clocked In</option>
          <option value="CLOCKED_IN">Clocked In</option>
          <option value="CLOCKED_OUT">Clocked Out</option>
          <option value="MISSING_CLOCK_OUT">Missing Clock Out</option>
          <option value="MANUALLY_CORRECTED">Manually Corrected</option>
          <option value="INACTIVE">Inactive</option>
        </select>
        <button type="button" onClick={() => void reload()}>
          Refresh
        </button>
      </div>

      {data ? (
        <p style={{ fontSize: 13, color: "#64748b", marginTop: 8 }}>
          School-local date {data.schoolLocalDate} · {data.timezone}
        </p>
      ) : null}

      {loading ? (
        <p style={{ marginTop: 16 }}>Loading…</p>
      ) : !(data?.rows || []).length ? (
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
                <th style={{ padding: "12px 8px" }}>Status</th>
                <th style={{ padding: "12px 8px" }}>In</th>
                <th style={{ padding: "12px 8px" }}>Out</th>
                <th style={{ padding: "12px 8px" }}>Duration</th>
                <th style={{ padding: "12px 8px" }}>Shift</th>
                <th style={{ padding: "12px 8px" }}>Source</th>
                <th style={{ padding: "12px 8px" }}>Correction</th>
                <th style={{ padding: "12px 8px" }} />
              </tr>
            </thead>
            <tbody>
              {(data?.rows || []).map((row) => (
                <tr key={String(row.employeeId)} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "12px 8px" }}>{String(row.employeeName)}</td>
                  <td style={{ padding: "12px 8px" }}>{String(row.employeeNumber || "—")}</td>
                  <td style={{ padding: "12px 8px" }}>{String(row.currentStatus)}</td>
                  <td style={{ padding: "12px 8px" }}>{String(row.clockInTime || "—")}</td>
                  <td style={{ padding: "12px 8px" }}>{String(row.clockOutTime || "—")}</td>
                  <td style={{ padding: "12px 8px" }}>{displayAttendanceDuration(row)}</td>
                  <td style={{ padding: "12px 8px" }}>{String(row.shiftStatus)}</td>
                  <td style={{ padding: "12px 8px" }}>{String(row.source || "—")}</td>
                  <td style={{ padding: "12px 8px" }}>
                    {String(row.correctionStatus) === "Manually Corrected" ? (
                      <EduClockBadge label="Corrected" tone="amber" title="Owner-corrected attendance" />
                    ) : (
                      String(row.correctionStatus)
                    )}
                  </td>
                  <td style={{ padding: "12px 8px" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setCorrectTarget(
                          targetFromAttendanceRow(row, String(data?.schoolLocalDate || date))
                        );
                      }}
                    >
                      Correct
                    </button>
                  </td>
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

      {correctTarget ? (
        <EduClockCorrectionDialog
          target={correctTarget}
          onClose={() => setCorrectTarget(null)}
          onSaved={async () => {
            setCorrectTarget(null);
            await reload();
          }}
        />
      ) : null}
    </div>
  );
}
