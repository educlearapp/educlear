/**
 * EduClock Build 1 — identity activation & Owner staff link management.
 * Does not create clock events or touch Payroll calculations.
 */
import { Prisma, type Employee, type EmployeeIdentityType } from "@prisma/client";

import { prisma } from "../prisma";
import {
  identityEqualsStored,
  maskIdentityNumber,
  normalizeIdentityForComparison,
  type EmployeeIdentityTypeValue,
  validateIdentityInput,
} from "./employeeIdentityVerification";
import {
  EDUCLOCK_ENTRANCE_NAME_MAX,
  EDUCLOCK_ENTRANCE_RADIUS_DEFAULT,
  EDUCLOCK_ENTRANCE_RADIUS_MAX,
  EDUCLOCK_ENTRANCE_RADIUS_MIN,
  evaluateEntranceGpsReadiness,
  isValidLatitude,
  isValidLongitude,
} from "./educlockGeofenceReadiness";
import {
  buildEntranceDescriptionFromWizard,
  parseEntranceDescription,
  resolveEntranceTypeLabel,
} from "./educlockEntranceType";
import { evaluateCampusBoundaryContainment } from "./geofenceService";

export type EduClockErrorCode =
  | "EDUCLOCK_IDENTITY_REQUIRED"
  | "EDUCLOCK_IDENTITY_INVALID"
  | "EDUCLOCK_ENTRANCE_OUTSIDE_BOUNDARY"
  | "EDUCLOCK_IDENTITY_NOT_FOUND"
  | "EDUCLOCK_IDENTITY_MULTIPLE_MATCHES"
  | "EDUCLOCK_EMPLOYEE_INACTIVE"
  | "EDUCLOCK_EMPLOYEE_MISSING_NUMBER"
  | "EDUCLOCK_EMPLOYEE_ALREADY_LINKED"
  | "EDUCLOCK_USER_ALREADY_LINKED"
  | "EDUCLOCK_EMPLOYEE_SCHOOL_MISMATCH"
  | "EDUCLOCK_USER_INACTIVE"
  | "EDUCLOCK_ACTIVATION_ALREADY_COMPLETE"
  | "EDUCLOCK_NOT_FOUND"
  | "EDUCLOCK_FORBIDDEN"
  /** Build 4 GPS rejection codes (stable machine-readable). */
  | "GPS_PERMISSION_DENIED"
  | "GPS_UNAVAILABLE"
  | "GPS_TIMEOUT"
  | "GPS_COORDINATES_MISSING"
  | "GPS_COORDINATES_INVALID"
  | "GPS_ACCURACY_MISSING"
  | "GPS_ACCURACY_INVALID"
  | "GPS_ACCURACY_TOO_LOW"
  | "NO_ACTIVE_ENTRANCE"
  | "NO_ACTIVE_BOUNDARY"
  | "OUTSIDE_GEOFENCE";

export class EduClockError extends Error {
  readonly code: EduClockErrorCode;
  readonly status: number;

  constructor(code: EduClockErrorCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const EDUCLOCK_ERROR_MESSAGES: Record<EduClockErrorCode, string> = {
  EDUCLOCK_IDENTITY_REQUIRED: "An identity document number is required to activate EduClock.",
  EDUCLOCK_IDENTITY_INVALID: "The identity document details are invalid. Check the type, number, and country.",
  EDUCLOCK_ENTRANCE_OUTSIDE_BOUNDARY:
    "This entrance is outside the saved campus boundary. Check the location before saving.",
  EDUCLOCK_IDENTITY_NOT_FOUND:
    "No matching staff employee record was found for this school. Contact your school owner.",
  EDUCLOCK_IDENTITY_MULTIPLE_MATCHES:
    "More than one staff record matches this identity. Contact your school owner to resolve the conflict.",
  EDUCLOCK_EMPLOYEE_INACTIVE: "Your employee record is inactive. Contact your school owner.",
  EDUCLOCK_EMPLOYEE_MISSING_NUMBER:
    "Your employee record is missing a school employee number. Contact your school owner.",
  EDUCLOCK_EMPLOYEE_ALREADY_LINKED:
    "This employee record is already linked to another login. Contact your school owner.",
  EDUCLOCK_USER_ALREADY_LINKED: "Your login is already linked to an employee record.",
  EDUCLOCK_EMPLOYEE_SCHOOL_MISMATCH: "Staff link is invalid for this school. Contact your school owner.",
  EDUCLOCK_USER_INACTIVE: "Your login account is inactive. Contact your school owner.",
  EDUCLOCK_ACTIVATION_ALREADY_COMPLETE: "EduClock is already activated for this account.",
  EDUCLOCK_NOT_FOUND: "Record not found.",
  EDUCLOCK_FORBIDDEN: "You do not have permission to perform this action.",
  GPS_PERMISSION_DENIED: "Location permission is required to clock in or out.",
  GPS_UNAVAILABLE: "We could not access your location. Please check location services and try again.",
  GPS_TIMEOUT: "Your location request timed out. Move into an open area and try again.",
  GPS_COORDINATES_MISSING: "Location coordinates are required to clock in or out.",
  GPS_COORDINATES_INVALID: "Location coordinates are invalid. Please try again.",
  GPS_ACCURACY_MISSING: "Location accuracy is required to clock in or out.",
  GPS_ACCURACY_INVALID: "Location accuracy is invalid. Please try again.",
  GPS_ACCURACY_TOO_LOW:
    "We could not get an accurate enough location. Move into an open area and try again.",
  NO_ACTIVE_ENTRANCE: "No EduClock entrance has been configured. Contact the school owner.",
  NO_ACTIVE_BOUNDARY:
    "No active campus boundary has been configured. Contact the school owner.",
  OUTSIDE_GEOFENCE: "You are outside the permitted school clocking area.",
};

export type EduClockMeStatus =
  | "NOT_ACTIVATED"
  | "ACTIVE"
  | "BLOCKED_MISSING_EMPLOYEE_NUMBER"
  | "BLOCKED_EMPLOYEE_INACTIVE"
  | "BLOCKED_USER_INACTIVE"
  | "BLOCKED_INVALID_LINK";

export type OwnerStaffStatus =
  | "ACTIVE"
  | "NOT_ACTIVATED"
  | "MISSING_IDENTITY_DOCUMENT"
  | "MISSING_EMPLOYEE_NUMBER"
  | "DUPLICATE_IDENTITY_MATCH"
  | "EMPLOYEE_ALREADY_LINKED"
  | "INACTIVE_EMPLOYEE"
  | "INVALID_LINK";

function employeeDisplayName(emp: Pick<Employee, "fullName" | "firstName" | "lastName">): string {
  const full = String(emp.fullName || "").trim();
  if (full) return full;
  return `${emp.firstName || ""} ${emp.lastName || ""}`.trim();
}

function trimEmployeeNumber(value: string | null | undefined): string | null {
  const t = String(value ?? "").trim();
  return t || null;
}

async function writeAudit(input: {
  schoolId: string;
  userId: string;
  employeeId?: string | null;
  actorUserId: string;
  action: string;
  detail?: string;
}) {
  await prisma.eduClockActivationAudit.create({
    data: {
      schoolId: input.schoolId,
      userId: input.userId,
      employeeId: input.employeeId || null,
      actorUserId: input.actorUserId,
      action: input.action,
      detail: input.detail || null,
    },
  });
}

function asIdentityType(
  value: EmployeeIdentityType | null | undefined
): EmployeeIdentityTypeValue | null {
  if (!value) return null;
  return value as EmployeeIdentityTypeValue;
}

export async function getEduClockMe(input: {
  userId: string;
  schoolId: string;
}): Promise<Record<string, unknown>> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      schoolId: true,
      email: true,
      isActive: true,
      linkedEmployee: {
        select: {
          id: true,
          schoolId: true,
          employeeNumber: true,
          isActive: true,
          firstName: true,
          lastName: true,
          fullName: true,
        },
      },
    },
  });

  const school = await prisma.school.findUnique({
    where: { id: input.schoolId },
    select: { id: true, name: true },
  });

  if (!user || user.schoolId !== input.schoolId) {
    throw new EduClockError("EDUCLOCK_EMPLOYEE_SCHOOL_MISMATCH", 403, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_EMPLOYEE_SCHOOL_MISMATCH);
  }

  if (!user.isActive) {
    return {
      status: "BLOCKED_USER_INACTIVE" satisfies EduClockMeStatus,
      schoolId: input.schoolId,
      schoolName: school?.name || null,
      loginEmail: user.email,
      userId: user.id,
    };
  }

  const emp = user.linkedEmployee;
  if (!emp) {
    return {
      status: "NOT_ACTIVATED" satisfies EduClockMeStatus,
      schoolId: input.schoolId,
      schoolName: school?.name || null,
      loginEmail: user.email,
      userId: user.id,
    };
  }

  if (emp.schoolId !== input.schoolId) {
    return {
      status: "BLOCKED_INVALID_LINK" satisfies EduClockMeStatus,
      schoolId: input.schoolId,
      schoolName: school?.name || null,
      loginEmail: user.email,
      userId: user.id,
    };
  }

  if (!emp.isActive) {
    return {
      status: "BLOCKED_EMPLOYEE_INACTIVE" satisfies EduClockMeStatus,
      schoolId: input.schoolId,
      schoolName: school?.name || null,
      loginEmail: user.email,
      userId: user.id,
      employeeId: emp.id,
      employeeName: employeeDisplayName(emp),
    };
  }

  const empNo = trimEmployeeNumber(emp.employeeNumber);
  if (!empNo) {
    return {
      status: "BLOCKED_MISSING_EMPLOYEE_NUMBER" satisfies EduClockMeStatus,
      schoolId: input.schoolId,
      schoolName: school?.name || null,
      loginEmail: user.email,
      userId: user.id,
      employeeId: emp.id,
      employeeName: employeeDisplayName(emp),
    };
  }

  return {
    status: "ACTIVE" satisfies EduClockMeStatus,
    schoolId: input.schoolId,
    schoolName: school?.name || null,
    loginEmail: user.email,
    userId: user.id,
    employeeId: emp.id,
    employeeNumber: empNo,
    employeeName: employeeDisplayName(emp),
  };
}

export async function activateEduClock(input: {
  userId: string;
  schoolId: string;
  identityType: unknown;
  identityNumber: unknown;
  identityCountryCode?: unknown;
}): Promise<Record<string, unknown>> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      schoolId: true,
      email: true,
      isActive: true,
      linkedEmployee: { select: { id: true } },
    },
  });

  if (!user || user.schoolId !== input.schoolId) {
    throw new EduClockError("EDUCLOCK_EMPLOYEE_SCHOOL_MISMATCH", 403, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_EMPLOYEE_SCHOOL_MISMATCH);
  }
  if (!user.isActive) {
    throw new EduClockError("EDUCLOCK_USER_INACTIVE", 403, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_USER_INACTIVE);
  }
  if (user.linkedEmployee) {
    throw new EduClockError(
      "EDUCLOCK_ACTIVATION_ALREADY_COMPLETE",
      409,
      EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_ACTIVATION_ALREADY_COMPLETE
    );
  }

  const validated = validateIdentityInput({
    identityType: input.identityType,
    identityNumber: input.identityNumber,
    identityCountryCode: input.identityCountryCode,
  });
  if (!validated.valid) {
    throw new EduClockError(validated.errorCode, 400, EDUCLOCK_ERROR_MESSAGES[validated.errorCode]);
  }

  const candidates = await prisma.employee.findMany({
    where: {
      schoolId: input.schoolId,
      idNumber: { not: null },
    },
  });

  const matches = candidates.filter((emp) =>
    identityEqualsStored({
      submittedType: validated.identityType,
      submittedNormalized: validated.normalized,
      submittedCountry: validated.countryCode,
      storedIdNumber: emp.idNumber,
      storedIdentityType: asIdentityType(emp.identityType),
      storedCountryCode: emp.identityCountryCode,
    })
  );

  if (matches.length === 0) {
    throw new EduClockError("EDUCLOCK_IDENTITY_NOT_FOUND", 404, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_IDENTITY_NOT_FOUND);
  }
  if (matches.length > 1) {
    throw new EduClockError(
      "EDUCLOCK_IDENTITY_MULTIPLE_MATCHES",
      409,
      EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_IDENTITY_MULTIPLE_MATCHES
    );
  }

  const employee = matches[0]!;

  if (employee.schoolId !== input.schoolId) {
    throw new EduClockError("EDUCLOCK_EMPLOYEE_SCHOOL_MISMATCH", 403, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_EMPLOYEE_SCHOOL_MISMATCH);
  }
  if (!employee.isActive) {
    throw new EduClockError("EDUCLOCK_EMPLOYEE_INACTIVE", 403, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_EMPLOYEE_INACTIVE);
  }
  const empNo = trimEmployeeNumber(employee.employeeNumber);
  if (!empNo) {
    throw new EduClockError(
      "EDUCLOCK_EMPLOYEE_MISSING_NUMBER",
      403,
      EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_EMPLOYEE_MISSING_NUMBER
    );
  }
  if (employee.userId) {
    throw new EduClockError(
      "EDUCLOCK_EMPLOYEE_ALREADY_LINKED",
      409,
      EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_EMPLOYEE_ALREADY_LINKED
    );
  }

  try {
    await prisma.employee.update({
      where: { id: employee.id },
      data: {
        userId: user.id,
        identityType: validated.identityType as EmployeeIdentityType,
        identityCountryCode: validated.countryCode,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new EduClockError("EDUCLOCK_USER_ALREADY_LINKED", 409, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_USER_ALREADY_LINKED);
    }
    throw err;
  }

  await writeAudit({
    schoolId: input.schoolId,
    userId: user.id,
    employeeId: employee.id,
    actorUserId: user.id,
    action: "ACTIVATED",
    detail: `Activated via ${validated.identityType}; employee link created; identity verified (masked not stored)`,
  });

  return {
    status: "ACTIVE",
    activationStatus: "ACTIVATED",
    userId: user.id,
    schoolId: input.schoolId,
    employeeId: employee.id,
    employeeNumber: empNo,
    employeeName: employeeDisplayName(employee),
    identityMasked: maskIdentityNumber(employee.idNumber),
  };
}

function classifyOwnerStaffRow(input: {
  user: { id: string; email: string; isActive: boolean; fullName: string | null };
  employee: Employee | null;
  isDuplicateIdentity: boolean;
}): { status: OwnerStaffStatus; employeeId: string | null } {
  const emp = input.employee;
  if (!emp) {
    return { status: "NOT_ACTIVATED", employeeId: null };
  }
  if (emp.userId && emp.userId !== input.user.id) {
    return { status: "EMPLOYEE_ALREADY_LINKED", employeeId: emp.id };
  }
  if (!emp.isActive) {
    return { status: "INACTIVE_EMPLOYEE", employeeId: emp.id };
  }
  if (!trimEmployeeNumber(emp.employeeNumber)) {
    return { status: "MISSING_EMPLOYEE_NUMBER", employeeId: emp.id };
  }
  if (!String(emp.idNumber || "").trim()) {
    return { status: "MISSING_IDENTITY_DOCUMENT", employeeId: emp.id };
  }
  if (input.isDuplicateIdentity) {
    return { status: "DUPLICATE_IDENTITY_MATCH", employeeId: emp.id };
  }
  if (emp.userId === input.user.id) {
    return { status: "ACTIVE", employeeId: emp.id };
  }
  if (!emp.userId) {
    return { status: "NOT_ACTIVATED", employeeId: emp.id };
  }
  return { status: "INVALID_LINK", employeeId: emp.id };
}

export async function listOwnerEduClockStaff(schoolId: string): Promise<Record<string, unknown>[]> {
  const users = await prisma.user.findMany({
    where: { schoolId },
    select: {
      id: true,
      email: true,
      fullName: true,
      isActive: true,
      linkedEmployee: true,
    },
    orderBy: { email: "asc" },
  });

  const employees = await prisma.employee.findMany({ where: { schoolId } });
  const byUserId = new Map(employees.filter((e) => e.userId).map((e) => [e.userId!, e]));

  // Duplicate identity keys within school (normalized) — for status only; never return raw numbers.
  const keyToIds = new Map<string, string[]>();
  for (const emp of employees) {
    if (!emp.idNumber) continue;
    const type = asIdentityType(emp.identityType) || "SA_ID";
    const norm = normalizeIdentityForComparison(type, emp.idNumber, emp.identityCountryCode);
    if (!norm) continue;
    const key = `${type}|${norm.countryCode || ""}|${norm.normalized}`;
    const list = keyToIds.get(key) || [];
    list.push(emp.id);
    keyToIds.set(key, list);
  }
  const dupIds = new Set<string>();
  for (const ids of keyToIds.values()) {
    if (ids.length > 1) ids.forEach((id) => dupIds.add(id));
  }

  return users.map((user) => {
    const linked = user.linkedEmployee || byUserId.get(user.id) || null;
    const classified = classifyOwnerStaffRow({
      user,
      employee: linked,
      isDuplicateIdentity: Boolean(linked && dupIds.has(linked.id)),
    });

    return {
      userId: user.id,
      loginEmail: user.email,
      userName: user.fullName || user.email,
      userActive: user.isActive,
      status: classified.status,
      employeeId: classified.employeeId,
      employeeNumber: linked ? trimEmployeeNumber(linked.employeeNumber) : null,
      employeeName: linked ? employeeDisplayName(linked) : null,
      identityMasked: linked?.idNumber ? maskIdentityNumber(linked.idNumber) : null,
      identityType: linked?.identityType || null,
      hasIdentityDocument: Boolean(String(linked?.idNumber || "").trim()),
    };
  });
}

export async function ownerResetActivation(input: {
  schoolId: string;
  actorUserId: string;
  userId: string;
}): Promise<{ ok: true; status: "NOT_ACTIVATED" }> {
  const user = await prisma.user.findFirst({
    where: { id: input.userId, schoolId: input.schoolId },
    include: { linkedEmployee: true },
  });
  if (!user) {
    throw new EduClockError("EDUCLOCK_NOT_FOUND", 404, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_NOT_FOUND);
  }

  const emp = user.linkedEmployee;
  if (emp) {
    await prisma.employee.update({
      where: { id: emp.id },
      data: { userId: null },
    });
  }

  await writeAudit({
    schoolId: input.schoolId,
    userId: user.id,
    employeeId: emp?.id || null,
    actorUserId: input.actorUserId,
    action: "RESET",
    detail: "Owner reset EduClock activation link; Employee and User preserved",
  });

  return { ok: true, status: "NOT_ACTIVATED" };
}

export async function ownerManualLink(input: {
  schoolId: string;
  actorUserId: string;
  userId: string;
  employeeId: string;
}): Promise<Record<string, unknown>> {
  const user = await prisma.user.findFirst({
    where: { id: input.userId, schoolId: input.schoolId },
    include: { linkedEmployee: true },
  });
  if (!user) {
    throw new EduClockError("EDUCLOCK_NOT_FOUND", 404, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_NOT_FOUND);
  }
  if (!user.isActive) {
    throw new EduClockError("EDUCLOCK_USER_INACTIVE", 403, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_USER_INACTIVE);
  }
  if (user.linkedEmployee) {
    throw new EduClockError("EDUCLOCK_USER_ALREADY_LINKED", 409, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_USER_ALREADY_LINKED);
  }

  const employee = await prisma.employee.findFirst({
    where: { id: input.employeeId, schoolId: input.schoolId },
  });
  if (!employee) {
    throw new EduClockError("EDUCLOCK_NOT_FOUND", 404, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_NOT_FOUND);
  }
  if (employee.schoolId !== input.schoolId) {
    throw new EduClockError("EDUCLOCK_EMPLOYEE_SCHOOL_MISMATCH", 403, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_EMPLOYEE_SCHOOL_MISMATCH);
  }
  if (!employee.isActive) {
    throw new EduClockError("EDUCLOCK_EMPLOYEE_INACTIVE", 403, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_EMPLOYEE_INACTIVE);
  }
  if (!trimEmployeeNumber(employee.employeeNumber)) {
    throw new EduClockError(
      "EDUCLOCK_EMPLOYEE_MISSING_NUMBER",
      403,
      EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_EMPLOYEE_MISSING_NUMBER
    );
  }
  if (employee.userId) {
    throw new EduClockError(
      "EDUCLOCK_EMPLOYEE_ALREADY_LINKED",
      409,
      EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_EMPLOYEE_ALREADY_LINKED
    );
  }
  if (!String(employee.idNumber || "").trim()) {
    throw new EduClockError("EDUCLOCK_IDENTITY_REQUIRED", 400, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_IDENTITY_REQUIRED);
  }

  await prisma.employee.update({
    where: { id: employee.id },
    data: { userId: user.id },
  });

  await writeAudit({
    schoolId: input.schoolId,
    userId: user.id,
    employeeId: employee.id,
    actorUserId: input.actorUserId,
    action: "MANUAL_LINK",
    detail: "Owner manually linked User to Employee",
  });

  return {
    status: "ACTIVE",
    userId: user.id,
    employeeId: employee.id,
    employeeNumber: trimEmployeeNumber(employee.employeeNumber),
    employeeName: employeeDisplayName(employee),
    identityMasked: maskIdentityNumber(employee.idNumber),
  };
}

export async function ownerUnlink(input: {
  schoolId: string;
  actorUserId: string;
  userId: string;
}): Promise<{ ok: true }> {
  return ownerResetActivation(input).then(() => ({ ok: true }));
}

export type EduClockReadinessBucket =
  | "readyToActivate"
  | "missingEmployeeNumber"
  | "missingIdentityDocument"
  | "invalidIdentityDocument"
  | "alreadyActivated"
  | "requiresManualReview";

/** Owner UI readiness reason labels (Build 2). */
export const EDUCLOCK_READINESS_REASONS = {
  MISSING_EMPLOYEE_NUMBER: "Missing Employee Number",
  MISSING_IDENTITY_DOCUMENT: "Missing Identity Document",
  INVALID_IDENTITY_DOCUMENT: "Invalid Identity Document",
  USER_ACCOUNT_NOT_LINKED: "User Account Not Linked",
  EMPLOYEE_INACTIVE: "Employee Inactive",
  READY: "Ready",
} as const;

function classifyEmployeeReadiness(emp: Employee, duplicateIdentity: boolean, duplicateEmpNo: boolean): {
  bucket: EduClockReadinessBucket;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (!emp.isActive) {
    reasons.push(EDUCLOCK_READINESS_REASONS.EMPLOYEE_INACTIVE);
    return { bucket: "requiresManualReview", reasons };
  }
  if (duplicateEmpNo) reasons.push("Duplicate Employee Number");
  if (duplicateIdentity) reasons.push("Duplicate Identity Match");
  if (emp.userId) {
    return { bucket: "alreadyActivated", reasons: [EDUCLOCK_READINESS_REASONS.READY] };
  }
  reasons.push(EDUCLOCK_READINESS_REASONS.USER_ACCOUNT_NOT_LINKED);
  const empNo = trimEmployeeNumber(emp.employeeNumber);
  if (!empNo) {
    reasons.push(EDUCLOCK_READINESS_REASONS.MISSING_EMPLOYEE_NUMBER);
    return { bucket: "missingEmployeeNumber", reasons };
  }
  if (!String(emp.idNumber || "").trim()) {
    reasons.push(EDUCLOCK_READINESS_REASONS.MISSING_IDENTITY_DOCUMENT);
    return { bucket: "missingIdentityDocument", reasons };
  }
  const type = asIdentityType(emp.identityType) || "SA_ID";
  if ((type === "PASSPORT" || type === "PERMIT") && !normalizeCountryCodeSafe(emp.identityCountryCode)) {
    reasons.push(EDUCLOCK_READINESS_REASONS.INVALID_IDENTITY_DOCUMENT);
    return { bucket: "invalidIdentityDocument", reasons };
  }
  if (type === "SA_ID") {
    const check = validateIdentityInput({
      identityType: "SA_ID",
      identityNumber: emp.idNumber,
    });
    if (!check.valid) {
      reasons.push(EDUCLOCK_READINESS_REASONS.INVALID_IDENTITY_DOCUMENT);
      return { bucket: "invalidIdentityDocument", reasons };
    }
  }
  if (reasons.some((r) => r === "Duplicate Employee Number" || r === "Duplicate Identity Match")) {
    return { bucket: "requiresManualReview", reasons };
  }
  return {
    bucket: "readyToActivate",
    reasons: [EDUCLOCK_READINESS_REASONS.READY, EDUCLOCK_READINESS_REASONS.USER_ACCOUNT_NOT_LINKED],
  };
}

function normalizeCountryCodeSafe(value: string | null | undefined): string | null {
  const c = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

export async function getOwnerEduClockReadiness(schoolId: string): Promise<Record<string, unknown>> {
  const [employees, users] = await Promise.all([
    prisma.employee.findMany({ where: { schoolId } }),
    prisma.user.findMany({
      where: { schoolId },
      select: { id: true, email: true, fullName: true, isActive: true, linkedEmployee: { select: { id: true } } },
    }),
  ]);

  const empNoMap = new Map<string, string[]>();
  const idKeyMap = new Map<string, string[]>();
  for (const emp of employees) {
    const no = trimEmployeeNumber(emp.employeeNumber);
    if (no) {
      const list = empNoMap.get(no) || [];
      list.push(emp.id);
      empNoMap.set(no, list);
    }
    if (emp.idNumber) {
      const type = asIdentityType(emp.identityType) || "SA_ID";
      const norm = normalizeIdentityForComparison(type, emp.idNumber, emp.identityCountryCode);
      if (norm) {
        const key = `${type}|${norm.countryCode || ""}|${norm.normalized}`;
        const list = idKeyMap.get(key) || [];
        list.push(emp.id);
        idKeyMap.set(key, list);
      }
    }
  }
  const dupEmpNos = new Set<string>();
  for (const ids of empNoMap.values()) if (ids.length > 1) ids.forEach((id) => dupEmpNos.add(id));
  const dupIds = new Set<string>();
  for (const ids of idKeyMap.values()) if (ids.length > 1) ids.forEach((id) => dupIds.add(id));

  const counts: Record<EduClockReadinessBucket, number> = {
    readyToActivate: 0,
    missingEmployeeNumber: 0,
    missingIdentityDocument: 0,
    invalidIdentityDocument: 0,
    alreadyActivated: 0,
    requiresManualReview: 0,
  };

  const employeeRows = employees.map((emp) => {
    const classified = classifyEmployeeReadiness(emp, dupIds.has(emp.id), dupEmpNos.has(emp.id));
    counts[classified.bucket] += 1;
    return {
      employeeId: emp.id,
      employeeName: employeeDisplayName(emp),
      email: emp.email,
      employeeNumber: trimEmployeeNumber(emp.employeeNumber),
      isActive: emp.isActive,
      linkedUserId: emp.userId,
      identityType: emp.identityType,
      identityMasked: emp.idNumber ? maskIdentityNumber(emp.idNumber) : null,
      hasIdentityDocument: Boolean(String(emp.idNumber || "").trim()),
      hasIdentityCountry: Boolean(normalizeCountryCodeSafe(emp.identityCountryCode)),
      readiness: classified.bucket,
      reasons: classified.reasons,
    };
  });

  const usersWithoutEmployee = users.filter((u) => !u.linkedEmployee).map((u) => ({
    userId: u.id,
    loginEmail: u.email,
    userName: u.fullName || u.email,
    userActive: u.isActive,
  }));

  return {
    schoolId,
    counts,
    totals: {
      employees: employees.length,
      users: users.length,
      usersWithoutEmployee: usersWithoutEmployee.length,
      duplicateEmployeeNumbers: [...empNoMap.values()].filter((x) => x.length > 1).length,
      duplicateIdentityMatches: [...idKeyMap.values()].filter((x) => x.length > 1).length,
      inactiveEmployees: employees.filter((e) => !e.isActive).length,
      alreadyLinkedEmployees: employees.filter((e) => Boolean(e.userId)).length,
    },
    employees: employeeRows,
    usersWithoutEmployee,
  };
}

export async function ownerBulkUpdateEmployeeNumbers(input: {
  schoolId: string;
  actorUserId: string;
  updates: Array<{ employeeId: string; employeeNumber: string }>;
}): Promise<Record<string, unknown>> {
  if (!Array.isArray(input.updates) || input.updates.length === 0) {
    throw new EduClockError("EDUCLOCK_IDENTITY_INVALID", 400, "No employee number updates provided.");
  }

  const normalized = input.updates.map((row) => ({
    employeeId: String(row.employeeId || "").trim(),
    employeeNumber: String(row.employeeNumber || "").trim(),
  }));

  for (const row of normalized) {
    if (!row.employeeId) {
      throw new EduClockError("EDUCLOCK_IDENTITY_INVALID", 400, "Each update requires employeeId.");
    }
    if (!row.employeeNumber) {
      throw new EduClockError("EDUCLOCK_EMPLOYEE_MISSING_NUMBER", 400, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_EMPLOYEE_MISSING_NUMBER);
    }
  }

  const seen = new Map<string, string>();
  for (const row of normalized) {
    if (seen.has(row.employeeNumber)) {
      throw new EduClockError(
        "EDUCLOCK_IDENTITY_INVALID",
        409,
        "Duplicate employee numbers in the submitted batch."
      );
    }
    seen.set(row.employeeNumber, row.employeeId);
  }

  const existing = await prisma.employee.findMany({
    where: { schoolId: input.schoolId },
    select: { id: true, employeeNumber: true },
  });
  const byId = new Map(existing.map((e) => [e.id, e]));
  const occupied = new Map<string, string>();
  for (const e of existing) {
    const no = trimEmployeeNumber(e.employeeNumber);
    if (no) occupied.set(no, e.id);
  }

  for (const row of normalized) {
    if (!byId.has(row.employeeId)) {
      throw new EduClockError("EDUCLOCK_NOT_FOUND", 404, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_NOT_FOUND);
    }
    const ownerOfNumber = occupied.get(row.employeeNumber);
    if (ownerOfNumber && ownerOfNumber !== row.employeeId) {
      throw new EduClockError(
        "EDUCLOCK_IDENTITY_INVALID",
        409,
        "Employee number already used by another employee in this school."
      );
    }
  }

  const results: Array<{ employeeId: string; employeeNumber: string }> = [];
  await prisma.$transaction(async (tx) => {
    for (const row of normalized) {
      await tx.employee.update({
        where: { id: row.employeeId },
        data: { employeeNumber: row.employeeNumber },
      });
      results.push(row);
    }
  });

  await writeAudit({
    schoolId: input.schoolId,
    userId: input.actorUserId,
    actorUserId: input.actorUserId,
    action: "BULK_EMPLOYEE_NUMBER_UPDATE",
    detail: `Updated ${results.length} employee number(s)`,
  });

  return { updatedCount: results.length, updated: results };
}

const DEFAULT_TOLERANCE_METRES = 4;

function serializeEntrance(
  entrance: {
    id: string;
    schoolId?: string;
    campusId?: string;
    name: string;
    description: string | null;
    isActive: boolean;
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
    allowedRadiusMetres?: number;
  },
  campusIsActive: boolean,
  boundary?: { status: string; zoneId?: string } | null
) {
  const latitude = entrance.latitude == null ? null : Number(entrance.latitude);
  const longitude = entrance.longitude == null ? null : Number(entrance.longitude);
  const allowedRadiusMetres =
    entrance.allowedRadiusMetres == null
      ? EDUCLOCK_ENTRANCE_RADIUS_DEFAULT
      : Number(entrance.allowedRadiusMetres);
  const readiness = evaluateEntranceGpsReadiness({
    entranceIsActive: entrance.isActive,
    campusIsActive,
    latitude,
    longitude,
    allowedRadiusMetres,
  });
  const parsed = parseEntranceDescription(entrance.description);
  return {
    id: entrance.id,
    schoolId: entrance.schoolId,
    campusId: entrance.campusId,
    name: entrance.name,
    description: entrance.description,
    entranceType: parsed.meta?.type ?? null,
    entranceTypeLabel: resolveEntranceTypeLabel(parsed.meta),
    customTypeLabel: parsed.meta?.customLabel ?? null,
    isActive: entrance.isActive,
    latitude,
    longitude,
    allowedRadiusMetres,
    gpsReady: readiness.gpsReady,
    gpsReadinessCode: readiness.code,
    gpsReadinessReasons: readiness.reasons,
    boundaryStatus: boundary?.status ?? null,
    boundaryZoneId: boundary && "zoneId" in boundary ? boundary.zoneId ?? null : null,
    /** Informational — staff clock uses active campus boundary polygons (gps-boundary-v1). */
    polygonValidationEnabled: true,
  };
}

async function assertEntranceBoundaryAllowed(input: {
  schoolId: string;
  campusId: string;
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  confirmOutsideBoundary?: boolean;
}) {
  if (input.latitude == null || input.longitude == null) {
    return { status: "NO_BOUNDARY" as const };
  }
  const containment = await evaluateCampusBoundaryContainment({
    schoolId: input.schoolId,
    campusId: input.campusId,
    latitude: input.latitude,
    longitude: input.longitude,
  });
  if (containment.status === "OUTSIDE" && !input.confirmOutsideBoundary) {
    throw new EduClockError(
      "EDUCLOCK_ENTRANCE_OUTSIDE_BOUNDARY",
      400,
      "This entrance is outside the saved campus boundary. Check the location before saving."
    );
  }
  return containment;
}

function serializeCampus(campus: {
  id: string;
  schoolId: string;
  name: string;
  description: string | null;
  timezone: string;
  toleranceMetres: number;
  isActive: boolean;
  perimeterStatus: string;
  createdAt: Date;
  updatedAt: Date;
  entrances?: Array<{
    id: string;
    schoolId?: string;
    campusId?: string;
    name: string;
    description: string | null;
    isActive: boolean;
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
    allowedRadiusMetres?: number;
  }>;
}) {
  const entrances = (campus.entrances || []).map((e) => serializeEntrance(e, campus.isActive));
  return {
    id: campus.id,
    schoolId: campus.schoolId,
    name: campus.name,
    description: campus.description,
    timezone: campus.timezone,
    /** Future polygon/perimeter tolerance — NOT used for entrance clock validation. */
    toleranceMetres: campus.toleranceMetres,
    isActive: campus.isActive,
    perimeterStatus: campus.perimeterStatus,
    entranceCount: entrances.length,
    gpsReadyEntranceCount: entrances.filter((e) => e.gpsReady).length,
    entrances,
    createdAt: campus.createdAt.toISOString(),
    updatedAt: campus.updatedAt.toISOString(),
    perimeterNote:
      campus.perimeterStatus === "NOT_DRAWN"
        ? "Campus perimeter not drawn yet. Staff clock-in and clock-out require an active campus boundary polygon."
        : "Campus perimeter polygon is the authority for staff clock-in and clock-out GPS (any point inside the boundary).",
  };
}

function parseOptionalCoordinate(
  value: unknown,
  kind: "latitude" | "longitude"
): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) {
    throw new EduClockError(
      "EDUCLOCK_IDENTITY_INVALID",
      400,
      kind === "latitude"
        ? "Latitude must be a number between -90 and 90."
        : "Longitude must be a number between -180 and 180."
    );
  }
  if (kind === "latitude" && !isValidLatitude(n)) {
    throw new EduClockError("EDUCLOCK_IDENTITY_INVALID", 400, "Latitude must be a number between -90 and 90.");
  }
  if (kind === "longitude" && !isValidLongitude(n)) {
    throw new EduClockError(
      "EDUCLOCK_IDENTITY_INVALID",
      400,
      "Longitude must be a number between -180 and 180."
    );
  }
  return n;
}

function parseRadiusMetres(value: unknown, required: boolean): number | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new EduClockError(
        "EDUCLOCK_IDENTITY_INVALID",
        400,
        "Entrance radius must be a whole number between 1 and 25."
      );
    }
    return undefined;
  }
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new EduClockError(
      "EDUCLOCK_IDENTITY_INVALID",
      400,
      "Entrance radius must be a whole number between 1 and 25."
    );
  }
  if (n < EDUCLOCK_ENTRANCE_RADIUS_MIN || n > EDUCLOCK_ENTRANCE_RADIUS_MAX) {
    throw new EduClockError(
      "EDUCLOCK_IDENTITY_INVALID",
      400,
      "Entrance radius must be between 1 and 25 metres."
    );
  }
  return n;
}

function normalizeEntranceName(name: string): string {
  const trimmed = String(name || "").trim();
  if (!trimmed) {
    throw new EduClockError("EDUCLOCK_IDENTITY_INVALID", 400, "Entrance name is required.");
  }
  if (trimmed.length > EDUCLOCK_ENTRANCE_NAME_MAX) {
    throw new EduClockError(
      "EDUCLOCK_IDENTITY_INVALID",
      400,
      `Entrance name must be at most ${EDUCLOCK_ENTRANCE_NAME_MAX} characters.`
    );
  }
  return trimmed;
}

/**
 * Case-insensitive duplicate-name guard within a campus (active + inactive).
 * Limitation: DB @@unique([campusId, name]) is still case-sensitive, so "Gate" vs "gate"
 * is enforced here in application code rather than by a destructive uniqueness migration.
 */
async function assertUniqueEntranceName(input: {
  schoolId: string;
  campusId: string;
  name: string;
  excludeEntranceId?: string;
}) {
  const existing = await prisma.eduClockEntrance.findMany({
    where: {
      schoolId: input.schoolId,
      campusId: input.campusId,
      ...(input.excludeEntranceId ? { id: { not: input.excludeEntranceId } } : {}),
    },
    select: { id: true, name: true },
  });
  const target = input.name.trim().toLowerCase();
  if (existing.some((e) => e.name.trim().toLowerCase() === target)) {
    throw new EduClockError(
      "EDUCLOCK_IDENTITY_INVALID",
      409,
      "An entrance with this name already exists on the campus."
    );
  }
}

export async function listEduClockCampuses(schoolId: string) {
  const campuses = await prisma.eduClockCampus.findMany({
    where: { schoolId },
    include: { entrances: { orderBy: { name: "asc" } } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  const serialized = campuses.map(serializeCampus);
  const summary = {
    totalCampuses: serialized.length,
    activeCampuses: serialized.filter((c) => c.isActive).length,
    totalEntrances: serialized.reduce((n, c) => n + c.entranceCount, 0),
    gpsReadyEntrances: serialized.reduce((n, c) => n + c.gpsReadyEntranceCount, 0),
    notReadyEntrances: 0,
  };
  summary.notReadyEntrances = summary.totalEntrances - summary.gpsReadyEntrances;
  return { campuses: serialized, summary };
}

export async function createEduClockCampus(input: {
  schoolId: string;
  actorUserId: string;
  name: string;
  description?: string | null;
  timezone?: string | null;
  toleranceMetres?: number | null;
}) {
  const name = String(input.name || "").trim();
  if (!name) {
    throw new EduClockError("EDUCLOCK_IDENTITY_INVALID", 400, "Campus name is required.");
  }
  const tolerance =
    input.toleranceMetres == null || Number.isNaN(Number(input.toleranceMetres))
      ? DEFAULT_TOLERANCE_METRES
      : Math.max(0, Math.floor(Number(input.toleranceMetres)));

  try {
    const campus = await prisma.eduClockCampus.create({
      data: {
        schoolId: input.schoolId,
        name,
        description: input.description ? String(input.description).trim() : null,
        timezone: String(input.timezone || "Africa/Johannesburg").trim() || "Africa/Johannesburg",
        toleranceMetres: tolerance,
        isActive: true,
        perimeterStatus: "NOT_DRAWN",
      },
      include: { entrances: true },
    });
    await writeAudit({
      schoolId: input.schoolId,
      userId: input.actorUserId,
      actorUserId: input.actorUserId,
      action: "CAMPUS_CREATE",
      detail: `Campus ${campus.id}`,
    });
    return serializeCampus(campus);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new EduClockError("EDUCLOCK_IDENTITY_INVALID", 409, "A campus with this name already exists.");
    }
    throw err;
  }
}

export async function updateEduClockCampus(input: {
  schoolId: string;
  actorUserId: string;
  campusId: string;
  name?: string;
  description?: string | null;
  timezone?: string | null;
  toleranceMetres?: number | null;
  isActive?: boolean;
}) {
  const existing = await prisma.eduClockCampus.findFirst({
    where: { id: input.campusId, schoolId: input.schoolId },
  });
  if (!existing) {
    throw new EduClockError("EDUCLOCK_NOT_FOUND", 404, "Campus not found for this school.");
  }

  const data: Prisma.EduClockCampusUpdateInput = {};
  if (input.name !== undefined) {
    const name = String(input.name || "").trim();
    if (!name) throw new EduClockError("EDUCLOCK_IDENTITY_INVALID", 400, "Campus name is required.");
    data.name = name;
  }
  if (input.description !== undefined) {
    data.description = input.description ? String(input.description).trim() : null;
  }
  if (input.timezone !== undefined) {
    data.timezone = String(input.timezone || "Africa/Johannesburg").trim() || "Africa/Johannesburg";
  }
  if (input.toleranceMetres !== undefined && input.toleranceMetres !== null) {
    data.toleranceMetres = Math.max(0, Math.floor(Number(input.toleranceMetres)));
  }
  if (typeof input.isActive === "boolean") {
    data.isActive = input.isActive;
  }

  try {
    const campus = await prisma.eduClockCampus.update({
      where: { id: existing.id },
      data,
      include: { entrances: { orderBy: { name: "asc" } } },
    });
    await writeAudit({
      schoolId: input.schoolId,
      userId: input.actorUserId,
      actorUserId: input.actorUserId,
      action: input.isActive === false ? "CAMPUS_DEACTIVATE" : "CAMPUS_UPDATE",
      detail: `Campus ${campus.id}`,
    });
    return serializeCampus(campus);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new EduClockError("EDUCLOCK_IDENTITY_INVALID", 409, "A campus with this name already exists.");
    }
    throw err;
  }
}

export async function createEduClockEntrance(input: {
  schoolId: string;
  actorUserId: string;
  campusId: string;
  name: string;
  description?: string | null;
  entranceType?: unknown;
  customTypeLabel?: unknown;
  captureAccuracyMetres?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  allowedRadiusMetres?: unknown;
  isActive?: boolean;
  confirmOutsideBoundary?: boolean;
}) {
  const campus = await prisma.eduClockCampus.findFirst({
    where: { id: input.campusId, schoolId: input.schoolId },
  });
  if (!campus) {
    throw new EduClockError("EDUCLOCK_NOT_FOUND", 404, "Campus not found for this school.");
  }
  const name = normalizeEntranceName(input.name);
  await assertUniqueEntranceName({
    schoolId: input.schoolId,
    campusId: campus.id,
    name,
  });

  const latitude = parseOptionalCoordinate(input.latitude, "latitude");
  const longitude = parseOptionalCoordinate(input.longitude, "longitude");
  if ((latitude != null && longitude == null) || (latitude == null && longitude != null)) {
    throw new EduClockError(
      "EDUCLOCK_IDENTITY_INVALID",
      400,
      "Latitude and longitude must both be provided together."
    );
  }
  const radius =
    parseRadiusMetres(input.allowedRadiusMetres, false) ?? EDUCLOCK_ENTRANCE_RADIUS_DEFAULT;
  const isActive = typeof input.isActive === "boolean" ? input.isActive : true;

  let description: string | null = null;
  try {
    const built = buildEntranceDescriptionFromWizard({
      entranceType: input.entranceType,
      customTypeLabel: input.customTypeLabel,
      captureAccuracyMetres: input.captureAccuracyMetres,
      description: input.description,
    });
    if (built === undefined) {
      description = input.description ? String(input.description).trim() : null;
    } else {
      description = built;
    }
  } catch (err) {
    throw new EduClockError(
      "EDUCLOCK_IDENTITY_INVALID",
      400,
      err instanceof Error ? err.message : "Invalid entrance type."
    );
  }

  const boundary = await assertEntranceBoundaryAllowed({
    schoolId: input.schoolId,
    campusId: campus.id,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    confirmOutsideBoundary: Boolean(input.confirmOutsideBoundary),
  });

  try {
    const entrance = await prisma.eduClockEntrance.create({
      data: {
        schoolId: input.schoolId,
        campusId: campus.id,
        name,
        description,
        isActive,
        latitude: latitude == null ? null : latitude,
        longitude: longitude == null ? null : longitude,
        allowedRadiusMetres: radius,
      },
    });
    await writeAudit({
      schoolId: input.schoolId,
      userId: input.actorUserId,
      actorUserId: input.actorUserId,
      action: "ENTRANCE_CREATE",
      detail: `Entrance ${entrance.id} on campus ${campus.id}`,
    });
    return serializeEntrance(entrance, campus.isActive, boundary);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new EduClockError(
        "EDUCLOCK_IDENTITY_INVALID",
        409,
        "An entrance with this name already exists on the campus."
      );
    }
    throw err;
  }
}

export async function updateEduClockEntrance(input: {
  schoolId: string;
  actorUserId: string;
  entranceId: string;
  name?: string;
  description?: string | null;
  entranceType?: unknown;
  customTypeLabel?: unknown;
  captureAccuracyMetres?: unknown;
  isActive?: boolean;
  latitude?: unknown;
  longitude?: unknown;
  allowedRadiusMetres?: unknown;
  confirmOutsideBoundary?: boolean;
}) {
  const existing = await prisma.eduClockEntrance.findFirst({
    where: { id: input.entranceId, schoolId: input.schoolId },
    include: { campus: { select: { isActive: true } } },
  });
  if (!existing) {
    throw new EduClockError("EDUCLOCK_NOT_FOUND", 404, "Entrance not found for this school.");
  }
  const data: Prisma.EduClockEntranceUpdateInput = {};
  if (input.name !== undefined) {
    const name = normalizeEntranceName(input.name);
    await assertUniqueEntranceName({
      schoolId: input.schoolId,
      campusId: existing.campusId,
      name,
      excludeEntranceId: existing.id,
    });
    data.name = name;
  }

  if (
    input.entranceType !== undefined ||
    input.customTypeLabel !== undefined ||
    input.captureAccuracyMetres !== undefined ||
    input.description !== undefined
  ) {
    try {
      const built = buildEntranceDescriptionFromWizard({
        entranceType: input.entranceType,
        customTypeLabel: input.customTypeLabel,
        captureAccuracyMetres: input.captureAccuracyMetres,
        description: input.description,
      });
      if (built !== undefined) {
        data.description = built;
      }
    } catch (err) {
      throw new EduClockError(
        "EDUCLOCK_IDENTITY_INVALID",
        400,
        err instanceof Error ? err.message : "Invalid entrance type."
      );
    }
  }

  if (typeof input.isActive === "boolean") data.isActive = input.isActive;

  const hasLat = input.latitude !== undefined;
  const hasLng = input.longitude !== undefined;
  let nextLat: number | null = existing.latitude == null ? null : Number(existing.latitude);
  let nextLng: number | null = existing.longitude == null ? null : Number(existing.longitude);
  if (hasLat || hasLng) {
    const latitude = parseOptionalCoordinate(
      hasLat ? input.latitude : existing.latitude == null ? null : Number(existing.latitude),
      "latitude"
    );
    const longitude = parseOptionalCoordinate(
      hasLng ? input.longitude : existing.longitude == null ? null : Number(existing.longitude),
      "longitude"
    );
    if ((latitude == null) !== (longitude == null)) {
      throw new EduClockError(
        "EDUCLOCK_IDENTITY_INVALID",
        400,
        "Latitude and longitude must both be provided together."
      );
    }
    data.latitude = latitude == null ? null : latitude;
    data.longitude = longitude == null ? null : longitude;
    nextLat = latitude ?? null;
    nextLng = longitude ?? null;
  }

  if (input.allowedRadiusMetres !== undefined) {
    data.allowedRadiusMetres = parseRadiusMetres(input.allowedRadiusMetres, true);
  }

  const coordsChanging = hasLat || hasLng;
  const boundary = await assertEntranceBoundaryAllowed({
    schoolId: input.schoolId,
    campusId: existing.campusId,
    latitude: nextLat,
    longitude: nextLng,
    // Require explicit confirm only when coordinates are created/moved outside the boundary.
    confirmOutsideBoundary: Boolean(input.confirmOutsideBoundary) || !coordsChanging,
  });

  try {
    const entrance = await prisma.eduClockEntrance.update({
      where: { id: existing.id },
      data,
    });
    await writeAudit({
      schoolId: input.schoolId,
      userId: input.actorUserId,
      actorUserId: input.actorUserId,
      action: input.isActive === false ? "ENTRANCE_DEACTIVATE" : "ENTRANCE_UPDATE",
      detail: `Entrance ${entrance.id}`,
    });
    return serializeEntrance(entrance, existing.campus.isActive, boundary);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new EduClockError(
        "EDUCLOCK_IDENTITY_INVALID",
        409,
        "An entrance with this name already exists on the campus."
      );
    }
    throw err;
  }
}

