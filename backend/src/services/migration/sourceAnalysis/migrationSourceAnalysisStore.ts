/**
 * File JSON store for MigrationSourceAnalysis — bound to stage/run + targetSchoolId.
 */

import fs from "fs";
import path from "path";
import type { MigrationSourceAnalysis } from "./MigrationSourceAnalysis";
import { MIGRATION_SOURCE_ANALYSIS_VERSION } from "./MigrationSourceAnalysis";

const ANALYSES_DIR = path.join(process.cwd(), "storage", "migration-source-analyses");

function ensureDir(): void {
  if (!fs.existsSync(ANALYSES_DIR)) {
    fs.mkdirSync(ANALYSES_DIR, { recursive: true });
  }
}

function sanitizeId(id: string): string | null {
  const trimmed = String(id || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function analysisPath(analysisId: string): string {
  const safe = sanitizeId(analysisId);
  if (!safe) throw new Error("Invalid analysis id");
  const resolved = path.resolve(ANALYSES_DIR, `${safe}.json`);
  if (!resolved.startsWith(path.resolve(ANALYSES_DIR) + path.sep)) {
    throw new Error("Invalid analysis path");
  }
  return resolved;
}

export function saveSourceAnalysis(analysis: MigrationSourceAnalysis): MigrationSourceAnalysis {
  ensureDir();
  if (!String(analysis.targetSchoolId || "").trim()) {
    throw new Error("targetSchoolId is required");
  }
  const next = {
    ...analysis,
    analysisVersion: MIGRATION_SOURCE_ANALYSIS_VERSION,
    updatedAt: new Date().toISOString(),
  };
  const filePath = analysisPath(next.analysisId);
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
  return next;
}

export function getSourceAnalysis(analysisId: string): MigrationSourceAnalysis | null {
  const safe = sanitizeId(analysisId);
  if (!safe) return null;
  const filePath = analysisPath(safe);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as MigrationSourceAnalysis;
  } catch {
    return null;
  }
}

/** Return analysis only when school (+ optional stage) binding matches. */
export function getBoundSourceAnalysis(
  analysisId: string,
  opts: { targetSchoolId: string; stageId?: string | null; migrationRunId?: string | null }
): MigrationSourceAnalysis | null {
  const analysis = getSourceAnalysis(analysisId);
  if (!analysis) return null;
  const schoolId = String(opts.targetSchoolId || "").trim();
  if (!schoolId || analysis.targetSchoolId !== schoolId) return null;
  if (opts.stageId && analysis.stageId && analysis.stageId !== opts.stageId) return null;
  if (
    opts.migrationRunId &&
    analysis.migrationRunId &&
    analysis.migrationRunId !== opts.migrationRunId &&
    analysis.stageId !== opts.migrationRunId
  ) {
    return null;
  }
  return analysis;
}

export function listSourceAnalysesForSchool(targetSchoolId: string): MigrationSourceAnalysis[] {
  ensureDir();
  const schoolId = String(targetSchoolId || "").trim();
  if (!schoolId) return [];
  const out: MigrationSourceAnalysis[] = [];
  for (const name of fs.readdirSync(ANALYSES_DIR)) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(
        fs.readFileSync(path.join(ANALYSES_DIR, name), "utf8")
      ) as MigrationSourceAnalysis;
      if (raw.targetSchoolId === schoolId) out.push(raw);
    } catch {
      // skip corrupt
    }
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
