/**
 * Persist academic plans / checks / apply results under storage/.
 */

import fs from "fs";
import path from "path";
import type {
  AcademicApplyResult,
  AcademicMigrationPlan,
  AcademicStructureCheck,
  AcademicStructureDiscovery,
} from "./AcademicMigrationTypes";

const ROOT = path.join(process.cwd(), "storage", "migration-academic");

function ensureDir(sub?: string): string {
  const dir = sub ? path.join(ROOT, sub) : ROOT;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
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
  if (!safe) throw new Error("Invalid academic artifact id");
  const fp = path.join(dir, `${safe}.json`);
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

export function saveAcademicDiscovery(
  d: AcademicStructureDiscovery
): AcademicStructureDiscovery {
  const dir = ensureDir("discoveries");
  writeJson(dir, d.discoveryId, d);
  if (d.stageId) writeJson(dir, `stage_${d.stageId}`, d);
  return d;
}

export function saveAcademicPlan(plan: AcademicMigrationPlan): AcademicMigrationPlan {
  const dir = ensureDir("plans");
  writeJson(dir, plan.planId, plan);
  if (plan.stageId) writeJson(dir, `stage_${plan.stageId}`, plan);
  return plan;
}

export function getAcademicPlan(planId: string): AcademicMigrationPlan | null {
  return readJson(ensureDir("plans"), planId);
}

export function getAcademicPlanByStage(stageId: string): AcademicMigrationPlan | null {
  return readJson(ensureDir("plans"), `stage_${stageId}`);
}

export function saveAcademicCheck(check: AcademicStructureCheck): AcademicStructureCheck {
  const dir = ensureDir("checks");
  writeJson(dir, check.checkId, check);
  if (check.stageId) writeJson(dir, `stage_${check.stageId}`, check);
  return check;
}

export function getAcademicCheck(checkId: string): AcademicStructureCheck | null {
  return readJson(ensureDir("checks"), checkId);
}

export function getAcademicCheckByStage(stageId: string): AcademicStructureCheck | null {
  return readJson(ensureDir("checks"), `stage_${stageId}`);
}

export function saveAcademicApply(result: AcademicApplyResult): AcademicApplyResult {
  const dir = ensureDir("applies");
  writeJson(dir, result.applyId, result);
  writeJson(dir, `plan_${result.academicPlanId}`, result);
  return result;
}

export function getAcademicApplyByPlan(planId: string): AcademicApplyResult | null {
  return readJson(ensureDir("applies"), `plan_${planId}`);
}

export function markAcademicPlanStale(planId: string, reason: string): void {
  const plan = getAcademicPlan(planId);
  if (!plan) return;
  plan.stale = true;
  plan.warnings = [...plan.warnings, `STALE: ${reason}`];
  saveAcademicPlan(plan);
  if (plan.stageId) {
    const check = getAcademicCheckByStage(plan.stageId);
    if (check) {
      check.stale = true;
      check.status = "ACADEMIC_STALE";
      check.academicStructureMatch = false;
      check.blockedReasons = [...check.blockedReasons, reason];
      saveAcademicCheck(check);
    }
  }
}
