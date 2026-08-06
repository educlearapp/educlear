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
  /** Display mark in the grid (reason code when present, else P/A/L/E/NC/NS). */
  abbrev: string;
  label: string;
  captureTime?: string | null;
  capturingTeacher?: string | null;
  /** Original free-text reason from capture (never discarded). */
  reason?: string | null;
  /** True when abbrev came from a teacher reason code/synonym. */
  fromReasonCode?: boolean;
  /** Teacher note after extracting a leading reason code (if any). */
  teacherNote?: string | null;
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

/** On-screen / tooltip detail lines for a register cell. */
export function formatWeeklyCellDetailLines(cell: WeeklyRegisterCell, captureTimeDisplay?: string): string[] {
  const lines = [`${cell.abbrev} – ${cell.label}`];
  const note = String(cell.teacherNote || "").trim();
  if (note) lines.push(note);
  else if (cell.reason && !cell.fromReasonCode) {
    const reason = String(cell.reason).trim();
    if (reason && reason.toLowerCase() !== cell.label.toLowerCase()) lines.push(reason);
  }
  const captured = String(captureTimeDisplay || "").trim();
  if (captured && captured !== "—") lines.push(`Captured ${captured}`);
  return lines;
}

/** Colour family for reason codes in the grid. */
export function weeklyCellTone(abbrev: string): "present" | "absent" | "late" | "excused" | "notCaptured" | "notScheduled" {
  const code = String(abbrev || "").toUpperCase();
  if (code === "P") return "present";
  if (code === "L") return "late";
  if (code === "E" || code === "O") return "excused";
  if (code === "NC") return "notCaptured";
  if (code === "NS") return "notScheduled";
  // A, S, SN, F and unknown absence-like codes
  return "absent";
}
