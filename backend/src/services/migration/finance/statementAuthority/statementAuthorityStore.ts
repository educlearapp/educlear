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
import {
  ensureMigrationArtifactWriteDir,
  getMigrationArtifactLegacyDir,
  resolveMigrationArtifactReadPath,
} from "../../core/migrationPersistentArtifacts";

const CHECK_KEY = "statement-authority";
const BASELINE_KEY = "statement-baselines";
const CHECK_DIR = ensureMigrationArtifactWriteDir(CHECK_KEY);
const BASELINE_DIR = ensureMigrationArtifactWriteDir(BASELINE_KEY);

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

function readJson<T>(artifactKey: string, writeDir: string, id: string): T | null {
  try {
    const safe = sanitizeId(id);
    if (!safe) return null;
    const dual = resolveMigrationArtifactReadPath(artifactKey, safe);
    if (dual) return JSON.parse(fs.readFileSync(dual, "utf8")) as T;
    // Explicit legacy fallback if helper missed nested layouts
    const legacy = path.join(getMigrationArtifactLegacyDir(artifactKey), `${safe}.json`);
    if (fs.existsSync(legacy)) return JSON.parse(fs.readFileSync(legacy, "utf8")) as T;
    const primary = path.join(writeDir, `${safe}.json`);
    if (fs.existsSync(primary)) return JSON.parse(fs.readFileSync(primary, "utf8")) as T;
    return null;
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
  return readJson(CHECK_KEY, CHECK_DIR, checkId);
}

export function getStatementAuthorityCheckByStage(
  stageId: string
): MigrationStatementAuthorityCheck | null {
  return readJson(CHECK_KEY, CHECK_DIR, `stage_${stageId}`);
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
  return readJson(BASELINE_KEY, BASELINE_DIR, `stage_${stageId}`);
}

export function getStatementBaseline(
  baselineId: string
): MigrationStatementBaselineArtifact | null {
  return readJson(BASELINE_KEY, BASELINE_DIR, baselineId);
}
