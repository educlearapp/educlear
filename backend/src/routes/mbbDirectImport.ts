import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { type Request, type Response, Router } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { prisma } from "../prisma";

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

type ParsedMbbGroup = {
  sourceFile: string;
  sheetName: string;
  rowNumber: number;
  name: string;
  comments: string;
  status?: "ready" | "skip";
  reason?: string;
};

function jsonError(res: Response, status: number, message: string) {
  return res.status(status).json({ success: false, error: message });
}

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

function normalizeName(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeKey(value: unknown) {
  return normalizeName(value).toLowerCase();
}

function groupId() {
  return `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isAcceptedGroupsFile(fileName: string) {
  return new Set([".csv", ".xls", ".xlsx"]).has(path.extname(fileName).toLowerCase());
}

function assertSelectedMbbSchool(schoolId: string) {
  if (schoolId !== SCHOOL_ID) {
    throw new Error(`Import MBB Groups can only write to ${SCHOOL_NAME}.`);
  }
}

function pickHeaderColumn(headers: string[], labels: string[]) {
  return headers.findIndex((header) => labels.includes(header));
}

function parseGroupRowsFromFile(file: Express.Multer.File): ParsedMbbGroup[] {
  const workbook = XLSX.readFile(file.path, { raw: false });
  const rows: ParsedMbbGroup[] = [];
  const nameLabels = ["group", "group name", "groups", "name", "class group", "activity group"];
  const commentLabels = ["comments", "comment", "notes", "note", "description"];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    });
    if (!matrix.length) continue;

    const firstRow = Array.isArray(matrix[0])
      ? matrix[0].map((cell) => normalizeName(cell).toLowerCase())
      : [];
    const nameColumn = pickHeaderColumn(firstRow, nameLabels);
    const commentsColumn = pickHeaderColumn(firstRow, commentLabels);
    const hasHeader = nameColumn >= 0 || commentsColumn >= 0;
    const dataRows = hasHeader ? matrix.slice(1) : matrix;

    dataRows.forEach((row, index) => {
      const cells = Array.isArray(row) ? row : [];
      const name = normalizeName(cells[hasHeader && nameColumn >= 0 ? nameColumn : 0]);
      const comments = normalizeName(cells[hasHeader && commentsColumn >= 0 ? commentsColumn : 1]);
      if (!name) return;
      rows.push({
        sourceFile: safeName(file.originalname),
        sheetName,
        rowNumber: index + (hasHeader ? 2 : 1),
        name,
        comments,
      });
    });
  }

  return rows;
}

async function verifyMbbSchool() {
  const rows = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
    SELECT "id", "name"
    FROM "School"
    WHERE "id" = ${SCHOOL_ID}
    LIMIT 1
  `;
  const school = rows[0];
  if (!school || school.name !== SCHOOL_NAME) {
    throw new Error(`${SCHOOL_NAME} school record was not found.`);
  }
}

async function existingGroupKeys() {
  const existingRows = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT "name"
    FROM "Group"
    WHERE "schoolId" = ${SCHOOL_ID}
  `;
  return new Set(existingRows.map((row) => normalizeKey(row.name)));
}

async function buildGroupsPreview(parsedRows: ParsedMbbGroup[]) {
  await verifyMbbSchool();
  const existing = await existingGroupKeys();
  const seen = new Set<string>();

  const groups = parsedRows.map((row) => {
    const key = normalizeKey(row.name);
    if (existing.has(key)) {
      return { ...row, status: "skip" as const, reason: "Duplicate group name already exists" };
    }
    if (seen.has(key)) {
      return { ...row, status: "skip" as const, reason: "Duplicate group name in uploaded files" };
    }
    seen.add(key);
    return { ...row, status: "ready" as const, reason: "" };
  });

  const importedPreviewCount = groups.filter((row) => row.status === "ready").length;
  const skippedCount = groups.length - importedPreviewCount;
  return {
    success: true,
    schoolId: SCHOOL_ID,
    schoolName: SCHOOL_NAME,
    groups,
    importedPreviewCount,
    skippedCount,
    totalGroups: groups.length,
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

router.post("/groups/preview", upload.array("files", MAX_FILES), async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    assertSelectedMbbSchool(schoolId);

    const files = Array.isArray(req.files) ? (req.files as Express.Multer.File[]) : [];
    if (!files.length) return jsonError(res, 400, "Upload the MBB Groups Excel/CSV files.");

    const invalid = files.find((file) => !isAcceptedGroupsFile(file.originalname));
    if (invalid) {
      return jsonError(res, 400, `File must be .csv, .xls, or .xlsx: ${safeName(invalid.originalname)}`);
    }

    const parsedRows = files.flatMap(parseGroupRowsFromFile);
    if (!parsedRows.length) return jsonError(res, 400, "No group names found in the uploaded files.");

    return res.json(await buildGroupsPreview(parsedRows));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to preview MBB groups import";
    return jsonError(res, 500, message);
  }
});

router.post("/groups/import", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    assertSelectedMbbSchool(schoolId);
    await verifyMbbSchool();

    const incomingRows = Array.isArray(req.body?.groups) ? req.body.groups : [];
    const existing = await existingGroupKeys();
    const seen = new Set<string>();
    let importedCount = 0;
    let skippedCount = 0;

    for (const row of incomingRows) {
      const name = normalizeName(row?.name);
      const comments = normalizeName(row?.comments);
      const key = normalizeKey(name);
      if (!name || existing.has(key) || seen.has(key)) {
        skippedCount += 1;
        continue;
      }

      seen.add(key);
      const inserted = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "Group" ("id", "schoolId", "name", "comments", "createdAt", "updatedAt")
        VALUES (${groupId()}, ${SCHOOL_ID}, ${name}, ${comments}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("schoolId", "name") DO NOTHING
        RETURNING "id"
      `;
      existing.add(key);
      if (inserted.length > 0) {
        importedCount += 1;
      } else {
        skippedCount += 1;
      }
    }

    return res.json({
      success: true,
      schoolId: SCHOOL_ID,
      schoolName: SCHOOL_NAME,
      importedCount,
      skippedCount,
      totalGroups: incomingRows.length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to import MBB groups";
    return jsonError(res, 500, message);
  }
});

export default router;
