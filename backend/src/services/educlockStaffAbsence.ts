/**
 * EduClock staff self-reported absence.
 * Separate from EduClockEvent (CLOCK_IN / CLOCK_OUT). Does not create payable minutes.
 */
import {
  EduClockAbsenceApprovalStatus,
  EduClockAbsenceReason,
  EduClockAbsenceSource,
  EduClockEventType,
  Prisma,
} from "@prisma/client";

import { prisma } from "../prisma";
import {
  DEFAULT_SCHOOL_TIMEZONE,
  formatSchoolLocalTimeDisplay,
  resolveSchoolLocalParts,
} from "../utils/schoolLocalTime";
import { EduClockError } from "./educlockService";
import { resolveActivatedEmployeeForClock } from "./educlockClockService";
import {
  ABSENCE_AFTER_CLOCK_IN_MESSAGE,
  STAFF_ABSENCE_REASON_LABELS,
  STAFF_ABSENCE_REASONS,
  type StaffAbsenceReasonCode,
} from "./educlockAbsenceLabels";

export {
  ABSENCE_AFTER_CLOCK_IN_MESSAGE,
  ABSENCE_CLOCK_IN_BLOCKED_MESSAGE,
  STAFF_ABSENCE_REASON_LABELS,
  STAFF_ABSENCE_REASONS,
} from "./educlockAbsenceLabels";

const NOTE_MAX = 500;
const CANCEL_NOTE_MAX = 500;

function trimEmployeeNumber(value: string | null | undefined): string | null {
  const t = String(value ?? "").trim();
  return t || null;
}

function parseReason(raw: unknown): StaffAbsenceReasonCode {
  const reason = String(raw || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!STAFF_ABSENCE_REASONS.includes(reason as StaffAbsenceReasonCode)) {
    throw new EduClockError(
      "EDUCLOCK_IDENTITY_INVALID",
      400,
      `Absence reason required. Allowed: ${STAFF_ABSENCE_REASONS.join(", ")}`
    );
  }
  return reason as StaffAbsenceReasonCode;
}

function parseNote(raw: unknown, required: boolean): string | null {
  const note = String(raw ?? "").trim();
  if (required && !note) {
    throw new EduClockError("EDUCLOCK_IDENTITY_INVALID", 400, "A note is required when reason is Other.");
  }
  if (note.length > NOTE_MAX) {
    throw new EduClockError("EDUCLOCK_IDENTITY_INVALID", 400, `Note must be at most ${NOTE_MAX} characters.`);
  }
  return note || null;
}

export function serializeStaffAbsence(row: {
  id: string;
  schoolId: string;
  employeeId: string;
  employeeNumberSnapshot: string;
  schoolLocalDate: string;
  timezone: string;
  reason: EduClockAbsenceReason;
  note: string | null;
  source: EduClockAbsenceSource;
  approvalStatus: EduClockAbsenceApprovalStatus;
  reportedAtUtc: Date;
  reportedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  cancelledAtUtc: Date | null;
  cancelledByUserId: string | null;
  cancelNote: string | null;
}) {
  const reason = row.reason as StaffAbsenceReasonCode;
  return {
    id: row.id,
    schoolId: row.schoolId,
    employeeId: row.employeeId,
    employeeNumber: row.employeeNumberSnapshot,
    schoolLocalDate: row.schoolLocalDate,
    timezone: row.timezone,
    reason,
    reasonLabel: STAFF_ABSENCE_REASON_LABELS[reason] || reason,
    note: row.note,
    source: row.source,
    approvalStatus: row.approvalStatus,
    reportedAtUtc: row.reportedAtUtc.toISOString(),
    reportedAt: row.reportedAtUtc.toISOString(),
    reportedTimeDisplay: formatSchoolLocalTimeDisplay(
      resolveSchoolLocalParts(row.reportedAtUtc, row.timezone || DEFAULT_SCHOOL_TIMEZONE).schoolLocalTime
    ),
    reportedByUserId: row.reportedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    cancelledAtUtc: row.cancelledAtUtc ? row.cancelledAtUtc.toISOString() : null,
    cancelledByUserId: row.cancelledByUserId,
    cancelNote: row.cancelNote,
  };
}

export async function findActiveStaffAbsence(input: {
  schoolId: string;
  employeeId: string;
  schoolLocalDate: string;
}) {
  return prisma.eduClockStaffAbsence.findUnique({
    where: {
      schoolId_employeeId_schoolLocalDate: {
        schoolId: input.schoolId,
        employeeId: input.employeeId,
        schoolLocalDate: input.schoolLocalDate,
      },
    },
  });
}

export function isActiveReportedAbsence(
  row: { approvalStatus: EduClockAbsenceApprovalStatus } | null | undefined
): boolean {
  return Boolean(row && row.approvalStatus === EduClockAbsenceApprovalStatus.REPORTED);
}

export async function staffReportAbsence(input: {
  userId: string;
  schoolId: string;
  reason?: unknown;
  note?: unknown;
  schoolLocalDate?: unknown;
  nowUtc?: Date;
}): Promise<Record<string, unknown>> {
  const { employee } = await resolveActivatedEmployeeForClock({
    userId: input.userId,
    schoolId: input.schoolId,
  });
  const empNo = trimEmployeeNumber(employee.employeeNumber)!;
  const now = input.nowUtc || new Date();
  const local = resolveSchoolLocalParts(now, DEFAULT_SCHOOL_TIMEZONE);
  const today = local.schoolLocalDate;

  const claimed = String(input.schoolLocalDate || "").trim();
  if (claimed && claimed !== today) {
    throw new EduClockError(
      "EDUCLOCK_IDENTITY_INVALID",
      400,
      "Staff can only report absence for today's school-local date."
    );
  }

  const reason = parseReason(input.reason);
  const note = parseNote(input.note, reason === "OTHER");

  const todayIn = await prisma.eduClockEvent.findFirst({
    where: {
      schoolId: input.schoolId,
      employeeId: employee.id,
      schoolLocalDate: today,
      eventType: EduClockEventType.CLOCK_IN,
    },
    select: { id: true },
  });
  if (todayIn) {
    throw new EduClockError("EDUCLOCK_FORBIDDEN", 409, ABSENCE_AFTER_CLOCK_IN_MESSAGE);
  }

  const existing = await findActiveStaffAbsence({
    schoolId: input.schoolId,
    employeeId: employee.id,
    schoolLocalDate: today,
  });
  if (existing) {
    if (existing.approvalStatus === EduClockAbsenceApprovalStatus.REPORTED) {
      return {
        ok: true,
        idempotentReplay: true,
        absence: serializeStaffAbsence(existing),
      };
    }
    throw new EduClockError(
      "EDUCLOCK_FORBIDDEN",
      409,
      "An absence was already recorded for today. Please contact management if your attendance needs to be corrected."
    );
  }

  try {
    const created = await prisma.eduClockStaffAbsence.create({
      data: {
        schoolId: input.schoolId,
        employeeId: employee.id,
        employeeNumberSnapshot: empNo,
        schoolLocalDate: today,
        timezone: local.timezone,
        reason: reason as EduClockAbsenceReason,
        note,
        source: EduClockAbsenceSource.STAFF_SELF_REPORT,
        approvalStatus: EduClockAbsenceApprovalStatus.REPORTED,
        reportedAtUtc: now,
        reportedByUserId: input.userId,
      },
    });
    return { ok: true, absence: serializeStaffAbsence(created) };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await findActiveStaffAbsence({
        schoolId: input.schoolId,
        employeeId: employee.id,
        schoolLocalDate: today,
      });
      if (raced && raced.approvalStatus === EduClockAbsenceApprovalStatus.REPORTED) {
        return { ok: true, idempotentReplay: true, absence: serializeStaffAbsence(raced) };
      }
      throw new EduClockError(
        "EDUCLOCK_FORBIDDEN",
        409,
        "An absence was already recorded for today. Please contact management if your attendance needs to be corrected."
      );
    }
    throw err;
  }
}

export async function ownerCancelStaffAbsence(input: {
  schoolId: string;
  actorUserId: string;
  absenceId: string;
  note?: unknown;
  nowUtc?: Date;
}): Promise<Record<string, unknown>> {
  const now = input.nowUtc || new Date();
  const cancelNote = parseNote(input.note, false);
  if (String(input.note ?? "").trim() && cancelNote && cancelNote.length > CANCEL_NOTE_MAX) {
    throw new EduClockError("EDUCLOCK_IDENTITY_INVALID", 400, `Note must be at most ${CANCEL_NOTE_MAX} characters.`);
  }

  const row = await prisma.eduClockStaffAbsence.findFirst({
    where: { id: input.absenceId, schoolId: input.schoolId },
  });
  if (!row) {
    throw new EduClockError("EDUCLOCK_NOT_FOUND", 404, "Absence report not found for this school.");
  }
  if (row.approvalStatus === EduClockAbsenceApprovalStatus.CANCELLED) {
    return { ok: true, idempotentReplay: true, absence: serializeStaffAbsence(row) };
  }
  if (row.approvalStatus !== EduClockAbsenceApprovalStatus.REPORTED) {
    throw new EduClockError("EDUCLOCK_FORBIDDEN", 409, "Only a reported absence can be cancelled.");
  }

  const updated = await prisma.eduClockStaffAbsence.update({
    where: { id: row.id },
    data: {
      approvalStatus: EduClockAbsenceApprovalStatus.CANCELLED,
      cancelledAtUtc: now,
      cancelledByUserId: input.actorUserId,
      cancelNote,
    },
  });
  return { ok: true, absence: serializeStaffAbsence(updated) };
}
