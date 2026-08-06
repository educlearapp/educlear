import { ATTENDANCE_PERIODS, type AttendancePeriod } from "./attendancePeriods";

export const SUBJECT_SLOT_PERIOD_PREFIX = "SLOT_";

export function isSubjectSlotPeriod(period: string): boolean {
  return String(period || "").trim().toUpperCase().startsWith(SUBJECT_SLOT_PERIOD_PREFIX);
}

export function subjectSlotPeriodKey(slotId: string): string {
  return `${SUBJECT_SLOT_PERIOD_PREFIX}${String(slotId || "").trim()}`;
}

export function parseSubjectSlotIdFromPeriod(period: string): string | null {
  const raw = String(period || "").trim();
  if (!raw.toUpperCase().startsWith(SUBJECT_SLOT_PERIOD_PREFIX)) return null;
  const id = raw.slice(SUBJECT_SLOT_PERIOD_PREFIX.length).trim();
  return id || null;
}

/** Accept classic register periods or SLOT_<id> subject-session keys. */
export function normalizeAttendanceSessionKey(input?: unknown): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return "DAILY";
  const upper = raw.toUpperCase();
  if ((ATTENDANCE_PERIODS as readonly string[]).includes(upper)) {
    return upper as AttendancePeriod;
  }
  if (upper.startsWith(SUBJECT_SLOT_PERIOD_PREFIX) && raw.length > SUBJECT_SLOT_PERIOD_PREFIX.length) {
    return `${SUBJECT_SLOT_PERIOD_PREFIX}${raw.slice(SUBJECT_SLOT_PERIOD_PREFIX.length)}`;
  }
  return null;
}

export const PERIOD_REGISTER_COLUMNS = [
  "PERIOD_1",
  "PERIOD_2",
  "PERIOD_3",
  "PERIOD_4",
  "PERIOD_5",
  "PERIOD_6",
  "PERIOD_7",
] as const;

export type PeriodRegisterColumn = (typeof PERIOD_REGISTER_COLUMNS)[number];
