/**
 * Automatic discovery/compile for applicable domains after staging.
 * Reuses academic + parent/family compilers — no duplicate matching.
 */

import { prisma } from "../../../prisma";
import { getStage } from "../staging/migrationStageStore";
import { parseStagedMigrationFile } from "../core/parseStagedMigrationFile";
import {
  compileAcademicMigrationPlan,
  saveAcademicDiscovery,
  saveAcademicPlan,
  getAcademicPlanByStage,
} from "../academic";
import {
  compileParentFamilyMigrationPlan,
  saveParentFamilyDiscovery,
  saveParentFamilyPlan,
  getParentFamilyPlanByStage,
} from "../parentFamily";
import { loadSchoolParentCandidates } from "../parentIdentity/loadSchoolParentCandidates";
import { computeUniversalMigrationReadiness } from "./computeUniversalMigrationReadiness";
import type { AutomaticAnalysisResult } from "./OrchestratorTypes";
import { randomUUID } from "crypto";

async function loadStageFiles(stageId: string) {
  const stage = getStage(stageId);
  if (!stage) throw new Error("Migration package not found");
  const files: Array<{
    fileId: string;
    filename: string;
    columns: string[];
    rows: Record<string, string>[];
  }> = [];
  for (const file of stage.files || []) {
    const parsed = await parseStagedMigrationFile(
      String(file.path || ""),
      String(file.filename || "")
    );
    const rows = parsed.map((r) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) out[k] = String(v ?? "");
      return out;
    });
    const columns = rows[0] && Object.keys(rows[0]).length ? Object.keys(rows[0]) : [];
    files.push({
      fileId: file.fileId,
      filename: String(file.filename || ""),
      columns,
      rows,
    });
  }
  return { stage, files };
}

function looksAcademic(files: Array<{ columns: string[] }>): boolean {
  const joined = files.flatMap((f) => f.columns).join("|").toLowerCase();
  return /grade|class|subject|classroom|homeroom|register/.test(joined);
}

function looksParents(files: Array<{ columns: string[] }>): boolean {
  const joined = files.flatMap((f) => f.columns).join("|").toLowerCase();
  return /mother|father|guardian|parent|cellphone|mobile|email/.test(joined);
}

export async function runAutomaticMigrationAnalysis(input: {
  targetSchoolId: string;
  stageId: string;
  forceRecompile?: boolean;
}): Promise<AutomaticAnalysisResult> {
  const steps: string[] = [];
  const { stage, files } = await loadStageFiles(input.stageId);
  if (stage.targetSchoolId !== input.targetSchoolId) {
    throw new Error("MIGRATION_SCHOOL_MISMATCH");
  }
  steps.push("Loaded staged school files");

  if (looksAcademic(files) && (input.forceRecompile || !getAcademicPlanByStage(stage.stageId))) {
    const [existingClassrooms, existingSubjects] = await Promise.all([
      prisma.classroom.findMany({
        where: { schoolId: stage.targetSchoolId },
        select: { name: true },
      }),
      prisma.schoolSubject.findMany({
        where: { schoolId: stage.targetSchoolId },
        select: { name: true },
      }),
    ]);
    const { discovery, plan } = compileAcademicMigrationPlan({
      targetSchoolId: stage.targetSchoolId,
      stageId: stage.stageId,
      sourceAnalysisId: stage.sourceAnalysisId || null,
      compiledPlanId: stage.compiledPlanId || null,
      files,
      existingClassroomNames: existingClassrooms.map((c) => c.name),
      existingSubjectNames: existingSubjects.map((s) => s.name),
    });
    saveAcademicDiscovery(discovery);
    saveAcademicPlan(plan);
    steps.push(
      plan.criticalUnresolvedCount > 0
        ? `Academic structure found — ${plan.criticalUnresolvedCount} item(s) need attention`
        : "Academic structure analysed automatically"
    );
  } else if (!looksAcademic(files)) {
    steps.push("No academic structure columns detected — skipped");
  } else {
    steps.push("Academic plan already present — reused");
  }

  if (looksParents(files) && (input.forceRecompile || !getParentFamilyPlanByStage(stage.stageId))) {
    const [candidates, learners] = await Promise.all([
      loadSchoolParentCandidates(prisma, stage.targetSchoolId),
      prisma.learner.findMany({
        where: { schoolId: stage.targetSchoolId },
        select: {
          id: true,
          idNumber: true,
          admissionNo: true,
          firstName: true,
          lastName: true,
        },
      }),
    ]);
    const { discovery, plan } = compileParentFamilyMigrationPlan({
      targetSchoolId: stage.targetSchoolId,
      stageId: stage.stageId,
      sourceAnalysisId: stage.sourceAnalysisId || null,
      files,
      candidates,
      learners,
    });
    saveParentFamilyDiscovery(discovery);
    saveParentFamilyPlan(plan);
    steps.push(
      plan.criticalUnresolvedCount > 0
        ? `Parents & families found — ${plan.criticalUnresolvedCount} item(s) need attention`
        : "Parents & families analysed automatically"
    );
  } else if (!looksParents(files)) {
    steps.push("No parent/guardian columns detected — skipped");
  } else {
    steps.push("Parents & families plan already present — reused");
  }

  const readiness = computeUniversalMigrationReadiness({
    targetSchoolId: stage.targetSchoolId,
    stageId: stage.stageId,
  });
  steps.push(`Overall status: ${readiness.plainLanguageOverall}`);

  return {
    analysisId: `umana_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    targetSchoolId: stage.targetSchoolId,
    stageId: stage.stageId,
    generatedAt: new Date().toISOString(),
    steps,
    readiness,
  };
}
