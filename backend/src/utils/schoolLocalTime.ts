/**
 * School-local calendar parts for HomeSafe and similar features.
 * EduClear has no per-school timezone field yet; default matches ZA schools (en-ZA display policy).
 */
export const DEFAULT_SCHOOL_TIMEZONE =
  process.env.EDUCLEAR_SCHOOL_TIMEZONE || "Africa/Johannesburg";

export type SchoolLocalParts = {
  schoolLocalDate: string;
  schoolLocalTime: string;
  timezone: string;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Resolve YYYY-MM-DD and HH:mm:ss in the configured school timezone from a UTC instant. */
export function resolveSchoolLocalParts(
  occurredAt: Date,
  timezone: string = DEFAULT_SCHOOL_TIMEZONE
): SchoolLocalParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(occurredAt);

  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value || "";

  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  let hour = pick("hour");
  if (hour === "24") hour = "00";

  return {
    schoolLocalDate: `${year}-${month}-${day}`,
    schoolLocalTime: `${hour}:${pick("minute")}:${pick("second")}`,
    timezone,
  };
}

/** Human-readable local time for UI (HH:mm). */
export function formatSchoolLocalTimeDisplay(schoolLocalTime: string): string {
  const match = String(schoolLocalTime || "").match(/^(\d{2}):(\d{2})/);
  if (!match) return schoolLocalTime;
  return `${match[1]}:${match[2]}`;
}
