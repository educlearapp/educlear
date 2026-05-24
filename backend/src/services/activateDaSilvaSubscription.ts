import {
  EduClearPackageCode,
  SchoolSubscriptionStatus,
} from "@prisma/client";

import { prisma } from "../prisma";
import { addOneCalendarMonth } from "./payfastService";
import { ensureEduClearPackages } from "./ensureEduClearPackages";

export const DA_SILVA_ACADEMY_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
export const DA_SILVA_OWNER_EMAIL = "dasilvaacademy@gmail.com";
export const DA_SILVA_SCHOOL_NAME = "Da Silva Academy";

let daSilvaResolvedSchoolId: string = DA_SILVA_ACADEMY_SCHOOL_ID;

/** School id for Prisma after ensure (may differ from canonical id when registered under another row). */
export function getDaSilvaResolvedSchoolId(): string {
  return daSilvaResolvedSchoolId;
}

export function setDaSilvaResolvedSchoolId(id: string): void {
  const key = String(id || "").trim();
  if (!key) return;
  daSilvaResolvedSchoolId = key;
}

const TARGET_PACKAGE: EduClearPackageCode = "UNLIMITED";

/**
 * Idempotent UNLIMITED / ACTIVE subscription for Da Silva Academy only.
 * Safe to run on every production boot after the school record exists.
 */
export async function ensureDaSilvaAcademySubscription(
  requestedSchoolId?: string
): Promise<void> {
  const hintId = String(requestedSchoolId || getDaSilvaResolvedSchoolId() || "").trim();

  let school =
    hintId &&
    (await prisma.school.findUnique({
      where: { id: hintId },
      select: { id: true, name: true },
    }));

  if (!school) {
    school =
      (await prisma.school.findFirst({
        where: { email: DA_SILVA_OWNER_EMAIL },
        select: { id: true, name: true },
      })) ||
      (await prisma.school.findFirst({
        where: { name: DA_SILVA_SCHOOL_NAME },
        select: { id: true, name: true },
      }));
  }
  if (!school) {
    throw new Error(`School not found: ${hintId || DA_SILVA_ACADEMY_SCHOOL_ID}`);
  }

  setDaSilvaResolvedSchoolId(school.id);

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

  const resolvedSchoolId = school.id;

  await prisma.schoolSubscription.upsert({
    where: { schoolId: resolvedSchoolId },
    create: {
      schoolId: resolvedSchoolId,
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
    `[activateDaSilva] ${school.name} (${resolvedSchoolId}): ${TARGET_PACKAGE} ACTIVE until ${currentPeriodEnd.toISOString()}`
  );
  console.log(
    `[activateDaSilva] dashboardUnlocked=true (subscription status ACTIVE)`
  );
}
