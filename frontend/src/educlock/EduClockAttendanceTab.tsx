import { useCallback, useEffect, useState } from "react";
import {
  fetchOwnerEduClockAttendance,
  postOwnerCancelStaffAbsence,
  type EduClockAttendanceResponse,
} from "./educlockApi";
import EduClockCorrectionDialog from "./EduClockCorrectionDialog";
import {
  canOfferAttendanceCorrection,
  displayAttendanceDuration,
  isAbsentReportedStatus,
  targetFromAttendanceRow,
  type EduClockCorrectionTarget,
} from "./educlockCorrectionUi";
import { EduClockBadge } from "./educlockOwnerUi";
import {
  absenceApprovalLabel,
  absenceReasonLabel,
  absenceSourceLabel,
} from "./educlockAbsenceUi";

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
  const [inspectRow, setInspectRow] = useState<Record<string, unknown> | null>(null);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelSaving, setCancelSaving] = useState(false);
  const [cancelError, setCancelError] = useState("");

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
          <option value="MISSING_CLOCK_IN">Missing Clock In</option>
          <option value="ABSENT_REPORTED">Absent Reported</option>
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
              {(data?.rows || []).map((row) => {
                const absent = isAbsentReportedStatus(row.currentStatus) || isAbsentReportedStatus(row.shiftStatus);
                return (
                <tr key={String(row.employeeId)} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ padding: "12px 8px" }}>{String(row.employeeName)}</td>
                  <td style={{ padding: "12px 8px" }}>{String(row.employeeNumber || "—")}</td>
                  <td style={{ padding: "12px 8px" }}>
                    {absent ? (
                      <EduClockBadge
                        label={String(row.currentStatus)}
                        tone="violet"
                        title="Staff self-reported absence"
                      />
                    ) : (
                      <span>
                        {String(row.currentStatus)}
                        {row.offPremises ? (
                          <>
                            {" "}
                            <EduClockBadge
                              label="Off Premises"
                              tone="teal"
                              title="Temporary departure; still clocked in"
                            />
                          </>
                        ) : null}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "12px 8px" }}>{String(row.clockInTime || "—")}</td>
                  <td style={{ padding: "12px 8px" }}>{String(row.clockOutTime || "—")}</td>
                  <td style={{ padding: "12px 8px" }}>{displayAttendanceDuration(row)}</td>
                  <td style={{ padding: "12px 8px" }}>{String(row.shiftStatus)}</td>
                  <td style={{ padding: "12px 8px" }}>
                    {absent ? absenceSourceLabel(row.source) : String(row.source || "—")}
                  </td>
                  <td style={{ padding: "12px 8px" }}>
                    {String(row.correctionStatus) === "Manually Corrected" ? (
                      <EduClockBadge label="Corrected" tone="amber" title="Owner-corrected attendance" />
                    ) : (
                      String(row.correctionStatus)
                    )}
                  </td>
                  <td style={{ padding: "12px 8px" }}>
                    {absent ? (
                      <button
                        type="button"
                        onClick={() => {
                          setInspectRow(row);
                          setCancelConfirm(false);
                          setCancelError("");
                        }}
                      >
                        View absence
                      </button>
                    ) : canOfferAttendanceCorrection(row.currentStatus) ? (
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
                    ) : null}
                  </td>
                </tr>
                );
              })}
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

      {inspectRow ? (
        <section
          style={{
            marginTop: 16,
            padding: 16,
            border: "1px solid #ddd6fe",
            borderRadius: 12,
            background: "#f5f3ff",
            maxWidth: 640,
          }}
        >
          {(() => {
            const absence = (inspectRow.absence || {}) as Record<string, unknown>;
            const active = String(absence.approvalStatus || "") === "REPORTED";
            return (
              <>
                <h3 style={{ margin: 0, fontSize: 16, color: "#5b21b6" }}>Absence report</h3>
                <dl style={{ margin: "12px 0 0", display: "grid", gap: 8 }}>
                  <div>
                    <dt style={{ fontSize: 12, color: "#64748b" }}>Employee</dt>
                    <dd style={{ margin: 0, fontWeight: 700 }}>{String(inspectRow.employeeName)}</dd>
                  </div>
                  <div>
                    <dt style={{ fontSize: 12, color: "#64748b" }}>Date</dt>
                    <dd style={{ margin: 0 }}>
                      {String(inspectRow.affectedSchoolLocalDate || data?.schoolLocalDate || date)}
                    </dd>
                  </div>
                  <div>
                    <dt style={{ fontSize: 12, color: "#64748b" }}>Reason</dt>
                    <dd style={{ margin: 0 }}>{absenceReasonLabel(absence.reason)}</dd>
                  </div>
                  <div>
                    <dt style={{ fontSize: 12, color: "#64748b" }}>Note</dt>
                    <dd style={{ margin: 0 }}>{String(absence.note || "—")}</dd>
                  </div>
                  <div>
                    <dt style={{ fontSize: 12, color: "#64748b" }}>Reported at</dt>
                    <dd style={{ margin: 0 }}>
                      {String(absence.reportedTimeDisplay || absence.reportedAtUtc || "—")}
                    </dd>
                  </div>
                  <div>
                    <dt style={{ fontSize: 12, color: "#64748b" }}>Source</dt>
                    <dd style={{ margin: 0 }}>{absenceSourceLabel(absence.source)}</dd>
                  </div>
                  <div>
                    <dt style={{ fontSize: 12, color: "#64748b" }}>Approval status</dt>
                    <dd style={{ margin: 0 }}>{absenceApprovalLabel(absence.approvalStatus)}</dd>
                  </div>
                </dl>
                {cancelError ? (
                  <p role="alert" style={{ color: "#b91c1c", marginTop: 10 }}>
                    {cancelError}
                  </p>
                ) : null}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
                  {active && !cancelConfirm ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCancelConfirm(true);
                        setCancelError("");
                      }}
                    >
                      Cancel Absence Report
                    </button>
                  ) : null}
                  {active && cancelConfirm ? (
                    <>
                      <span style={{ fontSize: 13, color: "#5b21b6" }}>
                        Clear this reported absence for attendance correction? This does not create a
                        clock-in.
                      </span>
                      <button
                        type="button"
                        disabled={cancelSaving || !absence.id}
                        onClick={() => {
                          void (async () => {
                            setCancelSaving(true);
                            setCancelError("");
                            try {
                              await postOwnerCancelStaffAbsence({
                                absenceId: String(absence.id),
                              });
                              setInspectRow(null);
                              setCancelConfirm(false);
                              await reload();
                            } catch (err: unknown) {
                              setCancelError(
                                err instanceof Error ? err.message : "Failed to cancel absence"
                              );
                            } finally {
                              setCancelSaving(false);
                            }
                          })();
                        }}
                      >
                        {cancelSaving ? "Cancelling…" : "Confirm cancel"}
                      </button>
                      <button
                        type="button"
                        disabled={cancelSaving}
                        onClick={() => setCancelConfirm(false)}
                      >
                        Keep report
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    disabled={cancelSaving}
                    onClick={() => {
                      setInspectRow(null);
                      setCancelConfirm(false);
                      setCancelError("");
                    }}
                  >
                    Close
                  </button>
                </div>
              </>
            );
          })()}
        </section>
      ) : null}

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
