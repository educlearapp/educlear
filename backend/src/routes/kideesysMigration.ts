import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { migrationErrorHandler } from "./migration";
import {
  applyKideesysImport,
  approveKideesysImport,
  createKideesysProjectId,
  getKideesysStagingSummary,
  loadKideesysPostImportReport,
  loadKideesysPreview,
  purgeSchoolForKideesysReimport,
  rollbackKideesysImport,
  validateKideesysPortalUploads,
} from "../services/kideesysMigration/kideesysMigrationService";
import { DaSilvaFinalImportBlockedError } from "../services/daSilvaMigration/daSilvaFinalImportGate";

const router = Router();
const tmpDir = path.join(process.cwd(), "uploads", "migration-staging", "tmp");

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      cb(null, tmpDir);
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${String(file.originalname || "upload").replace(/[^a-zA-Z0-9._-]/g, "_")}`);
    },
  }),
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 40,
  },
});

function jsonError(res: import("express").Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

router.post("/projects", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) return jsonError(res, 400, "schoolId required");
    const projectId = String(req.body?.projectId || createKideesysProjectId()).trim();
    return res.json({ success: true, projectId, schoolId, source: "kideesys" });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to create project";
    return jsonError(res, 500, message);
  }
});

router.post("/validate", upload.any(), async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const projectId = String(req.body?.projectId || createKideesysProjectId()).trim();
    const files = Array.isArray(req.files) ? req.files : [];
    if (!schoolId) return jsonError(res, 400, "schoolId required");
    if (!files.length) {
      return jsonError(res, 400, "Upload all six Kid-e-Sys export groups (.xls) before validating");
    }

    const preview = await validateKideesysPortalUploads({ schoolId, projectId, files });

    return res.json({
      success: true,
      projectId: preview.projectId,
      schoolId: preview.schoolId,
      confirmToken: preview.confirmToken,
      canStage: preview.canStage,
      canApply: preview.canApply,
      activeLearnerCount: preview.activeLearnerCount,
      historicalLearnerCount: preview.historicalLearnerCount,
      classifications: preview.classifications,
      columnMappings: preview.columnMappings,
      issues: preview.issues,
      duplicateLearners: preview.duplicateLearners,
      duplicateAccounts: preview.duplicateAccounts,
      balanceValidation: preview.balanceValidation,
      countValidation: preview.bundle.countValidation,
      reconciliation: preview.bundle.reconciliation,
      openingBalance: preview.bundle.openingBalance,
      summary: preview.bundle.reconciliation.totals,
    });
  } catch (e: unknown) {
    console.error("kideesys migration validate", e);
    const message = e instanceof Error ? e.message : "Validation failed";
    return jsonError(res, 500, message);
  }
});

router.get("/staging/:projectId", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const projectId = String(req.params.projectId || "").trim();
    if (!schoolId || !projectId) {
      return jsonError(res, 400, "schoolId and projectId required");
    }
    const preview =
      (await getKideesysStagingSummary(schoolId, projectId)) || loadKideesysPreview(schoolId, projectId);
    if (!preview) return jsonError(res, 404, "Staging not found");
    return res.json({ success: true, preview });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to load staging";
    return jsonError(res, 500, message);
  }
});

router.post("/approve", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const projectId = String(req.body?.projectId || "").trim();
    const confirmToken = String(req.body?.confirmToken || "").trim();
    if (!schoolId || !projectId || !confirmToken) {
      return jsonError(res, 400, "schoolId, projectId, and confirmToken required");
    }
    const result = await approveKideesysImport({ schoolId, projectId, confirmToken });
    return res.json({ success: true, approved: result.approved, preview: result.preview });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Approval failed";
    return jsonError(res, 400, message);
  }
});

router.post("/apply", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const projectId = String(req.body?.projectId || "").trim();
    const confirmToken = String(req.body?.confirmToken || "").trim();
    if (!schoolId || !projectId || !confirmToken) {
      return jsonError(res, 400, "schoolId, projectId, and confirmToken required");
    }
    const result = await applyKideesysImport({ schoolId, projectId, confirmToken });
    return res.json(result);
  } catch (e: unknown) {
    if (e instanceof DaSilvaFinalImportBlockedError) {
      return res.status(403).json({
        error: e.message,
        blocked: true,
        preImportSummary: e.snapshot,
        mismatches: e.mismatches,
      });
    }
    console.error("kideesys migration apply", e);
    const message = e instanceof Error ? e.message : "Apply failed";
    return jsonError(res, 500, message);
  }
});

router.get("/report/:projectId", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const projectId = String(req.params.projectId || "").trim();
    if (!schoolId || !projectId) {
      return jsonError(res, 400, "schoolId and projectId required");
    }
    const report = loadKideesysPostImportReport(schoolId, projectId);
    if (!report) return jsonError(res, 404, "Post-import report not found");
    return res.json({ success: true, report });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Report failed";
    return jsonError(res, 500, message);
  }
});

router.post("/purge", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const confirm = req.body?.confirm === true || String(req.body?.confirm || "") === "true";
    if (!schoolId) return jsonError(res, 400, "schoolId required");
    if (!confirm) {
      return jsonError(res, 400, "Set confirm: true to purge all imported school data for re-import");
    }
    const result = await purgeSchoolForKideesysReimport(schoolId);
    return res.json(result);
  } catch (e: unknown) {
    console.error("kideesys migration purge", e);
    const message = e instanceof Error ? e.message : "Purge failed";
    return jsonError(res, 500, message);
  }
});

router.post("/rollback", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const projectId = String(req.body?.projectId || "").trim();
    if (!schoolId || !projectId) {
      return jsonError(res, 400, "schoolId and projectId required");
    }
    const result = await rollbackKideesysImport({ schoolId, projectId });
    return res.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Rollback failed";
    return jsonError(res, 500, message);
  }
});

export { migrationErrorHandler as kideesysMigrationErrorHandler };
export default router;
