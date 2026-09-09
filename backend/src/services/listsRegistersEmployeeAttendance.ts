/**
 * Read-only employee attendance rows for Lists & Registers.
 * Uses EduClockEvent + Employee + EduClockStaffAbsence. No DB writes.
 */
import { EduClockAbsenceApprovalStatus, EduClockEventType, type PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "../prisma";
import { parseDateOnly } from "../utils/attendancePeriods";
import { addDaysYmd, listSchoolDaysInRange } from "./attendanceReportService";

export type ListsRegistersAttendanceKind = "weekly" | "monthly";

export type ListsRegistersEmployeeAttendanceStatus =
  | "Absent"
  | "Present"
  | "Not Clocked In";

export type ListsRegistersEmployeeAttendanceRow = {
  employeeId: string;
  employeeNumber: string | null;
  firstName: string;
  lastName: string;
  department: string | null;
  jobTitle: string | null;
  date: string;
  status: ListsRegistersEmployeeAttendanceStatus;
  clockIn: string | null;
  clockOut: string | null;
};

export type ListsRegistersEmployeeAttendanceInput = {
  schoolId: string;
  kind: ListsRegistersAttendanceKind;
  includeWeekends: boolean;
  includeTimes: boolean;
  /** YYYY-MM-DD */
  anchorDate: string;
};

export type ListsRegistersAttendanceDateRange = {
  startDate: string;
  endDate: string;
  dates: string[];
};

type EmployeeLite = {
  id: string;
  employeeNumber: string | null;
  firstName: string;
  lastName: string;
  department: string | null;
  jobTitle: string | null;
};

type ClockEventLite = {
  employeeId: string;
  eventType: EduClockEventType | string;
  schoolLocalDate: string;
  schoolLocalTime: string;
  occurredAtUtc: Date;
};

type AbsenceLite = {
  employeeId: string;
  schoolLocalDate: string;
};

/** Inclusive Mon–Sun or Mon–Fri week / calendar month containing anchorDate. */
export function computeListsRegistersAttendanceDateRange(
  kind: ListsRegistersAttendanceKind,
  anchorDate: string,
  includeWeekends: boolean
): ListsRegistersAttendanceDateRange {
  const anchor = parseDateOnly(anchorDate);
  if (!anchor) {
    throw new Error("Valid anchorDate required (YYYY-MM-DD)");
  }

  if (kind === "weekly") {
    const utcDay = anchor.getUTCDay(); // 0 Sun
    const toMonday = utcDay === 0 ? -6 : 1 - utcDay;
    const monday = addDaysYmd(anchorDate, toMonday);
    if (!monday) throw new Error("Valid anchorDate required (YYYY-MM-DD)");
    const friday = addDaysYmd(monday, 4);
    const sunday = addDaysYmd(monday, 6);
    if (!friday || !sunday) throw new Error("Valid anchorDate required (YYYY-MM-DD)");
    const endDate = includeWeekends ? sunday : friday;
    const dates = listSchoolDaysInRange(monday, endDate, includeWeekends);
    return { startDate: monday, endDate, dates };
  }

  const y = anchor.getUTCFullYear();
  const monthIndex = anchor.getUTCMonth();
  const startDate = `${y}-${String(monthIndex + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, monthIndex + 1, 0)).getUTCDate();
  const endDate = `${y}-${String(monthIndex + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const dates = listSchoolDaysInRange(startDate, endDate, includeWeekends);
  return { startDate, endDate, dates };
}

export function resolveEmployeeAttendanceDayStatus(input: {
  hasAbsence: boolean;
  hasClockIn: boolean;
}): ListsRegistersEmployeeAttendanceStatus {
  if (input.hasAbsence) return "Absent";
  if (input.hasClockIn) return "Present";
  return "Not Clocked In";
}

/** Pure row builder for unit tests (employee entity — no learner fields). */
export function buildListsRegistersEmployeeAttendanceRows(input: {
  employees: EmployeeLite[];
  dates: string[];
  events: ClockEventLite[];
  absences: AbsenceLite[];
  includeTimes: boolean;
}): ListsRegistersEmployeeAttendanceRow[] {
  const absenceSet = new Set(
    input.absences.map((a) => `${a.employeeId}|${a.schoolLocalDate}`)
  );

  const clockInByKey = new Map<string, ClockEventLite>();
  const clockOutByKey = new Map<string, ClockEventLite>();

  for (const ev of input.events) {
    const key = `${ev.employeeId}|${ev.schoolLocalDate}`;
    if (ev.eventType === EduClockEventType.CLOCK_IN || ev.eventType === "CLOCK_IN") {
      const prev = clockInByKey.get(key);
      if (!prev || ev.occurredAtUtc.getTime() < prev.occurredAtUtc.getTime()) {
        clockInByKey.set(key, ev);
      }
    } else if (ev.eventType === EduClockEventType.CLOCK_OUT || ev.eventType === "CLOCK_OUT") {
      const prev = clockOutByKey.get(key);
      if (!prev || ev.occurredAtUtc.getTime() > prev.occurredAtUtc.getTime()) {
        clockOutByKey.set(key, ev);
      }
    }
  }

  const rows: ListsRegistersEmployeeAttendanceRow[] = [];
  for (const emp of input.employees) {
    for (const date of input.dates) {
      const key = `${emp.id}|${date}`;
      const clockInEv = clockInByKey.get(key);
      const clockOutEv = clockOutByKey.get(key);
      const status = resolveEmployeeAttendanceDayStatus({
        hasAbsence: absenceSet.has(key),
        hasClockIn: Boolean(clockInEv),
      });
      rows.push({
        employeeId: emp.id,
        employeeNumber: emp.employeeNumber,
        firstName: emp.firstName,
        lastName: emp.lastName,
        department: emp.department,
        jobTitle: emp.jobTitle,
        date,
        status,
        clockIn: input.includeTimes && clockInEv ? clockInEv.schoolLocalTime : null,
        clockOut: input.includeTimes && clockOutEv ? clockOutEv.schoolLocalTime : null,
      });
    }
  }

  rows.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    const byLast = a.lastName.localeCompare(b.lastName, undefined, { sensitivity: "base" });
    if (byLast !== 0) return byLast;
    return a.firstName.localeCompare(b.firstName, undefined, { sensitivity: "base" });
  });

  return rows;
}

export async function buildListsRegistersEmployeeAttendance(
  input: ListsRegistersEmployeeAttendanceInput,
  db: PrismaClient = defaultPrisma
): Promise<{
  schoolId: string;
  kind: ListsRegistersAttendanceKind;
  includeWeekends: boolean;
  includeTimes: boolean;
  anchorDate: string;
  startDate: string;
  endDate: string;
  dates: string[];
  rows: ListsRegistersEmployeeAttendanceRow[];
}> {
  const schoolId = String(input.schoolId || "").trim();
  if (!schoolId) throw new Error("schoolId required");

  const range = computeListsRegistersAttendanceDateRange(
    input.kind,
    input.anchorDate,
    input.includeWeekends
  );

  const employees = await db.employee.findMany({
    where: { schoolId, isActive: true },
    select: {
      id: true,
      employeeNumber: true,
      firstName: true,
      lastName: true,
      department: true,
      jobTitle: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  const [events, absences] = await Promise.all([
    db.eduClockEvent.findMany({
      where: {
        schoolId,
        schoolLocalDate: { in: range.dates },
        eventType: { in: [EduClockEventType.CLOCK_IN, EduClockEventType.CLOCK_OUT] },
        employeeId: { in: employees.map((e) => e.id) },
      },
      select: {
        employeeId: true,
        eventType: true,
        schoolLocalDate: true,
        schoolLocalTime: true,
        occurredAtUtc: true,
      },
    }),
    db.eduClockStaffAbsence.findMany({
      where: {
        schoolId,
        schoolLocalDate: { in: range.dates },
        employeeId: { in: employees.map((e) => e.id) },
        approvalStatus: EduClockAbsenceApprovalStatus.REPORTED,
        cancelledAtUtc: null,
      },
      select: {
        employeeId: true,
        schoolLocalDate: true,
      },
    }),
  ]);

  const rows = buildListsRegistersEmployeeAttendanceRows({
    employees,
    dates: range.dates,
    events,
    absences,
    includeTimes: input.includeTimes,
  });

  return {
    schoolId,
    kind: input.kind,
    includeWeekends: input.includeWeekends,
    includeTimes: input.includeTimes,
    anchorDate: input.anchorDate,
    startDate: range.startDate,
    endDate: range.endDate,
    dates: range.dates,
    rows,
  };
}
