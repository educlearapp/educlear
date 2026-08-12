/**
 * Phase 1I — Aging Check against imported age-analysis baselines.
 * Where source buckets exist: sum(source) = accepted; sum(EduClear) = baseline.
 * Where not: BALANCE_ONLY — never invent history.
 */

import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { MigrationStage } from "../types/MigrationStage";
import type { MigrationFinanceReconciliation } from "./MigrationFinanceReconciliation";
import { readSchoolFamilyAccountAgeAnalysisSnapshots } from "../../../utils/familyAccountAgeAnalysisStore";
import { centsEqual, randToCents } from "./moneyCents";
import {
  resolveAgingFidelity,
  type AgingBucketsCents,
} from "./agingFidelity";

export const AGING_CHECK_VERSION = "1I.1" as const;

export type AgingCheckAccountRow = {
  accountRef: string;
  mode: "SOURCE_BUCKETS" | "BALANCE_ONLY";
  acceptedBalanceCents: number;
  sourceBucketSumCents: number | null;
  baselineBucketSumCents: number;
  ok: boolean;
  operatorMessage: string;
};

export type MigrationAgingCheck = {
  checkId: string;
  version: typeof AGING_CHECK_VERSION;
  generatedAt: string;
  stageId: string;
  targetSchoolId: string;
  reconciliationId: string;
  accountsChecked: number;
  sourceBucketsCount: number;
  balanceOnlyCount: number;
  matchCount: number;
  mismatchCount: number;
  agingCheckPass: boolean;
  perAccount: AgingCheckAccountRow[];
  blockedReasons: string[];
  stale: boolean;
};

const DIR = path.join(process.cwd(), "storage", "migration-aging-checks");

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

export function saveAgingCheck(check: MigrationAgingCheck): MigrationAgingCheck {
  ensureDir();
  const safe = sanitizeId(check.checkId);
  if (!safe) throw new Error("Invalid aging check id");
  fs.writeFileSync(path.join(DIR, `${safe}.json`), JSON.stringify(check, null, 2), "utf8");
  fs.writeFileSync(
    path.join(DIR, `stage_${sanitizeId(check.stageId)}.json`),
    JSON.stringify(check, null, 2),
    "utf8"
  );
  return check;
}

export function getAgingCheck(checkId: string): MigrationAgingCheck | null {
  try {
    const safe = sanitizeId(checkId);
    if (!safe) return null;
    const fp = path.join(DIR, `${safe}.json`);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf8")) as MigrationAgingCheck;
  } catch {
    return null;
  }
}

function bucketSumCents(b: {
  current?: number;
  d30?: number;
  d60?: number;
  d90?: number;
  d120?: number;
}): number {
  return (
    randToCents(Number(b.current) || 0) +
    randToCents(Number(b.d30) || 0) +
    randToCents(Number(b.d60) || 0) +
    randToCents(Number(b.d90) || 0) +
    randToCents(Number(b.d120) || 0)
  );
}

export function verifyAgingFidelity(input: {
  stage: MigrationStage;
  reconciliation: MigrationFinanceReconciliation;
  sourceAgingByAccount?: Map<string, AgingBucketsCents | null>;
}): MigrationAgingCheck {
  const { stage, reconciliation } = input;
  const snaps = readSchoolFamilyAccountAgeAnalysisSnapshots(stage.targetSchoolId);
  const blockedReasons: string[] = [];
  if (reconciliation.stale) blockedReasons.push("Finance Check is stale.");
  if (!reconciliation.canAccept) blockedReasons.push("Finance Check must pass first.");

  const perAccount: AgingCheckAccountRow[] = [];
  for (const row of reconciliation.perAccount) {
    const ref = row.accountRef.toUpperCase();
    const sourceBuckets =
      input.sourceAgingByAccount?.get(ref) ??
      input.sourceAgingByAccount?.get(row.accountRef) ??
      null;
    const fidelity = resolveAgingFidelity({
      acceptedBalanceCents: row.educlearCents,
      sourceBuckets,
    });
    const snap = snaps[ref] || snaps[row.accountRef];
    const baselineSum = snap ? bucketSumCents(snap.buckets || {}) : 0;
    const sourceSum = sourceBuckets
      ? sourceBuckets.current +
        sourceBuckets.d30 +
        sourceBuckets.d60 +
        sourceBuckets.d90 +
        sourceBuckets.d120
      : null;

    let ok = false;
    if (fidelity.mode === "BALANCE_ONLY") {
      // Pass when baseline total equals accepted (bucket fidelity not claimed)
      ok = snap ? centsEqual(randToCents(snap.balance), row.educlearCents) : false;
    } else {
      ok =
        sourceSum != null &&
        centsEqual(sourceSum, row.educlearCents) &&
        centsEqual(baselineSum, row.educlearCents);
    }

    perAccount.push({
      accountRef: row.accountRef,
      mode: fidelity.mode,
      acceptedBalanceCents: row.educlearCents,
      sourceBucketSumCents: sourceSum,
      baselineBucketSumCents: baselineSum,
      ok,
      operatorMessage: fidelity.operatorMessage,
    });
  }

  const mismatches = perAccount.filter((p) => !p.ok);
  if (mismatches.length) {
    blockedReasons.push(`${mismatches.length} account(s) failed Aging Check.`);
  }

  const check: MigrationAgingCheck = {
    checkId: `aging_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    version: AGING_CHECK_VERSION,
    generatedAt: new Date().toISOString(),
    stageId: stage.stageId,
    targetSchoolId: stage.targetSchoolId,
    reconciliationId: reconciliation.reconciliationId,
    accountsChecked: perAccount.length,
    sourceBucketsCount: perAccount.filter((p) => p.mode === "SOURCE_BUCKETS").length,
    balanceOnlyCount: perAccount.filter((p) => p.mode === "BALANCE_ONLY").length,
    matchCount: perAccount.filter((p) => p.ok).length,
    mismatchCount: mismatches.length,
    agingCheckPass: mismatches.length === 0 && blockedReasons.length === 0,
    perAccount,
    blockedReasons,
    stale: reconciliation.stale,
  };
  return saveAgingCheck(check);
}
