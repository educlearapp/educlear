import bcrypt from "bcryptjs";

import { prisma } from "../prisma";
import { normalizeSuperAdminEmail, parseSuperAdminEmails } from "../utils/superAdmin";

const PLATFORM_SCHOOL_NAME = "EduClear Platform";

export function canAutoEnsureSuperAdmin(): boolean {
  const allowed = parseSuperAdminEmails();
  const password = String(process.env.SUPER_ADMIN_SEED_PASSWORD || "").trim();
  return allowed.length > 0 && password.length > 0;
}

/**
 * Creates or updates the platform super-admin user (idempotent).
 * Requires SUPER_ADMIN_EMAILS and SUPER_ADMIN_SEED_PASSWORD.
 */
export async function ensureSuperAdminUser(): Promise<string> {
  const allowed = parseSuperAdminEmails();
  if (!allowed.length) {
    throw new Error("SUPER_ADMIN_EMAILS is empty — add info@educlear.co.za (comma-separated list)");
  }

  const email = normalizeSuperAdminEmail(process.env.SUPER_ADMIN_SEED_EMAIL || allowed[0]);
  const plainPassword = String(process.env.SUPER_ADMIN_SEED_PASSWORD || "").trim();

  if (!plainPassword) {
    throw new Error("SUPER_ADMIN_SEED_PASSWORD is required (set in env, never commit it)");
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
        role: "SCHOOL_ADMIN",
        fullName: existing.isActive ? undefined : "EduClear Super Admin",
      },
    });
    return email;
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

  return email;
}

/** Safe for every deploy: skips when env is unset; never logs the password. */
export async function ensureSuperAdminOnStartup(): Promise<void> {
  if (!canAutoEnsureSuperAdmin()) {
    return;
  }

  try {
    const email = await ensureSuperAdminUser();
    console.log(`Super admin ensured: ${email}`);
  } catch (error) {
    console.error("[ensureSuperAdmin] Failed to ensure super admin:", error);
  }
}
