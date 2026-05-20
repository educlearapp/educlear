import { Router } from "express";
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

const router = Router();

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

router.get("/template", (_req, res) => {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="educlear-migration-learners.csv"'
  );
  res.send(MIGRATION_CSV_TEMPLATE);
});

router.post("/projects", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const source = String(req.body?.source || "csv").trim();
    if (!schoolId) return res.status(400).json({ error: "schoolId required" });

    const projectId = createProjectId();
    return res.json({
      success: true,
      projectId,
      schoolId,
      source,
      categories: parseCategories(req.body?.categories),
    });
  } catch (e: any) {
    console.error("migration project", e);
    return res.status(500).json({ error: e?.message || "Failed to create project" });
  }
});

router.post("/validate", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const source = String(req.body?.source || "csv").trim();
    const projectId = String(req.body?.projectId || createProjectId()).trim();
    const headers = Array.isArray(req.body?.headers)
      ? req.body.headers.map(String)
      : [];
    const rawRows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    if (!schoolId) return res.status(400).json({ error: "schoolId required" });
    if (!rawRows.length) return res.status(400).json({ error: "No rows to validate" });

    const categories = parseCategories(req.body?.categories);
    if (
      categories.length &&
      !categories.some((c) => c === "learners" || c === "classes")
    ) {
      return res.status(400).json({
        error: "Select Learners and/or Classes categories for this validation pass",
      });
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
  } catch (e: any) {
    console.error("migration validate", e);
    return res.status(500).json({ error: e?.message || "Validation failed" });
  }
});

router.post("/staging", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const projectId = String(req.body?.projectId || "").trim();
    const source = String(req.body?.source || "csv").trim();
    const report = req.body?.report;
    const rows = req.body?.rows;

    if (!schoolId || !projectId || !report || !Array.isArray(rows)) {
      return res.status(400).json({ error: "schoolId, projectId, report, and rows required" });
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
  } catch (e: any) {
    console.error("migration staging", e);
    return res.status(500).json({ error: e?.message || "Staging failed" });
  }
});

router.get("/staging/:projectId/preview", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const projectId = String(req.params.projectId || "").trim();
    if (!schoolId || !projectId) {
      return res.status(400).json({ error: "schoolId and projectId required" });
    }

    const staging = loadMigrationStaging(schoolId, projectId);
    if (!staging) return res.status(404).json({ error: "Staging not found" });

    return res.json({
      success: true,
      projectId,
      schoolId,
      report: staging.validation,
      confirmToken: buildConfirmToken(projectId, staging.validation),
      normalizationPreview: staging.validation.normalizationPreview,
      canImport: staging.validation.canImport,
    });
  } catch (e: any) {
    console.error("migration preview", e);
    return res.status(500).json({ error: e?.message || "Preview failed" });
  }
});

router.post("/import", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const projectId = String(req.body?.projectId || "").trim();
    const confirmToken = String(req.body?.confirmToken || "").trim();
    const acknowledgedWarnings = req.body?.acknowledgedWarnings === true;

    if (!schoolId || !projectId || !confirmToken) {
      return res.status(400).json({
        error: "schoolId, projectId, and confirmToken required",
      });
    }

    const staging = loadMigrationStaging(schoolId, projectId);
    if (!staging) {
      return res.status(400).json({ error: "Import staging not found — run staging import first" });
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
  } catch (e: any) {
    console.error("migration import", e);
    return res.status(500).json({ error: e?.message || "Import failed" });
  }
});

router.post("/rollback", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const projectId = String(req.body?.projectId || "").trim();
    if (!schoolId || !projectId) {
      return res.status(400).json({ error: "schoolId and projectId required" });
    }
    const result = await rollbackMigrationImport({ schoolId, projectId });
    return res.json(result);
  } catch (e: any) {
    console.error("migration rollback", e);
    return res.status(500).json({ error: e?.message || "Rollback failed" });
  }
});

router.post("/repair-classrooms", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ error: "schoolId required" });
    const result = await repairSchoolClassroomNames(schoolId);
    return res.json({ success: true, ...result });
  } catch (e: any) {
    console.error("migration repair-classrooms", e);
    return res.status(500).json({ error: e?.message || "Repair failed" });
  }
});

export default router;
