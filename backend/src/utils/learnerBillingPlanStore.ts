import fs from "fs";
import path from "path";

import {
  DA_SILVA_BILLING_DATA_SCHOOL_ID,
  isDaSilvaSchoolId,
  resolveSchoolJsonStoreKey,
} from "../services/daSilvaSchoolResolve";

export type StoredBillingPlanItem = {
  feeDescription: string;
  amount: number;
};

type PlanFile = Record<string, Record<string, StoredBillingPlanItem[]>>;

const MODULE_DIR = __dirname;

const CANDIDATE_REL_PATHS = [
  path.join("backend", "data", "learner-billing-plans.json"),
  path.join("data", "learner-billing-plans.json"),
  path.join(MODULE_DIR, "..", "..", "data", "learner-billing-plans.json"),
  path.join(MODULE_DIR, "..", "..", "..", "data", "learner-billing-plans.json"),
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
  for (const rel of CANDIDATE_REL_PATHS) {
    const abs = path.resolve(rel);
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

function hasSchoolPlanContent(value: unknown): value is Record<string, StoredBillingPlanItem[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value).length > 0;
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

  const withAnyPlans = stats.filter((s) => {
    if (!s.exists) return false;
    try {
      const raw = fs.readFileSync(s.path, "utf8");
      const parsed = parsePlanFile(raw);
      return Object.values(parsed).some((bucket) => hasSchoolPlanContent(bucket));
    } catch {
      return false;
    }
  });
  if (withAnyPlans.length > 0) return withAnyPlans[0].path;

  const existing = stats.find((s) => s.exists);
  if (existing) return existing.path;

  return path.resolve(process.cwd(), "data", "learner-billing-plans.json");
}

let cachedPlanFile: string | null = null;
let cachedPlanFileAt = 0;
const PLAN_FILE_CACHE_MS = 2_000;

function getPlanFilePath(): string {
  const now = Date.now();
  if (cachedPlanFile && now - cachedPlanFileAt < PLAN_FILE_CACHE_MS) {
    return cachedPlanFile;
  }
  cachedPlanFile = pickPlanFile();
  cachedPlanFileAt = now;
  return cachedPlanFile;
}

let startupLogged = false;

function logBillingPlansResolution(): void {
  if (startupLogged) return;
  startupLogged = true;
  const planFile = getPlanFilePath();
  const daSilvaPlanCount = countDaSilvaPlansAt(planFile);
  console.log(`[billing-plans] file=${planFile}`);
  console.log(`[billing-plans] daSilvaPlanCount=${daSilvaPlanCount}`);
}

logBillingPlansResolution();

function anyCandidatePlanFileExists(): boolean {
  return resolveCandidatePaths().some((candidatePath) => fs.existsSync(candidatePath));
}

function ensureStore() {
  logBillingPlansResolution();
  const planFile = getPlanFilePath();
  if (anyCandidatePlanFileExists()) return;

  const dataDir = path.dirname(planFile);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(planFile)) {
    fs.writeFileSync(planFile, JSON.stringify({}, null, 2), "utf8");
  }
}

function readAll(): PlanFile {
  ensureStore();
  const planFile = getPlanFilePath();
  try {
    const raw = fs.readFileSync(planFile, "utf8");
    return parsePlanFile(raw);
  } catch {
    return {};
  }
}

function countAllPlansIn(data: PlanFile): number {
  let total = 0;
  for (const bucket of Object.values(data)) {
    if (hasSchoolPlanContent(bucket)) total += Object.keys(bucket).length;
  }
  return total;
}

function writeAll(data: PlanFile) {
  ensureStore();
  const planFile = getPlanFilePath();
  const existingRaw = fs.existsSync(planFile) ? fs.readFileSync(planFile, "utf8") : "";
  const existing = parsePlanFile(existingRaw);
  const existingCount = countAllPlansIn(existing);
  const incomingCount = countAllPlansIn(data);

  if (existingCount > 0 && incomingCount === 0) {
    console.warn(
      `[billing-plans] refused empty overwrite file=${planFile} existingLearnerPlans=${existingCount}`
    );
    return;
  }

  fs.writeFileSync(planFile, JSON.stringify(data, null, 2), "utf8");
  cachedPlanFile = planFile;
  cachedPlanFileAt = Date.now();
}

function resolveWriteStoreKey(schoolId: string, all: PlanFile): string {
  return resolveSchoolJsonStoreKey(schoolId, all, hasSchoolPlanContent);
}

export function readSchoolBillingPlans(schoolId: string): Record<string, StoredBillingPlanItem[]> {
  const key = String(schoolId || "").trim();
  if (!key) return {};
  const all = readAll();
  const storeKey = resolveSchoolJsonStoreKey(key, all, hasSchoolPlanContent);

  let merged: Record<string, StoredBillingPlanItem[]> = { ...(all[storeKey] || {}) };

  if (isDaSilvaSchoolId(key)) {
    for (const [bucketKey, bucket] of Object.entries(all)) {
      if (bucketKey === storeKey) continue;
      if (!hasSchoolPlanContent(bucket)) continue;
      if (isDaSilvaSchoolId(bucketKey) || bucketKey === DA_SILVA_BILLING_DATA_SCHOOL_ID) {
        merged = { ...merged, ...bucket };
      }
    }
  }

  return merged;
}

export type BillingPlanLookupIndexes = {
  byAdmissionNo: Map<string, StoredBillingPlanItem[]>;
  byIdNumber: Map<string, StoredBillingPlanItem[]>;
};

/** Fallback indexes when plan keys use a prior learner id but admission/id still match. */
export function buildBillingPlanLookupIndexes(
  plansByLearnerId: Record<string, StoredBillingPlanItem[]>,
  learners: Array<{
    id: string;
    admissionNo?: string | null;
    idNumber?: string | null;
  }>
): BillingPlanLookupIndexes {
  const byAdmissionNo = new Map<string, StoredBillingPlanItem[]>();
  const byIdNumber = new Map<string, StoredBillingPlanItem[]>();

  const register = (learner: {
    id: string;
    admissionNo?: string | null;
    idNumber?: string | null;
  }) => {
    const items = plansByLearnerId[learner.id];
    if (!items?.length) return;
    const admissionNo = String(learner.admissionNo || "").trim();
    if (admissionNo && !byAdmissionNo.has(admissionNo)) {
      byAdmissionNo.set(admissionNo, items);
    }
    const idNumber = String(learner.idNumber || "").replace(/\D/g, "");
    if (idNumber.length === 13 && !byIdNumber.has(idNumber)) {
      byIdNumber.set(idNumber, items);
    }
  };

  for (const learner of learners) register(learner);

  return { byAdmissionNo, byIdNumber };
}

export function resolveLearnerBillingPlanItems(
  learner: {
    id: string;
    admissionNo?: string | null;
    idNumber?: string | null;
  },
  plansByLearnerId: Record<string, StoredBillingPlanItem[]>,
  indexes: BillingPlanLookupIndexes
): StoredBillingPlanItem[] {
  const direct = plansByLearnerId[learner.id];
  if (direct?.length) return direct;

  const admissionNo = String(learner.admissionNo || "").trim();
  if (admissionNo) {
    const byAdmission = indexes.byAdmissionNo.get(admissionNo);
    if (byAdmission?.length) return byAdmission;
  }

  const idNumber = String(learner.idNumber || "").replace(/\D/g, "");
  if (idNumber.length === 13) {
    const byId = indexes.byIdNumber.get(idNumber);
    if (byId?.length) return byId;
  }

  return [];
}

export function removeLearnerBillingPlan(schoolId: string, learnerId: string) {
  const schoolKey = String(schoolId || "").trim();
  const learnerKey = String(learnerId || "").trim();
  if (!schoolKey || !learnerKey) return;
  const all = readAll();
  const storeKey = resolveWriteStoreKey(schoolKey, all);
  if (!all[storeKey]?.[learnerKey]) return;
  delete all[storeKey][learnerKey];
  writeAll(all);
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
  const storeKey = resolveWriteStoreKey(schoolKey, all);
  if (!all[storeKey]) all[storeKey] = {};
  all[storeKey][learnerKey] = items;
  writeAll(all);
}

export function upsertSchoolBillingPlans(
  schoolId: string,
  plans: Record<string, StoredBillingPlanItem[]>
) {
  const schoolKey = String(schoolId || "").trim();
  if (!schoolKey) return;
  const planKeys = Object.keys(plans || {});
  if (!planKeys.length) return;
  const all = readAll();
  const storeKey = resolveWriteStoreKey(schoolKey, all);
  all[storeKey] = { ...(all[storeKey] || {}), ...plans };
  writeAll(all);
}

export function removeSchoolBillingPlans(schoolId: string, learnerIds: string[]) {
  const schoolKey = String(schoolId || "").trim();
  if (!schoolKey || !learnerIds.length) return;
  const all = readAll();
  const storeKey = resolveWriteStoreKey(schoolKey, all);
  const school = all[storeKey];
  if (!school) return;
  for (const id of learnerIds) delete school[id];
  writeAll(all);
}
