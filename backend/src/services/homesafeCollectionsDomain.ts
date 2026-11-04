/**
 * HomeSafe Collections V2 — pure domain rules (no DB).
 * Mirrors the verified local prototype: multi-session groups, session-scoped memberships,
 * Mon–Fri + 08:00–16:00 schedules. Independent of Early Departure and school Groups/Lists.
 */

export const HS_CG_SCHEDULE_EARLIEST = "08:00";
export const HS_CG_SCHEDULE_LATEST = "16:00";

export const HS_CG_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
export type HsCgWeekday = (typeof HS_CG_WEEKDAYS)[number];

export type HsCgGroupKind = "TRANSPORT" | "ACTIVITY";

export type HsCgAttendance = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | "UNCONFIRMED";
export type HsCgProgress =
  | "WAITING"
  | "CALLED"
  | "READY"
  | "COLLECTED"
  | "HANDED_OVER"
  | "RETURNED"
  | "PARTICIPATING"
  | "COMPLETED"
  | "AWAY";

export type HsCgGroup = {
  id: string;
  schoolId: string;
  name: string;
  kind: HsCgGroupKind;
  driverName?: string | null;
  driverContact?: string | null;
  vehicleReg?: string | null;
};

export type HsCgSession = {
  id: string;
  schoolId: string;
  groupId: string;
  weekday: HsCgWeekday;
  startTime: string;
  endTime: string;
  responsibleAdult: string;
  location?: string | null;
};

export type HsCgMembership = {
  id: string;
  schoolId: string;
  sessionId: string;
  learnerId: string;
};

export type HsCgRegisterRow = {
  id: string;
  schoolId: string;
  sessionId: string;
  learnerId: string;
  schoolLocalDate: string;
  attendance: HsCgAttendance;
  progress: HsCgProgress;
  note?: string | null;
};

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseHhMm(value: string): number | null {
  const m = HH_MM.exec(String(value || "").trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function normaliseHhMmInput(value: string): string | null {
  const raw = String(value || "").trim().replace(".", ":");
  if (HH_MM.test(raw)) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 3 || digits.length === 4) {
    const padded = digits.padStart(4, "0");
    const candidate = `${padded.slice(0, 2)}:${padded.slice(2)}`;
    return HH_MM.test(candidate) ? candidate : null;
  }
  const loose = /^(\d{1,2}):([0-5]\d)$/.exec(raw);
  if (loose) {
    const candidate = `${loose[1].padStart(2, "0")}:${loose[2]}`;
    return HH_MM.test(candidate) ? candidate : null;
  }
  return null;
}

export type ScheduleValidation =
  | { ok: true; startTime: string; endTime: string }
  | { ok: false; message: string };

export function validateCollectionScheduleTimes(startRaw: string, endRaw: string): ScheduleValidation {
  const startTime = normaliseHhMmInput(startRaw);
  const endTime = normaliseHhMmInput(endRaw);
  if (!startTime) return { ok: false, message: "Start time must be HH:mm (24-hour), e.g. 08:00." };
  if (!endTime) return { ok: false, message: "End time must be HH:mm (24-hour), e.g. 16:00." };
  const earliest = parseHhMm(HS_CG_SCHEDULE_EARLIEST)!;
  const latest = parseHhMm(HS_CG_SCHEDULE_LATEST)!;
  const startMins = parseHhMm(startTime)!;
  const endMins = parseHhMm(endTime)!;
  if (startMins < earliest || startMins > latest) {
    return {
      ok: false,
      message: `Start time must be between ${HS_CG_SCHEDULE_EARLIEST} and ${HS_CG_SCHEDULE_LATEST} inclusive.`,
    };
  }
  if (endMins < earliest || endMins > latest) {
    return {
      ok: false,
      message: `End time must be between ${HS_CG_SCHEDULE_EARLIEST} and ${HS_CG_SCHEDULE_LATEST} inclusive.`,
    };
  }
  if (endMins <= startMins) return { ok: false, message: "End time must be later than start time." };
  return { ok: true, startTime, endTime };
}

export function isHsCgWeekday(value: string): value is HsCgWeekday {
  return (HS_CG_WEEKDAYS as readonly string[]).includes(value);
}

/** ISO date (YYYY-MM-DD) → weekday Mon–Fri, or null for weekend/invalid. */
export function weekdayForIsoDate(isoDate: string): HsCgWeekday | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || "").trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return null;
  const map: Array<HsCgWeekday | null> = [null, "Mon", "Tue", "Wed", "Thu", "Fri", null];
  return map[d.getUTCDay()] ?? null;
}

export type DomainErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "SCHOOL_MISMATCH"
  | "CONFLICT"
  | "FORBIDDEN";

export class HsCgDomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string
  ) {
    super(message);
    this.name = "HsCgDomainError";
  }
}

export function assertSameSchool(entitySchoolId: string, schoolId: string, label = "Record"): void {
  if (entitySchoolId !== schoolId) {
    throw new HsCgDomainError("SCHOOL_MISMATCH", `${label} does not belong to this school`);
  }
}

export function uniqueLearnerIds(memberships: HsCgMembership[]): string[] {
  return Array.from(new Set(memberships.map((m) => m.learnerId)));
}

export function membershipsForSession(
  memberships: HsCgMembership[],
  sessionId: string
): HsCgMembership[] {
  return memberships.filter((m) => m.sessionId === sessionId);
}

/**
 * Replace the roster for one session only. Other sessions' memberships are untouched.
 */
export function replaceSessionRoster(
  existing: HsCgMembership[],
  schoolId: string,
  sessionId: string,
  learnerIds: string[],
  newId: () => string
): HsCgMembership[] {
  const others = existing.filter((m) => m.sessionId !== sessionId);
  const unique = Array.from(new Set(learnerIds.map((id) => String(id || "").trim()).filter(Boolean)));
  const nextForSession = unique.map((learnerId) => ({
    id: newId(),
    schoolId,
    sessionId,
    learnerId,
  }));
  return [...others, ...nextForSession];
}

/**
 * Remove one learner from one session only.
 */
export function removeLearnerFromSession(
  existing: HsCgMembership[],
  sessionId: string,
  learnerId: string
): HsCgMembership[] {
  return existing.filter((m) => !(m.sessionId === sessionId && m.learnerId === learnerId));
}

/**
 * Build today's register rows for sessions that meet on `weekday`.
 * Uses live memberships; preserves existing row state when present.
 */
export function buildRegisterRowsForDate(input: {
  schoolId: string;
  schoolLocalDate: string;
  weekday: HsCgWeekday;
  sessions: HsCgSession[];
  memberships: HsCgMembership[];
  existingRows: HsCgRegisterRow[];
  newId: () => string;
}): HsCgRegisterRow[] {
  const daySessions = input.sessions.filter(
    (s) => s.schoolId === input.schoolId && s.weekday === input.weekday
  );
  const rows: HsCgRegisterRow[] = [];
  for (const session of daySessions) {
    const members = membershipsForSession(input.memberships, session.id).filter(
      (m) => m.schoolId === input.schoolId
    );
    for (const m of members) {
      const existing = input.existingRows.find(
        (r) =>
          r.sessionId === session.id &&
          r.learnerId === m.learnerId &&
          r.schoolLocalDate === input.schoolLocalDate
      );
      rows.push(
        existing ?? {
          id: input.newId(),
          schoolId: input.schoolId,
          sessionId: session.id,
          learnerId: m.learnerId,
          schoolLocalDate: input.schoolLocalDate,
          attendance: "PRESENT",
          progress: "WAITING",
          note: null,
        }
      );
    }
  }
  return rows;
}

export function validateNewSessionInput(input: {
  weekday: string;
  startTime: string;
  endTime: string;
  responsibleAdult: string;
  kind: HsCgGroupKind;
}): { weekday: HsCgWeekday; startTime: string; endTime: string; responsibleAdult: string } {
  if (!isHsCgWeekday(input.weekday)) {
    throw new HsCgDomainError("VALIDATION", "Weekday must be Mon–Fri");
  }
  const times = validateCollectionScheduleTimes(input.startTime, input.endTime);
  if (!times.ok) {
    throw new HsCgDomainError("VALIDATION", times.message);
  }
  const adult = String(input.responsibleAdult || "").trim();
  if (input.kind === "ACTIVITY" && !adult) {
    throw new HsCgDomainError("VALIDATION", "Responsible adult is required for activity sessions");
  }
  return {
    weekday: input.weekday,
    startTime: times.startTime,
    endTime: times.endTime,
    responsibleAdult: adult || "Driver",
  };
}
