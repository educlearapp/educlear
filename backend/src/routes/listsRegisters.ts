/**
 * Lists & Registers V3 — narrow authenticated READ-ONLY endpoints.
 * GET /api/lists-registers/{employees,groups,incidents,employee-attendance}
 */
import { Router } from "express";

import { prisma } from "../prisma";
import {
  requireListsRegistersAuth,
  type ListsRegistersAuthRequest,
} from "../middleware/requireListsRegistersAuth";
import { resolveLearnerClassroomLabel } from "../utils/learnerEnrollment";
import {
  buildListsRegistersEmployeeAttendance,
  type ListsRegistersAttendanceKind,
} from "../services/listsRegistersEmployeeAttendance";

const router = Router();

function parseBoolQuery(raw: unknown): boolean {
  const s = String(raw ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function formatDob(value: Date | null | undefined): string | null {
  if (!value) return null;
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, "0");
  const d = String(value.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

router.get("/employees", requireListsRegistersAuth, async (req: ListsRegistersAuthRequest, res) => {
  try {
    const schoolId = req.listsRegistersAuth!.authorizedSchoolId;
    const employees = await prisma.employee.findMany({
      where: { schoolId, isActive: true },
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        fullName: true,
        dateOfBirth: true,
        mobileNumber: true,
        email: true,
        physicalAddress: true,
        jobTitle: true,
        department: true,
        isActive: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });

    return res.status(200).json({
      success: true,
      employees: employees.map((e) => ({
        id: e.id,
        employeeNumber: e.employeeNumber,
        firstName: e.firstName,
        lastName: e.lastName,
        fullName: e.fullName || `${e.firstName} ${e.lastName}`.trim(),
        dateOfBirth: formatDob(e.dateOfBirth),
        mobileNumber: e.mobileNumber,
        email: e.email,
        physicalAddress: e.physicalAddress,
        jobTitle: e.jobTitle,
        department: e.department,
        isActive: e.isActive,
      })),
    });
  } catch (error) {
    console.error("GET /api/lists-registers/employees ERROR:", error);
    return res.status(500).json({ success: false, error: "Failed to load employees" });
  }
});

router.get("/groups", requireListsRegistersAuth, async (req: ListsRegistersAuthRequest, res) => {
  try {
    const schoolId = req.listsRegistersAuth!.authorizedSchoolId;
    const links = await prisma.groupLearner.findMany({
      where: {
        schoolId,
        // ACTIVE preferred for Lists & Registers group membership rows
        learner: { enrollmentStatus: "ACTIVE" },
      },
      include: {
        group: { select: { id: true, name: true } },
        learner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            grade: true,
            className: true,
          },
        },
      },
      orderBy: [{ groupId: "asc" }, { learnerId: "asc" }],
    });

    const rows = links
      .map((row) => ({
        groupId: row.group.id,
        groupName: row.group.name,
        learnerId: row.learner.id,
        surname: row.learner.lastName,
        name: row.learner.firstName,
        grade: row.learner.grade || "",
        classroom: resolveLearnerClassroomLabel(row.learner),
      }))
      .sort((a, b) => {
        const byGroup = a.groupName.localeCompare(b.groupName, undefined, { sensitivity: "base" });
        if (byGroup !== 0) return byGroup;
        const bySurname = a.surname.localeCompare(b.surname, undefined, { sensitivity: "base" });
        if (bySurname !== 0) return bySurname;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      });

    return res.status(200).json({ success: true, rows });
  } catch (error) {
    console.error("GET /api/lists-registers/groups ERROR:", error);
    return res.status(500).json({ success: false, error: "Failed to load groups" });
  }
});

router.get("/incidents", requireListsRegistersAuth, async (req: ListsRegistersAuthRequest, res) => {
  try {
    const schoolId = req.listsRegistersAuth!.authorizedSchoolId;
    const incidents = await prisma.learnerIncident.findMany({
      where: { schoolId },
      select: {
        id: true,
        incidentDate: true,
        type: true,
        subject: true,
        summary: true,
        createdBy: true,
        learnerId: true,
        learner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            grade: true,
            className: true,
          },
        },
      },
      orderBy: [{ incidentDate: "desc" }, { createdAt: "desc" }],
    });

    return res.status(200).json({
      success: true,
      incidents: incidents.map((i) => ({
        id: i.id,
        incidentDate: i.incidentDate,
        type: i.type,
        subject: i.subject,
        summary: i.summary,
        createdBy: i.createdBy,
        learnerId: i.learnerId,
        learnerName: `${i.learner.lastName} ${i.learner.firstName}`.trim(),
        grade: i.learner.grade || "",
        classroom: resolveLearnerClassroomLabel(i.learner),
      })),
    });
  } catch (error) {
    console.error("GET /api/lists-registers/incidents ERROR:", error);
    return res.status(500).json({ success: false, error: "Failed to load incidents" });
  }
});

router.get(
  "/employee-attendance",
  requireListsRegistersAuth,
  async (req: ListsRegistersAuthRequest, res) => {
    try {
      const schoolId = req.listsRegistersAuth!.authorizedSchoolId;
      const kindRaw = String(req.query.kind || "").trim().toLowerCase();
      if (kindRaw !== "weekly" && kindRaw !== "monthly") {
        return res.status(400).json({
          success: false,
          error: "kind must be weekly or monthly",
          code: "INVALID_KIND",
        });
      }
      const kind = kindRaw as ListsRegistersAttendanceKind;
      const anchorDate = String(req.query.anchorDate || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
        return res.status(400).json({
          success: false,
          error: "anchorDate must be YYYY-MM-DD",
          code: "INVALID_ANCHOR_DATE",
        });
      }

      const includeWeekends = parseBoolQuery(req.query.includeWeekends);
      const includeTimes = parseBoolQuery(req.query.includeTimes);

      const result = await buildListsRegistersEmployeeAttendance({
        schoolId,
        kind,
        includeWeekends,
        includeTimes,
        anchorDate,
      });

      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load employee attendance";
      if (/anchorDate/i.test(message)) {
        return res.status(400).json({
          success: false,
          error: message,
          code: "INVALID_ANCHOR_DATE",
        });
      }
      console.error("GET /api/lists-registers/employee-attendance ERROR:", error);
      return res.status(500).json({ success: false, error: "Failed to load employee attendance" });
    }
  }
);

export default router;
