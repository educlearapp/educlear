/**
 * Create or repair Da Silva Academy owner user (no migration, no data purge).
 *
 * Usage:
 *   DA_SILVA_OWNER_PASSWORD=... npx tsx scripts/ensure-da-silva-owner.ts [schoolId]
 *   DA_SILVA_OWNER_PASSWORD=... npx tsx scripts/ensure-da-silva-owner.ts --reset-password [schoolId]
 *
 * --reset-password  Updates password hash and user-access meta when owner already exists.
 *
 * Default schoolId: cmpideqeq0000108xb6ouv9zi
 */
import "dotenv/config";

import bcrypt from "bcryptjs";

import { PrismaClient } from "@prisma/client";

import {
  isRegistrationProvisionedOwner,
  SCRIPT_PROVISIONED_OWNER_FULL_NAME,
} from "../src/utils/ownerProvisioning";
import { permissionsForRole } from "../src/utils/userPermissions";
import { setUserAccessMeta } from "../src/utils/userAccessStore";

const prisma = new PrismaClient();

const DA_SILVA_OWNER_EMAIL = "dasilvaacademy@gmail.com";
const DEFAULT_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";

function ownerAccessMeta(schoolId: string) {
  return {
    schoolId,
    firstName: "Da Silva",
    surname: "Owner",
    appRole: "Owner" as const,
    permissions: permissionsForRole("Owner"),
    lastLoginAt: null,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--reset-password");
  const resetPassword = process.argv.includes("--reset-password");
  const schoolId = (args[0] || DEFAULT_SCHOOL_ID).trim();
  const email = DA_SILVA_OWNER_EMAIL.trim().toLowerCase();
  const password = String(process.env.DA_SILVA_OWNER_PASSWORD || "").trim();

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true, email: true },
  });
  if (!school) {
    throw new Error(`School not found: ${schoolId}`);
  }

  const existing = await prisma.user.findFirst({
    where: { schoolId, email },
    select: { id: true, email: true, fullName: true },
  });

  if (existing && isRegistrationProvisionedOwner(existing, school)) {
    console.log(`Owner was created via school registration — not modified (${existing.email})`);
    console.log(`  userId: ${existing.id}`);
    console.log(`  Use POST /auth/login or re-submit register-school to update credentials.`);
    return;
  }

  if (existing) {
    if (resetPassword) {
      if (!password) {
        throw new Error(
          `DA_SILVA_OWNER_PASSWORD is required in env to reset owner password for ${email}`
        );
      }
      const passwordHash = await bcrypt.hash(password, 10);
      await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, isActive: true, role: "SCHOOL_ADMIN" },
      });
      setUserAccessMeta(existing.id, ownerAccessMeta(schoolId));
      console.log(`Reset owner password for ${school.name} (${school.id})`);
      console.log(`  userId: ${existing.id}`);
      console.log(`  email: ${existing.email}`);
      return;
    }

    console.log(`Owner already exists for ${school.name} (${school.id})`);
    console.log(`  userId: ${existing.id}`);
    console.log(`  email: ${existing.email}`);
    console.log(`  Use --reset-password with DA_SILVA_OWNER_PASSWORD to repair login`);
    return;
  }

  if (!password) {
    throw new Error(
      `DA_SILVA_OWNER_PASSWORD is required in env to create owner user ${email}`
    );
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: {
      schoolId,
      email,
      fullName: SCRIPT_PROVISIONED_OWNER_FULL_NAME,
      passwordHash,
      role: "SCHOOL_ADMIN",
      isActive: true,
    },
    select: { id: true, email: true },
  });

  setUserAccessMeta(user.id, ownerAccessMeta(schoolId));

  console.log(`Created owner for ${school.name} (${school.id})`);
  console.log(`  userId: ${user.id}`);
  console.log(`  email: ${user.email}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
