/**
 * Finalize statement authority by writing migrated balances into the existing
 * age-analysis baseline store (no second balance model).
 *
 * Preserves prior snapshots in an archive. Does not overwrite NEWER_THAN_CUTOVER
 * snapshots. Idempotent when baseline already matches accepted cents.
 */

import { randomUUID } from "crypto";
import {
  readSchoolFamilyAccountAgeAnalysisSnapshots,
  upsertSchoolFamilyAccountAgeAnalysisSnapshots,
  type FamilyAccountAgeAnalysisSnapshot,
  type FinanceAccountSnapshotSource,
} from "../../../../utils/familyAccountAgeAnalysisStore";
import { prisma } from "../../../../prisma";
import type { MigrationFinanceReconciliation } from "../MigrationFinanceReconciliation";
import { centsToRandNumber, centsEqual, randToCents } from "../moneyCents";
import {
  resolveAgingFidelity,
  type AgingBucketsCents,
} from "../agingFidelity";
import { archiveAgeAnalysisSnapshots } from "./archiveAgeAnalysisSnapshots";
import { recordSameDateSupersession } from "./sameDateSupersessionAudit";
import {
  classifySnapshotRelativeToCutover,
} from "./classifySnapshotRelativeToCutover";
import { normalizeCutoverAt } from "./cutoverInstant";
import {
  MIGRATION_STATEMENT_AUTHORITY_VERSION,
  type MigrationBaselineAccountRecord,
  type MigrationStatementBaselineArtifact,
} from "./MigrationStatementAuthority";
import {
  getStatementBaselineByStage,
  saveStatementBaseline,
} from "./statementAuthorityStore";
import type { MigrationStage } from "../../types/MigrationStage";
import { resolveAuthoritativeAccountBalanceFromSnapshot } from "../../../statementAccounts";
import { readSchoolLedger } from "../../../../utils/billingLedgerStore";

const MIGRATION_BASELINE_SOURCE =
  "universal-migration-baseline" as FinanceAccountSnapshotSource;

export class StatementAuthorityFinalizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatementAuthorityFinalizeError";
  }
}

export async function finalizeMigrationStatementAuthority(input: {
  stage: MigrationStage;
  reconciliation: MigrationFinanceReconciliation;
  confirmSameDatePrecedence?: boolean;
  /** Force re-write even if already matching (still idempotent on values). */
  force?: boolean;
  operatorIdentity?: string | null;
  /** Per-account source aging when columns exist; null/missing → BALANCE_ONLY. */
  sourceAgingByAccount?: Map<string, AgingBucketsCents | null>;
}): Promise<MigrationStatementBaselineArtifact> {
  const stage = input.stage;
  const recon = input.reconciliation;
  const cutoverAt = normalizeCutoverAt(stage.cutoverDate);
  if (!cutoverAt) {
    throw new StatementAuthorityFinalizeError("Cutover date/time is required.");
  }
  if (recon.targetSchoolId !== stage.targetSchoolId || recon.stageId !== stage.stageId) {
    throw new StatementAuthorityFinalizeError(
      "MIGRATION_SCHOOL_MISMATCH: Finance Check does not match this dry run/school."
    );
  }
  if (!recon.canAccept || recon.differenceCents !== 0) {
    throw new StatementAuthorityFinalizeError(
      "Finance Check must show difference R0.00 before statement baseline finalisation."
    );
  }

  const existing = getStatementBaselineByStage(stage.stageId);
  if (existing && !input.force) {
    // Idempotent: verify ledger authority already matches
    const snaps = readSchoolFamilyAccountAgeAnalysisSnapshots(stage.targetSchoolId);
    const ledger = readSchoolLedger(stage.targetSchoolId);
    let allOk = true;
    for (const row of recon.perAccount) {
      const snap = snaps[row.accountRef] || snaps[row.accountRef.toUpperCase()];
      const entries = ledger.filter(
        (e) =>
          String(e.accountNo || "").trim().toUpperCase() === row.accountRef.toUpperCase()
      );
      const stmt = randToCents(
        resolveAuthoritativeAccountBalanceFromSnapshot(snap, entries)
      );
      if (!centsEqual(stmt, row.educlearCents)) {
        allOk = false;
        break;
      }
    }
    if (allOk) {
      return { ...existing, idempotentReplay: true };
    }
  }

  const priorAll = readSchoolFamilyAccountAgeAnalysisSnapshots(stage.targetSchoolId);
  const toArchive: Record<string, FamilyAccountAgeAnalysisSnapshot> = {};
  const nextUpserts: Record<string, FamilyAccountAgeAnalysisSnapshot> = {};
  const accountRecords: MigrationBaselineAccountRecord[] = [];
  const baselineEffectiveAt = new Date().toISOString();

  for (const row of recon.perAccount) {
    const ref = row.accountRef.toUpperCase();
    const prior =
      priorAll[ref] ||
      priorAll[row.accountRef] ||
      Object.values(priorAll).find(
        (s) => String(s.accountRef || "").trim().toUpperCase() === ref
      );

    const snapshotCase = classifySnapshotRelativeToCutover({
      snap: prior,
      cutoverAt,
    });

    if (snapshotCase === "NEWER_THAN_CUTOVER") {
      const ledger = readSchoolLedger(stage.targetSchoolId);
      const entries = ledger.filter(
        (e) => String(e.accountNo || "").trim().toUpperCase() === ref
      );
      const stmt = randToCents(
        resolveAuthoritativeAccountBalanceFromSnapshot(prior, entries)
      );
      if (centsEqual(stmt, row.educlearCents)) {
        // Already matches — leave newer snapshot alone
        accountRecords.push({
          accountRef: row.accountRef,
          acceptedMigratedBalanceCents: row.educlearCents,
          baselineEffectiveAt: prior!.importedAt,
          priorSnapshotRef: {
            importedAt: prior!.importedAt,
            balanceCents: randToCents(prior!.balance),
            source: prior!.source,
          },
          snapshotCase,
        });
        continue;
      }
      throw new StatementAuthorityFinalizeError(
        `Account ${row.accountRef}: newer statement snapshot from ${String(prior?.importedAt || "").slice(0, 10)} will not be overwritten. Review required.`
      );
    }

    if (
      snapshotCase === "SAME_DATE_AS_CUTOVER" &&
      !input.confirmSameDatePrecedence
    ) {
      throw new StatementAuthorityFinalizeError(
        `Account ${row.accountRef}: same-date snapshot requires confirmation that migrated balances take precedence.`
      );
    }

    if (snapshotCase === "SAME_DATE_AS_CUTOVER" && prior && input.confirmSameDatePrecedence) {
      recordSameDateSupersession({
        operatorIdentity: input.operatorIdentity || null,
        migrationRunId: stage.migrationRunId || stage.stageId,
        stageId: stage.stageId,
        targetSchoolId: stage.targetSchoolId,
        accountRef: row.accountRef,
        previousSnapshotImportedAt: prior.importedAt,
        previousBalanceCents: randToCents(prior.balance),
        replacementBaselineEffectiveAt: baselineEffectiveAt,
        replacementBalanceCents: row.educlearCents,
        differenceCents: row.educlearCents - randToCents(prior.balance),
      });
    }

    if (prior) {
      toArchive[ref] = prior;
    }

    const fa = await prisma.familyAccount.findFirst({
      where: { schoolId: stage.targetSchoolId, accountRef: row.accountRef },
      select: { familyName: true, accountRef: true },
    });

    const acceptedRand = centsToRandNumber(row.educlearCents);
    const sourceBuckets =
      input.sourceAgingByAccount?.get(ref) ??
      input.sourceAgingByAccount?.get(row.accountRef) ??
      null;
    const aging = resolveAgingFidelity({
      acceptedBalanceCents: row.educlearCents,
      sourceBuckets,
    });
    const buckets = aging.bucketsRand;

    nextUpserts[ref] = {
      schoolId: stage.targetSchoolId,
      accountRef: ref,
      accountHolder: fa?.familyName || prior?.accountHolder || ref,
      kidesysSection:
        aging.mode === "BALANCE_ONLY"
          ? "BALANCE_ONLY"
          : prior?.kidesysSection || "SOURCE_BUCKETS",
      balance: acceptedRand,
      buckets,
      source: MIGRATION_BASELINE_SOURCE,
      importedAt: baselineEffectiveAt,
    };

    accountRecords.push({
      accountRef: row.accountRef,
      acceptedMigratedBalanceCents: row.educlearCents,
      baselineEffectiveAt,
      agingMode: aging.mode,
      agingOperatorMessage: aging.operatorMessage,
      priorSnapshotRef: prior
        ? {
            importedAt: prior.importedAt,
            balanceCents: randToCents(prior.balance),
            source: prior.source,
          }
        : null,
      snapshotCase,
    });
  }

  let archiveId: string | null = null;
  if (Object.keys(toArchive).length > 0) {
    const archive = archiveAgeAnalysisSnapshots({
      schoolId: stage.targetSchoolId,
      migrationRunId: stage.migrationRunId || stage.stageId,
      stageId: stage.stageId,
      reason:
        "Superseded by universal migration statement baseline — preserved for audit (What balance authority existed before this migration run?).",
      priorSnapshots: toArchive,
    });
    archiveId = archive.archiveId;
  }

  if (Object.keys(nextUpserts).length > 0) {
    upsertSchoolFamilyAccountAgeAnalysisSnapshots(stage.targetSchoolId, nextUpserts);
  }

  const artifact: MigrationStatementBaselineArtifact = {
    baselineId: existing?.baselineId || `stmtbase_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    authorityVersion: MIGRATION_STATEMENT_AUTHORITY_VERSION,
    createdAt: existing?.createdAt || baselineEffectiveAt,
    migrationRunId: stage.migrationRunId || stage.stageId,
    stageId: stage.stageId,
    targetSchoolId: stage.targetSchoolId,
    sourceAnalysisId: stage.sourceAnalysisId || null,
    compiledPlanId: stage.compiledPlanId || null,
    reconciliationId: recon.reconciliationId,
    cutoverAt,
    baselineEffectiveAt,
    archiveId: archiveId || existing?.archiveId || null,
    accounts: accountRecords,
    supersessionNote:
      "Prior age-analysis snapshots archived when superseded. Statement authority = migrated baseline + live post-baseline delta. Migration ledger openings/transactions remain non-posting so they do not double-count.",
    idempotentReplay: false,
  };

  return saveStatementBaseline(artifact);
}
