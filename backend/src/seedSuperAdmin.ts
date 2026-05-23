import "dotenv/config";

import bcrypt from "bcryptjs";

import { PrismaClient } from "@prisma/client";

import { normalizeSuperAdminEmail, parseSuperAdminEmails } from "./utils/superAdmin";

const prisma = new PrismaClient();

const PLATFORM_SCHOOL_NAME = "EduClear Platform";

async function run() {
  const allowed = parseSuperAdminEmails();
  if (!allowed.length) {
    throw new Error("SUPER_ADMIN_EMAILS is empty — add info@educlear.co.za (comma-separated list)");
  }

  const email = normalizeSuperAdminEmail(process.env.SUPER_ADMIN_SEED_EMAIL || allowed[0]);
  const plainPassword = process.env.SUPER_ADMIN_SEED_PASSWORD;

  if (!plainPassword) {
    throw new Error("SUPER_ADMIN_SEED_PASSWORD is required (set in backend/.env, never commit it)");
  }

  if (!allowed.includes(email)) {
    throw new Error(`${email} is not listed in SUPER_ADMIN_EMAILS`);
  }

  const passwordHash = await bcrypt.hash(plainPassword, 10);

  let school = await prisma.school.findFirst({
    where: { email },
    select: { id: true, name: true, email: true },
  });

  if (!school) {
    school = await prisma.school.findFirst({
      where: { name: PLATFORM_SCHOOL_NAME },
      select: { id: true, name: true, email: true },
    });
  }

  if (!school) {
    school = await prisma.school.create({
      data: {
        name: PLATFORM_SCHOOL_NAME,
        email,
        phone: "",
      },
      select: { id: true, name: true, email: true },
    });
    console.log("Created platform school:", school.id);
  }

  const existing = await prisma.user.findUnique({
    where: { schoolId_email: { schoolId: school.id, email } },
    select: { id: true, email: true, isActive: true },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        isActive: true,
        fullName: existing.isActive ? undefined : "EduClear Super Admin",
      },
    });
    console.log("Updated super admin password for:", email);
    return;
  }

  await prisma.user.create({
    data: {
      schoolId: school.id,
      email,
      fullName: "EduClear Super Admin",
      passwordHash,
      role: "SCHOOL_ADMIN",
      isActive: true,
    },
  });

  console.log("Created super admin user:", email, "schoolId:", school.id);
}

run()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
