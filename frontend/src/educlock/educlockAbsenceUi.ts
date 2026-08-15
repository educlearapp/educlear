export const STAFF_ABSENCE_REASONS = [
  "SICK",
  "FAMILY_RESPONSIBILITY",
  "EMERGENCY",
  "MEDICAL_APPOINTMENT",
  "APPROVED_LEAVE",
  "UNPAID_LEAVE",
  "TRAINING_OFFICIAL_DUTY",
  "OTHER",
] as const;

export type StaffAbsenceReasonCode = (typeof STAFF_ABSENCE_REASONS)[number];

export const STAFF_ABSENCE_REASON_LABELS: Record<StaffAbsenceReasonCode, string> = {
  SICK: "Sick",
  FAMILY_RESPONSIBILITY: "Family Responsibility",
  EMERGENCY: "Emergency",
  MEDICAL_APPOINTMENT: "Medical Appointment",
  APPROVED_LEAVE: "Approved Leave",
  UNPAID_LEAVE: "Unpaid Leave",
  TRAINING_OFFICIAL_DUTY: "Training / Official Duty",
  OTHER: "Other",
};

export function absenceReasonLabel(reason: unknown): string {
  const code = String(reason || "").trim() as StaffAbsenceReasonCode;
  return STAFF_ABSENCE_REASON_LABELS[code] || String(reason || "");
}

export function absenceNoteRequired(reason: unknown): boolean {
  return String(reason || "").trim().toUpperCase() === "OTHER";
}

export function formatSchoolLocalDateLong(isoDate: string): string {
  const d = String(isoDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d || "—";
  return new Date(`${d}T12:00:00+02:00`).toLocaleDateString("en-ZA", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Johannesburg",
  });
}

export function validateStaffAbsenceForm(input: { reason: string; note: string }): { ok: true } | { ok: false; error: string } {
  const reason = String(input.reason || "").trim();
  if (!reason) return { ok: false, error: "Select a reason." };
  if (!STAFF_ABSENCE_REASONS.includes(reason as StaffAbsenceReasonCode)) {
    return { ok: false, error: "Select a reason." };
  }
  const note = String(input.note || "").trim();
  if (absenceNoteRequired(reason) && !note) {
    return { ok: false, error: "A note is required when reason is Other." };
  }
  if (note.length > 500) return { ok: false, error: "Note must be at most 500 characters." };
  return { ok: true };
}

export const ABSENCE_SOURCE_LABELS: Record<string, string> = {
  STAFF_SELF_REPORT: "Staff self-report",
};

export const ABSENCE_APPROVAL_LABELS: Record<string, string> = {
  REPORTED: "Reported",
  AUTHORISED: "Authorised",
  UNAUTHORISED: "Unauthorised",
  CANCELLED: "Cancelled",
};

export function absenceSourceLabel(source: unknown): string {
  const key = String(source || "").trim();
  return ABSENCE_SOURCE_LABELS[key] || key || "—";
}

export function absenceApprovalLabel(status: unknown): string {
  const key = String(status || "").trim();
  return ABSENCE_APPROVAL_LABELS[key] || key || "—";
}

export function isAbsentStaffStatus(status: unknown): boolean {
  const s = String(status || "").trim();
  return (
    s === "ABSENT" ||
    s === "ABSENT_REPORTED" ||
    s === "Absent Reported" ||
    s.startsWith("Absent —") ||
    s.startsWith("Absent -")
  );
}
