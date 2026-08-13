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

export function resolveCorrectionClockOutTime(input: {
  htmlInputValue?: unknown;
  reactStateValue?: unknown;
}): { ok: true; schoolLocalTime: string } | { ok: false; error: string } {
  const schoolLocalTime = readCanonicalTimeFromInput(
    { value: String(input.htmlInputValue ?? "") },
    input.reactStateValue
  );
  if (!schoolLocalTime) {
    return { ok: false, error: "Enter the correct clock-out time." };
  }
  return { ok: true, schoolLocalTime };
}

export function buildOwnerCorrectionRequest(input: {
  target: EduClockCorrectionTarget;
  reason: string;
  note?: string;
  htmlInputValue?: unknown;
  reactStateValue?: unknown;
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
        targetEventId: string | null;
      };
    }
  | { ok: false; error: string } {
  const time = resolveCorrectionClockOutTime({
    htmlInputValue: input.htmlInputValue,
    reactStateValue: input.reactStateValue,
  });
  if (!time.ok) return time;
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
      schoolLocalTime: time.schoolLocalTime,
      targetEventId: input.target.clockInEventId || null,
    },
  };
}
