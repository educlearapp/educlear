import { Router } from "express";

import { PrismaClient } from "@prisma/client";



const prisma = new PrismaClient();

const router = Router();

router.get("/:id/exists", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing school id" });

    const school = await prisma.school.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!school) return res.status(404).json({ exists: false });
    return res.json({ exists: true });
  } catch (error) {
    console.error("Error checking school existence:", error);
    return res.status(500).json({ error: "Failed to check school existence" });
  }
});



router.get("/", async (req, res) => {

  try {

    // NOTE: Some deployed DBs may be behind the Prisma schema (missing newer columns).
    // Selecting only stable columns avoids runtime failures (e.g. missing `primaryColor`).
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



export default router;