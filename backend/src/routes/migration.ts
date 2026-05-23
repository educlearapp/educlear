import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  buildConfirmToken,
  buildFieldMappings,
  commitMigrationImport,
  createProjectId,
  loadMigrationStaging,
  MIGRATION_CSV_TEMPLATE,
  mapRawRow,
  repairSchoolClassroomNames,
  rollbackMigrationImport,
  saveMigrationStaging,
  validateMigrationRows,
  type MigrationLearnerInputRow,
} from "../services/migrationService";
import { validateKideesysMigrationUploads } from "../services/kideesysMigrationValidate";
import {
  isAcceptedLearnerMigrationFileName,
  parseMigrationLearnerFileBuffer,
} from "../utils/migrationLearnerFileParser";

const router = Router();

const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 24 * 1024 * 1024 },
});

const kideesysUploadDir = path.join(process.cwd(), "uploads", "migration-staging", "tmp");
const uploadDisk = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      if (!fs.existsSync(kideesysUploadDir)) fs.mkdirSync(kideesysUploadDir, { recursive: true });
      cb(null, kideesysUploadDir);
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${String(file.originalname || "upload").replace(/[^a-zA-Z0-9._-]/g, "_")}`);
    },
  }),
  limits: { fileSize: 80 * 1024 * 1024 },
});

const CORE_CATEGORIES = new Set([
  "learners",
  "parents",
  "parentRelationships",
  "classes",
]);

function parseCategories(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw.map(String) : [];
  return list.filter((c) => CORE_CATEGORIES.has(c));
}

function isMultipartRequest(req: Request): boolean {
  const ct = String(req.headers["content-type"] || "").toLowerCase();
  return ct.includes("multipart/form-data");
}

function collectUploadedFiles(req: Request): Express.Multer.File[] {
  const files = req.files;
  if (!files) return [];
  if (Array.isArray(files)) return files;
  return Object.values(files).flat();
}

function jsonError(res: Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

/** Return JSON for multer / payload errors instead of HTML 500 pages. */
export function migrationErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
) {
  if (res.headersSent) return next(err);

  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "Upload too large. Kid-e-Sys transaction exports can be ~28MB — use Validate Files with all exports attached (multipart), not the learner CSV parser."
        : err.message || "Upload failed";
    return jsonError(res, err.code === "LIMIT_FILE_SIZE" ? 413 : 400, message);
  }

  const entityType = (err as { type?: string })?.type;
  if (entityType === "entity.too.large") {
    return jsonError(
      res,
      413,
      "Request payload too large. For Kid-e-Sys, upload exports via Validate Files (multipart) instead of sending parsed rows as JSON."
    );
  }

  const message = err instanceof Error ? err.message : "Migration request failed";
  console.error("migration route error", err);
  return jsonError(res, 500, message);
}

router.get("/template", (_req, res) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="educlear-migration-learners.csv"'
  );
  res.send(MIGRATION_CSV_TEMPLATE);
});

router.post("/parse-learner-file", uploadMemory.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return jsonError(res, 400, "Learner file required (CSV, XLS, or XLSX).");
    }
    const fileName = String(req.file.originalname || "upload").trim();
    if (!isAcceptedLearnerMigrationFileName(fileName)) {
      return jsonError(res, 400, "Learner file must be CSV, XLS, or XLSX.");
    }

    const parsed = parseMigrationLearnerFileBuffer(req.file.buffer, fileName);
    if (!parsed.rows.length) {
      return jsonError(res, 400, "No learner rows found in file.");
    }

    return res.json({
      success: true,
      fileName: parsed.fileName,
      headers: parsed.headers,
      rows: parsed.rows,
    });
  } catch (e: unknown) {
    console.error("migration parse-learner-file", e);
    const message = e instanceof Error ? e.message : "Failed to parse learner file";
    return jsonError(res, 400, message);
  }
});

router.post("/projects", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const source = String(req.body?.source || "csv").trim();
    if (!schoolId) return jsonError(res, 400, "schoolId required");

    const projectId = createProjectId();
    return res.json({
      success: true,
      projectId,
      schoolId,
      source,
      categories: parseCategories(req.body?.categories),
    });
  } catch (e: unknown) {
    console.error("migration project", e);
    const message = e instanceof Error ? e.message : "Failed to create project";
    return jsonError(res, 500, message);
  }
});

router.post(
  "/validate",
  (req, res, next) => {
    if (!isMultipartRequest(req)) return next();
    uploadDisk.any()(req, res, (err) => {
      if (err) return migrationErrorHandler(err, req, res, next);
      next();
    });
  },
  async (req, res) => {
    try {
      const source = String(req.body?.source || "csv").trim();
      const schoolId = String(req.body?.schoolId || "").trim();
      const projectId = String(req.body?.projectId || createProjectId()).trim();

      if (!schoolId) return jsonError(res, 400, "schoolId required");

      if (source === "kideesys" && isMultipartRequest(req)) {
        const uploaded = collectUploadedFiles(req);
        if (!uploaded.length) {
          return jsonError(
            res,
            400,
            "Upload Kid-e-Sys .xls exports (class lists, contacts, billing, age analysis, transactions, employees) before validating."
          );
        }

        const result = await validateKideesysMigrationUploads({
          schoolId,
          projectId,
          files: uploaded,
        });

        return res.json({
          success: true,
          projectId: result.projectId,
          report: result.report,
          confirmToken: result.confirmToken,
          daSilvaConfirmToken: result.daSilvaConfirmToken,
          stagedRows: result.stagedRows,
          countValidation: result.countValidation,
          summary: result.summary,
          validated: result.report.canImport,
          fileName: `${uploaded.length} Kid-e-Sys export file(s)`,
          kideesys: true,
        });
      }

      if (source === "kideesys") {
        return jsonError(
          res,
          400,
          "Kid-e-Sys validation requires multipart file upload. Upload all six export groups and click Validate Files again."
        );
      }

      const headers = Array.isArray(req.body?.headers)
        ? req.body.headers.map(String)
        : [];
      const rawRows = Array.isArray(req.body?.rows) ? req.body.rows : [];

      if (!rawRows.length) return jsonError(res, 400, "No rows to validate");

      const categories = parseCategories(req.body?.categories);
      if (
        categories.length &&
        !categories.some((c) => c === "learners" || c === "classes")
      ) {
        return jsonError(
          res,
          400,
          "Select Learners and/or Classes categories for this validation pass"
        );
      }

      const mappings = headers.length > 0 ? buildFieldMappings(headers) : [];

      const rows: MigrationLearnerInputRow[] = rawRows.map((raw: Record<string, string>, i: number) =>
        headers.length
          ? mapRawRow(raw, i + 1, mappings)
          : {
              rowIndex: i + 1,
              firstName: String(raw.firstName || raw.first_name || "").trim(),
              lastName: String(raw.lastName || raw.last_name || raw.surname || "").trim(),
              grade: String(raw.grade || "").trim(),
              className: String(
                raw.className || raw.class_name || raw.class || raw.classroom || ""
              ).trim(),
              admissionNo: String(raw.admissionNo || raw.admission_no || "").trim() || undefined,
              idNumber: String(raw.idNumber || raw.id_number || "").trim() || undefined,
              birthDate: String(raw.birthDate || "").trim() || undefined,
              gender: String(raw.gender || "").trim() || undefined,
              parentFirstName: String(raw.parentFirstName || "").trim() || undefined,
              parentSurname: String(raw.parentSurname || "").trim() || undefined,
              parentMobile: String(raw.parentMobile || raw.parent_mobile || "").trim() || undefined,
              parentEmail: String(raw.parentEmail || "").trim() || undefined,
              parentIdNumber: String(raw.parentIdNumber || "").trim() || undefined,
              relation: String(raw.relation || "").trim() || undefined,
              teacherName: String(raw.teacherName || "").trim() || undefined,
              teacherEmail: String(raw.teacherEmail || "").trim() || undefined,
            }
      );

      const report = await validateMigrationRows({
        schoolId,
        source,
        projectId,
        rows,
        headers,
      });

      const confirmToken = buildConfirmToken(projectId, report);

      return res.json({
        success: true,
        projectId,
        report,
        confirmToken,
        validated: report.canImport,
        summary: {
          rowCount: report.rowCount,
          blockingErrors: report.blockingErrorCount,
          warnings: report.warningCount,
          canImport: report.canImport,
          duplicateClassrooms: report.duplicateClassrooms.length,
          duplicateLearners: report.duplicateLearners.length,
          missingParents: report.missingParents.length,
          teacherWarnings: report.teacherAssignmentWarnings.length,
        },
      });
    } catch (e: unknown) {
      console.error("migration validate", e);
      const message = e instanceof Error ? e.message : "Validation failed";
      return jsonError(res, 500, message);
    }
  }
);

router.post("/staging", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const projectId = String(req.body?.projectId || "").trim();
    const source = String(req.body?.source || "csv").trim();
    const report = req.body?.report;
    const rows = req.body?.rows;

    if (!schoolId || !projectId || !report || !Array.isArray(rows)) {
      return jsonError(res, 400, "schoolId, projectId, report, and rows required");
    }

    await saveMigrationStaging({
      projectId,
      schoolId,
      source,
      categories: parseCategories(req.body?.categories),
      createdAt: new Date().toISOString(),
      rows,
      validation: report,
    });

    return res.json({ success: true, projectId, stagedRows: rows.length });
  } catch (e: unknown) {
    console.error("migration staging", e);
    const message = e instanceof Error ? e.message : "Staging failed";
    return jsonError(res, 500, message);
  }
});

router.get("/staging/:projectId/preview", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const projectId = String(req.params.projectId || "").trim();
    if (!schoolId || !projectId) {
      return jsonError(res, 400, "schoolId and projectId required");
    }

    const staging = loadMigrationStaging(schoolId, projectId);
    if (!staging) return jsonError(res, 404, "Staging not found");

    return res.json({
      success: true,
      projectId,
      schoolId,
      report: staging.validation,
      confirmToken: buildConfirmToken(projectId, staging.validation),
      normalizationPreview: staging.validation.normalizationPreview,
      canImport: staging.validation.canImport,
    });
  } catch (e: unknown) {
    console.error("migration preview", e);
    const message = e instanceof Error ? e.message : "Preview failed";
    return jsonError(res, 500, message);
  }
});

router.post("/import", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const projectId = String(req.body?.projectId || "").trim();
    const confirmToken = String(req.body?.confirmToken || "").trim();
    const acknowledgedWarnings = req.body?.acknowledgedWarnings === true;

    if (!schoolId || !projectId || !confirmToken) {
      return jsonError(res, 400, "schoolId, projectId, and confirmToken required");
    }

    const staging = loadMigrationStaging(schoolId, projectId);
    if (!staging) {
      return jsonError(res, 400, "Import staging not found — run staging import first");
    }
    if (!staging.validation.canImport) {
      return res.status(400).json({
        error: "Cannot import while validation has blocking errors",
        blockingErrorCount: staging.validation.blockingErrorCount,
      });
    }
    if (staging.validation.warningCount > 0 && !acknowledgedWarnings) {
      return res.status(400).json({
        error: "Acknowledge warnings before final import",
        warningCount: staging.validation.warningCount,
        requiresAcknowledgement: true,
        confirmToken: buildConfirmToken(projectId, staging.validation),
        normalizationPreview: staging.validation.normalizationPreview,
      });
    }

    const result = await commitMigrationImport({ schoolId, projectId, confirmToken });
    return res.json(result);
  } catch (e: unknown) {
    console.error("migration import", e);
    const message = e instanceof Error ? e.message : "Import failed";
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
    const result = await rollbackMigrationImport({ schoolId, projectId });
    return res.json(result);
  } catch (e: unknown) {
    console.error("migration rollback", e);
    const message = e instanceof Error ? e.message : "Rollback failed";
    return jsonError(res, 500, message);
  }
});

router.post("/repair-classrooms", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) return jsonError(res, 400, "schoolId required");
    const result = await repairSchoolClassroomNames(schoolId);
    return res.json({ success: true, ...result });
  } catch (e: unknown) {
    console.error("migration repair-classrooms", e);
    const message = e instanceof Error ? e.message : "Repair failed";
    return jsonError(res, 500, message);
  }
});

export default router;
