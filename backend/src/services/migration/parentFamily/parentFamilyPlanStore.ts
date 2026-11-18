import fs from "fs";
import path from "path";
import type {
  ParentFamilyApplyResult,
  ParentFamilyCheck,
  ParentFamilyDiscovery,
  ParentFamilyMigrationPlan,
} from "./ParentFamilyMigrationTypes";
import {
  ensureMigrationArtifactWriteDir,
  getMigrationArtifactLegacyDir,
  getMigrationArtifactWriteDir,
} from "../core/migrationPersistentArtifacts";

const ARTIFACT_KEY = "parent-family";
const ROOT = (() => ensureMigrationArtifactWriteDir(ARTIFACT_KEY))();

function ensureDir(sub?: string): string {
  const dir = sub ? path.join(ROOT, sub) : ROOT;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readDirs(sub: string): string[] {
  return [
    path.join(getMigrationArtifactWriteDir(ARTIFACT_KEY), sub),
    path.join(getMigrationArtifactLegacyDir(ARTIFACT_KEY), sub),
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
  if (!safe) throw new Error("Invalid parent-family artifact id");
  const fp = path.join(dir, `${safe}.json`);
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, fp);
}

function readJson<T>(dirOrDirs: string | string[], id: string): T | null {
  const safe = sanitizeId(id);
  if (!safe) return null;
  const dirs = Array.isArray(dirOrDirs) ? dirOrDirs : [dirOrDirs];
  for (const dir of dirs) {
    try {
      const fp = path.join(dir, `${safe}.json`);
      if (!fs.existsSync(fp)) continue;
      return JSON.parse(fs.readFileSync(fp, "utf8")) as T;
    } catch {
      /* try next */
    }
  }
  return null;
}

export function saveParentFamilyDiscovery(d: ParentFamilyDiscovery): ParentFamilyDiscovery {
  const dir = ensureDir("discoveries");
  writeJson(dir, d.discoveryId, d);
  if (d.stageId) writeJson(dir, `stage_${d.stageId}`, d);
  return d;
}

export function saveParentFamilyPlan(plan: ParentFamilyMigrationPlan): ParentFamilyMigrationPlan {
  const dir = ensureDir("plans");
  writeJson(dir, plan.planId, plan);
  if (plan.stageId) writeJson(dir, `stage_${plan.stageId}`, plan);
  return plan;
}

export function getParentFamilyPlan(planId: string): ParentFamilyMigrationPlan | null {
  return readJson(readDirs("plans"), planId);
}

export function getParentFamilyPlanByStage(stageId: string): ParentFamilyMigrationPlan | null {
  return readJson(readDirs("plans"), `stage_${stageId}`);
}

export function saveParentFamilyCheck(check: ParentFamilyCheck): ParentFamilyCheck {
  const dir = ensureDir("checks");
  writeJson(dir, check.checkId, check);
  if (check.stageId) writeJson(dir, `stage_${check.stageId}`, check);
  return check;
}

export function getParentFamilyCheck(checkId: string): ParentFamilyCheck | null {
  return readJson(readDirs("checks"), checkId);
}

export function getParentFamilyCheckByStage(stageId: string): ParentFamilyCheck | null {
  return readJson(readDirs("checks"), `stage_${stageId}`);
}

export function saveParentFamilyApply(result: ParentFamilyApplyResult): ParentFamilyApplyResult {
  const dir = ensureDir("applies");
  writeJson(dir, result.applyId, result);
  writeJson(dir, `plan_${result.planId}`, result);
  return result;
}

export function getParentFamilyApplyByPlan(planId: string): ParentFamilyApplyResult | null {
  return readJson(readDirs("applies"), `plan_${planId}`);
}
