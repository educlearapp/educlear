/**
 * Persisted Migration Centre integrity findings (local staging JSON only).
 * Never writes production school data.
 */

import fs from "fs";
import path from "path";

export type MigrationIntegrityFinding = {
  findingId: string;
  severity: "BLOCKING" | "WARNING";
  title: string;
  message: string;
  learnerKeys?: string[];
  accountRef?: string;
};

export type MigrationIntegrityRecord = {
  stageId: string;
  targetSchoolId: string;
  updatedAt: string;
  findings: MigrationIntegrityFinding[];
  blockingCount: number;
};

const DIR = path.join(process.cwd(), "storage", "migration-integrity");

function ensureDir(): void {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}

function sanitizeId(id: string): string | null {
  const trimmed = String(id || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function filePath(stageId: string): string {
  const safe = sanitizeId(stageId);
  if (!safe) throw new Error("Invalid integrity stage id");
  const resolved = path.resolve(DIR, `stage_${safe}.json`);
  if (!resolved.startsWith(path.resolve(DIR) + path.sep)) {
    throw new Error("Invalid integrity path");
  }
  return resolved;
}

export function saveMigrationIntegrity(record: MigrationIntegrityRecord): MigrationIntegrityRecord {
  ensureDir();
  const fp = filePath(record.stageId);
  const tmp = `${fp}.${process.pid}.tmp`;
  const blockingCount = record.findings.filter((f) => f.severity === "BLOCKING").length;
  const payload: MigrationIntegrityRecord = {
    ...record,
    blockingCount,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmp, fp);
  return payload;
}

export function getMigrationIntegrityByStage(stageId: string): MigrationIntegrityRecord | null {
  try {
    const fp = filePath(stageId);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf8")) as MigrationIntegrityRecord;
  } catch {
    return null;
  }
}

export function evaluateMigrationIntegrityGate(record: MigrationIntegrityRecord | null): {
  canAccept: boolean;
  blockingMessages: string[];
} {
  if (!record) {
    return { canAccept: true, blockingMessages: [] };
  }
  const blockingMessages = record.findings
    .filter((f) => f.severity === "BLOCKING")
    .map((f) => f.message);
  return { canAccept: blockingMessages.length === 0, blockingMessages };
}
