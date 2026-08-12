/**
 * Build and persist MigrationFinanceReconciliation.
 */

import { randomUUID } from "crypto";
import type { MigrationStage } from "../types/MigrationStage";
import { getBoundCompiledPlan } from "../migrationPlan/migrationPlanStore";
import { getBoundSourceAnalysis } from "../sourceAnalysis/migrationSourceAnalysisStore";
import { buildSourceFinancePositions } from "./buildSourceFinanceTotals";
import { buildEduClearFinancePositions } from "./buildEduClearFinanceTotals";
import {
  MIGRATION_FINANCE_RECONCILIATION_VERSION,
  type MigrationFinanceReconciliation,
  type PerAccountReconciliation,
} from "./MigrationFinanceReconciliation";
import { centsDiff, centsEqual } from "./moneyCents";
import { saveFinanceReconciliation } from "./migrationFinanceReconciliationStore";

function fingerprintsStale(
  stage: MigrationStage,
  analysisFingerprints: Array<{ fileId: string; headerFingerprint: string }> | null
): boolean {
  if (!analysisFingerprints || !analysisFingerprints.length) return false;
  const byId = new Map(analysisFingerprints.map((f) => [f.fileId, f.headerFingerprint]));
  for (const fp of stage.sourceFingerprints || []) {
    const expected = byId.get(fp.fileId);
    if (expected && expected !== fp.headerFingerprint) return true;
  }
  if (stage.compiledPlanId) {
    const plan = getBoundCompiledPlan(stage.compiledPlanId, {
      targetSchoolId: stage.targetSchoolId,
    });
    if (!plan) return true;
    const planById = new Map(plan.sourceFingerprints.map((f) => [f.fileId, f.headerFingerprint]));
    for (const fp of stage.sourceFingerprints || []) {
      const expected = planById.get(fp.fileId);
      if (expected && expected !== fp.headerFingerprint) return true;
    }
  }
  return false;
}

export function reconcileMigrationFinance(input: {
  stage: MigrationStage;
  rowsByFileId: Map<string, Record<string, string>[]>;
  parentReviewUnresolved?: number;
  applyBatchComplete?: boolean;
}): MigrationFinanceReconciliation {
  const stage = input.stage;
  const blockedReasons: string[] = [];
  const skippedUnsupported: Array<{ reason: string; detail?: string }> = [];

  if (!stage.targetSchoolId) {
    blockedReasons.push("Stage is missing target school binding.");
  }

  let analysisFingerprints: Array<{ fileId: string; headerFingerprint: string }> | null = null;
  if (stage.sourceAnalysisId) {
    const analysis = getBoundSourceAnalysis(stage.sourceAnalysisId, {
      targetSchoolId: stage.targetSchoolId,
    });
    if (!analysis) {
      blockedReasons.push("Source analysis missing or bound to a different school.");
    } else {
      analysisFingerprints = analysis.files.map((f) => ({
        fileId: f.fileId,
        headerFingerprint: f.headerFingerprint,
      }));
    }
  }

  const stale = fingerprintsStale(stage, analysisFingerprints);
  if (stale) {
    blockedReasons.push("Source or plan fingerprints changed — re-analyse, recompile, and re-apply before acceptance.");
  }

  if ((input.parentReviewUnresolved ?? 0) > 0) {
    blockedReasons.push("Parent Review still has unresolved items.");
  }

  if (input.applyBatchComplete === false) {
    blockedReasons.push("Apply batch is incomplete — finish apply before finance acceptance.");
  }

  const source = buildSourceFinancePositions({
    stage,
    rowsByFileId: input.rowsByFileId,
  });
  skippedUnsupported.push(...source.skippedUnsupported);

  const accountRefs = [...source.byAccount.keys()];
  const educlear = buildEduClearFinancePositions({
    schoolId: stage.targetSchoolId,
    accountRefs,
  });

  const perAccount: PerAccountReconciliation[] = accountRefs.map((accountRef) => {
    const sourceCents = source.byAccount.get(accountRef)?.netCents ?? 0;
    const educlearCents = educlear.byAccount.get(accountRef) ?? 0;
    const diffCents = centsDiff(sourceCents, educlearCents);
    return {
      accountRef,
      sourceCents,
      educlearCents,
      diffCents,
      ok: centsEqual(sourceCents, educlearCents),
    };
  });

  const mismatches = perAccount.filter((p) => !p.ok);
  const differenceCents = centsDiff(source.totals.netCents, educlear.totals.netCents);

  if (mismatches.length) {
    blockedReasons.push(
      `${mismatches.length} account(s) need attention before this migration can be completed.`
    );
  }
  if (!centsEqual(differenceCents, 0)) {
    blockedReasons.push("Source and EduClear finance totals do not match (difference must be R0.00).");
  }

  // Unknown finance that was skipped from posting blocks acceptance when present in source scan
  const unknownCount = source.skippedUnsupported.filter((s) =>
    /UNKNOWN|Ambiguous|confirm/i.test(s.reason)
  ).length;
  if (unknownCount > 0) {
    blockedReasons.push(`${unknownCount} unresolved finance item(s) require operator confirmation.`);
  }

  const canAccept = blockedReasons.length === 0 && !stale && mismatches.length === 0;

  const artifact: MigrationFinanceReconciliation = {
    reconciliationId: `finrec_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    reconciliationVersion: MIGRATION_FINANCE_RECONCILIATION_VERSION,
    generatedAt: new Date().toISOString(),
    migrationRunId: stage.migrationRunId || stage.stageId,
    stageId: stage.stageId,
    targetSchoolId: stage.targetSchoolId,
    sourceAnalysisId: stage.sourceAnalysisId || null,
    compiledPlanId: stage.compiledPlanId || null,
    sourceFingerprints: (stage.sourceFingerprints || []).map((f) => ({
      fileId: f.fileId,
      filename: f.filename || "",
      headerFingerprint: f.headerFingerprint,
    })),
    sourceTotals: source.totals,
    migratedTotals: educlear.totals,
    differenceCents,
    perAccount,
    mismatches,
    skippedUnsupported,
    canAccept,
    blockedReasons,
    stale,
  };

  return saveFinanceReconciliation(artifact);
}
