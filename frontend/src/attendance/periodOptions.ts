export const ATTENDANCE_PERIOD_OPTIONS = [
  { value: "DAILY", label: "Daily" },
  { value: "PERIOD_1", label: "Period 1" },
  { value: "PERIOD_2", label: "Period 2" },
  { value: "PERIOD_3", label: "Period 3" },
  { value: "PERIOD_4", label: "Period 4" },
  { value: "PERIOD_5", label: "Period 5" },
  { value: "PERIOD_6", label: "Period 6" },
  { value: "PERIOD_7", label: "Period 7" },
  { value: "AFTERCARE", label: "Aftercare" },
] as const;

export type AttendancePeriodValue = (typeof ATTENDANCE_PERIOD_OPTIONS)[number]["value"];

export const DEFAULT_ATTENDANCE_PERIOD: AttendancePeriodValue = "DAILY";
