/**
 * Authoritative UniversalMigrationReadiness — aggregates existing domain stores.
 * Does NOT reimplement matching, balances, or academic logic.
 */

import { randomUUID } from "crypto";
import { getStage } from "../staging/migrationStageStore";
import { getAcceptanceByStage } from "../finance/acceptMigration";
import {
  getBoundFinanceReconciliation,
  listFinanceReconciliationsForStage,
} from "../finance/migrationFinanceReconciliationStore";
import { getStatementAuthorityCheckByStage } from "../finance/statementAuthority/statementAuthorityStore";
import { getFeeCheckAuthorityCheckByStage } from "../finance/feeCheckAuthority";
import {
  getAcademicPlanByStage,
  getAcademicCheckByStage,
  getAcademicApplyByPlan,
} from "../academic/academicPlanStore";
import {
  getParentFamilyPlanByStage,
  getParentFamilyCheckByStage,
  getParentFamilyApplyByPlan,
} from "../parentFamily/parentFamilyPlanStore";
import { listImportBatchSummaries } from "../core/migrationImportBatchStore";
import type {
  AttentionItem,
  DomainStatusSnapshot,
  MigrationDomainId,
  OverallMigrationStatus,
  UniversalMigrationReadiness,
} from "./OrchestratorTypes";
import { UNIVERSAL_ORCHESTRATOR_VERSION } from "./OrchestratorTypes";
import { getOrchestratorRunByStage, saveOrchestratorReadiness } from "./orchestratorStore";
import { getSourceManifestByStage } from "./sourceManifest";
import { getMigrationIntegrityByStage } from "../core/migrationIntegrityStore";

function listReconForStage(stageId: string) {
  try {
    return listFinanceReconciliationsForStage?.(stageId) || [];
  } catch {
    return [];
  }
}

export function computeUniversalMigrationReadiness(input: {
  targetSchoolId: string;
  stageId: string;
}): UniversalMigrationReadiness {
  const stage = getStage(input.stageId);
  if (!stage || stage.targetSchoolId !== input.targetSchoolId) {
    const blocked: UniversalMigrationReadiness = {
      readinessId: `umr_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      version: UNIVERSAL_ORCHESTRATOR_VERSION,
      generatedAt: new Date().toISOString(),
      targetSchoolId: input.targetSchoolId,
      stageId: input.stageId,
      overallStatus: "BLOCKED",
      plainLanguageOverall: "This migration package was not found for the selected school.",
      applicableDomains: [],
      domains: [],
      attentionItems: [],
      blockingIssueCount: 1,
      warningCount: 0,
      informationCount: 0,
      staleDomains: [],
      failedDomains: [],
      readyToComplete: false,
      readyToAccept: false,
      sourceFingerprint: null,
      summaryLines: ["Migration package missing or school mismatch."],
      operatorEffort: {
        manualMappingActionsRequired: 0,
        operatorReviewDecisionsRequired: 0,
        primaryActionsAfterAnalysis: 0,
      },
    };
    return saveOrchestratorReadiness(blocked);
  }

  const attentionItems: AttentionItem[] = [];
  const domains: DomainStatusSnapshot[] = [];
  const staleDomains: MigrationDomainId[] = [];
  const failedDomains: MigrationDomainId[] = [];

  // --- CORE (learners / staging / apply) ---
  const batches = listImportBatchSummaries().filter(
    (b) => b.stageId === stage.stageId && b.targetSchoolId === stage.targetSchoolId
  );
  const coreApplied = batches.some(
    (b) =>
      String(b.status).toLowerCase() === "applied" ||
      String(b.status).toLowerCase() === "completed" ||
      String(b.status).toLowerCase() === "success" ||
      String(b.status).toLowerCase() === "committed"
  );
  const coreReady = stage.canApply || coreApplied || (stage.stagedCounts?.learners ?? 0) > 0;
  const core: DomainStatusSnapshot = {
    domainId: "CORE",
    label: "Learners",
    applicable: true,
    status: coreApplied ? "APPLIED" : coreReady ? "READY" : "BLOCKED",
    plainLanguage: coreApplied
      ? "Learners are prepared in EduClear."
      : coreReady
        ? `${stage.stagedCounts?.learners ?? 0} learners ready to migrate.`
        : "Learner staging is not ready yet.",
    metrics: {
      learners: stage.stagedCounts?.learners ?? 0,
      parents: stage.stagedCounts?.parents ?? 0,
      applied: coreApplied,
    },
    blockingCount: coreReady ? 0 : 1,
    warningCount: 0,
  };
  if (!coreReady) {
    attentionItems.push({
      attentionId: "core_not_ready",
      domainId: "CORE",
      severity: "BLOCKING",
      title: "Learners not ready",
      message: "EduClear still needs to finish analysing the uploaded school files.",
      reviewSection: "staging",
    });
  }
  domains.push(core);

  const integrity = getMigrationIntegrityByStage(stage.stageId);
  if (integrity && integrity.findings.length > 0) {
    for (const finding of integrity.findings) {
      attentionItems.push({
        attentionId: finding.findingId,
        domainId: finding.accountRef ? "FINANCE" : "PARENTS_FAMILIES",
        severity: finding.severity,
        title: finding.title,
        message: finding.message,
        reviewSection: finding.accountRef ? "finance" : "parentsFamilies",
      });
    }
  }

  // --- PARENTS & FAMILIES (1K) — optional ---
  const pfPlan = getParentFamilyPlanByStage(stage.stageId);
  if (!pfPlan) {
    domains.push({
      domainId: "PARENTS_FAMILIES",
      label: "Parents & Families",
      applicable: false,
      status: "NOT_DETECTED",
      plainLanguage: "No parent/family information detected in this package.",
      metrics: {},
      blockingCount: 0,
      warningCount: 0,
    });
  } else {
    const pfCheck = getParentFamilyCheckByStage(stage.stageId);
    const pfApply = getParentFamilyApplyByPlan(pfPlan.planId);
    let status: DomainStatusSnapshot["status"] = "READY";
    if (pfPlan.stale) {
      status = "STALE";
      staleDomains.push("PARENTS_FAMILIES");
    } else if (pfPlan.criticalUnresolvedCount > 0) {
      status = "NEEDS_REVIEW";
      for (const item of pfPlan.reviewItems.filter((r) => r.severity === "CRITICAL")) {
        attentionItems.push({
          attentionId: `pf_${item.proposalId}`,
          domainId: "PARENTS_FAMILIES",
          severity: "BLOCKING",
          title: "Parent needs your attention",
          message: item.message,
          reviewSection: "parentsFamilies",
          proposalId: item.proposalId,
          kind: item.kind,
        });
      }
    } else if (pfCheck?.parentFamilyMatch && !pfCheck.stale) {
      status = "VERIFIED";
    } else if (pfApply) {
      status = "APPLIED";
    }
    for (const item of pfPlan.reviewItems.filter((r) => r.severity === "NON_CRITICAL")) {
      attentionItems.push({
        attentionId: `pfw_${item.proposalId}`,
        domainId: "PARENTS_FAMILIES",
        severity: "WARNING",
        title: "Parent note",
        message: item.message,
        reviewSection: "parentsFamilies",
        proposalId: item.proposalId,
      });
    }
    domains.push({
      domainId: "PARENTS_FAMILIES",
      label: "Parents & Families",
      applicable: true,
      status,
      plainLanguage:
        status === "NEEDS_REVIEW"
          ? `${pfPlan.criticalUnresolvedCount} parent item(s) need your attention.`
          : status === "VERIFIED"
            ? `${pfPlan.metrics.automaticallyResolved} resolved · ${pfPlan.metrics.proposedNew} new parents ready.`
            : `${pfPlan.metrics.automaticallyResolved} resolved automatically · ${pfPlan.metrics.proposedNew} new · ${pfPlan.metrics.reviewRequired} need review.`,
      metrics: { ...pfPlan.metrics },
      blockingCount: pfPlan.criticalUnresolvedCount,
      warningCount: pfPlan.nonCriticalUnresolvedCount,
    });
  }

  // --- ACADEMIC (1J) — optional ---
  const acPlan = getAcademicPlanByStage(stage.stageId);
  if (!acPlan) {
    domains.push({
      domainId: "ACADEMIC",
      label: "Academic Structure",
      applicable: false,
      status: "NOT_DETECTED",
      plainLanguage: "No academic structure information detected.",
      metrics: {},
      blockingCount: 0,
      warningCount: 0,
    });
  } else {
    const acCheck = getAcademicCheckByStage(stage.stageId);
    const acApply = getAcademicApplyByPlan(acPlan.planId);
    let status: DomainStatusSnapshot["status"] = "READY";
    if (acPlan.stale) {
      status = "STALE";
      staleDomains.push("ACADEMIC");
    } else if (acPlan.criticalUnresolvedCount > 0) {
      status = "NEEDS_REVIEW";
      for (const item of acPlan.reviewItems.filter((r) => r.severity === "CRITICAL")) {
        attentionItems.push({
          attentionId: `ac_${item.proposalId}`,
          domainId: "ACADEMIC",
          severity: "BLOCKING",
          title: "Academic item needs your attention",
          message: item.message,
          reviewSection: "academic",
          proposalId: item.proposalId,
          kind: item.kind,
        });
      }
    } else if (acCheck?.academicStructureMatch && !acCheck.stale) {
      status = "VERIFIED";
    } else if (acApply) {
      status = "APPLIED";
    }
    for (const item of acPlan.reviewItems.filter((r) => r.severity === "NON_CRITICAL")) {
      attentionItems.push({
        attentionId: `acw_${item.proposalId}`,
        domainId: "ACADEMIC",
        severity: "WARNING",
        title: "Academic note",
        message: item.message,
        reviewSection: "academic",
        proposalId: item.proposalId,
      });
    }
    domains.push({
      domainId: "ACADEMIC",
      label: "Academic Structure",
      applicable: true,
      status,
      plainLanguage:
        status === "NEEDS_REVIEW"
          ? `${acPlan.criticalUnresolvedCount} academic item(s) need your attention.`
          : `${acPlan.classes?.length ?? 0} classes · ${acPlan.learnerPlacements?.length ?? 0} placements · ${acPlan.subjects?.length ?? 0} subjects.`,
      metrics: {
        classes: acPlan.classes?.length ?? 0,
        placements: acPlan.learnerPlacements?.length ?? 0,
        subjects: acPlan.subjects?.length ?? 0,
        critical: acPlan.criticalUnresolvedCount,
      },
      blockingCount: acPlan.criticalUnresolvedCount,
      warningCount: acPlan.nonCriticalUnresolvedCount,
    });
  }

  // --- FINANCE (1G) — optional until recon exists OR finance counts in stage ---
  const financeHint =
    (stage.stagedCounts?.billingAccounts ?? 0) > 0 ||
    (stage.stagedCounts?.transactions ?? 0) > 0 ||
    Boolean(stage.cutoverDate);
  const reconList = listReconForStage(stage.stageId);
  let recon =
    reconList[0] ||
    null;
  // Prefer latest non-stale
  if (reconList.length) {
    recon = reconList.find((r) => !r.stale) || reconList[0];
  }

  if (!financeHint && !recon) {
    domains.push({
      domainId: "FINANCE",
      label: "Finance",
      applicable: false,
      status: "NOT_DETECTED",
      plainLanguage: "No finance information detected.",
      metrics: {},
      blockingCount: 0,
      warningCount: 0,
    });
    domains.push({
      domainId: "STATEMENTS",
      label: "Statements",
      applicable: false,
      status: "NOT_DETECTED",
      plainLanguage: "Statements check not applicable (no finance information).",
      metrics: {},
      blockingCount: 0,
      warningCount: 0,
    });
    domains.push({
      domainId: "FEE_CHECK",
      label: "Fee Check",
      applicable: false,
      status: "NOT_DETECTED",
      plainLanguage: "Fee Check not applicable (no finance information).",
      metrics: {},
      blockingCount: 0,
      warningCount: 0,
    });
  } else {
    // Finance applicable — distinguish projected (pre-import) from verified (post-import).
    const txReady = stage.transactionReadiness;
    const projectedEligible = Number(txReady?.eligibleActiveTransactions ?? 0);
    const projectedBlocked = Number(txReady?.blockedTransactions ?? 0);
    const projectedUnmatched = Number(txReady?.unmatchedTransactions ?? 0);
    const projectedHistorical = Number(txReady?.historicalOnlyTransactions ?? 0);

    let finStatus: DomainStatusSnapshot["status"] = "READY";
    let finBlocking = 0;
    let finPlain =
      "Source finance is staged. Projected only — actual totals are verified after import.";
    let reconciliationPhase: "projected" | "verified" | "failed" | "stale" = "projected";

    if (!recon) {
      // Pre-apply: never claim match/mismatch; never VERIFIED.
      finStatus = "READY";
      finBlocking = 0;
      reconciliationPhase = "projected";
      finPlain =
        projectedEligible > 0 || (stage.stagedCounts?.transactions ?? 0) > 0
          ? `Source finance staged (${projectedEligible} payment(s) projected to post` +
            (projectedHistorical ? `, ${projectedHistorical} historical-only` : "") +
            (projectedBlocked + projectedUnmatched
              ? `, ${projectedBlocked + projectedUnmatched} need attention`
              : "") +
            "). Actual R0.00 match is confirmed only after import."
          : "Source opening balances / accounts are staged. Actual totals are verified after import.";
      if (projectedUnmatched > 0 || projectedBlocked > 0) {
        attentionItems.push({
          attentionId: `fin_projected_${stage.stageId}`,
          domainId: "FINANCE",
          severity: "WARNING",
          title: "Some source payments may not post",
          message: `${projectedUnmatched} unmatched and ${projectedBlocked} invalid/blocked payment row(s) were found in the upload. They will not be posted; unresolved money can block acceptance after import.`,
          reviewSection: "finance",
        });
      }
    } else if (recon.stale) {
      finStatus = "STALE";
      staleDomains.push("FINANCE");
      finBlocking = 1;
      reconciliationPhase = "stale";
      finPlain = "Finance check is out of date — re-check after the latest import.";
    } else if (!recon.canAccept || recon.differenceCents !== 0 || recon.mismatches.length) {
      finStatus = "BLOCKED";
      finBlocking = 1;
      reconciliationPhase = "failed";
      finPlain =
        recon.differenceCents !== 0
          ? `Post-import reconciliation failed — source and EduClear differ by R${(Math.abs(recon.differenceCents) / 100).toFixed(2)}.`
          : "Post-import reconciliation failed — school accounts do not match.";
      attentionItems.push({
        attentionId: `fin_${recon.reconciliationId}`,
        domainId: "FINANCE",
        severity: "BLOCKING",
        title: "School accounts need attention",
        message:
          recon.differenceCents !== 0
            ? `Source and EduClear differ by R${(Math.abs(recon.differenceCents) / 100).toFixed(2)}.`
            : recon.blockedReasons?.[0] || "Finance Check is not clear.",
        reviewSection: "finance",
      });
    } else {
      finStatus = "VERIFIED";
      reconciliationPhase = "verified";
      finPlain = "Post-import reconciliation verified — school accounts match (R0.00).";
    }
    domains.push({
      domainId: "FINANCE",
      label: "Finance",
      applicable: true,
      status: finStatus,
      plainLanguage: finPlain,
      metrics: {
        accounts: recon?.sourceTotals?.accountCount ?? stage.stagedCounts?.billingAccounts ?? 0,
        differenceCents: recon ? recon.differenceCents : null,
        reconciliationPhase,
        projectedEligiblePayments: projectedEligible,
        projectedBlockedPayments: projectedBlocked,
        projectedUnmatchedPayments: projectedUnmatched,
        projectedHistoricalOnly: projectedHistorical,
      },
      blockingCount: finBlocking,
      warningCount: projectedUnmatched + projectedBlocked > 0 && !recon ? 1 : 0,
    });

    const stmt = getStatementAuthorityCheckByStage(stage.stageId);
    let stmtStatus: DomainStatusSnapshot["status"] = "READY";
    let stmtBlocking = 0;
    let stmtPlain = "Statements will be verified after import (projected only).";
    if (!stmt) {
      stmtStatus = "READY";
      stmtBlocking = 0;
      stmtPlain = recon
        ? "Statements still need verification after finance reconciliation."
        : "Statements will be verified after import (projected only).";
    } else if (stmt.stale) {
      stmtStatus = "STALE";
      staleDomains.push("STATEMENTS");
      stmtBlocking = 1;
      stmtPlain = "Statement check is out of date.";
    } else if (!stmt.statementAuthorityMatch) {
      stmtStatus = "BLOCKED";
      stmtBlocking = 1;
      stmtPlain = "Post-import statement balances do not match.";
      attentionItems.push({
        attentionId: `stmt_${stmt.checkId}`,
        domainId: "STATEMENTS",
        severity: "BLOCKING",
        title: "Statement balances need attention",
        message: "Statement balances do not yet match the migrated school position.",
        reviewSection: "statements",
      });
    } else {
      stmtStatus = "VERIFIED";
      stmtPlain = "Post-import statement balances match.";
    }
    domains.push({
      domainId: "STATEMENTS",
      label: "Statements",
      applicable: true,
      status: stmtStatus,
      plainLanguage: stmtPlain,
      metrics: {
        reconciliationPhase: stmtStatus === "VERIFIED" ? "verified" : stmt ? "failed" : "projected",
      },
      blockingCount: stmtBlocking,
      warningCount: 0,
    });

    const fee = getFeeCheckAuthorityCheckByStage(stage.stageId);
    let feeStatus: DomainStatusSnapshot["status"] = "READY";
    let feeBlocking = 0;
    let feePlain = "Fee Check will be verified after import (projected only).";
    if (!fee) {
      feeStatus = "READY";
      feeBlocking = 0;
      feePlain = stmt?.statementAuthorityMatch
        ? "Fee Check still needs verification after statements."
        : "Fee Check will be verified after import (projected only).";
    } else if (fee.stale) {
      feeStatus = "STALE";
      staleDomains.push("FEE_CHECK");
      feeBlocking = 1;
      feePlain = "Fee Check is out of date.";
    } else if (!fee.feeCheckAuthorityMatch) {
      feeStatus = "BLOCKED";
      feeBlocking = 1;
      feePlain = "Post-import Fee Check does not match.";
      attentionItems.push({
        attentionId: `fee_${fee.checkId}`,
        domainId: "FEE_CHECK",
        severity: "BLOCKING",
        title: "Fee Check needs attention",
        message: "Fee Check does not yet agree with statement balances.",
        reviewSection: "feeCheck",
      });
    } else {
      feeStatus = "VERIFIED";
      feePlain = "Post-import Fee Check verified.";
    }
    domains.push({
      domainId: "FEE_CHECK",
      label: "Fee Check",
      applicable: true,
      status: feeStatus,
      plainLanguage: feePlain,
      metrics: {
        reconciliationPhase: feeStatus === "VERIFIED" ? "verified" : fee ? "failed" : "projected",
      },
      blockingCount: feeBlocking,
      warningCount: 0,
    });
  }

  const acceptance = getAcceptanceByStage(stage.stageId);
  const priorRun = getOrchestratorRunByStage(stage.stageId);
  const sourceManifest = getSourceManifestByStage(stage.stageId);
  const applicableDomains = domains.filter((d) => d.applicable).map((d) => d.domainId);
  const blockingIssueCount = attentionItems.filter((a) => a.severity === "BLOCKING").length;
  const warningCount = attentionItems.filter((a) => a.severity === "WARNING").length;
  const informationCount = attentionItems.filter((a) => a.severity === "INFORMATION").length;

  const needsReview = domains.some((d) => d.applicable && d.status === "NEEDS_REVIEW");
  const anyBlocked = domains.some(
    (d) => d.applicable && (d.status === "BLOCKED" || d.status === "FAILED")
  );
  const anyStale = staleDomains.length > 0;
  const financeApplicable = domains.find((d) => d.domainId === "FINANCE")?.applicable === true;
  const financeVerified =
    domains.find((d) => d.domainId === "FINANCE")?.status === "VERIFIED";
  const stmtVerified =
    domains.find((d) => d.domainId === "STATEMENTS")?.status === "VERIFIED";
  const feeVerified =
    domains.find((d) => d.domainId === "FEE_CHECK")?.status === "VERIFIED";

  const optionalPlansClear =
    (!pfPlan || (pfPlan.criticalUnresolvedCount === 0 && !pfPlan.stale)) &&
    (!acPlan || (acPlan.criticalUnresolvedCount === 0 && !acPlan.stale));

  let overallStatus: OverallMigrationStatus = "READY_TO_MIGRATE";
  let plainLanguageOverall = "Everything required is ready.";

  const terminalAccepted =
    acceptance?.status === "ACCEPTED" ||
    priorRun?.terminalKind === "COMPLETE_ACCEPTED" ||
    priorRun?.status === "COMPLETE_ACCEPTED";
  const terminalSupplied =
    priorRun?.terminalKind === "COMPLETE_SUPPLIED_DATA" ||
    priorRun?.status === "COMPLETE_SUPPLIED_DATA";
  const terminalWarnings =
    priorRun?.terminalKind === "COMPLETE_WITH_WARNINGS" ||
    priorRun?.status === "COMPLETE_WITH_WARNINGS";

  if (terminalAccepted) {
    overallStatus = "COMPLETE_ACCEPTED";
    plainLanguageOverall = "Migration complete. The school is ready to use EduClear.";
  } else if (terminalSupplied) {
    overallStatus = "COMPLETE_SUPPLIED_DATA";
    plainLanguageOverall =
      "Migration complete — finance was not supplied. Learners, parents and academics are ready where provided.";
  } else if (terminalWarnings) {
    overallStatus = "COMPLETE_WITH_WARNINGS";
    plainLanguageOverall =
      "Migration complete with notes. Review the notes below — nothing critical was skipped.";
  } else if (priorRun?.status === "MIGRATING" || priorRun?.status === "VERIFYING") {
    overallStatus = priorRun.status;
    plainLanguageOverall = "Migration is still running. You can refresh — EduClear will not duplicate work.";
  } else if (priorRun?.status === "FAILED") {
    overallStatus = "FAILED";
    plainLanguageOverall =
      "EduClear could not finish the last step. Nothing has been duplicated — you can retry.";
  } else if (needsReview || blockingIssueCount > 0) {
    overallStatus = "NEEDS_ATTENTION";
    plainLanguageOverall = `EduClear found ${blockingIssueCount} item(s) that need a decision.`;
  } else if (anyStale) {
    overallStatus = "NEEDS_ATTENTION";
    plainLanguageOverall =
      "The uploaded information changed. EduClear needs to check some sections again.";
  } else if (anyBlocked && !coreApplied) {
    overallStatus = "BLOCKED";
    plainLanguageOverall = "Migration cannot safely continue yet.";
  }

  const isTerminal =
    overallStatus === "COMPLETE_ACCEPTED" ||
    overallStatus === "COMPLETE_SUPPLIED_DATA" ||
    overallStatus === "COMPLETE_WITH_WARNINGS";

  // readyToComplete: can run Complete Migration (apply + verify applicable domains)
  const readyToComplete =
    isTerminal || overallStatus === "MIGRATING" || overallStatus === "VERIFYING"
      ? false
      : optionalPlansClear &&
        blockingIssueCount === 0 &&
        !anyStale &&
        coreReady &&
        !needsReview;

  // Accept only when finance path is applicable and verified (existing gates)
  const readyToAccept =
    Boolean(acceptance?.status !== "ACCEPTED") &&
    financeApplicable &&
    financeVerified &&
    stmtVerified &&
    feeVerified &&
    optionalPlansClear &&
    blockingIssueCount === 0;

  if (
    readyToComplete &&
    !isTerminal &&
    overallStatus !== "NEEDS_ATTENTION" &&
    overallStatus !== "BLOCKED" &&
    overallStatus !== "FAILED" &&
    overallStatus !== "MIGRATING" &&
    overallStatus !== "VERIFYING"
  ) {
    overallStatus = "READY_TO_MIGRATE";
    plainLanguageOverall = financeApplicable
      ? "Ready to import. Finance looks staged (projected) — actual R0.00 match is confirmed only after import."
      : "Ready to migrate supplied school information (no finance export detected).";
  }

  const reviewDecisions =
    (pfPlan?.criticalUnresolvedCount || 0) + (acPlan?.criticalUnresolvedCount || 0);

  const readiness: UniversalMigrationReadiness = {
    readinessId: `umr_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    version: UNIVERSAL_ORCHESTRATOR_VERSION,
    generatedAt: new Date().toISOString(),
    targetSchoolId: stage.targetSchoolId,
    stageId: stage.stageId,
    overallStatus,
    plainLanguageOverall,
    applicableDomains,
    domains,
    attentionItems,
    blockingIssueCount,
    warningCount,
    informationCount,
    staleDomains,
    failedDomains,
    readyToComplete: readyToComplete && !isTerminal,
    readyToAccept,
    sourceFingerprint:
      sourceManifest?.sourceSetFingerprint ||
      stage.sourceFingerprints?.map((f) => f.headerFingerprint).join("|") ||
      null,
    summaryLines: domains.map((d) => `${d.label}: ${d.plainLanguage}`),
    operatorEffort: {
      manualMappingActionsRequired: 0,
      operatorReviewDecisionsRequired: reviewDecisions,
      primaryActionsAfterAnalysis: readyToComplete ? 1 : reviewDecisions > 0 ? 1 : 0,
    },
  };

  // silence unused
  void getBoundFinanceReconciliation;
  return saveOrchestratorReadiness(readiness);
}
