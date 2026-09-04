export const STAFF_MOVEMENT_REASONS = [
  "SCHOOL_BUSINESS",
  "MEETING",
  "COLLECT_DELIVER",
  "PERSONAL",
  "MEDICAL",
  "BANK_ERRAND",
  "EMERGENCY",
  "TRAINING_OFFICIAL_DUTY",
  "OTHER",
] as const;

export type StaffMovementReasonCode = (typeof STAFF_MOVEMENT_REASONS)[number];

export const STAFF_MOVEMENT_REASON_LABELS: Record<StaffMovementReasonCode, string> = {
  SCHOOL_BUSINESS: "School Business",
  MEETING: "Meeting",
  COLLECT_DELIVER: "Collect / Deliver",
  PERSONAL: "Personal",
  MEDICAL: "Medical",
  BANK_ERRAND: "Bank / Errand",
  EMERGENCY: "Emergency",
  TRAINING_OFFICIAL_DUTY: "Training / Official Duty",
  OTHER: "Other",
};

export const MOVEMENT_DESTINATION_REQUIRED_REASONS: StaffMovementReasonCode[] = [
  "SCHOOL_BUSINESS",
  "MEETING",
  "COLLECT_DELIVER",
];

export function movementReasonLabel(reason: unknown): string {
  const code = String(reason || "").trim() as StaffMovementReasonCode;
  return STAFF_MOVEMENT_REASON_LABELS[code] || String(reason || "");
}

export function movementNoteRequired(reason: unknown): boolean {
  return String(reason || "").trim().toUpperCase() === "OTHER";
}

export function movementDestinationRequired(reason: unknown): boolean {
  const code = String(reason || "").trim().toUpperCase() as StaffMovementReasonCode;
  return MOVEMENT_DESTINATION_REQUIRED_REASONS.includes(code);
}

export function validateStaffMovementForm(input: {
  reason: string;
  destination: string;
  note: string;
}): { ok: true } | { ok: false; error: string } {
  const reason = String(input.reason || "").trim();
  if (!reason) return { ok: false, error: "Select a reason." };
  if (!STAFF_MOVEMENT_REASONS.includes(reason as StaffMovementReasonCode)) {
    return { ok: false, error: "Select a reason." };
  }
  const destination = String(input.destination || "").trim();
  if (movementDestinationRequired(reason) && !destination) {
    return { ok: false, error: "Destination is required for this reason." };
  }
  if (destination.length > 200) return { ok: false, error: "Destination must be at most 200 characters." };
  const note = String(input.note || "").trim();
  if (movementNoteRequired(reason) && !note) {
    return { ok: false, error: "A note is required when reason is Other." };
  }
  if (note.length > 500) return { ok: false, error: "Note must be at most 500 characters." };
  return { ok: true };
}

export function formatElapsedAwayMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export const MOVEMENT_STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
};

export function movementStatusLabel(status: unknown): string {
  const key = String(status || "").trim();
  return MOVEMENT_STATUS_LABELS[key] || key || "—";
}
