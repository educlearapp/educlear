import fs from "fs";
import path from "path";

export type FamilyAccountAuditAction = "merge" | "unmerge";

export type FamilyAccountAuditEntry = {
  id: string;
  schoolId: string;
  action: FamilyAccountAuditAction;
  actorEmail?: string;
  sourceFamilyAccountId?: string | null;
  targetFamilyAccountId?: string | null;
  sourceAccountRef?: string;
  targetAccountRef?: string;
  learnerIds: string[];
  createNewAccount?: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

type AuditFile = Record<string, FamilyAccountAuditEntry[]>;

const DATA_DIR = path.join(process.cwd(), "data");
const AUDIT_FILE = path.join(DATA_DIR, "family-account-audit.json");

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(AUDIT_FILE)) fs.writeFileSync(AUDIT_FILE, JSON.stringify({}, null, 2), "utf8");
}

function readAll(): AuditFile {
  ensureStore();
  try {
    const raw = fs.readFileSync(AUDIT_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data: AuditFile) {
  ensureStore();
  fs.writeFileSync(AUDIT_FILE, JSON.stringify(data, null, 2), "utf8");
}

export function appendFamilyAccountAudit(entry: Omit<FamilyAccountAuditEntry, "id" | "createdAt">) {
  const schoolId = String(entry.schoolId || "").trim();
  if (!schoolId) return null;

  const row: FamilyAccountAuditEntry = {
    ...entry,
    id: `faa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: new Date().toISOString(),
  };

  const all = readAll();
  const list = Array.isArray(all[schoolId]) ? all[schoolId] : [];
  list.unshift(row);
  all[schoolId] = list.slice(0, 500);
  writeAll(all);
  return row;
}

export function listFamilyAccountAudit(schoolId: string, limit = 50): FamilyAccountAuditEntry[] {
  const key = String(schoolId || "").trim();
  if (!key) return [];
  const all = readAll();
  const list = Array.isArray(all[key]) ? all[key] : [];
  return list.slice(0, Math.max(1, Math.min(limit, 200)));
}
