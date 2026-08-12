/**
 * Final migration acceptance gate — requires:
 * - Finance Check difference = R0.00
 * - STATEMENT_AUTHORITY_MATCH = TRUE
 * - Parent Review clear
 *
 * Before acceptance: baseline finalisation can be undone by restoring archived snapshots
 * (forward engineering preferred after acceptance — not casual rollback).
 */

import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import type { MigrationStage } from "../types/MigrationStage";
import { getBoundFinanceReconciliation } from "./migrationFinanceReconciliationStore";
import type { MigrationAcceptanceRecord } from "./MigrationFinanceReconciliation";
import {
  getStatementAuthorityCheck,
  getStatementBaselineByStage,
} from "./statementAuthority/statementAuthorityStore";
import { getFeeCheckAuthorityCheck } from "./feeCheckAuthority";
import {
  getAcademicPlanByStage,
  getAcademicCheckByStage,
} from "../academic/academicPlanStore";
import {
  getParentFamilyPlanByStage,
  getParentFamilyCheckByStage,
} from "../parentFamily/parentFamilyPlanStore";

const DIR = path.join(process.cwd(), "storage", "migration-acceptances");

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
  if (!safe) throw new Error("Invalid acceptance id");
  const resolved = path.resolve(DIR, `${safe}.json`);
  if (!resolved.startsWith(path.resolve(DIR) + path.sep)) {
    throw new Error("Invalid acceptance path");
  }
  return resolved;
}

export function saveMigrationAcceptance(
  record: MigrationAcceptanceRecord
): MigrationAcceptanceRecord {
  ensureDir();
  const fp = filePath(record.acceptanceId);
  const tmp = `${fp}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), "utf8");
  fs.renameSync(tmp, fp);
  const stageFp = path.join(DIR, `stage_${sanitizeId(record.stageId)}.json`);
  fs.writeFileSync(stageFp, JSON.stringify(record, null, 2), "utf8");
  return record;
}

export function getAcceptanceByStage(stageId: string): MigrationAcceptanceRecord | null {
  try {
    const safe = sanitizeId(stageId);
    if (!safe) return null;
    const fp = path.join(DIR, `stage_${safe}.json`);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf8")) as MigrationAcceptanceRecord;
  } catch {
    return null;
  }
}

export class MigrationAcceptanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationAcceptanceError";
  }
}

export function acceptMigration(input: {
  stage: MigrationStage;
  reconciliationId: string;
  statementAuthorityCheckId: string;
  feeCheckAuthorityCheckId: string;
  confirmation: boolean;
  summary: MigrationAcceptanceRecord["summary"];
  parentReviewUnresolved: number;
}): MigrationAcceptanceRecord {
  if (!input.confirmation) {
    throw new MigrationAcceptanceError("Explicit confirmation is required to accept a migration.");
  }

  const existing = getAcceptanceByStage(input.stage.stageId);
  if (existing?.status === "ACCEPTED") {
    return existing;
  }

  const recon = getBoundFinanceReconciliation(input.reconciliationId, {
    targetSchoolId: input.stage.targetSchoolId,
    stageId: input.stage.stageId,
  });
  if (!recon) {
    throw new MigrationAcceptanceError(
      "MIGRATION_SCHOOL_MISMATCH: Finance check is missing or bound to a different school/stage."
    );
  }
  if (recon.stale) {
    throw new MigrationAcceptanceError(
      "MIGRATION_PLAN_STALE: Finance check is stale — re-analyse and reconcile again."
    );
  }
  if (!recon.canAccept || recon.differenceCents !== 0 || recon.mismatches.length > 0) {
    throw new MigrationAcceptanceError(
      "Finance Check is not clear — Source and EduClear totals must match at R0.00 difference."
    );
  }
  if (input.parentReviewUnresolved > 0) {
    throw new MigrationAcceptanceError("Parent Review still has unresolved items.");
  }
  if (recon.blockedReasons.length) {
    throw new MigrationAcceptanceError(recon.blockedReasons.join(" "));
  }

  const stmtCheck = getStatementAuthorityCheck(input.statementAuthorityCheckId);
  if (!stmtCheck) {
    throw new MigrationAcceptanceError(
      "Statement Balance Check is required before acceptance."
    );
  }
  if (
    stmtCheck.targetSchoolId !== input.stage.targetSchoolId ||
    stmtCheck.stageId !== input.stage.stageId
  ) {
    throw new MigrationAcceptanceError(
      "MIGRATION_SCHOOL_MISMATCH: Statement Balance Check does not match this dry run/school."
    );
  }
  if (stmtCheck.stale) {
    throw new MigrationAcceptanceError(
      "MIGRATION_PLAN_STALE: Statement Balance Check is stale — re-run after changes."
    );
  }
  if (!stmtCheck.statementAuthorityMatch) {
    throw new MigrationAcceptanceError(
      "STATEMENT_AUTHORITY_MATCH is required — Source, Finance Check, and statement balances must agree."
    );
  }
  if (stmtCheck.reconciliationId && stmtCheck.reconciliationId !== recon.reconciliationId) {
    throw new MigrationAcceptanceError(
      "Statement Balance Check was run against a different Finance Check — re-run Statement Balance Check."
    );
  }

  const feeCheck = getFeeCheckAuthorityCheck(input.feeCheckAuthorityCheckId);
  if (!feeCheck) {
    throw new MigrationAcceptanceError(
      "Fee Check Authority Check is required before acceptance."
    );
  }
  if (
    feeCheck.targetSchoolId !== input.stage.targetSchoolId ||
    feeCheck.stageId !== input.stage.stageId
  ) {
    throw new MigrationAcceptanceError(
      "MIGRATION_SCHOOL_MISMATCH: Fee Check Authority Check does not match this dry run/school."
    );
  }
  if (feeCheck.stale) {
    throw new MigrationAcceptanceError(
      "MIGRATION_PLAN_STALE: Fee Check Authority Check is stale — re-run financial checks."
    );
  }
  if (!feeCheck.feeCheckAuthorityMatch) {
    throw new MigrationAcceptanceError(
      "FEE_CHECK_AUTHORITY_MATCH is required — Source, Finance Check, statements and Fee Check must agree."
    );
  }
  if (feeCheck.reconciliationId !== recon.reconciliationId) {
    throw new MigrationAcceptanceError(
      "Fee Check Authority Check was run against a different Finance Check — re-run checks."
    );
  }
  if (feeCheck.statementAuthorityCheckId !== stmtCheck.checkId) {
    throw new MigrationAcceptanceError(
      "Fee Check Authority Check was run against a different Statement Check — re-run checks."
    );
  }

  // Phase 1J — Academic readiness (does not weaken finance gates).
  // If an academic plan exists for this stage, critical unresolved placements/classes block acceptance.
  const academicPlan = getAcademicPlanByStage(input.stage.stageId);
  if (academicPlan) {
    if (academicPlan.stale) {
      throw new MigrationAcceptanceError(
        "ACADEMIC_STALE: Academic plan changed — recompile and re-check academic structure."
      );
    }
    if (academicPlan.criticalUnresolvedCount > 0) {
      throw new MigrationAcceptanceError(
        "ACADEMIC_REVIEW_REQUIRED: Critical academic placements/classes still need review."
      );
    }
    const academicCheck = getAcademicCheckByStage(input.stage.stageId);
    if (!academicCheck || academicCheck.stale || !academicCheck.academicStructureMatch) {
      throw new MigrationAcceptanceError(
        "ACADEMIC_STRUCTURE_MATCH is required when an academic plan exists — run Academic Structure Check."
      );
    }
  }

  // Phase 1K — Parent/Family readiness (does not weaken finance or academic gates).
  // Only enforced when a ParentFamilyMigrationPlan exists for this stage.
  const parentFamilyPlan = getParentFamilyPlanByStage(input.stage.stageId);
  if (parentFamilyPlan) {
    if (parentFamilyPlan.stale) {
      throw new MigrationAcceptanceError(
        "PARENT_FAMILY_STALE: Parent/family plan changed — recompile and re-check."
      );
    }
    if (parentFamilyPlan.criticalUnresolvedCount > 0) {
      throw new MigrationAcceptanceError(
        "PARENT_FAMILY_REVIEW_REQUIRED: Critical parent identity items still need review."
      );
    }
    const parentFamilyCheck = getParentFamilyCheckByStage(input.stage.stageId);
    if (
      !parentFamilyCheck ||
      parentFamilyCheck.stale ||
      !parentFamilyCheck.parentFamilyMatch
    ) {
      throw new MigrationAcceptanceError(
        "PARENT_FAMILY_MATCH is required when a parent/family plan exists — run Parents & Families Check."
      );
    }
  }

  const baseline = getStatementBaselineByStage(input.stage.stageId);

  const record: MigrationAcceptanceRecord = {
    acceptanceId: `accept_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    acceptedAt: new Date().toISOString(),
    stageId: input.stage.stageId,
    targetSchoolId: input.stage.targetSchoolId,
    migrationRunId: input.stage.migrationRunId || input.stage.stageId,
    reconciliationId: recon.reconciliationId,
    statementAuthorityCheckId: stmtCheck.checkId,
    statementBaselineId: baseline?.baselineId || null,
    feeCheckAuthorityCheckId: feeCheck.checkId,
    statementAuthorityMatch: true,
    feeCheckAuthorityMatch: true,
    sourceAnalysisId: recon.sourceAnalysisId,
    compiledPlanId: recon.compiledPlanId,
    operatorConfirmation: true,
    summary: input.summary,
    status: "ACCEPTED",
    rollbackNote:
      "Migration accepted with statement and Fee Check authority match. Before acceptance, archived snapshots can restore prior baselines. After acceptance, correct via forward-fix — do not casually revert historical statement authority.",
  };

  return saveMigrationAcceptance(record);
}
