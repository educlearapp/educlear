/**
 * Shared capture-session types for Period Mode vs Subject Mode attendance UI.
 */
import {
  ATTENDANCE_PERIOD_OPTIONS,
  DEFAULT_ATTENDANCE_PERIOD,
  type AttendancePeriodValue,
} from "./periodOptions";

export type CaptureSessionMode = "PERIODS" | "SUBJECTS";

export type CaptureSessionOption = {
  period: string;
  label: string;
  subjectId?: string | null;
  subjectName?: string | null;
  sortOrder?: number;
  slotId?: string | null;
  sessionIndex?: number;
  sessionCountForSubject?: number;
};

export type CaptureSessionsResponse = {
  success: boolean;
  mode: CaptureSessionMode;
  sessions: CaptureSessionOption[];
  emptyMessage?: string | null;
  error?: string;
};

export const SUBJECTS_EMPTY_MESSAGE =
  "No subject sessions are scheduled for this classroom on the selected date.";

export function periodModeFallbackSessions(): CaptureSessionOption[] {
  return ATTENDANCE_PERIOD_OPTIONS.map((opt) => ({
    period: opt.value,
    label: opt.label,
    subjectId: null,
  }));
}

export function defaultSessionForMode(
  mode: CaptureSessionMode,
  sessions: CaptureSessionOption[]
): string {
  if (mode === "SUBJECTS") {
    return sessions[0]?.period || "";
  }
  return DEFAULT_ATTENDANCE_PERIOD;
}

export function isAttendancePeriodValue(value: string): value is AttendancePeriodValue {
  return (ATTENDANCE_PERIOD_OPTIONS as readonly { value: string }[]).some((o) => o.value === value);
}

export function resolveSelectedSessionLabel(
  period: string,
  sessions: CaptureSessionOption[],
  mode: CaptureSessionMode
): string {
  const fromApi = sessions.find((s) => s.period === period);
  if (fromApi?.label) return fromApi.label;
  if (mode === "PERIODS" || isAttendancePeriodValue(period)) {
    return ATTENDANCE_PERIOD_OPTIONS.find((o) => o.value === period)?.label || period;
  }
  return period;
}
