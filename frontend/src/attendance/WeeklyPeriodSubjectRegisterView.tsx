import React, { useMemo, useState } from "react";
import type {
  WeeklyPeriodSubjectRegisterReport,
  WeeklyRegisterCell,
  WeeklyRegisterLearnerRow,
  WeeklyRegisterSessionColumn,
} from "./weeklyPeriodSubjectRegisterTypes";
import {
  formatWeeklyRegisterCaptureTime,
  formatWeeklyRegisterTimestamp,
  weeklyAttendancePctLabel,
} from "./weeklyPeriodSubjectRegisterTypes";

const GOLD = "#d4af37";
const NAVY = "#0f172a";

type Props = {
  report: WeeklyPeriodSubjectRegisterReport;
  title: string;
};

type DetailSelection = {
  learner: WeeklyRegisterLearnerRow;
  cell: WeeklyRegisterCell;
  column: WeeklyRegisterSessionColumn;
};

const CELL_BG: Record<string, string> = {
  P: "#f4faf6",
  A: "#faf5f5",
  L: "#fbf7f2",
  E: "#f4f7fb",
  NC: "#f5f7fa",
  NS: "#f8fafc",
};

const CELL_COLOR: Record<string, string> = {
  P: "#1f6b3a",
  A: "#9b2c2c",
  L: "#9a5b1a",
  E: "#2f4f7c",
  NC: "#475569",
  NS: "#94a3b8",
};

export default function WeeklyPeriodSubjectRegisterView({ report, title }: Props) {
  const [detail, setDetail] = useState<DetailSelection | null>(null);

  const columnByKey = useMemo(() => {
    const map = new Map<string, WeeklyRegisterSessionColumn>();
    for (const col of report.columns) map.set(col.key, col);
    return map;
  }, [report.columns]);

  const weekBanner = `${report.weekStart} – ${report.weekEnd}`;

  return (
    <div className="wps-register-view" style={{ color: NAVY }}>
      <style>{`
        @media print {
          .wps-register-no-print { display: none !important; }
          .wps-register-scroll { overflow: visible !important; }
          .wps-register-view { padding: 0 !important; }
          .wps-register-view table { page-break-inside: auto; }
          .wps-register-view tr { page-break-inside: avoid; }
          .wps-register-view thead { display: table-header-group; }
          @page { size: landscape; margin: 10mm; }
        }
        .wps-register-scroll {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
        .wps-register-sticky-learner {
          position: sticky;
          left: 0;
          z-index: 2;
          min-width: 160px;
          box-shadow: 2px 0 0 rgba(15,23,42,0.06);
        }
        thead .wps-register-sticky-learner {
          z-index: 3;
          background: #f8fafc;
        }
        .wps-register-cell-btn {
          width: 100%;
          min-width: 34px;
          padding: 6px 4px;
          border: none;
          border-radius: 6px;
          font-weight: 900;
          font-size: 12px;
          cursor: pointer;
          background: transparent;
        }
        .wps-register-cell-btn:hover {
          outline: 2px solid rgba(212,175,55,0.55);
        }
        .wps-register-learner-btn {
          width: 100%;
          text-align: left;
          padding: 0;
          border: none;
          background: transparent;
          font: inherit;
          font-weight: 800;
          cursor: pointer;
          color: inherit;
        }
        .wps-register-learner-btn:hover {
          color: #92400e;
        }
      `}</style>

      <div
        className="wps-register-summary-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <SummaryCard label="Total Learners" value={report.summary.totalLearners} accent={GOLD} />
        <SummaryCard label="Scheduled Sessions" value={report.summary.scheduledSessions} />
        <SummaryCard label="Captured" value={report.summary.capturedSessions} tone="present" />
        <SummaryCard label="Not Captured" value={report.summary.notCapturedSessions} tone="notCaptured" />
        <SummaryCard label="Present" value={report.summary.present} tone="present" />
        <SummaryCard label="Absent" value={report.summary.absent} tone="absent" />
        <SummaryCard label="Late" value={report.summary.late} tone="late" />
        <SummaryCard label="Excused" value={report.summary.excused} tone="excused" />
        <SummaryCard
          label="Overall Attendance %"
          value={weeklyAttendancePctLabel(report.summary.overallAttendancePercentage)}
          highlight
        />
        <SummaryCard label="100% Learners" value={report.summary.learnersWith100Percent} />
        <SummaryCard label="Below 90%" value={report.summary.learnersBelow90Percent} tone="absent" />
      </div>

      <header style={{ marginBottom: 18, borderBottom: `3px solid ${GOLD}`, paddingBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#64748b", letterSpacing: 0.4 }}>
          Weekly Period / Subject Register
        </div>
        <h2 style={{ margin: "4px 0 0", fontSize: 26, fontWeight: 900 }}>{report.schoolName}</h2>
        <h3 style={{ margin: "6px 0 0", fontSize: 20, fontWeight: 800 }}>{title}</h3>
        <div style={{ marginTop: 10, display: "grid", gap: 4, fontSize: 14, fontWeight: 700, color: "#475569" }}>
          <div>Week: {weekBanner}</div>
          <div>Classroom: {report.className}</div>
          <div>
            Display mode: {report.displayModeRequested}
            {report.displayModeRequested === "Automatic"
              ? ` (${report.displayModeResolved === "SUBJECTS" ? "Subjects" : "Periods"})`
              : ""}
          </div>
          {report.gradeFilter ? <div>Grade filter: {report.gradeFilter}</div> : null}
          {report.teacherFilter ? <div>Teacher filter: {report.teacherFilter}</div> : null}
          <div>Generated: {formatWeeklyRegisterTimestamp(report.generatedAt)}</div>
          <div>Timezone: {report.timezone}</div>
        </div>
      </header>

      {report.legacySubjectNotice ? (
        <div
          style={{
            marginBottom: 14,
            padding: 12,
            borderRadius: 10,
            border: "1px solid #fde68a",
            background: "#fffbeb",
            fontWeight: 700,
            color: "#92400e",
            fontSize: 13,
          }}
        >
          {report.legacySubjectNotice}
        </div>
      ) : null}

      <div
        style={{
          marginBottom: 12,
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          fontSize: 12,
          fontWeight: 800,
        }}
      >
        <span style={{ color: NAVY }}>Legend:</span>
        {report.statusLegend.map((item) => (
          <span key={item.abbrev}>
            {item.abbrev} — {item.label}
          </span>
        ))}
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {report.learners.length === 0 ? (
            <p style={{ fontWeight: 700, color: "#64748b" }}>No learners match the current filters.</p>
          ) : (
            <div className="wps-register-scroll">
              <table style={{ borderCollapse: "collapse", minWidth: 900, width: "max-content" }}>
                <thead>
                  <tr>
                    <th
                      rowSpan={2}
                      className="wps-register-sticky-learner"
                      style={{ ...th, background: "#f8fafc" }}
                    >
                      Learner
                    </th>
                    <th rowSpan={2} style={th}>
                      Grade
                    </th>
                    <th rowSpan={2} style={th}>
                      Att %
                    </th>
                    {report.dayGroups.map((day) => (
                      <th
                        key={day.date}
                        colSpan={day.columnKeys.length}
                        style={{ ...th, textAlign: "center", background: "rgba(212,175,55,0.12)" }}
                      >
                        {day.dayLabel}
                        <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b" }}>{day.date}</div>
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {report.columns.map((col) => (
                      <th
                        key={col.key}
                        style={{ ...th, textAlign: "center", fontSize: 11, minWidth: 44 }}
                        title={col.sessionLabel}
                      >
                        {col.sessionLabel}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.learners.map((learner, rowIndex) => (
                    <tr
                      key={learner.learnerId}
                      style={{ background: rowIndex % 2 ? "rgba(212,175,55,0.04)" : "#fff" }}
                    >
                      <td
                        className="wps-register-sticky-learner"
                        style={{
                          ...td,
                          background: rowIndex % 2 ? "rgba(253,246,227,0.5)" : "#fff",
                        }}
                      >
                        <button
                          type="button"
                          className="wps-register-learner-btn"
                          onClick={() => {
                            const firstCell = learner.cells[0];
                            const col = firstCell ? columnByKey.get(firstCell.columnKey) : undefined;
                            if (firstCell && col) setDetail({ learner, cell: firstCell, column: col });
                          }}
                        >
                          {learner.fullName}
                        </button>
                      </td>
                      <td style={td}>{learner.grade || "—"}</td>
                      <td style={{ ...td, fontWeight: 800 }}>
                        {weeklyAttendancePctLabel(learner.attendancePercentage)}
                      </td>
                      {learner.cells.map((cell) => {
                        const col = columnByKey.get(cell.columnKey);
                        if (!col) return null;
                        return (
                          <td key={cell.columnKey} style={{ ...td, textAlign: "center", padding: 4 }}>
                            <button
                              type="button"
                              className="wps-register-cell-btn"
                              style={{
                                background: CELL_BG[cell.abbrev] || "#fff",
                                color: CELL_COLOR[cell.abbrev] || NAVY,
                              }}
                              title={`${col.dayLabel} · ${col.sessionLabel} · ${cell.label}`}
                              onClick={() => setDetail({ learner, cell, column: col })}
                            >
                              {cell.abbrev}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {detail ? (
          <aside
            className="wps-register-no-print"
            style={{
              flex: "0 0 280px",
              maxWidth: 320,
              background: "#fff",
              border: "1px solid rgba(15,23,42,0.10)",
              borderTop: `4px solid ${GOLD}`,
              borderRadius: 14,
              padding: 16,
              boxShadow: "0 12px 28px rgba(15,23,42,0.08)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ fontWeight: 900, fontSize: 15 }}>{detail.learner.fullName}</div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                style={{
                  border: "none",
                  background: "transparent",
                  fontWeight: 900,
                  cursor: "pointer",
                  color: "#64748b",
                }}
              >
                ✕
              </button>
            </div>
            <DetailRow label="Day / date" value={`${detail.column.dayLabel} · ${detail.column.date}`} />
            <DetailRow
              label="Period / subject"
              value={
                report.displayModeResolved === "SUBJECTS"
                  ? detail.cell.subjectLabel || detail.column.sessionLabel
                  : detail.column.sessionLabel
              }
            />
            <DetailRow label="Status" value={`${detail.cell.label} (${detail.cell.abbrev})`} />
            <DetailRow label="Capture time" value={formatWeeklyRegisterCaptureTime(detail.cell.captureTime)} />
            <DetailRow label="Teacher" value={detail.cell.capturingTeacher || "—"} />
            <DetailRow label="Reason" value={detail.cell.reason || "—"} />
            <div style={{ marginTop: 12, fontSize: 11, fontWeight: 700, color: "#64748b" }}>
              Click any cell in the grid to inspect another session.
            </div>
          </aside>
        ) : null}
      </div>

      <footer style={{ marginTop: 16, fontSize: 12, color: "#64748b", fontWeight: 700 }}>
        Attendance % excludes Not Captured and Not Scheduled sessions from the denominator.
      </footer>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent,
  tone,
  highlight,
}: {
  label: string;
  value: string | number;
  accent?: string;
  tone?: "present" | "absent" | "late" | "excused" | "notCaptured";
  highlight?: boolean;
}) {
  const toneStyles: Record<string, React.CSSProperties> = {
    present: { borderTopColor: "#6f9e7a", background: "#f4faf6" },
    absent: { borderTopColor: "#c07a7a", background: "#faf5f5" },
    late: { borderTopColor: "#c49a6c", background: "#fbf7f2" },
    excused: { borderTopColor: "#7a92b3", background: "#f4f7fb" },
    notCaptured: { borderTopColor: "#94a3b8", background: "#f5f7fa" },
  };
  return (
    <div
      className="attendance-summary-card"
      style={{
        borderTopWidth: 3,
        borderTopColor: accent || toneStyles[tone || ""]?.borderTopColor || "rgba(15,23,42,0.08)",
        background: highlight ? NAVY : toneStyles[tone || ""]?.background || "#fff",
        color: highlight ? "#fff" : NAVY,
        borderRadius: 12,
        padding: "12px 12px 14px",
        border: highlight ? `2px solid ${GOLD}` : "1px solid rgba(15,23,42,0.08)",
        minHeight: 88,
      }}
    >
      <div
        className="attendance-summary-card__label"
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: highlight ? "rgba(255,255,255,0.82)" : "#64748b",
        }}
      >
        {label}
      </div>
      <div
        className="attendance-summary-card__value"
        style={{
          marginTop: 8,
          fontSize: highlight ? 26 : 22,
          fontWeight: 900,
          color: highlight ? "#fff" : NAVY,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ marginTop: 4, fontWeight: 700, fontSize: 14, wordBreak: "break-word" }}>{value}</div>
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "2px solid #e5e7eb",
  background: "#f8fafc",
  fontWeight: 800,
  fontSize: 12,
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "7px 10px",
  borderBottom: "1px solid #eef2f7",
  fontSize: 13,
  verticalAlign: "middle",
};
