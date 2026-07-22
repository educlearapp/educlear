import React from "react";
import {
  emptyStateMessage,
  type AttendanceRegisterKind,
  type AttendanceReportPayload,
} from "./attendanceReportCatalog";

const GOLD = "#d4af37";

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
  verticalAlign: "top",
};

type Props = {
  report: AttendanceReportPayload;
  kind: AttendanceRegisterKind;
  catalogTitle: string;
};

export default function AttendanceRegisterReportView({ report, kind, catalogTitle }: Props) {
  const meta = report.meta;
  const classroomLabel = meta.className || "All Classrooms";
  const dateBanner =
    kind === "daily" || kind === "list"
      ? report.dates[0]?.fullDateLabel || meta.startDate
      : kind === "weekly"
        ? `Week of ${report.dates[0]?.headingWeekly || meta.startDate} – ${
            report.dates[report.dates.length - 1]?.headingWeekly || meta.endDate
          }`
        : `${report.dates[0]?.monthShort || ""} ${meta.startDate.slice(0, 4)}`.trim();

  const notice = emptyStateMessage(kind, report.emptyState, report.learners.length > 0);
  const showLearnersAsNotCaptured = report.learners.length > 0;
  const printOrientation =
    kind === "daily" || kind === "list" ? "portrait" : "landscape";

  return (
    <div
      className={`attendance-register-report attendance-register-report--${kind}`}
      data-print-orientation={printOrientation}
      style={{ color: "#0f172a" }}
    >
      <style>{`
        @media print {
          .attendance-register-no-print { display: none !important; }
          .attendance-register-report { padding: 0 !important; }
          .attendance-register-scroll { overflow: visible !important; }
          .attendance-register-report table { page-break-inside: auto; }
          .attendance-register-report tr { page-break-inside: avoid; page-break-after: auto; }
          .attendance-register-report thead { display: table-header-group; }
          .attendance-register-report--weekly,
          .attendance-register-report--monthly {
            size: landscape;
          }
          @page {
            margin: 12mm;
          }
        }
        .attendance-register-scroll {
          overflow-x: auto;
          -webkit-overflow-scrolling: touch;
        }
        .attendance-register-sticky-name {
          position: sticky;
          left: 0;
          background: #fff;
          z-index: 1;
          min-width: 140px;
          box-shadow: 2px 0 0 rgba(15,23,42,0.06);
        }
        thead .attendance-register-sticky-name {
          background: #f8fafc;
          z-index: 2;
        }
      `}</style>

      <header style={{ marginBottom: 20, borderBottom: `3px solid ${GOLD}`, paddingBottom: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#64748b", letterSpacing: 0.4 }}>
          Class Register
        </div>
        <h1 style={{ margin: "4px 0 0", fontSize: 28, fontWeight: 900 }}>{meta.schoolName}</h1>
        <h2 style={{ margin: "8px 0 0", fontSize: 22, fontWeight: 800 }}>
          {catalogTitle || meta.title}
        </h2>
        <div style={{ marginTop: 10, display: "grid", gap: 4, fontSize: 14, fontWeight: 700 }}>
          <div>{dateBanner}</div>
          <div>Class: {classroomLabel}</div>
          <div>Period: {meta.periodLabel}</div>
          <div>Generated: {meta.generatedAtDisplay}</div>
          <div>Timezone: {meta.timezone}</div>
        </div>
        {report.groupByDisabledReason ? (
          <p style={{ marginTop: 10, color: "#b45309", fontWeight: 700, fontSize: 13 }}>
            {report.groupByDisabledReason}
          </p>
        ) : null}
        <p style={{ marginTop: 10, color: "#64748b", fontSize: 12, fontWeight: 600 }}>
          {meta.holidayLimitation}
        </p>
      </header>

      {notice && !showLearnersAsNotCaptured ? (
        <div
          style={{
            padding: 18,
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            background: "#fffbeb",
            fontWeight: 700,
            color: "#92400e",
          }}
        >
          {notice}
        </div>
      ) : null}

      {notice && showLearnersAsNotCaptured ? (
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
          {notice} Learners below are shown as Not Captured where no mark exists.
        </div>
      ) : null}

      {kind === "weekly" || kind === "monthly" ? (
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
          <span>Legend:</span>
          <span>P — Present</span>
          <span>A — Absent</span>
          <span>L — Late</span>
          <span>E — Excused</span>
          <span>N — Not Captured</span>
        </div>
      ) : null}

      {report.sections.map((section) => (
        <section key={section.key} style={{ marginBottom: 28 }}>
          {(meta.classroomScope === "ALL" || meta.groupBy === "groups" || report.sections.length > 1) && (
            <h3
              style={{
                margin: "0 0 10px",
                fontSize: 16,
                fontWeight: 900,
                padding: "8px 12px",
                background: "rgba(212,175,55,0.15)",
                borderLeft: `4px solid ${GOLD}`,
              }}
            >
              {meta.groupBy === "groups" ? `Group: ${section.label}` : `Class: ${section.label}`}
            </h3>
          )}

          {section.learners.length === 0 ? (
            <p style={{ fontWeight: 700, color: "#64748b" }}>No learners are assigned to this classroom.</p>
          ) : kind === "daily" || kind === "list" ? (
            <DailyTable sectionLearners={section.learners} report={report} />
          ) : (
            <RegisterGrid sectionLearners={section.learners} report={report} kind={kind} />
          )}
        </section>
      ))}

      {report.learners.length > 0 ? (
        <footer style={{ marginTop: 16, fontSize: 12, color: "#64748b", fontWeight: 700 }}>
          Learners: {report.summary.learnerCount} · Expected school days:{" "}
          {report.summary.expectedSchoolDays} · Attendance % = (Present + Late) ÷ expected school days ·
          Capture completion % = captured statuses ÷ expected school days
        </footer>
      ) : null}
    </div>
  );
}

function DailyTable({
  sectionLearners,
  report,
}: {
  sectionLearners: AttendanceReportPayload["learners"];
  report: AttendanceReportPayload;
}) {
  const dateCol = report.dates[0];
  return (
    <div className="attendance-register-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
        <thead>
          <tr>
            <th style={{ ...th, ...stickyNameStyle }}>Learner Name</th>
            <th style={th}>Admission Number</th>
            <th style={th}>Classroom</th>
            <th style={th}>Day</th>
            <th style={th}>Full Date</th>
            <th style={th}>Status</th>
            <th style={th}>Notes / Reason</th>
            <th style={th}>Captured By</th>
            <th style={th}>Capture Time</th>
          </tr>
        </thead>
        <tbody>
          {sectionLearners.map((learner, index) => {
            const day = dateCol ? learner.days[dateCol.date] : undefined;
            return (
              <tr
                key={learner.learnerId}
                style={{ background: index % 2 ? "rgba(212,175,55,0.05)" : "#fff" }}
              >
                <td style={{ ...td, ...stickyNameStyle, fontWeight: 700 }}>{learner.fullName}</td>
                <td style={td}>{learner.admissionNo}</td>
                <td style={td}>{learner.classroom}</td>
                <td style={td}>{dateCol?.weekday || ""}</td>
                <td style={td}>{dateCol?.fullDateLabel || report.meta.startDate}</td>
                <td style={{ ...td, fontWeight: 800 }}>{day?.statusLabel || "Not Captured"}</td>
                <td style={td}>{day?.reason || "—"}</td>
                <td style={td}>{day?.capturedBy || "—"}</td>
                <td style={td}>{day?.capturedAtDisplay || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RegisterGrid({
  sectionLearners,
  report,
  kind,
}: {
  sectionLearners: AttendanceReportPayload["learners"];
  report: AttendanceReportPayload;
  kind: AttendanceRegisterKind;
}) {
  return (
    <div className="attendance-register-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
        <thead>
          <tr>
            <th style={{ ...th, ...stickyNameStyle }}>Learner Name</th>
            <th style={th}>Admission Number</th>
            {report.dates.map((d) => (
              <th key={d.date} style={{ ...th, textAlign: "center" }}>
                {kind === "monthly" ? d.headingMonthly : d.headingWeekly}
              </th>
            ))}
            <th style={th}>Total Present</th>
            <th style={th}>Total Absent</th>
            <th style={th}>Total Late</th>
            <th style={th}>Total Excused</th>
            <th style={th}>Not Captured</th>
            <th style={th}>Attendance %</th>
            <th style={th}>Capture %</th>
          </tr>
        </thead>
        <tbody>
          {sectionLearners.map((learner, index) => (
            <tr
              key={learner.learnerId}
              style={{ background: index % 2 ? "rgba(212,175,55,0.05)" : "#fff" }}
            >
              <td style={{ ...td, ...stickyNameStyle, fontWeight: 700 }}>{learner.fullName}</td>
              <td style={td}>{learner.admissionNo}</td>
              {report.dates.map((d) => (
                <td key={d.date} style={{ ...td, textAlign: "center", fontWeight: 800 }}>
                  {learner.days[d.date]?.statusAbbrev || "N"}
                </td>
              ))}
              <td style={td}>{learner.totals.present}</td>
              <td style={td}>{learner.totals.absent}</td>
              <td style={td}>{learner.totals.late}</td>
              <td style={td}>{learner.totals.excused}</td>
              <td style={td}>{learner.totals.notCaptured}</td>
              <td style={td}>{learner.totals.attendancePercentage}%</td>
              <td style={td}>{learner.totals.captureCompletionPercentage}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const stickyNameStyle: React.CSSProperties = {
  position: "sticky",
  left: 0,
  background: "inherit",
  zIndex: 1,
  minWidth: 140,
};
