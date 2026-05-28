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

const DATA_DIR = path.join(process.cwd(), "data");
const ALLOCATION_FILE = path.join(DATA_DIR, "payment-allocations.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ALLOCATION_FILE)) {
    fs.writeFileSync(ALLOCATION_FILE, JSON.stringify({}, null, 2), "utf8");
  }
}

function readAll(): AllocationFile {
  ensureStore();
  try {
    const raw = fs.readFileSync(ALLOCATION_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data: AllocationFile) {
  ensureStore();
  fs.writeFileSync(ALLOCATION_FILE, JSON.stringify(data, null, 2), "utf8");
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
