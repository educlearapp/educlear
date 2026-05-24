/**
 * Activate UNLIMITED subscription for Da Silva Academy only (local / post-backup live).
 *
 * Usage:
 *   npx tsx scripts/activate-da-silva-subscription.ts
 *   npx tsx scripts/activate-da-silva-subscription.ts [schoolId]
 *
 * Default schoolId: cmpideqeq0000108xb6ouv9zi
 * Does not modify PayFast routes or other schools.
 */
import "dotenv/config";

import {
  EduClearPackageCode,
  PrismaClient,
  SchoolSubscriptionStatus,
} from "@prisma/client";

import { ensureEduClearPackages } from "../src/services/ensureEduClearPackages";
import { addOneCalendarMonth } from "../src/services/payfastService";

const prisma = new PrismaClient();

const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const TARGET_PACKAGE: EduClearPackageCode = "UNLIMITED";

async function main(): Promise<void> {
  const schoolId = (process.argv[2] || DA_SILVA_SCHOOL_ID).trim();

  if (schoolId !== DA_SILVA_SCHOOL_ID) {
    throw new Error(
      `Refusing: this script only activates Da Silva Academy (${DA_SILVA_SCHOOL_ID}), got ${schoolId}`
    );
  }

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
    select: { id: true, code: true, name: true, monthlyPriceCents: true },
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

  const subscription = await prisma.schoolSubscription.upsert({
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
    select: {
      id: true,
      status: true,
      packageCode: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      activatedAt: true,
    },
  });

  console.log(`Activated subscription for ${school.name} (${school.id})`);
  console.log(`  subscriptionId: ${subscription.id}`);
  console.log(`  package: ${unlimitedPackage.name} (${TARGET_PACKAGE})`);
  console.log(`  price: R${unlimitedPackage.monthlyPriceCents / 100}/month`);
  console.log(`  status: ${subscription.status}`);
  console.log(`  currentPeriodStart: ${subscription.currentPeriodStart?.toISOString()}`);
  console.log(`  currentPeriodEnd: ${subscription.currentPeriodEnd?.toISOString()}`);
  console.log(`  activatedAt: ${subscription.activatedAt?.toISOString()}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
