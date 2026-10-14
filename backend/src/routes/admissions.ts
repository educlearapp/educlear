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
  canMakeAdmissionDecision,
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
  convertAcceptedApplicationToLearner,
  getConversionPreflight,
  type ConversionActor,
} from "../services/admissions/admissionsConversionService";
import {
  getReactivationPreflight,
  reactivateHistoricalLearnerForApplication,
} from "../services/admissions/admissionsHistoricalReactivationService";
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
import {
  listActiveLegalDocuments,
  openStaffFinancialSignature,
  publishLegalDocument,
  toPublicFinancialDocument,
} from "../services/admissions/financialAgreementService";
import { PublicAdmissionsError } from "../services/admissions/publicAdmissionsConfig";
import {
  applicationFileBase,
  loadApplicationPdfModel,
  renderApplicationPdf,
} from "../services/admissions/admissionsApplicationPdfService";
import {
  buildCombinedPrintablePdf,
  createApplicationPackZipStream,
  listPackDocuments,
  recordAdmissionsDownloadAudit,
} from "../services/admissions/admissionsDocumentPackService";

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

/** OA-04B conversion: admissions.manage + learners.create + Owner/Admin. */
function conversionActorFromReq(req: AdmissionsSettingsAuthRequest): ConversionActor {
  const auth = req.admissionsSettingsAuth!;
  const permissions = resolveStoredPermissions(auth.appRole, auth.permissions);
  const permUser = { appRole: auth.appRole, isActive: true, permissions };
  return {
    userId: auth.userId,
    schoolId: auth.authorizedSchoolId,
    appRole: auth.appRole,
    hasAdmissionsManage: hasPermission(permUser, "admissions", "manage"),
    hasLearnersCreate: hasPermission(permUser, "learners", "create"),
  };
}

function requireConversionAuth(req: AdmissionsSettingsAuthRequest, res: import("express").Response): ConversionActor | null {
  const actor = conversionActorFromReq(req);
  if (!actor.hasAdmissionsManage) {
    res.status(403).json({
      success: false,
      error: "Admissions manage permission required for conversion",
      code: "ADMISSIONS_FORBIDDEN",
    });
    return null;
  }
  if (!actor.hasLearnersCreate) {
    res.status(403).json({
      success: false,
      error: "Learners create permission required for conversion",
      code: "LEARNERS_CREATE_FORBIDDEN",
    });
    return null;
  }
  if (!canMakeAdmissionDecision(actor.appRole)) {
    res.status(403).json({
      success: false,
      error: "Only Owner/Admin may convert accepted applications",
      code: "ADMISSIONS_DECISION_FORBIDDEN",
    });
    return null;
  }
  return actor;
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
      const financialDocuments = (
        await listActiveLegalDocuments(prisma, schoolId)
      ).map(toPublicFinancialDocument);
      return res.json({ success: true, settings: { ...settings, financialDocuments } });
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

router.post(
  "/settings/legal-documents",
  requireAdmissionsSettingsAuth("manage"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const schoolId = req.admissionsSettingsAuth!.authorizedSchoolId;
      const body = bodyObject(req);
      const document = await publishLegalDocument(prisma, schoolId, {
        kind: body.kind,
        versionLabel: body.versionLabel,
        title: body.title,
        body: body.body,
      });
      return res.status(201).json({
        success: true,
        document: toPublicFinancialDocument(document),
      });
    } catch (err) {
      if (err instanceof PublicAdmissionsError) {
        return res.status(err.statusCode).json({
          success: false,
          error: err.message,
          code: err.code,
        });
      }
      return sendStaffAdmissionsError(res, err, "Failed to publish financial document");
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
      const applicationId = String(req.params.applicationId || "");
      const documentId = String(req.params.documentId || "");
      const file = await openStaffApplicationDocumentForDownload(
        prisma,
        schoolId,
        applicationId,
        documentId
      );
      const inline = String(req.query.disposition || "") === "inline";
      await recordAdmissionsDownloadAudit(prisma, {
        schoolId,
        applicationId,
        actorUserId: req.admissionsSettingsAuth!.userId,
        eventType: inline ? "DOCUMENT_VIEWED" : "DOCUMENT_DOWNLOADED",
        metadata: { documentId },
      });
      const safeName = sanitizeOriginalFileName(file.originalFileName);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Type", file.contentType);
      res.setHeader(
        "Content-Disposition",
        `${inline ? "inline" : "attachment"}; filename="${path.basename(safeName).replace(/"/g, "")}"`
      );
      // Do not put storageKey / absolute path in headers or body.
      return res.sendFile(file.absolutePath);
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to download admissions document");
    }
  }
);

router.get(
  "/applications/:applicationId/financial-signature",
  requireAdmissionsSettingsAuth("view"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const schoolId = req.admissionsSettingsAuth!.authorizedSchoolId;
      const file = await openStaffFinancialSignature(
        prisma,
        schoolId,
        String(req.params.applicationId || "")
      );
      if (!file) {
        throw new StaffAdmissionsError("Signature not found", 404, "SIGNATURE_NOT_FOUND");
      }
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", file.contentType);
      res.setHeader("Content-Disposition", 'inline; filename="financial-signature.png"');
      return res.sendFile(file.absolutePath);
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to load financial signature");
    }
  }
);

/** Full application PDF / packs contain ID numbers and contacts — admissions edit or manage only. */
function requireApplicationPackAccess(
  req: AdmissionsSettingsAuthRequest,
  res: import("express").Response
): boolean {
  const auth = req.admissionsSettingsAuth!;
  const permissions = resolveStoredPermissions(auth.appRole, auth.permissions);
  const permUser = { appRole: auth.appRole, isActive: true, permissions };
  if (
    !hasPermission(permUser, "admissions", "edit") &&
    !hasPermission(permUser, "admissions", "manage")
  ) {
    res.status(403).json({
      success: false,
      error: "Admissions edit permission required to download the full application",
      code: "ADMISSIONS_FORBIDDEN",
    });
    return false;
  }
  return true;
}

async function buildApplicationPdfForRequest(req: AdmissionsSettingsAuthRequest, now: Date) {
  const auth = req.admissionsSettingsAuth!;
  const model = await loadApplicationPdfModel(
    prisma,
    auth.authorizedSchoolId,
    String(req.params.applicationId || ""),
    {
      includeMedicalDetails: admissionsCapabilityFlags(auth).includeMedicalDetails,
      now,
    }
  );
  const buffer = await renderApplicationPdf(model);
  return { model, buffer, base: applicationFileBase(model.detail) };
}

function sendDownloadHeaders(
  res: import("express").Response,
  contentType: string,
  fileName: string,
  disposition: "inline" | "attachment" = "attachment"
) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Type", contentType);
  res.setHeader("Content-Disposition", `${disposition}; filename="${fileName.replace(/"/g, "")}"`);
}

/** GET …/application.pdf — printable application (read-only; audited). */
router.get(
  "/applications/:applicationId/application.pdf",
  requireAdmissionsSettingsAuth("view"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      if (!requireApplicationPackAccess(req, res)) return;
      const auth = req.admissionsSettingsAuth!;
      const { model, buffer, base } = await buildApplicationPdfForRequest(req, new Date());
      await recordAdmissionsDownloadAudit(prisma, {
        schoolId: auth.authorizedSchoolId,
        applicationId: model.detail.id,
        actorUserId: auth.userId,
        eventType: "APPLICATION_PDF_GENERATED",
        metadata: { medicalIncluded: model.medicalIncluded, documentCount: model.documents.length },
      });
      sendDownloadHeaders(
        res,
        "application/pdf",
        `${base}_application.pdf`,
        String(req.query.disposition || "") === "inline" ? "inline" : "attachment"
      );
      return res.send(buffer);
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to generate application PDF");
    }
  }
);

/** GET …/application-combined.pdf — application + printable attachments in one PDF. */
router.get(
  "/applications/:applicationId/application-combined.pdf",
  requireAdmissionsSettingsAuth("view"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      if (!requireApplicationPackAccess(req, res)) return;
      const auth = req.admissionsSettingsAuth!;
      const { model, buffer, base } = await buildApplicationPdfForRequest(req, new Date());
      const pack = await listPackDocuments(prisma, auth.authorizedSchoolId, model.detail.id);
      const combined = await buildCombinedPrintablePdf({
        applicationRef: model.detail.applicationNumber || base,
        schoolName: model.school.name,
        applicationPdf: buffer,
        documents: pack.documents,
      });
      await recordAdmissionsDownloadAudit(prisma, {
        schoolId: auth.authorizedSchoolId,
        applicationId: model.detail.id,
        actorUserId: auth.userId,
        eventType: "APPLICATION_COMBINED_PDF_GENERATED",
        metadata: {
          medicalIncluded: model.medicalIncluded,
          attachmentsMerged: combined.outcomes.filter((o) => o.merged).length,
          attachmentsNotMerged: combined.outcomes.filter((o) => !o.merged).length,
        },
      });
      sendDownloadHeaders(
        res,
        "application/pdf",
        `${base}_application_complete.pdf`,
        String(req.query.disposition || "") === "inline" ? "inline" : "attachment"
      );
      return res.send(combined.buffer);
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to generate combined application PDF");
    }
  }
);

/**
 * GET …/documents.zip — all supporting documents + manifest.
 * GET …/application-pack.zip — application PDF + all supporting documents + manifest.
 */
for (const variant of ["documents", "application-pack"] as const) {
  router.get(
    `/applications/:applicationId/${variant}.zip`,
    requireAdmissionsSettingsAuth("view"),
    async (req: AdmissionsSettingsAuthRequest, res) => {
      try {
        if (!requireApplicationPackAccess(req, res)) return;
        const auth = req.admissionsSettingsAuth!;
        const now = new Date();
        const pack = await listPackDocuments(
          prisma,
          auth.authorizedSchoolId,
          String(req.params.applicationId || "")
        );
        const base = applicationFileBase({ applicationNumber: pack.applicationNumber, id: pack.applicationId });
        const pdf = variant === "application-pack" ? (await buildApplicationPdfForRequest(req, now)).buffer : null;
        await recordAdmissionsDownloadAudit(prisma, {
          schoolId: auth.authorizedSchoolId,
          applicationId: pack.applicationId,
          actorUserId: auth.userId,
          eventType: variant === "application-pack" ? "APPLICATION_PACK_DOWNLOADED" : "APPLICATION_DOCUMENTS_ZIP_DOWNLOADED",
          metadata: {
            documentCount: pack.documents.length,
            missingFileCount: pack.documents.filter((d) => !d.absolutePath).length,
          },
        });
        const stream = createApplicationPackZipStream({
          applicationRef: base,
          generatedAt: now,
          applicationPdf: pdf,
          documents: pack.documents,
        });
        sendDownloadHeaders(
          res,
          "application/zip",
          variant === "application-pack" ? `${base}_application_pack.zip` : `${base}_documents.zip`
        );
        stream.on("error", (err) => {
          console.error("[admissions-pack] zip stream failed:", (err as Error)?.message || "unknown");
          res.destroy();
        });
        stream.pipe(res);
      } catch (err) {
        return sendStaffAdmissionsError(res, err, "Failed to build application document pack");
      }
    }
  );
}

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
      const body = bodyObject(req);
      const result = await acceptAdmissionApplication(
        prisma,
        workflowActorFromReq(req),
        String(req.params.applicationId || ""),
        new Date(),
        { acknowledgePaymentPending: body.acknowledgePaymentPending === true }
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

/**
 * GET /api/admissions/applications/:applicationId/conversion-preflight
 * OA-04B — read-only conversion preview (no canonical writes).
 */
router.get(
  "/applications/:applicationId/conversion-preflight",
  requireAdmissionsSettingsAuth("manage"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const actor = requireConversionAuth(req, res);
      if (!actor) return;
      const preflight = await getConversionPreflight(
        prisma,
        actor,
        String(req.params.applicationId || "")
      );
      res.setHeader("Cache-Control", "no-store");
      return res.json({ success: true, preflight });
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to load conversion preflight");
    }
  }
);

/**
 * POST /api/admissions/applications/:applicationId/convert-to-learner
 * OA-04B — explicit ACCEPTED → canonical enrolment. Status remains ACCEPTED.
 */
router.post(
  "/applications/:applicationId/convert-to-learner",
  requireAdmissionsSettingsAuth("manage"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const actor = requireConversionAuth(req, res);
      if (!actor) return;
      const result = await convertAcceptedApplicationToLearner(
        prisma,
        actor,
        String(req.params.applicationId || ""),
        bodyObject(req)
      );
      res.setHeader("Cache-Control", "no-store");
      return res.json({ success: true, ...result });
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to convert admissions application");
    }
  }
);


/**
 * GET /api/admissions/applications/:applicationId/reactivation-preflight
 * OA-05B — read-only historical reactivation preview (no canonical writes).
 */
router.get(
  "/applications/:applicationId/reactivation-preflight",
  requireAdmissionsSettingsAuth("manage"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const actor = requireConversionAuth(req, res);
      if (!actor) return;
      const preflight = await getReactivationPreflight(
        prisma,
        actor,
        String(req.params.applicationId || "")
      );
      res.setHeader("Cache-Control", "no-store");
      return res.json({ success: true, preflight });
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to load reactivation preflight");
    }
  }
);

/**
 * POST /api/admissions/applications/:applicationId/reactivate-historical-learner
 * OA-05B — explicit ACCEPTED → reactivate historical learner in one transaction.
 */
router.post(
  "/applications/:applicationId/reactivate-historical-learner",
  requireAdmissionsSettingsAuth("manage"),
  async (req: AdmissionsSettingsAuthRequest, res) => {
    try {
      const actor = requireConversionAuth(req, res);
      if (!actor) return;
      const result = await reactivateHistoricalLearnerForApplication(
        prisma,
        actor,
        String(req.params.applicationId || ""),
        bodyObject(req)
      );
      res.setHeader("Cache-Control", "no-store");
      return res.json({ success: true, ...result });
    } catch (err) {
      return sendStaffAdmissionsError(res, err, "Failed to reactivate historical learner");
    }
  }
);

export default router;
