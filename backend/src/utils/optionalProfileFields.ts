/**
 * Optional profile date/text helpers for Parent.birthDate and Learner medical/admission fields.
 * Blank → null. Invalid date → throw (callers map to 400). Never invent values.
 */

import { parseDateOnly } from "./attendancePeriods";

export class OptionalProfileFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OptionalProfileFieldError";
  }
}

/** Parse optional YYYY-MM-DD (or ISO date) → Date at UTC midnight, or null if blank. */
export function parseOptionalDateOnlyField(
  raw: unknown,
  fieldLabel: string
): Date | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "string" && !raw.trim()) return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) {
      throw new OptionalProfileFieldError(`Invalid ${fieldLabel}`);
    }
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, "0");
    const d = String(raw.getUTCDate()).padStart(2, "0");
    const parsed = parseDateOnly(`${y}-${m}-${d}`);
    if (!parsed) throw new OptionalProfileFieldError(`Invalid ${fieldLabel}`);
    return parsed;
  }
  const s = String(raw).trim();
  // Accept full ISO by taking date part
  const ymd = s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
  const parsed = parseDateOnly(ymd);
  if (!parsed) {
    throw new OptionalProfileFieldError(`Invalid ${fieldLabel}`);
  }
  return parsed;
}

/** Format Date → YYYY-MM-DD for API clients, or null. */
export function formatDateOnlyUtc(value: Date | null | undefined): string | null {
  if (!value) return null;
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, "0");
  const d = String(value.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseOptionalTrimmedText(
  raw: unknown,
  opts: { maxLength: number; fieldLabel: string }
): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.length > opts.maxLength) {
    throw new OptionalProfileFieldError(
      `${opts.fieldLabel} must be at most ${opts.maxLength} characters`
    );
  }
  return s;
}

/** Strict legacy notes pattern used by SA-SAMS import. */
export const ENROLMENT_DATE_NOTES_REGEX = /Enrolment date:\s*(\d{4}-\d{2}-\d{2})/i;

export function parseEnrolmentDateFromNotes(notes: string | null | undefined): string | null {
  const match = String(notes || "").match(ENROLMENT_DATE_NOTES_REGEX);
  if (!match?.[1]) return null;
  return parseDateOnly(match[1]) ? match[1] : null;
}

/**
 * Authoritative enrolment/admission date for API responses.
 * Prefer admissionDate; transitional: notes regex only; NEVER createdAt.
 */
export function resolveAuthoritativeAdmissionDateYmd(learner: {
  admissionDate?: Date | null;
  notes?: string | null;
}): string | null {
  if (learner.admissionDate) {
    return formatDateOnlyUtc(learner.admissionDate);
  }
  return parseEnrolmentDateFromNotes(learner.notes);
}

export const ALLERGIES_MAX_LENGTH = 4000;
export const MEDICAL_ALERT_MAX_LENGTH = 500;
