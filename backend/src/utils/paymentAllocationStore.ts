import fs from "fs";
import path from "path";

import { resolveSchoolJsonStoreKey } from "../services/daSilvaSchoolResolve";

export type StoredPaymentAllocation = {
  id: string;
  paymentId: string;
  schoolId: string;
  accountRef: string;
  invoiceId: string | null;
  feeCategory: string | null;
  allocatedAmount: number;
  allocatedBy?: string;
  createdAt: string;
};

type SchoolAllocations = Record<string, StoredPaymentAllocation[]>;
type AllocationFile = Record<string, SchoolAllocations>;

let paymentAllocationTestDataDir: string | null = null;

function getDataDir(): string {
  return paymentAllocationTestDataDir ?? path.join(process.cwd(), "data");
}

function getAllocationFile(): string {
  return path.join(getDataDir(), "payment-allocations.json");
}

/** @internal Test hook — redirect allocation I/O to an isolated fixture directory. */
export function setPaymentAllocationStoreDataDirForTests(dataDir: string | null): void {
  paymentAllocationTestDataDir = dataDir ? path.resolve(dataDir) : null;
}

function ensureStore() {
  const dataDir = getDataDir();
  const allocationFile = getAllocationFile();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(allocationFile)) {
    fs.writeFileSync(allocationFile, JSON.stringify({}, null, 2), "utf8");
  }
}

function readAll(): AllocationFile {
  ensureStore();
  try {
    const raw = fs.readFileSync(getAllocationFile(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data: AllocationFile) {
  ensureStore();
  fs.writeFileSync(getAllocationFile(), JSON.stringify(data, null, 2), "utf8");
}

function resolveStoreKey(schoolId: string): string {
  const key = String(schoolId || "").trim();
  if (!key) return key;
  const all = readAll();
  return resolveSchoolJsonStoreKey(key, all, (value) =>
    value && typeof value === "object" ? Object.keys(value).length > 0 : false
  );
}

export function listPaymentAllocations(
  schoolId: string,
  paymentId: string
): StoredPaymentAllocation[] {
  const storeKey = resolveStoreKey(schoolId);
  const pid = String(paymentId || "").trim();
  if (!storeKey || !pid) return [];
  const school = readAll()[storeKey];
  if (!school || !Array.isArray(school[pid])) return [];
  return school[pid];
}

export function writePaymentAllocations(
  schoolId: string,
  paymentId: string,
  rows: StoredPaymentAllocation[]
) {
  const storeKey = resolveStoreKey(schoolId);
  const pid = String(paymentId || "").trim();
  if (!storeKey || !pid) return;
  const all = readAll();
  if (!all[storeKey]) all[storeKey] = {};
  all[storeKey][pid] = rows;
  writeAll(all);
}

export function clearPaymentAllocations(schoolId: string, paymentId: string) {
  const storeKey = resolveStoreKey(schoolId);
  const pid = String(paymentId || "").trim();
  if (!storeKey || !pid) return;
  const all = readAll();
  if (!all[storeKey]?.[pid]) return;
  delete all[storeKey][pid];
  writeAll(all);
}
