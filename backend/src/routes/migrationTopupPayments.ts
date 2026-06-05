import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

import type { MigrationAccessRequest } from "../middleware/requireMigrationAccess";
import { isAcceptedMigrationSpreadsheet } from "../services/migrationCentre/spreadsheetUpload";
import { assertMigrationSchoolScope, resolveMigrationSchoolId } from "./migrationCentreAuth";
import {
  applyMigrationTopupPaymentsImport,
  listTopupPaymentBatches,
  previewMigrationTopupPaymentsImport,
  rollbackTopupPaymentBatch,
} from "../services/migrationCentre/topupPaymentsImportService";
import { refreshAgeAnalysisBaseline } from "../services/migrationCentre/ageAnalysisBaselineRefreshService";

const router = Router();
const tmpDir = path.join(process.cwd(), "uploads", "migration-centre", "tmp");

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      cb(null, tmpDir);
    },
    filename: (_req, file, cb) => {
      cb(
        null,
        `${Date.now()}-${String(file.originalname || "upload").replace(/[^a-zA-Z0-9._-]/g, "_")}`
      );
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});

function jsonError(res: import("express").Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

router.post("/preview", upload.single("file"), async (req, res) => {
  let tmpPath = "";
  try {
    const migrationReq = req as MigrationAccessRequest;
    const schoolId = resolveMigrationSchoolId(migrationReq, req.body?.schoolId);
    const file = req.file;

    if (!schoolId) return jsonError(res, 400, "schoolId required");
    if (!assertMigrationSchoolScope(migrationReq, schoolId, res)) return;
    if (!file) {
      return jsonError(res, 400, "Upload Kid-e-Sys Transaction List (.xls, .xlsx, or .csv)");
    }

    const name = String(file.originalname || "");
    if (!isAcceptedMigrationSpreadsheet(name)) {
      return jsonError(res, 400, "File must be .xls, .xlsx, or .csv");
    }

    tmpPath = file.path;
    const preview = await previewMigrationTopupPaymentsImport({
      schoolId,
      transactionFilePath: tmpPath,
      originalFileName: file.originalname,
      uploadedBy: String(migrationReq.migrationAuth?.email || "").trim() || "Migration Centre",
    });

    return res.json(preview);
  } catch (e: unknown) {
    console.error("[migration/topup-payments] preview", e);
    const message = e instanceof Error ? e.message : "Preview failed";
    return jsonError(res, 500, message);
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    }
  }
});

router.post("/apply", async (req, res) => {
  try {
    const migrationReq = req as MigrationAccessRequest;
    const schoolId = resolveMigrationSchoolId(migrationReq, req.body?.schoolId);
    const sessionId = String(req.body?.sessionId || "").trim();

    if (!schoolId || !sessionId) {
      return jsonError(res, 400, "schoolId and sessionId required");
    }
    if (!assertMigrationSchoolScope(migrationReq, schoolId, res)) return;

    const result = await applyMigrationTopupPaymentsImport({ schoolId, sessionId });
    return res.json(result);
  } catch (e: unknown) {
    console.error("[migration/topup-payments] apply", e);
    const message = e instanceof Error ? e.message : "Apply failed";
    return jsonError(res, 400, message);
  }
});

router.get("/batches", async (req, res) => {
  try {
    const migrationReq = req as MigrationAccessRequest;
    const schoolId =
      typeof req.query?.schoolId === "string"
        ? resolveMigrationSchoolId(migrationReq, req.query.schoolId)
        : resolveMigrationSchoolId(migrationReq, undefined);
    if (!schoolId) return jsonError(res, 400, "schoolId required");
    if (!assertMigrationSchoolScope(migrationReq, schoolId, res)) return;

    const batches = await listTopupPaymentBatches(schoolId);
    return res.json({ success: true, batches });
  } catch (e: unknown) {
    console.error("[migration/topup-payments] batches", e);
    const message = e instanceof Error ? e.message : "Failed to list batches";
    return jsonError(res, 500, message);
  }
});

router.post("/age-baseline-refresh", async (req, res) => {
  try {
    const migrationReq = req as MigrationAccessRequest;
    const schoolId = resolveMigrationSchoolId(migrationReq, req.body?.schoolId);
    const importedAt = String(req.body?.importedAt || "").trim();
    const snapshots = Array.isArray(req.body?.snapshots) ? req.body.snapshots : [];

    if (!schoolId) return jsonError(res, 400, "schoolId required");
    if (!assertMigrationSchoolScope(migrationReq, schoolId, res)) return;
    if (!importedAt) return jsonError(res, 400, "importedAt required");
    if (!snapshots.length) return jsonError(res, 400, "snapshots required");

    const result = await refreshAgeAnalysisBaseline({ schoolId, importedAt, snapshots });
    return res.json(result);
  } catch (e: unknown) {
    console.error("[migration/topup-payments] age-baseline-refresh", e);
    const message = e instanceof Error ? e.message : "Baseline refresh failed";
    return jsonError(res, 400, message);
  }
});

router.post("/batches/:batchId/rollback", async (req, res) => {
  try {
    const migrationReq = req as MigrationAccessRequest;
    const schoolId = resolveMigrationSchoolId(migrationReq, req.body?.schoolId);
    const batchId = String(req.params.batchId || "").trim();
    if (!schoolId || !batchId) return jsonError(res, 400, "schoolId and batchId required");
    if (!assertMigrationSchoolScope(migrationReq, schoolId, res)) return;

    const result = await rollbackTopupPaymentBatch({ schoolId, batchId });
    return res.json(result);
  } catch (e: unknown) {
    console.error("[migration/topup-payments] rollback", e);
    const message = e instanceof Error ? e.message : "Rollback failed";
    return jsonError(res, 400, message);
  }
});

export default router;

