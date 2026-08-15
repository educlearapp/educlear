/** Owner-facing correction reasons (human-readable; stored on the audit record). */
export const OWNER_CORRECTION_REASONS = [
  "Forgot to clock in",
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

export function isMissingClockInStatus(status: unknown): boolean {
  const s = String(status || "").trim();
  return s === "Missing Clock In" || s === "MISSING_CLOCK_IN";
}

export function isClockedInStatus(status: unknown): boolean {
  const s = String(status || "").trim();
  return s === "Clocked In" || s === "CLOCKED_IN";
}

export function isNotClockedInStatus(status: unknown): boolean {
  const s = String(status || "").trim();
  return s === "Not Clocked In" || s === "NOT_CLOCKED_IN";
}

export function isAbsentReportedStatus(status: unknown): boolean {
  const s = String(status || "").trim();
  return (
    s === "ABSENT" ||
    s === "ABSENT_REPORTED" ||
    s === "Absent Reported" ||
    s.startsWith("Absent —") ||
    s.startsWith("Absent -")
  );
}

export function correctionFieldsForStatus(status: unknown): { clockIn: boolean; clockOut: boolean } {
  if (isMissingClockInStatus(status)) return { clockIn: true, clockOut: false };
  if (isMissingClockOutStatus(status) || isClockedInStatus(status)) return { clockIn: false, clockOut: true };
  if (isNotClockedInStatus(status)) return { clockIn: true, clockOut: true };
  return { clockIn: false, clockOut: false };
}

export function canOfferAttendanceCorrection(status: unknown): boolean {
  if (isAbsentReportedStatus(status)) return false;
  const fields = correctionFieldsForStatus(status);
  return fields.clockIn || fields.clockOut;
}

export function defaultCorrectionReason(status: unknown): string {
  if (isMissingClockInStatus(status) || isNotClockedInStatus(status)) return "Forgot to clock in";
  if (isMissingClockOutStatus(status) || isClockedInStatus(status)) return "Forgot to clock out";
  return "Admin correction";
}

/** Missing clock-out rows must never display accumulated now-clockIn hours. */
export function displayAttendanceDuration(row: {
  currentStatus?: unknown;
  shiftStatus?: unknown;
  workedDuration?: unknown;
}): string {
  if (
    isMissingClockOutStatus(row.currentStatus) ||
    isMissingClockOutStatus(row.shiftStatus) ||
    isMissingClockInStatus(row.currentStatus) ||
    isMissingClockInStatus(row.shiftStatus) ||
    isAbsentReportedStatus(row.currentStatus) ||
    isAbsentReportedStatus(row.shiftStatus)
  ) {
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
  return "ADD_CLOCK_IN";
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

/**
 * WHATWG <input type="time"> value contract: empty, or 24-hour HH:mm / HH:mm:ss.
 * Safari may *display* 04:00 PM; the element's .value must still be 16:00.
 * Never parse locale AM/PM display strings — that is not the HTML value.
 */
const HTML_TIME_VALUE_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,3})?)?$/;

export const SAFARI_TIME_INPUT_CONTRACT: Array<{
  htmlValue: string;
  safariDisplayNote: string;
  canonical: string;
}> = [
  { htmlValue: "16:00", safariDisplayNote: "04:00 PM", canonical: "16:00" },
  { htmlValue: "15:30", safariDisplayNote: "03:30 PM", canonical: "15:30" },
  { htmlValue: "07:00", safariDisplayNote: "07:00 AM", canonical: "07:00" },
  { htmlValue: "12:00", safariDisplayNote: "12:00 PM", canonical: "12:00" },
  { htmlValue: "00:00", safariDisplayNote: "12:00 AM", canonical: "00:00" },
];

export function canonicalizeHtmlTimeValue(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/[ap]\.?m\.?/i.test(s)) return null;
  const m = s.match(HTML_TIME_VALUE_RE);
  if (!m) return null;
  return `${m[1]}:${m[2]}`;
}

export function readCanonicalTimeFromInput(
  el: { value?: string } | null | undefined,
  reactStateValue?: unknown
): string | null {
  return canonicalizeHtmlTimeValue(el?.value) ?? canonicalizeHtmlTimeValue(reactStateValue);
}

export function correctionTimeInputResetKey(
  target: Pick<EduClockCorrectionTarget, "employeeId" | "affectedSchoolLocalDate">
): string {
  return `${target.employeeId}::${target.affectedSchoolLocalDate}`;
}

/** Explicit 12-hour parts — independent of Safari/WebKit input[type=time]. */
export const CLOCK_HOURS_12: string[] = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
export const CLOCK_MINUTES: string[] = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
export const CLOCK_MERIDIEMS = ["AM", "PM"] as const;

/**
 * Production Safari/WebKit failure at 3779181: the native time control can
 * *display* 04:00 PM while HTMLInputElement.value remains "" (or a locale
 * AM/PM string). Reading .value therefore cannot be the source of truth.
 */
export function webkitTimeInputCanDisplayWithoutValue(input: {
  displayedText: string;
  htmlValue: string;
  reactState: string;
}): boolean {
  const displayed = String(input.displayedText || "").trim();
  const htmlValue = String(input.htmlValue || "").trim();
  const reactState = String(input.reactState || "").trim();
  return displayed.length > 0 && htmlValue === "" && reactState === "";
}

export function canonicalizeTwelveHourClockParts(input: {
  hour?: unknown;
  minute?: unknown;
  meridiem?: unknown;
}): string | null {
  const hourRaw = String(input.hour ?? "").trim();
  const minuteRaw = String(input.minute ?? "").trim();
  const mer = String(input.meridiem ?? "")
    .trim()
    .toUpperCase()
    .replace(/\./g, "");
  if (!hourRaw || !minuteRaw || !mer) return null;
  if (mer !== "AM" && mer !== "PM") return null;
  const hourNum = Number(hourRaw);
  const minuteNum = Number(minuteRaw);
  if (!Number.isInteger(hourNum) || hourNum < 1 || hourNum > 12) return null;
  if (!Number.isInteger(minuteNum) || minuteNum < 0 || minuteNum > 59) return null;
  let hour24 = hourNum % 12;
  if (mer === "PM") hour24 += 12;
  return `${String(hour24).padStart(2, "0")}:${String(minuteNum).padStart(2, "0")}`;
}

function hmToMinutes(hm: unknown): number | null {
  const s = canonicalizeHtmlTimeValue(hm);
  if (!s) return null;
  const [h, m] = s.split(":").map((p) => Number(p));
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  return h * 60 + m;
}

export function durationBetweenHm(clockInHm: string, clockOutHm: string): string | null {
  const a = hmToMinutes(clockInHm);
  const b = hmToMinutes(clockOutHm);
  if (a == null || b == null || b <= a) return null;
  const mins = b - a;
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function isClockOutBeforeClockIn(clockInHm: string | null | undefined, clockOutHm: string): boolean {
  if (!clockInHm) return false;
  const a = hmToMinutes(clockInHm);
  const b = hmToMinutes(clockOutHm);
  if (a == null || b == null) return false;
  return b <= a;
}

export function isClockInAfterClockOut(clockInHm: string, clockOutHm: string | null | undefined): boolean {
  if (!clockOutHm) return false;
  return isClockOutBeforeClockIn(clockInHm, clockOutHm);
}

export function resolveCorrectionClockOutTime(input: {
  hour?: unknown;
  minute?: unknown;
  meridiem?: unknown;
}): { ok: true; schoolLocalTime: string } | { ok: false; error: string } {
  return resolveCorrectionTime(input, "Enter the correct clock-out time.");
}

export function resolveCorrectionTime(
  input: { hour?: unknown; minute?: unknown; meridiem?: unknown },
  emptyError: string
): { ok: true; schoolLocalTime: string } | { ok: false; error: string } {
  const schoolLocalTime = canonicalizeTwelveHourClockParts(input);
  if (!schoolLocalTime) {
    return { ok: false, error: emptyError };
  }
  return { ok: true, schoolLocalTime };
}

export function buildOwnerCorrectionRequest(input: {
  target: EduClockCorrectionTarget;
  reason: string;
  note?: string;
  hour?: unknown;
  minute?: unknown;
  meridiem?: unknown;
  clockInHour?: unknown;
  clockInMinute?: unknown;
  clockInMeridiem?: unknown;
  clockOutHour?: unknown;
  clockOutMinute?: unknown;
  clockOutMeridiem?: unknown;
}):
  | {
      ok: true;
      payload: {
        employeeId: string;
        action: "CLOSE_OPEN_SHIFT" | "ADD_CLOCK_OUT" | "ADD_CLOCK_IN";
        reason: string;
        note: string | null;
        schoolLocalDate: string;
        schoolLocalTime: string;
        schoolLocalClockOutTime?: string | null;
        targetEventId: string | null;
      };
    }
  | { ok: false; error: string } {
  const fields = correctionFieldsForStatus(input.target.currentStatus);
  if (!fields.clockIn && !fields.clockOut) {
    return { ok: false, error: "This attendance row does not need a missing-event correction." };
  }
  const inParts = {
    hour: input.clockInHour ?? (fields.clockIn && !fields.clockOut ? input.hour : undefined),
    minute: input.clockInMinute ?? (fields.clockIn && !fields.clockOut ? input.minute : undefined),
    meridiem: input.clockInMeridiem ?? (fields.clockIn && !fields.clockOut ? input.meridiem : undefined),
  };
  const outParts = {
    hour: input.clockOutHour ?? (fields.clockOut && !fields.clockIn ? input.hour : undefined),
    minute: input.clockOutMinute ?? (fields.clockOut && !fields.clockIn ? input.minute : undefined),
    meridiem: input.clockOutMeridiem ?? (fields.clockOut && !fields.clockIn ? input.meridiem : undefined),
  };

  let schoolLocalTime = "";
  let schoolLocalClockOutTime: string | null = null;
  if (fields.clockIn && fields.clockOut) {
    const inTime = resolveCorrectionTime(inParts, "Enter the correct clock-in time.");
    if (!inTime.ok) return inTime;
    const outTime = resolveCorrectionTime(outParts, "Enter the correct clock-out time.");
    if (!outTime.ok) return outTime;
    if (isClockOutBeforeClockIn(inTime.schoolLocalTime, outTime.schoolLocalTime)) {
      return { ok: false, error: "Clock-out time must be after clock-in." };
    }
    schoolLocalTime = inTime.schoolLocalTime;
    schoolLocalClockOutTime = outTime.schoolLocalTime;
  } else if (fields.clockIn) {
    const time = resolveCorrectionTime(inParts, "Enter the correct clock-in time.");
    if (!time.ok) return time;
    schoolLocalTime = time.schoolLocalTime;
    if (isClockInAfterClockOut(schoolLocalTime, input.target.clockOutTime)) {
      return { ok: false, error: "Clock-in time must be before clock-out." };
    }
  } else {
    const time = resolveCorrectionTime(outParts, "Enter the correct clock-out time.");
    if (!time.ok) return time;
    schoolLocalTime = time.schoolLocalTime;
    if (isClockOutBeforeClockIn(input.target.clockInTime, time.schoolLocalTime)) {
      return { ok: false, error: "Clock-out time must be after clock-in." };
    }
  }
  if (correctionNotesRequired(input.reason) && !String(input.note || "").trim()) {
    return { ok: false, error: "A note is required when reason is Other." };
  }
  const note = String(input.note || "").trim();
  return {
    ok: true,
    payload: {
      employeeId: input.target.employeeId,
      action: correctionActionForStatus(input.target.currentStatus),
      reason: input.reason,
      note: note ? note : null,
      schoolLocalDate: input.target.affectedSchoolLocalDate,
      schoolLocalTime,
      schoolLocalClockOutTime,
      targetEventId: input.target.clockInEventId || null,
    },
  };
}
