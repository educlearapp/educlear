/**
 * Public Online Admissions API (OA-03B/C/D/E).
 * Tenant = publicSlug → server-resolved schoolId. Client schoolId rejected.
 */
import { Router } from "express";
import multer from "multer";
import path from "path";

import { extractApplicantAccessToken } from "../middleware/extractApplicantAccessToken";
import { prisma } from "../prisma";
import {
  ADMISSIONS_MAX_UPLOAD_BYTES,
  deleteApplicantDocument,
  listApplicantDocuments,
  openApplicantDocumentForDownload,
  uploadApplicantDocument,
  uploadProofOfPayment,
} from "../services/admissions/admissionsDocumentService";
import {
  createDraftApplication,
  getApplicationForApplicant,
  updateDraftApplication,
} from "../services/admissions/draftApplicationService";
import { markInformationSupplied } from "../services/admissions/applicantInfoResponseService";
import { getApplicantPaymentView } from "../services/admissions/paymentInstructionsService";
import {
  getPublicAdmissionsConfig,
  PublicAdmissionsError,
} from "../services/admissions/publicAdmissionsConfig";
import { submitApplication } from "../services/admissions/submitApplicationService";
import { resolvePublicAdmissionsBySlug } from "../services/admissions/resolvePublicAdmissions";
import {
  assertSchoolModuleEntitled,
  MODULE_NOT_ENTITLED,
} from "../middleware/requireSchoolModule";

const router = Router({ mergeParams: true });

const admissionsUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ADMISSIONS_MAX_UPLOAD_BYTES, files: 1 },
});

function uploadSingle(fieldName: string) {
  return (
    req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction
  ) => {
    admissionsUpload.single(fieldName)(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res.status(400).json({
            success: false,
            error: "File too large",
            code: "FILE_TOO_LARGE",
          });
        }
        return res.status(400).json({
          success: false,
          error: "Upload failed",
          code: "UPLOAD_ERROR",
        });
      }
      if (err) {
        return sendPublicError(res, err);
      }
      return next();
    });
  };
}

function sendPublicError(res: import("express").Response, err: unknown) {
  if (err instanceof PublicAdmissionsError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
    });
  }
  console.error("public admissions error");
  return res.status(500).json({ success: false, error: "Request failed", code: "INTERNAL" });
}

function param(req: import("express").Request, key: string): string {
  const value = (req.params as Record<string, string | undefined>)[key];
  return String(value || "");
}

/** Public admissions is a CORE product surface. */
router.use(async (req, res, next) => {
  try {
    const schoolSlug = param(req, "schoolSlug");
    const resolved = await resolvePublicAdmissionsBySlug(prisma, schoolSlug);
    const decision = await assertSchoolModuleEntitled(resolved.school.id, "CORE");
    if (!decision.allowed) {
      return res.status(decision.status).json({
        success: false,
        error: decision.error,
        code: decision.code || MODULE_NOT_ENTITLED,
        module: "CORE",
      });
    }
    return next();
  } catch (err) {
    return sendPublicError(res, err);
  }
});

/** GET /api/public/admissions/:schoolSlug/config */
router.get("/config", async (req, res) => {
  try {
    const schoolSlug = param(req, "schoolSlug");
    const config = await getPublicAdmissionsConfig(prisma, schoolSlug);
    return res.json({ success: true, config });
  } catch (err) {
    return sendPublicError(res, err);
  }
});

/** POST /api/public/admissions/:schoolSlug/applications */
router.post("/applications", async (req, res) => {
  try {
    const schoolSlug = param(req, "schoolSlug");
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
      string,
      unknown
    >;
    const result = await createDraftApplication(prisma, schoolSlug, body as any);
    res.setHeader("Cache-Control", "no-store");
    return res.status(201).json({
      success: true,
      application: result.application,
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt,
    });
  } catch (err) {
    return sendPublicError(res, err);
  }
});

/** GET /api/public/admissions/:schoolSlug/applications/:publicAccessId */
router.get("/applications/:publicAccessId", async (req, res) => {
  try {
    const schoolSlug = param(req, "schoolSlug");
    const publicAccessId = param(req, "publicAccessId");
    const token = extractApplicantAccessToken(req);
    const application = await getApplicationForApplicant(
      prisma,
      schoolSlug,
      publicAccessId,
      token
    );
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, application });
  } catch (err) {
    return sendPublicError(res, err);
  }
});

/** PATCH /api/public/admissions/:schoolSlug/applications/:publicAccessId */
router.patch("/applications/:publicAccessId", async (req, res) => {
  try {
    const schoolSlug = param(req, "schoolSlug");
    const publicAccessId = param(req, "publicAccessId");
    const token = extractApplicantAccessToken(req);
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
      string,
      unknown
    >;
    const application = await updateDraftApplication(
      prisma,
      schoolSlug,
      publicAccessId,
      token,
      body as any
    );
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, application });
  } catch (err) {
    return sendPublicError(res, err);
  }
});

/** POST /api/public/admissions/:schoolSlug/applications/:publicAccessId/submit */
router.post("/applications/:publicAccessId/submit", async (req, res) => {
  try {
    const schoolSlug = param(req, "schoolSlug");
    const publicAccessId = param(req, "publicAccessId");
    const token = extractApplicantAccessToken(req);
    const result = await submitApplication(prisma, schoolSlug, publicAccessId, token);
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      success: true,
      application: result.application,
      paymentInstructionsAvailable: result.paymentInstructionsAvailable,
      bankConfigurationIncomplete: result.bankConfigurationIncomplete,
      // Bank details intentionally omitted from submit — use GET .../payment after submit.
    });
  } catch (err) {
    return sendPublicError(res, err);
  }
});

/**
 * POST .../applications/:publicAccessId/information-supplied
 * Applicant declares requested information has been supplied (OA-03H).
 * Status remains INFO_REQUESTED — staff resume-review owns return to UNDER_REVIEW.
 */
router.post("/applications/:publicAccessId/information-supplied", async (req, res) => {
  try {
    const schoolSlug = param(req, "schoolSlug");
    const publicAccessId = param(req, "publicAccessId");
    const token = extractApplicantAccessToken(req);
    const result = await markInformationSupplied(prisma, schoolSlug, publicAccessId, token);
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      success: true,
      action: "information_supplied",
      idempotent: result.idempotent,
      informationSuppliedAt: result.informationSuppliedAt,
      infoRequestHistoryId: result.infoRequestHistoryId,
      application: result.application,
    });
  } catch (err) {
    return sendPublicError(res, err);
  }
});

/**
 * GET /api/public/admissions/:schoolSlug/applications/:publicAccessId/payment
 * Authenticated applicant payment instructions (read-only). Uses fee snapshot, not live fee settings.
 */
router.get("/applications/:publicAccessId/payment", async (req, res) => {
  try {
    const schoolSlug = param(req, "schoolSlug");
    const publicAccessId = param(req, "publicAccessId");
    const token = extractApplicantAccessToken(req);
    const payment = await getApplicantPaymentView(prisma, schoolSlug, publicAccessId, token);
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true, payment });
  } catch (err) {
    return sendPublicError(res, err);
  }
});

/** GET /api/public/admissions/:schoolSlug/applications/:publicAccessId/documents */
router.get("/applications/:publicAccessId/documents", async (req, res) => {
  try {
    const schoolSlug = param(req, "schoolSlug");
    const publicAccessId = param(req, "publicAccessId");
    const token = extractApplicantAccessToken(req);
    const result = await listApplicantDocuments(prisma, schoolSlug, publicAccessId, token);
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      success: true,
      documents: result.documents,
      requiredDocumentTypes: result.requiredDocumentTypes,
    });
  } catch (err) {
    return sendPublicError(res, err);
  }
});

/**
 * POST /api/public/admissions/:schoolSlug/applications/:publicAccessId/documents
 * multipart: file + documentType
 */
router.post(
  "/applications/:publicAccessId/documents",
  uploadSingle("file"),
  async (req, res) => {
    try {
      const schoolSlug = param(req, "schoolSlug");
      const publicAccessId = param(req, "publicAccessId");
      const token = extractApplicantAccessToken(req);
      const file = req.file;
      if (!file?.buffer) {
        throw new PublicAdmissionsError("File is required", 400, "FILE_REQUIRED");
      }
      const documentType = String(
        (req.body && (req.body as Record<string, unknown>).documentType) || ""
      );
      const document = await uploadApplicantDocument(prisma, schoolSlug, publicAccessId, token, {
        documentType,
        buffer: file.buffer,
        originalFileName: file.originalname || "document",
        claimedMime: file.mimetype,
      });
      res.setHeader("Cache-Control", "no-store");
      return res.status(201).json({ success: true, document });
    } catch (err) {
      return sendPublicError(res, err);
    }
  }
);

/**
 * POST /api/public/admissions/:schoolSlug/applications/:publicAccessId/payment-proof
 * multipart: file — does not mark payment verified
 */
router.post(
  "/applications/:publicAccessId/payment-proof",
  uploadSingle("file"),
  async (req, res) => {
    try {
      const schoolSlug = param(req, "schoolSlug");
      const publicAccessId = param(req, "publicAccessId");
      const token = extractApplicantAccessToken(req);
      const file = req.file;
      if (!file?.buffer) {
        throw new PublicAdmissionsError("File is required", 400, "FILE_REQUIRED");
      }
      const result = await uploadProofOfPayment(prisma, schoolSlug, publicAccessId, token, {
        buffer: file.buffer,
        originalFileName: file.originalname || "proof-of-payment",
        claimedMime: file.mimetype,
      });
      res.setHeader("Cache-Control", "no-store");
      return res.status(201).json({
        success: true,
        document: result.document,
        paymentStatus: result.paymentStatus,
      });
    } catch (err) {
      return sendPublicError(res, err);
    }
  }
);

/** GET .../documents/:documentId/download — authenticated stream; no public URL */
router.get("/applications/:publicAccessId/documents/:documentId/download", async (req, res) => {
  try {
    const schoolSlug = param(req, "schoolSlug");
    const publicAccessId = param(req, "publicAccessId");
    const documentId = param(req, "documentId");
    const token = extractApplicantAccessToken(req);
    const file = await openApplicantDocumentForDownload(
      prisma,
      schoolSlug,
      publicAccessId,
      token,
      documentId
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", file.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${path.basename(file.originalFileName).replace(/"/g, "")}"`
    );
    return res.sendFile(file.absolutePath);
  } catch (err) {
    return sendPublicError(res, err);
  }
});

/** DELETE .../documents/:documentId */
router.delete("/applications/:publicAccessId/documents/:documentId", async (req, res) => {
  try {
    const schoolSlug = param(req, "schoolSlug");
    const publicAccessId = param(req, "publicAccessId");
    const documentId = param(req, "documentId");
    const token = extractApplicantAccessToken(req);
    await deleteApplicantDocument(prisma, schoolSlug, publicAccessId, token, documentId);
    res.setHeader("Cache-Control", "no-store");
    return res.json({ success: true });
  } catch (err) {
    return sendPublicError(res, err);
  }
});

export default router;
