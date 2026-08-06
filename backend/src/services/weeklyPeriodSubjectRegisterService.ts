/**
 * Weekly Period / Subject Attendance Register builder.
 * Preserves existing daily/weekly/monthly reports — this is a separate payload.
 */
import type { AttendanceSessionDisplay, AttendanceStatus } from "@prisma/client";
import { prisma } from "../prisma";
import {
  activeLearnerWhere,
  resolveLearnerClassroomLabel,
} from "../utils/learnerEnrollment";
import { parseDateOnly, periodLabel } from "../utils/attendancePeriods";
import {
  buildAttendanceReasonLegend,
  resolveRegisterDisplay,
} from "../utils/attendanceReasonCodes";
import {
  PERIOD_REGISTER_COLUMNS,
  INTERVENTION_SESSION,
  isNonSubjectClassicSession,
  isSubjectSlotPeriod,
  subjectSlotPeriodKey,
} from "../utils/attendanceSessionKeys";
import { DEFAULT_SCHOOL_TIMEZONE } from "../utils/schoolLocalTime";

export const LEGACY_SUBJECT_NOTICE =
  "Some historical attendance records were captured before subject tracking was introduced and cannot be assigned to a specific subject.";

export const SUBJECT_NOT_RECORDED_LABEL = "Subject not recorded";

export type WeeklyRegisterDisplayMode = "Automatic" | "Periods" | "Subjects";
export type WeeklyRegisterResolvedMode = "PERIODS" | "SUBJECTS";

export type WeeklyRegisterCellStatus =
  | "PRESENT"
  | "ABSENT"
  | "LATE"
  | "EXCUSED"
  | "NOT_CAPTURED"
  | "NOT_SCHEDULED";

export type WeeklyRegisterSessionColumn = {
  key: string;
  dayOfWeek: number;
  date: string;
  dayLabel: string;
  sessionLabel: string;
  period?: string;
  subjectId?: string | null;
  subjectName?: string | null;
  legacyMissingSubject?: boolean;
};

export type WeeklyRegisterCell = {
  columnKey: string;
  status: WeeklyRegisterCellStatus;
  /** Display mark in the grid (reason code when present, else P/A/L/E/NC/NS). */
  abbrev: string;
  label: string;
  captureTime?: string | null;
  capturingTeacher?: string | null;
  /** Original free-text reason from capture (never discarded). */
  reason?: string | null;
  /** True when abbrev came from a teacher reason code/synonym. */
  fromReasonCode?: boolean;
  /** Teacher note after extracting a leading reason code (if any). */
  teacherNote?: string | null;
  subjectId?: string | null;
  subjectLabel?: string | null;
};

export type WeeklyRegisterLearnerRow = {
  learnerId: string;
  fullName: string;
  grade: string;
  className: string;
  cells: WeeklyRegisterCell[];
  attendancePercentage: number | null;
  present: number;
  absent: number;
  late: number;
  excused: number;
  notCaptured: number;
  notScheduled: number;
  eligibleSessions: number;
  attended: number;
};

export type WeeklyRegisterSummary = {
  totalLearners: number;
  scheduledSessions: number;
  capturedSessions: number;
  notCapturedSessions: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  overallAttendancePercentage: number | null;
  learnersWith100Percent: number;
  learnersBelow90Percent: number;
};

export type WeeklyPeriodSubjectRegisterReport = {
  schoolId: string;
  schoolName: string;
  weekStart: string;
  weekEnd: string;
  timezone: string;
  className: string;
  gradeFilter: string | null;
  teacherFilter: string | null;
  displayModeRequested: WeeklyRegisterDisplayMode;
  displayModeResolved: WeeklyRegisterResolvedMode;
  classroomAttendanceSessionDisplay: AttendanceSessionDisplay | null;
  columns: WeeklyRegisterSessionColumn[];
  dayGroups: Array<{ date: string; dayLabel: string; columnKeys: string[] }>;
  learners: WeeklyRegisterLearnerRow[];
  summary: WeeklyRegisterSummary;
  legacySubjectNotice: string | null;
  statusLegend: Array<{ abbrev: string; label: string }>;
  generatedAt: string;
};

const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function ymdFromDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = parseDateOnly(ymd);
  if (!d) return ymd;
  d.setUTCDate(d.getUTCDate() + days);
  return ymdFromDate(d);
}

/** Monday–Friday inclusive for the week containing anchor (date-only UTC noon). */
export function mondayFridayOfWeek(anchorYmd: string): { weekStart: string; weekEnd: string; dates: string[] } {
  const anchor = parseDateOnly(anchorYmd);
  if (!anchor) {
    throw new Error("Valid week date required (YYYY-MM-DD)");
  }
  const utcDay = anchor.getUTCDay(); // 0 Sun
  const toMonday = utcDay === 0 ? -6 : 1 - utcDay;
  const weekStart = addDaysYmd(anchorYmd, toMonday);
  const dates: string[] = [];
  for (let i = 0; i < 5; i += 1) dates.push(addDaysYmd(weekStart, i));
  return { weekStart, weekEnd: dates[4], dates };
}

export function resolveWeeklyDisplayMode(opts: {
  requested: WeeklyRegisterDisplayMode;
  classroomMode: AttendanceSessionDisplay | null | undefined;
}): WeeklyRegisterResolvedMode {
  if (opts.requested === "Periods") return "PERIODS";
  if (opts.requested === "Subjects") return "SUBJECTS";
  return opts.classroomMode === "SUBJECTS" ? "SUBJECTS" : "PERIODS";
}

function toCellStatus(status: AttendanceStatus | null | undefined): WeeklyRegisterCellStatus {
  const key = String(status || "").toUpperCase();
  if (key === "PRESENT" || key === "ABSENT" || key === "LATE" || key === "EXCUSED") {
    return key as WeeklyRegisterCellStatus;
  }
  return "NOT_CAPTURED";
}

export function computeSessionPercentage(opts: {
  present: number;
  late: number;
  absent: number;
  excused: number;
  notCaptured: number;
}): { eligible: number; attended: number; percentage: number | null } {
  // Captured scheduled sessions only. Excused in denominator, not attended (existing policy).
  // Not Captured excluded from denominator. Not Scheduled excluded by caller.
  const eligible = opts.present + opts.late + opts.absent + opts.excused;
  const attended = opts.present + opts.late;
  if (eligible === 0) return { eligible: 0, attended: 0, percentage: null };
  return {
    eligible,
    attended,
    percentage: Math.round((attended / eligible) * 1000) / 10,
  };
}

export async function buildWeeklyPeriodSubjectRegister(input: {
  schoolId: string;
  weekAnchor: string;
  className: string;
  grade?: string | null;
  teacher?: string | null;
  displayMode?: WeeklyRegisterDisplayMode;
  learnerSearch?: string | null;
  statusFilter?: string | null;
}): Promise<WeeklyPeriodSubjectRegisterReport> {
  const schoolId = String(input.schoolId || "").trim();
  const className = String(input.className || "").trim();
  const weekAnchor = String(input.weekAnchor || "").trim();
  if (!schoolId) throw new Error("schoolId required");
  if (!className || className === "All Classrooms") {
    throw new Error("A specific classroom is required for the Weekly Period / Subject Register.");
  }
  if (!parseDateOnly(weekAnchor)) throw new Error("Valid week date required (YYYY-MM-DD)");

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new Error("School not found");

  const classroom = await prisma.classroom.findFirst({
    where: { schoolId, name: className },
    select: {
      id: true,
      name: true,
      attendanceSessionDisplay: true,
      teacherName: true,
      teacherEmail: true,
    },
  });

  const requested = (input.displayMode || "Automatic") as WeeklyRegisterDisplayMode;
  const resolved = resolveWeeklyDisplayMode({
    requested,
    classroomMode: classroom?.attendanceSessionDisplay,
  });

  const { weekStart, weekEnd, dates } = mondayFridayOfWeek(weekAnchor);
  const startDate = parseDateOnly(weekStart)!;
  const endDate = parseDateOnly(weekEnd)!;

  const gradeFilter = String(input.grade || "").trim() || null;
  const teacherFilter = String(input.teacher || "").trim() || null;
  if (teacherFilter && classroom) {
    const hay = `${classroom.teacherName} ${classroom.teacherEmail}`.toLowerCase();
    if (!hay.includes(teacherFilter.toLowerCase())) {
      // Teacher filter excludes this classroom — empty report
      return emptyReport({
        school,
        weekStart,
        weekEnd,
        className,
        gradeFilter,
        teacherFilter,
        requested,
        resolved,
        classroomMode: classroom.attendanceSessionDisplay,
      });
    }
  }

  const learnersRaw = await prisma.learner.findMany({
    where: {
      ...activeLearnerWhere(schoolId),
      OR: [{ className }, { grade: className }],
      ...(gradeFilter ? { grade: gradeFilter } : {}),
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      grade: true,
      className: true,
    },
  });

  const search = String(input.learnerSearch || "").trim().toLowerCase();
  const learnersFiltered = search
    ? learnersRaw.filter((l) =>
        `${l.firstName} ${l.lastName}`.toLowerCase().includes(search)
      )
    : learnersRaw;

  const learnerIds = learnersFiltered.map((l) => l.id);

  const marks =
    learnerIds.length === 0
      ? []
      : await prisma.learnerAttendance.findMany({
          where: {
            schoolId,
            learnerId: { in: learnerIds },
            date: { gte: startDate, lte: endDate },
          },
          include: { subject: { select: { id: true, name: true } } },
        });

  const markMap = new Map<string, (typeof marks)[number]>();
  for (const m of marks) {
    markMap.set(`${m.learnerId}|${ymdFromDate(m.date)}|${m.period}`, m);
  }

  let columns: WeeklyRegisterSessionColumn[] = [];
  let legacySubjectNotice: string | null = null;

  if (resolved === "PERIODS") {
    for (const date of dates) {
      const dayOfWeek = parseDateOnly(date)!.getUTCDay();
      const dayLabel = WEEKDAY_LONG[dayOfWeek];
      for (const period of PERIOD_REGISTER_COLUMNS) {
        columns.push({
          key: `${date}|${period}`,
          dayOfWeek,
          date,
          dayLabel,
          sessionLabel: periodLabel(period),
          period,
        });
      }
      // Intervention is its own session (not Period 9). Show only when marks exist that day.
      const hasIntervention = marks.some(
        (m) => ymdFromDate(m.date) === date && m.period === INTERVENTION_SESSION
      );
      if (hasIntervention) {
        columns.push({
          key: `${date}|${INTERVENTION_SESSION}`,
          dayOfWeek,
          date,
          dayLabel,
          sessionLabel: periodLabel(INTERVENTION_SESSION),
          period: INTERVENTION_SESSION,
        });
      }
    }
  } else {
    // SUBJECTS mode — columns from classroom timetable slots
    const slots = classroom
      ? await prisma.classroomSubjectSlot.findMany({
          where: { schoolId, classroomId: classroom.id },
          include: { subject: { select: { id: true, name: true, active: true } } },
          orderBy: [{ dayOfWeek: "asc" }, { sortOrder: "asc" }],
        })
      : [];

    for (const date of dates) {
      const dayOfWeek = parseDateOnly(date)!.getUTCDay(); // 0 Sun … 6 Sat; Mon=1
      const dayLabel = WEEKDAY_LONG[dayOfWeek];
      const daySlots = slots.filter((s) => s.dayOfWeek === dayOfWeek);
      if (!daySlots.length) {
        // No scheduled subjects — still show a Not Scheduled placeholder column? Skip columns.
        continue;
      }
      for (const slot of daySlots) {
        columns.push({
          key: `${date}|${subjectSlotPeriodKey(slot.id)}`,
          dayOfWeek,
          date,
          dayLabel,
          sessionLabel: slot.subject.name,
          period: subjectSlotPeriodKey(slot.id),
          subjectId: slot.subjectId,
          subjectName: slot.subject.name,
        });
      }
    }

    // Detect legacy marks in week without subjectId (period-based captures in a SUBJECTS classroom week)
    const hasLegacy = marks.some(
      (m) =>
        !m.subjectId &&
        !isSubjectSlotPeriod(m.period) &&
        !isNonSubjectClassicSession(m.period)
    );
    // Also any mark with null subject while looking at subject register
    const hasNullSubject = marks.some((m) => !m.subjectId);
    if (hasLegacy || hasNullSubject) {
      legacySubjectNotice = LEGACY_SUBJECT_NOTICE;
    }

    // Append orphan columns for captured SLOT_ marks or subject-linked marks not in current timetable
    // so history isn't hidden — but never invent subject names for null subjectId period rows as subject columns.
    for (const m of marks) {
      if (!m.subjectId) continue;
      const date = ymdFromDate(m.date);
      const period = m.period;
      const key = `${date}|${period}`;
      if (columns.some((c) => c.key === key)) continue;
      if (!isSubjectSlotPeriod(period) && !PERIOD_REGISTER_COLUMNS.includes(period as never)) {
        // skip DAILY / Aftercare / Intervention etc.
        if (isNonSubjectClassicSession(period)) continue;
      }
      if (!isSubjectSlotPeriod(period)) continue;
      const dayOfWeek = parseDateOnly(date)!.getUTCDay();
      columns.push({
        key,
        dayOfWeek,
        date,
        dayLabel: WEEKDAY_LONG[dayOfWeek],
        sessionLabel: m.subject?.name || SUBJECT_NOT_RECORDED_LABEL,
        period,
        subjectId: m.subjectId,
        subjectName: m.subject?.name || null,
        legacyMissingSubject: !m.subject?.name,
      });
    }
    columns.sort((a, b) => a.date.localeCompare(b.date) || a.sessionLabel.localeCompare(b.sessionLabel));
  }

  const statusFilter = String(input.statusFilter || "All").trim();

  const learnerRows: WeeklyRegisterLearnerRow[] = [];
  for (const learner of learnersFiltered) {
    const cells: WeeklyRegisterCell[] = [];
    let present = 0;
    let absent = 0;
    let late = 0;
    let excused = 0;
    let notCaptured = 0;
    let notScheduled = 0;

    for (const col of columns) {
      const mark = markMap.get(`${learner.id}|${col.date}|${col.period || ""}`);
      let status: WeeklyRegisterCellStatus;
      if (resolved === "SUBJECTS" && !col.period) {
        status = "NOT_SCHEDULED";
      } else if (!mark) {
        // Scheduled session with no capture
        status = columns.length ? "NOT_CAPTURED" : "NOT_SCHEDULED";
        if (resolved === "SUBJECTS" && col.subjectId) status = "NOT_CAPTURED";
        if (resolved === "PERIODS") status = "NOT_CAPTURED";
      } else {
        status = toCellStatus(mark.status);
      }

      if (status === "PRESENT") present += 1;
      else if (status === "ABSENT") absent += 1;
      else if (status === "LATE") late += 1;
      else if (status === "EXCUSED") excused += 1;
      else if (status === "NOT_SCHEDULED") notScheduled += 1;
      else notCaptured += 1;

      const subjectLabel = mark
        ? mark.subject?.name || (mark.subjectId ? SUBJECT_NOT_RECORDED_LABEL : SUBJECT_NOT_RECORDED_LABEL)
        : col.subjectName || null;

      const display = resolveRegisterDisplay({
        status,
        reason: mark?.reason || null,
      });

      cells.push({
        columnKey: col.key,
        status,
        abbrev: display.abbrev,
        label: display.label,
        captureTime: mark?.updatedAt?.toISOString() || mark?.createdAt?.toISOString() || null,
        capturingTeacher: mark?.createdBy || null,
        reason: display.reason,
        fromReasonCode: display.fromReasonCode,
        teacherNote: display.teacherNote,
        subjectId: mark?.subjectId || col.subjectId || null,
        subjectLabel:
          resolved === "SUBJECTS"
            ? mark
              ? mark.subject?.name || SUBJECT_NOT_RECORDED_LABEL
              : col.subjectName || null
            : subjectLabel,
      });
    }

    const pct = computeSessionPercentage({ present, late, absent, excused, notCaptured: 0 });
    // notCaptured excluded from % denominator per rules
    const row: WeeklyRegisterLearnerRow = {
      learnerId: learner.id,
      fullName: `${learner.firstName} ${learner.lastName}`.trim(),
      grade: learner.grade || "",
      className: resolveLearnerClassroomLabel(learner) || className,
      cells,
      attendancePercentage: pct.percentage,
      present,
      absent,
      late,
      excused,
      notCaptured,
      notScheduled,
      eligibleSessions: pct.eligible,
      attended: pct.attended,
    };

    if (statusFilter && statusFilter !== "All") {
      const want = statusFilter.toLowerCase().replace(/\s+/g, "_");
      const has = row.cells.some((c) => {
        const label = c.label.toLowerCase().replace(/\s+/g, "_");
        const code = c.status.toLowerCase();
        const note = String(c.teacherNote || c.reason || "").toLowerCase().replace(/\s+/g, "_");
        return (
          label === want ||
          code === want ||
          c.abbrev.toLowerCase() === want ||
          note.includes(want)
        );
      });
      if (!has) continue;
    }

    learnerRows.push(row);
  }

  // Summary aggregates across learner cells (scheduled = all columns × learners that are not NS)
  // Counts remain status-based (unchanged calculations) — reason codes are display-only.
  let scheduledSessions = 0;
  let capturedSessions = 0;
  let notCapturedSessions = 0;
  let present = 0;
  let absent = 0;
  let late = 0;
  let excused = 0;
  const usedAbbrevs = new Set<string>();
  for (const row of learnerRows) {
    for (const cell of row.cells) {
      usedAbbrevs.add(cell.abbrev);
      if (cell.status === "NOT_SCHEDULED") continue;
      scheduledSessions += 1;
      if (cell.status === "NOT_CAPTURED") notCapturedSessions += 1;
      else {
        capturedSessions += 1;
        if (cell.status === "PRESENT") present += 1;
        else if (cell.status === "ABSENT") absent += 1;
        else if (cell.status === "LATE") late += 1;
        else if (cell.status === "EXCUSED") excused += 1;
      }
    }
  }
  const overall = computeSessionPercentage({
    present,
    late,
    absent,
    excused,
    notCaptured: 0,
  });

  const dayGroupsMap = new Map<string, { date: string; dayLabel: string; columnKeys: string[] }>();
  for (const col of columns) {
    const g = dayGroupsMap.get(col.date) || { date: col.date, dayLabel: col.dayLabel, columnKeys: [] };
    g.columnKeys.push(col.key);
    dayGroupsMap.set(col.date, g);
  }

  return {
    schoolId,
    schoolName: school.name,
    weekStart,
    weekEnd,
    timezone: DEFAULT_SCHOOL_TIMEZONE,
    className,
    gradeFilter,
    teacherFilter,
    displayModeRequested: requested,
    displayModeResolved: resolved,
    classroomAttendanceSessionDisplay: classroom?.attendanceSessionDisplay ?? null,
    columns,
    dayGroups: [...dayGroupsMap.values()],
    learners: learnerRows,
    summary: {
      totalLearners: learnerRows.length,
      scheduledSessions,
      capturedSessions,
      notCapturedSessions,
      present,
      absent,
      late,
      excused,
      overallAttendancePercentage: overall.percentage,
      learnersWith100Percent: learnerRows.filter(
        (l) => l.attendancePercentage != null && l.attendancePercentage >= 100
      ).length,
      learnersBelow90Percent: learnerRows.filter(
        (l) => l.attendancePercentage != null && l.attendancePercentage < 90
      ).length,
    },
    legacySubjectNotice,
    statusLegend: buildAttendanceReasonLegend({ usedAbbrevs }),
    generatedAt: new Date().toISOString(),
  };
}

function emptyReport(opts: {
  school: { id: string; name: string };
  weekStart: string;
  weekEnd: string;
  className: string;
  gradeFilter: string | null;
  teacherFilter: string | null;
  requested: WeeklyRegisterDisplayMode;
  resolved: WeeklyRegisterResolvedMode;
  classroomMode: AttendanceSessionDisplay | null;
}): WeeklyPeriodSubjectRegisterReport {
  return {
    schoolId: opts.school.id,
    schoolName: opts.school.name,
    weekStart: opts.weekStart,
    weekEnd: opts.weekEnd,
    timezone: DEFAULT_SCHOOL_TIMEZONE,
    className: opts.className,
    gradeFilter: opts.gradeFilter,
    teacherFilter: opts.teacherFilter,
    displayModeRequested: opts.requested,
    displayModeResolved: opts.resolved,
    classroomAttendanceSessionDisplay: opts.classroomMode,
    columns: [],
    dayGroups: [],
    learners: [],
    summary: {
      totalLearners: 0,
      scheduledSessions: 0,
      capturedSessions: 0,
      notCapturedSessions: 0,
      present: 0,
      absent: 0,
      late: 0,
      excused: 0,
      overallAttendancePercentage: null,
      learnersWith100Percent: 0,
      learnersBelow90Percent: 0,
    },
    legacySubjectNotice: null,
    statusLegend: buildAttendanceReasonLegend(),
    generatedAt: new Date().toISOString(),
  };
}
