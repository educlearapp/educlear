import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { type Request, type Response, Router } from "express";
import multer from "multer";

const router = Router();

const SCHOOL_ID = "cmq4xjckq00at60gqg4eb956h";
const SCHOOL_NAME = "Magical Bright Beginnings";
const MAX_FILE_BYTES = 80 * 1024 * 1024;
const MAX_FILES = 32;

const CLASS_FILES = new Set([
  "class_list.xls",
  "class_list (1).xls",
  "class_list (2).xls",
  "class_list (3).xls",
  "class_list (4).xls",
  "class_list (5).xls",
  "class_list (6).xls",
  "class_list (7).xls",
  "class_list (8).xls",
  "class_list (9).xls",
  "class_list (10).xls",
  "class_list (12).xls",
  "class_list (14).xls",
  "class_list (15).xls",
  "class_list (16).xls",
  "class_list (17).xls",
  "class_list (18).xls",
]);

const ROOT_FILES = new Set([
  "child_list_(6_extra_fields) (2).xls",
  "sibling_accounts.xls",
  "contact_list.xls",
  "birthday_employee_list.xls",
  "billing_plan_summary_by_child.xls",
  "account_list_(age_analysis).xls",
  "transaction_list-2.xls",
  "payment_receive_list.pdf",
]);

function uploadRoot() {
  const root = path.join(process.cwd(), "uploads", "mbb-direct-import");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function safeName(value: string) {
  return path.basename(String(value || "upload").replace(/\0/g, ""));
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadRoot()),
    filename: (_req, file, cb) => {
      const suffix = crypto.randomBytes(8).toString("hex");
      cb(null, `${Date.now()}-${suffix}-${safeName(file.originalname)}`);
    },
  }),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES },
});

function prepareImportFolder(files: Express.Multer.File[]) {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const root = path.join(uploadRoot(), `run-${runId}`);
  const classDir = path.join(root, "MBB class list");
  fs.mkdirSync(classDir, { recursive: true });

  const seen = new Set<string>();
  for (const file of files) {
    const original = safeName(file.originalname);
    if (CLASS_FILES.has(original)) {
      fs.copyFileSync(file.path, path.join(classDir, original));
      seen.add(original);
    } else if (ROOT_FILES.has(original)) {
      fs.copyFileSync(file.path, path.join(root, original));
      seen.add(original);
    }
  }

  const required = [...CLASS_FILES, ...ROOT_FILES].filter((name) => name !== "payment_receive_list.pdf");
  const missing = required.filter((name) => !seen.has(name));
  return { root, classDir, missing };
}

function parseCountComparison(stdout: string) {
  return JSON.parse(stdout.trim()) as {
    schoolId: string;
    schoolName: string;
    counts: Record<string, { imported: number; exported: number }>;
  };
}

function runImporter(
  root: string,
  classDir: string,
  opts: { repairMissingLearners?: boolean } = {}
): Promise<{ stdout: string; stderr: string }> {
  const script = path.join(process.cwd(), "scripts", "emergency-direct-import-mbb.mjs");
  const args = [
    script,
    "--write",
    "--desktop-dir",
    root,
    "--class-dir",
    classDir,
    "--approve-school-id",
    SCHOOL_ID,
    "--confirm-live-write",
    "MBB_DIRECT_IMPORT",
    "--counts-only",
  ];
  if (opts.repairMissingLearners) args.push("--repair-missing-learners");

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      args,
      {
        cwd: process.cwd(),
        env: { ...process.env, CONFIRM_PRODUCTION_WRITE: "true" },
      }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      const error = new Error(`MBB direct import failed with exit code ${code}`);
      Object.assign(error, { stdout, stderr });
      return reject(error);
    });
  });
}

async function prepareAndRun(
  req: Request,
  res: Response,
  opts: { repairMissingLearners?: boolean } = {}
) {
  const started = Date.now();
  try {
    const files = Array.isArray(req.files) ? (req.files as Express.Multer.File[]) : [];
    if (!files.length) {
      return res.status(400).json({ success: false, error: "Upload the MBB Kid-e-Sys files as files" });
    }

    const { root, classDir, missing } = prepareImportFolder(files);
    if (missing.length) {
      return res.status(400).json({ success: false, error: "Missing required MBB files", missing });
    }

    const { stdout } = await runImporter(root, classDir, opts);
    const comparison = parseCountComparison(stdout);
    return res.json({
      success: true,
      ...comparison,
      executionTimeMs: Date.now() - started,
    });
  } catch (error: unknown) {
    const err = error as Error & { stdout?: string; stderr?: string };
    return res.status(500).json({
      success: false,
      error: err.message || "MBB direct import failed",
      stdout: err.stdout,
      stderr: err.stderr,
      executionTimeMs: Date.now() - started,
    });
  }
}

router.post("/run", upload.array("files", MAX_FILES), async (req, res) => {
  return prepareAndRun(req, res);
});

router.post("/repair-missing-learners", upload.array("files", MAX_FILES), async (req, res) => {
  return prepareAndRun(req, res, { repairMissingLearners: true });
});

export default router;
