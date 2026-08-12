/**
 * Preserve prior age-analysis snapshots for audit (never silent delete).
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { FamilyAccountAgeAnalysisSnapshot } from "../../../../utils/familyAccountAgeAnalysisStore";
import type { AgeAnalysisArchiveRecord } from "./MigrationStatementAuthority";

const DIR = path.join(process.cwd(), "storage", "migration-age-analysis-archives");

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

export function archiveAgeAnalysisSnapshots(input: {
  schoolId: string;
  migrationRunId: string;
  stageId: string;
  reason: string;
  priorSnapshots: Record<string, FamilyAccountAgeAnalysisSnapshot>;
}): AgeAnalysisArchiveRecord {
  ensureDir();
  const archiveId = `aa_arch_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const prior: AgeAnalysisArchiveRecord["priorSnapshots"] = {};
  for (const [ref, snap] of Object.entries(input.priorSnapshots)) {
    prior[ref] = {
      accountRef: snap.accountRef,
      balance: snap.balance,
      importedAt: snap.importedAt,
      source: snap.source,
      accountHolder: snap.accountHolder,
      buckets: { ...snap.buckets },
    };
  }
  const record: AgeAnalysisArchiveRecord = {
    archiveId,
    archivedAt: new Date().toISOString(),
    schoolId: input.schoolId,
    migrationRunId: input.migrationRunId,
    stageId: input.stageId,
    reason: input.reason,
    priorSnapshots: prior,
  };
  const safe = sanitizeId(archiveId);
  if (!safe) throw new Error("Invalid archive id");
  const fp = path.join(DIR, `${safe}.json`);
  fs.writeFileSync(fp, JSON.stringify(record, null, 2), "utf8");
  return record;
}

export function getAgeAnalysisArchive(archiveId: string): AgeAnalysisArchiveRecord | null {
  try {
    const safe = sanitizeId(archiveId);
    if (!safe) return null;
    const fp = path.join(DIR, `${safe}.json`);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf8")) as AgeAnalysisArchiveRecord;
  } catch {
    return null;
  }
}
