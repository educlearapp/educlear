/**
 * One-click Complete Migration — orchestrates existing apply/verify/accept.
 * Idempotent + cross-process file lock. Does not weaken Accept gates.
 */

import { randomUUID } from "crypto";
import { prisma } from "../../../prisma";
import { getStage } from "../staging/migrationStageStore";
import { applyMigrationStage } from "../core/applyMigrationStage";
import {
  getAcademicPlanByStage,
  applyAcademicMigrationPlan,
  verifyAcademicStructure,
  compileAcademicMigrationPlan,
  saveAcademicPlan,
} from "../academic";
import {
  getParentFamilyPlanByStage,
  applyParentFamilyMigrationPlan,
  verifyParentFamilyMigration,
  compileParentFamilyMigrationPlan,
  saveParentFamilyPlan,
  applyParentFamilyReviewAction,
} from "../parentFamily";
import { loadSchoolParentCandidates } from "../parentIdentity/loadSchoolParentCandidates";
import { parseStagedMigrationSource } from "../core/parseStagedMigrationFile";
import { reconcileMigrationFinance } from "../finance/reconcileMigrationFinance";
import { listFinanceReconciliationsForStage } from "../finance/migrationFinanceReconciliationStore";
import { verifyStatementAuthority } from "../finance/statementAuthority/verifyStatementAuthority";
import { getStatementAuthorityCheckByStage } from "../finance/statementAuthority/statementAuthorityStore";
import {
  verifyFeeCheckAuthority,
  getFeeCheckAuthorityCheckByStage,
} from "../finance/feeCheckAuthority";
import { acceptMigration, getAcceptanceByStage } from "../finance/acceptMigration";
import { computeUniversalMigrationReadiness } from "./computeUniversalMigrationReadiness";
import type { OrchestratorProgressStep, OrchestratorRunRecord } from "./OrchestratorTypes";
import { UNIVERSAL_ORCHESTRATOR_VERSION } from "./OrchestratorTypes";
import { getOrchestratorRunByStage, saveOrchestratorRun } from "./orchestratorStore";
import { withMigrationCompleteLock } from "./migrationCompleteLock";
import { getSourceManifestByStage } from "./sourceManifest";

function audit(run: OrchestratorRunRecord, event: string, detail?: string): void {
  run.audit.push({ at: new Date().toISOString(), event, detail });
  run.updatedAt = new Date().toISOString();
}

export async function completeUniversalMigration(input: {
  targetSchoolId: string;
  stageId: string;
  confirmation: boolean;
  simulateFailAt?: OrchestratorProgressStep | null;
}): Promise<{
  run: OrchestratorRunRecord;
  readiness: ReturnType<typeof computeUniversalMigrationReadiness>;
}> {
  if (!input.confirmation) {
    throw new Error("Please confirm before completing the migration.");
  }

  const stage = getStage(input.stageId);
  if (!stage || stage.targetSchoolId !== input.targetSchoolId) {
    throw new Error("MIGRATION_SCHOOL_MISMATCH");
  }

  const existingAccept = getAcceptanceByStage(stage.stageId);
  const prior = getOrchestratorRunByStage(stage.stageId);
  if (
    existingAccept?.status === "ACCEPTED" &&
    prior &&
    (prior.status === "COMPLETE_ACCEPTED" || prior.status === "COMPLETE")
  ) {
    return {
      run: { ...prior, idempotentReplay: true, terminalKind: "COMPLETE_ACCEPTED" },
      readiness: computeUniversalMigrationReadiness({
        targetSchoolId: stage.targetSchoolId,
        stageId: stage.stageId,
      }),
    };
  }
  if (prior?.terminalKind === "COMPLETE_SUPPLIED_DATA" || prior?.status === "COMPLETE_SUPPLIED_DATA") {
    return {
      run: { ...prior, idempotentReplay: true },
      readiness: computeUniversalMigrationReadiness({
        targetSchoolId: stage.targetSchoolId,
        stageId: stage.stageId,
      }),
    };
  }

  return withMigrationCompleteLock({
    stageId: stage.stageId,
    schoolId: stage.targetSchoolId,
    fn: async () => runCompleteBody(input, stage, prior),
  });
}

async function runCompleteBody(
  input: {
    targetSchoolId: string;
    stageId: string;
    confirmation: boolean;
    simulateFailAt?: OrchestratorProgressStep | null;
  },
  stage: NonNullable<ReturnType<typeof getStage>>,
  prior: OrchestratorRunRecord | null
): Promise<{
  run: OrchestratorRunRecord;
  readiness: ReturnType<typeof computeUniversalMigrationReadiness>;
}> {
  const manifest = getSourceManifestByStage(stage.stageId);
  const run: OrchestratorRunRecord =
    prior &&
    prior.status !== "COMPLETE_ACCEPTED" &&
    prior.status !== "COMPLETE_SUPPLIED_DATA"
      ? {
          ...prior,
          status: "MIGRATING",
          idempotentReplay: false,
          replayProtected: true,
          domainsFailed: [],
          terminalKind: prior.terminalKind ?? null,
          sourceSetFingerprint:
            manifest?.sourceSetFingerprint || prior.sourceSetFingerprint || null,
        }
      : {
          runId: prior?.runId || `umrun_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
          version: UNIVERSAL_ORCHESTRATOR_VERSION,
          targetSchoolId: stage.targetSchoolId,
          stageId: stage.stageId,
          startedAt: prior?.startedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          completedAt: null,
          status: "MIGRATING",
          currentStep: "PREPARING_LEARNERS",
          stepsCompleted: prior?.stepsCompleted || [],
          domainsApplied: prior?.domainsApplied || [],
          domainsSkipped: prior?.domainsSkipped || [],
          domainsFailed: [],
          replayProtected: true,
          idempotentReplay: Boolean(prior),
          acceptanceId: null,
          terminalKind: null,
          sourceSetFingerprint: manifest?.sourceSetFingerprint || null,
          summary: { warnings: [] },
          audit: prior?.audit || [],
        };

  const mark = (step: OrchestratorProgressStep) => {
    run.currentStep = step;
    if (!run.stepsCompleted.includes(step)) run.stepsCompleted.push(step);
    saveOrchestratorRun(run);
  };

  try {
    let readiness = computeUniversalMigrationReadiness({
      targetSchoolId: stage.targetSchoolId,
      stageId: stage.stageId,
    });
    if (readiness.blockingIssueCount > 0 || readiness.overallStatus === "NEEDS_ATTENTION") {
      run.status = "NEEDS_ATTENTION";
      audit(run, "blocked_needs_attention", `${readiness.blockingIssueCount} blocking`);
      saveOrchestratorRun(run);
      return { run, readiness };
    }

    mark("PREPARING_LEARNERS");
    if (input.simulateFailAt === "PREPARING_LEARNERS") {
      throw new Error("SIMULATED_FAIL:PREPARING_LEARNERS");
    }
    if (!run.domainsApplied.includes("CORE")) {
      try {
        if (stage.canApply) {
          const school = await prisma.school.findUnique({
            where: { id: stage.targetSchoolId },
            select: { name: true },
          });
          const pfReady = getParentFamilyPlanByStage(stage.stageId);
          const deferParents =
            Boolean(pfReady) && (pfReady?.criticalUnresolvedCount || 0) === 0 && !pfReady?.stale;
          const applyResult = await applyMigrationStage({
            stageId: stage.stageId,
            targetSchoolId: stage.targetSchoolId,
            confirmationText: String(school?.name || stage.targetSchoolName || "").trim(),
            mode: "APPLY",
            deferParentsToParentFamilyPlan: deferParents,
          } as any);
          if (deferParents) {
            audit(run, "core_deferred_parents_to_parent_family_plan");
          }
          run.summary.learners =
            applyResult?.createdCounts?.learners ?? run.summary.learners;
          run.summary.parents =
            applyResult?.createdCounts?.parents ?? run.summary.parents;
          run.domainsApplied.push("CORE");
          audit(run, "core_applied");
        } else {
          run.domainsSkipped.push("CORE");
          audit(run, "core_skip_canApply_false");
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/already|idempotent|duplicate/i.test(msg)) {
          if (!run.domainsApplied.includes("CORE")) run.domainsApplied.push("CORE");
          audit(run, "core_idempotent", msg);
        } else {
          throw e;
        }
      }
    }

    // After core learners exist, refresh parent/academic plans against live school data.
    if (run.domainsApplied.includes("CORE")) {
      try {
        await refreshDomainPlansAfterCore(stage);
        audit(run, "plans_refreshed_after_core");
      } catch (e: unknown) {
        audit(
          run,
          "plans_refresh_warning",
          e instanceof Error ? e.message : String(e)
        );
      }
    }

    // Post-refresh criticals must surface as Needs Attention — never apply past unresolved authority.
    {
      const pfAfter = getParentFamilyPlanByStage(stage.stageId);
      const acAfter = getAcademicPlanByStage(stage.stageId);
      const pfCritical = pfAfter?.criticalUnresolvedCount || 0;
      const acCritical = acAfter?.criticalUnresolvedCount || 0;
      if (pfCritical > 0 || acCritical > 0) {
        run.status = "NEEDS_ATTENTION";
        audit(
          run,
          "blocked_after_core_refresh",
          `parents=${pfCritical} academic=${acCritical}`
        );
        saveOrchestratorRun(run);
        readiness = computeUniversalMigrationReadiness({
          targetSchoolId: stage.targetSchoolId,
          stageId: stage.stageId,
        });
        return {
          run,
          readiness: {
            ...readiness,
            overallStatus: "NEEDS_ATTENTION",
            plainLanguageOverall: `EduClear needs ${pfCritical + acCritical} decision(s) after preparing learners.`,
            readyToComplete: false,
          },
        };
      }
    }

    mark("LINKING_PARENTS");
    if (input.simulateFailAt === "LINKING_PARENTS") {
      throw new Error("SIMULATED_FAIL:LINKING_PARENTS");
    }
    const pfPlan = getParentFamilyPlanByStage(stage.stageId);
    if (!pfPlan) {
      if (!run.domainsSkipped.includes("PARENTS_FAMILIES")) {
        run.domainsSkipped.push("PARENTS_FAMILIES");
      }
      audit(run, "parents_not_detected");
    } else if (!run.domainsApplied.includes("PARENTS_FAMILIES")) {
      const pfApply = await applyParentFamilyMigrationPlan({ plan: pfPlan });
      run.summary.parents = (run.summary.parents || 0) + (pfApply.parentsCreated || 0);
      run.summary.links = pfApply.linksUpserted;
      const pfCheck = await verifyParentFamilyMigration({ plan: pfPlan });
      if (!pfCheck.parentFamilyMatch) {
        run.domainsFailed.push({
          domainId: "PARENTS_FAMILIES",
          reason: pfCheck.blockedReasons.join("; ") || "Parents check failed",
        });
        run.status = "BLOCKED";
        audit(run, "parents_verify_failed");
        saveOrchestratorRun(run);
        readiness = computeUniversalMigrationReadiness({
          targetSchoolId: stage.targetSchoolId,
          stageId: stage.stageId,
        });
        return { run, readiness };
      }
      run.domainsApplied.push("PARENTS_FAMILIES");
      audit(run, "parents_applied_verified");
    }

    mark("PREPARING_ACADEMIC");
    if (input.simulateFailAt === "PREPARING_ACADEMIC") {
      throw new Error("SIMULATED_FAIL:PREPARING_ACADEMIC");
    }
    const acPlan = getAcademicPlanByStage(stage.stageId);
    if (!acPlan) {
      if (!run.domainsSkipped.includes("ACADEMIC")) run.domainsSkipped.push("ACADEMIC");
      audit(run, "academic_not_detected");
    } else if (!run.domainsApplied.includes("ACADEMIC")) {
      const acApply = await applyAcademicMigrationPlan({ plan: acPlan });
      run.summary.classrooms =
        (acApply.classroomsCreated || 0) + (acApply.classroomsReused || 0);
      run.summary.subjects =
        (acApply.subjectsCreated || 0) + (acApply.subjectsReused || 0);
      const acCheck = await verifyAcademicStructure({ plan: acPlan });
      if (!acCheck.academicStructureMatch) {
        run.domainsFailed.push({
          domainId: "ACADEMIC",
          reason: acCheck.blockedReasons?.join("; ") || "Academic check failed",
        });
        run.status = "BLOCKED";
        audit(run, "academic_verify_failed");
        saveOrchestratorRun(run);
        readiness = computeUniversalMigrationReadiness({
          targetSchoolId: stage.targetSchoolId,
          stageId: stage.stageId,
        });
        return { run, readiness };
      }
      run.domainsApplied.push("ACADEMIC");
      audit(run, "academic_applied_verified");
    }

    mark("CHECKING_ACCOUNTS");
    if (input.simulateFailAt === "CHECKING_ACCOUNTS") {
      throw new Error("SIMULATED_FAIL:CHECKING_ACCOUNTS");
    }

    const financeFromManifest = Boolean(
      manifest?.files.some(
        (f) =>
          f.status === "ACTIVE" &&
          (f.detectedDomains.includes("FINANCE") ||
            f.detectedDomains.includes("STATEMENTS") ||
            f.detectedDomains.includes("FEE_CHECK"))
      )
    );
    const financeHint =
      financeFromManifest ||
      (stage.stagedCounts?.billingAccounts ?? 0) > 0 ||
      (stage.stagedCounts?.transactions ?? 0) > 0;

    if (!financeHint) {
      for (const d of ["FINANCE", "STATEMENTS", "FEE_CHECK"] as const) {
        if (!run.domainsSkipped.includes(d)) run.domainsSkipped.push(d);
      }
      audit(run, "finance_not_detected");
      run.status = "COMPLETE_SUPPLIED_DATA";
      run.terminalKind = "COMPLETE_SUPPLIED_DATA";
      run.currentStep = "COMPLETE";
      run.completedAt = new Date().toISOString();
      run.summary.warnings.push(
        "Finance was not supplied — school accounts, statements and Fee Check were not verified."
      );
      audit(run, "complete_supplied_data");
      saveOrchestratorRun(run);
      readiness = computeUniversalMigrationReadiness({
        targetSchoolId: stage.targetSchoolId,
        stageId: stage.stageId,
      });
      return {
        run,
        readiness: {
          ...readiness,
          overallStatus: "COMPLETE_SUPPLIED_DATA",
          plainLanguageOverall:
            "Migration complete — finance was not supplied. Learners, parents and academics are ready where provided.",
          readyToComplete: false,
        },
      };
    }

    let recon = listFinanceReconciliationsForStage(stage.stageId).find((r) => !r.stale);
    if (!recon) {
      const rowsByFileId = new Map<string, Record<string, string>[]>();
      for (const file of stage.files || []) {
        const role = String(file.sheetRole || "DATA").toUpperCase();
        if (role === "SUMMARY" || role === "SUPPORTING") {
          rowsByFileId.set(file.fileId, []);
          continue;
        }
        try {
          const rows = await parseStagedMigrationSource(file, stage.sourceSystem);
          rowsByFileId.set(
            file.fileId,
            rows.map((r) => {
              const out: Record<string, string> = {};
              for (const [k, v] of Object.entries(r)) out[k] = String(v ?? "");
              return out;
            })
          );
        } catch {
          rowsByFileId.set(file.fileId, []);
        }
      }
      recon = reconcileMigrationFinance({
        stage,
        rowsByFileId,
        parentReviewUnresolved: 0,
        applyBatchComplete: true,
      });
      audit(run, "finance_reconciled", recon.reconciliationId);
    }
    if (!recon.canAccept || recon.differenceCents !== 0) {
      run.domainsFailed.push({
        domainId: "FINANCE",
        reason: `School accounts differ by R${(Math.abs(recon.differenceCents) / 100).toFixed(2)}`,
      });
      run.status = "BLOCKED";
      audit(run, "finance_blocked");
      saveOrchestratorRun(run);
      readiness = computeUniversalMigrationReadiness({
        targetSchoolId: stage.targetSchoolId,
        stageId: stage.stageId,
      });
      return { run, readiness };
    }
    if (!run.domainsApplied.includes("FINANCE")) run.domainsApplied.push("FINANCE");

    mark("VERIFYING_STATEMENTS");
    let stmt = getStatementAuthorityCheckByStage(stage.stageId);
    if (!stmt || stmt.stale || !stmt.statementAuthorityMatch) {
      // Write migration statement baseline into age-analysis store (authoritative statements path).
      try {
        const { finalizeMigrationStatementAuthority } = await import(
          "../finance/statementAuthority/finalizeMigrationStatementAuthority"
        );
        await finalizeMigrationStatementAuthority({
          stage,
          reconciliation: recon,
        });
        audit(run, "statement_baseline_finalized");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        run.domainsFailed.push({
          domainId: "STATEMENTS",
          reason: msg || "Could not finalise statement balances",
        });
        run.status = "BLOCKED";
        audit(run, "statement_finalize_failed", msg);
        saveOrchestratorRun(run);
        readiness = computeUniversalMigrationReadiness({
          targetSchoolId: stage.targetSchoolId,
          stageId: stage.stageId,
        });
        return { run, readiness };
      }
      stmt = verifyStatementAuthority({ stage, reconciliation: recon } as any);
      audit(run, "statement_verified", stmt.checkId);
    }
    if (!stmt.statementAuthorityMatch) {
      run.domainsFailed.push({ domainId: "STATEMENTS", reason: "Statement balances do not match" });
      run.status = "BLOCKED";
      saveOrchestratorRun(run);
      readiness = computeUniversalMigrationReadiness({
        targetSchoolId: stage.targetSchoolId,
        stageId: stage.stageId,
      });
      return { run, readiness };
    }
    if (!run.domainsApplied.includes("STATEMENTS")) run.domainsApplied.push("STATEMENTS");

    mark("VERIFYING_FEE_CHECK");
    let fee = getFeeCheckAuthorityCheckByStage(stage.stageId);
    if (!fee || fee.stale || !fee.feeCheckAuthorityMatch) {
      fee = await verifyFeeCheckAuthority({
        stage,
        reconciliation: recon,
        statementCheck: stmt,
      });
      audit(run, "fee_check_verified", fee.checkId);
    }
    if (!fee.feeCheckAuthorityMatch) {
      run.domainsFailed.push({ domainId: "FEE_CHECK", reason: "Fee Check does not match" });
      run.status = "BLOCKED";
      saveOrchestratorRun(run);
      readiness = computeUniversalMigrationReadiness({
        targetSchoolId: stage.targetSchoolId,
        stageId: stage.stageId,
      });
      return { run, readiness };
    }
    if (!run.domainsApplied.includes("FEE_CHECK")) run.domainsApplied.push("FEE_CHECK");

    mark("FINAL_SAFETY_CHECK");
    run.status = "VERIFYING";
    const acceptance = acceptMigration({
      stage,
      reconciliationId: recon.reconciliationId,
      statementAuthorityCheckId: stmt.checkId,
      feeCheckAuthorityCheckId: fee.checkId,
      confirmation: true,
      parentReviewUnresolved: 0,
      summary: {
        learners: Number(run.summary.learners || 0),
        parents: Number(run.summary.parents || 0),
        links: Number(run.summary.links || 0),
        classrooms: Number(run.summary.classrooms || 0),
        accounts: recon.sourceTotals?.accountCount || 0,
        openingBalances: recon.sourceTotals?.openingBalanceCount || 0,
        transactions: recon.sourceTotals?.transactionCount || 0,
        billingPlans: 0,
        unsupportedSkipped: 0,
        differenceCents: recon.differenceCents,
      },
    });
    run.acceptanceId = acceptance.acceptanceId;
    run.status = "COMPLETE_ACCEPTED";
    run.terminalKind = "COMPLETE_ACCEPTED";
    run.currentStep = "COMPLETE";
    run.completedAt = new Date().toISOString();
    audit(run, "accepted", acceptance.acceptanceId);
    saveOrchestratorRun(run);

    readiness = computeUniversalMigrationReadiness({
      targetSchoolId: stage.targetSchoolId,
      stageId: stage.stageId,
    });
    return {
      run,
      readiness: {
        ...readiness,
        overallStatus: "COMPLETE_ACCEPTED",
        plainLanguageOverall: "Migration complete. The school is ready to use EduClear.",
        readyToComplete: false,
      },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    run.status = "FAILED";
    run.currentStep = "FAILED";
    audit(run, "failed", msg);
    saveOrchestratorRun(run);
    const readiness = computeUniversalMigrationReadiness({
      targetSchoolId: stage.targetSchoolId,
      stageId: stage.stageId,
    });
    throw Object.assign(e instanceof Error ? e : new Error(msg), { run, readiness });
  }
}

async function loadStageSourceFiles(stage: NonNullable<ReturnType<typeof getStage>>) {
  const files: Array<{
    fileId: string;
    filename: string;
    columns: string[];
    rows: Record<string, string>[];
  }> = [];
  for (const file of stage.files || []) {
    try {
      const parsed = await parseStagedMigrationSource(file, stage.sourceSystem);
      const rows = parsed.map((r) => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(r)) out[k] = String(v ?? "");
        return out;
      });
      const columns = rows[0] ? Object.keys(rows[0]) : [];
      files.push({
        fileId: file.fileId,
        filename: String(file.filename || ""),
        columns,
        rows,
      });
    } catch {
      /* skip unreadable */
    }
  }
  return files;
}

/** Recompile academic + parent plans after learners exist so apply/verify can match. */
async function refreshDomainPlansAfterCore(
  stage: NonNullable<ReturnType<typeof getStage>>
): Promise<void> {
  const files = await loadStageSourceFiles(stage);
  if (!files.length) return;
  const schoolId = stage.targetSchoolId;

  if (getAcademicPlanByStage(stage.stageId)) {
    const priorAc = getAcademicPlanByStage(stage.stageId)!;
    // Do not wipe operator-cleared academic decisions by recompiling when already clear.
    // Learner placements resolve by ID number at apply time once core learners exist.
    if (priorAc.criticalUnresolvedCount > 0 || priorAc.stale) {
      const [existingClassrooms, existingSubjects] = await Promise.all([
        prisma.classroom.findMany({ where: { schoolId }, select: { name: true } }),
        prisma.schoolSubject.findMany({ where: { schoolId }, select: { name: true } }),
      ]);
      const { plan } = compileAcademicMigrationPlan({
        targetSchoolId: schoolId,
        stageId: stage.stageId,
        sourceAnalysisId: stage.sourceAnalysisId || null,
        compiledPlanId: stage.compiledPlanId || null,
        files,
        existingClassroomNames: existingClassrooms.map((c) => c.name),
        existingSubjectNames: existingSubjects.map((s) => s.name),
      });
      saveAcademicPlan(plan);
    }
  }

  if (getParentFamilyPlanByStage(stage.stageId)) {
    const priorPf = getParentFamilyPlanByStage(stage.stageId)!;
    const [candidates, learners] = await Promise.all([
      loadSchoolParentCandidates(prisma, schoolId),
      prisma.learner.findMany({
        where: { schoolId },
        select: {
          id: true,
          idNumber: true,
          admissionNo: true,
          firstName: true,
          lastName: true,
        },
      }),
    ]);
    const { plan } = compileParentFamilyMigrationPlan({
      targetSchoolId: schoolId,
      stageId: stage.stageId,
      sourceAnalysisId: stage.sourceAnalysisId || null,
      files,
      candidates,
      learners,
    });
    // Preserve CREATE_NEW / explicit decisions where proposal keys still exist.
    let next = saveParentFamilyPlan(plan);
    if (priorPf.criticalUnresolvedCount === 0 && next.criticalUnresolvedCount > 0) {
      for (const item of [...(next.reviewItems || [])]) {
        if (item.severity !== "CRITICAL") continue;
        next = applyParentFamilyReviewAction({
          plan: next,
          proposalId: item.proposalId,
          action: "CREATE_NEW",
        });
      }
    }
    saveParentFamilyPlan(next);
  }
}
