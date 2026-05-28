import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { DaSilvaFinalImportBlockedError } from "../services/daSilvaMigration/daSilvaFinalImportGate";
import {
  commitDaSilvaBillingMatchOnly,
  commitDaSilvaBillingOnly,
  commitDaSilvaClassroomsOnly,
  commitDaSilvaLearnersOnly,
  commitDaSilvaParentsOnly,
  createDaSilvaProjectId,
  loadDaSilvaManifest,
  rollbackDaSilvaMigration,
} from "../services/daSilvaMigration/daSilvaMigrationService";
import {
  previewDaSilvaBillingImport,
  previewDaSilvaKideesysBillingMatch,
  previewDaSilvaSasamsClassesLearners,
  previewDaSilvaSasamsParentsLinks,
} from "../services/daSilvaMigration/daSilvaMigrationPreview";
import {
  canonicalRelativePathForSlot,
  classifyDaSilvaUploadFile,
  type DaSilvaUploadSlotKind,
} from "../services/daSilvaMigration/daSilvaUploadClassifier";
import {
  assertDaSilvaMigrationManifestReady,
  buildDaSilvaManifestDebugReport,
  buildStagingUploadManifestFromDisk,
  loadStagingUploadManifest,
  pathsFromStagingUploadManifest,
  requireStagingUploadManifest,
  writeStagingUploadManifest,
} from "../services/daSilvaMigration/daSilvaUploadManifest";
import {
  daSilvaUploadRoot,
  ensureDaSilvaStagingDirs,
  readDaSilvaStagedUploadStatus,
} from "../services/daSilvaMigration/daSilvaStagedPaths";

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
  limits: { fileSize: 80 * 1024 * 1024, files: 60 },
});

function readBody(req: { body?: Record<string, unknown> }) {
  return {
    schoolId: String(req.body?.schoolId || "").trim(),
    projectId: String(req.body?.projectId || "").trim(),
  };
}

function saveUploadToStaging(
  uploadRoot: string,
  relPath: string,
  file: Express.Multer.File
): string {
  const dest = path.join(uploadRoot, relPath);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(file.path, dest);
  return path.resolve(dest);
}

router.post("/projects", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ error: "schoolId required" });
    const projectId = createDaSilvaProjectId();
    ensureDaSilvaStagingDirs(schoolId, projectId);
    return res.json({ success: true, projectId, schoolId, source: "sasams-kideesys" });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to create project";
    return res.status(500).json({ error: message });
  }
});

router.get("/projects/:projectId/status", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const projectId = String(req.params.projectId || "").trim();
    if (!schoolId || !projectId) {
      return res.status(400).json({ error: "schoolId and projectId required" });
    }
    const uploads = readDaSilvaStagedUploadStatus(schoolId, projectId);
    const importManifest = loadDaSilvaManifest(schoolId, projectId);
    return res.json({
      success: true,
      projectId,
      schoolId,
      uploads,
      phasesCompleted: importManifest?.phasesCompleted || [],
      failedPhase: importManifest?.failedPhase || null,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to read project status";
    return res.status(500).json({ error: message });
  }
});

router.get("/:schoolId/:projectId/manifest-debug", async (req, res) => {
  try {
    const schoolId = String(req.params.schoolId || "").trim();
    const projectId = String(req.params.projectId || "").trim();
    if (!schoolId || !projectId) {
      return res.status(400).json({ error: "schoolId and projectId required" });
    }
    const report = buildDaSilvaManifestDebugReport(schoolId, projectId);
    return res.json({ success: true, ...report });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Manifest debug failed";
    return res.status(500).json({ error: message });
  }
});

router.post("/upload", upload.any(), async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const projectId = String(req.body?.projectId || createDaSilvaProjectId()).trim();
    if (!schoolId) return res.status(400).json({ error: "schoolId required" });

    ensureDaSilvaStagingDirs(schoolId, projectId);
    const uploadRoot = daSilvaUploadRoot(schoolId, projectId);
    const files = (req.files as Express.Multer.File[] | undefined) || [];

    const filesSaved: string[] = [];
    const assignedSingle = new Set<DaSilvaUploadSlotKind>();

    for (const file of files) {
      const kind = classifyDaSilvaUploadFile(file.fieldname, file.originalname);
      const rel = canonicalRelativePathForSlot(kind, file.originalname);
      if (!rel) continue;

      if (kind === "classList") {
        saveUploadToStaging(uploadRoot, rel, file);
        if (!filesSaved.includes(rel)) filesSaved.push(rel);
        continue;
      }

      if (assignedSingle.has(kind)) continue;
      saveUploadToStaging(uploadRoot, rel, file);
      assignedSingle.add(kind);
      if (!filesSaved.includes(rel)) filesSaved.push(rel);
    }

    const stagingManifest = buildStagingUploadManifestFromDisk(schoolId, projectId, filesSaved);
    const manifestPath = writeStagingUploadManifest(stagingManifest);
    const gate = assertDaSilvaMigrationManifestReady(stagingManifest);
    const uploads = readDaSilvaStagedUploadStatus(schoolId, projectId);

    return res.json({
      success: true,
      projectId,
      schoolId,
      manifestPath,
      manifestWritten: true,
      manifestReady: gate.ready,
      manifestErrors: gate.errors,
      uploads,
      classListsSaved: stagingManifest.sasams.classLists.length,
      classListFilenames: stagingManifest.sasams.classLists.map((p) => path.basename(p)),
      filesSaved,
    });
  } catch (e: unknown) {
    console.error("daSilva migration upload", e);
    const message = e instanceof Error ? e.message : "Upload failed";
    return res.status(500).json({ error: message });
  }
});

function manifestGateResponse(schoolId: string, projectId: string) {
  const fromDisk = loadStagingUploadManifest(schoolId, projectId);
  const gate = assertDaSilvaMigrationManifestReady(fromDisk);
  if (!gate.ready) {
    return {
      status: 400 as const,
      body: {
        error: "Migration staging manifest is not ready",
        manifestErrors: gate.errors,
        manifestReady: false,
      },
    };
  }
  return { status: null as null, body: null as null };
}

router.post("/preview/sasams-classes-learners", async (req, res) => {
  try {
    const { schoolId, projectId } = readBody(req);
    if (!schoolId || !projectId) {
      return res.status(400).json({ error: "schoolId and projectId required" });
    }
    const gate = manifestGateResponse(schoolId, projectId);
    if (gate.status) return res.status(gate.status).json(gate.body);
    const preview = await previewDaSilvaSasamsClassesLearners({ schoolId, projectId });
    return res.json(preview);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Preview failed";
    return res.status(500).json({ error: message });
  }
});

router.post("/preview/sasams-parents-links", async (req, res) => {
  try {
    const { schoolId, projectId } = readBody(req);
    if (!schoolId || !projectId) {
      return res.status(400).json({ error: "schoolId and projectId required" });
    }
    const gate = manifestGateResponse(schoolId, projectId);
    if (gate.status) return res.status(gate.status).json(gate.body);
    const preview = await previewDaSilvaSasamsParentsLinks({ schoolId, projectId });
    return res.json(preview);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Preview failed";
    return res.status(500).json({ error: message });
  }
});

router.post("/preview/kideesys-billing-match", async (req, res) => {
  try {
    const { schoolId, projectId } = readBody(req);
    if (!schoolId || !projectId) {
      return res.status(400).json({ error: "schoolId and projectId required" });
    }
    const gate = manifestGateResponse(schoolId, projectId);
    if (gate.status) return res.status(gate.status).json(gate.body);
    const preview = await previewDaSilvaKideesysBillingMatch({ schoolId, projectId });
    return res.json(preview);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Preview failed";
    return res.status(500).json({ error: message });
  }
});

router.post("/preview/billing-import", async (req, res) => {
  try {
    const { schoolId, projectId } = readBody(req);
    if (!schoolId || !projectId) {
      return res.status(400).json({ error: "schoolId and projectId required" });
    }
    const gate = manifestGateResponse(schoolId, projectId);
    if (gate.status) return res.status(gate.status).json(gate.body);
    const preview = await previewDaSilvaBillingImport({ schoolId, projectId });
    return res.json(preview);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Preview failed";
    return res.status(500).json({ error: message });
  }
});

router.post("/import/classrooms", async (req, res) => {
  try {
    const { schoolId, projectId } = readBody(req);
    if (!schoolId || !projectId) {
      return res.status(400).json({ error: "schoolId and projectId required" });
    }
    const manifest = requireStagingUploadManifest(schoolId, projectId);
    const paths = pathsFromStagingUploadManifest(manifest);
    const preview = await previewDaSilvaSasamsClassesLearners({ schoolId, projectId });
    if (!preview.passed) {
      return res.status(400).json({
        error: "SA-SAMS class/learner validation must pass before importing classrooms",
        preview,
      });
    }
    const result = await commitDaSilvaClassroomsOnly({
      schoolId,
      projectId,
      classListDir: paths.classListDir,
    });
    return res.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Classroom import failed";
    return res.status(500).json({ error: message });
  }
});

router.post("/import/learners", async (req, res) => {
  try {
    const { schoolId, projectId } = readBody(req);
    if (!schoolId || !projectId) {
      return res.status(400).json({ error: "schoolId and projectId required" });
    }
    const manifest = requireStagingUploadManifest(schoolId, projectId);
    const paths = pathsFromStagingUploadManifest(manifest);
    const preview = await previewDaSilvaSasamsClassesLearners({ schoolId, projectId });
    if (!preview.passed) {
      return res.status(400).json({
        error: "SA-SAMS learner validation must pass before importing learners",
        preview,
      });
    }
    const importManifest = loadDaSilvaManifest(schoolId, projectId);
    if (!importManifest?.phasesCompleted?.includes("classrooms")) {
      return res.status(400).json({ error: "Phase 1 (classrooms) must complete first" });
    }
    const result = await commitDaSilvaLearnersOnly({
      schoolId,
      projectId,
      sasamsPaths: {
        classListDir: paths.classListDir,
        learnerRegister: paths.learnerRegister,
        parentRegister: paths.parentRegister,
      },
    });
    return res.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Learner import failed";
    return res.status(500).json({ error: message });
  }
});

router.post("/import/parents", async (req, res) => {
  try {
    const { schoolId, projectId } = readBody(req);
    if (!schoolId || !projectId) {
      return res.status(400).json({ error: "schoolId and projectId required" });
    }
    const manifest = requireStagingUploadManifest(schoolId, projectId);
    const paths = pathsFromStagingUploadManifest(manifest);
    const preview = await previewDaSilvaSasamsParentsLinks({ schoolId, projectId });
    if (!preview.passed) {
      return res.status(400).json({
        error: "SA-SAMS parent/link validation must pass before importing parents",
        preview,
      });
    }
    const importManifest = loadDaSilvaManifest(schoolId, projectId);
    if (!importManifest?.phasesCompleted?.includes("learners")) {
      return res.status(400).json({ error: "Phase 2 (learners) must complete first" });
    }
    const result = await commitDaSilvaParentsOnly({
      schoolId,
      projectId,
      paths: {
        parentRegister: paths.parentRegister,
        parentLearnerLinks: paths.parentLearnerLinks,
      },
    });
    return res.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Parent import failed";
    return res.status(500).json({ error: message });
  }
});

router.post("/import/billing-match", async (req, res) => {
  try {
    const { schoolId, projectId } = readBody(req);
    if (!schoolId || !projectId) {
      return res.status(400).json({ error: "schoolId and projectId required" });
    }
    const manifest = requireStagingUploadManifest(schoolId, projectId);
    const paths = pathsFromStagingUploadManifest(manifest);
    const preview = await previewDaSilvaKideesysBillingMatch({ schoolId, projectId });
    if (!preview.passed) {
      return res.status(400).json({
        error: "Kid-e-Sys billing match validation must pass before import",
        preview,
      });
    }
    const importManifest = loadDaSilvaManifest(schoolId, projectId);
    if (!importManifest?.phasesCompleted?.includes("parents")) {
      return res.status(400).json({ error: "Phase 3 (parents) must complete first" });
    }
    const result = await commitDaSilvaBillingMatchOnly({
      schoolId,
      projectId,
      paths: {
        classListDir: paths.classListDir,
        ageAnalysis: paths.ageAnalysis,
      },
    });
    return res.json(result);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Billing match import failed";
    return res.status(500).json({ error: message });
  }
});

router.post("/import/billing", async (req, res) => {
  try {
    const { schoolId, projectId } = readBody(req);
    if (!schoolId || !projectId) {
      return res.status(400).json({ error: "schoolId and projectId required" });
    }
    const manifest = requireStagingUploadManifest(schoolId, projectId);
    const paths = pathsFromStagingUploadManifest(manifest);
    const preview = await previewDaSilvaBillingImport({ schoolId, projectId });
    if (!preview.passed) {
      return res.status(400).json({
        error: "Billing import validation must pass before import",
        preview,
      });
    }
    const importManifest = loadDaSilvaManifest(schoolId, projectId);
    if (!importManifest?.phasesCompleted?.includes("billing_match")) {
      return res.status(400).json({ error: "Phase 4 (billing match) must complete first" });
    }
    const result = await commitDaSilvaBillingOnly({
      schoolId,
      projectId,
      paths: {
        classListDir: paths.classListDir,
        billingPlan: paths.billingPlan,
        ageAnalysis: paths.ageAnalysis,
      },
    });
    return res.json(result);
  } catch (e: unknown) {
    if (e instanceof DaSilvaFinalImportBlockedError) {
      return res.status(403).json({
        error: e.message,
        blocked: true,
        envConfirmed: e.envConfirmed,
        preImportSummary: e.snapshot,
        mismatches: e.mismatches,
        requiredEnv: "CONFIRM_DA_SILVA_FINAL_IMPORT=true",
      });
    }
    const message = e instanceof Error ? e.message : "Billing import failed";
    return res.status(500).json({ error: message });
  }
});

router.post("/rollback", async (req, res) => {
  try {
    const { schoolId, projectId } = readBody(req);
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

export default router;
