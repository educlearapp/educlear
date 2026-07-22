import type { AttendancePeriodValue } from "./periodOptions";

export type AttendanceRegisterKind = "daily" | "weekly" | "monthly" | "list";

export type AttendanceCatalogConfig = {
  kind: AttendanceRegisterKind;
  includeWeekends: boolean;
  title: string;
};

const ATTENDANCE_CATALOG: Record<string, AttendanceCatalogConfig> = {
  "Attendance List": { kind: "list", includeWeekends: false, title: "Attendance List" },
  "Attendance Register (Daily)": {
    kind: "daily",
    includeWeekends: false,
    title: "Daily Attendance Register",
  },
  "Attendance Register (Weekly)": {
    kind: "weekly",
    includeWeekends: false,
    title: "Weekly Attendance Register",
  },
  "Attendance Register (Weekly) (Weekends)": {
    kind: "weekly",
    includeWeekends: true,
    title: "Weekly Attendance Register",
  },
  "Attendance Register (Monthly)": {
    kind: "monthly",
    includeWeekends: false,
    title: "Monthly Attendance Register",
  },
  "Attendance Register (Monthly) (Weekends)": {
    kind: "monthly",
    includeWeekends: true,
    title: "Monthly Attendance Register",
  },
};

export function isLearnerAttendanceRegister(name: string): boolean {
  return Boolean(ATTENDANCE_CATALOG[String(name || "").trim()]);
}

export function getAttendanceCatalogConfig(name: string): AttendanceCatalogConfig | null {
  return ATTENDANCE_CATALOG[String(name || "").trim()] || null;
}

/** Monday (YYYY-MM-DD) for the week containing the given school date. */
export function mondayOfWeek(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
  if (!match) return ymd;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T12:00:00.000Z`);
  const day = date.getUTCDay(); // 0 Sun .. 6 Sat
  const offset = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + offset);
  return formatYmdUtc(date);
}

export function sundayOfWeek(ymd: string): string {
  const monday = mondayOfWeek(ymd);
  const date = new Date(`${monday}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 6);
  return formatYmdUtc(date);
}

export function fridayOfWeek(ymd: string): string {
  const monday = mondayOfWeek(ymd);
  const date = new Date(`${monday}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 4);
  return formatYmdUtc(date);
}

export function monthBounds(ymd: string): { start: string; end: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "").trim());
  if (!match) return { start: ymd, end: ymd };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const start = `${match[1]}-${match[2]}-01`;
  const last = new Date(Date.UTC(year, month, 0, 12, 0, 0));
  return { start, end: formatYmdUtc(last) };
}

function formatYmdUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function resolveAttendanceReportRange(
  kind: AttendanceRegisterKind,
  anchorDate: string,
  includeWeekends: boolean
): { startDate: string; endDate: string } {
  if (kind === "daily" || kind === "list") {
    return { startDate: anchorDate, endDate: anchorDate };
  }
  if (kind === "weekly") {
    return {
      startDate: mondayOfWeek(anchorDate),
      endDate: includeWeekends ? sundayOfWeek(anchorDate) : fridayOfWeek(anchorDate),
    };
  }
  const bounds = monthBounds(anchorDate);
  return { startDate: bounds.start, endDate: bounds.end };
}

export type FriendlyAttendanceStatus =
  | "Present"
  | "Absent"
  | "Late"
  | "Excused"
  | "Not Captured";

export function friendlyAttendanceStatus(raw: string | null | undefined): FriendlyAttendanceStatus {
  const key = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (key === "PRESENT") return "Present";
  if (key === "ABSENT") return "Absent";
  if (key === "LATE") return "Late";
  if (key === "EXCUSED") return "Excused";
  if (key === "NOT_CAPTURED" || !key) return "Not Captured";
  const lower = String(raw || "").trim().toLowerCase();
  if (lower === "present") return "Present";
  if (lower === "absent") return "Absent";
  if (lower === "late") return "Late";
  if (lower === "excused") return "Excused";
  return "Not Captured";
}

export type AttendanceReportDayCell = {
  date: string;
  status: string;
  statusLabel: FriendlyAttendanceStatus | string;
  statusAbbrev: string;
  reason: string;
  capturedBy: string;
  capturedAt: string | null;
  capturedAtDisplay: string | null;
};

export type AttendanceReportLearnerRow = {
  learnerId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  admissionNo: string;
  classroom: string;
  groupNames: string[];
  days: Record<string, AttendanceReportDayCell>;
  totals: {
    present: number;
    absent: number;
    late: number;
    excused: number;
    notCaptured: number;
    attended: number;
    captured: number;
    expected: number;
    attendancePercentage: number;
    captureCompletionPercentage: number;
  };
};

export type AttendanceReportSection = {
  key: string;
  label: string;
  type: string;
  learners: AttendanceReportLearnerRow[];
};

export type AttendanceReportDateCol = {
  date: string;
  weekday: string;
  weekdayShort: string;
  dayOfMonth: number;
  monthShort: string;
  fullDateLabel: string;
  headingWeekly: string;
  headingMonthly: string;
};

export type AttendanceReportPayload = {
  meta: {
    schoolId: string;
    schoolName: string;
    title: string;
    startDate: string;
    endDate: string;
    period: AttendancePeriodValue | string;
    periodLabel: string;
    className: string | null;
    classroomScope: "ALL" | "SINGLE";
    includeWeekends: boolean;
    groupBy: "classrooms" | "groups";
    timezone: string;
    generatedAt: string;
    generatedAtDisplay: string;
    holidayLimitation: string;
  };
  dates: AttendanceReportDateCol[];
  sections: AttendanceReportSection[];
  learners: AttendanceReportLearnerRow[];
  summary: {
    learnerCount: number;
    expectedSchoolDays: number;
    sectionCount: number;
  };
  emptyState: null | "NO_LEARNERS" | "NO_ATTENDANCE_FOR_PERIOD";
  groupsAvailable: boolean;
  groupByDisabledReason: string | null;
};

export function emptyStateMessage(
  kind: AttendanceRegisterKind,
  emptyState: AttendanceReportPayload["emptyState"],
  hasLearners: boolean
): string | null {
  if (emptyState === "NO_LEARNERS" || !hasLearners) {
    return "No learners are assigned to this classroom.";
  }
  if (emptyState === "NO_ATTENDANCE_FOR_PERIOD") {
    if (kind === "daily" || kind === "list") {
      return "No attendance records were captured for this date.";
    }
    if (kind === "weekly") {
      return "Attendance has not been captured for this week.";
    }
    return "No attendance data is available for this month.";
  }
  return null;
}
