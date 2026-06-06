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
import {
  appRoleFromPrismaRole,
  permissionsForRole,
  prismaRoleForAppRole,
  resolveStoredPermissions,
  type AppRole,
  type PermissionMap,
} from "../utils/userPermissions";
import { getUserAccessMeta, setUserAccessMeta } from "../utils/userAccessStore";
import {
  isRegistrationProvisionedOwner,
  isScriptProvisionedOwner,
  normalizeOwnerEmail,
} from "../utils/ownerProvisioning";
import { canAccessMigration } from "../utils/migrationAccess";
import { isPlatformSuperAdminEmail } from "../utils/superAdmin";
import { toStoredSchoolLogoUrl } from "../utils/schoolLogo";
import {
  buildOtpStoreKey,
  consumeStoredOtp,
  deliverOtpSms,
  generateOtpCode,
  storeOtp,
} from "../services/otpSmsService";
import { normalizeSaPhone } from "../services/parentPortalService";

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

async function resolveUserAccess(user: { id: string; schoolId: string; role: string }) {
  const meta = await getUserAccessMeta(user.id);
  const appRole = (meta?.appRole || appRoleFromPrismaRole(user.role)) as AppRole;
  const permissions = resolveStoredPermissions(appRole, meta?.permissions || null);

  if (meta) {
    await setUserAccessMeta(user.id, {
      ...meta,
      schoolId: meta.schoolId || user.schoolId,
      lastLoginAt: new Date().toISOString(),
    });
  }

  return { appRole, permissions, meta };
}

function serializeAuthUser(
  user: {
    id: string;
    schoolId: string;
    email: string;
    fullName: string | null;
    role: string;
  },
  access: Awaited<ReturnType<typeof resolveUserAccess>>,
  extras?: Record<string, unknown>
) {
  return {
    id: user.id,
    email: user.email,
    schoolId: user.schoolId,
    fullName: user.fullName,
    role: user.role,
    prismaRole: user.role,
    appRole: access.appRole,
    permissions: access.permissions,
    ...extras,
  };
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
    const access = await resolveUserAccess(matched);

    return res.json({
      token,
      ...(educlearRole ? { educlearRole } : {}),
      canAccessMigration: canAccessMigrationFlag,
      user: serializeAuthUser(matched, access, {
        canAccessMigration: canAccessMigrationFlag,
        ...(educlearRole ? { educlearRole } : {}),
      }),
      school: school
        ? { id: school.id, name: school.name, email: school.email, logoUrl: school.logoUrl }
        : { id: matched.schoolId },
    });
  } catch (error) {
    console.error("[auth] POST /login failed:", error);
    return res.status(500).json({ error: "Login failed" });
  }
});

router.get("/me", async (req, res) => {
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as {
      userId?: string;
      schoolId?: string;
      email?: string;
      role?: string;
    };

    const userId = String(payload.userId || "").trim();
    if (!userId) {
      return res.status(401).json({ error: "Invalid session" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        schoolId: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: "User not found or inactive" });
    }

    const access = await resolveUserAccess(user);
    const educlearRole = isPlatformSuperAdminEmail(user.email) ? ("superAdmin" as const) : undefined;
    const migrationCtx = {
      userId: user.id,
      schoolId: user.schoolId,
      email: normalizeEmail(user.email),
      role: user.role,
    };

    return res.json({
      user: serializeAuthUser(user, access, {
        isActive: user.isActive,
        canAccessMigration: canAccessMigration(migrationCtx),
        ...(educlearRole ? { educlearRole } : {}),
      }),
    });
  } catch (error) {
    console.error("[auth] GET /me failed:", error);
    return res.status(401).json({ error: "Invalid or expired session" });
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

      await setUserAccessMeta(result.user.id, {
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

    await setUserAccessMeta(result.user.id, {
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

function schoolPhoneMatches(inputCellNo: string, school: { cellNo: string | null; phone: string | null }) {
  const input = normalizeSaPhone(inputCellNo);
  const candidates = [school.cellNo, school.phone]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .map((value) => normalizeSaPhone(value));

  return candidates.some(
    (candidate) =>
      candidate.plainInternational === input.plainInternational ||
      candidate.localCell === input.localCell
  );
}

router.post("/request-password-reset-otp", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const cellNo = String(req.body?.cellNo || "").trim();

    if (!email || !cellNo) {
      return res.status(400).json({ success: false, error: "Email and mobile number are required" });
    }

    const user = await prisma.user.findFirst({
      where: { email, isActive: true },
      include: { school: { select: { id: true, name: true, cellNo: true, phone: true } } },
    });

    if (!user || !user.school) {
      return res.status(404).json({ success: false, error: "No active account found for this email" });
    }

    if (!schoolPhoneMatches(cellNo, user.school)) {
      return res.status(400).json({
        success: false,
        error: "Mobile number does not match the school contact number on file",
      });
    }

    const code = generateOtpCode();
    const otpKey = buildOtpStoreKey(`password-reset:${user.schoolId}`, email);
    storeOtp(otpKey, code, "password_reset");

    const deliveryResult = await deliverOtpSms({
      schoolId: user.schoolId,
      cellNo,
      purpose: "password_reset",
      code,
      schoolName: user.school.name,
      clientMessageIdPrefix: "password-reset",
    });

    const devMode = process.env.NODE_ENV !== "production";
    const includeDevOtp = devMode && !deliveryResult.delivered;

    return res.json({
      success: true,
      message: deliveryResult.delivered
        ? "Password reset code sent by SMS."
        : deliveryResult.delivery === "not_configured"
          ? "SMS provider not configured for this school."
          : "Could not send SMS. Try again or contact support.",
      smsConfigured: deliveryResult.delivery !== "not_configured",
      delivery: deliveryResult.delivery,
      ...(includeDevOtp ? { devOtp: code } : {}),
    });
  } catch (error) {
    console.error("[auth] request-password-reset-otp failed:", error);
    return res.status(500).json({ success: false, error: "Failed to request password reset code" });
  }
});

router.post("/confirm-password-reset", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const cellNo = String(req.body?.cellNo || "").trim();
    const code = String(req.body?.code || "").trim();
    const newPassword = String(req.body?.newPassword || req.body?.password || "").trim();

    if (!email || !cellNo || !code || !newPassword) {
      return res.status(400).json({
        success: false,
        error: "Email, mobile number, verification code, and new password are required",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: "New password must be at least 8 characters",
      });
    }

    const user = await prisma.user.findFirst({
      where: { email, isActive: true },
      include: { school: { select: { id: true, cellNo: true, phone: true } } },
    });

    if (!user || !user.school) {
      return res.status(404).json({ success: false, error: "No active account found for this email" });
    }

    if (!schoolPhoneMatches(cellNo, user.school)) {
      return res.status(400).json({
        success: false,
        error: "Mobile number does not match the school contact number on file",
      });
    }

    const otpKey = buildOtpStoreKey(`password-reset:${user.schoolId}`, email);
    const devBypass = code === "000000" && process.env.NODE_ENV !== "production";
    if (!devBypass && !consumeStoredOtp(otpKey, code)) {
      return res.status(401).json({ success: false, error: "Invalid or expired verification code" });
    }

    const passwordHash = await hashAuthPassword(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    return res.json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    console.error("[auth] confirm-password-reset failed:", error);
    return res.status(500).json({ success: false, error: "Failed to reset password" });
  }
});

export default router;
