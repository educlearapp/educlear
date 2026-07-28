import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api";
import {
  ATTENDANCE_PERIOD_OPTIONS,
  DEFAULT_ATTENDANCE_PERIOD,
  type AttendancePeriodValue,
} from "./periodOptions";
import {
  emptyStateMessage,
  fridayOfWeek,
  mondayOfWeek,
  monthBounds,
  resolveAttendanceReportRange,
  sundayOfWeek,
  type AttendanceRegisterKind,
  type AttendanceReportPayload,
} from "./attendanceReportCatalog";
import AttendanceRegisterReportView from "./AttendanceRegisterReportView";
import { downloadAttendanceReportExcel } from "./buildAttendanceReportExcel";
import { downloadAttendanceReportPdf } from "./buildAttendanceReportPdf";
import type { AttendanceExportView } from "./attendanceReportFileName";
import {
  buildClassroomSummaries,
  computeReportTotals,
  filterReportLearners,
  flattenAttendanceHistory,
  formatHeadlineAttendancePercentage,
  type AttendanceStatusFilter,
} from "./attendanceReportSummaries";

const GOLD = "#d4af37";
const NAVY = "#0f172a";

export type AttendanceReportViewMode =
  | "daily"
  | "weekly"
  | "monthly"
  | "learner"
  | "classroom_summary"
  | "school_summary";

type ClassroomOption = { name: string; learnerCount: number };

type Props = {
  schoolId: string;
  schoolName?: string;
  classrooms?: ClassroomOption[];
  onOpenCapture?: () => void;
};

const VIEW_OPTIONS: Array<{ value: AttendanceReportViewMode; label: string }> = [
  { value: "daily", label: "Daily class register" },
  { value: "weekly", label: "Weekly attendance register" },
  { value: "monthly", label: "Monthly attendance register" },
  { value: "learner", label: "Individual learner history" },
  { value: "classroom_summary", label: "Classroom summary" },
  { value: "school_summary", label: "Whole-school summary" },
];

const STATUS_OPTIONS: AttendanceStatusFilter[] = [
  "All",
  "Present",
  "Absent",
  "Late",
  "Excused",
  "Not Captured",
];

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(15,23,42,0.15)",
  fontWeight: 700,
  fontSize: 14,
  color: NAVY,
  background: "#fff",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 6,
  fontSize: 12,
  fontWeight: 800,
  color: "#64748b",
  letterSpacing: 0.3,
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid rgba(15,23,42,0.10)",
  borderTop: `4px solid ${GOLD}`,
  borderRadius: 14,
  boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
  padding: 18,
};

const btnBase: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid rgba(15,23,42,0.12)",
  fontWeight: 800,
  cursor: "pointer",
  fontSize: 13,
};

const goldBtn: React.CSSProperties = {
  ...btnBase,
  background: GOLD,
  color: NAVY,
  borderColor: GOLD,
};

const navyBtn: React.CSSProperties = {
  ...btnBase,
  background: NAVY,
  color: "#fff",
};

const ghostBtn: React.CSSProperties = {
  ...btnBase,
  background: "#fff",
  color: NAVY,
};

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function viewToKind(view: AttendanceReportViewMode): AttendanceRegisterKind {
  if (view === "weekly") return "weekly";
  if (view === "monthly") return "monthly";
  return "daily";
}

function viewTitle(view: AttendanceReportViewMode): string {
  return VIEW_OPTIONS.find((v) => v.value === view)?.label || "Attendance Report";
}

function resolveRangeForView(
  view: AttendanceReportViewMode,
  anchorDate: string,
  customStart: string,
  customEnd: string,
  includeWeekends: boolean
): { startDate: string; endDate: string } {
  if (view === "learner" || view === "classroom_summary" || view === "school_summary") {
    const start = customStart || anchorDate;
    const end = customEnd || anchorDate;
    return start <= end ? { startDate: start, endDate: end } : { startDate: end, endDate: start };
  }
  return resolveAttendanceReportRange(viewToKind(view), anchorDate, includeWeekends);
}

export default function AttendanceReportsPage({
  schoolId,
  schoolName,
  classrooms: classroomsProp,
  onOpenCapture,
}: Props) {
  const [view, setView] = useState<AttendanceReportViewMode>("daily");
  const [anchorDate, setAnchorDate] = useState(todayYmd);
  const [customStart, setCustomStart] = useState(() => mondayOfWeek(todayYmd()));
  const [customEnd, setCustomEnd] = useState(() => fridayOfWeek(todayYmd()));
  const [period, setPeriod] = useState<AttendancePeriodValue>(DEFAULT_ATTENDANCE_PERIOD);
  const [classroom, setClassroom] = useState("All Classrooms");
  const [includeWeekends, setIncludeWeekends] = useState(false);
  const [learnerSearch, setLearnerSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AttendanceStatusFilter>("All");
  const [selectedLearnerId, setSelectedLearnerId] = useState("");
  const [classes, setClasses] = useState<ClassroomOption[]>(classroomsProp || []);
  const [report, setReport] = useState<AttendanceReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);

  useEffect(() => {
    if (classroomsProp?.length) {
      setClasses(classroomsProp);
      return;
    }
    if (!schoolId) return;
    void (async () => {
      try {
        const data: any = await apiFetch(
          `/api/attendance/classes?schoolId=${encodeURIComponent(schoolId)}`
        );
        if (data?.success && Array.isArray(data.classes)) {
          setClasses(data.classes);
        }
      } catch {
        /* keep empty class list */
      }
    })();
  }, [schoolId, classroomsProp]);

  const loadReport = useCallback(async () => {
    if (!schoolId) {
      setError("School is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const range = resolveRangeForView(
        view,
        anchorDate,
        customStart,
        customEnd,
        includeWeekends
      );
      const kind = viewToKind(view);
      const qs = new URLSearchParams({
        schoolId,
        startDate: range.startDate,
        endDate: range.endDate,
        period,
        includeWeekends: includeWeekends ? "true" : "false",
        groupBy: "classrooms",
        reportKind: kind,
      });
      if (classroom && classroom !== "All Classrooms") {
        qs.set("className", classroom);
      }
      const data: any = await apiFetch(`/api/attendance/report?${qs}`);
      if (!data?.success || !data?.report) {
        throw new Error(data?.error || "Could not load attendance report.");
      }
      setReport(data.report as AttendanceReportPayload);
    } catch (e: unknown) {
      setReport(null);
      setError(e instanceof Error ? e.message : "Failed to load attendance report.");
    } finally {
      setLoading(false);
    }
  }, [
    schoolId,
    view,
    anchorDate,
    customStart,
    customEnd,
    includeWeekends,
    period,
    classroom,
  ]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  useEffect(() => {
    if (view === "weekly") {
      setCustomStart(mondayOfWeek(anchorDate));
      setCustomEnd(includeWeekends ? sundayOfWeek(anchorDate) : fridayOfWeek(anchorDate));
    } else if (view === "monthly") {
      const bounds = monthBounds(anchorDate);
      setCustomStart(bounds.start);
      setCustomEnd(bounds.end);
    } else if (view === "daily") {
      setCustomStart(anchorDate);
      setCustomEnd(anchorDate);
    }
  }, [view, anchorDate, includeWeekends]);

  const filteredReport = useMemo(() => {
    if (!report) return null;
    return filterReportLearners(report, {
      learnerSearch: view === "learner" ? "" : learnerSearch,
      statusFilter: view === "classroom_summary" || view === "school_summary" ? "All" : statusFilter,
      learnerId: view === "learner" ? selectedLearnerId || null : null,
    });
  }, [report, learnerSearch, statusFilter, selectedLearnerId, view]);

  const learnerOptions = useMemo(() => {
    if (!report) return [];
    return [...report.learners].sort((a, b) =>
      a.fullName.localeCompare(b.fullName, undefined, { numeric: true })
    );
  }, [report]);

  useEffect(() => {
    if (view !== "learner") return;
    if (!selectedLearnerId && learnerOptions.length) {
      setSelectedLearnerId(learnerOptions[0].learnerId);
    }
  }, [view, selectedLearnerId, learnerOptions]);

  const totals = useMemo(
    () => computeReportTotals(filteredReport?.learners || []),
    [filteredReport]
  );
  const attendancePctLabel = formatHeadlineAttendancePercentage(totals);

  const classroomSummaries = useMemo(
    () => (filteredReport ? buildClassroomSummaries(filteredReport) : []),
    [filteredReport]
  );

  const historyRows = useMemo(
    () => (filteredReport && view === "learner" ? flattenAttendanceHistory(filteredReport) : []),
    [filteredReport, view]
  );

  const exportView: AttendanceExportView = view;
  const title = viewTitle(view);
  const kind = viewToKind(view);

  const runExcel = () => {
    if (!filteredReport) return;
    downloadAttendanceReportExcel(filteredReport, exportView, title);
  };

  const runPdf = () => {
    if (!filteredReport) return;
    downloadAttendanceReportPdf(filteredReport, exportView, title);
  };

  const runPrint = () => {
    if (!filteredReport) return;
    setPrintOpen(true);
    window.setTimeout(() => window.print(), 250);
  };

  const notice =
    filteredReport && (view === "daily" || view === "weekly" || view === "monthly")
      ? emptyStateMessage(kind, filteredReport.emptyState, filteredReport.learners.length > 0)
      : null;

  return (
    <div
      style={{
        padding: 26,
        background: "#f8fafc",
        minHeight: "100%",
        borderRadius: 20,
        border: "1px solid rgba(15,23,42,0.08)",
      }}
    >
      <style>{`
        @media print {
          .attendance-reports-no-print { display: none !important; }
          .attendance-reports-print-only { display: block !important; }
          body * { visibility: hidden; }
          .attendance-reports-print-root, .attendance-reports-print-root * { visibility: visible; }
          .attendance-reports-print-root {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            background: #fff;
            padding: 12px;
          }
        }
        .attendance-reports-print-only { display: none; }
        .attendance-reports-filter-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
        }
        .attendance-reports-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }
        .attendance-reports-totals {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 16px;
          align-items: stretch;
        }
        .attendance-summary-card {
          display: flex;
          flex-direction: column;
          justify-content: center;
          height: 108px;
          min-height: 108px;
          max-height: 108px;
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
          padding: 12px 12px 14px;
          border-radius: 12px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-top-width: 3px;
          background: #fff;
          box-shadow: 0 6px 14px rgba(15, 23, 42, 0.04);
          transition: transform 150ms ease, box-shadow 150ms ease;
        }
        @media (hover: hover) and (pointer: fine) {
          .attendance-summary-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(15, 23, 42, 0.09);
          }
        }
        .attendance-summary-card__label {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.2px;
          color: #64748b;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .attendance-summary-card__value {
          margin-top: 8px;
          font-size: 24px;
          font-weight: 900;
          line-height: 1.1;
          color: #0f172a;
        }
        .attendance-summary-card--learners {
          border-top-color: #d4af37;
          border-color: rgba(212, 175, 55, 0.40);
          background: #fffdf6;
        }
        .attendance-summary-card--learners .attendance-summary-card__value {
          color: #0f172a;
        }
        .attendance-summary-card--present {
          border-top-color: #6f9e7a;
          background: #f4faf6;
        }
        .attendance-summary-card--present .attendance-summary-card__value {
          color: #1f6b3a;
        }
        .attendance-summary-card--absent {
          border-top-color: #c07a7a;
          background: #faf5f5;
        }
        .attendance-summary-card--absent .attendance-summary-card__value {
          color: #9b2c2c;
        }
        .attendance-summary-card--late {
          border-top-color: #c49a6c;
          background: #fbf7f2;
        }
        .attendance-summary-card--late .attendance-summary-card__value {
          color: #9a5b1a;
        }
        .attendance-summary-card--excused {
          border-top-color: #7a92b3;
          background: #f4f7fb;
        }
        .attendance-summary-card--excused .attendance-summary-card__value {
          color: #2f4f7c;
        }
        .attendance-summary-card--not-captured {
          border-top-color: #94a3b8;
          background: #f5f7fa;
        }
        .attendance-summary-card--not-captured .attendance-summary-card__value {
          color: #475569;
        }
        .attendance-summary-card--rate {
          border: 2px solid #d4af37;
          border-top-width: 2px;
          background: #0b1c33;
          box-shadow: 0 8px 18px rgba(11, 28, 51, 0.16);
          justify-content: center;
        }
        .attendance-summary-card--rate .attendance-summary-card__label {
          color: rgba(255, 255, 255, 0.82);
        }
        .attendance-summary-card--rate .attendance-summary-card__subtitle {
          margin-top: 2px;
          font-size: 11px;
          font-weight: 700;
          color: #d4af37;
        }
        .attendance-summary-card--rate .attendance-summary-card__value {
          margin-top: 4px;
          font-size: 28px;
          color: #ffffff;
        }
        /* iPad / tablet */
        @media (max-width: 1100px) {
          .attendance-reports-totals {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
          .attendance-summary-card--rate {
            grid-column: span 1;
          }
        }
        /* Mobile */
        @media (max-width: 720px) {
          .attendance-reports-totals {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .attendance-summary-card--rate {
            grid-column: 1 / -1;
          }
          .attendance-summary-card--rate .attendance-summary-card__value {
            font-size: 32px;
          }
        }
        .attendance-reports-print-summary {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          margin-bottom: 16px;
          padding: 14px 16px;
          border-radius: 14px;
          border: 1px solid rgba(212, 175, 55, 0.35);
          background: #fbf8ef;
          box-shadow: 0 6px 14px rgba(15, 23, 42, 0.04);
          color: #0f172a;
        }
        .attendance-reports-print-summary__icon {
          flex: 0 0 auto;
          width: 32px;
          height: 32px;
          border-radius: 9px;
          display: grid;
          place-items: center;
          background: #0b1c33;
          color: #d4af37;
          font-size: 15px;
          font-weight: 900;
          line-height: 1;
        }
        .attendance-reports-print-summary__body {
          min-width: 0;
          flex: 1;
        }
        .attendance-reports-print-summary__title {
          margin: 0 0 4px;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.4px;
          text-transform: uppercase;
          color: #0b1c33;
        }
        .attendance-reports-print-summary__metrics {
          margin: 0;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.55;
          color: #334155;
        }
        .attendance-reports-print-summary__metrics strong {
          color: #0f172a;
          font-weight: 900;
        }
      `}</style>

      <div className="attendance-reports-no-print" style={{ marginBottom: 18 }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            alignItems: "flex-start",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b", letterSpacing: 0.4 }}>
              REPORTS
            </div>
            <h1 style={{ margin: "4px 0 0", fontSize: 32, fontWeight: 900, color: NAVY }}>
              Attendance Reports
            </h1>
            <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700, maxWidth: 640 }}>
              Export and print saved class registers for{" "}
              {schoolName || report?.meta.schoolName || "your school"}. Teachers capture attendance;
              principals report from these same records.
            </p>
          </div>
          <div className="attendance-reports-actions">
            {onOpenCapture ? (
              <button type="button" style={ghostBtn} onClick={onOpenCapture}>
                Open attendance capture
              </button>
            ) : null}
            <button type="button" style={ghostBtn} onClick={() => void loadReport()} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button type="button" style={goldBtn} onClick={runExcel} disabled={!filteredReport || loading}>
              Export Excel
            </button>
            <button type="button" style={navyBtn} onClick={runPdf} disabled={!filteredReport || loading}>
              Export PDF
            </button>
            <button type="button" style={ghostBtn} onClick={runPrint} disabled={!filteredReport || loading}>
              Print
            </button>
          </div>
        </div>
      </div>

      <div className="attendance-reports-no-print" style={{ ...cardStyle, marginBottom: 16 }}>
        <div className="attendance-reports-filter-grid">
          <div>
            <label style={labelStyle}>Report view</label>
            <select
              style={inputStyle}
              value={view}
              onChange={(e) => setView(e.target.value as AttendanceReportViewMode)}
            >
              {VIEW_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {(view === "daily" || view === "weekly" || view === "monthly") && (
            <div>
              <label style={labelStyle}>
                {view === "monthly" ? "Month" : view === "weekly" ? "Week of" : "Date"}
              </label>
              <input
                style={inputStyle}
                type={view === "monthly" ? "month" : "date"}
                value={
                  view === "monthly" ? anchorDate.slice(0, 7) : anchorDate
                }
                onChange={(e) => {
                  const v = e.target.value;
                  if (view === "monthly" && /^\d{4}-\d{2}$/.test(v)) {
                    setAnchorDate(`${v}-01`);
                  } else {
                    setAnchorDate(v);
                  }
                }}
              />
            </div>
          )}

          {(view === "learner" ||
            view === "classroom_summary" ||
            view === "school_summary") && (
            <>
              <div>
                <label style={labelStyle}>Start date</label>
                <input
                  style={inputStyle}
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
              </div>
              <div>
                <label style={labelStyle}>End date</label>
                <input
                  style={inputStyle}
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
              </div>
            </>
          )}

          <div>
            <label style={labelStyle}>Classroom</label>
            <select
              style={inputStyle}
              value={classroom}
              onChange={(e) => setClassroom(e.target.value)}
            >
              <option value="All Classrooms">All Classrooms</option>
              {classes.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.learnerCount})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={labelStyle}>Register type</label>
            <select
              style={inputStyle}
              value={period}
              onChange={(e) => setPeriod(e.target.value as AttendancePeriodValue)}
            >
              {ATTENDANCE_PERIOD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {view === "learner" ? (
            <div>
              <label style={labelStyle}>Learner</label>
              <select
                style={inputStyle}
                value={selectedLearnerId}
                onChange={(e) => setSelectedLearnerId(e.target.value)}
              >
                <option value="">Select learner</option>
                {learnerOptions.map((l) => (
                  <option key={l.learnerId} value={l.learnerId}>
                    {l.fullName} ({l.classroom})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label style={labelStyle}>Learner search</label>
              <input
                style={inputStyle}
                type="search"
                placeholder="Name or admission no."
                value={learnerSearch}
                onChange={(e) => setLearnerSearch(e.target.value)}
                disabled={view === "classroom_summary" || view === "school_summary"}
              />
            </div>
          )}

          <div>
            <label style={labelStyle}>Status</label>
            <select
              style={inputStyle}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as AttendanceStatusFilter)}
              disabled={view === "classroom_summary" || view === "school_summary"}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {(view === "weekly" || view === "monthly") && (
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <label
                style={{
                  ...labelStyle,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 12,
                  color: NAVY,
                }}
              >
                <input
                  type="checkbox"
                  checked={includeWeekends}
                  onChange={(e) => setIncludeWeekends(e.target.checked)}
                />
                Include weekends
              </label>
            </div>
          )}
        </div>
      </div>

      <div
        className="attendance-reports-no-print attendance-reports-totals"
        data-testid="attendance-report-summary-cards"
      >
        <div className="attendance-summary-card attendance-summary-card--learners">
          <div className="attendance-summary-card__label">Total Learners</div>
          <div className="attendance-summary-card__value">{totals.learnerCount}</div>
        </div>
        <div className="attendance-summary-card attendance-summary-card--present">
          <div className="attendance-summary-card__label">Present</div>
          <div className="attendance-summary-card__value">{totals.present}</div>
        </div>
        <div className="attendance-summary-card attendance-summary-card--absent">
          <div className="attendance-summary-card__label">Absent</div>
          <div className="attendance-summary-card__value">{totals.absent}</div>
        </div>
        <div className="attendance-summary-card attendance-summary-card--late">
          <div className="attendance-summary-card__label">Late</div>
          <div className="attendance-summary-card__value">{totals.late}</div>
        </div>
        <div className="attendance-summary-card attendance-summary-card--excused">
          <div className="attendance-summary-card__label">Excused</div>
          <div className="attendance-summary-card__value">{totals.excused}</div>
        </div>
        <div className="attendance-summary-card attendance-summary-card--not-captured">
          <div className="attendance-summary-card__label">Not Captured</div>
          <div className="attendance-summary-card__value">{totals.notCaptured}</div>
        </div>
        <div className="attendance-summary-card attendance-summary-card--rate">
          <div className="attendance-summary-card__label">Attendance %</div>
          <div className="attendance-summary-card__subtitle">Attendance Rate</div>
          <div className="attendance-summary-card__value">{attendancePctLabel}</div>
        </div>
      </div>

      {error ? (
        <div
          className="attendance-reports-no-print"
          style={{
            ...cardStyle,
            borderTopColor: "#dc2626",
            color: "#b91c1c",
            fontWeight: 700,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="attendance-reports-no-print" style={{ ...cardStyle, fontWeight: 700 }}>
          Loading attendance from saved records…
        </div>
      ) : null}

      {!loading && filteredReport ? (
        <div style={cardStyle} className="attendance-reports-print-root">
          <div className="attendance-reports-print-summary">
            <div className="attendance-reports-print-summary__icon" aria-hidden="true">
              ▦
            </div>
            <div className="attendance-reports-print-summary__body">
              <p className="attendance-reports-print-summary__title">Executive summary</p>
              <p className="attendance-reports-print-summary__metrics">
                <strong>Total Learners:</strong> {totals.learnerCount}
                {" · "}
                <strong>Present:</strong> {totals.present}
                {" · "}
                <strong>Absent:</strong> {totals.absent}
                {" · "}
                <strong>Late:</strong> {totals.late}
                {" · "}
                <strong>Excused:</strong> {totals.excused}
                {" · "}
                <strong>Not Captured:</strong> {totals.notCaptured}
                {" · "}
                <strong>Attendance %:</strong> {attendancePctLabel}
              </p>
            </div>
          </div>
          {view === "daily" || view === "weekly" || view === "monthly" ? (
            <>
              {notice ? (
                <div
                  className="attendance-reports-no-print"
                  style={{
                    marginBottom: 12,
                    padding: 12,
                    borderRadius: 10,
                    background: "#fffbeb",
                    border: "1px solid #fde68a",
                    fontWeight: 700,
                    color: "#92400e",
                  }}
                >
                  {notice}
                </div>
              ) : null}
              <AttendanceRegisterReportView
                report={filteredReport}
                kind={kind}
                catalogTitle={title}
              />
            </>
          ) : null}

          {view === "learner" ? (
            <div>
              <header style={{ marginBottom: 16, borderBottom: `3px solid ${GOLD}`, paddingBottom: 12 }}>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>{title}</h2>
                <div style={{ marginTop: 8, fontWeight: 700, color: "#64748b" }}>
                  {filteredReport.meta.schoolName} · {filteredReport.meta.periodLabel} ·{" "}
                  {filteredReport.meta.startDate} to {filteredReport.meta.endDate}
                </div>
              </header>
              {!selectedLearnerId ? (
                <p style={{ fontWeight: 700, color: "#64748b" }}>Select a learner to view history.</p>
              ) : historyRows.length === 0 ? (
                <p style={{ fontWeight: 700, color: "#64748b" }}>No attendance rows for this learner.</p>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                    <thead>
                      <tr>
                        {[
                          "Day",
                          "Full date",
                          "Status",
                          "Reason",
                          "Captured by",
                          "Server capture time",
                        ].map((h) => (
                          <th
                            key={h}
                            style={{
                              textAlign: "left",
                              padding: "8px 10px",
                              borderBottom: "2px solid #e5e7eb",
                              background: "#f8fafc",
                              fontSize: 12,
                              fontWeight: 800,
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {historyRows.map((row) => (
                        <tr key={`${row.learnerId}-${row.date}`}>
                          <td style={td}>{row.weekday}</td>
                          <td style={td}>{row.fullDateLabel}</td>
                          <td style={{ ...td, fontWeight: 800 }}>{row.statusLabel}</td>
                          <td style={td}>{row.reason || "—"}</td>
                          <td style={td}>{row.capturedBy || "—"}</td>
                          <td style={td}>{row.capturedAtDisplay || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          {view === "classroom_summary" ? (
            <div>
              <header style={{ marginBottom: 16, borderBottom: `3px solid ${GOLD}`, paddingBottom: 12 }}>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>{title}</h2>
                <div style={{ marginTop: 8, fontWeight: 700, color: "#64748b" }}>
                  {filteredReport.meta.schoolName} · {filteredReport.meta.periodLabel} ·{" "}
                  {filteredReport.meta.startDate} to {filteredReport.meta.endDate}
                </div>
              </header>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
                  <thead>
                    <tr>
                      {[
                        "Classroom",
                        "Learners",
                        "Present",
                        "Absent",
                        "Late",
                        "Excused",
                        "Not Captured",
                        "Attendance %",
                        "Capture %",
                      ].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: "left",
                            padding: "8px 10px",
                            borderBottom: "2px solid #e5e7eb",
                            background: "#f8fafc",
                            fontSize: 12,
                            fontWeight: 800,
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {classroomSummaries.map((row) => (
                      <tr key={row.classroom}>
                        <td style={{ ...td, fontWeight: 800 }}>{row.classroom}</td>
                        <td style={td}>{row.learnerCount}</td>
                        <td style={td}>{row.present}</td>
                        <td style={td}>{row.absent}</td>
                        <td style={td}>{row.late}</td>
                        <td style={td}>{row.excused}</td>
                        <td style={td}>{row.notCaptured}</td>
                        <td style={td}>{row.attendancePercentage}%</td>
                        <td style={td}>{row.captureCompletionPercentage}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {view === "school_summary" ? (
            <div>
              <header style={{ marginBottom: 16, borderBottom: `3px solid ${GOLD}`, paddingBottom: 12 }}>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>{title}</h2>
              </header>
              <div style={{ display: "grid", gap: 8, fontWeight: 700, fontSize: 15 }}>
                <div>School: {filteredReport.meta.schoolName}</div>
                <div>Register type: {filteredReport.meta.periodLabel}</div>
                <div>
                  Date range: {filteredReport.meta.startDate} to {filteredReport.meta.endDate}
                </div>
                <div>Total Learners: {totals.learnerCount}</div>
                <div>Present: {totals.present}</div>
                <div>Absent: {totals.absent}</div>
                <div>Late: {totals.late}</div>
                <div>Excused: {totals.excused}</div>
                <div>Not Captured: {totals.notCaptured}</div>
                <div>Attendance %: {attendancePctLabel}</div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {printOpen && filteredReport && (view === "daily" || view === "weekly" || view === "monthly") ? (
        <div className="attendance-reports-print-only attendance-reports-print-root">
          <div className="attendance-reports-print-summary">
            <div className="attendance-reports-print-summary__icon" aria-hidden="true">
              ▦
            </div>
            <div className="attendance-reports-print-summary__body">
              <p className="attendance-reports-print-summary__title">Executive summary</p>
              <p className="attendance-reports-print-summary__metrics">
                <strong>Total Learners:</strong> {totals.learnerCount}
                {" · "}
                <strong>Present:</strong> {totals.present}
                {" · "}
                <strong>Absent:</strong> {totals.absent}
                {" · "}
                <strong>Late:</strong> {totals.late}
                {" · "}
                <strong>Excused:</strong> {totals.excused}
                {" · "}
                <strong>Not Captured:</strong> {totals.notCaptured}
                {" · "}
                <strong>Attendance %:</strong> {attendancePctLabel}
              </p>
            </div>
          </div>
          <AttendanceRegisterReportView
            report={filteredReport}
            kind={kind}
            catalogTitle={title}
          />
        </div>
      ) : null}
    </div>
  );
}

const td: React.CSSProperties = {
  padding: "7px 10px",
  borderBottom: "1px solid #eef2f7",
  fontSize: 13,
};
