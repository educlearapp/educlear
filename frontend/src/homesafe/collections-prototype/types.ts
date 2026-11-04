/** Local interactive prototype types — fictional data only. Not persisted. */

export type Weekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri";

export type GroupKind = "TRANSPORT" | "ACTIVITY";

export type AttendanceMark = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED" | "UNCONFIRMED";

/** Progress on a dated session register (transport or activity). */
export type ProgressState =
  | "WAITING"
  | "CALLED"
  | "READY"
  | "COLLECTED"
  | "HANDED_OVER"
  | "RETURNED"
  | "PARTICIPATING"
  | "COMPLETED"
  | "AWAY";

export type DemoLearner = {
  id: string;
  firstName: string;
  lastName: string;
  className: string;
  /** Initials avatar colour */
  hue: number;
  /** Per-learner authorisation to leave with Bus A driver (demo). */
  transportAuthorised: boolean;
};

export type DemoSession = {
  id: string;
  groupId: string;
  weekday: Weekday;
  start: string; // HH:MM
  end: string;
  responsibleAdult: string;
  location?: string;
};

export type DemoGroup = {
  id: string;
  kind: GroupKind;
  name: string;
  /** Transport only */
  driverName?: string;
  driverContact?: string;
  vehicleReg?: string;
  driverInitials?: string;
};

/** Learner assigned to a specific recurring session (not just the activity). */
export type SessionMembership = {
  learnerId: string;
  sessionId: string;
};

export type DatedException =
  | { type: "SKIP_TODAY"; learnerId: string; date: string; reason?: string }
  | { type: "ADD_TODAY"; learnerId: string; sessionId: string; date: string }
  | { type: "PARENT_COLLECT_TODAY"; learnerId: string; date: string }
  | { type: "CANCEL_OCCURRENCE"; sessionId: string; date: string }
  | { type: "CANCEL_FUTURE"; sessionId: string; fromDate: string }
  | { type: "RESCHEDULE_OCCURRENCE"; sessionId: string; date: string; newStart: string; newEnd: string };

export type RegisterRow = {
  learnerId: string;
  sessionId: string;
  date: string;
  attendance: AttendanceMark;
  progress: ProgressState;
  collectionAuthorised: boolean;
  alreadyHomeDismissed: boolean;
  note?: string;
};

export type TeacherCallAck = {
  sessionId: string;
  date: string;
  classroom: string;
  teacherName: string;
  status: "PENDING" | "ACKNOWLEDGED";
  acknowledgedAt?: string;
};

export type DemoLogLine = {
  id: string;
  at: string;
  text: string;
};
