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

export const MOVEMENT_LEAVE_REQUIRES_CLOCK_IN_MESSAGE =
  "You must be clocked in before leaving premises.";

export const MOVEMENT_LEAVE_ABSENT_MESSAGE =
  "You have reported yourself absent today and cannot leave premises.";

export const MOVEMENT_ALREADY_OPEN_MESSAGE =
  "You already have an open movement. Return before leaving again.";

export const MOVEMENT_RETURN_NO_OPEN_MESSAGE =
  "You have no open movement to return from.";

export const MOVEMENT_CLOCK_OUT_BLOCKED_MESSAGE =
  "You are currently off premises. Return to school before clocking out.";
