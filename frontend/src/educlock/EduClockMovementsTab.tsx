import { useCallback, useEffect, useState } from "react";
import {
  fetchOwnerEduClockMovements,
  ownerMovementsCsvUrl,
  postOwnerCancelStaffMovement,
  postOwnerReturnStaffMovement,
} from "./educlockApi";
import { staffAuthHeaders } from "../auth/staffAuthHeaders";
import { EduClockBadge } from "./educlockOwnerUi";
import {
  STAFF_MOVEMENT_REASON_LABELS,
  STAFF_MOVEMENT_REASONS,
  formatElapsedAwayMs,
  movementReasonLabel,
  movementStatusLabel,
} from "./educlockMovementUi";

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" });
}

export default function EduClockMovementsTab() {
  const [startDate, setStartDate] = useState(todayIso);
  const [endDate, setEndDate] = useState(todayIso);
  const [employee, setEmployee] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("ALL");
  const [department, setDepartment] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [busyId, setBusyId] = useState("");
  const [tickMs, setTickMs] = useState(Date.now());

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchOwnerEduClockMovements({
        startDate,
        endDate,
        employee: employee.trim() || undefined,
        reason: reason || undefined,
        status: status === "ALL" ? undefined : status,
        department: department.trim() || undefined,
        page,
        pageSize: 25,
      });
      setData(next);
      setError("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load movements");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, employee, reason, status, department, page]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const id = window.setInterval(() => setTickMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const live = (data?.live || { count: 0, rows: [] }) as {
    count: number;
    rows: Array<Record<string, unknown>>;
  };
  const history = (data?.history || { total: 0, page: 0, pageSize: 25, rows: [] }) as {
    total: number;
    page: number;
    pageSize: number;
    rows: Array<Record<string, unknown>>;
  };
  const pageCount = Math.max(1, Math.ceil(Number(history.total || 0) / Number(history.pageSize || 25)));

  function liveElapsed(row: Record<string, unknown>): string {
    const departed = Date.parse(String(row.departedAtUtc || ""));
    if (!Number.isFinite(departed)) return String(row.elapsedAwayDisplay || "—");
    return formatElapsedAwayMs(Math.max(0, tickMs - departed));
  }

  async function onReturn(id: string) {
    if (!window.confirm("Mark this employee as returned?")) return;
    setBusyId(id);
    try {
      await postOwnerReturnStaffMovement({ movementId: id });
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to mark returned");
    } finally {
      setBusyId("");
    }
  }

  async function onCancel(id: string) {
    if (!window.confirm("Cancel this open movement? Original departure details will be kept.")) return;
    setBusyId(id);
    try {
      await postOwnerCancelStaffMovement({ movementId: id });
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to cancel movement");
    } finally {
      setBusyId("");
    }
  }

  async function onExportCsv() {
    try {
      const url = ownerMovementsCsvUrl({
        startDate,
        endDate,
        employee: employee.trim() || undefined,
        reason: reason || undefined,
        status: status === "ALL" ? undefined : status,
        department: department.trim() || undefined,
      });
      const res = await fetch(url, { headers: { ...staffAuthHeaders() } });
      if (!res.ok) throw new Error("CSV export failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `educlock-movement-register-${startDate}-to-${endDate}.csv`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "CSV export failed");
    }
  }

  return (
    <div>
      <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16 }}>
        <h3 style={{ margin: 0 }}>Staff Off Premises</h3>
        <p className="teacher-muted" style={{ marginTop: 6 }}>
          Live open movements. Attendance remains Clocked In.
        </p>
        {live.rows.length === 0 ? (
          <p style={{ marginTop: 12, color: "#64748b" }}>No staff currently off premises.</p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#64748b" }}>
                  <th style={{ padding: "8px 6px" }}>Employee</th>
                  <th style={{ padding: "8px 6px" }}>Time left</th>
                  <th style={{ padding: "8px 6px" }}>Reason</th>
                  <th style={{ padding: "8px 6px" }}>Destination</th>
                  <th style={{ padding: "8px 6px" }}>Elapsed</th>
                  <th style={{ padding: "8px 6px" }} />
                </tr>
              </thead>
              <tbody>
                {live.rows.map((row) => (
                  <tr key={String(row.id)} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "10px 6px" }}>
                      {String(row.employeeName || "—")}
                      <div style={{ fontSize: 12, color: "#64748b" }}>{String(row.employeeNumber || "")}</div>
                    </td>
                    <td style={{ padding: "10px 6px" }}>{String(row.departedTimeDisplay || "—")}</td>
                    <td style={{ padding: "10px 6px" }}>{movementReasonLabel(row.reason)}</td>
                    <td style={{ padding: "10px 6px" }}>{String(row.destination || "—")}</td>
                    <td style={{ padding: "10px 6px", fontWeight: 700 }}>{liveElapsed(row)}</td>
                    <td style={{ padding: "10px 6px" }}>
                      <button
                        type="button"
                        disabled={busyId === String(row.id)}
                        onClick={() => void onReturn(String(row.id))}
                      >
                        Return
                      </button>{" "}
                      <button
                        type="button"
                        disabled={busyId === String(row.id)}
                        onClick={() => void onCancel(String(row.id))}
                      >
                        Cancel
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0 }}>History</h3>
          <button type="button" onClick={() => void onExportCsv()}>
            Export CSV
          </button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          <label>
            From
            <input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPage(0); }} />
          </label>
          <label>
            To
            <input type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPage(0); }} />
          </label>
          <input
            placeholder="Employee"
            value={employee}
            onChange={(e) => { setEmployee(e.target.value); setPage(0); }}
          />
          <select value={reason} onChange={(e) => { setReason(e.target.value); setPage(0); }}>
            <option value="">All reasons</option>
            {STAFF_MOVEMENT_REASONS.map((code) => (
              <option key={code} value={code}>
                {STAFF_MOVEMENT_REASON_LABELS[code]}
              </option>
            ))}
          </select>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
            <option value="ALL">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="RETURNED">Returned</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <input
            placeholder="Department"
            value={department}
            onChange={(e) => { setDepartment(e.target.value); setPage(0); }}
          />
        </div>
        {error ? <p className="teacher-error">{error}</p> : null}
        {loading ? (
          <p>Loading…</p>
        ) : history.rows.length === 0 ? (
          <p style={{ marginTop: 12, color: "#64748b" }}>No movement records for these filters.</p>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 12 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#64748b" }}>
                  <th style={{ padding: "8px 6px" }}>Date</th>
                  <th style={{ padding: "8px 6px" }}>Employee</th>
                  <th style={{ padding: "8px 6px" }}>Departure</th>
                  <th style={{ padding: "8px 6px" }}>Return</th>
                  <th style={{ padding: "8px 6px" }}>Duration</th>
                  <th style={{ padding: "8px 6px" }}>Reason</th>
                  <th style={{ padding: "8px 6px" }}>Destination</th>
                  <th style={{ padding: "8px 6px" }}>Note</th>
                  <th style={{ padding: "8px 6px" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {history.rows.map((row) => (
                  <tr key={String(row.id)} style={{ borderTop: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "10px 6px" }}>{String(row.schoolLocalDate || "—")}</td>
                    <td style={{ padding: "10px 6px" }}>{String(row.employeeName || "—")}</td>
                    <td style={{ padding: "10px 6px" }}>{String(row.departedTimeDisplay || "—")}</td>
                    <td style={{ padding: "10px 6px" }}>{String(row.returnedTimeDisplay || "—")}</td>
                    <td style={{ padding: "10px 6px" }}>{String(row.durationAwayDisplay || "—")}</td>
                    <td style={{ padding: "10px 6px" }}>{movementReasonLabel(row.reason)}</td>
                    <td style={{ padding: "10px 6px" }}>{String(row.destination || "—")}</td>
                    <td style={{ padding: "10px 6px" }}>{String(row.note || "—")}</td>
                    <td style={{ padding: "10px 6px" }}>
                      <EduClockBadge label={movementStatusLabel(row.status)} tone={row.status === "OPEN" ? "orange" : "grey"} />
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
      </section>
    </div>
  );
}
