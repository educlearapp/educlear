import { Router } from "express";

import bcrypt from "bcryptjs";

import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";



const router = Router();
const prisma = new PrismaClient();



// ✅ Temporary admin user (we can move to DB later)

const ADMIN_EMAIL = "admin@educlear.co.za";

const ADMIN_PASSWORD_HASH = bcrypt.hashSync("Admin@1234", 10);



// ✅ Secret (later move to .env)

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

function normalizeEmail(email: unknown): string {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function normalizePhone(phone: unknown): string {
  return String(phone || "")
    .trim()
    .replace(/[^\d+]/g, "");
}

function assertStrongPassword(password: string) {
  if (password.length < 8) {
    const err: any = new Error("Password must be at least 8 characters.");
    err.status = 400;
    throw err;
  }
}

router.post("/register", async (req, res) => {
  try {
    const schoolName = String(req.body?.schoolName || "").trim();
    const contactPerson = String(req.body?.contactPerson || "").trim();
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone);
    const password = String(req.body?.password || "");
    const rawLogoUrl = String(req.body?.logoUrl || "").trim();
    const logoUrl = rawLogoUrl && rawLogoUrl.startsWith("/uploads/") ? rawLogoUrl : null;

    if (!schoolName) return res.status(400).json({ error: "School name is required" });
    if (!contactPerson) return res.status(400).json({ error: "Contact person is required" });
    if (!email || !email.includes("@")) return res.status(400).json({ error: "Valid email is required" });
    if (!phone) return res.status(400).json({ error: "Phone is required" });
    assertStrongPassword(password);

    const existingUser = await prisma.user.findFirst({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ error: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const created = await prisma.school.create({
      data: {
        name: schoolName,
        email,
        phone,
        ...(logoUrl ? { logoUrl } : {}),
        users: {
          create: {
            email,
            passwordHash,
            role: "SCHOOL_ADMIN",
          },
        },
      },
      select: { id: true, name: true, email: true },
    });

    return res.json({
      ok: true,
      schoolId: created.id,
      message: "Registration successful. Please log in.",
    });
  } catch (e: any) {
    const status = Number(e?.status || 500);
    const message = e?.message || "Registration failed";
    return res.status(status).json({ error: message });
  }
});

router.post("/school/login", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const user = await prisma.user.findFirst({
      where: { email },
      select: { id: true, email: true, passwordHash: true, schoolId: true, role: true, isActive: true },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign({ userId: user.id, schoolId: user.schoolId, role: user.role }, JWT_SECRET, {
      expiresIn: "7d",
    });

    return res.json({ token, schoolId: user.schoolId });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Login failed" });
  }
});


router.post("/login", async (req, res) => {

  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const user = await prisma.user.findFirst({
      where: { email },
      select: { id: true, email: true, passwordHash: true, schoolId: true, role: true, isActive: true },
    });

    // Optional fallback for temporary admin (DB user preferred if it exists).
    const storedHash =
      user?.passwordHash || (email === normalizeEmail(ADMIN_EMAIL) ? ADMIN_PASSWORD_HASH : "");

    if (!storedHash) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user && user.isActive === false) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(password, storedHash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        userId: user?.id,
        schoolId: user?.schoolId,
        role: user?.role || "admin",
        email,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({ token, schoolId: user?.schoolId });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Login failed" });
  }
});



export default router;