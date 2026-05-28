import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type {
  MigrationApplyCounts,
  MigrationImportBatch,
  MigrationImportReportRow,
} from "../types/MigrationApply";

const BATCHES_DIR = path.join(process.cwd(), "storage", "migration-import-batches");

function ensureBatchesDir(): void {
  if (!fs.existsSync(BATCHES_DIR)) {
    fs.mkdirSync(BATCHES_DIR, { recursive: true });
  }
}

function sanitizeBatchId(id: string): string | null {
  const trimmed = String(id || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function batchFilePath(id: string): string {
  const safe = sanitizeBatchId(id);
  if (!safe) throw new Error("Invalid batch id");
  const resolved = path.resolve(BATCHES_DIR, `${safe}.json`);
  if (!resolved.startsWith(path.resolve(BATCHES_DIR) + path.sep)) {
    throw new Error("Invalid batch path");
  }
  return resolved;
}

function emptyCounts(): MigrationApplyCounts {
  return {
    learners: 0,
    parents: 0,
    employees: 0,
    billingAccounts: 0,
    transactions: 0,
    classrooms: 0,
    parentLearnerLinks: 0,
  };
}

/** Normalize legacy batches that only stored counts/report on `result`. */
export function hydrateImportBatch(raw: MigrationImportBatch): MigrationImportBatch {
  const result = raw.result;
  return {
    ...raw,
    createdCounts: raw.createdCounts ?? result?.createdCounts ?? emptyCounts(),
    skippedCounts: raw.skippedCounts ?? result?.skippedCounts ?? emptyCounts(),
    failedCounts: raw.failedCounts ?? result?.failedCounts ?? emptyCounts(),
    reportRows: raw.reportRows ?? result?.report ?? [],
    completedAt: raw.completedAt ?? result?.appliedAt,
  };
}

export function createMigrationImportBatch(
  partial: Omit<MigrationImportBatch, "batchId" | "createdAt" | "status"> & {
    batchId?: string;
    status?: MigrationImportBatch["status"];
  }
): MigrationImportBatch {
  ensureBatchesDir();
  const batchId = partial.batchId?.trim() || randomUUID();
  const safeId = sanitizeBatchId(batchId);
  if (!safeId) throw new Error("Invalid batch id");

  const filePath = batchFilePath(safeId);
  if (fs.existsSync(filePath)) {
    throw new Error("Import batch id already exists");
  }

  const batch: MigrationImportBatch = {
    batchId: safeId,
    stageId: partial.stageId,
    targetSchoolId: partial.targetSchoolId,
    targetSchoolName: partial.targetSchoolName,
    sourceSystem: partial.sourceSystem,
    status: partial.status ?? "pending",
    createdAt: new Date().toISOString(),
    stagedCounts: partial.stagedCounts,
    createdCounts: partial.createdCounts,
    skippedCounts: partial.skippedCounts,
    failedCounts: partial.failedCounts,
    reportRows: partial.reportRows,
  };

  writeBatchFile(batch);
  return batch;
}

function writeBatchFile(batch: MigrationImportBatch): void {
  const filePath = batchFilePath(batch.batchId);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(batch, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

export function updateImportBatch(
  batchId: string,
  patch: Partial<Omit<MigrationImportBatch, "batchId">>
): MigrationImportBatch {
  const existing = getImportBatch(batchId);
  if (!existing) throw new Error("Import batch not found");
  const merged: MigrationImportBatch = { ...existing, ...patch, batchId: existing.batchId };
  writeBatchFile(merged);
  return merged;
}

/** Full-document replace (used by apply flow). */
export function updateMigrationImportBatch(batch: MigrationImportBatch): MigrationImportBatch {
  writeBatchFile(batch);
  return hydrateImportBatch(batch);
}

export function getImportBatch(batchId: string): MigrationImportBatch | null {
  ensureBatchesDir();
  const safeId = sanitizeBatchId(batchId);
  if (!safeId) return null;
  const filePath = batchFilePath(safeId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as MigrationImportBatch;
    return hydrateImportBatch(raw);
  } catch {
    return null;
  }
}

export function getMigrationImportBatch(batchId: string): MigrationImportBatch | null {
  return getImportBatch(batchId);
}

export function listImportBatches(): MigrationImportBatch[] {
  ensureBatchesDir();
  const files = fs
    .readdirSync(BATCHES_DIR)
    .filter((name) => name.endsWith(".json") && !name.includes(".tmp"));

  const batches: MigrationImportBatch[] = [];
  for (const file of files) {
    const id = file.replace(/\.json$/, "");
    const batch = getImportBatch(id);
    if (batch) batches.push(batch);
  }

  batches.sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    return tb - ta;
  });

  return batches;
}

export function listImportBatchSummaries(): Array<{
  batchId: string;
  stageId: string;
  targetSchoolId: string;
  targetSchoolName: string;
  status: MigrationImportBatch["status"];
  createdAt: string;
  completedAt?: string;
  rolledBackAt?: string;
  createdCounts: MigrationApplyCounts;
  skippedCounts: MigrationApplyCounts;
  failedCounts: MigrationApplyCounts;
  hasCreatedTransactions: boolean;
}> {
  return listImportBatches().map((batch) => {
    const hydrated = hydrateImportBatch(batch);
    const reportRows = hydrated.reportRows ?? [];
    const hasCreatedTransactions = reportRows.some(
      (row) => row.status === "created" && row.entityType === "transaction"
    );
    return {
      batchId: hydrated.batchId,
      stageId: hydrated.stageId,
      targetSchoolId: hydrated.targetSchoolId,
      targetSchoolName: hydrated.targetSchoolName,
      status: hydrated.status,
      createdAt: hydrated.createdAt,
      completedAt: hydrated.completedAt,
      rolledBackAt: hydrated.rolledBackAt,
      createdCounts: hydrated.createdCounts ?? emptyCounts(),
      skippedCounts: hydrated.skippedCounts ?? emptyCounts(),
      failedCounts: hydrated.failedCounts ?? emptyCounts(),
      hasCreatedTransactions,
    };
  });
}

export function getImportBatchReportRows(batchId: string): MigrationImportReportRow[] {
  const batch = getImportBatch(batchId);
  return batch?.reportRows ?? [];
}
