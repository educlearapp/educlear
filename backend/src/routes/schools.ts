import { Router } from "express";

import { prisma } from "../prisma";

const router = Router();

const schoolSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  cellNo: true,
  address: true,
  logoUrl: true,
  primaryColor: true,
  createdAt: true,
} as const;

function optionalTrimmedString(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  return text === "" ? null : text;
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
      orderBy: { createdAt: "desc" },
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

    const school = await prisma.school.update({
      where: { id },
      data: { name, email, phone, cellNo, address },
      select: schoolSelect,
    });

    return res.json(school);
  } catch (error) {
    console.error("Error updating school:", error);
    return res.status(500).json({ error: "Failed to update school" });
  }
});

export default router;
