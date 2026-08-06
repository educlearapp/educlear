export type WeeklyRegisterDisplayMode = "Automatic" | "Periods" | "Subjects";

export type WeeklyRegisterCellStatus =
  | "PRESENT"
  | "ABSENT"
  | "LATE"
  | "EXCUSED"
  | "NOT_CAPTURED"
  | "NOT_SCHEDULED";

export type WeeklyRegisterSessionColumn = {
  key: string;
  dayOfWeek: number;
  date: string;
  dayLabel: string;
  sessionLabel: string;
  period?: string;
  subjectId?: string | null;
  subjectName?: string | null;
  legacyMissingSubject?: boolean;
};

export type WeeklyRegisterCell = {
  columnKey: string;
  status: WeeklyRegisterCellStatus;
  abbrev: string;
  label: string;
  captureTime?: string | null;
  capturingTeacher?: string | null;
  reason?: string | null;
  subjectId?: string | null;
  subjectLabel?: string | null;
};

export type WeeklyRegisterLearnerRow = {
  learnerId: string;
  fullName: string;
  grade: string;
  className: string;
  cells: WeeklyRegisterCell[];
  attendancePercentage: number | null;
  present: number;
  absent: number;
  late: number;
  excused: number;
  notCaptured: number;
  notScheduled: number;
  eligibleSessions: number;
  attended: number;
};

export type WeeklyRegisterSummary = {
  totalLearners: number;
  scheduledSessions: number;
  capturedSessions: number;
  notCapturedSessions: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  overallAttendancePercentage: number | null;
  learnersWith100Percent: number;
  learnersBelow90Percent: number;
};

export type WeeklyPeriodSubjectRegisterReport = {
  schoolId: string;
  schoolName: string;
  weekStart: string;
  weekEnd: string;
  timezone: string;
  className: string;
  gradeFilter: string | null;
  teacherFilter: string | null;
  displayModeRequested: WeeklyRegisterDisplayMode;
  displayModeResolved: "PERIODS" | "SUBJECTS";
  classroomAttendanceSessionDisplay: "PERIODS" | "SUBJECTS" | null;
  columns: WeeklyRegisterSessionColumn[];
  dayGroups: Array<{ date: string; dayLabel: string; columnKeys: string[] }>;
  learners: WeeklyRegisterLearnerRow[];
  summary: WeeklyRegisterSummary;
  legacySubjectNotice: string | null;
  statusLegend: Array<{ abbrev: string; label: string }>;
  generatedAt: string;
};

export function formatWeeklyRegisterTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function formatWeeklyRegisterCaptureTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export function weeklyAttendancePctLabel(pct: number | null | undefined): string {
  if (pct == null) return "—";
  return `${pct.toFixed(1)}%`;
}
