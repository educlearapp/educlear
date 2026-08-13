/**
 * EduClock attendance duration rules.
 * Historical missing clock-outs must never accumulate as now - clockIn.
 * Live duration is allowed only for a same-day open shift on the current attendance day.
 */

export function formatWorkedDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export function durationBetweenClockEvents(clockInAtUtc: Date, clockOutAtUtc: Date): string {
  return formatWorkedDurationMs(clockOutAtUtc.getTime() - clockInAtUtc.getTime());
}

/** True when an unresolved open shift belongs to a previous school-local attendance day. */
export function isHistoricalMissingClockOut(input: {
  openShiftSchoolLocalDate: string;
  todaySchoolLocalDate: string;
}): boolean {
  return input.openShiftSchoolLocalDate < input.todaySchoolLocalDate;
}

/**
 * Surface a stale missing-clock-out on its affected date, and also on today's board
 * so owners do not miss it. Never attach it to unrelated historical dates.
 */
export function shouldSurfaceMissingClockOutOnDate(input: {
  openShiftSchoolLocalDate: string;
  viewedSchoolLocalDate: string;
  todaySchoolLocalDate: string;
}): boolean {
  if (!isHistoricalMissingClockOut(input)) return false;
  return (
    input.openShiftSchoolLocalDate === input.viewedSchoolLocalDate ||
    input.viewedSchoolLocalDate === input.todaySchoolLocalDate
  );
}

/**
 * Duration for an open shift.
 * Returns null (UI: —) when clock-out is missing after the attendance day has ended.
 * Returns live now-clockIn only while the shift is legitimately open on today's date.
 */
export function resolveOpenShiftWorkedDuration(input: {
  clockOutAtUtc?: Date | null;
  openedAtUtc: Date;
  openShiftSchoolLocalDate: string;
  todaySchoolLocalDate: string;
  nowUtc: Date;
}): string | null {
  if (input.clockOutAtUtc) {
    return durationBetweenClockEvents(input.openedAtUtc, input.clockOutAtUtc);
  }
  if (isHistoricalMissingClockOut(input)) {
    return null;
  }
  if (input.openShiftSchoolLocalDate === input.todaySchoolLocalDate) {
    return formatWorkedDurationMs(input.nowUtc.getTime() - input.openedAtUtc.getTime());
  }
  return null;
}
