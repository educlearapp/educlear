/**
 * JSON stores for statement authority checks and baselines.
 */

import fs from "fs";
import path from "path";
import type {
  MigrationStatementAuthorityCheck,
  MigrationStatementBaselineArtifact,
} from "./MigrationStatementAuthority";
import { MIGRATION_STATEMENT_AUTHORITY_VERSION } from "./MigrationStatementAuthority";

const CHECK_DIR = path.join(process.cwd(), "storage", "migration-statement-authority");
const BASELINE_DIR = path.join(process.cwd(), "storage", "migration-statement-baselines");

function ensure(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sanitizeId(id: string): string | null {
  const trimmed = String(id || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function writeJson(dir: string, id: string, data: unknown): void {
  ensure(dir);
  const safe = sanitizeId(id);
  if (!safe) throw new Error("Invalid id");
  const fp = path.resolve(dir, `${safe}.json`);
  if (!fp.startsWith(path.resolve(dir) + path.sep)) throw new Error("Invalid path");
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, fp);
}

function readJson<T>(dir: string, id: string): T | null {
  try {
    const safe = sanitizeId(id);
    if (!safe) return null;
    const fp = path.join(dir, `${safe}.json`);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf8")) as T;
  } catch {
    return null;
  }
}

export function saveStatementAuthorityCheck(
  check: MigrationStatementAuthorityCheck
): MigrationStatementAuthorityCheck {
  const next = { ...check, authorityVersion: MIGRATION_STATEMENT_AUTHORITY_VERSION };
  writeJson(CHECK_DIR, next.checkId, next);
  writeJson(CHECK_DIR, `stage_${next.stageId}`, next);
  return next;
}

export function getStatementAuthorityCheck(
  checkId: string
): MigrationStatementAuthorityCheck | null {
  return readJson(CHECK_DIR, checkId);
}

export function getStatementAuthorityCheckByStage(
  stageId: string
): MigrationStatementAuthorityCheck | null {
  return readJson(CHECK_DIR, `stage_${stageId}`);
}

export function saveStatementBaseline(
  baseline: MigrationStatementBaselineArtifact
): MigrationStatementBaselineArtifact {
  const next = { ...baseline, authorityVersion: MIGRATION_STATEMENT_AUTHORITY_VERSION };
  writeJson(BASELINE_DIR, next.baselineId, next);
  writeJson(BASELINE_DIR, `stage_${next.stageId}`, next);
  return next;
}

export function getStatementBaselineByStage(
  stageId: string
): MigrationStatementBaselineArtifact | null {
  return readJson(BASELINE_DIR, `stage_${stageId}`);
}

export function getStatementBaseline(
  baselineId: string
): MigrationStatementBaselineArtifact | null {
  return readJson(BASELINE_DIR, baselineId);
}
