import { Router } from "express";

import { prisma } from "../prisma";

const router = Router();

/** Login / parent-portal school picker. No contact, email, or banking fields. */
export function toPublicSchoolListItem(row: { id: string; name: string }) {
  return { id: row.id, name: row.name };
}

/** Parent-portal branding. Logo and name only. */
export function toPublicSchoolBranding(row: {
  id: string;
  name: string;
  logoUrl: string | null;
}) {
  return {
    id: row.id,
    name: row.name,
    logoUrl: row.logoUrl ?? null,
  };
}

router.get("/", async (_req, res) => {
  try {
    const rows = await prisma.school.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return res.json(rows.map(toPublicSchoolListItem));
  } catch (error) {
    console.error("[public-schools] GET / failed:", error);
    return res.status(500).json({ success: false, error: "Failed to fetch schools" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing school id" });
    const row = await prisma.school.findUnique({
      where: { id },
      select: { id: true, name: true, logoUrl: true },
    });
    if (!row) return res.status(404).json({ error: "School not found" });
    return res.json(toPublicSchoolBranding(row));
  } catch (error) {
    console.error("[public-schools] GET /:id failed:", error);
    return res.status(500).json({ error: "Failed to fetch school" });
  }
});

export default router;
