import fs from "fs";
import path from "path";
import type { OrchestratorRunRecord, UniversalMigrationReadiness } from "./OrchestratorTypes";
import {
  ensureMigrationArtifactWriteDir,
  getMigrationArtifactLegacyDir,
  getMigrationArtifactWriteDir,
} from "../core/migrationPersistentArtifacts";

const ARTIFACT = "orchestrator";

function writeRoot(sub: string): string {
  const base = ensureMigrationArtifactWriteDir(ARTIFACT);
  const dir = path.join(base, sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readRoots(sub: string): string[] {
  return [
    path.join(getMigrationArtifactWriteDir(ARTIFACT), sub),
    path.join(getMigrationArtifactLegacyDir(ARTIFACT), sub),
  ];
}

function sanitizeId(id: string): string | null {
  const trimmed = String(id || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function writeJson(dir: string, id: string, data: unknown): void {
  const safe = sanitizeId(id);
  if (!safe) throw new Error("Invalid orchestrator artifact id");
  const fp = path.join(dir, `${safe}.json`);
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, fp);
}

function readJson<T>(dirs: string[], id: string): T | null {
  const safe = sanitizeId(id);
  if (!safe) return null;
  for (const dir of dirs) {
    try {
      const fp = path.join(dir, `${safe}.json`);
      if (!fs.existsSync(fp)) continue;
      return JSON.parse(fs.readFileSync(fp, "utf8")) as T;
    } catch {
      /* try next root */
    }
  }
  return null;
}

/** In-process Completing locks (process-local concurrency guard). */
const completingLocks = new Set<string>();

export function tryAcquireCompleteLock(stageId: string): boolean {
  if (completingLocks.has(stageId)) return false;
  completingLocks.add(stageId);
  return true;
}

export function releaseCompleteLock(stageId: string): void {
  completingLocks.delete(stageId);
}

export function saveOrchestratorReadiness(
  readiness: UniversalMigrationReadiness
): UniversalMigrationReadiness {
  const dir = writeRoot("readiness");
  writeJson(dir, readiness.readinessId, readiness);
  if (readiness.stageId) writeJson(dir, `stage_${readiness.stageId}`, readiness);
  return readiness;
}

export function getOrchestratorReadinessByStage(
  stageId: string
): UniversalMigrationReadiness | null {
  return readJson(readRoots("readiness"), `stage_${stageId}`);
}

export function saveOrchestratorRun(run: OrchestratorRunRecord): OrchestratorRunRecord {
  const dir = writeRoot("runs");
  writeJson(dir, run.runId, run);
  writeJson(dir, `stage_${run.stageId}`, run);
  return run;
}

export function getOrchestratorRunByStage(stageId: string): OrchestratorRunRecord | null {
  return readJson(readRoots("runs"), `stage_${stageId}`);
}
