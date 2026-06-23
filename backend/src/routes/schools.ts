import { Router } from "express";
import jwt from "jsonwebtoken";

import { prisma } from "../prisma";
import { hashAuthPassword } from "../services/authCredentials";
import { toStoredSchoolLogoUrl } from "../utils/schoolLogo";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

const schoolSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  cellNo: true,
  address: true,
  postalAddress: true,
  bankingDetails: true,
  logoUrl: true,
  primaryColor: true,
  createdAt: true,
} as const;

function optionalTrimmedString(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  return text === "" ? null : text;
}

async function resolveAuthenticatedSchoolUser(req: any) {
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return null;

  let payload: { userId?: string; schoolId?: string };
  try {
    payload = jwt.verify(token, JWT_SECRET) as {
      userId?: string;
      schoolId?: string;
    };
  } catch {
    return null;
  }
  const userId = String(payload.userId || "").trim();
  if (!userId) return null;

  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, schoolId: true, isActive: true },
  });
}

router.get("/", async (_req, res) => {
  try {
    const schools = await prisma.school.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
      },
      orderBy: { name: "asc" },
    });

    res.json(schools);
  } catch (error) {
    console.error("Error fetching schools:", error);
    res.status(500).json({ error: "Failed to fetch schools" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing school id" });

    const school = await prisma.school.findUnique({
      where: { id },
      select: schoolSelect,
    });

    if (!school) return res.status(404).json({ error: "School not found" });

    return res.json(school);
  } catch (error) {
    console.error("Error fetching school:", error);
    return res.status(500).json({ error: "Failed to fetch school" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing school id" });

    const existing = await prisma.school.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) return res.status(404).json({ error: "School not found" });

    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ error: "Business name is required" });

    const email = optionalTrimmedString(req.body?.email);
    const phone = optionalTrimmedString(req.body?.phone);
    const cellNo = optionalTrimmedString(req.body?.cellNo);
    const address = optionalTrimmedString(req.body?.address);
    const postalAddress = optionalTrimmedString(req.body?.postalAddress);
    const bankingDetails = optionalTrimmedString(req.body?.bankingDetails);
    const logoUrlRaw =
      req.body?.logoUrl === undefined ? undefined : optionalTrimmedString(req.body?.logoUrl);
    const logoUrl =
      logoUrlRaw === undefined ? undefined : logoUrlRaw === null ? null : toStoredSchoolLogoUrl(logoUrlRaw);

    const school = await prisma.school.update({
      where: { id },
      data: {
        name,
        email,
        phone,
        cellNo,
        address,
        postalAddress,
        bankingDetails,
        ...(logoUrl !== undefined ? { logoUrl } : {}),
      },
      select: schoolSelect,
    });

    return res.json(school);
  } catch (error) {
    console.error("Error updating school:", error);
    return res.status(500).json({ error: "Failed to update school" });
  }
});

router.post("/:id/password", async (req, res) => {
  try {
    const schoolId = String(req.params.id || "").trim();
    const newPassword = String(req.body?.newPassword || req.body?.password || "");
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing school id" });
    if (!newPassword) {
      return res.status(400).json({ success: false, error: "New password is required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        error: "New password must be at least 8 characters",
      });
    }

    const user = await resolveAuthenticatedSchoolUser(req);
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, error: "Authentication required" });
    }
    if (user.schoolId !== schoolId) {
      return res.status(403).json({
        success: false,
        error: "You can only change the password for your current school account",
      });
    }

    const passwordHash = await hashAuthPassword(newPassword);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    return res.json({ success: true, message: "Password updated successfully" });
  } catch (error) {
    console.error("Error changing school profile password:", error);
    return res.status(500).json({ success: false, error: "Failed to update password" });
  }
});

export default router;
