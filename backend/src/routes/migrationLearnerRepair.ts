import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

import type { MigrationAccessRequest } from "../middleware/requireMigrationAccess";
import {
  applyMigrationLearnerGenderRepair,
  previewMigrationLearnerGenderRepairFromFiles,
} from "../services/migrationCentre/learnerGenderRepairService";
import { isAcceptedMigrationSpreadsheet } from "../services/migrationCentre/spreadsheetUpload";
import { assertMigrationSchoolScope, resolveMigrationSchoolId } from "./migrationCentreAuth";

const router = Router();
const tmpDir = path.join(process.cwd(), "uploads", "migration-centre", "tmp");
const MAX_FILES = 50;

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
  limits: { fileSize: 50 * 1024 * 1024, files: MAX_FILES },
});

function jsonError(res: import("express").Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

function cleanupTmpPaths(paths: string[]) {
  for (const tmpPath of paths) {
    if (tmpPath && fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    }
  }
}

router.post("/preview", upload.array("files", MAX_FILES), async (req, res) => {
  const tmpPaths: string[] = [];
  try {
    const migrationReq = req as MigrationAccessRequest;
    const schoolId = resolveMigrationSchoolId(migrationReq, req.body?.schoolId);
    const uploaded = Array.isArray(req.files) ? req.files : req.file ? [req.file] : [];

    if (!schoolId) return jsonError(res, 400, "schoolId required");
    if (!assertMigrationSchoolScope(migrationReq, schoolId, res)) return;
    if (!uploaded.length) {
      return jsonError(
        res,
        400,
        "Upload one or more SASAMS class lists or learner exports (.xls, .xlsx, .csv)"
      );
    }

    const files: Array<{ uploadFilePath: string; originalFileName: string }> = [];
    for (const file of uploaded) {
      const name = String(file.originalname || "");
      if (!isAcceptedMigrationSpreadsheet(name)) {
        return jsonError(res, 400, `File must be .xls, .xlsx, or .csv: ${name || "unknown"}`);
      }
      tmpPaths.push(file.path);
      files.push({ uploadFilePath: file.path, originalFileName: file.originalname });
    }

    const preview = await previewMigrationLearnerGenderRepairFromFiles({
      schoolId,
      files,
    });

    return res.json(preview);
  } catch (e: unknown) {
    console.error("[migration/learner-repair] preview", e);
    const message = e instanceof Error ? e.message : "Preview failed";
    return jsonError(res, 500, message);
  } finally {
    cleanupTmpPaths(tmpPaths);
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

    const result = await applyMigrationLearnerGenderRepair({ schoolId, sessionId });
    return res.json(result);
  } catch (e: unknown) {
    console.error("[migration/learner-repair] apply", e);
    const message = e instanceof Error ? e.message : "Apply failed";
    return jsonError(res, 400, message);
  }
});

export default router;
