/**
 * EduClock Build 3 — staff clock-in / clock-out lifecycle.
 * Official timestamps are always server-created (Africa/Johannesburg school-local policy).
 * Client-supplied timestamps / timezones / employeeId / schoolId are ignored or rejected.
 * Build 4: GPS validation required for staff mobile clock-in/out (backend distance authority).
 * No Payroll calculations.
 */
import {
  EduClockEventSource,
  EduClockEventType,
  EduClockExceptionStatus,
  EduClockExceptionType,
  Prisma,
  type Employee,
} from "@prisma/client";

import { prisma } from "../prisma";
import {
  DEFAULT_SCHOOL_TIMEZONE,
  formatSchoolLocalTimeDisplay,
  resolveSchoolLocalParts,
} from "../utils/schoolLocalTime";
import {
  EDUCLOCK_ERROR_MESSAGES,
  EDUCLOCK_READINESS_REASONS,
  EduClockError,
} from "./educlockService";
import {
  EduClockGpsError,
  persistGpsRejectionAttempt,
  validateStaffClockGps,
  type AcceptedGpsValidation,
} from "./educlockGpsValidation";
import {
  validateIdentityInput,
  type EmployeeIdentityTypeValue,
} from "./employeeIdentityVerification";

/** School-local attendance day ends at end of calendar day in school TZ. No auto clock-out. */
export const EDUCLOCK_ATTENDANCE_DAY_CUTOFF_NOTE =
  "Missing Clock Out: open shift whose schoolLocalDate is before today in Africa/Johannesburg (configurable later).";

const CORRECTION_REASONS = [
  "Employee forgot to clock in",
  "Employee forgot to clock out",
  "Device unavailable",
  "Network issue",
  "Owner-approved correction",
  "Other",
] as const;

export type CorrectionReason = (typeof CORRECTION_REASONS)[number];

function employeeDisplayName(emp: Pick<Employee, "fullName" | "firstName" | "lastName">): string {
  const full = String(emp.fullName || "").trim();
  if (full) return full;
  return `${emp.firstName || ""} ${emp.lastName || ""}`.trim();
}

function trimEmployeeNumber(value: string | null | undefined): string | null {
  const t = String(value ?? "").trim();
  return t || null;
}

function formatDurationMs(ms: number): string {
  if (ms < 0) ms = 0;
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

function rejectClientClockOverrides(body: Record<string, unknown> | undefined): void {
  if (!body || typeof body !== "object") return;
  for (const key of [
    "employeeId",
    "schoolId",
    "userId",
    "occurredAt",
    "occurredAtUtc",
    "timestamp",
    "timezone",
    "schoolLocalDate",
    "schoolLocalTime",
    "clientTime",
    "deviceTime",
  ]) {
    if (body[key] !== undefined && body[key] !== null && String(body[key]).trim() !== "") {
      throw new EduClockError(
        "EDUCLOCK_IDENTITY_INVALID",
        400,
        `Client may not supply ${key}. Official timestamps are created by the server.`
      );
    }
  }
  // Client may send entranceId / distanceMetres / insideGeofence / matchedEntranceId —
  // they are ignored (never trusted). Do not reject so clients can be upgraded gradually.
}

function gpsFieldsForEvent(gps: AcceptedGpsValidation) {
  return {
    latitude: new Prisma.Decimal(gps.latitude.toFixed(7)),
    longitude: new Prisma.Decimal(gps.longitude.toFixed(7)),
    accuracyMetres: new Prisma.Decimal(gps.accuracyMetres.toFixed(2)),
    matchedEntranceId: gps.matchedEntranceId,
    distanceMetres:
      gps.distanceMetres == null ? null : new Prisma.Decimal(gps.distanceMetres.toFixed(2)),
    validationVersion: gps.validationVersion,
    metadata: gps.deviceMetadata
      ? ({ gpsDevice: gps.deviceMetadata } as Prisma.InputJsonValue)
      : undefined,
  };
}

async function validateGpsOrAudit(input: {
  schoolId: string;
  employeeId: string;
  userId: string;
  attemptType: EduClockEventType;
  body?: Record<string, unknown>;
  nowUtc: Date;
  idempotencyKey?: string;
}): Promise<AcceptedGpsValidation> {
  try {
    return await validateStaffClockGps({
      db: prisma,
      schoolId: input.schoolId,
      body: input.body,
    });
  } catch (err) {
    if (err instanceof EduClockGpsError) {
      await persistGpsRejectionAttempt(prisma, {
        schoolId: input.schoolId,
        employeeId: input.employeeId,
        userId: input.userId,
        attemptType: input.attemptType,
        occurredAtUtc: input.nowUtc,
        error: err,
      });

      const rejectionPayload = {
        ok: false,
        error: err.message,
        code: err.rejectionCode,
        rejectionCode: err.rejectionCode,
      };

      // Same idempotency key on automatic retry must not flood GPS audit rows.
      if (input.idempotencyKey) {
        const operation = input.attemptType === EduClockEventType.CLOCK_IN ? "CLOCK_IN" : "CLOCK_OUT";
        await prisma.eduClockIdempotencyKey.upsert({
          where: {
            schoolId_userId_operation_key: {
              schoolId: input.schoolId,
              userId: input.userId,
              operation,
              key: input.idempotencyKey,
            },
          },
          create: {
            schoolId: input.schoolId,
            userId: input.userId,
            operation,
            key: input.idempotencyKey,
            eventId: null,
            response: rejectionPayload as unknown as Prisma.InputJsonValue,
          },
          update: {
            response: rejectionPayload as unknown as Prisma.InputJsonValue,
          },
        });
      }

      throw err;
    }
    throw err;
  }
}

type LinkedEmployeeForClock = Employee & {
  userId: string;
};

async function resolveActivatedEmployeeForClock(input: {
  userId: string;
  schoolId: string;
}): Promise<{ employee: LinkedEmployeeForClock; readinessReasons: string[] }> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      schoolId: true,
      isActive: true,
      linkedEmployee: true,
    },
  });

  if (!user || user.schoolId !== input.schoolId) {
    throw new EduClockError(
      "EDUCLOCK_EMPLOYEE_SCHOOL_MISMATCH",
      403,
      EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_EMPLOYEE_SCHOOL_MISMATCH
    );
  }
  if (!user.isActive) {
    throw new EduClockError("EDUCLOCK_USER_INACTIVE", 403, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_USER_INACTIVE);
  }
  if (!user.linkedEmployee) {
    throw new EduClockError(
      "EDUCLOCK_FORBIDDEN",
      403,
      EDUCLOCK_READINESS_REASONS.USER_ACCOUNT_NOT_LINKED
    );
  }

  const emp = user.linkedEmployee;
  if (emp.schoolId !== input.schoolId) {
    throw new EduClockError(
      "EDUCLOCK_EMPLOYEE_SCHOOL_MISMATCH",
      403,
      EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_EMPLOYEE_SCHOOL_MISMATCH
    );
  }
  if (!emp.userId || emp.userId !== input.userId) {
    throw new EduClockError(
      "EDUCLOCK_FORBIDDEN",
      403,
      EDUCLOCK_READINESS_REASONS.USER_ACCOUNT_NOT_LINKED
    );
  }
  if (!emp.isActive) {
    throw new EduClockError("EDUCLOCK_EMPLOYEE_INACTIVE", 403, EDUCLOCK_READINESS_REASONS.EMPLOYEE_INACTIVE);
  }

  const empNo = trimEmployeeNumber(emp.employeeNumber);
  if (!empNo) {
    throw new EduClockError(
      "EDUCLOCK_EMPLOYEE_MISSING_NUMBER",
      403,
      EDUCLOCK_READINESS_REASONS.MISSING_EMPLOYEE_NUMBER
    );
  }

  if (!String(emp.idNumber || "").trim()) {
    throw new EduClockError(
      "EDUCLOCK_IDENTITY_REQUIRED",
      403,
      EDUCLOCK_READINESS_REASONS.MISSING_IDENTITY_DOCUMENT
    );
  }

  const type = (emp.identityType || "SA_ID") as EmployeeIdentityTypeValue;
  if (type === "SA_ID") {
    const check = validateIdentityInput({
      identityType: "SA_ID",
      identityNumber: emp.idNumber,
    });
    if (!check.valid) {
      throw new EduClockError(
        "EDUCLOCK_IDENTITY_INVALID",
        403,
        EDUCLOCK_READINESS_REASONS.INVALID_IDENTITY_DOCUMENT
      );
    }
  }

  return {
    employee: emp as LinkedEmployeeForClock,
    readinessReasons: [EDUCLOCK_READINESS_REASONS.READY],
  };
}

function serializeEvent(event: {
  id: string;
  schoolId: string;
  employeeId: string;
  employeeNumberSnapshot: string;
  userId: string;
  eventType: EduClockEventType;
  occurredAtUtc: Date;
  schoolLocalDate: string;
  schoolLocalTime: string;
  timezone: string;
  source: EduClockEventSource;
  isManualCorrection: boolean;
  note: string | null;
  correctedFromEventId: string | null;
  createdByUserId: string;
  createdAt: Date;
  latitude?: Prisma.Decimal | null;
  longitude?: Prisma.Decimal | null;
  accuracyMetres?: Prisma.Decimal | null;
  matchedEntranceId?: string | null;
  distanceMetres?: Prisma.Decimal | null;
  validationVersion?: string | null;
}, extras?: { matchedEntranceName?: string | null; campusName?: string | null }) {
  return {
    id: event.id,
    schoolId: event.schoolId,
    employeeId: event.employeeId,
    employeeNumber: event.employeeNumberSnapshot,
    userId: event.userId,
    eventType: event.eventType,
    occurredAtUtc: event.occurredAtUtc.toISOString(),
    schoolLocalDate: event.schoolLocalDate,
    schoolLocalTime: event.schoolLocalTime,
    schoolLocalTimeDisplay: formatSchoolLocalTimeDisplay(event.schoolLocalTime),
    timezone: event.timezone,
    source: event.source,
    isManualCorrection: event.isManualCorrection,
    note: event.note,
    correctedFromEventId: event.correctedFromEventId,
    createdByUserId: event.createdByUserId,
    createdAt: event.createdAt.toISOString(),
    latitude: event.latitude == null ? null : Number(event.latitude),
    longitude: event.longitude == null ? null : Number(event.longitude),
    accuracyMetres: event.accuracyMetres == null ? null : Number(event.accuracyMetres),
    matchedEntranceId: event.matchedEntranceId ?? null,
    distanceMetres: event.distanceMetres == null ? null : Number(event.distanceMetres),
    validationVersion: event.validationVersion ?? null,
    matchedEntranceName: extras?.matchedEntranceName ?? null,
    campusName: extras?.campusName ?? null,
  };
}

async function loadMatchedEntranceLabels(input: {
  schoolId: string;
  matchedEntranceId: string | null | undefined;
}): Promise<{ matchedEntranceName: string | null; campusName: string | null }> {
  if (!input.matchedEntranceId) {
    return { matchedEntranceName: null, campusName: null };
  }
  const entrance = await prisma.eduClockEntrance.findFirst({
    where: { id: input.matchedEntranceId, schoolId: input.schoolId },
    select: { name: true, campus: { select: { name: true } } },
  });
  if (!entrance) return { matchedEntranceName: null, campusName: null };
  return {
    matchedEntranceName: entrance.name || null,
    campusName: entrance.campus?.name || null,
  };
}

async function loadRecentCompletedShifts(input: {
  schoolId: string;
  employeeId: string;
  limit?: number;
  nowUtc?: Date;
}) {
  const limit = input.limit ?? 7;
  const outs = await prisma.eduClockEvent.findMany({
    where: {
      schoolId: input.schoolId,
      employeeId: input.employeeId,
      eventType: EduClockEventType.CLOCK_OUT,
    },
    orderBy: { occurredAtUtc: "desc" },
    take: limit * 3,
  });

  const shifts: Array<Record<string, unknown>> = [];
  for (const out of outs) {
    if (shifts.length >= limit) break;
    const clockIn = await prisma.eduClockEvent.findFirst({
      where: {
        schoolId: input.schoolId,
        employeeId: input.employeeId,
        eventType: EduClockEventType.CLOCK_IN,
        occurredAtUtc: { lt: out.occurredAtUtc },
      },
      orderBy: { occurredAtUtc: "desc" },
    });
    if (!clockIn) continue;
    const durationMs = out.occurredAtUtc.getTime() - clockIn.occurredAtUtc.getTime();
    shifts.push({
      schoolLocalDate: clockIn.schoolLocalDate,
      clockIn: serializeEvent(clockIn),
      clockOut: serializeEvent(out),
      durationMs,
      durationDisplay: formatDurationMs(durationMs),
      corrected: clockIn.isManualCorrection || out.isManualCorrection,
    });
  }
  return shifts;
}

export async function getStaffClockStatus(input: {
  userId: string;
  schoolId: string;
  nowUtc?: Date;
}): Promise<Record<string, unknown>> {
  const now = input.nowUtc || new Date();
  const local = resolveSchoolLocalParts(now, DEFAULT_SCHOOL_TIMEZONE);

  let employee: LinkedEmployeeForClock | null = null;
  let readiness = "READY";
  let readinessReasons: string[] = [EDUCLOCK_READINESS_REASONS.READY];
  try {
    const resolved = await resolveActivatedEmployeeForClock(input);
    employee = resolved.employee;
    readinessReasons = resolved.readinessReasons;
  } catch (err) {
    if (err instanceof EduClockError) {
      readiness = "BLOCKED";
      readinessReasons = [err.message];
      return {
        readiness,
        readinessReasons,
        readinessReason: err.message,
        canClock: false,
        currentStatus: "BLOCKED",
        employeeName: null,
        employeeNumber: null,
        schoolLocalDate: local.schoolLocalDate,
        schoolLocalTime: local.schoolLocalTime,
        schoolLocalTimeDisplay: formatSchoolLocalTimeDisplay(local.schoolLocalTime),
        timezone: local.timezone,
        serverTimeUtc: now.toISOString(),
        activeClockIn: null,
        currentShiftDurationMs: null,
        currentShiftDurationDisplay: null,
        recentShifts: [],
        attendanceDayCutoffNote: EDUCLOCK_ATTENDANCE_DAY_CUTOFF_NOTE,
      };
    }
    throw err;
  }

  const open = await prisma.eduClockOpenShift.findUnique({
    where: {
      schoolId_employeeId: { schoolId: input.schoolId, employeeId: employee.id },
    },
    include: { clockInEvent: true },
  });

  const missingClockOut =
    open && open.schoolLocalDate < local.schoolLocalDate
      ? true
      : false;

  let currentStatus: string = open ? "CLOCKED_IN" : "CLOCKED_OUT";
  if (missingClockOut) currentStatus = "MISSING_CLOCK_OUT";

  const durationMs = open ? now.getTime() - open.openedAtUtc.getTime() : null;
  const recentShifts = await loadRecentCompletedShifts({
    schoolId: input.schoolId,
    employeeId: employee.id,
    limit: 7,
  });

  return {
    readiness,
    readinessReasons,
    readinessReason: readinessReasons[0] || EDUCLOCK_READINESS_REASONS.READY,
    canClock: readiness === "READY",
    currentStatus,
    employeeId: employee.id,
    employeeName: employeeDisplayName(employee),
    employeeFirstName: employee.firstName,
    employeeLastName: employee.lastName,
    employeeNumber: trimEmployeeNumber(employee.employeeNumber),
    schoolLocalDate: local.schoolLocalDate,
    schoolLocalTime: local.schoolLocalTime,
    schoolLocalTimeDisplay: formatSchoolLocalTimeDisplay(local.schoolLocalTime),
    timezone: local.timezone,
    serverTimeUtc: now.toISOString(),
    activeClockIn: open ? serializeEvent(open.clockInEvent) : null,
    currentShiftDurationMs: durationMs,
    currentShiftDurationDisplay: durationMs == null ? null : formatDurationMs(durationMs),
    missingClockOut,
    recentShifts,
    attendanceDayCutoffNote: EDUCLOCK_ATTENDANCE_DAY_CUTOFF_NOTE,
  };
}

async function recordDuplicateAttempt(input: {
  schoolId: string;
  employeeId: string;
  employeeNumberSnapshot: string;
  schoolLocalDate: string;
  details: string;
}) {
  await prisma.eduClockException.create({
    data: {
      schoolId: input.schoolId,
      employeeId: input.employeeId,
      employeeNumberSnapshot: input.employeeNumberSnapshot,
      schoolLocalDate: input.schoolLocalDate,
      exceptionType: EduClockExceptionType.DUPLICATE_CLOCK_ATTEMPT,
      details: input.details,
      status: EduClockExceptionStatus.OPEN,
    },
  });
}

export async function staffClockIn(input: {
  userId: string;
  schoolId: string;
  idempotencyKey?: string | null;
  body?: Record<string, unknown>;
  nowUtc?: Date;
}): Promise<Record<string, unknown>> {
  rejectClientClockOverrides(input.body);
  const { employee } = await resolveActivatedEmployeeForClock(input);
  const empNo = trimEmployeeNumber(employee.employeeNumber)!;
  const now = input.nowUtc || new Date();
  const local = resolveSchoolLocalParts(now, DEFAULT_SCHOOL_TIMEZONE);
  const idemKey = String(input.idempotencyKey || "").trim();

  if (idemKey) {
    const existing = await prisma.eduClockIdempotencyKey.findUnique({
      where: {
        schoolId_userId_operation_key: {
          schoolId: input.schoolId,
          userId: input.userId,
          operation: "CLOCK_IN",
          key: idemKey,
        },
      },
    });
    if (existing?.response) {
      const cached = existing.response as Record<string, unknown>;
      if (cached.ok === false) {
        throw new EduClockError(
          String(cached.code || cached.rejectionCode || "EDUCLOCK_FORBIDDEN") as any,
          400,
          String(cached.error || "Clock in rejected.")
        );
      }
      return cached;
    }
  }

  // GPS before lifecycle create: reject + audit without creating attendance events.
  // Idempotency lookup runs first so automatic retries do not flood GPS audit rows.
  const gps = await validateGpsOrAudit({
    schoolId: input.schoolId,
    employeeId: employee.id,
    userId: input.userId,
    attemptType: EduClockEventType.CLOCK_IN,
    body: input.body,
    nowUtc: now,
    idempotencyKey: idemKey || undefined,
  });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const open = await tx.eduClockOpenShift.findUnique({
        where: {
          schoolId_employeeId: { schoolId: input.schoolId, employeeId: employee.id },
        },
      });
      if (open) {
        throw new EduClockError(
          "EDUCLOCK_FORBIDDEN",
          409,
          "Already clocked in. Clock out before starting a new shift."
        );
      }

      const event = await tx.eduClockEvent.create({
        data: {
          schoolId: input.schoolId,
          employeeId: employee.id,
          employeeNumberSnapshot: empNo,
          userId: input.userId,
          eventType: EduClockEventType.CLOCK_IN,
          occurredAtUtc: now,
          schoolLocalDate: local.schoolLocalDate,
          schoolLocalTime: local.schoolLocalTime,
          timezone: local.timezone,
          source: EduClockEventSource.STAFF_MOBILE,
          createdByUserId: input.userId,
          isManualCorrection: false,
          ...gpsFieldsForEvent(gps),
        },
      });

      await tx.eduClockOpenShift.create({
        data: {
          schoolId: input.schoolId,
          employeeId: employee.id,
          clockInEventId: event.id,
          schoolLocalDate: local.schoolLocalDate,
          openedAtUtc: now,
        },
      });

      return { event, local };
    });

    const status = await getStaffClockStatus({
      userId: input.userId,
      schoolId: input.schoolId,
      nowUtc: now,
    });
    const entranceLabels = await loadMatchedEntranceLabels({
      schoolId: input.schoolId,
      matchedEntranceId: result.event.matchedEntranceId,
    });
    const payload = {
      ok: true,
      message: `Clocked in successfully at ${formatSchoolLocalTimeDisplay(result.local.schoolLocalTime)}.`,
      event: serializeEvent(result.event, entranceLabels),
      status,
    };

    if (idemKey) {
      await prisma.eduClockIdempotencyKey.upsert({
        where: {
          schoolId_userId_operation_key: {
            schoolId: input.schoolId,
            userId: input.userId,
            operation: "CLOCK_IN",
            key: idemKey,
          },
        },
        create: {
          schoolId: input.schoolId,
          userId: input.userId,
          operation: "CLOCK_IN",
          key: idemKey,
          eventId: result.event.id,
          response: payload as unknown as Prisma.InputJsonValue,
        },
        update: {
          eventId: result.event.id,
          response: payload as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return payload;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      await recordDuplicateAttempt({
        schoolId: input.schoolId,
        employeeId: employee.id,
        employeeNumberSnapshot: empNo,
        schoolLocalDate: local.schoolLocalDate,
        details: "Concurrent or duplicate Clock In rejected by uniqueness guard",
      });
      throw new EduClockError(
        "EDUCLOCK_FORBIDDEN",
        409,
        "Already clocked in. Clock out before starting a new shift."
      );
    }
    if (err instanceof EduClockError && err.status === 409) {
      await recordDuplicateAttempt({
        schoolId: input.schoolId,
        employeeId: employee.id,
        employeeNumberSnapshot: empNo,
        schoolLocalDate: local.schoolLocalDate,
        details: err.message,
      });
    }
    throw err;
  }
}

export async function staffClockOut(input: {
  userId: string;
  schoolId: string;
  idempotencyKey?: string | null;
  body?: Record<string, unknown>;
  nowUtc?: Date;
}): Promise<Record<string, unknown>> {
  rejectClientClockOverrides(input.body);
  const { employee } = await resolveActivatedEmployeeForClock(input);
  const empNo = trimEmployeeNumber(employee.employeeNumber)!;
  const now = input.nowUtc || new Date();
  const local = resolveSchoolLocalParts(now, DEFAULT_SCHOOL_TIMEZONE);
  const idemKey = String(input.idempotencyKey || "").trim();

  if (idemKey) {
    const existing = await prisma.eduClockIdempotencyKey.findUnique({
      where: {
        schoolId_userId_operation_key: {
          schoolId: input.schoolId,
          userId: input.userId,
          operation: "CLOCK_OUT",
          key: idemKey,
        },
      },
    });
    if (existing?.response) {
      const cached = existing.response as Record<string, unknown>;
      if (cached.ok === false) {
        throw new EduClockError(
          String(cached.code || cached.rejectionCode || "EDUCLOCK_FORBIDDEN") as any,
          400,
          String(cached.error || "Clock out rejected.")
        );
      }
      return cached;
    }
  }

  const gps = await validateGpsOrAudit({
    schoolId: input.schoolId,
    employeeId: employee.id,
    userId: input.userId,
    attemptType: EduClockEventType.CLOCK_OUT,
    body: input.body,
    nowUtc: now,
    idempotencyKey: idemKey || undefined,
  });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const open = await tx.eduClockOpenShift.findUnique({
        where: {
          schoolId_employeeId: { schoolId: input.schoolId, employeeId: employee.id },
        },
        include: { clockInEvent: true },
      });
      if (!open) {
        throw new EduClockError(
          "EDUCLOCK_FORBIDDEN",
          409,
          "Not clocked in. Clock in before clocking out."
        );
      }

      // Claim open shift first so concurrent clock-outs cannot both succeed.
      const claimed = await tx.eduClockOpenShift.deleteMany({ where: { id: open.id } });
      if (claimed.count !== 1) {
        throw new EduClockError(
          "EDUCLOCK_FORBIDDEN",
          409,
          "Not clocked in. Clock in before clocking out."
        );
      }

      const event = await tx.eduClockEvent.create({
        data: {
          schoolId: input.schoolId,
          employeeId: employee.id,
          employeeNumberSnapshot: empNo,
          userId: input.userId,
          eventType: EduClockEventType.CLOCK_OUT,
          occurredAtUtc: now,
          schoolLocalDate: local.schoolLocalDate,
          schoolLocalTime: local.schoolLocalTime,
          timezone: local.timezone,
          source: EduClockEventSource.STAFF_MOBILE,
          createdByUserId: input.userId,
          isManualCorrection: false,
          ...gpsFieldsForEvent(gps),
        },
      });

      // Resolve open Missing Clock Out exceptions for this employee/date of the open shift.
      await tx.eduClockException.updateMany({
        where: {
          schoolId: input.schoolId,
          employeeId: employee.id,
          exceptionType: EduClockExceptionType.MISSING_CLOCK_OUT,
          status: EduClockExceptionStatus.OPEN,
          schoolLocalDate: open.schoolLocalDate,
        },
        data: {
          status: EduClockExceptionStatus.RESOLVED,
          resolvedByUserId: input.userId,
          resolvedAt: now,
        },
      });

      return { event, open, local, durationMs: now.getTime() - open.openedAtUtc.getTime() };
    });

    const status = await getStaffClockStatus({
      userId: input.userId,
      schoolId: input.schoolId,
      nowUtc: now,
    });
    const entranceLabels = await loadMatchedEntranceLabels({
      schoolId: input.schoolId,
      matchedEntranceId: result.event.matchedEntranceId,
    });
    const payload = {
      ok: true,
      message: `Clocked out successfully at ${formatSchoolLocalTimeDisplay(result.local.schoolLocalTime)}.`,
      event: serializeEvent(result.event, entranceLabels),
      completedShift: {
        clockIn: serializeEvent(result.open.clockInEvent),
        clockOut: serializeEvent(result.event, entranceLabels),
        durationMs: result.durationMs,
        durationDisplay: formatDurationMs(result.durationMs),
      },
      status,
    };

    if (idemKey) {
      await prisma.eduClockIdempotencyKey.upsert({
        where: {
          schoolId_userId_operation_key: {
            schoolId: input.schoolId,
            userId: input.userId,
            operation: "CLOCK_OUT",
            key: idemKey,
          },
        },
        create: {
          schoolId: input.schoolId,
          userId: input.userId,
          operation: "CLOCK_OUT",
          key: idemKey,
          eventId: result.event.id,
          response: payload as unknown as Prisma.InputJsonValue,
        },
        update: {
          eventId: result.event.id,
          response: payload as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return payload;
  } catch (err) {
    if (err instanceof EduClockError && err.status === 409) {
      await recordDuplicateAttempt({
        schoolId: input.schoolId,
        employeeId: employee.id,
        employeeNumberSnapshot: empNo,
        schoolLocalDate: local.schoolLocalDate,
        details: err.message,
      });
    }
    throw err;
  }
}

export async function getStaffClockHistory(input: {
  userId: string;
  schoolId: string;
}): Promise<Record<string, unknown>> {
  const { employee } = await resolveActivatedEmployeeForClock(input);
  const shifts = await loadRecentCompletedShifts({
    schoolId: input.schoolId,
    employeeId: employee.id,
    limit: 14,
  });
  return {
    schoolId: input.schoolId,
    employeeId: employee.id,
    employeeNumber: trimEmployeeNumber(employee.employeeNumber),
    shifts,
  };
}

async function ensureMissingClockOutExceptions(schoolId: string, todayLocal: string) {
  const stale = await prisma.eduClockOpenShift.findMany({
    where: {
      schoolId,
      schoolLocalDate: { lt: todayLocal },
    },
    include: {
      employee: { select: { employeeNumber: true } },
      clockInEvent: true,
    },
  });

  for (const open of stale) {
    const existing = await prisma.eduClockException.findFirst({
      where: {
        schoolId,
        employeeId: open.employeeId,
        schoolLocalDate: open.schoolLocalDate,
        exceptionType: EduClockExceptionType.MISSING_CLOCK_OUT,
        status: EduClockExceptionStatus.OPEN,
      },
    });
    if (existing) continue;
    await prisma.eduClockException.create({
      data: {
        schoolId,
        employeeId: open.employeeId,
        employeeNumberSnapshot: open.employee.employeeNumber,
        schoolLocalDate: open.schoolLocalDate,
        exceptionType: EduClockExceptionType.MISSING_CLOCK_OUT,
        details: `Open shift since ${open.schoolLocalDate} ${formatSchoolLocalTimeDisplay(open.clockInEvent.schoolLocalTime)} — no clock-out before attendance day cutoff.`,
        status: EduClockExceptionStatus.OPEN,
        relatedEventId: open.clockInEventId,
      },
    });
  }
}

export async function getOwnerAttendance(input: {
  schoolId: string;
  schoolLocalDate?: string;
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
  nowUtc?: Date;
}): Promise<Record<string, unknown>> {
  const now = input.nowUtc || new Date();
  const today = resolveSchoolLocalParts(now, DEFAULT_SCHOOL_TIMEZONE).schoolLocalDate;
  const date = String(input.schoolLocalDate || today).trim() || today;
  const page = Math.max(0, Number(input.page || 0));
  const pageSize = Math.min(100, Math.max(1, Number(input.pageSize || 25)));
  const search = String(input.search || "").trim().toLowerCase();
  const statusFilter = String(input.status || "ALL").trim();

  await ensureMissingClockOutExceptions(input.schoolId, today);

  const employees = await prisma.employee.findMany({
    where: { schoolId: input.schoolId },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  const openShifts = await prisma.eduClockOpenShift.findMany({
    where: { schoolId: input.schoolId },
    include: { clockInEvent: true },
  });
  const openByEmp = new Map(openShifts.map((o) => [o.employeeId, o]));

  const dayEvents = await prisma.eduClockEvent.findMany({
    where: { schoolId: input.schoolId, schoolLocalDate: date },
    orderBy: { occurredAtUtc: "asc" },
  });
  const eventsByEmp = new Map<string, typeof dayEvents>();
  for (const ev of dayEvents) {
    const list = eventsByEmp.get(ev.employeeId) || [];
    list.push(ev);
    eventsByEmp.set(ev.employeeId, list);
  }

  type Row = Record<string, unknown>;
  const rows: Row[] = [];

  for (const emp of employees) {
    const name = employeeDisplayName(emp);
    const empNo = trimEmployeeNumber(emp.employeeNumber);
    if (search) {
      const hay = `${name} ${empNo || ""}`.toLowerCase();
      if (!hay.includes(search)) continue;
    }

    const open = openByEmp.get(emp.id);
    const events = eventsByEmp.get(emp.id) || [];
    const clockIns = events.filter((e) => e.eventType === EduClockEventType.CLOCK_IN);
    const clockOuts = events.filter((e) => e.eventType === EduClockEventType.CLOCK_OUT);
    const lastIn = clockIns[clockIns.length - 1] || null;
    const lastOut = clockOuts[clockOuts.length - 1] || null;

    let shiftStatus = "Not Clocked In";
    let currentStatus = "Not Clocked In";
    let clockInEvent: (typeof dayEvents)[number] | null = lastIn;
    let clockOutEvent: (typeof dayEvents)[number] | null = lastOut;
    let durationDisplay: string | null = null;
    let source: string | null = null;
    let correctionStatus = "None";

    if (!emp.isActive) {
      shiftStatus = "Inactive";
      currentStatus = "Inactive";
    } else if (open) {
      if (open.schoolLocalDate < today) {
        shiftStatus = "Missing Clock Out";
        currentStatus = "Missing Clock Out";
        clockInEvent = open.clockInEvent;
        clockOutEvent = null;
        source = open.clockInEvent.source;
        durationDisplay = formatDurationMs(now.getTime() - open.openedAtUtc.getTime());
      } else if (open.schoolLocalDate === date) {
        shiftStatus = "Clocked In";
        currentStatus = "Clocked In";
        clockInEvent = open.clockInEvent;
        clockOutEvent = null;
        source = open.clockInEvent.source;
        durationDisplay = formatDurationMs(now.getTime() - open.openedAtUtc.getTime());
      } else if (lastIn && lastOut && lastOut.occurredAtUtc > lastIn.occurredAtUtc) {
        shiftStatus = "Clocked Out";
        currentStatus = "Clocked Out";
        durationDisplay = formatDurationMs(
          lastOut.occurredAtUtc.getTime() - lastIn.occurredAtUtc.getTime()
        );
        source = lastOut.source;
      }
    } else if (lastIn && lastOut && lastOut.occurredAtUtc > lastIn.occurredAtUtc) {
      shiftStatus = "Clocked Out";
      currentStatus = "Clocked Out";
      durationDisplay = formatDurationMs(
        lastOut.occurredAtUtc.getTime() - lastIn.occurredAtUtc.getTime()
      );
      source = lastOut.source;
    } else if (lastIn && !lastOut) {
      shiftStatus = "Missing Clock Out";
      currentStatus = "Missing Clock Out";
      clockOutEvent = null;
      source = lastIn.source;
    }

    if (
      (clockInEvent && clockInEvent.isManualCorrection) ||
      (clockOutEvent && clockOutEvent.isManualCorrection)
    ) {
      correctionStatus = "Manually Corrected";
      if (shiftStatus === "Clocked Out" || shiftStatus === "Clocked In") {
        // keep status; also surface correction
      }
    }

    if (statusFilter !== "ALL") {
      const map: Record<string, string> = {
        NOT_CLOCKED_IN: "Not Clocked In",
        CLOCKED_IN: "Clocked In",
        CLOCKED_OUT: "Clocked Out",
        MISSING_CLOCK_OUT: "Missing Clock Out",
        MANUALLY_CORRECTED: "Manually Corrected",
        INACTIVE: "Inactive",
      };
      const want = map[statusFilter] || statusFilter;
      if (want === "Manually Corrected") {
        if (correctionStatus !== "Manually Corrected") continue;
      } else if (shiftStatus !== want && currentStatus !== want) {
        continue;
      }
    }

    rows.push({
      employeeId: emp.id,
      employeeName: name,
      employeeNumber: empNo,
      isActive: emp.isActive,
      currentStatus,
      shiftStatus,
      clockInTime: clockInEvent
        ? formatSchoolLocalTimeDisplay(clockInEvent.schoolLocalTime)
        : null,
      clockOutTime: clockOutEvent
        ? formatSchoolLocalTimeDisplay(clockOutEvent.schoolLocalTime)
        : null,
      workedDuration: durationDisplay,
      source,
      correctionStatus,
      clockInEventId: clockInEvent?.id || null,
      clockOutEventId: clockOutEvent?.id || null,
    });
  }

  const total = rows.length;
  const pageRows = rows.slice(page * pageSize, page * pageSize + pageSize);

  const activeEmployees = employees.filter((e) => e.isActive).length;
  const clockedIn = rows.filter((r) => r.currentStatus === "Clocked In").length;
  const clockedOut = rows.filter((r) => r.currentStatus === "Clocked Out").length;
  const notClockedIn = rows.filter((r) => r.currentStatus === "Not Clocked In").length;
  const openShiftCount = openShifts.filter(
    (o) => o.schoolLocalDate === date || (date === today && o.schoolLocalDate <= today)
  ).length;
  const exceptionCount = await prisma.eduClockException.count({
    where: {
      schoolId: input.schoolId,
      schoolLocalDate: date,
      status: EduClockExceptionStatus.OPEN,
    },
  });

  return {
    schoolId: input.schoolId,
    schoolLocalDate: date,
    timezone: DEFAULT_SCHOOL_TIMEZONE,
    attendanceDayCutoffNote: EDUCLOCK_ATTENDANCE_DAY_CUTOFF_NOTE,
    page,
    pageSize,
    total,
    counts: {
      totalActiveEmployees: activeEmployees,
      clockedIn,
      clockedOut,
      notClockedIn,
      openShifts: openShifts.length,
      exceptions: exceptionCount,
    },
    rows: pageRows,
  };
}

export async function getOwnerExceptions(input: {
  schoolId: string;
  schoolLocalDate?: string;
  status?: string;
  page?: number;
  pageSize?: number;
  nowUtc?: Date;
}): Promise<Record<string, unknown>> {
  const now = input.nowUtc || new Date();
  const today = resolveSchoolLocalParts(now, DEFAULT_SCHOOL_TIMEZONE).schoolLocalDate;
  await ensureMissingClockOutExceptions(input.schoolId, today);

  const date = input.schoolLocalDate ? String(input.schoolLocalDate).trim() : undefined;
  const page = Math.max(0, Number(input.page || 0));
  const pageSize = Math.min(100, Math.max(1, Number(input.pageSize || 25)));
  const status = String(input.status || "OPEN").trim();

  const where: Prisma.EduClockExceptionWhereInput = {
    schoolId: input.schoolId,
    ...(date ? { schoolLocalDate: date } : {}),
    ...(status !== "ALL"
      ? { status: status as EduClockExceptionStatus }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.eduClockException.count({ where }),
    prisma.eduClockException.findMany({
      where,
      include: {
        employee: { select: { firstName: true, lastName: true, fullName: true, employeeNumber: true } },
      },
      orderBy: [{ createdAt: "desc" }],
      skip: page * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    schoolId: input.schoolId,
    page,
    pageSize,
    total,
    rows: rows.map((r) => ({
      id: r.id,
      employeeId: r.employeeId,
      employeeName: employeeDisplayName(r.employee),
      employeeNumber: r.employeeNumberSnapshot || r.employee.employeeNumber,
      schoolLocalDate: r.schoolLocalDate,
      exceptionType: r.exceptionType,
      details: r.details,
      status: r.status,
      resolutionStatus: r.status,
      resolvedByUserId: r.resolvedByUserId,
      resolvedAt: r.resolvedAt?.toISOString() || null,
      relatedEventId: r.relatedEventId,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function getOwnerEvent(input: {
  schoolId: string;
  eventId: string;
}): Promise<Record<string, unknown>> {
  const event = await prisma.eduClockEvent.findFirst({
    where: { id: input.eventId, schoolId: input.schoolId },
  });
  if (!event) {
    throw new EduClockError("EDUCLOCK_NOT_FOUND", 404, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_NOT_FOUND);
  }
  const corrections = await prisma.eduClockEvent.findMany({
    where: { correctedFromEventId: event.id, schoolId: input.schoolId },
    orderBy: { createdAt: "asc" },
  });
  return {
    event: serializeEvent(event),
    corrections: corrections.map((e) => serializeEvent(e)),
  };
}

function parseOwnerCorrectionOccurredAt(input: {
  schoolLocalDate: string;
  schoolLocalTime: string;
  timezone?: string;
}): Date {
  const date = String(input.schoolLocalDate || "").trim();
  const time = String(input.schoolLocalTime || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new EduClockError("EDUCLOCK_IDENTITY_INVALID", 400, "schoolLocalDate must be YYYY-MM-DD");
  }
  const timeNorm = time.length === 5 ? `${time}:00` : time;
  if (!/^\d{2}:\d{2}:\d{2}$/.test(timeNorm)) {
    throw new EduClockError("EDUCLOCK_IDENTITY_INVALID", 400, "schoolLocalTime must be HH:mm or HH:mm:ss");
  }
  // Interpret as Africa/Johannesburg (UTC+2, no DST) for local Build 3.
  const tz = input.timezone || DEFAULT_SCHOOL_TIMEZONE;
  if (tz !== "Africa/Johannesburg") {
    // Keep explicit for future multi-TZ; Build 3 only supports Johannesburg for corrections.
  }
  const iso = `${date}T${timeNorm}+02:00`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new EduClockError("EDUCLOCK_IDENTITY_INVALID", 400, "Invalid correction timestamp");
  }
  return d;
}

export async function ownerCreateCorrection(input: {
  schoolId: string;
  actorUserId: string;
  employeeId: string;
  action: "ADD_CLOCK_IN" | "ADD_CLOCK_OUT" | "CORRECT_TIME" | "CLOSE_OPEN_SHIFT";
  reason: string;
  note?: string | null;
  schoolLocalDate: string;
  schoolLocalTime: string;
  targetEventId?: string | null;
}): Promise<Record<string, unknown>> {
  const reason = String(input.reason || "").trim();
  if (!CORRECTION_REASONS.includes(reason as CorrectionReason)) {
    throw new EduClockError(
      "EDUCLOCK_IDENTITY_INVALID",
      400,
      `Correction reason required. Allowed: ${CORRECTION_REASONS.join("; ")}`
    );
  }
  if (reason === "Other" && !String(input.note || "").trim()) {
    throw new EduClockError("EDUCLOCK_IDENTITY_INVALID", 400, "A note is required when reason is Other.");
  }

  const employee = await prisma.employee.findFirst({
    where: { id: input.employeeId, schoolId: input.schoolId },
  });
  if (!employee) {
    throw new EduClockError("EDUCLOCK_NOT_FOUND", 404, "Employee not found for this school.");
  }
  const empNo = trimEmployeeNumber(employee.employeeNumber);
  if (!empNo) {
    throw new EduClockError(
      "EDUCLOCK_EMPLOYEE_MISSING_NUMBER",
      400,
      EDUCLOCK_READINESS_REASONS.MISSING_EMPLOYEE_NUMBER
    );
  }

  const occurredAtUtc = parseOwnerCorrectionOccurredAt({
    schoolLocalDate: input.schoolLocalDate,
    schoolLocalTime: input.schoolLocalTime,
  });
  const local = resolveSchoolLocalParts(occurredAtUtc, DEFAULT_SCHOOL_TIMEZONE);
  if (local.schoolLocalDate !== input.schoolLocalDate) {
    throw new EduClockError(
      "EDUCLOCK_IDENTITY_INVALID",
      400,
      "Corrected timestamp must remain within the selected school-local date."
    );
  }

  const note = [reason, input.note ? String(input.note).trim() : ""].filter(Boolean).join(" — ");

  return prisma.$transaction(async (tx) => {
    const open = await tx.eduClockOpenShift.findUnique({
      where: {
        schoolId_employeeId: { schoolId: input.schoolId, employeeId: employee.id },
      },
      include: { clockInEvent: true },
    });

    let targetEventId = input.targetEventId ? String(input.targetEventId) : null;
    let eventType: EduClockEventType = EduClockEventType.CLOCK_IN;
    let correctedFromEventId: string | null = null;

    if (input.action === "ADD_CLOCK_IN") {
      if (open) {
        throw new EduClockError(
          "EDUCLOCK_FORBIDDEN",
          409,
          "Cannot add Clock In while an open shift exists."
        );
      }
      eventType = EduClockEventType.CLOCK_IN;
    } else if (input.action === "ADD_CLOCK_OUT" || input.action === "CLOSE_OPEN_SHIFT") {
      if (!open) {
        throw new EduClockError(
          "EDUCLOCK_FORBIDDEN",
          409,
          "No open shift to close with Clock Out."
        );
      }
      if (occurredAtUtc.getTime() <= open.openedAtUtc.getTime()) {
        await tx.eduClockException.create({
          data: {
            schoolId: input.schoolId,
            employeeId: employee.id,
            employeeNumberSnapshot: empNo,
            schoolLocalDate: local.schoolLocalDate,
            exceptionType: EduClockExceptionType.INVALID_EVENT_SEQUENCE,
            details: "Rejected: Clock Out before Clock In",
            status: EduClockExceptionStatus.RESOLVED,
            resolvedByUserId: input.actorUserId,
            resolvedAt: new Date(),
          },
        });
        throw new EduClockError(
          "EDUCLOCK_IDENTITY_INVALID",
          400,
          "Clock Out before Clock In is not allowed."
        );
      }
      eventType = EduClockEventType.CLOCK_OUT;
      correctedFromEventId = open.clockInEventId;
    } else if (input.action === "CORRECT_TIME") {
      if (!targetEventId) {
        throw new EduClockError("EDUCLOCK_IDENTITY_INVALID", 400, "targetEventId required for CORRECT_TIME");
      }
      const original = await tx.eduClockEvent.findFirst({
        where: { id: targetEventId, schoolId: input.schoolId, employeeId: employee.id },
      });
      if (!original) {
        throw new EduClockError("EDUCLOCK_NOT_FOUND", 404, "Original event not found for this school.");
      }
      eventType = original.eventType;
      correctedFromEventId = original.id;

      if (eventType === EduClockEventType.CLOCK_OUT) {
        const pairedIn = await tx.eduClockEvent.findFirst({
          where: {
            schoolId: input.schoolId,
            employeeId: employee.id,
            eventType: EduClockEventType.CLOCK_IN,
            occurredAtUtc: { lt: original.occurredAtUtc },
          },
          orderBy: { occurredAtUtc: "desc" },
        });
        if (pairedIn && occurredAtUtc.getTime() <= pairedIn.occurredAtUtc.getTime()) {
          throw new EduClockError(
            "EDUCLOCK_IDENTITY_INVALID",
            400,
            "Clock Out before Clock In is not allowed."
          );
        }
      }
    } else {
      throw new EduClockError("EDUCLOCK_IDENTITY_INVALID", 400, "Unknown correction action");
    }

    const event = await tx.eduClockEvent.create({
      data: {
        schoolId: input.schoolId,
        employeeId: employee.id,
        employeeNumberSnapshot: empNo,
        userId: employee.userId || input.actorUserId,
        eventType,
        occurredAtUtc,
        schoolLocalDate: local.schoolLocalDate,
        schoolLocalTime: local.schoolLocalTime,
        timezone: local.timezone,
        source: EduClockEventSource.OWNER_MANUAL,
        createdByUserId: input.actorUserId,
        isManualCorrection: true,
        correctedFromEventId,
        note,
        metadata: {
          action: input.action,
          reason,
          before:
            correctedFromEventId && input.action === "CORRECT_TIME"
              ? { targetEventId }
              : open
                ? { openShiftClockInEventId: open.clockInEventId, openedAtUtc: open.openedAtUtc.toISOString() }
                : null,
          after: {
            schoolLocalDate: local.schoolLocalDate,
            schoolLocalTime: local.schoolLocalTime,
            occurredAtUtc: occurredAtUtc.toISOString(),
          },
        },
      },
    });

    if (eventType === EduClockEventType.CLOCK_IN && (input.action === "ADD_CLOCK_IN" || input.action === "CORRECT_TIME")) {
      if (input.action === "ADD_CLOCK_IN") {
        await tx.eduClockOpenShift.create({
          data: {
            schoolId: input.schoolId,
            employeeId: employee.id,
            clockInEventId: event.id,
            schoolLocalDate: local.schoolLocalDate,
            openedAtUtc: occurredAtUtc,
          },
        });
      }
    }

    if (eventType === EduClockEventType.CLOCK_OUT && open) {
      await tx.eduClockOpenShift.deleteMany({ where: { id: open.id } });
      await tx.eduClockException.updateMany({
        where: {
          schoolId: input.schoolId,
          employeeId: employee.id,
          exceptionType: EduClockExceptionType.MISSING_CLOCK_OUT,
          status: EduClockExceptionStatus.OPEN,
        },
        data: {
          status: EduClockExceptionStatus.RESOLVED,
          resolvedByUserId: input.actorUserId,
          resolvedAt: new Date(),
        },
      });
    }

    await tx.eduClockException.create({
      data: {
        schoolId: input.schoolId,
        employeeId: employee.id,
        employeeNumberSnapshot: empNo,
        schoolLocalDate: local.schoolLocalDate,
        exceptionType: EduClockExceptionType.MANUAL_CORRECTION,
        details: `Owner correction: ${input.action} — ${reason}`,
        status: EduClockExceptionStatus.RESOLVED,
        relatedEventId: event.id,
        resolvedByUserId: input.actorUserId,
        resolvedAt: new Date(),
      },
    });

    return {
      ok: true,
      correctionEvent: serializeEvent(event),
      originalEventId: correctedFromEventId,
      action: input.action,
      reason,
    };
  });
}

export { CORRECTION_REASONS };
