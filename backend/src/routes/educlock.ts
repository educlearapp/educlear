import { Router } from "express";

import {
  evaluateOwnerSchoolAuth,
  loadStaffSchoolAuth,
  type StaffSchoolAuth,
} from "../middleware/requireOwnerSchoolAccess";
import {
  activateEduClock,
  createEduClockCampus,
  createEduClockEntrance,
  EDUCLOCK_ERROR_MESSAGES,
  EduClockError,
  getEduClockMe,
  getOwnerEduClockReadiness,
  listEduClockCampuses,
  listOwnerEduClockStaff,
  ownerBulkUpdateEmployeeNumbers,
  ownerManualLink,
  ownerResetActivation,
  ownerUnlink,
  updateEduClockCampus,
  updateEduClockEntrance,
} from "../services/educlockService";
import {
  getOwnerAttendance,
  getOwnerEvent,
  getOwnerExceptions,
  getStaffClockHistory,
  getStaffClockStatus,
  ownerCreateCorrection,
  staffClockIn,
  staffClockOut,
} from "../services/educlockClockService";
import { prisma } from "../prisma";
import { maskIdentityNumber } from "../services/employeeIdentityVerification";
import { hasPermission, resolveStoredPermissions } from "../utils/userPermissions";

const router = Router();

type EduClockRequest = {
  headers: { authorization?: string };
  body?: Record<string, unknown>;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
};

async function requireStaffAuth(req: EduClockRequest): Promise<StaffSchoolAuth> {
  const auth = await loadStaffSchoolAuth(req.headers.authorization);
  if (!auth) {
    throw new EduClockError("EDUCLOCK_FORBIDDEN", 401, "Authentication required");
  }
  if (auth.authorizedSchoolId !== auth.schoolId) {
    throw new EduClockError("EDUCLOCK_EMPLOYEE_SCHOOL_MISMATCH", 403, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_EMPLOYEE_SCHOOL_MISMATCH);
  }
  return auth;
}

/**
 * Owner management routes require educlock.manage.
 * Owners receive all permissions via existing Owner rules.
 * School scope always comes from authenticated session — never trust client schoolId.
 */
async function requireEduClockManage(req: EduClockRequest): Promise<StaffSchoolAuth> {
  const auth = await requireStaffAuth(req);
  const permissionUser = {
    appRole: auth.appRole,
    isActive: true,
    permissions: resolveStoredPermissions(auth.appRole, auth.permissions),
  };
  if (!hasPermission(permissionUser, "educlock", "manage")) {
    throw new EduClockError(
      "EDUCLOCK_FORBIDDEN",
      403,
      "EduClock management requires educlock.manage permission"
    );
  }
  // Cross-school: reject any body/query schoolId that does not match session school.
  const claimed = String(
    req.body?.schoolId || req.query?.schoolId || req.params?.schoolId || ""
  ).trim();
  if (claimed && claimed !== auth.authorizedSchoolId) {
    throw new EduClockError("EDUCLOCK_EMPLOYEE_SCHOOL_MISMATCH", 403, EDUCLOCK_ERROR_MESSAGES.EDUCLOCK_EMPLOYEE_SCHOOL_MISMATCH);
  }
  return auth;
}

/** @deprecated Prefer requireEduClockManage — kept for Owner-only payroll-style checks if needed. */
async function requireOwnerAuth(req: EduClockRequest): Promise<StaffSchoolAuth> {
  const auth = await requireStaffAuth(req);
  const decision = evaluateOwnerSchoolAuth({
    auth,
    requestSchoolId: auth.authorizedSchoolId,
    deniedMessage: "EduClock staff management is restricted to the school Owner",
  });
  if (!decision.allowed) {
    throw new EduClockError("EDUCLOCK_FORBIDDEN", decision.status, decision.error);
  }
  return decision.auth;
}

void requireOwnerAuth;

function sendEduClockError(res: { status: (n: number) => { json: (b: unknown) => unknown } }, err: unknown) {
  if (err instanceof EduClockError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  console.error("[educlock] unexpected error", err instanceof Error ? err.message : "unknown");
  return res.status(500).json({ error: "EduClock request failed", code: "EDUCLOCK_INTERNAL" });
}

/** Reject client identity/school override fields on activation. */
function rejectClientIdentityFields(body: Record<string, unknown> | undefined): string | null {
  if (!body || typeof body !== "object") return null;
  for (const key of ["userId", "employeeId", "employeeNumber", "schoolId", "staffId"]) {
    if (body[key] !== undefined && body[key] !== null && String(body[key]).trim() !== "") {
      return key;
    }
  }
  return null;
}

router.get("/me", async (req, res) => {
  try {
    const auth = await requireStaffAuth(req);
    const me = await getEduClockMe({
      userId: auth.userId,
      schoolId: auth.authorizedSchoolId,
    });
    return res.json(me);
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

router.post("/activate", async (req, res) => {
  try {
    const auth = await requireStaffAuth(req);
    const rejected = rejectClientIdentityFields(req.body);
    if (rejected) {
      return res.status(400).json({
        error: "Client may not supply identity or school override fields.",
        code: "EDUCLOCK_IDENTITY_INVALID",
      });
    }

    const result = await activateEduClock({
      userId: auth.userId,
      schoolId: auth.authorizedSchoolId,
      identityType: req.body?.identityType,
      identityNumber: req.body?.identityNumber,
      identityCountryCode: req.body?.identityCountryCode,
    });
    return res.json(result);
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

router.get("/owner/staff", async (req, res) => {
  try {
    const auth = await requireEduClockManage(req);
    const staff = await listOwnerEduClockStaff(auth.authorizedSchoolId);
    const unlinkedEmployees = await prisma.employee.findMany({
      where: { schoolId: auth.authorizedSchoolId, userId: null },
      select: {
        id: true,
        employeeNumber: true,
        firstName: true,
        lastName: true,
        fullName: true,
        isActive: true,
        identityType: true,
        idNumber: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });

    return res.json({
      schoolId: auth.authorizedSchoolId,
      staff,
      unlinkedEmployees: unlinkedEmployees.map((e) => ({
        employeeId: e.id,
        employeeNumber: e.employeeNumber,
        employeeName: e.fullName || `${e.firstName} ${e.lastName}`.trim(),
        isActive: e.isActive,
        identityType: e.identityType,
        identityMasked: e.idNumber ? maskIdentityNumber(e.idNumber) : null,
        hasIdentityDocument: Boolean(String(e.idNumber || "").trim()),
      })),
    });
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

router.post("/owner/staff/:userId/reset", async (req, res) => {
  try {
    const auth = await requireEduClockManage(req);
    const result = await ownerResetActivation({
      schoolId: auth.authorizedSchoolId,
      actorUserId: auth.userId,
      userId: String(req.params.userId || ""),
    });
    return res.json(result);
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

router.post("/owner/staff/:userId/unlink", async (req, res) => {
  try {
    const auth = await requireEduClockManage(req);
    const result = await ownerUnlink({
      schoolId: auth.authorizedSchoolId,
      actorUserId: auth.userId,
      userId: String(req.params.userId || ""),
    });
    return res.json(result);
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

router.post("/owner/staff/:userId/link", async (req, res) => {
  try {
    const auth = await requireEduClockManage(req);
    const employeeId = String(req.body?.employeeId || "").trim();
    if (!employeeId) {
      return res.status(400).json({
        error: "employeeId is required for manual link.",
        code: "EDUCLOCK_IDENTITY_INVALID",
      });
    }
    const result = await ownerManualLink({
      schoolId: auth.authorizedSchoolId,
      actorUserId: auth.userId,
      userId: String(req.params.userId || ""),
      employeeId,
    });
    return res.json(result);
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

router.get("/owner/readiness", async (req, res) => {
  try {
    const auth = await requireEduClockManage(req);
    const readiness = await getOwnerEduClockReadiness(auth.authorizedSchoolId);
    return res.json(readiness);
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

router.post("/owner/employees/numbers", async (req, res) => {
  try {
    const auth = await requireEduClockManage(req);
    const updates = Array.isArray(req.body?.updates) ? req.body.updates : [];
    const result = await ownerBulkUpdateEmployeeNumbers({
      schoolId: auth.authorizedSchoolId,
      actorUserId: auth.userId,
      updates,
    });
    return res.json(result);
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

router.get("/owner/campuses", async (req, res) => {
  try {
    const auth = await requireEduClockManage(req);
    const data = await listEduClockCampuses(auth.authorizedSchoolId);
    return res.json({ schoolId: auth.authorizedSchoolId, ...data });
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

router.post("/owner/campuses", async (req, res) => {
  try {
    const auth = await requireEduClockManage(req);
    const campus = await createEduClockCampus({
      schoolId: auth.authorizedSchoolId,
      actorUserId: auth.userId,
      name: String(req.body?.name || ""),
      description: req.body?.description == null ? null : String(req.body.description),
      timezone: req.body?.timezone == null ? null : String(req.body.timezone),
      toleranceMetres:
        req.body?.toleranceMetres == null ? null : Number(req.body.toleranceMetres),
    });
    return res.status(201).json(campus);
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

router.patch("/owner/campuses/:campusId", async (req, res) => {
  try {
    const auth = await requireEduClockManage(req);
    const campus = await updateEduClockCampus({
      schoolId: auth.authorizedSchoolId,
      actorUserId: auth.userId,
      campusId: String(req.params.campusId || ""),
      name: req.body?.name === undefined ? undefined : String(req.body.name),
      description: req.body?.description === undefined ? undefined : (req.body.description == null ? null : String(req.body.description)),
      timezone: req.body?.timezone === undefined ? undefined : String(req.body.timezone),
      toleranceMetres:
        req.body?.toleranceMetres === undefined ? undefined : Number(req.body.toleranceMetres),
      isActive: typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined,
    });
    return res.json(campus);
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

router.post("/owner/campuses/:campusId/entrances", async (req, res) => {
  try {
    const auth = await requireEduClockManage(req);
    const entrance = await createEduClockEntrance({
      schoolId: auth.authorizedSchoolId,
      actorUserId: auth.userId,
      campusId: String(req.params.campusId || ""),
      name: String(req.body?.name || ""),
      description: req.body?.description == null ? null : String(req.body.description),
      entranceType: req.body?.entranceType,
      customTypeLabel: req.body?.customTypeLabel,
      captureAccuracyMetres: req.body?.captureAccuracyMetres,
      latitude: req.body?.latitude,
      longitude: req.body?.longitude,
      allowedRadiusMetres: req.body?.allowedRadiusMetres,
      isActive: typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined,
      confirmOutsideBoundary: Boolean(req.body?.confirmOutsideBoundary),
    });
    return res.status(201).json(entrance);
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

router.patch("/owner/entrances/:entranceId", async (req, res) => {
  try {
    const auth = await requireEduClockManage(req);
    const entrance = await updateEduClockEntrance({
      schoolId: auth.authorizedSchoolId,
      actorUserId: auth.userId,
      entranceId: String(req.params.entranceId || ""),
      name: req.body?.name === undefined ? undefined : String(req.body.name),
      description:
        req.body?.description === undefined
          ? undefined
          : req.body.description == null
            ? null
            : String(req.body.description),
      entranceType: req.body?.entranceType,
      customTypeLabel: req.body?.customTypeLabel,
      captureAccuracyMetres: req.body?.captureAccuracyMetres,
      isActive: typeof req.body?.isActive === "boolean" ? req.body.isActive : undefined,
      latitude: req.body?.latitude,
      longitude: req.body?.longitude,
      allowedRadiusMetres: req.body?.allowedRadiusMetres,
      confirmOutsideBoundary: Boolean(req.body?.confirmOutsideBoundary),
    });
    return res.json(entrance);
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

/* ─── Build 3: staff clock lifecycle (no client schoolId/employeeId) ─── */

router.get("/me/status", async (req, res) => {
  try {
    const auth = await requireStaffAuth(req);
    const status = await getStaffClockStatus({
      userId: auth.userId,
      schoolId: auth.authorizedSchoolId,
    });
    return res.json(status);
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

router.post("/me/clock-in", async (req, res) => {
  try {
    const auth = await requireStaffAuth(req);
    const idem =
      String(req.headers["idempotency-key"] || req.body?.idempotencyKey || "").trim() || null;
    const result = await staffClockIn({
      userId: auth.userId,
      schoolId: auth.authorizedSchoolId,
      idempotencyKey: idem,
      body: req.body,
    });
    return res.status(201).json(result);
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

router.post("/me/clock-out", async (req, res) => {
  try {
    const auth = await requireStaffAuth(req);
    const idem =
      String(req.headers["idempotency-key"] || req.body?.idempotencyKey || "").trim() || null;
    const result = await staffClockOut({
      userId: auth.userId,
      schoolId: auth.authorizedSchoolId,
      idempotencyKey: idem,
      body: req.body,
    });
    return res.json(result);
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

router.get("/me/history", async (req, res) => {
  try {
    const auth = await requireStaffAuth(req);
    const history = await getStaffClockHistory({
      userId: auth.userId,
      schoolId: auth.authorizedSchoolId,
    });
    return res.json(history);
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

router.get("/owner/attendance", async (req, res) => {
  try {
    const auth = await requireEduClockManage(req);
    const data = await getOwnerAttendance({
      schoolId: auth.authorizedSchoolId,
      schoolLocalDate: req.query?.schoolLocalDate
        ? String(req.query.schoolLocalDate)
        : undefined,
      search: req.query?.search ? String(req.query.search) : undefined,
      status: req.query?.status ? String(req.query.status) : undefined,
      page: req.query?.page != null ? Number(req.query.page) : 0,
      pageSize: req.query?.pageSize != null ? Number(req.query.pageSize) : 25,
    });
    return res.json(data);
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

router.get("/owner/exceptions", async (req, res) => {
  try {
    const auth = await requireEduClockManage(req);
    const data = await getOwnerExceptions({
      schoolId: auth.authorizedSchoolId,
      schoolLocalDate: req.query?.schoolLocalDate
        ? String(req.query.schoolLocalDate)
        : undefined,
      status: req.query?.status ? String(req.query.status) : undefined,
      page: req.query?.page != null ? Number(req.query.page) : 0,
      pageSize: req.query?.pageSize != null ? Number(req.query.pageSize) : 25,
    });
    return res.json(data);
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

router.get("/owner/events/:eventId", async (req, res) => {
  try {
    const auth = await requireEduClockManage(req);
    const data = await getOwnerEvent({
      schoolId: auth.authorizedSchoolId,
      eventId: String(req.params.eventId || ""),
    });
    return res.json(data);
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

router.post("/owner/corrections", async (req, res) => {
  try {
    const auth = await requireEduClockManage(req);
    const result = await ownerCreateCorrection({
      schoolId: auth.authorizedSchoolId,
      actorUserId: auth.userId,
      employeeId: String(req.body?.employeeId || ""),
      action: String(req.body?.action || "") as
        | "ADD_CLOCK_IN"
        | "ADD_CLOCK_OUT"
        | "CORRECT_TIME"
        | "CLOSE_OPEN_SHIFT",
      reason: String(req.body?.reason || ""),
      note: req.body?.note == null ? null : String(req.body.note),
      schoolLocalDate: String(req.body?.schoolLocalDate || ""),
      schoolLocalTime: String(req.body?.schoolLocalTime || ""),
      targetEventId: req.body?.targetEventId == null ? null : String(req.body.targetEventId),
    });
    return res.status(201).json(result);
  } catch (err) {
    return sendEduClockError(res, err);
  }
});

export default router;
