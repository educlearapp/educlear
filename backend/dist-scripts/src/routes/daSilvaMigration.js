"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const daSilvaFinalImportGate_1 = require("../services/daSilvaMigration/daSilvaFinalImportGate");
const daSilvaMigrationService_1 = require("../services/daSilvaMigration/daSilvaMigrationService");
const daSilvaMigrationPreview_1 = require("../services/daSilvaMigration/daSilvaMigrationPreview");
const daSilvaUploadClassifier_1 = require("../services/daSilvaMigration/daSilvaUploadClassifier");
const daSilvaUploadManifest_1 = require("../services/daSilvaMigration/daSilvaUploadManifest");
const daSilvaStagedPaths_1 = require("../services/daSilvaMigration/daSilvaStagedPaths");
const router = (0, express_1.Router)();
const upload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: (_req, _file, cb) => {
            const dir = path_1.default.join(process.cwd(), "uploads", "migration-staging", "tmp");
            if (!fs_1.default.existsSync(dir))
                fs_1.default.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (_req, file, cb) => {
            cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
        },
    }),
    limits: { fileSize: 80 * 1024 * 1024, files: 60 },
});
function readBody(req) {
    return {
        schoolId: String(req.body?.schoolId || "").trim(),
        projectId: String(req.body?.projectId || "").trim(),
    };
}
function saveUploadToStaging(uploadRoot, relPath, file) {
    const dest = path_1.default.join(uploadRoot, relPath);
    fs_1.default.mkdirSync(path_1.default.dirname(dest), { recursive: true });
    fs_1.default.copyFileSync(file.path, dest);
    return path_1.default.resolve(dest);
}
router.post("/projects", async (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        if (!schoolId)
            return res.status(400).json({ error: "schoolId required" });
        const projectId = (0, daSilvaMigrationService_1.createDaSilvaProjectId)();
        (0, daSilvaStagedPaths_1.ensureDaSilvaStagingDirs)(schoolId, projectId);
        return res.json({ success: true, projectId, schoolId, source: "sasams-kideesys" });
    }
    catch (e) {
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
        const uploads = (0, daSilvaStagedPaths_1.readDaSilvaStagedUploadStatus)(schoolId, projectId);
        const importManifest = (0, daSilvaMigrationService_1.loadDaSilvaManifest)(schoolId, projectId);
        return res.json({
            success: true,
            projectId,
            schoolId,
            uploads,
            phasesCompleted: importManifest?.phasesCompleted || [],
            failedPhase: importManifest?.failedPhase || null,
        });
    }
    catch (e) {
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
        const report = (0, daSilvaUploadManifest_1.buildDaSilvaManifestDebugReport)(schoolId, projectId);
        return res.json({ success: true, ...report });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : "Manifest debug failed";
        return res.status(500).json({ error: message });
    }
});
router.post("/upload", upload.any(), async (req, res) => {
    try {
        const schoolId = String(req.body?.schoolId || "").trim();
        const projectId = String(req.body?.projectId || (0, daSilvaMigrationService_1.createDaSilvaProjectId)()).trim();
        if (!schoolId)
            return res.status(400).json({ error: "schoolId required" });
        (0, daSilvaStagedPaths_1.ensureDaSilvaStagingDirs)(schoolId, projectId);
        const uploadRoot = (0, daSilvaStagedPaths_1.daSilvaUploadRoot)(schoolId, projectId);
        const files = req.files || [];
        const filesSaved = [];
        const assignedSingle = new Set();
        for (const file of files) {
            const kind = (0, daSilvaUploadClassifier_1.classifyDaSilvaUploadFile)(file.fieldname, file.originalname);
            const rel = (0, daSilvaUploadClassifier_1.canonicalRelativePathForSlot)(kind, file.originalname);
            if (!rel)
                continue;
            if (kind === "classList") {
                saveUploadToStaging(uploadRoot, rel, file);
                if (!filesSaved.includes(rel))
                    filesSaved.push(rel);
                continue;
            }
            if (assignedSingle.has(kind))
                continue;
            saveUploadToStaging(uploadRoot, rel, file);
            assignedSingle.add(kind);
            if (!filesSaved.includes(rel))
                filesSaved.push(rel);
        }
        const stagingManifest = (0, daSilvaUploadManifest_1.buildStagingUploadManifestFromDisk)(schoolId, projectId, filesSaved);
        const manifestPath = (0, daSilvaUploadManifest_1.writeStagingUploadManifest)(stagingManifest);
        const gate = (0, daSilvaUploadManifest_1.assertDaSilvaMigrationManifestReady)(stagingManifest);
        const uploads = (0, daSilvaStagedPaths_1.readDaSilvaStagedUploadStatus)(schoolId, projectId);
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
            classListFilenames: stagingManifest.sasams.classLists.map((p) => path_1.default.basename(p)),
            filesSaved,
        });
    }
    catch (e) {
        console.error("daSilva migration upload", e);
        const message = e instanceof Error ? e.message : "Upload failed";
        return res.status(500).json({ error: message });
    }
});
function manifestGateResponse(schoolId, projectId) {
    const fromDisk = (0, daSilvaUploadManifest_1.loadStagingUploadManifest)(schoolId, projectId);
    const gate = (0, daSilvaUploadManifest_1.assertDaSilvaMigrationManifestReady)(fromDisk);
    if (!gate.ready) {
        return {
            status: 400,
            body: {
                error: "Migration staging manifest is not ready",
                manifestErrors: gate.errors,
                manifestReady: false,
            },
        };
    }
    return { status: null, body: null };
}
router.post("/preview/sasams-classes-learners", async (req, res) => {
    try {
        const { schoolId, projectId } = readBody(req);
        if (!schoolId || !projectId) {
            return res.status(400).json({ error: "schoolId and projectId required" });
        }
        const gate = manifestGateResponse(schoolId, projectId);
        if (gate.status)
            return res.status(gate.status).json(gate.body);
        const preview = await (0, daSilvaMigrationPreview_1.previewDaSilvaSasamsClassesLearners)({ schoolId, projectId });
        return res.json(preview);
    }
    catch (e) {
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
        if (gate.status)
            return res.status(gate.status).json(gate.body);
        const preview = await (0, daSilvaMigrationPreview_1.previewDaSilvaSasamsParentsLinks)({ schoolId, projectId });
        return res.json(preview);
    }
    catch (e) {
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
        if (gate.status)
            return res.status(gate.status).json(gate.body);
        const preview = await (0, daSilvaMigrationPreview_1.previewDaSilvaKideesysBillingMatch)({ schoolId, projectId });
        return res.json(preview);
    }
    catch (e) {
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
        if (gate.status)
            return res.status(gate.status).json(gate.body);
        const preview = await (0, daSilvaMigrationPreview_1.previewDaSilvaBillingImport)({ schoolId, projectId });
        return res.json(preview);
    }
    catch (e) {
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
        const manifest = (0, daSilvaUploadManifest_1.requireStagingUploadManifest)(schoolId, projectId);
        const paths = (0, daSilvaUploadManifest_1.pathsFromStagingUploadManifest)(manifest);
        const preview = await (0, daSilvaMigrationPreview_1.previewDaSilvaSasamsClassesLearners)({ schoolId, projectId });
        if (!preview.passed) {
            return res.status(400).json({
                error: "SA-SAMS class/learner validation must pass before importing classrooms",
                preview,
            });
        }
        const result = await (0, daSilvaMigrationService_1.commitDaSilvaClassroomsOnly)({
            schoolId,
            projectId,
            classListDir: paths.classListDir,
        });
        return res.json(result);
    }
    catch (e) {
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
        const manifest = (0, daSilvaUploadManifest_1.requireStagingUploadManifest)(schoolId, projectId);
        const paths = (0, daSilvaUploadManifest_1.pathsFromStagingUploadManifest)(manifest);
        const preview = await (0, daSilvaMigrationPreview_1.previewDaSilvaSasamsClassesLearners)({ schoolId, projectId });
        if (!preview.passed) {
            return res.status(400).json({
                error: "SA-SAMS learner validation must pass before importing learners",
                preview,
            });
        }
        const importManifest = (0, daSilvaMigrationService_1.loadDaSilvaManifest)(schoolId, projectId);
        if (!importManifest?.phasesCompleted?.includes("classrooms")) {
            return res.status(400).json({ error: "Phase 1 (classrooms) must complete first" });
        }
        const result = await (0, daSilvaMigrationService_1.commitDaSilvaLearnersOnly)({
            schoolId,
            projectId,
            sasamsPaths: {
                classListDir: paths.classListDir,
                learnerRegister: paths.learnerRegister,
                parentRegister: paths.parentRegister,
            },
        });
        return res.json(result);
    }
    catch (e) {
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
        const manifest = (0, daSilvaUploadManifest_1.requireStagingUploadManifest)(schoolId, projectId);
        const paths = (0, daSilvaUploadManifest_1.pathsFromStagingUploadManifest)(manifest);
        const preview = await (0, daSilvaMigrationPreview_1.previewDaSilvaSasamsParentsLinks)({ schoolId, projectId });
        if (!preview.passed) {
            return res.status(400).json({
                error: "SA-SAMS parent/link validation must pass before importing parents",
                preview,
            });
        }
        const importManifest = (0, daSilvaMigrationService_1.loadDaSilvaManifest)(schoolId, projectId);
        if (!importManifest?.phasesCompleted?.includes("learners")) {
            return res.status(400).json({ error: "Phase 2 (learners) must complete first" });
        }
        const result = await (0, daSilvaMigrationService_1.commitDaSilvaParentsOnly)({
            schoolId,
            projectId,
            paths: {
                parentRegister: paths.parentRegister,
                parentLearnerLinks: paths.parentLearnerLinks,
            },
        });
        return res.json(result);
    }
    catch (e) {
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
        const manifest = (0, daSilvaUploadManifest_1.requireStagingUploadManifest)(schoolId, projectId);
        const paths = (0, daSilvaUploadManifest_1.pathsFromStagingUploadManifest)(manifest);
        const preview = await (0, daSilvaMigrationPreview_1.previewDaSilvaKideesysBillingMatch)({ schoolId, projectId });
        if (!preview.passed) {
            return res.status(400).json({
                error: "Kid-e-Sys billing match validation must pass before import",
                preview,
            });
        }
        const importManifest = (0, daSilvaMigrationService_1.loadDaSilvaManifest)(schoolId, projectId);
        if (!importManifest?.phasesCompleted?.includes("parents")) {
            return res.status(400).json({ error: "Phase 3 (parents) must complete first" });
        }
        const result = await (0, daSilvaMigrationService_1.commitDaSilvaBillingMatchOnly)({
            schoolId,
            projectId,
            paths: {
                classListDir: paths.classListDir,
                ageAnalysis: paths.ageAnalysis,
            },
        });
        return res.json(result);
    }
    catch (e) {
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
        const manifest = (0, daSilvaUploadManifest_1.requireStagingUploadManifest)(schoolId, projectId);
        const paths = (0, daSilvaUploadManifest_1.pathsFromStagingUploadManifest)(manifest);
        const preview = await (0, daSilvaMigrationPreview_1.previewDaSilvaBillingImport)({ schoolId, projectId });
        if (!preview.passed) {
            return res.status(400).json({
                error: "Billing import validation must pass before import",
                preview,
            });
        }
        const importManifest = (0, daSilvaMigrationService_1.loadDaSilvaManifest)(schoolId, projectId);
        if (!importManifest?.phasesCompleted?.includes("billing_match")) {
            return res.status(400).json({ error: "Phase 4 (billing match) must complete first" });
        }
        const result = await (0, daSilvaMigrationService_1.commitDaSilvaBillingOnly)({
            schoolId,
            projectId,
            paths: {
                classListDir: paths.classListDir,
                billingPlan: paths.billingPlan,
                ageAnalysis: paths.ageAnalysis,
            },
        });
        return res.json(result);
    }
    catch (e) {
        if (e instanceof daSilvaFinalImportGate_1.DaSilvaFinalImportBlockedError) {
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
        const result = await (0, daSilvaMigrationService_1.rollbackDaSilvaMigration)({ schoolId, projectId });
        return res.json(result);
    }
    catch (e) {
        const message = e instanceof Error ? e.message : "Rollback failed";
        return res.status(500).json({ error: message });
    }
});
exports.default = router;
