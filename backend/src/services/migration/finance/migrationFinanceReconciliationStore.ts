/**
 * JSON store for MigrationFinanceReconciliation artifacts.
 */

import fs from "fs";
import path from "path";
import type { MigrationFinanceReconciliation } from "./MigrationFinanceReconciliation";
import { MIGRATION_FINANCE_RECONCILIATION_VERSION } from "./MigrationFinanceReconciliation";

const DIR = path.join(process.cwd(), "storage", "migration-finance-reconciliations");

function ensureDir(): void {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}

function sanitizeId(id: string): string | null {
  const trimmed = String(id || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function filePath(id: string): string {
  const safe = sanitizeId(id);
  if (!safe) throw new Error("Invalid reconciliation id");
  const resolved = path.resolve(DIR, `${safe}.json`);
  if (!resolved.startsWith(path.resolve(DIR) + path.sep)) {
    throw new Error("Invalid reconciliation path");
  }
  return resolved;
}

export function saveFinanceReconciliation(
  artifact: MigrationFinanceReconciliation
): MigrationFinanceReconciliation {
  ensureDir();
  const next: MigrationFinanceReconciliation = {
    ...artifact,
    reconciliationVersion: MIGRATION_FINANCE_RECONCILIATION_VERSION,
  };
  const fp = filePath(next.reconciliationId);
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
  fs.renameSync(tmp, fp);
  return next;
}

export function getFinanceReconciliation(
  reconciliationId: string
): MigrationFinanceReconciliation | null {
  try {
    const fp = filePath(reconciliationId);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf8")) as MigrationFinanceReconciliation;
  } catch {
    return null;
  }
}

export function getBoundFinanceReconciliation(
  reconciliationId: string,
  opts: { targetSchoolId: string; stageId?: string }
): MigrationFinanceReconciliation | null {
  const row = getFinanceReconciliation(reconciliationId);
  if (!row) return null;
  if (row.targetSchoolId !== opts.targetSchoolId) return null;
  if (opts.stageId && row.stageId !== opts.stageId) return null;
  return row;
}

/** Latest finance reconciliation for a stage (orchestrator readiness). */
export function listFinanceReconciliationsForStage(
  stageId: string
): MigrationFinanceReconciliation[] {
  ensureDir();
  const out: MigrationFinanceReconciliation[] = [];
  for (const name of fs.readdirSync(DIR)) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    if (name.includes(".tmp")) continue;
    try {
      const row = JSON.parse(
        fs.readFileSync(path.join(DIR, name), "utf8")
      ) as MigrationFinanceReconciliation;
      if (row.stageId === stageId) out.push(row);
    } catch {
      /* skip */
    }
  }
  out.sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
  return out;
}
