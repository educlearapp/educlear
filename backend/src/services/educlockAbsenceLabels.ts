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

export const ABSENCE_CLOCK_IN_BLOCKED_MESSAGE =
  "You have already reported yourself absent today. Please contact management if you are now reporting for work.";

export const ABSENCE_AFTER_CLOCK_IN_MESSAGE =
  "You have already clocked in today and cannot report yourself absent. Please contact management if your attendance needs to be corrected.";
