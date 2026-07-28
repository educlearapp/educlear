import type {
  AttendanceReportLearnerRow,
  AttendanceReportPayload,
  FriendlyAttendanceStatus,
} from "./attendanceReportCatalog";

export type AttendanceStatusFilter =
  | "All"
  | FriendlyAttendanceStatus;

export type AttendanceTotals = {
  present: number;
  absent: number;
  late: number;
  excused: number;
  notCaptured: number;
  captured: number;
  expected: number;
  learnerCount: number;
};

export type ClassroomSummaryRow = {
  classroom: string;
  learnerCount: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  notCaptured: number;
  attendancePercentage: number;
  captureCompletionPercentage: number;
};

export function emptyTotals(): AttendanceTotals {
  return {
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
    notCaptured: 0,
    captured: 0,
    expected: 0,
    learnerCount: 0,
  };
}

export function accumulateLearnerTotals(
  totals: AttendanceTotals,
  learner: AttendanceReportLearnerRow
): void {
  totals.present += learner.totals.present;
  totals.absent += learner.totals.absent;
  totals.late += learner.totals.late;
  totals.excused += learner.totals.excused;
  totals.notCaptured += learner.totals.notCaptured;
  totals.captured += learner.totals.captured;
  totals.expected += learner.totals.expected;
  totals.learnerCount += 1;
}

export function computeReportTotals(learners: AttendanceReportLearnerRow[]): AttendanceTotals {
  const totals = emptyTotals();
  for (const learner of learners) accumulateLearnerTotals(totals, learner);
  return totals;
}

/**
 * Headline Attendance % for report summary cards / exports.
 * ((Present + Late + Excused) / Total Learners) × 100.
 * Not Captured and Absent are excluded from the numerator.
 * Returns 0 when there are no learners (never divides by zero).
 */
export function computeHeadlineAttendancePercentage(totals: AttendanceTotals): number {
  if (totals.learnerCount <= 0) return 0;
  const attended = totals.present + totals.late + totals.excused;
  return Math.round((attended / totals.learnerCount) * 1000) / 10;
}

export function formatHeadlineAttendancePercentage(totals: AttendanceTotals): string {
  return `${computeHeadlineAttendancePercentage(totals).toFixed(1)}%`;
}

export function buildClassroomSummaries(
  report: AttendanceReportPayload
): ClassroomSummaryRow[] {
  return report.sections.map((section) => {
    const totals = computeReportTotals(section.learners);
    const attended = totals.present + totals.late;
    return {
      classroom: section.label,
      learnerCount: totals.learnerCount,
      present: totals.present,
      absent: totals.absent,
      late: totals.late,
      excused: totals.excused,
      notCaptured: totals.notCaptured,
      attendancePercentage:
        totals.expected === 0 ? 0 : Math.round((attended / totals.expected) * 1000) / 10,
      captureCompletionPercentage:
        totals.expected === 0 ? 0 : Math.round((totals.captured / totals.expected) * 1000) / 10,
    };
  });
}

export function filterReportLearners(
  report: AttendanceReportPayload,
  opts: {
    learnerSearch: string;
    statusFilter: AttendanceStatusFilter;
    learnerId?: string | null;
  }
): AttendanceReportPayload {
  const search = opts.learnerSearch.trim().toLowerCase();
  const filterLearner = (learner: AttendanceReportLearnerRow): boolean => {
    if (opts.learnerId && learner.learnerId !== opts.learnerId) return false;
    if (search) {
      const hay = `${learner.fullName} ${learner.admissionNo} ${learner.classroom}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    if (opts.statusFilter && opts.statusFilter !== "All") {
      const hasStatus = Object.values(learner.days).some(
        (day) => String(day.statusLabel) === opts.statusFilter
      );
      if (!hasStatus) return false;
    }
    return true;
  };

  const learners = report.learners.filter(filterLearner);
  const learnerIds = new Set(learners.map((l) => l.learnerId));
  const sections = report.sections
    .map((section) => ({
      ...section,
      learners: section.learners.filter((l) => learnerIds.has(l.learnerId)),
    }))
    .filter((section) => section.learners.length > 0);

  return {
    ...report,
    learners,
    sections,
    summary: {
      ...report.summary,
      learnerCount: learners.length,
      sectionCount: sections.length,
    },
  };
}

/** Daily-style flat rows for learner history / filtered daily views. */
export type AttendanceHistoryFlatRow = {
  learnerId: string;
  fullName: string;
  admissionNo: string;
  classroom: string;
  date: string;
  weekday: string;
  fullDateLabel: string;
  statusLabel: string;
  statusAbbrev: string;
  reason: string;
  capturedBy: string;
  capturedAtDisplay: string;
};

export function flattenAttendanceHistory(
  report: AttendanceReportPayload
): AttendanceHistoryFlatRow[] {
  const rows: AttendanceHistoryFlatRow[] = [];
  for (const learner of report.learners) {
    for (const dateCol of report.dates) {
      const day = learner.days[dateCol.date];
      rows.push({
        learnerId: learner.learnerId,
        fullName: learner.fullName,
        admissionNo: learner.admissionNo,
        classroom: learner.classroom,
        date: dateCol.date,
        weekday: dateCol.weekday,
        fullDateLabel: dateCol.fullDateLabel,
        statusLabel: day?.statusLabel || "Not Captured",
        statusAbbrev: day?.statusAbbrev || "N",
        reason: day?.reason || "",
        capturedBy: day?.capturedBy || "",
        capturedAtDisplay: day?.capturedAtDisplay || "",
      });
    }
  }
  return rows;
}
