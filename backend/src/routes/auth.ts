import { Router } from "express";
import jwt from "jsonwebtoken";

import { requireAuthDiagnostics } from "../middleware/requireAuthDiagnostics";
import { prisma } from "../prisma";
import {
  compareAuthPassword,
  hashAuthPassword,
  normalizeAuthEmail,
} from "../services/authCredentials";
import { buildAuthDiagnostics } from "../services/authDiagnostics";
import { seedSchoolEmailDefaults } from "../services/schoolEmailService";
import { permissionsForRole, prismaRoleForAppRole } from "../utils/userPermissions";
import { setUserAccessMeta } from "../utils/userAccessStore";
import {
  isRegistrationProvisionedOwner,
  isScriptProvisionedOwner,
  normalizeOwnerEmail,
} from "../utils/ownerProvisioning";
import { canAccessMigration } from "../utils/migrationAccess";
import { isPlatformSuperAdminEmail } from "../utils/superAdmin";
import { toStoredSchoolLogoUrl } from "../utils/schoolLogo";

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const normalizeEmail = normalizeAuthEmail;

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
      where: {
        email: { equals: email, mode: "insensitive" },
        isActive: true,
      },
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
      const ok = await compareAuthPassword(password, user.passwordHash);
      authLog("login: password compare", { email, userId: user.id, match: ok });
      if (ok) {
        matched = user;
        break;
      }
    }

    if (!matched) {
      authLog("login: password mismatch for all user row(s)", { email, count: users.length });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const school = await prisma.school.findUnique({
      where: { id: matched.schoolId },
      select: { id: true, name: true, email: true, logoUrl: true },
    });

    if (!school) {
      authLog("login: orphan schoolId on user", {
        email,
        userId: matched.id,
        schoolId: matched.schoolId,
      });
      return res.status(401).json({ error: "Invalid credentials" });
    }

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

    const migrationCtx = {
      userId: matched.id,
      schoolId: matched.schoolId,
      email: tokenEmail,
      role: matched.role,
    };
    const canAccessMigrationFlag = canAccessMigration(migrationCtx);
    const permissions = permissionsForRole(matched.role);

    return res.json({
      token,
      ...(educlearRole ? { educlearRole } : {}),
      canAccessMigration: canAccessMigrationFlag,
      user: {
        id: matched.id,
        email: matched.email,
        schoolId: matched.schoolId,
        fullName: matched.fullName,
        role: matched.role,
        permissions,
        canAccessMigration: canAccessMigrationFlag,
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

router.get("/diagnostics/:email", requireAuthDiagnostics, async (req, res) => {
  const email = normalizeEmail(req.params.email);
  if (!email) {
    return res.status(400).json({ error: "Email required" });
  }

  try {
    const diag = await buildAuthDiagnostics(email);
    return res.json({
      userFound: diag.userFound,
      userId: diag.userId,
      email: diag.email,
      role: diag.role,
      schoolId: diag.schoolId,
      active: diag.active,
      passwordHashExists: diag.passwordHashExists,
      duplicateEmailCount: diag.duplicateEmailCount,
      loginReady: diag.loginReady,
      duplicateActiveCount: diag.duplicateActiveCount,
      issues: diag.issues,
      users: diag.users,
    });
  } catch (error) {
    console.error("[auth] GET /diagnostics failed:", error);
    return res.status(500).json({ error: "Auth diagnostics failed" });
  }
});

router.post("/register-school", async (req, res) => {
  const body = req.body ?? {};
  const schoolName = String(body.schoolName || "").trim();
  const contactPerson = String(body.contactPerson || body.fullName || "").trim();
  const email = normalizeEmail(body.email);
  const phone = String(body.phone || "").trim();
  const password = String(body.password || "");
  const logoUrl = body.logoUrl ? toStoredSchoolLogoUrl(String(body.logoUrl).trim()) : null;

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
    const existingSchoolByEmail = await prisma.school.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, name: true, email: true },
    });
    if (existingSchoolByEmail) {
      return res.status(400).json({ error: "A school with this email already exists" });
    }

    const existingUsers = await prisma.user.findMany({
      where: { email: { equals: email, mode: "insensitive" } },
      select: {
        id: true,
        schoolId: true,
        email: true,
        fullName: true,
        isActive: true,
      },
    });

    const schoolByName = await prisma.school.findFirst({
      where: { name: { equals: schoolName, mode: "insensitive" } },
      select: { id: true, name: true, email: true, phone: true, logoUrl: true },
    });

    if (schoolByName) {
      const schoolUsers = await prisma.user.findMany({
        where: { schoolId: schoolByName.id, isActive: true },
        select: { id: true, email: true, fullName: true },
      });

      const scriptOwner = schoolUsers.find(
        (u) =>
          normalizeOwnerEmail(u.email) === email &&
          isScriptProvisionedOwner(u, schoolByName)
      );

      if (scriptOwner) {
        authLog("register-school: reclaiming script-provisioned owner", {
          email,
          schoolId: schoolByName.id,
          userId: scriptOwner.id,
        });
      } else if (schoolUsers.length > 0) {
        return res.status(400).json({
          error:
            "A school with this name already exists. Please log in with your owner account.",
        });
      } else if (existingUsers.some((u) => u.isActive)) {
        return res.status(400).json({
          error: "An account with this email already exists. Please log in.",
        });
      }

      const passwordHash = await hashAuthPassword(password);
      authLog("register-school: password hashed", { email });

      const result = await prisma.$transaction(async (tx) => {
        const school = await tx.school.update({
          where: { id: schoolByName.id },
          data: {
            email,
            phone,
            ...(logoUrl ? { logoUrl } : {}),
          },
          select: { id: true, name: true, email: true, logoUrl: true },
        });

        const user = scriptOwner
          ? await tx.user.update({
              where: { id: scriptOwner.id },
              data: {
                passwordHash,
                fullName: contactPerson,
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
            })
          : await tx.user.create({
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

        return { school, user, reclaimed: Boolean(scriptOwner) };
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

      authLog(
        result.reclaimed
          ? "register-school: reclaimed existing school with registration password"
          : "register-school: linked owner to existing school",
        {
          email,
          schoolId: result.school.id,
          userId: result.user.id,
        }
      );

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

      return res.status(result.reclaimed ? 200 : 201).json({
        token,
        user: result.user,
        school: result.school,
        reclaimed: result.reclaimed,
      });
    }

    if (existingUsers.length) {
      const withSchool = await Promise.all(
        existingUsers.map(async (u) => {
          const school = await prisma.school.findUnique({
            where: { id: u.schoolId },
            select: { id: true, email: true, name: true },
          });
          return { user: u, school };
        })
      );
      const registrationRow = withSchool.find(
        ({ user, school }) => school && isRegistrationProvisionedOwner(user, school)
      );
      if (registrationRow) {
        return res.status(400).json({
          error: "An account with this email already exists. Please log in.",
        });
      }
      return res.status(400).json({
        error: "An account with this email already exists. Please log in.",
      });
    }

    const passwordHash = await hashAuthPassword(password);
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
