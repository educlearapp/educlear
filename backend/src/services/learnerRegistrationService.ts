import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../prisma";

type Db = PrismaClient | Prisma.TransactionClient;

function isDbWithinTransaction(db: Db, withinTransaction?: boolean): boolean {
  if (withinTransaction !== undefined) return withinTransaction;
  return typeof (db as PrismaClient).$transaction !== "function";
}
import {
  allocateFamilyAccountRef,
  isFamilyAccountRefCollision,
} from "./allocateFamilyAccountRef";
import {
  FinanceAccountBaselineError,
  registerFinanceAccountForLearner,
} from "./financeAccountBaseline";
import {
  LearnerIdentityConflictError,
  findDuplicateLearnerInSchool,
} from "./learnerIdentityGuard";
import { normalizeLearnerEnrollmentStatusUpdate } from "../utils/learnerEnrollment";
import {
  ALLERGIES_MAX_LENGTH,
  MEDICAL_ALERT_MAX_LENGTH,
  parseOptionalDateOnlyField,
  parseOptionalTrimmedText,
} from "../utils/optionalProfileFields";

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalLearnerProfileFields(learner: Record<string, unknown>) {
  const admissionRaw =
    learner.admissionDate ?? learner.enrolmentDate ?? learner.enrollmentDate;
  const admissionDate =
    admissionRaw !== undefined && admissionRaw !== null && String(admissionRaw).trim() !== ""
      ? parseOptionalDateOnlyField(admissionRaw, "admissionDate")
      : admissionRaw === "" || admissionRaw === null
        ? null
        : undefined;
  const allergies =
    learner.allergies !== undefined
      ? parseOptionalTrimmedText(learner.allergies, {
          maxLength: ALLERGIES_MAX_LENGTH,
          fieldLabel: "allergies",
        })
      : undefined;
  const medicalAlert =
    learner.medicalAlert !== undefined
      ? parseOptionalTrimmedText(learner.medicalAlert, {
          maxLength: MEDICAL_ALERT_MAX_LENGTH,
          fieldLabel: "medicalAlert",
        })
      : undefined;
  return {
    ...(admissionDate !== undefined ? { admissionDate } : {}),
    ...(allergies !== undefined ? { allergies } : {}),
    ...(medicalAlert !== undefined ? { medicalAlert } : {}),
  };
}

export class CrossSchoolFamilyAccountError extends Error {
  readonly code = "CROSS_SCHOOL_FAMILY_ACCOUNT" as const;
  readonly statusCode = 400;
  constructor(message = "Family account does not belong to this school") {
    super(message);
    this.name = "CrossSchoolFamilyAccountError";
  }
}

export async function assertFamilyAccountOwnedBySchool(
  schoolId: string,
  familyAccountId: string,
  db: Db = prisma
) {
  const sid = String(schoolId || "").trim();
  const id = String(familyAccountId || "").trim();
  if (!sid || !id) throw new Error("schoolId and familyAccountId are required");
  const row = await db.familyAccount.findUnique({
    where: { id },
    select: { id: true, schoolId: true, accountRef: true, accountNo: true, familyName: true, createdAt: true },
  });
  if (!row) return null;
  if (row.schoolId !== sid) {
    throw new CrossSchoolFamilyAccountError("Family accounts belong to different schools");
  }
  return row;
}

async function allocateUniqueAdmissionNo(
  schoolId: string,
  preferred: string,
  db: Db = prisma
): Promise<string> {
  const sid = String(schoolId || "").trim();
  const base = String(preferred || "").trim().toUpperCase() || "ACC";
  const taken = new Set(
    (
      await db.learner.findMany({
        where: { schoolId: sid, admissionNo: { not: null } },
        select: { admissionNo: true },
      })
    )
      .map((row) => String(row.admissionNo || "").trim().toUpperCase())
      .filter(Boolean)
  );
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36).toUpperCase()}`;
}

async function createFamilyShell(schoolId: string, surname: string, db: Db = prisma) {
  let familyAccount: {
    id: string;
    accountRef: string;
    accountNo: string | null;
    familyName: string;
    createdAt: Date;
  } | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const accountNo = await allocateFamilyAccountRef(schoolId, surname, db);
    try {
      familyAccount = await db.familyAccount.create({
        data: {
          schoolId,
          accountRef: accountNo,
          accountNo,
          familyName: surname,
        },
      });
      break;
    } catch (error) {
      if (isFamilyAccountRefCollision(error)) continue;
      throw error;
    }
  }
  if (!familyAccount) {
    throw new Error(`Failed to create family account for surname ${surname}`);
  }
  return familyAccount;
}

async function rollbackLearnerRegistration(
  input: { learnerId?: string; familyAccountId?: string },
  db: Db = prisma
) {
  const learnerId = String(input.learnerId || "").trim();
  const familyAccountId = String(input.familyAccountId || "").trim();
  if (learnerId) {
    await db.learner.delete({ where: { id: learnerId } }).catch(() => undefined);
  }
  if (familyAccountId) {
    const linkedCount = await db.learner.count({ where: { familyAccountId } });
    if (linkedCount === 0) {
      await db.familyAccount.delete({ where: { id: familyAccountId } }).catch(() => undefined);
    }
  }
}

export async function registerLearner(input: {
  schoolId: string;
  learner: Record<string, unknown>;
  existingFamilyAccountId?: string | null;
  db?: Db;
  withinTransaction?: boolean;
  /**
   * When false, skip file-based finance baseline registration.
   * Default true — preserves POST /api/learners behaviour.
   * Admissions conversion sets false inside the DB txn and registers after commit.
   */
  registerFinanceBaseline?: boolean;
}) {
  const db = input.db ?? prisma;
  const withinTransaction = isDbWithinTransaction(db, input.withinTransaction);
  const registerFinanceBaseline = input.registerFinanceBaseline !== false;
  const schoolId = String(input.schoolId || "").trim();
  if (!schoolId) throw new Error("Missing schoolId");

  const school = await db.school.findUnique({
    where: { id: schoolId },
    select: { id: true },
  });
  if (!school) throw new Error("No school found. Provide a valid schoolId.");

  const learner = input.learner || {};
  const duplicate = await findDuplicateLearnerInSchool({
    schoolId,
    idNumber: cleanString(learner.idNumber) || null,
    firstName: cleanString(learner.firstName),
    lastName: cleanString(learner.surname || learner.lastName),
    birthDate: (learner.birthDate as string | Date | null) || null,
    db,
  });
  if (duplicate) {
    throw new LearnerIdentityConflictError(schoolId, duplicate);
  }

  const existingFamilyAccountId = String(input.existingFamilyAccountId || "").trim();
  if (existingFamilyAccountId) {
    const familyAccount = await assertFamilyAccountOwnedBySchool(schoolId, existingFamilyAccountId, db);
    if (!familyAccount) throw new Error("Existing family account not found");
    return createLearnerOnExistingFamilyAccount({
      schoolId,
      learner,
      familyAccount,
      db,
      withinTransaction,
      registerFinanceBaseline,
    });
  }

  return createLearnerWithNewFamilyAccount({
    schoolId,
    learner,
    db,
    withinTransaction,
    registerFinanceBaseline,
  });
}

export async function createLearnerWithNewFamilyAccount({
  schoolId,
  learner,
  db = prisma,
  withinTransaction = false,
  registerFinanceBaseline = true,
}: {
  schoolId: string;
  learner: Record<string, unknown>;
  db?: Db;
  withinTransaction?: boolean;
  registerFinanceBaseline?: boolean;
}) {
  const inTx = isDbWithinTransaction(db, withinTransaction);
  const learnerSurname = cleanString(learner.surname || learner.lastName);
  const familyAccount = await createFamilyShell(schoolId, learnerSurname, db);
  let newLearner: Awaited<ReturnType<typeof prisma.learner.create>> | null = null;
  try {
    newLearner = await db.learner.create({
      data: {
        schoolId,
        familyAccountId: familyAccount.id,
        firstName: cleanString(learner.firstName),
        lastName: learnerSurname,
        birthDate: learner.birthDate ? new Date(String(learner.birthDate)) : null,
        gender: cleanString(learner.gender),
        idNumber: cleanString(learner.idNumber) || null,
        grade: cleanString(learner.grade),
        className:
          cleanString(learner.className || learner.classroom || learner.classroomName) || null,
        admissionNo: familyAccount.accountRef,
        tuitionFee: Number(learner.tuitionFee) || 0,
        transportFee: Number(learner.transportFee) || 0,
        otherFee: Number(learner.otherFee) || 0,
        totalFee: Number(learner.totalFee) || 0,
        ...optionalLearnerProfileFields(learner),
      },
    });
    if (registerFinanceBaseline) {
      registerFinanceAccountForLearner({
        schoolId,
        learnerId: newLearner.id,
        familyAccountId: familyAccount.id,
        accountRef: familyAccount.accountRef,
        accountHolder: familyAccount.familyName,
        createdAt: familyAccount.createdAt,
      });
    }
  } catch (error) {
    if (!inTx) {
      await rollbackLearnerRegistration(
        {
          learnerId: newLearner?.id,
          familyAccountId: familyAccount.id,
        },
        db
      );
    }
    throw error;
  }
  return {
    accountNo: familyAccount.accountRef,
    familyAccount,
    learner: newLearner,
    createdNewFamilyAccount: true as const,
  };
}

export async function createLearnerOnExistingFamilyAccount({
  schoolId,
  learner,
  familyAccount,
  db = prisma,
  withinTransaction = false,
  registerFinanceBaseline = true,
}: {
  schoolId: string;
  learner: Record<string, unknown>;
  familyAccount: { id: string; accountRef: string; accountNo?: string | null; familyName: string; createdAt?: Date };
  db?: Db;
  withinTransaction?: boolean;
  registerFinanceBaseline?: boolean;
}) {
  const inTx = isDbWithinTransaction(db, withinTransaction);
  const owned = await assertFamilyAccountOwnedBySchool(schoolId, familyAccount.id, db);
  if (!owned) throw new Error("Existing family account not found");

  const learnerSurname = cleanString(learner.surname || learner.lastName);
  const accountNo = String(familyAccount.accountRef || "").trim().toUpperCase();
  const admissionNo = await allocateUniqueAdmissionNo(schoolId, accountNo, db);

  const newLearner = await db.learner.create({
    data: {
      schoolId,
      familyAccountId: familyAccount.id,
      firstName: cleanString(learner.firstName),
      lastName: learnerSurname,
      birthDate: learner.birthDate ? new Date(String(learner.birthDate)) : null,
      gender: cleanString(learner.gender),
      idNumber: cleanString(learner.idNumber) || null,
      grade: cleanString(learner.grade),
      className:
        cleanString(learner.className || learner.classroom || learner.classroomName) || null,
      admissionNo,
      tuitionFee: Number(learner.tuitionFee) || 0,
      transportFee: Number(learner.transportFee) || 0,
      otherFee: Number(learner.otherFee) || 0,
      totalFee: Number(learner.totalFee) || 0,
      ...optionalLearnerProfileFields(learner),
    },
  });

  try {
    if (registerFinanceBaseline) {
      registerFinanceAccountForLearner({
        schoolId,
        learnerId: newLearner.id,
        familyAccountId: familyAccount.id,
        accountRef: accountNo,
        accountHolder: familyAccount.familyName,
        createdAt: familyAccount.createdAt,
      });
    }
  } catch (error) {
    if (!inTx) {
      await rollbackLearnerRegistration({ learnerId: newLearner.id }, db);
    }
    throw error;
  }

  return {
    accountNo,
    familyAccount: owned,
    learner: newLearner,
    createdNewFamilyAccount: false as const,
  };
}

export async function reactivateHistoricalLearner(input: {
  schoolId: string;
  learnerId: string;
  familyAccountId?: string | null;
}) {
  const schoolId = String(input.schoolId || "").trim();
  const learnerId = String(input.learnerId || "").trim();
  if (!schoolId || !learnerId) throw new Error("schoolId and learnerId are required");

  const existing = await prisma.learner.findFirst({
    where: { id: learnerId, schoolId },
    include: { familyAccount: true, links: { include: { parent: true } } },
  });
  if (!existing) throw new Error("Learner not found");

  const requestedFamilyId = String(input.familyAccountId || "").trim();
  let nextFamilyAccountId = existing.familyAccountId;
  if (requestedFamilyId) {
    const owned = await assertFamilyAccountOwnedBySchool(schoolId, requestedFamilyId);
    if (!owned) throw new Error("Existing family account not found");
    nextFamilyAccountId = owned.id;
  }

  return prisma.learner.update({
    where: { id: existing.id },
    data: {
      enrollmentStatus: "ACTIVE",
      ...(nextFamilyAccountId && nextFamilyAccountId !== existing.familyAccountId
        ? { familyAccountId: nextFamilyAccountId }
        : {}),
    },
    include: { familyAccount: true, links: { include: { parent: true } } },
  });
}

export async function updateLearnerEnrollmentStatus(input: {
  schoolId: string;
  learnerId: string;
  enrollmentStatus: unknown;
}) {
  const schoolId = String(input.schoolId || "").trim();
  const learnerId = String(input.learnerId || "").trim();
  const enrollmentStatus = normalizeLearnerEnrollmentStatusUpdate(input.enrollmentStatus);
  if (!schoolId || !learnerId) throw new Error("schoolId and learnerId are required");
  if (!enrollmentStatus) throw new Error("enrollmentStatus must be ACTIVE or HISTORICAL");

  const existing = await prisma.learner.findFirst({
    where: { id: learnerId, schoolId },
    select: { id: true },
  });
  if (!existing) throw new Error("Learner not found");

  return prisma.learner.update({
    where: { id: existing.id },
    data: { enrollmentStatus },
    include: { familyAccount: true, links: { include: { parent: true } } },
  });
}

export async function alignParentsToCanonicalFamily(input: {
  schoolId: string;
  learnerIds: string[];
  canonicalFamilyAccountId: string;
  db?: Db;
}) {
  const db = input.db ?? prisma;
  const schoolId = String(input.schoolId || "").trim();
  const canonicalFamilyAccountId = String(input.canonicalFamilyAccountId || "").trim();
  if (!schoolId || !canonicalFamilyAccountId || !input.learnerIds.length) return 0;

  await assertFamilyAccountOwnedBySchool(schoolId, canonicalFamilyAccountId, db);

  const links = await db.parentLearnerLink.findMany({
    where: { schoolId, learnerId: { in: input.learnerIds } },
    select: { parentId: true },
  });
  const parentIds = [...new Set(links.map((row) => row.parentId))];
  if (!parentIds.length) return 0;

  const result = await db.parent.updateMany({
    where: { schoolId, id: { in: parentIds } },
    data: { familyAccountId: canonicalFamilyAccountId },
  });
  return result.count;
}

export { FinanceAccountBaselineError, LearnerIdentityConflictError };
