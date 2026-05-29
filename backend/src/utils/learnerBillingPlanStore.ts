import fs from "fs";
import path from "path";

import {
  DA_SILVA_BILLING_DATA_SCHOOL_ID,
  resolveSchoolJsonStoreKey,
} from "../services/daSilvaSchoolResolve";

export type StoredBillingPlanItem = {
  feeDescription: string;
  amount: number;
};

type PlanFile = Record<string, Record<string, StoredBillingPlanItem[]>>;

const CANDIDATE_REL_PATHS = [
  path.join("backend", "data", "learner-billing-plans.json"),
  path.join("data", "learner-billing-plans.json"),
] as const;

function resolveCandidatePaths(): string[] {
  const cwd = process.cwd();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const rel of CANDIDATE_REL_PATHS) {
    const abs = path.resolve(cwd, rel);
    if (!seen.has(abs)) {
      seen.add(abs);
      out.push(abs);
    }
  }
  return out;
}

function parsePlanFile(raw: string): PlanFile {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function countDaSilvaPlansIn(data: PlanFile): number {
  const payload = data[DA_SILVA_BILLING_DATA_SCHOOL_ID];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return 0;
  return Object.keys(payload).length;
}

function countDaSilvaPlansAt(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return countDaSilvaPlansIn(parsePlanFile(raw));
  } catch {
    return 0;
  }
}

function pickPlanFile(): string {
  const candidates = resolveCandidatePaths();
  const stats = candidates.map((candidatePath) => ({
    path: candidatePath,
    exists: fs.existsSync(candidatePath),
    daSilvaPlanCount: countDaSilvaPlansAt(candidatePath),
  }));

  const withDaSilvaPlans = stats.filter((s) => s.exists && s.daSilvaPlanCount > 0);
  if (withDaSilvaPlans.length > 0) {
    withDaSilvaPlans.sort((a, b) => b.daSilvaPlanCount - a.daSilvaPlanCount);
    return withDaSilvaPlans[0].path;
  }

  const existing = stats.find((s) => s.exists);
  if (existing) return existing.path;

  return path.resolve(process.cwd(), "data", "learner-billing-plans.json");
}

const PLAN_FILE = pickPlanFile();
let startupLogged = false;

function logBillingPlansResolution(): void {
  if (startupLogged) return;
  startupLogged = true;
  const daSilvaPlanCount = countDaSilvaPlansAt(PLAN_FILE);
  console.log(`[billing-plans] file=${PLAN_FILE}`);
  console.log(`[billing-plans] daSilvaPlanCount=${daSilvaPlanCount}`);
}

logBillingPlansResolution();

function anyCandidatePlanFileExists(): boolean {
  return resolveCandidatePaths().some((candidatePath) => fs.existsSync(candidatePath));
}

function ensureStore() {
  logBillingPlansResolution();
  if (anyCandidatePlanFileExists()) return;

  const dataDir = path.dirname(PLAN_FILE);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(PLAN_FILE)) {
    fs.writeFileSync(PLAN_FILE, JSON.stringify({}, null, 2), "utf8");
  }
}

function readAll(): PlanFile {
  ensureStore();
  try {
    const raw = fs.readFileSync(PLAN_FILE, "utf8");
    return parsePlanFile(raw);
  } catch {
    return {};
  }
}

function writeAll(data: PlanFile) {
  ensureStore();
  fs.writeFileSync(PLAN_FILE, JSON.stringify(data, null, 2), "utf8");
}

export function readSchoolBillingPlans(schoolId: string): Record<string, StoredBillingPlanItem[]> {
  const key = String(schoolId || "").trim();
  if (!key) return {};
  const all = readAll();
  const storeKey = resolveSchoolJsonStoreKey(key, all, (value) => {
    if (!value || typeof value !== "object") return false;
    return Object.keys(value).length > 0;
  });
  return all[storeKey] || {};
}

export function upsertLearnerBillingPlan(
  schoolId: string,
  learnerId: string,
  items: StoredBillingPlanItem[]
) {
  const schoolKey = String(schoolId || "").trim();
  const learnerKey = String(learnerId || "").trim();
  if (!schoolKey || !learnerKey) return;
  const all = readAll();
  if (!all[schoolKey]) all[schoolKey] = {};
  all[schoolKey][learnerKey] = items;
  writeAll(all);
}

export function upsertSchoolBillingPlans(
  schoolId: string,
  plans: Record<string, StoredBillingPlanItem[]>
) {
  const schoolKey = String(schoolId || "").trim();
  if (!schoolKey) return;
  const all = readAll();
  all[schoolKey] = { ...(all[schoolKey] || {}), ...plans };
  writeAll(all);
}

export function removeSchoolBillingPlans(schoolId: string, learnerIds: string[]) {
  const schoolKey = String(schoolId || "").trim();
  if (!schoolKey || !learnerIds.length) return;
  const all = readAll();
  const school = all[schoolKey];
  if (!school) return;
  for (const id of learnerIds) delete school[id];
  writeAll(all);
}
