import fs from "fs";
import path from "path";

export type FamilyAccountAuditAction = "merge" | "unmerge";

let familyAccountAuditTestDataDir: string | null = null;

/** @internal Test hook — redirect family-account audit I/O to an isolated fixture directory. */
export function setFamilyAccountAuditStoreDataDirForTests(dataDir: string | null): void {
  familyAccountAuditTestDataDir = dataDir ? path.resolve(dataDir) : null;
}

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

function getDataDir(): string {
  return familyAccountAuditTestDataDir ?? path.join(process.cwd(), "data");
}

function getAuditFile(): string {
  return path.join(getDataDir(), "family-account-audit.json");
}

function ensureStore() {
  const dataDir = getDataDir();
  const auditFile = getAuditFile();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(auditFile)) fs.writeFileSync(auditFile, JSON.stringify({}, null, 2), "utf8");
}

function readAll(): AuditFile {
  ensureStore();
  try {
    const raw = fs.readFileSync(getAuditFile(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(data: AuditFile) {
  ensureStore();
  fs.writeFileSync(getAuditFile(), JSON.stringify(data, null, 2), "utf8");
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
