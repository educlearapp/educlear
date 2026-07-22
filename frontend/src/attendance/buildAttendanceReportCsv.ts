import type {
  AttendanceRegisterKind,
  AttendanceReportPayload,
} from "./attendanceReportCatalog";

function escapeCsv(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function rowsToCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

export function buildAttendanceReportCsv(
  report: AttendanceReportPayload,
  kind: AttendanceRegisterKind,
  catalogTitle: string
): string {
  const meta = report.meta;
  const header: (string | number)[][] = [
    ["Report", catalogTitle || meta.title],
    ["School", meta.schoolName],
    ["Classroom", meta.className || "All Classrooms"],
    ["Period", meta.periodLabel],
    ["Date range", `${meta.startDate} to ${meta.endDate}`],
    ["Timezone", meta.timezone],
    ["Generated", meta.generatedAtDisplay],
    ["Class Register", "Yes"],
    ["Holiday note", meta.holidayLimitation],
    [],
  ];

  if (kind === "daily" || kind === "list") {
    const dateCol = report.dates[0];
    const body: (string | number)[][] = [
      [
        "Learner Name",
        "Admission Number",
        "Classroom",
        "Day",
        "Full Date",
        "Status",
        "Notes / Reason",
        "Captured By",
        "Capture Time",
      ],
    ];
    for (const section of report.sections) {
      body.push([`Class: ${section.label}`, "", "", "", "", "", "", "", ""]);
      for (const learner of section.learners) {
        const day = dateCol ? learner.days[dateCol.date] : undefined;
        body.push([
          learner.fullName,
          learner.admissionNo,
          learner.classroom,
          dateCol?.weekday || "",
          dateCol?.fullDateLabel || meta.startDate,
          day?.statusLabel || "Not Captured",
          day?.reason || "",
          day?.capturedBy || "",
          day?.capturedAtDisplay || "",
        ]);
      }
    }
    return rowsToCsv([...header, ...body]);
  }

  const dayHeaders = report.dates.map((d) =>
    kind === "monthly" ? d.headingMonthly : d.headingWeekly
  );
  const body: (string | number)[][] = [
    [
      "Learner Name",
      "Admission Number",
      ...dayHeaders,
      "Total Present",
      "Total Absent",
      "Total Late",
      "Total Excused",
      "Total Not Captured",
      "Attendance Percentage",
      "Capture Completion Percentage",
    ],
  ];

  for (const section of report.sections) {
    body.push([
      `Class: ${section.label}`,
      "",
      ...report.dates.map(() => ""),
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
    for (const learner of section.learners) {
      body.push([
        learner.fullName,
        learner.admissionNo,
        ...report.dates.map((d) => learner.days[d.date]?.statusAbbrev || "N"),
        learner.totals.present,
        learner.totals.absent,
        learner.totals.late,
        learner.totals.excused,
        learner.totals.notCaptured,
        `${learner.totals.attendancePercentage}%`,
        `${learner.totals.captureCompletionPercentage}%`,
      ]);
    }
  }

  body.push([]);
  body.push(["Legend", "P=Present", "A=Absent", "L=Late", "E=Excused", "N=Not Captured"]);
  return rowsToCsv([...header, ...body]);
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
