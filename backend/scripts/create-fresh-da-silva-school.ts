/**
 * Create a brand-new empty Da Silva Academy + owner (migration testing).
 *
 *   npx tsx scripts/create-fresh-da-silva-school.ts
 *
 * Requires no existing school row for Da Silva / owner email (run reset-da-silva-school first if needed).
 */
import "dotenv/config";

import { PrismaClient } from "@prisma/client";

import {
  DA_SILVA_ACADEMY_SCHOOL_ID,
  DA_SILVA_OWNER_EMAIL,
  DA_SILVA_SCHOOL_NAME,
  setDaSilvaResolvedSchoolId,
} from "../src/services/activateDaSilvaSubscription";
import { buildAuthDiagnostics } from "../src/services/authDiagnostics";
import {
  compareAuthPassword,
  hashAuthPassword,
  normalizeAuthEmail,
} from "../src/services/authCredentials";
import { seedSchoolEmailDefaults } from "../src/services/schoolEmailService";
import { permissionsForRole, prismaRoleForAppRole } from "../src/utils/userPermissions";
import { setUserAccessMeta } from "../src/utils/userAccessStore";
import { buildDaSilvaPurgeScope, purgeDaSilvaJsonStores } from "./lib/daSilvaEmptyState";

const prisma = new PrismaClient();

const OWNER_EMAIL = normalizeAuthEmail(DA_SILVA_OWNER_EMAIL);
const OWNER_PASSWORD = "Tmjs0407@";
const OWNER_FULL_NAME = "Da Silva Academy";

async function assertNoExistingDaSilva(): Promise<void> {
  const schools = await prisma.school.findMany({
    where: {
      OR: [
        { id: DA_SILVA_ACADEMY_SCHOOL_ID },
        { email: { equals: OWNER_EMAIL, mode: "insensitive" } },
        { name: { equals: DA_SILVA_SCHOOL_NAME, mode: "insensitive" } },
        { name: { contains: "Da Silva Academy", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true },
  });
  if (schools.length) {
    throw new Error(
      `Da Silva school already exists (${schools.map((s) => `${s.name} ${s.id}`).join(", ")}). Run reset-da-silva-school.ts --confirm first.`
    );
  }

  const users = await prisma.user.findMany({
    where: { email: { equals: OWNER_EMAIL, mode: "insensitive" } },
    select: { id: true, schoolId: true },
  });
  if (users.length) {
    throw new Error(
      `Owner user already exists for ${OWNER_EMAIL}. Run reset-da-silva-school.ts --confirm first.`
    );
  }
}

async function main(): Promise<void> {
  await assertNoExistingDaSilva();

  const passwordHash = await hashAuthPassword(OWNER_PASSWORD);
  const ownerRole = prismaRoleForAppRole("Owner");

  const school = await prisma.school.create({
    data: {
      id: DA_SILVA_ACADEMY_SCHOOL_ID,
      name: DA_SILVA_SCHOOL_NAME,
      email: OWNER_EMAIL,
    },
    select: { id: true, name: true, email: true },
  });

  setDaSilvaResolvedSchoolId(school.id);

  const owner = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: OWNER_EMAIL,
      fullName: OWNER_FULL_NAME,
      passwordHash,
      role: ownerRole,
      isActive: true,
    },
    select: {
      id: true,
      schoolId: true,
      email: true,
      role: true,
      isActive: true,
      passwordHash: true,
    },
  });

  setUserAccessMeta(owner.id, {
    schoolId: school.id,
    firstName: "Da Silva",
    surname: "Academy",
    appRole: "Owner",
    permissions: permissionsForRole("Owner"),
    lastLoginAt: null,
  });

  try {
    await seedSchoolEmailDefaults(school.id);
  } catch (err) {
    console.warn("[create-fresh-da-silva] seedSchoolEmailDefaults:", err);
  }

  const purgeScope = await buildDaSilvaPurgeScope(prisma, school.id);
  const jsonRemoved = purgeDaSilvaJsonStores(purgeScope);

  const passwordOk = await compareAuthPassword(OWNER_PASSWORD, owner.passwordHash);
  const diag = await buildAuthDiagnostics(OWNER_EMAIL, { testPassword: OWNER_PASSWORD });

  const counts = await prisma.$transaction([
    prisma.learner.count({ where: { schoolId: school.id } }),
    prisma.parent.count({ where: { schoolId: school.id } }),
    prisma.schoolSubscription.count({ where: { schoolId: school.id } }),
    prisma.billingDeposit.count({ where: { schoolId: school.id } }),
  ]);

  console.log("");
  console.log("=== Fresh Da Silva Academy created ===");
  console.log(`school id:            ${school.id}`);
  console.log(`school name:          ${school.name}`);
  console.log(`owner user id:        ${owner.id}`);
  console.log(`login email:          ${OWNER_EMAIL}`);
  console.log(`role:                 ${owner.role}`);
  console.log(`password verify:      ${passwordOk ? "MATCH" : "MISMATCH"}`);
  console.log(`login-ready:          ${diag.loginReady ? "YES" : "NO"}`);
  console.log(`learners:             ${counts[0]}`);
  console.log(`parents:              ${counts[1]}`);
  console.log(`subscriptions:        ${counts[2]}`);
  console.log(`billing deposits:     ${counts[3]}`);
  if (jsonRemoved && Object.keys(jsonRemoved).length) {
    console.log(`json stores purged:   ${JSON.stringify(jsonRemoved)}`);
  }
  if (diag.issues.length) {
    console.log(`diagnostics:            ${diag.issues.join("; ")}`);
  }

  const dataClean =
    counts[0] === 0 &&
    counts[1] === 0 &&
    counts[2] === 0 &&
    counts[3] === 0;

  if (!passwordOk || !diag.loginReady || !dataClean) {
    process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
