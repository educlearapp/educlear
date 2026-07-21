import fs from "fs";
import path from "path";

import { resolveSchoolJsonStoreKey } from "../services/daSilvaSchoolResolve";

export type FinanceAccountSnapshotSource = "kideesys-age-analysis" | "educlear-registration";

export type FamilyAccountAgeAnalysisSnapshot = {
  schoolId: string;
  accountRef: string;
  accountHolder: string;
  /** Kid-e-Sys age-analysis section (Recently Owing, Bad Debt, Paid Up, Over Paid). */
  kidesysSection?: string;
  balance: number;
  buckets: {
    current: number;
    d30: number;
    d60: number;
    d90: number;
    d120: number;
  };
  source: FinanceAccountSnapshotSource;
  importedAt: string;
};

type StoreFile = Record<string, Record<string, FamilyAccountAgeAnalysisSnapshot>>;

let ageAnalysisTestDataDir: string | null = null;

function getDataDir(): string {
  return ageAnalysisTestDataDir ?? path.join(process.cwd(), "data");
}

function getStoreFile(): string {
  return path.join(getDataDir(), "family-account-age-analysis.json");
}

/** @internal Test hook — redirect age-analysis I/O to an isolated fixture directory. */
export function setFamilyAccountAgeAnalysisStoreDataDirForTests(dataDir: string | null): void {
  ageAnalysisTestDataDir = dataDir ? path.resolve(dataDir) : null;
  invalidateFamilyAccountAgeAnalysisFileCache();
}

function ensureStore() {
  const dataDir = getDataDir();
  const storeFile = getStoreFile();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(storeFile)) fs.writeFileSync(storeFile, JSON.stringify({}, null, 2), "utf8");
}

let ageAnalysisFileCache: { mtimeMs: number; data: StoreFile } | null = null;

/** @internal Test hook — clears in-process parsed age-analysis cache. */
export function invalidateFamilyAccountAgeAnalysisFileCache(): void {
  ageAnalysisFileCache = null;
}

function readAll(): StoreFile {
  ensureStore();
  const storeFile = getStoreFile();
  try {
    const stat = fs.statSync(storeFile);
    if (ageAnalysisFileCache && ageAnalysisFileCache.mtimeMs === stat.mtimeMs) {
      return ageAnalysisFileCache.data;
    }
    const raw = fs.readFileSync(storeFile, "utf8");
    const parsed = JSON.parse(raw);
    const data = parsed && typeof parsed === "object" ? (parsed as StoreFile) : {};
    ageAnalysisFileCache = { mtimeMs: stat.mtimeMs, data };
    return data;
  } catch {
    return {};
  }
}

function writeAll(data: StoreFile) {
  ensureStore();
  fs.writeFileSync(getStoreFile(), JSON.stringify(data, null, 2), "utf8");
  ageAnalysisFileCache = null;
}

/**
 * Insert a snapshot only when the account ref is absent for the school.
 * Never overwrites imported Kid-e-Sys balances or buckets.
 */
export function insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
  schoolId: string,
  accountRef: string,
  snapshot: FamilyAccountAgeAnalysisSnapshot
): "inserted" | "already_exists" {
  const key = String(schoolId || "").trim();
  const ref = String(accountRef || "").trim().toUpperCase();
  if (!key || !ref) return "already_exists";

  const all = readAll();
  const schoolSnapshots = { ...(all[key] || {}) };
  if (schoolSnapshots[ref]) return "already_exists";

  schoolSnapshots[ref] = {
    ...snapshot,
    schoolId: key,
    accountRef: ref,
  };
  all[key] = schoolSnapshots;
  writeAll(all);
  return "inserted";
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

/** Replace the full snapshot map for a school (drops accounts not in the payload). */
export function replaceSchoolFamilyAccountAgeAnalysisSnapshots(
  schoolId: string,
  snapshots: Record<string, FamilyAccountAgeAnalysisSnapshot>
) {
  const key = String(schoolId || "").trim();
  if (!key) return;
  const all = readAll();
  all[key] = { ...snapshots };
  writeAll(all);
}

/** Merge Kid-e-Sys age-analysis section labels into existing snapshots (no balance changes). */
export function backfillKidesysSectionsInSnapshots(
  schoolId: string,
  sectionsByAccountRef: Record<string, string>
) {
  const key = String(schoolId || "").trim();
  if (!key) return { updated: 0 };
  const all = readAll();
  const existing = { ...(all[key] || {}) };
  let updated = 0;
  for (const [rawRef, section] of Object.entries(sectionsByAccountRef || {})) {
    const accountRef = String(rawRef || "").trim().toUpperCase();
    const kidesysSection = String(section || "").trim();
    if (!accountRef || !kidesysSection || !existing[accountRef]) continue;
    if (existing[accountRef].kidesysSection === kidesysSection) continue;
    existing[accountRef] = { ...existing[accountRef], kidesysSection };
    updated += 1;
  }
  all[key] = existing;
  writeAll(all);
  return { updated };
}

