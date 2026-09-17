import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";

type Db = PrismaClient | Prisma.TransactionClient;

export type LearnerIdentityMatchReason = "idNumber" | "name+dob";

export type DuplicateLearnerMatch = {
  id: string;
  schoolId: string;
  firstName: string;
  lastName: string;
  admissionNo: string | null;
  idNumber: string | null;
  birthDate: Date | null;
  enrollmentStatus: string;
  className: string | null;
  grade: string;
  familyAccountId: string | null;
  familyAccount: { id: string; accountRef: string; familyName: string } | null;
  matchReason: LearnerIdentityMatchReason;
};

export class LearnerIdentityConflictError extends Error {
  readonly code = "LEARNER_IDENTITY_CONFLICT" as const;
  readonly statusCode = 409;
  readonly schoolId: string;
  readonly existing: DuplicateLearnerMatch;

  constructor(schoolId: string, existing: DuplicateLearnerMatch) {
    const status = String(existing.enrollmentStatus || "ACTIVE").toUpperCase();
    const ref = existing.familyAccount?.accountRef || existing.admissionNo || "";
    super(
      status === "HISTORICAL"
        ? `Existing historical learner found${ref ? ` (${ref})` : ""}. Reactivate the existing record instead of creating a duplicate.`
        : `Learner already exists${ref ? ` on ${ref}` : ""}.`
    );
    this.name = "LearnerIdentityConflictError";
    this.schoolId = schoolId;
    this.existing = existing;
  }
}

export function normaliseLearnerIdNumber(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

export function isUsableLearnerIdNumber(value: unknown): boolean {
  return normaliseLearnerIdNumber(value).length >= 6;
}

function compactName(value: unknown): string {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

export function birthDayKey(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = raw ? new Date(raw) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return "";
}

function toMatch(
  row: Omit<DuplicateLearnerMatch, "matchReason">,
  matchReason: LearnerIdentityMatchReason
): DuplicateLearnerMatch {
  return { ...row, matchReason };
}

/**
 * Strong duplicate search, strictly within one school.
 * Never matches learners from another tenant.
 */
export async function findDuplicateLearnerInSchool(input: {
  schoolId: string;
  idNumber?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  birthDate?: Date | string | null;
  excludeLearnerId?: string | null;
  db?: Db;
}): Promise<DuplicateLearnerMatch | null> {
  const db = input.db ?? prisma;
  const schoolId = String(input.schoolId || "").trim();
  if (!schoolId) {
    throw new Error("schoolId is required for duplicate learner detection");
  }

  const excludeId = String(input.excludeLearnerId || "").trim();
  const idNumber = normaliseLearnerIdNumber(input.idNumber);
  const firstName = compactName(input.firstName);
  const lastName = compactName(input.lastName);
  const dob = birthDayKey(input.birthDate);

  const select = {
    id: true,
    schoolId: true,
    firstName: true,
    lastName: true,
    admissionNo: true,
    idNumber: true,
    birthDate: true,
    enrollmentStatus: true,
    className: true,
    grade: true,
    familyAccountId: true,
    familyAccount: { select: { id: true, accountRef: true, familyName: true } },
  } as const;

  if (isUsableLearnerIdNumber(idNumber)) {
    const rows = await db.learner.findMany({
      where: {
        schoolId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        idNumber: { not: null },
      },
      select,
    });
    const hit = rows.find((row) => normaliseLearnerIdNumber(row.idNumber) === idNumber);
    if (hit) return toMatch(hit, "idNumber");
  }

  if (firstName && lastName && dob) {
    const rows = await db.learner.findMany({
      where: {
        schoolId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select,
    });
    const hit = rows.find(
      (row) =>
        compactName(row.firstName) === firstName &&
        compactName(row.lastName) === lastName &&
        birthDayKey(row.birthDate) === dob
    );
    if (hit) return toMatch(hit, "name+dob");
  }

  return null;
}

/**
 * OA-05B — all strong same-school matches (exact usable ID and/or name+DOB).
 * Prefer this when reactivation must detect ambiguity; do not auto-pick `.find()`.
 * ID matches prefer matchReason "idNumber"; name+DOB-only keep "name+dob".
 */
export async function findAllStrongLearnerMatchesInSchool(input: {
  schoolId: string;
  idNumber?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  birthDate?: Date | string | null;
  excludeLearnerId?: string | null;
  db?: Db;
}): Promise<DuplicateLearnerMatch[]> {
  const db = input.db ?? prisma;
  const schoolId = String(input.schoolId || "").trim();
  if (!schoolId) {
    throw new Error("schoolId is required for duplicate learner detection");
  }

  const excludeId = String(input.excludeLearnerId || "").trim();
  const idNumber = normaliseLearnerIdNumber(input.idNumber);
  const firstName = compactName(input.firstName);
  const lastName = compactName(input.lastName);
  const dob = birthDayKey(input.birthDate);

  const select = {
    id: true,
    schoolId: true,
    firstName: true,
    lastName: true,
    admissionNo: true,
    idNumber: true,
    birthDate: true,
    enrollmentStatus: true,
    className: true,
    grade: true,
    familyAccountId: true,
    familyAccount: { select: { id: true, accountRef: true, familyName: true } },
  } as const;

  const byId = new Map<string, DuplicateLearnerMatch>();

  if (isUsableLearnerIdNumber(idNumber)) {
    const rows = await db.learner.findMany({
      where: {
        schoolId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        idNumber: { not: null },
      },
      select,
    });
    for (const row of rows) {
      if (normaliseLearnerIdNumber(row.idNumber) === idNumber) {
        byId.set(row.id, toMatch(row, "idNumber"));
      }
    }
  }

  if (firstName && lastName && dob) {
    const rows = await db.learner.findMany({
      where: {
        schoolId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select,
    });
    for (const row of rows) {
      const nameDobHit =
        compactName(row.firstName) === firstName &&
        compactName(row.lastName) === lastName &&
        birthDayKey(row.birthDate) === dob;
      if (!nameDobHit) continue;
      const existing = byId.get(row.id);
      if (!existing) {
        byId.set(row.id, toMatch(row, "name+dob"));
      }
      // If already matched by ID, keep idNumber as the stronger reason.
    }
  }

  return Array.from(byId.values());
}

export function conflictPayload(error: LearnerIdentityConflictError) {
  const existing = error.existing;
  const status = String(existing.enrollmentStatus || "ACTIVE").toUpperCase();
  return {
    success: false,
    error: error.message,
    code: error.code,
    suggestedAction: status === "HISTORICAL" ? "reactivate" : "review",
    existingLearner: {
      id: existing.id,
      schoolId: existing.schoolId,
      firstName: existing.firstName,
      lastName: existing.lastName,
      admissionNo: existing.admissionNo,
      accountRef: existing.familyAccount?.accountRef || existing.admissionNo,
      enrollmentStatus: existing.enrollmentStatus,
      className: existing.className,
      grade: existing.grade,
      familyAccountId: existing.familyAccountId,
      matchReason: existing.matchReason,
    },
  };
}
