import fs from "fs";
import path from "path";

export type StoredBillingPlanItem = {
  feeDescription: string;
  amount: number;
};

type PlanFile = Record<string, Record<string, StoredBillingPlanItem[]>>;

const DATA_DIR = path.join(process.cwd(), "data");
const PLAN_FILE = path.join(DATA_DIR, "learner-billing-plans.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PLAN_FILE)) {
    fs.writeFileSync(PLAN_FILE, JSON.stringify({}, null, 2), "utf8");
  }
}

function readAll(): PlanFile {
  ensureStore();
  try {
    const raw = fs.readFileSync(PLAN_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
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
  return readAll()[key] || {};
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
