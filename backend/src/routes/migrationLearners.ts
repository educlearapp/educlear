import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

import type { MigrationAccessRequest } from "../middleware/requireMigrationAccess";
import {
  applyMigrationLearnerRepair,
  previewMigrationLearnerRepair,
} from "../services/migrationCentre/learnerRepairService";
import { isAcceptedMigrationSpreadsheet } from "../services/migrationCentre/spreadsheetUpload";
import { assertMigrationSchoolScope, resolveMigrationSchoolId } from "./migrationCentreAuth";

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
      return jsonError(res, 400, "Upload SA-SAMS class list or learner register (.xls, .xlsx, .csv)");
    }

    const name = String(file.originalname || "");
    if (!isAcceptedMigrationSpreadsheet(name)) {
      return jsonError(res, 400, "File must be .xls, .xlsx, or .csv");
    }

    tmpPath = file.path;
    const preview = await previewMigrationLearnerRepair({
      schoolId,
      uploadFilePath: tmpPath,
      originalFileName: file.originalname,
    });

    return res.json(preview);
  } catch (e: unknown) {
    console.error("[migration/learners] preview", e);
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

    const result = await applyMigrationLearnerRepair({ schoolId, sessionId });
    return res.json(result);
  } catch (e: unknown) {
    console.error("[migration/learners] apply", e);
    const message = e instanceof Error ? e.message : "Apply failed";
    return jsonError(res, 400, message);
  }
});

export default router;
