/**
 * EduClock staff movement register (v1).
 * Separate from EduClockEvent and EduClockStaffAbsence. Does not create payable minutes.
 */
import {
  EduClockAbsenceApprovalStatus,
  EduClockMovementReason,
  EduClockMovementSource,
  EduClockMovementStatus,
  Prisma,
} from "@prisma/client";

import { prisma } from "../prisma";
import {
  DEFAULT_SCHOOL_TIMEZONE,
  formatSchoolLocalTimeDisplay,
  resolveSchoolLocalParts,
} from "../utils/schoolLocalTime";
import { formatWorkedDurationMs } from "./educlockAttendanceDuration";
import { EduClockError } from "./educlockService";
import { resolveActivatedEmployeeForClock } from "./educlockClockService";
import {
  MOVEMENT_ALREADY_OPEN_MESSAGE,
  MOVEMENT_CLOCK_OUT_BLOCKED_MESSAGE,
  MOVEMENT_DESTINATION_REQUIRED_REASONS,
  MOVEMENT_LEAVE_ABSENT_MESSAGE,
  MOVEMENT_LEAVE_REQUIRES_CLOCK_IN_MESSAGE,
  MOVEMENT_RETURN_NO_OPEN_MESSAGE,
  STAFF_MOVEMENT_REASON_LABELS,
  STAFF_MOVEMENT_REASONS,
  type StaffMovementReasonCode,
} from "./educlockMovementLabels";

export {
  MOVEMENT_ALREADY_OPEN_MESSAGE,
  MOVEMENT_CLOCK_OUT_BLOCKED_MESSAGE,
  MOVEMENT_LEAVE_ABSENT_MESSAGE,
  MOVEMENT_LEAVE_REQUIRES_CLOCK_IN_MESSAGE,
  MOVEMENT_RETURN_NO_OPEN_MESSAGE,
  STAFF_MOVEMENT_REASON_LABELS,
  STAFF_MOVEMENT_REASONS,
} from "./educlockMovementLabels";

const NOTE_MAX = 500;
const DESTINATION_MAX = 200;
const CANCEL_NOTE_MAX = 500;

type GpsTriple = {
  latitude: Prisma.Decimal;
  longitude: Prisma.Decimal;
  accuracyMetres: Prisma.Decimal;
} | null;

function trimEmployeeNumber(value: string | null | undefined): string | null {
  const t = String(value ?? "").trim();
  return t || null;
}

function employeeDisplayName(emp: {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string {
  const full = String(emp.fullName || "").trim();
  if (full) return full;
  return `${emp.firstName || ""} ${emp.lastName || ""}`.trim();
}

function parseReason(raw: unknown): StaffMovementReasonCode {
  const reason = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
    .replace(/COLLECT\/DELIVER/g, "COLLECT_DELIVER")
    .replace(/BANK\/ERRAND/g, "BANK_ERRAND");
  const normalised =
    reason === "COLLECT_DELIVER" || reason === "BANK_ERRAND" || STAFF_MOVEMENT_REASONS.includes(reason as StaffMovementReasonCode)
      ? (reason as StaffMovementReasonCode)
      : "";
  if (!STAFF_MOVEMENT_REASONS.includes(normalised as StaffMovementReasonCode)) {
    throw new EduClockError(
      "EDUCLOCK_IDENTITY_INVALID",
      400,
      `Movement reason required. Allowed: ${STAFF_MOVEMENT_REASONS.join(", ")}`
    );
  }
  return normalised as StaffMovementReasonCode;
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

function parseDestination(raw: unknown, required: boolean): string | null {
  const destination = String(raw ?? "").trim();
  if (required && !destination) {
    throw new EduClockError(
      "EDUCLOCK_IDENTITY_INVALID",
      400,
      "Destination is required for School Business, Meeting, and Collect / Deliver."
    );
  }
  if (destination.length > DESTINATION_MAX) {
    throw new EduClockError(
      "EDUCLOCK_IDENTITY_INVALID",
      400,
      `Destination must be at most ${DESTINATION_MAX} characters.`
    );
  }
  return destination || null;
}

/** Optional GPS — never geofence, never write EduClockGpsAttempt. Invalid values are ignored. */
export function parseOptionalMovementGps(body: Record<string, unknown> | undefined): GpsTriple {
  if (!body || typeof body !== "object") return null;
  const nested = body.gps && typeof body.gps === "object" ? (body.gps as Record<string, unknown>) : null;
  const src = nested || body;
  const lat = Number(src.latitude);
  const lng = Number(src.longitude);
  const acc = Number(src.accuracyMetres);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  const accuracy = Number.isFinite(acc) && acc >= 0 ? acc : 0;
  return {
    latitude: new Prisma.Decimal(lat.toFixed(7)),
    longitude: new Prisma.Decimal(lng.toFixed(7)),
    accuracyMetres: new Prisma.Decimal(accuracy.toFixed(2)),
  };
}

function gpsJson(lat: Prisma.Decimal | null | undefined, lng: Prisma.Decimal | null | undefined, acc: Prisma.Decimal | null | undefined) {
  if (lat == null || lng == null) return null;
  return {
    latitude: Number(lat),
    longitude: Number(lng),
    accuracyMetres: acc == null ? null : Number(acc),
  };
}

export function serializeStaffMovement(
  row: {
    id: string;
    schoolId: string;
    employeeId: string;
    employeeNumberSnapshot: string;
    openShiftId: string | null;
    schoolLocalDate: string;
    timezone: string;
    status: EduClockMovementStatus;
    source: EduClockMovementSource;
    reason: EduClockMovementReason;
    destination: string | null;
    note: string | null;
    departedAtUtc: Date;
    departedByUserId: string;
    returnedAtUtc: Date | null;
    returnedByUserId: string | null;
    durationAwayMs: number | null;
    departLatitude: Prisma.Decimal | null;
    departLongitude: Prisma.Decimal | null;
    departAccuracyMetres: Prisma.Decimal | null;
    returnLatitude: Prisma.Decimal | null;
    returnLongitude: Prisma.Decimal | null;
    returnAccuracyMetres: Prisma.Decimal | null;
    cancelledAtUtc: Date | null;
    cancelledByUserId: string | null;
    cancelNote: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
  extra?: {
    employeeName?: string;
    department?: string | null;
    nowUtc?: Date;
  }
) {
  const reason = row.reason as StaffMovementReasonCode;
  const tz = row.timezone || DEFAULT_SCHOOL_TIMEZONE;
  const elapsedMs =
    row.status === EduClockMovementStatus.OPEN
      ? Math.max(0, (extra?.nowUtc || new Date()).getTime() - row.departedAtUtc.getTime())
      : row.durationAwayMs;
  return {
    id: row.id,
    schoolId: row.schoolId,
    employeeId: row.employeeId,
    employeeNumber: row.employeeNumberSnapshot,
    employeeName: extra?.employeeName || null,
    department: extra?.department ?? null,
    openShiftId: row.openShiftId,
    schoolLocalDate: row.schoolLocalDate,
    timezone: tz,
    status: row.status,
    source: row.source,
    reason,
    reasonLabel: STAFF_MOVEMENT_REASON_LABELS[reason] || reason,
    destination: row.destination,
    note: row.note,
    departedAtUtc: row.departedAtUtc.toISOString(),
    departedTimeDisplay: formatSchoolLocalTimeDisplay(
      resolveSchoolLocalParts(row.departedAtUtc, tz).schoolLocalTime
    ),
    departedByUserId: row.departedByUserId,
    returnedAtUtc: row.returnedAtUtc ? row.returnedAtUtc.toISOString() : null,
    returnedTimeDisplay: row.returnedAtUtc
      ? formatSchoolLocalTimeDisplay(resolveSchoolLocalParts(row.returnedAtUtc, tz).schoolLocalTime)
      : null,
    returnedByUserId: row.returnedByUserId,
    durationAwayMs: row.durationAwayMs,
    durationAwayDisplay:
      row.durationAwayMs != null
        ? formatWorkedDurationMs(row.durationAwayMs)
        : row.status === EduClockMovementStatus.OPEN
          ? formatWorkedDurationMs(elapsedMs || 0)
          : null,
    elapsedAwayMs: elapsedMs,
    elapsedAwayDisplay: elapsedMs != null ? formatWorkedDurationMs(elapsedMs) : null,
    departGps: gpsJson(row.departLatitude, row.departLongitude, row.departAccuracyMetres),
    returnGps: gpsJson(row.returnLatitude, row.returnLongitude, row.returnAccuracyMetres),
    cancelledAtUtc: row.cancelledAtUtc ? row.cancelledAtUtc.toISOString() : null,
    cancelledByUserId: row.cancelledByUserId,
    cancelNote: row.cancelNote,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function findOpenMovement(input: { schoolId: string; employeeId: string }) {
  return prisma.eduClockOpenMovement.findUnique({
    where: {
      schoolId_employeeId: { schoolId: input.schoolId, employeeId: input.employeeId },
    },
    include: { movement: true },
  });
}

async function replayIdempotency(input: {
  schoolId: string;
  userId: string;
  operation: string;
  key: string;
}): Promise<Record<string, unknown> | null> {
  const existing = await prisma.eduClockIdempotencyKey.findUnique({
    where: {
      schoolId_userId_operation_key: {
        schoolId: input.schoolId,
        userId: input.userId,
        operation: input.operation,
        key: input.key,
      },
    },
  });
  if (!existing?.response) return null;
  const cached = existing.response as Record<string, unknown>;
  if (cached.ok === false) {
    throw new EduClockError(
      String(cached.code || "EDUCLOCK_FORBIDDEN") as "EDUCLOCK_FORBIDDEN",
      Number(cached.status || 400) || 400,
      String(cached.error || "Movement request rejected.")
    );
  }
  return { ...cached, idempotentReplay: true };
}

async function storeIdempotency(input: {
  schoolId: string;
  userId: string;
  operation: string;
  key: string;
  movementId?: string | null;
  response: Record<string, unknown>;
}) {
  await prisma.eduClockIdempotencyKey.upsert({
    where: {
      schoolId_userId_operation_key: {
        schoolId: input.schoolId,
        userId: input.userId,
        operation: input.operation,
        key: input.key,
      },
    },
    create: {
      schoolId: input.schoolId,
      userId: input.userId,
      operation: input.operation,
      key: input.key,
      eventId: input.movementId || null,
      response: input.response as unknown as Prisma.InputJsonValue,
    },
    update: {
      eventId: input.movementId || undefined,
      response: input.response as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function staffLeavePremises(input: {
  userId: string;
  schoolId: string;
  reason?: unknown;
  destination?: unknown;
  note?: unknown;
  body?: Record<string, unknown>;
  idempotencyKey?: string | null;
  nowUtc?: Date;
}): Promise<Record<string, unknown>> {
  const { employee } = await resolveActivatedEmployeeForClock({
    userId: input.userId,
    schoolId: input.schoolId,
  });
  const empNo = trimEmployeeNumber(employee.employeeNumber)!;
  const now = input.nowUtc || new Date();
  const local = resolveSchoolLocalParts(now, DEFAULT_SCHOOL_TIMEZONE);
  const idemKey = String(input.idempotencyKey || "").trim();

  if (idemKey) {
    const replay = await replayIdempotency({
      schoolId: input.schoolId,
      userId: input.userId,
      operation: "MOVEMENT_LEAVE",
      key: idemKey,
    });
    if (replay) return replay;
  }

  const todayAbsence = await prisma.eduClockStaffAbsence.findUnique({
    where: {
      schoolId_employeeId_schoolLocalDate: {
        schoolId: input.schoolId,
        employeeId: employee.id,
        schoolLocalDate: local.schoolLocalDate,
      },
    },
  });
  if (todayAbsence?.approvalStatus === EduClockAbsenceApprovalStatus.REPORTED) {
    throw new EduClockError("EDUCLOCK_FORBIDDEN", 409, MOVEMENT_LEAVE_ABSENT_MESSAGE);
  }

  const openShift = await prisma.eduClockOpenShift.findUnique({
    where: { schoolId_employeeId: { schoolId: input.schoolId, employeeId: employee.id } },
  });
  if (!openShift || openShift.schoolLocalDate !== local.schoolLocalDate) {
    throw new EduClockError("EDUCLOCK_FORBIDDEN", 409, MOVEMENT_LEAVE_REQUIRES_CLOCK_IN_MESSAGE);
  }

  const existingOpen = await findOpenMovement({ schoolId: input.schoolId, employeeId: employee.id });
  if (existingOpen) {
    throw new EduClockError("EDUCLOCK_FORBIDDEN", 409, MOVEMENT_ALREADY_OPEN_MESSAGE);
  }

  const reason = parseReason(input.reason);
  const destination = parseDestination(
    input.destination,
    MOVEMENT_DESTINATION_REQUIRED_REASONS.includes(reason)
  );
  const note = parseNote(input.note, reason === "OTHER");
  const gps = parseOptionalMovementGps(input.body);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const movement = await tx.eduClockStaffMovement.create({
        data: {
          schoolId: input.schoolId,
          employeeId: employee.id,
          employeeNumberSnapshot: empNo,
          openShiftId: openShift.id,
          schoolLocalDate: local.schoolLocalDate,
          timezone: local.timezone,
          status: EduClockMovementStatus.OPEN,
          source: EduClockMovementSource.STAFF_SELF_REPORT,
          reason: reason as EduClockMovementReason,
          destination,
          note,
          departedAtUtc: now,
          departedByUserId: input.userId,
          departLatitude: gps?.latitude,
          departLongitude: gps?.longitude,
          departAccuracyMetres: gps?.accuracyMetres,
        },
      });
      await tx.eduClockOpenMovement.create({
        data: {
          schoolId: input.schoolId,
          employeeId: employee.id,
          movementId: movement.id,
          schoolLocalDate: local.schoolLocalDate,
          departedAtUtc: now,
        },
      });
      return movement;
    });

    const payload = {
      ok: true,
      movement: serializeStaffMovement(created, {
        employeeName: employeeDisplayName(employee),
        department: employee.department,
        nowUtc: now,
      }),
    };
    if (idemKey) {
      await storeIdempotency({
        schoolId: input.schoolId,
        userId: input.userId,
        operation: "MOVEMENT_LEAVE",
        key: idemKey,
        movementId: created.id,
        response: payload,
      });
    }
    return payload;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new EduClockError("EDUCLOCK_FORBIDDEN", 409, MOVEMENT_ALREADY_OPEN_MESSAGE);
    }
    throw err;
  }
}

async function closeOpenMovement(input: {
  schoolId: string;
  movement: NonNullable<Awaited<ReturnType<typeof findOpenMovement>>>["movement"];
  actorUserId: string;
  body?: Record<string, unknown>;
  nowUtc: Date;
}): Promise<Record<string, unknown>> {
  const gps = parseOptionalMovementGps(input.body);
  const durationAwayMs = Math.max(0, input.nowUtc.getTime() - input.movement.departedAtUtc.getTime());
  const updated = await prisma.$transaction(async (tx) => {
    const claimed = await tx.eduClockOpenMovement.deleteMany({
      where: { movementId: input.movement.id, schoolId: input.schoolId },
    });
    if (claimed.count !== 1) {
      throw new EduClockError("EDUCLOCK_FORBIDDEN", 409, MOVEMENT_RETURN_NO_OPEN_MESSAGE);
    }
    return tx.eduClockStaffMovement.update({
      where: { id: input.movement.id },
      data: {
        status: EduClockMovementStatus.RETURNED,
        returnedAtUtc: input.nowUtc,
        returnedByUserId: input.actorUserId,
        durationAwayMs,
        returnLatitude: gps?.latitude,
        returnLongitude: gps?.longitude,
        returnAccuracyMetres: gps?.accuracyMetres,
      },
    });
  });
  const emp = await prisma.employee.findFirst({
    where: { id: updated.employeeId, schoolId: input.schoolId },
    select: { firstName: true, lastName: true, fullName: true, department: true },
  });
  return {
    ok: true,
    movement: serializeStaffMovement(updated, {
      employeeName: emp ? employeeDisplayName(emp) : undefined,
      department: emp?.department,
      nowUtc: input.nowUtc,
    }),
  };
}

export async function staffReturnToPremises(input: {
  userId: string;
  schoolId: string;
  body?: Record<string, unknown>;
  idempotencyKey?: string | null;
  nowUtc?: Date;
}): Promise<Record<string, unknown>> {
  const { employee } = await resolveActivatedEmployeeForClock({
    userId: input.userId,
    schoolId: input.schoolId,
  });
  const now = input.nowUtc || new Date();
  const idemKey = String(input.idempotencyKey || "").trim();

  if (idemKey) {
    const replay = await replayIdempotency({
      schoolId: input.schoolId,
      userId: input.userId,
      operation: "MOVEMENT_RETURN",
      key: idemKey,
    });
    if (replay) return replay;
  }

  const open = await findOpenMovement({ schoolId: input.schoolId, employeeId: employee.id });
  if (!open) {
    throw new EduClockError("EDUCLOCK_FORBIDDEN", 409, MOVEMENT_RETURN_NO_OPEN_MESSAGE);
  }

  const payload = await closeOpenMovement({
    schoolId: input.schoolId,
    movement: open.movement,
    actorUserId: input.userId,
    body: input.body,
    nowUtc: now,
  });
  if (idemKey) {
    await storeIdempotency({
      schoolId: input.schoolId,
      userId: input.userId,
      operation: "MOVEMENT_RETURN",
      key: idemKey,
      movementId: open.movement.id,
      response: payload,
    });
  }
  return payload;
}

export async function ownerReturnStaffMovement(input: {
  schoolId: string;
  actorUserId: string;
  movementId: string;
  body?: Record<string, unknown>;
  nowUtc?: Date;
}): Promise<Record<string, unknown>> {
  const now = input.nowUtc || new Date();
  const row = await prisma.eduClockStaffMovement.findFirst({
    where: { id: input.movementId, schoolId: input.schoolId },
  });
  if (!row) {
    throw new EduClockError("EDUCLOCK_NOT_FOUND", 404, "Movement not found for this school.");
  }
  if (row.status === EduClockMovementStatus.RETURNED) {
    return { ok: true, idempotentReplay: true, movement: serializeStaffMovement(row, { nowUtc: now }) };
  }
  if (row.status !== EduClockMovementStatus.OPEN) {
    throw new EduClockError("EDUCLOCK_FORBIDDEN", 409, "Only an open movement can be marked returned.");
  }
  const open = await prisma.eduClockOpenMovement.findFirst({
    where: { movementId: row.id, schoolId: input.schoolId },
    include: { movement: true },
  });
  if (!open) {
    throw new EduClockError("EDUCLOCK_FORBIDDEN", 409, MOVEMENT_RETURN_NO_OPEN_MESSAGE);
  }
  return closeOpenMovement({
    schoolId: input.schoolId,
    movement: open.movement,
    actorUserId: input.actorUserId,
    body: input.body,
    nowUtc: now,
  });
}

export async function ownerCancelStaffMovement(input: {
  schoolId: string;
  actorUserId: string;
  movementId: string;
  note?: unknown;
  nowUtc?: Date;
}): Promise<Record<string, unknown>> {
  const now = input.nowUtc || new Date();
  const cancelNote = parseNote(input.note, false);
  if (String(input.note ?? "").trim() && cancelNote && cancelNote.length > CANCEL_NOTE_MAX) {
    throw new EduClockError("EDUCLOCK_IDENTITY_INVALID", 400, `Note must be at most ${CANCEL_NOTE_MAX} characters.`);
  }

  const row = await prisma.eduClockStaffMovement.findFirst({
    where: { id: input.movementId, schoolId: input.schoolId },
  });
  if (!row) {
    throw new EduClockError("EDUCLOCK_NOT_FOUND", 404, "Movement not found for this school.");
  }
  if (row.status === EduClockMovementStatus.CANCELLED) {
    return { ok: true, idempotentReplay: true, movement: serializeStaffMovement(row, { nowUtc: now }) };
  }
  if (row.status !== EduClockMovementStatus.OPEN) {
    throw new EduClockError("EDUCLOCK_FORBIDDEN", 409, "Only an open movement can be cancelled.");
  }

  const originalDeparted = row.departedAtUtc;
  const originalReason = row.reason;
  const originalDestination = row.destination;
  const originalNote = row.note;
  const originalDepartedBy = row.departedByUserId;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.eduClockOpenMovement.deleteMany({
      where: { movementId: row.id, schoolId: input.schoolId },
    });
    return tx.eduClockStaffMovement.update({
      where: { id: row.id },
      data: {
        status: EduClockMovementStatus.CANCELLED,
        cancelledAtUtc: now,
        cancelledByUserId: input.actorUserId,
        cancelNote,
      },
    });
  });

  if (
    updated.departedAtUtc.getTime() !== originalDeparted.getTime() ||
    updated.reason !== originalReason ||
    updated.destination !== originalDestination ||
    updated.note !== originalNote ||
    updated.departedByUserId !== originalDepartedBy
  ) {
    throw new EduClockError("EDUCLOCK_FORBIDDEN", 500, "Cancel must not overwrite the original movement record.");
  }

  const emp = await prisma.employee.findFirst({
    where: { id: updated.employeeId, schoolId: input.schoolId },
    select: { firstName: true, lastName: true, fullName: true, department: true },
  });
  return {
    ok: true,
    movement: serializeStaffMovement(updated, {
      employeeName: emp ? employeeDisplayName(emp) : undefined,
      department: emp?.department,
      nowUtc: now,
    }),
  };
}

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function listOwnerMovements(input: {
  schoolId: string;
  startDate?: string;
  endDate?: string;
  employeeId?: string;
  employee?: string;
  reason?: string;
  status?: string;
  department?: string;
  page?: number;
  pageSize?: number;
  unlimited?: boolean;
  nowUtc?: Date;
}): Promise<Record<string, unknown>> {
  const now = input.nowUtc || new Date();
  const today = resolveSchoolLocalParts(now, DEFAULT_SCHOOL_TIMEZONE).schoolLocalDate;
  const startDate = String(input.startDate || today).trim() || today;
  const endDate = String(input.endDate || startDate).trim() || startDate;
  const page = Math.max(0, Number(input.page || 0));
  const pageSizeCap = input.unlimited ? 10_000 : 100;
  const pageSize = Math.min(pageSizeCap, Math.max(1, Number(input.pageSize || (input.unlimited ? 10_000 : 25))));
  const statusFilter = String(input.status || "ALL").trim().toUpperCase();
  const reasonFilter = String(input.reason || "").trim().toUpperCase();
  const employeeId = String(input.employeeId || "").trim();
  const employeeSearch = String(input.employee || "").trim().toLowerCase();
  const department = String(input.department || "").trim().toLowerCase();

  const liveOpen = await prisma.eduClockOpenMovement.findMany({
    where: { schoolId: input.schoolId },
    include: {
      movement: true,
      employee: { select: { firstName: true, lastName: true, fullName: true, department: true, employeeNumber: true } },
    },
    orderBy: { departedAtUtc: "asc" },
  });
  const liveRows = liveOpen.map((row) =>
    serializeStaffMovement(row.movement, {
      employeeName: employeeDisplayName(row.employee),
      department: row.employee.department,
      nowUtc: now,
    })
  );

  const historyWhere: Prisma.EduClockStaffMovementWhereInput = {
    schoolId: input.schoolId,
    schoolLocalDate: { gte: startDate, lte: endDate },
    ...(employeeId ? { employeeId } : {}),
    ...(reasonFilter && STAFF_MOVEMENT_REASONS.includes(reasonFilter as StaffMovementReasonCode)
      ? { reason: reasonFilter as EduClockMovementReason }
      : {}),
    ...(statusFilter !== "ALL" &&
    (statusFilter === "OPEN" || statusFilter === "RETURNED" || statusFilter === "CANCELLED")
      ? { status: statusFilter as EduClockMovementStatus }
      : {}),
  };

  const historyRowsRaw = await prisma.eduClockStaffMovement.findMany({
    where: historyWhere,
    include: {
      employee: { select: { firstName: true, lastName: true, fullName: true, department: true, employeeNumber: true } },
    },
    orderBy: [{ schoolLocalDate: "desc" }, { departedAtUtc: "desc" }],
  });

  let historyFiltered = historyRowsRaw;
  if (employeeSearch) {
    historyFiltered = historyFiltered.filter((row) => {
      const hay = `${employeeDisplayName(row.employee)} ${row.employeeNumberSnapshot} ${row.employee.employeeNumber || ""}`.toLowerCase();
      return hay.includes(employeeSearch);
    });
  }
  if (department) {
    historyFiltered = historyFiltered.filter((row) =>
      String(row.employee.department || "")
        .toLowerCase()
        .includes(department)
    );
  }

  const total = historyFiltered.length;
  const pageRows = historyFiltered.slice(page * pageSize, page * pageSize + pageSize).map((row) =>
    serializeStaffMovement(row, {
      employeeName: employeeDisplayName(row.employee),
      department: row.employee.department,
      nowUtc: now,
    })
  );

  return {
    schoolId: input.schoolId,
    schoolLocalDate: today,
    timezone: DEFAULT_SCHOOL_TIMEZONE,
    serverTimeUtc: now.toISOString(),
    live: {
      count: liveRows.length,
      rows: liveRows,
    },
    history: {
      startDate,
      endDate,
      page,
      pageSize,
      total,
      rows: pageRows,
    },
  };
}

export async function exportOwnerMovementsCsv(input: {
  schoolId: string;
  startDate?: string;
  endDate?: string;
  employeeId?: string;
  employee?: string;
  reason?: string;
  status?: string;
  department?: string;
  nowUtc?: Date;
}): Promise<{ filename: string; csv: string }> {
  const all = await listOwnerMovements({ ...input, page: 0, unlimited: true });
  const history = all.history as { startDate: string; endDate: string; rows: Array<Record<string, unknown>> };
  const rows = history.rows || [];
  const header = [
    "date",
    "employee",
    "employeeNumber",
    "department",
    "departure",
    "return",
    "duration",
    "reason",
    "destination",
    "note",
    "status",
    "source",
  ];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvEscape(row.schoolLocalDate),
        csvEscape(row.employeeName),
        csvEscape(row.employeeNumber),
        csvEscape(row.department),
        csvEscape(row.departedTimeDisplay),
        csvEscape(row.returnedTimeDisplay),
        csvEscape(row.durationAwayDisplay),
        csvEscape(row.reasonLabel),
        csvEscape(row.destination),
        csvEscape(row.note),
        csvEscape(row.status),
        csvEscape(row.source),
      ].join(",")
    );
  }
  const start = history.startDate;
  const end = history.endDate;
  return {
    filename: `educlock-movement-register-${start}-to-${end}.csv`,
    csv: `${lines.join("\n")}\n`,
  };
}
