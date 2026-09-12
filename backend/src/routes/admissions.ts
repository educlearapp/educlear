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
import { hasPermission, resolveStoredPermissions } from "../utils/userPermissions";

const router = Router();

function sendStaffAdmissionsError(res: import("express").Response, err: unknown, fallback: string) {
  if (err instanceof StaffAdmissionsError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
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

export default router;
