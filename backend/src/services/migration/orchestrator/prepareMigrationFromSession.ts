/**
 * Phase 1M — Prepare migration from uploaded session (no operator Dry Run).
 * SAFE analysis only — no school business-data mutations.
 */

import { createHash, randomUUID } from "crypto";
import { prisma } from "../../../prisma";
import {
  getMigrationSession,
  saveMigrationSession,
} from "../core/migrationSessionStore";
import { readMigrationFilePreview } from "../core/readMigrationFilePreview";
import { readMigrationFileRows } from "../core/readMigrationFileRows";
import { analyzeMigrationPackage } from "../sourceAnalysis/analyzeMigrationPackage";
import { saveSourceAnalysis } from "../sourceAnalysis/migrationSourceAnalysisStore";
import { compileMigrationPlan } from "../migrationPlan/compileMigrationPlan";
import {
  getBoundCompiledPlan,
  saveCompiledPlan,
} from "../migrationPlan/migrationPlanStore";
import { buildMigrationStage } from "../staging/buildMigrationStage";
import { createStage, getStage } from "../staging/migrationStageStore";
import { suggestColumnMappings } from "../core/suggestColumnMappings";
import { runAutomaticMigrationAnalysis } from "./runAutomaticMigrationAnalysis";
import { computeUniversalMigrationReadiness } from "./computeUniversalMigrationReadiness";
import type { AutomaticAnalysisResult } from "./OrchestratorTypes";
import {
  contentFingerprint,
  detectDomainsFromColumns,
  getSourceManifestBySchool,
  headerFingerprint,
  logicalSourceKey,
  saveSourceManifest,
  type MigrationSourceManifest,
  type SourceManifestFile,
  computeSourceSetFingerprint,
  domainsStaleFromFileDomains,
} from "./sourceManifest";
import type { MigrationFile } from "../types/MigrationFile";
import type { MigrationFilePreview } from "../types/MigrationFilePreview";
import type { MigrationFileColumnMappings } from "../types/MigrationValidation";
import {
  getAcademicPlanByStage,
  saveAcademicPlan,
} from "../academic/academicPlanStore";
import {
  getParentFamilyPlanByStage,
  saveParentFamilyPlan,
} from "../parentFamily/parentFamilyPlanStore";
import {
  listFinanceReconciliationsForStage,
  saveFinanceReconciliation,
} from "../finance/migrationFinanceReconciliationStore";
import { getStatementAuthorityCheckByStage } from "../finance/statementAuthority/statementAuthorityStore";
import { getFeeCheckAuthorityCheckByStage } from "../finance/feeCheckAuthority";
import { saveStatementAuthorityCheck } from "../finance/statementAuthority/statementAuthorityStore";
import { saveFeeCheckAuthorityCheck } from "../finance/feeCheckAuthority";

export type PrepareFromSessionResult = {
  stageId: string;
  targetSchoolId: string;
  sourceSetFingerprint: string;
  manifest: MigrationSourceManifest;
  analysis: AutomaticAnalysisResult;
  steps: string[];
  reusedExistingStage: boolean;
};

function buildMappingsFromPreviews(
  previews: MigrationFilePreview[],
  systemId?: string
): MigrationFileColumnMappings[] {
  return previews.map((preview) => {
    const result = suggestColumnMappings({
      fileId: preview.fileId,
      filename: preview.filename,
      category: preview.category,
      columns: preview.columns || [],
      worksheetName: preview.worksheetName,
      systemId,
    });
    return {
      fileId: preview.fileId,
      mappings: (result.mappings || [])
        .filter((s) => s.suggestedTarget && s.confidence >= 70)
        .map((s) => ({
          sourceColumn: s.sourceColumn,
          targetField: s.suggestedTarget!,
        })),
    };
  });
}

export async function prepareMigrationFromSession(input: {
  targetSchoolId: string;
  targetSchoolName?: string;
  sourceSystem?: string;
  cutoverDate?: string;
  forceRecompile?: boolean;
}): Promise<PrepareFromSessionResult> {
  const schoolId = String(input.targetSchoolId || "").trim();
  if (!schoolId) throw new Error("targetSchoolId is required");
  const school =
    (await prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, name: true },
    })) || null;
  if (!school) throw new Error("School not found");

  const session = getMigrationSession(schoolId);
  if (!session?.uploadedFiles?.length) {
    throw new Error("Upload school export files before analysis.");
  }

  const steps: string[] = [];
  steps.push("Loading uploaded school files");

  // Build / refresh previews
  const previews: MigrationFilePreview[] = [];
  for (const file of session.uploadedFiles) {
    try {
      const preview = await readMigrationFilePreview(file as MigrationFile, {
        sourceSystem: String(input.sourceSystem || session.sourceSystem || ""),
      });
      previews.push({
        ...preview,
        fileId: file.id,
        path: file.path,
        filename: file.filename,
        category: file.category,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not read file";
      steps.push(`Could not read ${file.filename}: ${msg}`);
    }
  }
  if (!previews.length) {
    throw new Error(
      "EduClear could not read any of the uploaded files. Check the file formats and try again."
    );
  }
  steps.push(`Understood ${previews.length} file(s)`);

  // Source manifest
  const now = new Date().toISOString();
  const priorManifest = getSourceManifestBySchool(schoolId);
  const manifestFiles: SourceManifestFile[] = previews.map((p) => {
    const cols = p.columns || [];
    const sample = (p.sampleRows || []).map((r) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) out[k] = String(v ?? "");
      return out;
    });
    const fp = contentFingerprint({
      filename: p.filename,
      worksheetName: p.worksheetName,
      columns: cols,
      sampleRows: sample,
      rowCount: p.rowCount,
      size: session.uploadedFiles.find((f) => f.id === p.fileId)?.size,
    });
    const prior = priorManifest?.files.find(
      (f) =>
        f.status === "ACTIVE" &&
        logicalSourceKey(f.filename, f.worksheetName) ===
          logicalSourceKey(p.filename, p.worksheetName)
    );
    return {
      fileId: p.fileId,
      filename: p.filename,
      ...(p.worksheetName ? { worksheetName: p.worksheetName } : {}),
      category: String(p.category || "unknown"),
      contentFingerprint: fp,
      headerFingerprint: headerFingerprint(p.filename, cols, p.worksheetName),
      detectedDomains: detectDomainsFromColumns(cols),
      rowCount: Number(p.rowCount) || sample.length,
      size: session.uploadedFiles.find((f) => f.id === p.fileId)?.size || 0,
      status: "ACTIVE" as const,
      addedAt: prior?.addedAt || now,
      updatedAt: now,
    };
  });

  // Mark removed files from prior
  if (priorManifest) {
    for (const old of priorManifest.files) {
      if (old.status !== "ACTIVE") continue;
      const still =
        manifestFiles.some(
          (f) => f.filename.toLowerCase() === old.filename.toLowerCase()
        );
      if (!still) {
        manifestFiles.push({ ...old, status: "REMOVED", updatedAt: now });
      }
    }
  }

  const sourceSetFingerprint = computeSourceSetFingerprint(manifestFiles);
  const fingerprintUnchanged =
    priorManifest?.sourceSetFingerprint === sourceSetFingerprint &&
    session.dryRunStage?.stageId &&
    getStage(session.dryRunStage.stageId);

  if (fingerprintUnchanged && !input.forceRecompile) {
    steps.push("Source files unchanged — reusing prepared migration package");
    const stageId = session.dryRunStage!.stageId;
    const analysis = await runAutomaticMigrationAnalysis({
      targetSchoolId: schoolId,
      stageId,
      forceRecompile: false,
    });
    const manifest = saveSourceManifest({
      manifestId: priorManifest?.manifestId || `msm_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      version: "1M.1",
      targetSchoolId: schoolId,
      stageId,
      generatedAt: priorManifest?.generatedAt || now,
      updatedAt: now,
      sourceSetFingerprint,
      files: manifestFiles,
    });
    return {
      stageId,
      targetSchoolId: schoolId,
      sourceSetFingerprint,
      manifest,
      analysis,
      steps,
      reusedExistingStage: true,
    };
  }

  // Invalidate affected domain artifacts when fingerprint changed
  if (priorManifest && priorManifest.sourceSetFingerprint !== sourceSetFingerprint) {
    const changedDomains = new Set<string>();
    for (const f of manifestFiles) {
      const prior = priorManifest.files.find(
        (p) => p.filename.toLowerCase() === f.filename.toLowerCase() && p.status === "ACTIVE"
      );
      if (!prior || prior.contentFingerprint !== f.contentFingerprint || f.status === "REMOVED") {
        for (const d of domainsStaleFromFileDomains(
          f.status === "REMOVED" ? prior?.detectedDomains || f.detectedDomains : f.detectedDomains
        )) {
          changedDomains.add(d);
        }
      }
    }
    steps.push(
      `Source changed — refreshing: ${[...changedDomains].join(", ") || "package"}`
    );
    // Mark existing domain checks stale when stage reused later
    if (session.dryRunStage?.stageId) {
      markDomainsStale(session.dryRunStage.stageId, [...changedDomains] as any);
    }
  }

  // Package analysis + plan (zero DB writes)
  const analysisFiles = previews.map((p) => ({
    fileId: p.fileId,
    filename: p.filename,
    path: p.path,
    category: String(p.category || ""),
    columns: p.columns || [],
    sampleRows: p.sampleRows || [],
    rowCount: p.rowCount,
    sheetNames: p.worksheetName ? [p.worksheetName] : [],
    worksheetName: p.worksheetName,
    sheetRole: p.sheetRole,
  }));
  const sourceAnalysis = analyzeMigrationPackage({
    targetSchoolId: schoolId,
    targetSchoolName: input.targetSchoolName || school.name,
    stageId: null,
    migrationRunId: null,
    systemIdHint: String(input.sourceSystem || session.sourceSystem || "") || null,
    files: analysisFiles,
  });
  saveSourceAnalysis(sourceAnalysis);
  steps.push("Identified what the school supplied");

  const plan = compileMigrationPlan({
    analysis: sourceAnalysis,
  });
  saveCompiledPlan(plan);
  steps.push("Prepared migration plan");

  const mappings = buildMappingsFromPreviews(
    previews,
    String(input.sourceSystem || session.sourceSystem || "")
  );

  // Soft validation summary for auto-stage (errors still block)
  const validationSummary = {
    mode: "full" as const,
    rowsChecked: previews.reduce((n, p) => n + (Number(p.rowCount) || 0), 0),
    totalIssues: 0,
    errors: 0,
    warnings: 0,
    info: 0,
    canProceed: true,
    issuesShown: 0,
  };

  const rowsByFileId = new Map<string, Record<string, unknown>[]>();
  for (const preview of previews) {
    const file = session.uploadedFiles.find((f) => f.id === preview.fileId);
    if (!file?.path) {
      rowsByFileId.set(preview.fileId, preview.sampleRows || []);
      continue;
    }
    try {
      const parsed = await readMigrationFileRows(file as MigrationFile, {
        sourceSystem: String(input.sourceSystem || session.sourceSystem || ""),
      });
      rowsByFileId.set(preview.fileId, parsed.rows);
    } catch {
      rowsByFileId.set(preview.fileId, preview.sampleRows || []);
    }
  }

  const stage = buildMigrationStage({
    sourceSystem: String(input.sourceSystem || session.sourceSystem || "generic-excel-csv"),
    targetSchoolId: schoolId,
    targetSchoolName: input.targetSchoolName || school.name,
    previews,
    mappings,
    validationSummary,
    issues: [],
    cutoverDate: input.cutoverDate || session.cutoverDate || null,
    rowsByFileId,
    sourceAnalysisId: sourceAnalysis.analysisId,
    analysisVersion: (sourceAnalysis as { version?: string }).version,
    compiledPlanId: plan.planId,
    compiledPlanVersion: plan.planVersion,
    sourceFingerprints: plan.sourceFingerprints,
  });

  createStage(stage);
  steps.push("Prepared school migration package");

  saveCompiledPlan({
    ...plan,
    stageId: stage.stageId,
    migrationRunId: stage.migrationRunId,
    updatedAt: new Date().toISOString(),
  });

  const manifest = saveSourceManifest({
    manifestId: `msm_${createHash("sha256").update(schoolId + sourceSetFingerprint).digest("hex").slice(0, 16)}`,
    version: "1M.1",
    targetSchoolId: schoolId,
    stageId: stage.stageId,
    generatedAt: now,
    updatedAt: now,
    sourceSetFingerprint,
    files: manifestFiles,
  });

  saveMigrationSession(schoolId, {
    previews,
    dryRunStage: stage,
    sourceAnalysisId: sourceAnalysis.analysisId,
    compiledPlanId: plan.planId,
    validationSummary,
    validationMode: "full",
    cutoverDate: input.cutoverDate || session.cutoverDate || "",
  });

  const analysis = await runAutomaticMigrationAnalysis({
    targetSchoolId: schoolId,
    stageId: stage.stageId,
    forceRecompile: true,
  });
  steps.push(...analysis.steps);
  steps.push(analysis.readiness.plainLanguageOverall);

  return {
    stageId: stage.stageId,
    targetSchoolId: schoolId,
    sourceSetFingerprint,
    manifest,
    analysis,
    steps,
    reusedExistingStage: false,
  };
}

function markDomainsStale(stageId: string, domains: string[]): void {
  if (domains.includes("ACADEMIC") || domains.includes("CORE")) {
    const plan = getAcademicPlanByStage(stageId);
    if (plan) saveAcademicPlan({ ...plan, stale: true });
  }
  if (domains.includes("PARENTS_FAMILIES") || domains.includes("CORE")) {
    const plan = getParentFamilyPlanByStage(stageId);
    if (plan) saveParentFamilyPlan({ ...plan, stale: true });
  }
  if (domains.includes("FINANCE") || domains.includes("STATEMENTS") || domains.includes("FEE_CHECK")) {
    for (const recon of listFinanceReconciliationsForStage(stageId)) {
      saveFinanceReconciliation({ ...recon, stale: true });
    }
    const stmt = getStatementAuthorityCheckByStage(stageId);
    if (stmt) saveStatementAuthorityCheck({ ...stmt, stale: true });
    const fee = getFeeCheckAuthorityCheckByStage(stageId);
    if (fee) saveFeeCheckAuthorityCheck({ ...fee, stale: true });
  }
  void getBoundCompiledPlan;
}
