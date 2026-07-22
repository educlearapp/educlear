/**
 * Learner class attendance reporting (daily / weekly / monthly registers).
 * Does not write attendance rows. Holidays are not configured — cannot be excluded.
 */
import { AttendanceStatus } from "@prisma/client";
import { prisma } from "../prisma";
import {
  activeLearnerWhere,
  resolveLearnerClassroomLabel,
} from "../utils/learnerEnrollment";
import {
  normalizeAttendancePeriod,
  parseDateOnly,
  periodLabel,
  type AttendancePeriod,
} from "../utils/attendancePeriods";
import {
  DEFAULT_SCHOOL_TIMEZONE,
  resolveSchoolLocalParts,
} from "../utils/schoolLocalTime";

export const ATTENDANCE_REPORT_HOLIDAY_LIMITATION =
  "Holidays are not currently configured and therefore cannot be automatically excluded from attendance calculations.";

export type FriendlyAttendanceStatus =
  | "Present"
  | "Absent"
  | "Late"
  | "Excused"
  | "Not Captured";

export type AttendanceStatusCode =
  | "PRESENT"
  | "ABSENT"
  | "LATE"
  | "EXCUSED"
  | "NOT_CAPTURED";

export type AttendanceReportGroupBy = "classrooms" | "groups";

const STATUS_ABBREV: Record<AttendanceStatusCode, string> = {
  PRESENT: "P",
  ABSENT: "A",
  LATE: "L",
  EXCUSED: "E",
  NOT_CAPTURED: "N",
};

const WEEKDAY_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function toFriendlyAttendanceStatus(
  status: AttendanceStatus | AttendanceStatusCode | string | null | undefined
): FriendlyAttendanceStatus {
  const raw = String(status || "").trim();
  const key = raw.toUpperCase().replace(/\s+/g, "_");
  if (key === "PRESENT" || raw.toLowerCase() === "present") return "Present";
  if (key === "ABSENT" || raw.toLowerCase() === "absent") return "Absent";
  if (key === "LATE" || raw.toLowerCase() === "late") return "Late";
  if (key === "EXCUSED" || raw.toLowerCase() === "excused") return "Excused";
  return "Not Captured";
}

export function toAttendanceStatusCode(
  status: AttendanceStatus | string | null | undefined
): AttendanceStatusCode {
  const key = String(status || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (key === "PRESENT" || key === "ABSENT" || key === "LATE" || key === "EXCUSED") {
    return key;
  }
  return "NOT_CAPTURED";
}

export function statusAbbrev(code: AttendanceStatusCode): string {
  return STATUS_ABBREV[code];
}

/** Calendar parts for a YYYY-MM-DD school date (noon UTC policy). */
export function describeSchoolDate(ymd: string) {
  const date = parseDateOnly(ymd);
  if (!date) {
    return {
      date: ymd,
      weekday: "",
      weekdayShort: "",
      dayOfMonth: 0,
      monthShort: "",
      fullDateLabel: ymd,
      headingWeekly: ymd,
      headingMonthly: ymd,
    };
  }
  const day = date.getUTCDay();
  const dayOfMonth = date.getUTCDate();
  const monthShort = MONTH_SHORT[date.getUTCMonth()];
  const weekday = WEEKDAY_LONG[day];
  const weekdayShort = WEEKDAY_SHORT[day];
  return {
    date: ymd,
    weekday,
    weekdayShort,
    dayOfMonth,
    monthShort,
    fullDateLabel: `${weekday}, ${dayOfMonth} ${monthShort} ${date.getUTCFullYear()}`,
    headingWeekly: `${weekdayShort} ${dayOfMonth} ${monthShort}`,
    headingMonthly: `${dayOfMonth} ${weekdayShort}`,
  };
}

export function isWeekendYmd(ymd: string): boolean {
  const date = parseDateOnly(ymd);
  if (!date) return false;
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

export function addDaysYmd(ymd: string, days: number): string | null {
  const date = parseDateOnly(ymd);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Inclusive school-day list using noon-UTC YYYY-MM-DD boundaries. */
export function listSchoolDaysInRange(
  startDate: string,
  endDate: string,
  includeWeekends: boolean
): string[] {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end || start.getTime() > end.getTime()) return [];

  const out: string[] = [];
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    const y = cursor.getUTCFullYear();
    const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const d = String(cursor.getUTCDate()).padStart(2, "0");
    const ymd = `${y}-${m}-${d}`;
    if (includeWeekends || !isWeekendYmd(ymd)) {
      out.push(ymd);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export type LearnerDayTotals = {
  present: number;
  absent: number;
  late: number;
  excused: number;
  notCaptured: number;
  attended: number;
  captured: number;
  expected: number;
  attendancePercentage: number;
  captureCompletionPercentage: number;
};

export function computeLearnerDayTotals(
  statuses: AttendanceStatusCode[],
  expectedDays: number
): LearnerDayTotals {
  let present = 0;
  let absent = 0;
  let late = 0;
  let excused = 0;
  let notCaptured = 0;
  for (const status of statuses) {
    if (status === "PRESENT") present += 1;
    else if (status === "ABSENT") absent += 1;
    else if (status === "LATE") late += 1;
    else if (status === "EXCUSED") excused += 1;
    else notCaptured += 1;
  }
  const attended = present + late;
  const captured = present + late + absent + excused;
  const expected = Math.max(0, expectedDays);
  const attendancePercentage =
    expected === 0 ? 0 : Math.round((attended / expected) * 1000) / 10;
  const captureCompletionPercentage =
    expected === 0 ? 0 : Math.round((captured / expected) * 1000) / 10;
  return {
    present,
    absent,
    late,
    excused,
    notCaptured,
    attended,
    captured,
    expected,
    attendancePercentage,
    captureCompletionPercentage,
  };
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function looksLikeCuid(value: string): boolean {
  return /^c[a-z0-9]{20,}$/i.test(value);
}

export function friendlyCapturedByDisplay(
  raw: string | null | undefined,
  resolvedName: string | null | undefined
): string {
  const name = String(resolvedName || "").trim();
  if (name) return name;
  const value = String(raw || "").trim();
  if (!value) return "Recorded User";
  if (looksLikeCuid(value)) return "Recorded User";
  if (looksLikeEmail(value)) {
    const local = value.split("@")[0] || "";
    const pretty = local
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
    return pretty || "Recorded User";
  }
  return value;
}

async function resolveCapturedByNames(
  schoolId: string,
  rawValues: string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(rawValues.map((v) => v.trim()).filter(Boolean))];
  const map = new Map<string, string>();
  if (!unique.length) return map;

  const emails = unique.filter(looksLikeEmail).map((e) => e.toLowerCase());
  const ids = unique.filter(looksLikeCuid);

  const users = await prisma.user.findMany({
    where: {
      schoolId,
      OR: [
        ...(emails.length ? [{ email: { in: emails } }] : []),
        ...(ids.length ? [{ id: { in: ids } }] : []),
      ],
    },
    select: {
      id: true,
      email: true,
      fullName: true,
      rbacMeta: { select: { firstName: true, surname: true } },
    },
  });

  for (const user of users) {
    const metaName = `${user.rbacMeta?.firstName || ""} ${user.rbacMeta?.surname || ""}`.trim();
    const display = String(user.fullName || metaName || "").trim();
    if (!display) continue;
    map.set(user.id, display);
    map.set(user.email.toLowerCase(), display);
  }
  return map;
}

export type BuildAttendanceReportInput = {
  schoolId: string;
  startDate: string;
  endDate: string;
  period?: unknown;
  className?: string | null;
  includeWeekends?: boolean;
  groupBy?: AttendanceReportGroupBy;
  reportKind?: "daily" | "weekly" | "monthly" | "list";
};

export type AttendanceDayCell = {
  date: string;
  status: AttendanceStatusCode;
  statusLabel: FriendlyAttendanceStatus;
  statusAbbrev: string;
  reason: string;
  capturedBy: string;
  capturedAt: string | null;
  capturedAtDisplay: string | null;
};

export type AttendanceReportLearner = {
  learnerId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  admissionNo: string;
  classroom: string;
  groupNames: string[];
  days: Record<string, AttendanceDayCell>;
  totals: LearnerDayTotals;
};

export type AttendanceReportSection = {
  key: string;
  label: string;
  type: "classroom" | "group" | "ungrouped";
  learners: AttendanceReportLearner[];
};

export type AttendanceReportResult = {
  meta: {
    schoolId: string;
    schoolName: string;
    title: string;
    startDate: string;
    endDate: string;
    period: AttendancePeriod;
    periodLabel: string;
    className: string | null;
    classroomScope: "ALL" | "SINGLE";
    includeWeekends: boolean;
    groupBy: AttendanceReportGroupBy;
    timezone: string;
    generatedAt: string;
    generatedAtDisplay: string;
    holidayLimitation: string;
  };
  dates: ReturnType<typeof describeSchoolDate>[];
  sections: AttendanceReportSection[];
  learners: AttendanceReportLearner[];
  summary: {
    learnerCount: number;
    expectedSchoolDays: number;
    sectionCount: number;
  };
  emptyState: null | "NO_LEARNERS" | "NO_ATTENDANCE_FOR_PERIOD";
  groupsAvailable: boolean;
  groupByDisabledReason: string | null;
};

function normalizeClassFilter(raw: string | null | undefined): string | null {
  const value = String(raw || "").trim();
  if (!value || /^all(\s+classrooms?)?$/i.test(value) || value === "*") return null;
  return value;
}

function normalizeGroupBy(raw: unknown): AttendanceReportGroupBy {
  const value = String(raw || "")
    .trim()
    .toLowerCase();
  return value === "groups" || value === "group" ? "groups" : "classrooms";
}

export async function buildAttendanceReport(
  input: BuildAttendanceReportInput
): Promise<AttendanceReportResult> {
  const schoolId = String(input.schoolId || "").trim();
  if (!schoolId) throw new Error("schoolId required");

  const period = normalizeAttendancePeriod(input.period ?? "DAILY");
  if (!period) throw new Error("Invalid period");

  const startDate = String(input.startDate || "").trim();
  const endDate = String(input.endDate || "").trim();
  if (!parseDateOnly(startDate) || !parseDateOnly(endDate)) {
    throw new Error("Valid startDate and endDate required (YYYY-MM-DD)");
  }
  if (parseDateOnly(startDate)!.getTime() > parseDateOnly(endDate)!.getTime()) {
    throw new Error("startDate must be on or before endDate");
  }

  const includeWeekends = Boolean(input.includeWeekends);
  const classFilter = normalizeClassFilter(input.className);
  let groupBy = normalizeGroupBy(input.groupBy);

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new Error("School not found");

  const applicableDates = listSchoolDaysInRange(startDate, endDate, includeWeekends);
  const dateDescriptors = applicableDates.map(describeSchoolDate);

  const learnerWhere = {
    ...activeLearnerWhere(schoolId),
    ...(classFilter
      ? { OR: [{ className: classFilter }, { grade: classFilter }] }
      : {}),
  };

  const learnersRaw = await prisma.learner.findMany({
    where: learnerWhere,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      admissionNo: true,
      className: true,
      grade: true,
      groupLinks: {
        select: {
          group: { select: { id: true, name: true } },
        },
      },
    },
  });

  const groupsAvailable = learnersRaw.some((l) => l.groupLinks.length > 0);
  let groupByDisabledReason: string | null = null;
  if (groupBy === "groups" && !groupsAvailable) {
    groupBy = "classrooms";
    groupByDisabledReason =
      "Groups grouping is unavailable because no learner group memberships exist for this school. Showing Class Register by classroom instead.";
  }

  const learnerIds = learnersRaw.map((l) => l.id);
  const start = parseDateOnly(startDate)!;
  const end = parseDateOnly(endDate)!;

  const rows =
    learnerIds.length === 0 || applicableDates.length === 0
      ? []
      : await prisma.learnerAttendance.findMany({
          where: {
            schoolId,
            period,
            learnerId: { in: learnerIds },
            date: { gte: start, lte: end },
          },
          select: {
            learnerId: true,
            date: true,
            status: true,
            reason: true,
            createdBy: true,
            createdAt: true,
            updatedAt: true,
          },
        });

  const applicableSet = new Set(applicableDates);
  const marksByLearnerDate = new Map<
    string,
    {
      status: AttendanceStatus;
      reason: string | null;
      createdBy: string;
      createdAt: Date;
      updatedAt: Date;
    }
  >();

  for (const row of rows) {
    const ymd = ymdFromDbDate(row.date);
    if (!applicableSet.has(ymd)) continue;
    marksByLearnerDate.set(`${row.learnerId}|${ymd}`, {
      status: row.status,
      reason: row.reason,
      createdBy: row.createdBy || "",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  const capturedByRaw = [...marksByLearnerDate.values()].map((m) => m.createdBy);
  const nameMap = await resolveCapturedByNames(schoolId, capturedByRaw);

  const now = new Date();
  const localParts = resolveSchoolLocalParts(now, DEFAULT_SCHOOL_TIMEZONE);
  const generatedAtDisplay = `${localParts.schoolLocalDate} ${formatHm(localParts.schoolLocalTime)} (${DEFAULT_SCHOOL_TIMEZONE})`;

  const learners: AttendanceReportLearner[] = learnersRaw.map((learner) => {
    const classroom =
      resolveLearnerClassroomLabel(learner) ||
      String(learner.className || learner.grade || "").trim() ||
      "No classroom";
    const groupNames = [
      ...new Set(
        learner.groupLinks
          .map((link) => String(link.group?.name || "").trim())
          .filter(Boolean)
      ),
    ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const days: Record<string, AttendanceDayCell> = {};
    const statusCodes: AttendanceStatusCode[] = [];

    for (const ymd of applicableDates) {
      const mark = marksByLearnerDate.get(`${learner.id}|${ymd}`);
      const code: AttendanceStatusCode = mark
        ? toAttendanceStatusCode(mark.status)
        : "NOT_CAPTURED";
      statusCodes.push(code);
      const capturedAt = mark ? mark.updatedAt || mark.createdAt : null;
      const capturedLocal = capturedAt
        ? resolveSchoolLocalParts(capturedAt, DEFAULT_SCHOOL_TIMEZONE)
        : null;
      const rawBy = mark?.createdBy || "";
      const resolved =
        nameMap.get(rawBy) ||
        nameMap.get(rawBy.toLowerCase()) ||
        null;
      days[ymd] = {
        date: ymd,
        status: code,
        statusLabel: toFriendlyAttendanceStatus(code),
        statusAbbrev: statusAbbrev(code),
        reason: mark?.reason || "",
        capturedBy: friendlyCapturedByDisplay(rawBy, resolved),
        capturedAt: capturedAt ? capturedAt.toISOString() : null,
        capturedAtDisplay: capturedLocal
          ? `${capturedLocal.schoolLocalDate} ${formatHm(capturedLocal.schoolLocalTime)}`
          : null,
      };
    }

    return {
      learnerId: learner.id,
      firstName: learner.firstName || "",
      lastName: learner.lastName || "",
      fullName: `${learner.firstName || ""} ${learner.lastName || ""}`.trim() || "—",
      admissionNo: String(learner.admissionNo || "").trim() || "—",
      classroom,
      groupNames,
      days,
      totals: computeLearnerDayTotals(statusCodes, applicableDates.length),
    };
  });

  const sections = buildSections(learners, groupBy);
  const hasAnyCaptured = learners.some((l) => l.totals.captured > 0);
  let emptyState: AttendanceReportResult["emptyState"] = null;
  if (learners.length === 0) emptyState = "NO_LEARNERS";
  else if (!hasAnyCaptured && applicableDates.length > 0) emptyState = "NO_ATTENDANCE_FOR_PERIOD";

  const title =
    input.reportKind === "weekly"
      ? "Weekly Attendance Register"
      : input.reportKind === "monthly"
        ? "Monthly Attendance Register"
        : input.reportKind === "list"
          ? "Attendance List"
          : startDate === endDate
            ? "Daily Attendance Register"
            : applicableDates.length <= 7
              ? "Weekly Attendance Register"
              : "Monthly Attendance Register";

  return {
    meta: {
      schoolId: school.id,
      schoolName: school.name || "School",
      title,
      startDate,
      endDate,
      period,
      periodLabel: periodLabel(period),
      className: classFilter,
      classroomScope: classFilter ? "SINGLE" : "ALL",
      includeWeekends,
      groupBy,
      timezone: DEFAULT_SCHOOL_TIMEZONE,
      generatedAt: now.toISOString(),
      generatedAtDisplay,
      holidayLimitation: ATTENDANCE_REPORT_HOLIDAY_LIMITATION,
    },
    dates: dateDescriptors,
    sections,
    learners,
    summary: {
      learnerCount: learners.length,
      expectedSchoolDays: applicableDates.length,
      sectionCount: sections.length,
    },
    emptyState,
    groupsAvailable,
    groupByDisabledReason,
  };
}

function ymdFromDbDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatHm(schoolLocalTime: string): string {
  const match = String(schoolLocalTime || "").match(/^(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : schoolLocalTime;
}

function buildSections(
  learners: AttendanceReportLearner[],
  groupBy: AttendanceReportGroupBy
): AttendanceReportSection[] {
  if (groupBy === "groups") {
    const byGroup = new Map<string, AttendanceReportLearner[]>();
    const ungrouped: AttendanceReportLearner[] = [];
    for (const learner of learners) {
      if (!learner.groupNames.length) {
        ungrouped.push(learner);
        continue;
      }
      for (const name of learner.groupNames) {
        const list = byGroup.get(name) || [];
        list.push(learner);
        byGroup.set(name, list);
      }
    }
    const sections: AttendanceReportSection[] = [...byGroup.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
      .map(([label, list]) => ({
        key: `group:${label}`,
        label,
        type: "group" as const,
        learners: list,
      }));
    if (ungrouped.length) {
      sections.push({
        key: "group:ungrouped",
        label: "Ungrouped",
        type: "ungrouped",
        learners: ungrouped,
      });
    }
    return sections;
  }

  const byClass = new Map<string, AttendanceReportLearner[]>();
  for (const learner of learners) {
    const key = learner.classroom || "No classroom";
    const list = byClass.get(key) || [];
    list.push(learner);
    byClass.set(key, list);
  }
  return [...byClass.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([label, list]) => ({
      key: `classroom:${label}`,
      label,
      type: "classroom" as const,
      learners: list,
    }));
}
