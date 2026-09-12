/**
 * Public Online Admissions API (OA-03B foundation).
 * Tenant = publicSlug → server-resolved schoolId. Client schoolId rejected.
 */
import { Router } from "express";

import { extractApplicantAccessToken } from "../middleware/extractApplicantAccessToken";
import { prisma } from "../prisma";
import {
  createDraftApplication,
  getApplicationForApplicant,
} from "../services/admissions/draftApplicationService";
import {
  getPublicAdmissionsConfig,
  PublicAdmissionsError,
} from "../services/admissions/publicAdmissionsConfig";

const router = Router({ mergeParams: true });

function sendPublicError(res: import("express").Response, err: unknown) {
  if (err instanceof PublicAdmissionsError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code,
    });
  }
  console.error("public admissions error");
  return res.status(500).json({ success: false, error: "Request failed", code: "INTERNAL" });
}

function param(req: import("express").Request, key: string): string {
  const value = (req.params as Record<string, string | undefined>)[key];
  return String(value || "");
}

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
    // Return token once; clients should store securely (httpOnly cookie preferred in SPA later).
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

export default router;
