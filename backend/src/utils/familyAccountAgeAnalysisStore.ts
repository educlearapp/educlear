import fs from "fs";
import path from "path";

import { resolveSchoolJsonStoreKey } from "../services/daSilvaSchoolResolve";

export type FamilyAccountAgeAnalysisSnapshot = {
  schoolId: string;
  accountRef: string;
  accountHolder: string;
  balance: number;
  buckets: {
    current: number;
    d30: number;
    d60: number;
    d90: number;
    d120: number;
  };
  source: "kideesys-age-analysis";
  importedAt: string;
};

type StoreFile = Record<string, Record<string, FamilyAccountAgeAnalysisSnapshot>>;

const DATA_DIR = path.join(process.cwd(), "data");
const STORE_FILE = path.join(DATA_DIR, "family-account-age-analysis.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_FILE)) fs.writeFileSync(STORE_FILE, JSON.stringify({}, null, 2), "utf8");
}

function readAll(): StoreFile {
  ensureStore();
  try {
    const raw = fs.readFileSync(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as StoreFile) : {};
  } catch {
    return {};
  }
}

function writeAll(data: StoreFile) {
  ensureStore();
  fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), "utf8");
}

export function readSchoolFamilyAccountAgeAnalysisSnapshots(
  schoolId: string
): Record<string, FamilyAccountAgeAnalysisSnapshot> {
  const key = String(schoolId || "").trim();
  if (!key) return {};
  const all = readAll();
  const storeKey = resolveSchoolJsonStoreKey(key, all, (value) => {
    if (!value || typeof value !== "object") return false;
    return Object.keys(value).length > 0;
  });
  return all[storeKey] || {};
}

export function upsertSchoolFamilyAccountAgeAnalysisSnapshots(
  schoolId: string,
  snapshots: Record<string, FamilyAccountAgeAnalysisSnapshot>
) {
  const key = String(schoolId || "").trim();
  if (!key) return;
  const all = readAll();
  all[key] = { ...(all[key] || {}), ...snapshots };
  writeAll(all);
}

