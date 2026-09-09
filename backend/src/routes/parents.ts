import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { lookupParentFeesBySaId, normalizeSaIdNumber } from "../services/parentFeeCheckService";
import {
  parentIdentityForCreate,
  parentIdentityForUpdate,
} from "../utils/parentIdentityPreservation";
import {
  buildParentIdConflictBody,
  findDuplicateParentSignal,
  findParentByIdNumber,
  isParentIdNumberUniqueTarget,
  PARENT_ID_CONFLICT_MESSAGE,
} from "../utils/parentIdConflict";
import {
  checkApplicationParentIdentity,
  linkExistingParentToLearner,
  ParentPossibleMatchError,
  requiresExplicitCreateConfirmation,
} from "../services/applicationParentIdentity";
import { ParentIdConflictError } from "../utils/parentIdConflict";
import { resolveParentStaffAuth } from "../middleware/requireParentStaffAuth";
import {
  formatDateOnlyUtc,
  OptionalProfileFieldError,
  parseOptionalDateOnlyField,
} from "../utils/optionalProfileFields";

const router = Router();
const prisma = new PrismaClient();

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanBool(value: unknown, fallback: boolean) {
  if (value === undefined || value === null) return fallback;
  return Boolean(value);
}

/** Strip Parent.birthDate from legacy unauthenticated list responses. */
export function mapParentForLegacyUnauthList<T extends { birthDate?: unknown }>(parent: T) {
  const { birthDate: _omitBirthDate, ...rest } = parent as T & { birthDate?: unknown };
  return rest;
}

function mapParentBirthDateForClient(parent: { birthDate?: Date | null }) {
  return {
    birthDate: formatDateOnlyUtc(parent.birthDate ?? null),
    dateOfBirth: formatDateOnlyUtc(parent.birthDate ?? null),
  };
}

/** GET /api/parents?schoolId= — school-scoped parent list for Add Learner / existing-parent picker. */
router.get("/", async (req, res) => {
  try {
    const schoolId = cleanString((req.query as { schoolId?: unknown })?.schoolId);
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }
    const parents = await prisma.parent.findMany({
      where: { schoolId },
      orderBy: [{ surname: "asc" }, { firstName: "asc" }],
    });
    // Legacy unauthenticated list must not newly expose Parent.birthDate.
    return res.json({
      success: true,
      parents: parents.map((p) => mapParentForLegacyUnauthList(p)),
    });
  } catch (error: unknown) {
    console.error("LIST PARENTS ERROR:", error);
    return res.status(500).json({ success: false, error: "Failed to list parents" });
  }
});

/**
 * GET /api/parents/fee-check/:idNumber — controlled cross-school guardian ID fee lookup.
 * Owner/Admin only. Unauthenticated / unauthorized requests must not receive debt/PII.
 * Cross-school rows minimize parent/learner PII; home-school rows keep full detail.
 */
router.get("/fee-check/:idNumber", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");

  const raw = cleanString(req.params?.idNumber);
  const normalizedId = normalizeSaIdNumber(raw);

  try {
    const authDecision = await resolveParentStaffAuth(req, {
      requireOwnerAdmin: true,
    });
    if (!authDecision.allowed) {
      return res.status(authDecision.status).json({
        success: false,
        found: false,
        normalizedId,
        error: authDecision.error,
        message: authDecision.error,
        code: authDecision.code || null,
        results: [],
        totalOutstanding: 0,
        status: "GREEN",
      });
    }
    const staffAuth = authDecision.auth;

    console.info("[fee-check] lookup", {
      rawInput: raw,
      normalizedId,
      viewerSchoolId: staffAuth.authorizedSchoolId,
      actorUserId: staffAuth.userId,
    });

    if (!normalizedId || normalizedId.length < 6) {
      return res.status(400).json({
        found: false,
        normalizedId,
        error: "Enter a valid South African ID number (at least 6 digits)",
        results: [],
        totalOutstanding: 0,
        status: "GREEN",
      });
    }

    const payload = await lookupParentFeesBySaId(normalizedId, {
      viewerSchoolId: staffAuth.authorizedSchoolId,
    });

    console.info("[fee-check] result", {
      normalizedId: payload.normalizedId,
      found: payload.found,
      matchCount: payload.results.length,
      totalOutstanding: payload.totalOutstanding,
      viewerSchoolId: staffAuth.authorizedSchoolId,
    });

    if (!payload.found) {
      return res.json({
        ...payload,
        school: null,
        parentName: null,
        outstandingAmount: 0,
        message: "No record found",
      });
    }

    const primary = payload.results[0];
    return res.json({
      ...payload,
      school: primary.schoolName,
      parentName: primary.parentName,
      outstandingAmount: payload.totalOutstanding,
      message: null,
    });
  } catch (error: unknown) {
    console.error("PARENT FEE CHECK ERROR:", { rawInput: raw, normalizedId, error });
    return res.status(500).json({
      found: false,
      normalizedId,
      error: "Fee check failed. Please try again.",
      results: [],
      totalOutstanding: 0,
      status: "GREEN",
    });
  }
});

/**
 * GET /api/parents/id-ownership?idNumber=&excludeParentId=&cellNo=&email=
 * Authenticated staff only. Uniqueness is school-scoped — same SA ID at another school
 * does not block create and must not leak other-school PII.
 */
router.get("/id-ownership", async (req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  try {
    const authDecision = await resolveParentStaffAuth(req, {
      requirePermission: { module: "parents", action: "view" },
    });
    if (!authDecision.allowed) {
      return res.status(authDecision.status).json({
        success: false,
        message: authDecision.error,
        code: authDecision.code || null,
      });
    }
    const staffAuth = authDecision.auth;

    const idNumber = cleanString(req.query?.idNumber);
    if (!idNumber) {
      return res.status(400).json({ success: false, message: "Missing idNumber" });
    }

    const excludeParentId = cleanString(req.query?.excludeParentId) || null;
    const cellNo = cleanString(req.query?.cellNo) || null;
    const email = cleanString(req.query?.email) || null;

    const existingParent = await findParentByIdNumber(
      prisma,
      idNumber,
      staffAuth.authorizedSchoolId
    );
    const ownedByOther =
      Boolean(existingParent) &&
      (!excludeParentId || existingParent!.id !== excludeParentId);

    const sameSchoolAccessible =
      ownedByOther && existingParent && staffAuth.isOwnerAdmin;

    let warning = null as Awaited<ReturnType<typeof findDuplicateParentSignal>>;
    if (staffAuth.isOwnerAdmin) {
      warning = await findDuplicateParentSignal({
        prisma,
        schoolId: staffAuth.authorizedSchoolId,
        idNumber,
        excludeParentId,
        cellNo,
        email,
      });
    }

    return res.json({
      success: true,
      idNumber,
      owned: ownedByOther,
      ownedByOther,
      accessible: Boolean(sameSchoolAccessible),
      existingParent: sameSchoolAccessible ? existingParent : null,
      warning,
      conflictMessage: ownedByOther ? PARENT_ID_CONFLICT_MESSAGE : null,
    });
  } catch (error: unknown) {
    console.error("PARENT ID OWNERSHIP ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to look up parent ID ownership",
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const authDecision = await resolveParentStaffAuth(req, {
      requirePermission: { module: "parents", action: "create" },
    });
    if (!authDecision.allowed) {
      return res.status(authDecision.status).json({
        success: false,
        message: authDecision.error,
        code: authDecision.code || null,
      });
    }
    const staffAuth = authDecision.auth;
    const schoolId = staffAuth.authorizedSchoolId;

    const identity = parentIdentityForCreate(req.body || {});
    const confirmCreateDespiteMatch = Boolean(
      req.body?.confirmCreateDespiteMatch === true ||
        req.body?.confirmCreateDespiteMatch === "true"
    );

    const identityCheck = await checkApplicationParentIdentity({
      prisma,
      schoolId,
      incoming: {
        firstName: cleanString(req.body?.firstName),
        surname: cleanString(req.body?.surname),
        idNumber: identity.idNumber || req.body?.idNumber,
        cellNo: cleanString(req.body?.cellNo || req.body?.cell || req.body?.phone),
        email: identity.email || req.body?.email,
        relationship: cleanString(req.body?.relationship),
      },
      excludeParentId: null,
      actorIsOwnerAdmin: staffAuth.isOwnerAdmin,
    });

    if (identityCheck.decision === "EXISTING_PARENT_MATCH") {
      const body = identityCheck.existingParent
        ? {
            success: false as const,
            code: "PARENT_ID_ALREADY_EXISTS" as const,
            message: identityCheck.message,
            idNumber: identity.idNumber || cleanString(req.body?.idNumber),
            existingParent: identityCheck.existingParent,
          }
        : await buildParentIdConflictBody(
            prisma,
            identity.idNumber || cleanString(req.body?.idNumber),
            schoolId
          );
      return res.status(409).json(body);
    }

    if (
      identityCheck.decision === "POSSIBLE_MATCH" &&
      requiresExplicitCreateConfirmation(identityCheck)
    ) {
      if (!confirmCreateDespiteMatch) {
        throw new ParentPossibleMatchError(identityCheck);
      }
      if (!staffAuth.isOwnerAdmin) {
        return res.status(403).json({
          success: false,
          code: "FORBIDDEN_CREATE_DESPITE_MATCH",
          message: "Only Owner/Admin may create a parent despite a strong possible match.",
        });
      }
    }

    const birthDate =
      req.body?.birthDate !== undefined || req.body?.dateOfBirth !== undefined
        ? parseOptionalDateOnlyField(
            req.body?.birthDate ?? req.body?.dateOfBirth,
            "birthDate"
          )
        : null;

    const parent = await prisma.parent.create({
      data: {
        schoolId,
        familyAccountId: cleanString(req.body?.familyAccountId) || null,
        relationship: cleanString(req.body?.relationship) || null,
        title: cleanString(req.body?.title) || null,
        firstName: cleanString(req.body?.firstName) || "Parent",
        surname: cleanString(req.body?.surname) || "-",
        nickname: cleanString(req.body?.nickname) || null,
        idNumber: identity.idNumber,
        birthDate,
        maritalStatus: cleanString(req.body?.maritalStatus) || null,
        notes: cleanString(req.body?.notes) || null,
        homeAddress: cleanString(req.body?.homeAddress) || null,
        homeNo: cleanString(req.body?.homeNo) || null,
        workNo: cleanString(req.body?.workNo || req.body?.work) || null,
        cellNo: cleanString(req.body?.cellNo || req.body?.cell || req.body?.phone) || "-",
        faxNo: cleanString(req.body?.faxNo) || null,
        email: identity.email,
        communicationAdministration: cleanBool(req.body?.communicationAdministration, true),
        communicationBilling: cleanBool(req.body?.communicationBilling, true),
        communicationByEmail: cleanBool(req.body?.communicationByEmail, true),
        communicationByPrint: cleanBool(req.body?.communicationByPrint, true),
        communicationBySMS: cleanBool(req.body?.communicationBySMS, true),
      },
    });

    return res.json({
      success: true,
      parent: { ...parent, ...mapParentBirthDateForClient(parent) },
      identityDecision: identityCheck.decision,
      identityWarning:
        identityCheck.decision === "CONFLICT" || identityCheck.decision === "POSSIBLE_MATCH"
          ? identityCheck.message
          : null,
    });
  } catch (error: unknown) {
    console.error("CREATE PARENT ERROR:", error);
    if (error instanceof OptionalProfileFieldError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error instanceof ParentPossibleMatchError) {
      return res.status(409).json(error.body);
    }
    if (error instanceof ParentIdConflictError) {
      return res.status(409).json(error.body);
    }
    if (isParentIdNumberUniqueTarget(error)) {
      const idNumber =
        parentIdentityForCreate(req.body || {}).idNumber || cleanString(req.body?.idNumber);
      const authForConflict = await resolveParentStaffAuth(req, {
        requirePermission: { module: "parents", action: "create" },
      });
      const body = await buildParentIdConflictBody(
        prisma,
        idNumber || "",
        authForConflict.allowed ? authForConflict.auth.authorizedSchoolId : undefined
      );
      return res.status(409).json(body);
    }
    const err = error as { message?: string; code?: string; meta?: unknown };
    return res.status(500).json({
      success: false,
      message: "Failed to create parent",
      error: String(err?.message || error),
      code: err?.code || null,
      meta: err?.meta || null,
    });
  }
});

/**
 * POST /api/parents/link-to-learner
 * Trusted Owner/Admin only (staff JWT + DB role). Client role headers are ignored.
 */
router.post("/link-to-learner", async (req, res) => {
  try {
    const authDecision = await resolveParentStaffAuth(req, {
      requireOwnerAdmin: true,
    });
    if (!authDecision.allowed) {
      return res.status(authDecision.status).json({
        success: false,
        code: authDecision.code || null,
        message: authDecision.error,
      });
    }
    const staffAuth = authDecision.auth;
    const schoolId = staffAuth.authorizedSchoolId;
    const parentId = cleanString(req.body?.parentId);
    const learnerId = cleanString(req.body?.learnerId);

    const result = await linkExistingParentToLearner({
      prisma,
      schoolId,
      parentId,
      learnerId,
      relation: cleanString(req.body?.relation || req.body?.relationship) || null,
      isPrimary: req.body?.isPrimary !== undefined ? Boolean(req.body.isPrimary) : true,
      actorIsOwnerAdmin: true,
    });
    return res.json(result);
  } catch (error: unknown) {
    const err = error as { statusCode?: number; code?: string; message?: string };
    const status = err.statusCode || 500;
    return res.status(status).json({
      success: false,
      code: err.code || null,
      message: err.message || "Failed to link parent",
    });
  }
});

/**
 * POST /api/parents/identity-check — soft/hard identity preview (no writes).
 * Bound to authenticated school. Rich candidate details for Owner/Admin only.
 */
router.post("/identity-check", async (req, res) => {
  try {
    const authDecision = await resolveParentStaffAuth(req, {
      requirePermission: { module: "parents", action: "view" },
    });
    if (!authDecision.allowed) {
      return res.status(authDecision.status).json({
        success: false,
        message: authDecision.error,
        code: authDecision.code || null,
      });
    }
    const staffAuth = authDecision.auth;
    const schoolId = staffAuth.authorizedSchoolId;

    const result = await checkApplicationParentIdentity({
      prisma,
      schoolId,
      incoming: {
        firstName: cleanString(req.body?.firstName),
        surname: cleanString(req.body?.surname),
        idNumber: req.body?.idNumber,
        cellNo: cleanString(req.body?.cellNo || req.body?.cell || req.body?.phone),
        email: req.body?.email,
        relationship: cleanString(req.body?.relationship),
      },
      excludeParentId: cleanString(req.body?.excludeParentId) || null,
      actorIsOwnerAdmin: staffAuth.isOwnerAdmin,
    });

    if (!staffAuth.isOwnerAdmin) {
      return res.json({
        success: true,
        decision: result.decision,
        code: result.code,
        message: result.message,
        confidence: result.confidence,
        existingParent: null,
        candidates: [],
        allowExplicitCreate: false,
        allowLinkExisting: false,
      });
    }

    return res.json({ success: true, ...result });
  } catch (error: unknown) {
    const err = error as { message?: string };
    return res.status(500).json({
      success: false,
      message: err.message || "Identity check failed",
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = cleanString(req.params?.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Missing parent id" });
    }

    const existing = await prisma.parent.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Parent not found" });
    }

    const authDecision = await resolveParentStaffAuth(req, {
      requestSchoolId: existing.schoolId,
      requirePermission: { module: "parents", action: "edit" },
    });
    if (!authDecision.allowed) {
      return res.status(authDecision.status).json({
        success: false,
        message: authDecision.error,
        code: authDecision.code || null,
      });
    }
    if (existing.schoolId !== authDecision.auth.authorizedSchoolId) {
      return res.status(403).json({
        success: false,
        message: "Parent is not in your school",
        code: "SCHOOL_MISMATCH",
      });
    }

    const identityUpdate = parentIdentityForUpdate(req.body || {});
    const identityCheck = await checkApplicationParentIdentity({
      prisma,
      schoolId: existing.schoolId,
      incoming: {
        firstName: cleanString(req.body?.firstName) || existing.firstName,
        surname: cleanString(req.body?.surname || req.body?.lastName) || existing.surname,
        idNumber:
          identityUpdate.idNumber !== undefined ? identityUpdate.idNumber : existing.idNumber,
        cellNo:
          req.body?.cellNo !== undefined
            ? cleanString(req.body.cellNo || req.body.cell || req.body.phone)
            : existing.cellNo,
        email: identityUpdate.email !== undefined ? identityUpdate.email : existing.email,
      },
      excludeParentId: id,
      actorIsOwnerAdmin: authDecision.auth.isOwnerAdmin,
    });
    if (identityCheck.decision === "EXISTING_PARENT_MATCH") {
      const body = identityCheck.existingParent
        ? {
            success: false as const,
            code: "PARENT_ID_ALREADY_EXISTS" as const,
            message: identityCheck.message,
            idNumber: String(
              identityUpdate.idNumber || identityCheck.existingParent.idNumber || ""
            ),
            existingParent: identityCheck.existingParent,
          }
        : await buildParentIdConflictBody(
            prisma,
            String(identityUpdate.idNumber || req.body?.idNumber || ""),
            existing.schoolId
          );
      return res.status(409).json(body);
    }

    let birthDateUpdate: Date | null | undefined = undefined;
    if (req.body?.birthDate !== undefined || req.body?.dateOfBirth !== undefined) {
      birthDateUpdate = parseOptionalDateOnlyField(
        req.body?.birthDate ?? req.body?.dateOfBirth,
        "birthDate"
      );
    }

    const parent = await prisma.parent.update({
      where: { id },
      data: {
        ...(req.body?.relationship !== undefined && {
          relationship: cleanString(req.body.relationship) || null,
        }),
        ...(req.body?.title !== undefined && { title: cleanString(req.body.title) || null }),
        ...(req.body?.firstName !== undefined && {
          firstName: cleanString(req.body.firstName) || existing.firstName,
        }),
        ...(req.body?.surname !== undefined && {
          surname: cleanString(req.body.surname || req.body.lastName) || existing.surname,
        }),
        ...(identityUpdate.idNumber !== undefined && { idNumber: identityUpdate.idNumber }),
        ...(birthDateUpdate !== undefined && { birthDate: birthDateUpdate }),
        ...(req.body?.notes !== undefined && { notes: cleanString(req.body.notes) || null }),
        ...(req.body?.homeAddress !== undefined && {
          homeAddress: cleanString(req.body.homeAddress) || null,
        }),
        ...(req.body?.homeNo !== undefined && { homeNo: cleanString(req.body.homeNo) || null }),
        ...(req.body?.workNo !== undefined && {
          workNo: cleanString(req.body.workNo || req.body.work) || null,
        }),
        ...(req.body?.cellNo !== undefined && {
          cellNo: cleanString(req.body.cellNo || req.body.cell || req.body.phone) || existing.cellNo,
        }),
        ...(identityUpdate.email !== undefined && { email: identityUpdate.email }),
        ...(req.body?.communicationAdministration !== undefined && {
          communicationAdministration: cleanBool(req.body.communicationAdministration, true),
        }),
        ...(req.body?.communicationBilling !== undefined && {
          communicationBilling: cleanBool(req.body.communicationBilling, true),
        }),
        ...(req.body?.communicationByEmail !== undefined && {
          communicationByEmail: cleanBool(req.body.communicationByEmail, true),
        }),
        ...(req.body?.communicationByPrint !== undefined && {
          communicationByPrint: cleanBool(req.body.communicationByPrint, true),
        }),
        ...(req.body?.communicationBySMS !== undefined && {
          communicationBySMS: cleanBool(req.body.communicationBySMS, true),
        }),
      },
    });

    return res.json({
      success: true,
      parent: { ...parent, ...mapParentBirthDateForClient(parent) },
    });
  } catch (error: unknown) {
    console.error("UPDATE PARENT ERROR:", error);
    if (error instanceof OptionalProfileFieldError) {
      return res.status(400).json({ success: false, message: error.message });
    }
    if (error instanceof ParentIdConflictError) {
      return res.status(409).json(error.body);
    }
    if (isParentIdNumberUniqueTarget(error)) {
      const idNumber =
        parentIdentityForUpdate(req.body || {}).idNumber || cleanString(req.body?.idNumber);
      const existingForConflict = await prisma.parent.findUnique({
        where: { id: String(req.params?.id || "").trim() },
        select: { schoolId: true },
      });
      const body = await buildParentIdConflictBody(
        prisma,
        String(idNumber || ""),
        existingForConflict?.schoolId
      );
      return res.status(409).json(body);
    }
    const err = error as { message?: string };
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to update parent",
    });
  }
});

export default router;
