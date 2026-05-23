import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { prisma } from "../prisma";
import { seedSchoolEmailDefaults } from "../services/schoolEmailService";
import { permissionsForRole, prismaRoleForAppRole } from "../utils/userPermissions";
import { setUserAccessMeta } from "../utils/userAccessStore";
import { isPlatformSuperAdminEmail, normalizeSuperAdminEmail } from "../utils/superAdmin";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const normalizeEmail = normalizeSuperAdminEmail;

function signAuthToken(payload: {
  userId: string;
  schoolId: string;
  email: string;
  role: string;
}) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

function authLog(message: string, extra?: Record<string, unknown>) {
  if (extra) {
    console.log(`[auth] ${message}`, extra);
  } else {
    console.log(`[auth] ${message}`);
  }
}

router.post("/login", async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Invalid email address" });
  }

  try {
    const users = await prisma.user.findMany({
      where: { email, isActive: true },
      select: {
        id: true,
        schoolId: true,
        email: true,
        passwordHash: true,
        role: true,
        fullName: true,
        isActive: true,
      },
    });

    if (!users.length) {
      authLog("login: user not found", { email });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    authLog("login: user(s) found", { email, count: users.length });

    let matched: (typeof users)[number] | null = null;
    for (const user of users) {
      const ok = await bcrypt.compare(password, user.passwordHash);
      authLog("login: password compare", { email, userId: user.id, match: ok });
      if (ok) {
        matched = user;
        break;
      }
    }

    if (!matched) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const school = await prisma.school.findUnique({
      where: { id: matched.schoolId },
      select: { id: true, name: true, email: true, logoUrl: true },
    });

    const tokenEmail = normalizeEmail(matched.email);
    const token = signAuthToken({
      userId: matched.id,
      schoolId: matched.schoolId,
      email: tokenEmail,
      role: matched.role,
    });

    const educlearRole = isPlatformSuperAdminEmail(matched.email)
      ? ("superAdmin" as const)
      : undefined;

    return res.json({
      token,
      ...(educlearRole ? { educlearRole } : {}),
      user: {
        id: matched.id,
        email: matched.email,
        schoolId: matched.schoolId,
        fullName: matched.fullName,
        role: matched.role,
        ...(educlearRole ? { educlearRole } : {}),
      },
      school: school
        ? { id: school.id, name: school.name, email: school.email, logoUrl: school.logoUrl }
        : { id: matched.schoolId },
    });
  } catch (error) {
    console.error("[auth] POST /login failed:", error);
    return res.status(500).json({ error: "Login failed" });
  }
});

router.post("/register-school", async (req, res) => {
  const body = req.body ?? {};
  const schoolName = String(body.schoolName || "").trim();
  const contactPerson = String(body.contactPerson || body.fullName || "").trim();
  const email = normalizeEmail(body.email);
  const phone = String(body.phone || "").trim();
  const password = String(body.password || "");
  const logoUrl = body.logoUrl ? String(body.logoUrl).trim() : null;

  if (!schoolName || !contactPerson || !email || !phone || !password) {
    return res.status(400).json({
      error: "schoolName, contactPerson, email, phone, and password are required",
    });
  }

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Invalid email address" });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  try {
    const existingSchool = await prisma.school.findFirst({
      where: { email },
      select: { id: true },
    });
    if (existingSchool) {
      return res.status(400).json({ error: "A school with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    authLog("register-school: password hashed", { email });

    const result = await prisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: {
          name: schoolName,
          email,
          phone,
          logoUrl,
        },
        select: { id: true, name: true, email: true, logoUrl: true },
      });

      const user = await tx.user.create({
        data: {
          schoolId: school.id,
          email,
          fullName: contactPerson,
          passwordHash,
          role: prismaRoleForAppRole("Owner"),
          isActive: true,
        },
        select: {
          id: true,
          schoolId: true,
          email: true,
          fullName: true,
          role: true,
        },
      });

      return { school, user };
    });

    const nameParts = contactPerson.split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || contactPerson;
    const surname = nameParts.slice(1).join(" ");

    setUserAccessMeta(result.user.id, {
      schoolId: result.school.id,
      firstName,
      surname,
      appRole: "Owner",
      permissions: permissionsForRole("Owner"),
      lastLoginAt: null,
    });

    authLog("register-school: created school and user", {
      email,
      schoolId: result.school.id,
      userId: result.user.id,
    });

    try {
      await seedSchoolEmailDefaults(result.school.id);
    } catch (seedErr) {
      console.error("[auth] register-school: seedSchoolEmailDefaults failed:", seedErr);
    }

    const token = signAuthToken({
      userId: result.user.id,
      schoolId: result.school.id,
      email: result.user.email,
      role: result.user.role,
    });

    return res.status(201).json({
      token,
      user: result.user,
      school: result.school,
    });
  } catch (error) {
    console.error("[auth] POST /register-school failed:", error);
    return res.status(500).json({ error: "School registration failed" });
  }
});

export default router;
