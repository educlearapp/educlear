import { Prisma, PrismaClient } from "@prisma/client";

/** Matches existing Da Silva numbers: EMP001, EMP002, EMP0010, EMP0063, EMP0064. */
export const EMPLOYEE_NUMBER_LITERAL_PREFIX = "EMP00";

export const MAX_EMPLOYEE_NUMBER_ALLOCATION_ATTEMPTS = 25;

const SEQUENCE_SCAN_LIMIT = 10000;

const EMP00_SEQUENCE_PATTERN = /^EMP00(\d+)$/;

type EmployeeNumberDb = {
  employee: {
    findMany: PrismaClient["employee"]["findMany"];
  };
};

export type EmployeeAllocationCreateDb = EmployeeNumberDb & {
  employee: EmployeeNumberDb["employee"] & {
    create: (args: {
      data: Prisma.EmployeeUncheckedCreateInput;
    }) => Promise<unknown>;
  };
};

export function isAutoAssignEmployeeNumberRequest(body: Record<string, unknown> | null | undefined): boolean {
  return Boolean(body && body.autoAssignEmployeeNumber === true);
}

export function formatEmployeeNumber(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error("Employee number sequence must be an integer >= 1");
  }
  return `${EMPLOYEE_NUMBER_LITERAL_PREFIX}${sequence}`;
}

/**
 * Parse EMP00 + integer sequence only.
 * EMP002 → 2, EMP008 → 8, EMP0010 → 10, EMP0063 → 63.
 * Legacy values (MBB-STAFF-…, EMPABS01, DEM-TCH-1) return null and are ignored for sequencing.
 */
export function parseEmployeeNumberSequence(value: string | null | undefined): number | null {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return null;
  const match = raw.match(EMP00_SEQUENCE_PATTERN);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

function occupiedUpperSet(occupied: Iterable<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const value of occupied) {
    const trimmed = String(value ?? "").trim().toUpperCase();
    if (trimmed) out.add(trimmed);
  }
  return out;
}

/**
 * Next EMP00 sequence for this school. Uses max(parsed suffix) + 1 and does not fill gaps.
 * Occupied non-EMP00 values are skipped as collisions but do not contribute to the sequence.
 */
export function computeNextEmployeeNumber(occupied: Iterable<string | null | undefined>): string {
  const occupiedUpper = occupiedUpperSet(occupied);
  let maxSuffix = 0;
  for (const value of occupiedUpper) {
    const suffix = parseEmployeeNumberSequence(value);
    if (suffix !== null) maxSuffix = Math.max(maxSuffix, suffix);
  }

  const start = maxSuffix + 1;
  for (let sequence = start; sequence <= maxSuffix + SEQUENCE_SCAN_LIMIT; sequence++) {
    const candidate = formatEmployeeNumber(sequence);
    if (!occupiedUpper.has(candidate)) return candidate;
  }

  throw new Error("Unable to allocate the next employee number");
}

export async function listOccupiedEmployeeNumbers(
  schoolId: string,
  db: EmployeeNumberDb
): Promise<string[]> {
  const sid = String(schoolId || "").trim();
  if (!sid) throw new Error("schoolId is required to allocate an employee number");
  const rows = await db.employee.findMany({
    where: { schoolId: sid },
    select: { employeeNumber: true },
  });
  return rows
    .map((row) => String(row.employeeNumber ?? "").trim())
    .filter(Boolean);
}

export async function allocateNextEmployeeNumber(
  schoolId: string,
  db: EmployeeNumberDb
): Promise<string> {
  const occupied = await listOccupiedEmployeeNumbers(schoolId, db);
  return computeNextEmployeeNumber(occupied);
}

function targetMentionsEmployeeNumber(value: unknown): boolean {
  return /employeenumber/i.test(String(value ?? ""));
}

/**
 * True only when a Prisma unique-constraint error is about Employee.employeeNumber.
 * Missing meta.target is not treated as an employee-number collision (retry uses this only).
 */
export function isEmployeeNumberUniqueCollision(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.some((field) => targetMentionsEmployeeNumber(field));
  }
  if (typeof target === "string" && target.trim()) {
    return targetMentionsEmployeeNumber(target);
  }
  return false;
}

/**
 * Allocate a school-scoped employee number and create the row.
 * On a genuine employee-number P2002, re-reads occupied numbers and retries with a fresh candidate.
 */
export async function createEmployeeAllocatingNumber(
  schoolId: string,
  data: Prisma.EmployeeUncheckedCreateInput,
  db: EmployeeAllocationCreateDb
): Promise<unknown> {
  const sid = String(schoolId || "").trim();
  if (!sid) throw new Error("schoolId is required to allocate an employee number");

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_EMPLOYEE_NUMBER_ALLOCATION_ATTEMPTS; attempt++) {
    const employeeNumber = await allocateNextEmployeeNumber(sid, db);
    try {
      return await db.employee.create({
        data: {
          ...data,
          employeeNumber,
          schoolId: sid,
        },
      });
    } catch (error) {
      if (isEmployeeNumberUniqueCollision(error)) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  if (isEmployeeNumberUniqueCollision(lastError)) {
    throw lastError;
  }
  throw lastError instanceof Error ? lastError : new Error("Failed to allocate employee number");
}
