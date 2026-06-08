import {
  EduClearPackageCode,
  Prisma,
  SchoolSubscriptionStatus,
} from "@prisma/client";

import { prisma } from "../prisma";
import { ensureEduClearPackages } from "./ensureEduClearPackages";
import { addOneCalendarMonth } from "./payfastService";

export const SCHOOL_REGISTRATION_ACTIVATION_SOURCE = "school_registration";

type DbClient = Prisma.TransactionClient | typeof prisma;

const DEFAULT_PACKAGE_CODE: EduClearPackageCode = "STARTER";
const DEFAULT_STATUS = SchoolSubscriptionStatus.PENDING_PAYMENT;

async function resolvePackage(
  db: DbClient,
  packageCode: EduClearPackageCode = DEFAULT_PACKAGE_CODE
) {
  const pkg = await db.eduClearPackage.findFirst({
    where: { code: packageCode, isActive: true },
    select: { id: true, code: true },
  });
  if (!pkg) {
    throw new Error(`Package ${packageCode} not found or inactive`);
  }
  return pkg;
}

function activePeriodFields(activatedAt: Date) {
  const currentPeriodStart = new Date(
    activatedAt.getFullYear(),
    activatedAt.getMonth(),
    activatedAt.getDate()
  );
  return {
    currentPeriodStart,
    currentPeriodEnd: addOneCalendarMonth(currentPeriodStart),
    activatedAt,
    cancelledAt: null,
  };
}

/**
 * Ensures every school has a SchoolSubscription row (default Starter / Trial).
 * Safe to call repeatedly; no-op when a record already exists.
 */
export async function ensureSchoolSubscription(
  schoolId: string,
  opts?: {
    tx?: Prisma.TransactionClient;
    packageCode?: EduClearPackageCode;
    status?: SchoolSubscriptionStatus;
    activationSource?: string;
  }
) {
  const schoolIdNorm = String(schoolId || "").trim();
  if (!schoolIdNorm) {
    throw new Error("schoolId is required");
  }

  const db: DbClient = opts?.tx ?? prisma;
  const existing = await db.schoolSubscription.findUnique({
    where: { schoolId: schoolIdNorm },
    select: { id: true },
  });
  if (existing) {
    return existing;
  }

  await ensureEduClearPackages();

  const packageCode = opts?.packageCode ?? DEFAULT_PACKAGE_CODE;
  const status = opts?.status ?? DEFAULT_STATUS;
  const pkg = await resolvePackage(db, packageCode);

  const activationSource = String(
    opts?.activationSource || SCHOOL_REGISTRATION_ACTIVATION_SOURCE
  ).trim();

  const createData: Prisma.SchoolSubscriptionCreateInput = {
    school: { connect: { id: schoolIdNorm } },
    package: { connect: { id: pkg.id } },
    packageCode: pkg.code,
    status,
    activationSource,
    ...(status === SchoolSubscriptionStatus.ACTIVE
      ? activePeriodFields(new Date())
      : {}),
  };

  return db.schoolSubscription.create({
    data: createData,
    select: { id: true },
  });
}
