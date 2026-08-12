/**
 * Phase 1I — Fee Check authority reconciliation vs Finance + Statement.
 * Required: SOURCE = FINANCE = STATEMENT = FEE CHECK (integer cents).
 */

import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { MigrationStage } from "../types/MigrationStage";
import type { MigrationFinanceReconciliation } from "./MigrationFinanceReconciliation";
import type { MigrationStatementAuthorityCheck } from "./statementAuthority/MigrationStatementAuthority";
import { resolveAuthoritativeFamilyAccountBalance } from "../../financeAuthority/resolveAuthoritativeFamilyAccountBalance";
import { centsEqual } from "./moneyCents";
import { readSchoolLedger } from "../../../utils/billingLedgerStore";

export const FEE_CHECK_AUTHORITY_VERSION = "1I.1" as const;

export type FeeCheckAuthorityAccountRow = {
  accountRef: string;
  sourceCents: number;
  financeCents: number;
  statementCents: number;
  feeCheckCents: number;
  ok: boolean;
  operatorMessage: string;
};

export type MigrationFeeCheckAuthorityCheck = {
  checkId: string;
  version: typeof FEE_CHECK_AUTHORITY_VERSION;
  generatedAt: string;
  migrationRunId: string;
  stageId: string;
  targetSchoolId: string;
  reconciliationId: string;
  statementAuthorityCheckId: string;
  accountsChecked: number;
  matchCount: number;
  mismatchCount: number;
  feeCheckAuthorityMatch: boolean;
  perAccount: FeeCheckAuthorityAccountRow[];
  mismatches: FeeCheckAuthorityAccountRow[];
  blockedReasons: string[];
  stale: boolean;
};

const DIR = path.join(process.cwd(), "storage", "migration-feecheck-authority");

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

export function saveFeeCheckAuthorityCheck(
  check: MigrationFeeCheckAuthorityCheck
): MigrationFeeCheckAuthorityCheck {
  ensureDir();
  const safe = sanitizeId(check.checkId);
  if (!safe) throw new Error("Invalid fee-check authority id");
  const fp = path.join(DIR, `${safe}.json`);
  fs.writeFileSync(fp, JSON.stringify(check, null, 2), "utf8");
  fs.writeFileSync(
    path.join(DIR, `stage_${sanitizeId(check.stageId)}.json`),
    JSON.stringify(check, null, 2),
    "utf8"
  );
  return check;
}

export function getFeeCheckAuthorityCheck(
  checkId: string
): MigrationFeeCheckAuthorityCheck | null {
  try {
    const safe = sanitizeId(checkId);
    if (!safe) return null;
    const fp = path.join(DIR, `${safe}.json`);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf8")) as MigrationFeeCheckAuthorityCheck;
  } catch {
    return null;
  }
}

export function getFeeCheckAuthorityCheckByStage(
  stageId: string
): MigrationFeeCheckAuthorityCheck | null {
  try {
    const safe = sanitizeId(stageId);
    if (!safe) return null;
    const fp = path.join(DIR, `stage_${safe}.json`);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf8")) as MigrationFeeCheckAuthorityCheck;
  } catch {
    return null;
  }
}

export async function verifyFeeCheckAuthority(input: {
  stage: MigrationStage;
  reconciliation: MigrationFinanceReconciliation;
  statementCheck: MigrationStatementAuthorityCheck;
}): Promise<MigrationFeeCheckAuthorityCheck> {
  const { stage, reconciliation, statementCheck } = input;
  const blockedReasons: string[] = [];

  if (reconciliation.targetSchoolId !== stage.targetSchoolId) {
    blockedReasons.push("Finance Check school mismatch.");
  }
  if (statementCheck.targetSchoolId !== stage.targetSchoolId) {
    blockedReasons.push("Statement Check school mismatch.");
  }
  if (reconciliation.stageId !== stage.stageId || statementCheck.stageId !== stage.stageId) {
    blockedReasons.push("Checks are not bound to the same dry run.");
  }
  if (!reconciliation.canAccept || reconciliation.differenceCents !== 0) {
    blockedReasons.push("Finance Check must pass first.");
  }
  if (!statementCheck.statementAuthorityMatch) {
    blockedReasons.push("Statement Balance Check must pass first.");
  }
  if (reconciliation.stale || statementCheck.stale) {
    blockedReasons.push("Upstream financial checks are stale.");
  }

  const ledger = readSchoolLedger(stage.targetSchoolId);
  const stmtByRef = new Map(
    statementCheck.perAccount.map((p) => [p.accountRef.toUpperCase(), p])
  );

  const perAccount: FeeCheckAuthorityAccountRow[] = [];
  for (const row of reconciliation.perAccount) {
    const ref = row.accountRef;
    const stmt = stmtByRef.get(ref.toUpperCase());
    const fee = await resolveAuthoritativeFamilyAccountBalance(stage.targetSchoolId, ref, {
      ledger,
    });

    const sourceCents = row.sourceCents;
    const financeCents = row.educlearCents;
    const statementCents = stmt?.statementAuthorityCents ?? stmt?.financeCheckCents ?? NaN;
    const feeCheckCents = fee.balanceCents;

    const ok =
      centsEqual(sourceCents, financeCents) &&
      centsEqual(financeCents, statementCents) &&
      centsEqual(statementCents, feeCheckCents);

    perAccount.push({
      accountRef: ref,
      sourceCents,
      financeCents,
      statementCents: Number.isFinite(statementCents) ? statementCents : 0,
      feeCheckCents,
      ok,
      operatorMessage: ok
        ? "Source, Finance Check, statements and Fee Check match."
        : `Mismatch — Source ${sourceCents} · Finance ${financeCents} · Statement ${statementCents} · Fee Check ${feeCheckCents} (cents).`,
    });
  }

  const mismatches = perAccount.filter((p) => !p.ok);
  if (mismatches.length) {
    blockedReasons.push(
      `${mismatches.length} account(s) do not match across Source / Finance / Statement / Fee Check.`
    );
  }

  const check: MigrationFeeCheckAuthorityCheck = {
    checkId: `feechk_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    version: FEE_CHECK_AUTHORITY_VERSION,
    generatedAt: new Date().toISOString(),
    migrationRunId: stage.migrationRunId || stage.stageId,
    stageId: stage.stageId,
    targetSchoolId: stage.targetSchoolId,
    reconciliationId: reconciliation.reconciliationId,
    statementAuthorityCheckId: statementCheck.checkId,
    accountsChecked: perAccount.length,
    matchCount: perAccount.filter((p) => p.ok).length,
    mismatchCount: mismatches.length,
    feeCheckAuthorityMatch: mismatches.length === 0 && blockedReasons.length === 0,
    perAccount,
    mismatches,
    blockedReasons,
    stale: reconciliation.stale || statementCheck.stale,
  };

  return saveFeeCheckAuthorityCheck(check);
}
