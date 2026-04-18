import { Router } from "express";
import { PrismaClient } from "@prisma/client";

const router = Router();
const prisma = new PrismaClient();

const isDev = process.env.NODE_ENV !== "production";

/** Average of the five category scores, each 0–10. */
function calculateFinalScore(
  learnerResults: number,
  classroomManagement: number,
  teachingQuality: number,
  administration: number,
  professionalConduct: number
): number {
  const sum =
    learnerResults +
    classroomManagement +
    teachingQuality +
    administration +
    professionalConduct;
  return Math.round((sum / 5) * 10) / 10;
}

function getPerformanceLevel(score: number): string {
  if (score >= 8) return "Excellent";
  if (score >= 6) return "Acceptable";
  return "At Risk";
}

function parseScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.max(0, Math.min(10, Math.round(n)));
}

router.post("/", async (req, res) => {
  try {
    const body = req.body ?? {};
    const schoolId = body.schoolId as string | undefined;
    const teacherName = (body.teacherName as string)?.trim() ?? "";
    const teacherEmail =
      typeof body.teacherEmail === "string" && body.teacherEmail.trim()
        ? body.teacherEmail.trim()
        : null;
    const month = typeof body.month === "string" ? body.month.trim() : "";

    if (!schoolId) {
      return res.status(400).json({ error: "schoolId is required" });
    }
    if (!teacherName) {
      return res.status(400).json({ error: "teacherName is required" });
    }
    if (!month) {
      return res.status(400).json({ error: "month is required" });
    }

    const learnerResults = parseScore(body.learnerResults);
    const classroomManagement = parseScore(body.classroomManagement);
    const teachingQuality = parseScore(body.teachingQuality);
    const administration = parseScore(body.administration);
    const professionalConduct = parseScore(body.professionalConduct);

    if (
      [learnerResults, classroomManagement, teachingQuality, administration, professionalConduct].some(
        (v) => Number.isNaN(v)
      )
    ) {
      return res.status(400).json({ error: "All score fields must be numbers between 0 and 10" });
    }

    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) {
      return res.status(400).json({ error: "School not found", schoolId });
    }

    const finalScore = calculateFinalScore(
      learnerResults,
      classroomManagement,
      teachingQuality,
      administration,
      professionalConduct
    );
    const performanceLevel = getPerformanceLevel(finalScore);

    const notes =
      typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

    const record = await prisma.teacherPerformance.create({
      data: {
        schoolId,
        teacherName,
        teacherEmail,
        month,
        learnerResults,
        classroomManagement,
        teachingQuality,
        administration,
        professionalConduct,
        notes,
        finalScore,
        performanceLevel,
      },
    });

    res.json(record);
  } catch (err) {
    console.error("teacher-performance POST:", err);
    res.status(500).json({
      error: "Error creating record",
      ...(isDev && { details: err instanceof Error ? err.message : String(err) }),
    });
  }
});

router.get("/school/:schoolId", async (req, res) => {
  try {
    const { schoolId } = req.params;
    const records = await prisma.teacherPerformance.findMany({
      where: { schoolId },
      orderBy: { createdAt: "desc" },
    });
    res.json(records);
  } catch (err) {
    console.error("teacher-performance GET:", err);
    res.status(500).json({
      error: "Error fetching records",
      ...(isDev && { details: err instanceof Error ? err.message : String(err) }),
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.teacherPerformance.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    console.error("teacher-performance DELETE:", err);
    res.status(500).json({
      error: "Error deleting record",
      ...(isDev && { details: err instanceof Error ? err.message : String(err) }),
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body ?? {};

    const teacherName = (body.teacherName as string)?.trim() ?? "";
    const teacherEmail =
      typeof body.teacherEmail === "string" && body.teacherEmail.trim()
        ? body.teacherEmail.trim()
        : null;
    const month = typeof body.month === "string" ? body.month.trim() : "";

    if (!teacherName) {
      return res.status(400).json({ error: "teacherName is required" });
    }
    if (!month) {
      return res.status(400).json({ error: "month is required" });
    }

    const learnerResults = parseScore(body.learnerResults);
    const classroomManagement = parseScore(body.classroomManagement);
    const teachingQuality = parseScore(body.teachingQuality);
    const administration = parseScore(body.administration);
    const professionalConduct = parseScore(body.professionalConduct);

    if (
      [learnerResults, classroomManagement, teachingQuality, administration, professionalConduct].some(
        (v) => Number.isNaN(v)
      )
    ) {
      return res.status(400).json({ error: "All score fields must be numbers between 0 and 10" });
    }

    const finalScore = calculateFinalScore(
      learnerResults,
      classroomManagement,
      teachingQuality,
      administration,
      professionalConduct
    );
    const performanceLevel = getPerformanceLevel(finalScore);

    const notes =
      typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

    const updated = await prisma.teacherPerformance.update({
      where: { id },
      data: {
        teacherName,
        teacherEmail,
        month,
        learnerResults,
        classroomManagement,
        teachingQuality,
        administration,
        professionalConduct,
        notes,
        finalScore,
        performanceLevel,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error("teacher-performance PUT:", err);
    res.status(500).json({
      error: "Error updating record",
      ...(isDev && { details: err instanceof Error ? err.message : String(err) }),
    });
  }
});

export default router;
