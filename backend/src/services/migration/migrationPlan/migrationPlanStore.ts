/**
 * JSON store for CompiledMigrationPlan — bound to school + analysis fingerprints.
 */

import fs from "fs";
import path from "path";
import type { CompiledMigrationPlan } from "./CompiledMigrationPlan";
import { COMPILED_MIGRATION_PLAN_VERSION } from "./CompiledMigrationPlan";

const PLANS_DIR = path.join(process.cwd(), "storage", "migration-compiled-plans");

function ensureDir(): void {
  if (!fs.existsSync(PLANS_DIR)) {
    fs.mkdirSync(PLANS_DIR, { recursive: true });
  }
}

function sanitizeId(id: string): string | null {
  const trimmed = String(id || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function planPath(planId: string): string {
  const safe = sanitizeId(planId);
  if (!safe) throw new Error("Invalid plan id");
  const resolved = path.resolve(PLANS_DIR, `${safe}.json`);
  if (!resolved.startsWith(path.resolve(PLANS_DIR) + path.sep)) {
    throw new Error("Invalid plan path");
  }
  return resolved;
}

export function saveCompiledPlan(plan: CompiledMigrationPlan): CompiledMigrationPlan {
  ensureDir();
  if (!String(plan.targetSchoolId || "").trim()) {
    throw new Error("targetSchoolId is required");
  }
  if (!String(plan.sourceAnalysisId || "").trim()) {
    throw new Error("sourceAnalysisId is required");
  }
  const next: CompiledMigrationPlan = {
    ...plan,
    planVersion: COMPILED_MIGRATION_PLAN_VERSION,
    updatedAt: new Date().toISOString(),
  };
  const filePath = planPath(next.planId);
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
  return next;
}

export function getCompiledPlan(planId: string): CompiledMigrationPlan | null {
  const safe = sanitizeId(planId);
  if (!safe) return null;
  const filePath = planPath(safe);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as CompiledMigrationPlan;
    return raw;
  } catch {
    return null;
  }
}

/** Return plan only when school (+ optional analysis) match. */
export function getBoundCompiledPlan(
  planId: string,
  opts: { targetSchoolId: string; sourceAnalysisId?: string }
): CompiledMigrationPlan | null {
  const plan = getCompiledPlan(planId);
  if (!plan) return null;
  if (plan.targetSchoolId !== String(opts.targetSchoolId || "").trim()) return null;
  if (
    opts.sourceAnalysisId &&
    plan.sourceAnalysisId !== String(opts.sourceAnalysisId || "").trim()
  ) {
    return null;
  }
  return plan;
}
