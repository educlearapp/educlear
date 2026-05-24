import {
  EduClearPackageCode,
  SchoolSubscriptionStatus,
} from "@prisma/client";

import { prisma } from "../prisma";
import { addOneCalendarMonth } from "./payfastService";
import { ensureEduClearPackages } from "./ensureEduClearPackages";

export const DA_SILVA_ACADEMY_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const TARGET_PACKAGE: EduClearPackageCode = "UNLIMITED";

/**
 * Idempotent UNLIMITED / ACTIVE subscription for Da Silva Academy only.
 * Safe to run on every production boot after the school record exists.
 */
export async function ensureDaSilvaAcademySubscription(): Promise<void> {
  const schoolId = DA_SILVA_ACADEMY_SCHOOL_ID;

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) {
    throw new Error(`School not found: ${schoolId}`);
  }

  await ensureEduClearPackages();

  const unlimitedPackage = await prisma.eduClearPackage.findUnique({
    where: { code: TARGET_PACKAGE },
    select: { id: true, code: true, name: true },
  });
  if (!unlimitedPackage) {
    throw new Error(`Package ${TARGET_PACKAGE} missing after ensureEduClearPackages`);
  }

  const activatedAt = new Date();
  const currentPeriodStart = new Date(
    activatedAt.getFullYear(),
    activatedAt.getMonth(),
    activatedAt.getDate()
  );
  const currentPeriodEnd = addOneCalendarMonth(currentPeriodStart);

  await prisma.schoolSubscription.upsert({
    where: { schoolId },
    create: {
      schoolId,
      packageId: unlimitedPackage.id,
      packageCode: TARGET_PACKAGE,
      status: SchoolSubscriptionStatus.ACTIVE,
      currentPeriodStart,
      currentPeriodEnd,
      activatedAt,
      cancelledAt: null,
    },
    update: {
      packageId: unlimitedPackage.id,
      packageCode: TARGET_PACKAGE,
      status: SchoolSubscriptionStatus.ACTIVE,
      currentPeriodStart,
      currentPeriodEnd,
      activatedAt,
      cancelledAt: null,
    },
  });

  console.log(
    `[activateDaSilva] ${school.name} (${schoolId}): ${TARGET_PACKAGE} ACTIVE until ${currentPeriodEnd.toISOString()}`
  );
  console.log(
    `[activateDaSilva] dashboardUnlocked=true (subscription status ACTIVE)`
  );
}
