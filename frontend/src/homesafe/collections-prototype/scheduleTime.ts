/** Scheduling window for Collections & Groups prototype only (not Early Departure). */

export const SCHEDULE_EARLIEST = "08:00";
export const SCHEDULE_LATEST = "16:00";

const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseHhMm(value: string): number | null {
  const raw = String(value || "").trim();
  const m = HH_MM.exec(raw);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatHhMm(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Normalise typed input to HH:mm when possible (accepts H:mm, HH.mm, HHMM). */
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

export function isWithinScheduleWindow(hhmm: string): boolean {
  const mins = parseHhMm(hhmm);
  if (mins === null) return false;
  const earliest = parseHhMm(SCHEDULE_EARLIEST)!;
  const latest = parseHhMm(SCHEDULE_LATEST)!;
  return mins >= earliest && mins <= latest;
}

export type ScheduleTimeValidation =
  | { ok: true; start: string; end: string }
  | { ok: false; message: string };

/**
 * Validate activity / transport schedule times.
 * Window 08:00–16:00 inclusive; end must be after start; HH:mm only.
 */
export function validateScheduleTimes(startRaw: string, endRaw: string): ScheduleTimeValidation {
  const start = normaliseHhMmInput(startRaw);
  const end = normaliseHhMmInput(endRaw);
  if (!start) {
    return { ok: false, message: "Start time must be HH:mm (24-hour), e.g. 08:00." };
  }
  if (!end) {
    return { ok: false, message: "End time must be HH:mm (24-hour), e.g. 16:00." };
  }
  if (!isWithinScheduleWindow(start)) {
    return {
      ok: false,
      message: `Start time must be between ${SCHEDULE_EARLIEST} and ${SCHEDULE_LATEST} inclusive.`,
    };
  }
  if (!isWithinScheduleWindow(end)) {
    return {
      ok: false,
      message: `End time must be between ${SCHEDULE_EARLIEST} and ${SCHEDULE_LATEST} inclusive.`,
    };
  }
  const startMins = parseHhMm(start)!;
  const endMins = parseHhMm(end)!;
  if (endMins <= startMins) {
    return { ok: false, message: "End time must be later than start time." };
  }
  return { ok: true, start, end };
}

export const SCHEDULE_TIME_HINT = `Times use 24-hour HH:mm and must fall between ${SCHEDULE_EARLIEST} and ${SCHEDULE_LATEST} inclusive.`;
