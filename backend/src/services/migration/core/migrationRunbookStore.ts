import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { MigrationRunbook, MigrationRunbookPatch } from "../types/MigrationRunbook";
import { buildDaSilvaRunbook, computeRunbookOverallStatus } from "./buildDaSilvaRunbook";

const RUNBOOKS_DIR = path.join(process.cwd(), "storage", "migration-runbooks");

export function ensureMigrationRunbooksDir(): void {
  if (!fs.existsSync(RUNBOOKS_DIR)) {
    fs.mkdirSync(RUNBOOKS_DIR, { recursive: true });
  }
}

function sanitizeRunbookId(id: string): string | null {
  const trimmed = String(id || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function runbookFilePath(id: string): string {
  const safe = sanitizeRunbookId(id);
  if (!safe) throw new Error("Invalid runbook id");
  const resolved = path.resolve(RUNBOOKS_DIR, `${safe}.json`);
  if (!resolved.startsWith(path.resolve(RUNBOOKS_DIR) + path.sep)) {
    throw new Error("Invalid runbook path");
  }
  return resolved;
}

function writeRunbookFile(runbook: MigrationRunbook): void {
  const filePath = runbookFilePath(runbook.runbookId);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(runbook, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

export function createRunbook(input: {
  schoolId: string;
  schoolName: string;
  sourceSystem?: string;
  pilotId?: string;
  notes?: string;
  runbookId?: string;
  createdAt?: string;
}): MigrationRunbook {
  ensureMigrationRunbooksDir();
  const runbookId = input.runbookId?.trim() || randomUUID();
  const safeId = sanitizeRunbookId(runbookId);
  if (!safeId) throw new Error("Invalid runbook id");

  const filePath = runbookFilePath(safeId);
  if (fs.existsSync(filePath)) {
    throw new Error("Runbook id already exists");
  }

  const runbook = buildDaSilvaRunbook({
    runbookId: safeId,
    schoolId: String(input.schoolId || "").trim(),
    schoolName: String(input.schoolName || "").trim(),
    sourceSystem: String(input.sourceSystem || "kideesys").trim() || "kideesys",
    pilotId: String(input.pilotId || "").trim(),
    notes: String(input.notes || "").trim(),
    createdAt: input.createdAt ?? new Date().toISOString(),
  });

  writeRunbookFile(runbook);
  return runbook;
}

export function getRunbook(runbookId: string): MigrationRunbook | null {
  ensureMigrationRunbooksDir();
  const safeId = sanitizeRunbookId(runbookId);
  if (!safeId) return null;
  const filePath = runbookFilePath(safeId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as MigrationRunbook;
  } catch {
    return null;
  }
}

export function listRunbooks(): MigrationRunbook[] {
  ensureMigrationRunbooksDir();
  const files = fs
    .readdirSync(RUNBOOKS_DIR)
    .filter((name) => name.endsWith(".json") && !name.includes(".tmp"));

  const runbooks: MigrationRunbook[] = [];
  for (const file of files) {
    const id = file.replace(/\.json$/, "");
    const runbook = getRunbook(id);
    if (runbook) runbooks.push(runbook);
  }

  runbooks.sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    return tb - ta;
  });

  return runbooks;
}

export function updateRunbook(runbookId: string, patch: MigrationRunbookPatch): MigrationRunbook {
  const existing = getRunbook(runbookId);
  if (!existing) throw new Error("Runbook not found");

  let steps = [...existing.steps];

  if (Array.isArray(patch.steps)) {
    for (const stepPatch of patch.steps) {
      const stepId = String(stepPatch.stepId || "").trim();
      if (!stepId) continue;
      const index = steps.findIndex((s) => s.stepId === stepId);
      if (index < 0) continue;
      const current = steps[index];
      steps[index] = {
        ...current,
        ...(stepPatch.status !== undefined ? { status: stepPatch.status } : {}),
        ...(stepPatch.notes !== undefined ? { notes: String(stepPatch.notes) } : {}),
      };
    }
  }

  const overallStatus = computeRunbookOverallStatus(steps);

  const merged: MigrationRunbook = {
    ...existing,
    steps,
    overallStatus,
    ...(patch.notes !== undefined ? { notes: String(patch.notes) } : {}),
    ...(patch.pilotId !== undefined
      ? { pilotId: patch.pilotId == null ? "" : String(patch.pilotId).trim() }
      : {}),
  };

  writeRunbookFile(merged);
  return merged;
}
