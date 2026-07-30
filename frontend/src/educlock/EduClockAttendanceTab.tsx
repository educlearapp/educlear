import { useCallback, useEffect, useState } from "react";
import {
  fetchOwnerEduClockAttendance,
  postOwnerEduClockCorrection,
  type EduClockAttendanceResponse,
} from "./educlockApi";

const CORRECTION_REASONS = [
  "Employee forgot to clock in",
  "Employee forgot to clock out",
  "Device unavailable",
  "Network issue",
  "Owner-approved correction",
  "Other",
];

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
  const [correctRow, setCorrectRow] = useState<Record<string, unknown> | null>(null);
  const [reason, setReason] = useState(CORRECTION_REASONS[0]);
  const [note, setNote] = useState("");
  const [corrTime, setCorrTime] = useState("16:00");
  const [corrAction, setCorrAction] = useState<"CLOSE_OPEN_SHIFT" | "ADD_CLOCK_IN" | "ADD_CLOCK_OUT">(
    "CLOSE_OPEN_SHIFT"
  );
  const [saving, setSaving] = useState(false);

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

  async function submitCorrection() {
    if (!correctRow || !data) return;
    setSaving(true);
    setError("");
    try {
      await postOwnerEduClockCorrection({
        employeeId: String(correctRow.employeeId),
        action: corrAction,
        reason,
        note: reason === "Other" ? note : note || null,
        schoolLocalDate: data.schoolLocalDate,
        schoolLocalTime: corrTime,
      });
      setCorrectRow(null);
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Correction failed");
    } finally {
      setSaving(false);
    }
  }

  const pageCount = Math.max(1, Math.ceil(Number(data?.total || 0) / 25));

  return (
    <div>
      <p style={{ color: "#64748b", maxWidth: 800 }}>
        Daily attendance board (school-local date). Official times are server-created. No GPS
        enforcement in this build.
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
                  <td style={{ padding: "12px 8px" }}>{String(row.workedDuration || "—")}</td>
                  <td style={{ padding: "12px 8px" }}>{String(row.shiftStatus)}</td>
                  <td style={{ padding: "12px 8px" }}>{String(row.source || "—")}</td>
                  <td style={{ padding: "12px 8px" }}>{String(row.correctionStatus)}</td>
                  <td style={{ padding: "12px 8px" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setCorrectRow(row);
                        setCorrAction(
                          row.currentStatus === "Missing Clock Out" ||
                            row.currentStatus === "Clocked In"
                            ? "CLOSE_OPEN_SHIFT"
                            : "ADD_CLOCK_OUT"
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

      {correctRow ? (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            background: "#fff",
            maxWidth: 520,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Manual correction</h3>
          <p style={{ fontSize: 13, color: "#64748b" }}>
            {String(correctRow.employeeName)} · Original events are preserved (append-only).
          </p>
          <div style={{ display: "grid", gap: 8 }}>
            <select value={corrAction} onChange={(e) => setCorrAction(e.target.value as typeof corrAction)}>
              <option value="CLOSE_OPEN_SHIFT">Close open shift (add Clock Out)</option>
              <option value="ADD_CLOCK_IN">Add missing Clock In</option>
              <option value="ADD_CLOCK_OUT">Add missing Clock Out</option>
            </select>
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {CORRECTION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input
              type="time"
              value={corrTime}
              onChange={(e) => setCorrTime(e.target.value)}
              style={{ padding: 8 }}
            />
            <textarea
              placeholder={reason === "Other" ? "Note required" : "Optional note"}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" disabled={saving} onClick={() => void submitCorrection()}>
                {saving ? "Saving…" : "Save correction"}
              </button>
              <button type="button" onClick={() => setCorrectRow(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
