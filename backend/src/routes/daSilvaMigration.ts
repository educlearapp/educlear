import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  buildDaSilvaBundleFromDesktopLayout,
  commitDaSilvaMigration,
  createDaSilvaProjectId,
  loadDaSilvaStaging,
  previewDaSilvaMigration,
  rollbackDaSilvaMigration,
  saveDaSilvaStaging,
} from "../services/daSilvaMigration/daSilvaMigrationService";

const router = Router();
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(process.cwd(), "uploads", "migration-staging", "tmp");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
    },
  }),
  limits: { fileSize: 80 * 1024 * 1024 },
});

router.post("/projects", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ error: "schoolId required" });
    const projectId = createDaSilvaProjectId();
    return res.json({ success: true, projectId, schoolId, source: "kideesys-dasilva" });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to create project";
    return res.status(500).json({ error: message });
  }
});

router.post(
  "/preview",
  upload.fields([
    { name: "classListFiles", maxCount: 40 },
    { name: "contactList", maxCount: 1 },
    { name: "employees", maxCount: 1 },
    { name: "billingPlan", maxCount: 1 },
    { name: "ageAnalysis", maxCount: 1 },
    { name: "transactions", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const schoolId = String(req.body?.schoolId || "").trim();
      const projectId = String(req.body?.projectId || createDaSilvaProjectId()).trim();
      if (!schoolId) return res.status(400).json({ error: "schoolId required" });

      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const classFiles = files?.classListFiles || [];
      if (!classFiles.length) {
        return res.status(400).json({ error: "Upload 05_class_list .xls files (one per class)" });
      }

      const uploadRoot = path.join(
        process.cwd(),
        "uploads",
        "migration-staging",
        schoolId,
        projectId,
        "uploads"
      );
      const classDir = path.join(uploadRoot, "05_class_list");
      fs.mkdirSync(classDir, { recursive: true });
      for (const f of classFiles) {
        fs.copyFileSync(f.path, path.join(classDir, f.originalname));
      }

      const paths: Record<string, string> = { classListDir: classDir };

      const singles = [
        ["contactList", "contactList"],
        ["employees", "employees"],
        ["billingPlan", "billingPlan"],
        ["ageAnalysis", "ageAnalysis"],
        ["transactions", "transactions"],
      ];

      for (const [slot, field] of singles) {
        const file = files?.[field]?.[0];
        if (!file) {
          return res.status(400).json({ error: `Missing upload: ${field} (Kid-e-Sys export)` });
        }
        const dest = path.join(
          uploadRoot,
          slot === "contactList"
            ? "04_contact_list.xls"
            : slot === "employees"
              ? "06_employees.xls"
              : slot === "billingPlan"
                ? "03_billing_plan.xls"
                : slot === "ageAnalysis"
                  ? "02_age_analysis.xls"
                  : "01_transactions.xls"
        );
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(file.path, dest);
        paths[slot] = dest;
      }

      const bundle = await previewDaSilvaMigration({
        schoolId,
        projectId,
        paths: {
          classListDir: paths.classListDir,
          contactList: paths.contactList,
          employees: paths.employees,
          billingPlan: paths.billingPlan,
          ageAnalysis: paths.ageAnalysis,
          transactions: paths.transactions,
        },
      });

      return res.json({
        success: true,
        projectId,
        schoolId,
        dryRun: true,
        canImport: bundle.canImport,
        confirmToken: bundle.confirmToken,
        countValidation: bundle.countValidation,
        reconciliation: bundle.reconciliation,
        summary: bundle.reconciliation.totals,
        issues: bundle.countValidation.errors.map((err, i) => ({
          id: `count-${i}`,
          issue: err,
          severity: "error",
          record: "Count validation",
          suggestedFix: "Ensure class, contact, and billing exports cover the same learners",
          status: "open",
        })),
      });
    } catch (e: unknown) {
      console.error("daSilva migration preview", e);
      const message = e instanceof Error ? e.message : "Preview failed";
      return res.status(500).json({ error: message });
    }
  }
);

router.get("/staging/:projectId", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const projectId = String(req.params.projectId || "").trim();
    if (!schoolId || !projectId) {
      return res.status(400).json({ error: "schoolId and projectId required" });
    }
    const bundle = loadDaSilvaStaging(schoolId, projectId);
    if (!bundle) return res.status(404).json({ error: "Staging not found" });
    return res.json({
      success: true,
      bundle: {
        projectId: bundle.projectId,
        schoolId: bundle.schoolId,
        canImport: bundle.canImport,
        confirmToken: bundle.confirmToken,
        countValidation: bundle.countValidation,
        reconciliation: bundle.reconciliation,
        summary: bundle.reconciliation.totals,
        learnerCount: bundle.learners.length,
        transactionCount: bundle.transactions.length,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to load staging";
    return res.status(500).json({ error: message });
  }
});

router.post("/import", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const projectId = String(req.body?.projectId || "").trim();
    const confirmToken = String(req.body?.confirmToken || "").trim();
    if (!schoolId || !projectId || !confirmToken) {
      return res.status(400).json({ error: "schoolId, projectId, and confirmToken required" });
    }
    const result = await commitDaSilvaMigration({ schoolId, projectId, confirmToken });
    return res.json(result);
  } catch (e: unknown) {
    console.error("daSilva migration import", e);
    const message = e instanceof Error ? e.message : "Import failed";
    return res.status(500).json({ error: message });
  }
});

router.post("/rollback", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const projectId = String(req.body?.projectId || "").trim();
    if (!schoolId || !projectId) {
      return res.status(400).json({ error: "schoolId and projectId required" });
    }
    const result = await rollbackDaSilvaMigration({ schoolId, projectId });
    return res.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Rollback failed";
    return res.status(500).json({ error: message });
  }
});

/** Dev helper: preview from local Desktop export folders (server-side path). */
router.post("/preview-local", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const desktopRoot = String(req.body?.desktopRoot || "").trim();
    const projectId = String(req.body?.projectId || createDaSilvaProjectId()).trim();
    if (!schoolId || !desktopRoot) {
      return res.status(400).json({ error: "schoolId and desktopRoot required" });
    }
    const bundle = buildDaSilvaBundleFromDesktopLayout(schoolId, projectId, desktopRoot);
    await saveDaSilvaStaging(bundle);
    return res.json({
      success: true,
      dryRun: true,
      projectId,
      canImport: bundle.canImport,
      confirmToken: bundle.confirmToken,
      countValidation: bundle.countValidation,
      reconciliation: bundle.reconciliation,
      summary: bundle.reconciliation.totals,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Local preview failed";
    return res.status(500).json({ error: message });
  }
});

export default router;
