/**
 * Staff Online Admissions API (OA-03A settings + OA-03F inbox/detail/download).
 * Tenant = JWT → DB authorizedSchoolId. Client schoolId never authoritative.
 */
import { Router } from "express";
import path from "path";

import {
  requireAdmissionsSettingsAuth,
  type AdmissionsSettingsAuthRequest,
} from "../middleware/requireAdmissionsSettingsAuth";
import { prisma } from "../prisma";
import {
  canViewAdmissionsMedicalDetails,
  canViewAdmissionsStaffNotes,
} from "../services/admissions/admissionsDecisionAuth";
import { sanitizeOriginalFileName } from "../services/admissions/admissionsFileValidation";
import {
  AdmissionsSettingsConflictError,
  AdmissionsSettingsValidationError,
  getSchoolAdmissionsSettings,
  upsertSchoolAdmissionsSettings,
} from "../services/admissions/schoolAdmissionsSettingsService";
import {
  getStaffApplicationDetail,
  listStaffApplications,
  openStaffApplicationDocumentForDownload,
  StaffAdmissionsError,
} from "../services/admissions/staffAdmissionsReadService";
import {
  acceptAdmissionApplication,
  rejectAdmissionApplication,
  rejectAdmissionProofOfPayment,
  requestApplicationInfo,
  resumeApplicationReview,
  startApplicationReview,
  verifyAdmissionPayment,
  waiveAdmissionFee,
  type StaffWorkflowActor,
} from "../services/admissions/staffAdmissionsWorkflowService";
import { hasPermission, resolveStoredPermissions } from "../utils/userPermissions";

const router = Router();

function sendStaffAdmissionsError(res: import("express").Response, err: unknown, fallback: string) {
  if (err instanceof StaffAdmissionsError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
    });
  }
  if (err instanceof AdmissionsSettingsValidationError) {
    return res.status(err.statusCode).json({ success: false, error: err.message });
  }
  if (err instanceof AdmissionsSettingsConflictError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
    });
  }
  console.error(fallback, err);
  return res.status(500).json({ success: false, error: fallback });
}

function queryBool(value: unknown): boolean {
  const s = String(value ?? "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function admissionsCapabilityFlags(auth: NonNullable<AdmissionsSettingsAuthRequest["admissionsSettingsAuth"]>) {
  const permissions = resolveStoredPermissions(auth.appRole, auth.permissions);
  const permUser = { appRole: auth.appRole, isActive: true, permissions };
  const hasManage = hasPermission(permUser, "admissions", "manage");
  const hasEdit = hasPermission(permUser, "admissions", "edit");
  return {
    includeMedicalDetails: canViewAdmissionsMedicalDetails(hasManage),
    includeStaffNotes: canViewAdmissionsStaffNotes(hasEdit || hasManage),
  };
}

function workflowActorFromReq(req: AdmissionsSettingsAuthRequest): StaffWorkflowActor {
  const auth = req.admissionsSettingsAuth!;
  const permissions = resolveStoredPermissions(auth.appRole, auth.permissions);
  const permUser = { appRole: auth.appRole, isActive: true, permissions };
  return {
    userId: auth.userId,
    schoolId: auth.authorizedSchoolId,
    appRole: auth.appRole,
    hasAdmissionsEdit: hasPermission(permUser, "admissions", "edit"),
    hasAdmissionsManage: hasPermission(permUser, "admissions", "manage"),
  };
}

function bodyObject(req: import("express").Request): Record<string, unknown> {
  return (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
}

router.get(
  "/settings",
  requireAdmissionsSettingsAuth("view"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const schoolId = req.admissionsSettingsAuth!.authorizedSchoolId;
      const settings = await getSchoolAdmissionsSettings(prisma, schoolId);
      return res.json({ success: true, settings });
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to load admissions settings");
    }
  }
);

router.put(
  "/settings",
  requireAdmissionsSettingsAuth("manage"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const schoolId = req.admissionsSettingsAuth!.authorizedSchoolId;
      const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
        string,
        unknown
      >;
      const settings = await upsertSchoolAdmissionsSettings(prisma, schoolId, body);
      // Intentionally do not log bank fields.
      return res.json({ success: true, settings });
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to save admissions settings");
    }
  }
);

/**
 * GET /api/admissions/applications — staff inbox (read-only).
 * Query: status, paymentStatus, requestedGrade, intakeYear, q, submittedFrom, submittedTo,
 * includeDrafts, page, pageSize.
 */
router.get(
  "/applications",
  requireAdmissionsSettingsAuth("view"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const schoolId = req.admissionsSettingsAuth!.authorizedSchoolId;
      const result = await listStaffApplications(prisma, schoolId, {
        status: req.query.status as string | undefined,
        paymentStatus: req.query.paymentStatus as string | undefined,
        requestedGrade: req.query.requestedGrade as string | undefined,
        intakeYear:
          req.query.intakeYear != null && String(req.query.intakeYear).trim() !== ""
            ? Number(req.query.intakeYear)
            : null,
        q: req.query.q as string | undefined,
        submittedFrom: req.query.submittedFrom as string | undefined,
        submittedTo: req.query.submittedTo as string | undefined,
        includeDrafts: queryBool(req.query.includeDrafts),
        page: req.query.page != null ? Number(req.query.page) : undefined,
        pageSize: req.query.pageSize != null ? Number(req.query.pageSize) : undefined,
      });
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        success: true,
        items: result.items,
        total: result.total,
        page: result.page,
        pageSize: result.pageSize,
      });
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to list admissions applications");
    }
  }
);

/**
 * GET /api/admissions/applications/:applicationId — staff detail (read-only).
 * Medical fields require admissions.manage. Staff notes require admissions.edit or manage.
 * Query includeStaffNotes=true never grants notes access.
 */
router.get(
  "/applications/:applicationId",
  requireAdmissionsSettingsAuth("view"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const schoolId = req.admissionsSettingsAuth!.authorizedSchoolId;
      const caps = admissionsCapabilityFlags(req.admissionsSettingsAuth!);
      const application = await getStaffApplicationDetail(
        prisma,
        schoolId,
        String(req.params.applicationId || ""),
        {
          includeMedicalDetails: caps.includeMedicalDetails,
          includeStaffNotes: caps.includeStaffNotes,
        }
      );
      res.setHeader("Cache-Control", "no-store");
      return res.json({ success: true, application });
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to load admissions application");
    }
  }
);

/**
 * GET /api/admissions/applications/:applicationId/documents/:documentId/download
 * Authenticated staff stream of private Admissions file (active docs only).
 */
router.get(
  "/applications/:applicationId/documents/:documentId/download",
  requireAdmissionsSettingsAuth("view"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const schoolId = req.admissionsSettingsAuth!.authorizedSchoolId;
      const file = await openStaffApplicationDocumentForDownload(
        prisma,
        schoolId,
        String(req.params.applicationId || ""),
        String(req.params.documentId || "")
      );
      const safeName = sanitizeOriginalFileName(file.originalFileName);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", file.contentType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${path.basename(safeName).replace(/"/g, "")}"`
      );
      // Do not put storageKey / absolute path in headers or body.
      return res.sendFile(file.absolutePath);
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to download admissions document");
    }
  }
);

/** OA-03G workflow — admissions.edit */
router.post(
  "/applications/:applicationId/start-review",
  requireAdmissionsSettingsAuth("edit"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const result = await startApplicationReview(
        prisma,
        workflowActorFromReq(req),
        String(req.params.applicationId || "")
      );
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        success: true,
        action: result.action,
        idempotent: result.idempotent,
        application: result.application,
      });
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to start admissions review");
    }
  }
);

router.post(
  "/applications/:applicationId/request-info",
  requireAdmissionsSettingsAuth("edit"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const body = bodyObject(req);
      const result = await requestApplicationInfo(
        prisma,
        workflowActorFromReq(req),
        String(req.params.applicationId || ""),
        {
          message: body.message as string | undefined,
          internalNote: body.internalNote as string | undefined,
        }
      );
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        success: true,
        action: result.action,
        idempotent: result.idempotent,
        application: result.application,
      });
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to request admissions information");
    }
  }
);

router.post(
  "/applications/:applicationId/resume-review",
  requireAdmissionsSettingsAuth("edit"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const result = await resumeApplicationReview(
        prisma,
        workflowActorFromReq(req),
        String(req.params.applicationId || "")
      );
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        success: true,
        action: result.action,
        idempotent: result.idempotent,
        application: result.application,
      });
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to resume admissions review");
    }
  }
);

/** OA-03G payment — route requires edit; service enforces canAdministerAdmissionPayment */
router.post(
  "/applications/:applicationId/payment/verify",
  requireAdmissionsSettingsAuth("edit"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const result = await verifyAdmissionPayment(
        prisma,
        workflowActorFromReq(req),
        String(req.params.applicationId || "")
      );
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        success: true,
        action: result.action,
        idempotent: result.idempotent,
        application: result.application,
      });
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to verify admissions payment");
    }
  }
);

router.post(
  "/applications/:applicationId/payment/reject",
  requireAdmissionsSettingsAuth("edit"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const body = bodyObject(req);
      const result = await rejectAdmissionProofOfPayment(
        prisma,
        workflowActorFromReq(req),
        String(req.params.applicationId || ""),
        { reason: body.reason as string | undefined }
      );
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        success: true,
        action: result.action,
        idempotent: result.idempotent,
        application: result.application,
      });
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to reject admissions proof of payment");
    }
  }
);

router.post(
  "/applications/:applicationId/payment/waive",
  requireAdmissionsSettingsAuth("edit"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const body = bodyObject(req);
      const result = await waiveAdmissionFee(
        prisma,
        workflowActorFromReq(req),
        String(req.params.applicationId || ""),
        { reason: body.reason as string | undefined }
      );
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        success: true,
        action: result.action,
        idempotent: result.idempotent,
        application: result.application,
      });
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to waive admissions fee");
    }
  }
);

/** OA-03G final decisions — manage + Owner/Admin enforced in service */
router.post(
  "/applications/:applicationId/accept",
  requireAdmissionsSettingsAuth("manage"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const result = await acceptAdmissionApplication(
        prisma,
        workflowActorFromReq(req),
        String(req.params.applicationId || "")
      );
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        success: true,
        action: result.action,
        idempotent: result.idempotent,
        application: result.application,
      });
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to accept admissions application");
    }
  }
);

router.post(
  "/applications/:applicationId/reject",
  requireAdmissionsSettingsAuth("manage"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const body = bodyObject(req);
      const result = await rejectAdmissionApplication(
        prisma,
        workflowActorFromReq(req),
        String(req.params.applicationId || ""),
        { reason: body.reason as string | undefined }
      );
      res.setHeader("Cache-Control", "no-store");
      return res.json({
        success: true,
        action: result.action,
        idempotent: result.idempotent,
        application: result.application,
      });
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to reject admissions application");
    }
  }
);

export default router;
