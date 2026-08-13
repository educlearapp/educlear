/** Owner-facing correction reasons (human-readable; stored on the audit record). */
export const OWNER_CORRECTION_REASONS = [
  "Forgot to clock out",
  "Device problem",
  "Network problem",
  "Incorrect clock event",
  "Admin correction",
  "Other",
] as const;

export type OwnerCorrectionReason = (typeof OWNER_CORRECTION_REASONS)[number];

export type EduClockCorrectionTarget = {
  employeeId: string;
  employeeName: string;
  employeeNumber: string | null;
  affectedSchoolLocalDate: string;
  clockInTime: string | null;
  clockOutTime: string | null;
  currentStatus: string;
  clockInEventId?: string | null;
  shiftStatus?: string | null;
  correctionStatus?: string | null;
};

export function isMissingClockOutStatus(status: unknown): boolean {
  const s = String(status || "").trim();
  return s === "Missing Clock Out" || s === "MISSING_CLOCK_OUT";
}

export function isClockedInStatus(status: unknown): boolean {
  const s = String(status || "").trim();
  return s === "Clocked In" || s === "CLOCKED_IN";
}

/** Missing clock-out rows must never display accumulated now-clockIn hours. */
export function displayAttendanceDuration(row: {
  currentStatus?: unknown;
  shiftStatus?: unknown;
  workedDuration?: unknown;
}): string {
  if (isMissingClockOutStatus(row.currentStatus) || isMissingClockOutStatus(row.shiftStatus)) {
    return "—";
  }
  const d = row.workedDuration;
  if (d == null || String(d).trim() === "") return "—";
  return String(d);
}

export function isActionableMissingClockOutException(row: {
  exceptionType?: unknown;
  status?: unknown;
}): boolean {
  return String(row.exceptionType || "") === "MISSING_CLOCK_OUT" && String(row.status || "") === "OPEN";
}

export function isInformationalDuplicateClockException(row: { exceptionType?: unknown }): boolean {
  return String(row.exceptionType || "") === "DUPLICATE_CLOCK_ATTEMPT";
}

export function correctionNotesRequired(reason: string): boolean {
  return String(reason || "").trim() === "Other";
}

export function correctionActionForStatus(status: unknown): "CLOSE_OPEN_SHIFT" | "ADD_CLOCK_OUT" | "ADD_CLOCK_IN" {
  if (isMissingClockOutStatus(status) || isClockedInStatus(status)) return "CLOSE_OPEN_SHIFT";
  return "ADD_CLOCK_OUT";
}

export function targetFromAttendanceRow(row: Record<string, unknown>, viewedDate: string): EduClockCorrectionTarget {
  return {
    employeeId: String(row.employeeId || ""),
    employeeName: String(row.employeeName || ""),
    employeeNumber: row.employeeNumber == null || String(row.employeeNumber).trim() === ""
      ? null
      : String(row.employeeNumber),
    affectedSchoolLocalDate: String(row.affectedSchoolLocalDate || viewedDate),
    clockInTime: row.clockInTime == null ? null : String(row.clockInTime),
    clockOutTime: row.clockOutTime == null ? null : String(row.clockOutTime),
    currentStatus: String(row.currentStatus || row.shiftStatus || ""),
    clockInEventId: row.clockInEventId == null ? null : String(row.clockInEventId),
    shiftStatus: row.shiftStatus == null ? null : String(row.shiftStatus),
    correctionStatus: row.correctionStatus == null ? null : String(row.correctionStatus),
  };
}

export function targetFromExceptionRow(row: Record<string, unknown>): EduClockCorrectionTarget {
  return {
    employeeId: String(row.employeeId || ""),
    employeeName: String(row.employeeName || ""),
    employeeNumber: row.employeeNumber == null || String(row.employeeNumber).trim() === ""
      ? null
      : String(row.employeeNumber),
    affectedSchoolLocalDate: String(row.schoolLocalDate || ""),
    clockInTime: row.clockInTime == null ? null : String(row.clockInTime),
    clockOutTime: null,
    currentStatus: "Missing Clock Out",
    clockInEventId: row.relatedEventId == null ? null : String(row.relatedEventId),
    shiftStatus: "Missing Clock Out",
    correctionStatus: "None",
  };
}
