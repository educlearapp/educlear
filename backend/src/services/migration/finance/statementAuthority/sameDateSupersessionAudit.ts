/**
 * Same-date snapshot supersession audit (Phase 1I).
 * No silent supersession — confirmation is recorded for audit.
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type SameDateSupersessionAudit = {
  auditId: string;
  recordedAt: string;
  operatorIdentity: string | null;
  migrationRunId: string;
  stageId: string;
  targetSchoolId: string;
  accountRef: string;
  previousSnapshotImportedAt: string;
  previousBalanceCents: number;
  replacementBaselineEffectiveAt: string;
  replacementBalanceCents: number;
  differenceCents: number;
  confirmed: true;
};

const DIR = path.join(process.cwd(), "storage", "migration-same-date-supersessions");

function ensureDir(): void {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}

export function recordSameDateSupersession(
  input: Omit<SameDateSupersessionAudit, "auditId" | "recordedAt" | "confirmed">
): SameDateSupersessionAudit {
  ensureDir();
  const record: SameDateSupersessionAudit = {
    ...input,
    auditId: `samedate_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    recordedAt: new Date().toISOString(),
    confirmed: true,
  };
  const fp = path.join(DIR, `${record.auditId}.json`);
  fs.writeFileSync(fp, JSON.stringify(record, null, 2), "utf8");
  return record;
}
