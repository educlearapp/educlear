import { Router } from "express";

import { PrismaClient } from "@prisma/client";



const prisma = new PrismaClient();

const router = Router();



router.get("/", async (req, res) => {

  try {

    // NOTE: Some deployed DBs may be behind the Prisma schema (missing newer columns).
    // Selecting only stable columns avoids runtime failures (e.g. missing `primaryColor`).
    const stableSelect = {
      id: true,
      name: true,
      email: true,
      createdAt: true,
    } as const;

    let schools: any[] = [];
    try {
      schools = await prisma.school.findMany({
        select: { ...stableSelect, logoUrl: true },
        orderBy: { createdAt: "desc" },
      });
    } catch {
      const base = await prisma.school.findMany({
        select: stableSelect,
        orderBy: { createdAt: "desc" },
      });
      schools = base.map((s) => ({ ...s, logoUrl: null }));
    }

    res.json(schools);

  } catch (error) {

    console.error("Error fetching schools:", error);

    res.status(500).json({ error: "Failed to fetch schools" });

  }

});

router.get("/:id", async (req, res) => {
  try {
    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ error: "id is required" });

    const stableSelect = {
      id: true,
      name: true,
      email: true,
      phone: true,
      address: true,
      createdAt: true,
    } as const;

    let school: any = null;
    try {
      school = await prisma.school.findUnique({
        where: { id },
        select: { ...stableSelect, logoUrl: true },
      });
    } catch {
      const base = await prisma.school.findUnique({
        where: { id },
        select: stableSelect,
      });
      school = base ? { ...base, logoUrl: null } : null;
    }

    if (!school) return res.status(404).json({ error: "School not found" });
    return res.json({ ok: true, school });
  } catch (error) {
    console.error("Error fetching school:", error);
    res.status(500).json({ error: "Failed to fetch school" });
  }
});



export default router;