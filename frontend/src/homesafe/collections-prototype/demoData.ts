import type {
  AttendanceMark,
  DemoGroup,
  DemoLearner,
  DemoSession,
  DatedException,
  RegisterRow,
  SessionMembership,
  TeacherCallAck,
  Weekday,
} from "./types";

/**
 * LOCAL DEMONSTRATION FIXTURE ONLY.
 * Named groups (Bus A, Swimming, Soccer, Jivacise) exist solely to exercise the prototype UI.
 * Real schools must never be auto-seeded with these names — schools create Transport/Activity
 * groups and choose their own names, sessions and responsible adults.
 */

/** Fixed demo week Mon–Fri around Wed 4 Nov 2026. */
export const DEMO_DATES = {
  monday: "2026-11-02",
  tuesday: "2026-11-03",
  wednesday: "2026-11-04",
  thursday: "2026-11-05",
  friday: "2026-11-06",
} as const;

export const DEMO_DATE_OPTIONS: { value: string; label: string; weekday: Weekday }[] = [
  { value: DEMO_DATES.monday, label: "Monday 2 Nov 2026", weekday: "Mon" },
  { value: DEMO_DATES.tuesday, label: "Tuesday 3 Nov 2026", weekday: "Tue" },
  { value: DEMO_DATES.wednesday, label: "Wednesday 4 Nov 2026", weekday: "Wed" },
  { value: DEMO_DATES.thursday, label: "Thursday 5 Nov 2026", weekday: "Thu" },
  { value: DEMO_DATES.friday, label: "Friday 6 Nov 2026", weekday: "Fri" },
];

export const DEMO_CLASSES = ["Grade 2A", "Grade 2B", "Grade 3A"] as const;

export const DEMO_LEARNERS: DemoLearner[] = [
  { id: "l-emma", firstName: "Emma", lastName: "Naidoo", className: "Grade 2B", hue: 32, transportAuthorised: true },
  { id: "l-liam", firstName: "Liam", lastName: "Botha", className: "Grade 2A", hue: 200, transportAuthorised: true },
  { id: "l-thabo", firstName: "Thabo", lastName: "Molefe", className: "Grade 2A", hue: 145, transportAuthorised: true },
  { id: "l-aisha", firstName: "Aisha", lastName: "Khan", className: "Grade 2B", hue: 280, transportAuthorised: true },
  { id: "l-noah", firstName: "Noah", lastName: "Peters", className: "Grade 3A", hue: 18, transportAuthorised: true },
  { id: "l-maya", firstName: "Maya", lastName: "Singh", className: "Grade 2A", hue: 340, transportAuthorised: true },
  { id: "l-leo", firstName: "Leo", lastName: "Dlamini", className: "Grade 2B", hue: 210, transportAuthorised: true },
  { id: "l-zara", firstName: "Zara", lastName: "Jacobs", className: "Grade 3A", hue: 50, transportAuthorised: true },
  { id: "l-kai", firstName: "Kai", lastName: "Ndlovu", className: "Grade 2A", hue: 120, transportAuthorised: false },
  { id: "l-sara", firstName: "Sara", lastName: "Williams", className: "Grade 2B", hue: 260, transportAuthorised: true },
  { id: "l-owen", firstName: "Owen", lastName: "Pillay", className: "Grade 3A", hue: 90, transportAuthorised: true },
];

export const DEMO_GROUPS: DemoGroup[] = [
  {
    id: "g-bus-a",
    kind: "TRANSPORT",
    name: "Bus A",
    driverName: "Nomsa Dlamini",
    driverContact: "082 555 0142",
    vehicleReg: "CA 123 GP",
    driverInitials: "ND",
  },
  {
    id: "g-swim",
    kind: "ACTIVITY",
    name: "Swimming",
  },
  {
    id: "g-jiva",
    kind: "ACTIVITY",
    name: "Jivacise",
  },
  {
    id: "g-soccer",
    kind: "ACTIVITY",
    name: "Soccer",
  },
];

/** All times within 08:00–16:00 inclusive (HH:mm). */
export const DEMO_SESSIONS: DemoSession[] = [
  // Bus A — Mon–Fri pickup (different end padding still within window)
  {
    id: "s-bus-a-mon",
    groupId: "g-bus-a",
    weekday: "Mon",
    start: "14:30",
    end: "14:45",
    responsibleAdult: "Nomsa Dlamini",
    location: "Front gate",
  },
  {
    id: "s-bus-a-tue",
    groupId: "g-bus-a",
    weekday: "Tue",
    start: "14:30",
    end: "14:45",
    responsibleAdult: "Nomsa Dlamini",
    location: "Front gate",
  },
  {
    id: "s-bus-a-wed",
    groupId: "g-bus-a",
    weekday: "Wed",
    start: "14:30",
    end: "14:45",
    responsibleAdult: "Nomsa Dlamini",
    location: "Front gate",
  },
  {
    id: "s-bus-a-thu",
    groupId: "g-bus-a",
    weekday: "Thu",
    start: "14:15",
    end: "14:30",
    responsibleAdult: "Nomsa Dlamini",
    location: "Front gate",
  },
  {
    id: "s-bus-a-fri",
    groupId: "g-bus-a",
    weekday: "Fri",
    start: "14:30",
    end: "14:45",
    responsibleAdult: "Nomsa Dlamini",
    location: "Front gate",
  },
  // Swimming — Mon (two slots), Wed, Tue review slot
  {
    id: "s-swim-mon-1000",
    groupId: "g-swim",
    weekday: "Mon",
    start: "10:00",
    end: "10:30",
    responsibleAdult: "Coach R. Adams",
    location: "Pool",
  },
  {
    id: "s-swim-mon-1045",
    groupId: "g-swim",
    weekday: "Mon",
    start: "10:45",
    end: "11:15",
    responsibleAdult: "Coach R. Adams",
    location: "Pool",
  },
  {
    id: "s-swim-tue-0900",
    groupId: "g-swim",
    weekday: "Tue",
    start: "09:00",
    end: "09:30",
    responsibleAdult: "Coach R. Adams",
    location: "Pool",
  },
  {
    id: "s-swim-wed-1045",
    groupId: "g-swim",
    weekday: "Wed",
    start: "10:45",
    end: "11:15",
    responsibleAdult: "Coach R. Adams",
    location: "Pool",
  },
  {
    id: "s-swim-thu-1330",
    groupId: "g-swim",
    weekday: "Thu",
    start: "13:30",
    end: "14:00",
    responsibleAdult: "Coach R. Adams",
    location: "Pool",
  },
  // Jivacise Fri + Tue review
  {
    id: "s-jiva-tue-1115",
    groupId: "g-jiva",
    weekday: "Tue",
    start: "11:15",
    end: "12:00",
    responsibleAdult: "Ms Patel",
    location: "Hall",
  },
  {
    id: "s-jiva-fri",
    groupId: "g-jiva",
    weekday: "Fri",
    start: "09:00",
    end: "09:45",
    responsibleAdult: "Ms Patel",
    location: "Hall",
  },
  // Soccer Mon conflict + Thu
  {
    id: "s-soccer-mon-1015",
    groupId: "g-soccer",
    weekday: "Mon",
    start: "10:15",
    end: "11:00",
    responsibleAdult: "Mr Steyn",
    location: "Field",
  },
  {
    id: "s-soccer-thu-0800",
    groupId: "g-soccer",
    weekday: "Thu",
    start: "08:00",
    end: "08:45",
    responsibleAdult: "Mr Steyn",
    location: "Field",
  },
];

/** Bus A members (10). Maya also has soccer conflict with swimming. */
export const BUS_A_LEARNER_IDS = [
  "l-emma",
  "l-liam",
  "l-thabo",
  "l-aisha",
  "l-noah",
  "l-maya",
  "l-leo",
  "l-zara",
  "l-kai",
  "l-sara",
] as const;

export const BUS_A_SESSION_IDS = [
  "s-bus-a-mon",
  "s-bus-a-tue",
  "s-bus-a-wed",
  "s-bus-a-thu",
  "s-bus-a-fri",
] as const;

export function buildInitialMemberships(): SessionMembership[] {
  const bus: SessionMembership[] = BUS_A_LEARNER_IDS.flatMap((learnerId) =>
    BUS_A_SESSION_IDS.map((sessionId) => ({ learnerId, sessionId }))
  );

  return [
    ...bus,
    { learnerId: "l-emma", sessionId: "s-swim-mon-1000" },
    { learnerId: "l-emma", sessionId: "s-swim-wed-1045" },
    { learnerId: "l-emma", sessionId: "s-jiva-fri" },
    { learnerId: "l-liam", sessionId: "s-swim-mon-1045" },
    // Conflict demo: Maya swimming 10:00–10:30 AND soccer 10:15–11:00 on Monday
    { learnerId: "l-maya", sessionId: "s-swim-mon-1000" },
    { learnerId: "l-maya", sessionId: "s-soccer-mon-1015" },
    { learnerId: "l-owen", sessionId: "s-swim-mon-1045" },
    // Tuesday / Thursday review assignments
    { learnerId: "l-emma", sessionId: "s-swim-tue-0900" },
    { learnerId: "l-liam", sessionId: "s-jiva-tue-1115" },
    { learnerId: "l-sara", sessionId: "s-jiva-tue-1115" },
    { learnerId: "l-leo", sessionId: "s-soccer-thu-0800" },
    { learnerId: "l-zara", sessionId: "s-soccer-thu-0800" },
    { learnerId: "l-emma", sessionId: "s-swim-thu-1330" },
    { learnerId: "l-owen", sessionId: "s-swim-thu-1330" },
  ];
}

export function buildInitialExceptions(): DatedException[] {
  return [
    {
      type: "PARENT_COLLECT_TODAY",
      learnerId: "l-noah",
      date: DEMO_DATES.wednesday,
    },
  ];
}

function attendanceFor(learnerId: string): AttendanceMark {
  if (learnerId === "l-thabo") return "ABSENT";
  if (learnerId === "l-aisha") return "UNCONFIRMED";
  return "PRESENT";
}

export function buildInitialRegisters(date: string, weekday: Weekday): RegisterRow[] {
  const sessionsToday = DEMO_SESSIONS.filter((s) => s.weekday === weekday);
  const memberships = buildInitialMemberships();
  const exceptions = buildInitialExceptions();
  const rows: RegisterRow[] = [];

  for (const session of sessionsToday) {
    const cancelled = exceptions.some(
      (e) =>
        (e.type === "CANCEL_OCCURRENCE" && e.sessionId === session.id && e.date === date) ||
        (e.type === "CANCEL_FUTURE" && e.sessionId === session.id && e.fromDate <= date)
    );
    if (cancelled) continue;

    const memberIds = new Set(
      memberships.filter((m) => m.sessionId === session.id).map((m) => m.learnerId)
    );
    for (const ex of exceptions) {
      if (ex.type === "ADD_TODAY" && ex.sessionId === session.id && ex.date === date) {
        memberIds.add(ex.learnerId);
      }
      if (ex.type === "SKIP_TODAY" && ex.date === date) {
        memberIds.delete(ex.learnerId);
      }
    }

    for (const learnerId of memberIds) {
      const learner = DEMO_LEARNERS.find((l) => l.id === learnerId);
      const att = attendanceFor(learnerId);
      const parentCollect =
        exceptions.some(
          (e) => e.type === "PARENT_COLLECT_TODAY" && e.learnerId === learnerId && e.date === date
        ) && session.groupId === "g-bus-a";

      rows.push({
        learnerId,
        sessionId: session.id,
        date,
        attendance: att,
        progress: "WAITING",
        collectionAuthorised: learner?.transportAuthorised ?? false,
        alreadyHomeDismissed: false,
        note: parentCollect ? "Parent collecting today (exception)" : undefined,
      });
    }
  }

  return rows;
}

export function weekdayForDate(date: string): Weekday | null {
  const opt = DEMO_DATE_OPTIONS.find((d) => d.value === date);
  return opt?.weekday ?? null;
}

export function learnerDisplayName(
  id: string,
  catalog: { id: string; firstName: string; lastName: string }[] = DEMO_LEARNERS
): string {
  const l = catalog.find((x) => x.id === id);
  return l ? `${l.firstName} ${l.lastName}` : id;
}

export function emptyTeacherCalls(): TeacherCallAck[] {
  return [];
}
