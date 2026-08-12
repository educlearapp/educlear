/**
 * Compile MigrationSourceAnalysis → zero-write CompiledMigrationPlan.
 */

import { randomUUID } from "crypto";
import type { MigrationSourceAnalysis } from "../sourceAnalysis/MigrationSourceAnalysis";
import { compileMappingsFromAnalysis } from "./compileMappingsFromAnalysis";
import {
  COMPILED_MIGRATION_PLAN_VERSION,
  type CompileMigrationPlanInput,
  type CompiledMigrationPlan,
  type PlannedFinanceItem,
  type PlannedJoin,
} from "./CompiledMigrationPlan";

function entityRows(
  analysis: MigrationSourceAnalysis,
  entity: string
): number {
  return (
    analysis.entityGroups.find((g) => g.entity === entity)?.estimatedRows ?? 0
  );
}

function hasMappedTarget(
  entries: ReturnType<typeof compileMappingsFromAnalysis>["entries"],
  target: string
): boolean {
  return entries.some((e) => e.target === target && e.fieldTrace === "planned");
}

export function compileMigrationPlan(
  input: CompileMigrationPlanInput
): CompiledMigrationPlan {
  const analysis = input.analysis;
  const { mappings, entries } = compileMappingsFromAnalysis(analysis);
  const existing = input.existing;

  const learnerRows = entityRows(analysis, "learners");
  const parentRows = entityRows(analysis, "parents");
  const classroomEstimate = entityRows(analysis, "classrooms");
  const familyEstimate = entityRows(analysis, "family_accounts");
  const employeeRows = entityRows(analysis, "employees");

  // Reuse/skip estimates from optional existing snapshot (zero-write)
  const learnersAlreadyPresent = existing?.learnerKeys
    ? Math.min(learnerRows, existing.learnerKeys.size)
    : 0;
  const learnersToCreate = Math.max(0, learnerRows - learnersAlreadyPresent);

  const classroomsToReuse = existing?.classroomNames
    ? Math.min(classroomEstimate, existing.classroomNames.size)
    : 0;
  const classroomsToCreate = Math.max(0, classroomEstimate - classroomsToReuse);

  const accountsToReuse = existing?.accountRefs
    ? Math.min(familyEstimate, existing.accountRefs.size)
    : 0;
  const accountsToCreate = Math.max(0, familyEstimate - accountsToReuse);

  const employeeSkip = existing?.employeeKeys
    ? Math.min(employeeRows, existing.employeeKeys.size)
    : 0;
  const employeesToCreate = Math.max(0, employeeRows - employeeSkip);

  const joins: PlannedJoin[] = analysis.relationshipCandidates.map((r, idx) => {
    const autoLink = r.confidence === "HIGH";
    return {
      joinId: `join_${idx + 1}`,
      keyKind: r.keyKind,
      leftFileId: r.leftFileId,
      rightFileId: r.rightFileId,
      leftColumn: r.leftColumn,
      rightColumn: r.rightColumn,
      confidence: r.confidence,
      autoLink,
      requiresConfirmation: !autoLink,
      reason: r.reason,
    };
  });

  const finance: PlannedFinanceItem[] = [];
  let finSeq = 0;
  for (const field of analysis.discoveredFields) {
    const confirmed = analysis.confirmedMappings[field.fieldKey];
    const t = confirmed?.target || field.confirmedTarget || field.suggestedTarget;
    const hay = String(field.sourceColumn || "").toLowerCase();
    const looksLikeOpening =
      t === "openingBalance" || /opening.?balance|brought.?forward|bfwd/.test(hay);

    // Opening balances post via ledger opening adjustment (invoice/credit), never as payments.
    if (looksLikeOpening) {
      finSeq += 1;
      finance.push({
        itemId: `fin_${finSeq}`,
        kind: "opening_balance",
        applicability: "APPLICABLE_SAFE_PATH",
        fileId: field.fileId,
        sourceColumn: field.sourceColumn,
        countEstimate: analysis.files.find((f) => f.fileId === field.fileId)?.rowCount || 0,
        reason:
          "Opening balances post as ledger opening adjustments (invoice for debit, credit for credit balance) — never as ordinary payments.",
      });
      continue;
    }

    if (field.financeRequiresConfirmation && !confirmed) {
      finSeq += 1;
      finance.push({
        itemId: `fin_${finSeq}`,
        kind: "ambiguous",
        applicability: "REQUIRES_CONFIRMATION",
        fileId: field.fileId,
        sourceColumn: field.sourceColumn,
        countEstimate: 1,
        reason: "Ambiguous finance column — confirm before any posting.",
      });
      continue;
    }

    if (t === "accountNumber") {
      finSeq += 1;
      finance.push({
        itemId: `fin_${finSeq}`,
        kind: "family_account",
        applicability: "APPLICABLE_SAFE_PATH",
        fileId: field.fileId,
        sourceColumn: field.sourceColumn,
        countEstimate:
          familyEstimate ||
          analysis.files.find((f) => f.fileId === field.fileId)?.rowCount ||
          0,
        reason: "Family account numbers can follow the existing billing apply path when staged.",
      });
    } else if (
      t === "transactionDate" ||
      t === "amount" ||
      t === "debit" ||
      t === "credit" ||
      /payment|transaction/.test(hay)
    ) {
      finSeq += 1;
      finance.push({
        itemId: `fin_${finSeq}`,
        kind: /payment/.test(hay) ? "payment" : "transaction",
        applicability: "APPLICABLE_SAFE_PATH",
        fileId: field.fileId,
        sourceColumn: field.sourceColumn,
        countEstimate: analysis.files.find((f) => f.fileId === field.fileId)?.rowCount || 0,
        reason:
          "Transactions/payments require cutover + readiness gates; never posted during analysis/plan compile.",
      });
    } else if (t === "billingPlan" || t === "feeAmount") {
      finSeq += 1;
      finance.push({
        itemId: `fin_${finSeq}`,
        kind: "billing_plan",
        applicability: "APPLICABLE_SAFE_PATH",
        fileId: field.fileId,
        sourceColumn: field.sourceColumn,
        countEstimate: analysis.files.find((f) => f.fileId === field.fileId)?.rowCount || 0,
        reason:
          "Billing plans upsert learner fee lines via the existing billing-plan store (idempotent per learner).",
      });
    }
  }

  const unsupportedFields = entries
    .filter((e) => e.fieldTrace === "unsupported" || e.status === "UNSUPPORTED")
    .map((e) => {
      const f = analysis.discoveredFields.find(
        (d) => d.fileId === e.fileId && d.sourceColumn === e.sourceColumn
      );
      return {
        fieldKey: f?.fieldKey || `${e.fileId}::${e.sourceColumn}`,
        sourceColumn: e.sourceColumn,
        filename: f?.filename || "",
        reason: e.reason,
      };
    });

  const unresolvedMappings = entries
    .filter((e) => e.fieldTrace === "unresolved")
    .map((e) => {
      const f = analysis.discoveredFields.find(
        (d) => d.fileId === e.fileId && d.sourceColumn === e.sourceColumn
      );
      return {
        fieldKey: f?.fieldKey || `${e.fileId}::${e.sourceColumn}`,
        sourceColumn: e.sourceColumn,
        filename: f?.filename || "",
        reason: e.reason,
      };
    });

  const learnerExtended = [
    "firstName",
    "lastName",
    "fullName",
    "nickname",
    "idNumber",
    "dateOfBirth",
    "gender",
    "learnerNumber",
    "grade",
    "classroom",
    "homeLanguage",
    "citizenship",
    "status",
    "notes",
  ].filter((t) => hasMappedTarget(entries, t));

  const parentExtended = [
    "parentName",
    "parentFirstName",
    "parentSurname",
    "parentIdNumber",
    "parentPhone",
    "parentWorkPhone",
    "parentEmail",
    "relationship",
    "address",
    "employer",
    "parentNotes",
  ].filter((t) => hasMappedTarget(entries, t));

  // Parent review needed when parent entity present — identity preflight still authoritative
  const parentsNeedReview =
    parentRows > 0
      ? Math.max(0, Math.floor(parentRows * 0.15)) // placeholder upper bound; real review from 1D preflight
      : 0;
  const parentsToReuse = Math.max(0, Math.floor(parentRows * 0.2));
  const parentsToCreate = Math.max(0, parentRows - parentsToReuse - parentsNeedReview);
  const parentLinks =
    joins.filter(
      (j) =>
        j.autoLink &&
        (j.keyKind === "learner_number" ||
          j.keyKind === "admission_number" ||
          j.keyKind === "learner_sa_id" ||
          j.keyKind === "parent_sa_id")
    ).length > 0
      ? parentRows
      : parentRows > 0 && learnerRows > 0
        ? Math.min(parentRows, learnerRows)
        : 0;

  const joinsNeedsConfirmation = joins.filter((j) => j.requiresConfirmation).length;
  const joinsAuto = joins.filter((j) => j.autoLink).length;
  const financePlannedNotApplicable = finance.filter(
    (f) => f.applicability === "PLANNED_NOT_APPLICABLE"
  ).length;
  const financeNeedsConfirm = finance.filter(
    (f) => f.applicability === "REQUIRES_CONFIRMATION"
  ).length;

  const blockedReasons: string[] = [];
  if (financeNeedsConfirm > 0) {
    blockedReasons.push(
      "Some finance columns still need confirmation — they will not post until confirmed (non-finance staging may continue)."
    );
  }
  // Unresolved non-finance CONFIRM fields: warn but allow stage if core learner/parent mapped
  const itemsNeedingAttention =
    unresolvedMappings.length +
    joinsNeedsConfirmation +
    parentsNeedReview +
    financeNeedsConfirm;

  const canProceedToStage =
    learnerExtended.length > 0 ||
    parentExtended.length > 0 ||
    employeesToCreate > 0 ||
    accountsToCreate > 0;

  if (!canProceedToStage) {
    blockedReasons.push("No compilable EduClear mappings yet — confirm Package Analysis fields.");
  }

  const now = new Date().toISOString();
  const planId = `plan_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  return {
    planId,
    planVersion: COMPILED_MIGRATION_PLAN_VERSION,
    createdAt: now,
    updatedAt: now,
    sourceAnalysisId: analysis.analysisId,
    analysisVersion: analysis.analysisVersion,
    targetSchoolId: analysis.targetSchoolId,
    targetSchoolName: analysis.targetSchoolName,
    stageId: analysis.stageId,
    migrationRunId: analysis.migrationRunId || analysis.stageId || planId,
    sourceFingerprints: analysis.files.map((f) => ({
      fileId: f.fileId,
      filename: f.filename,
      headerFingerprint: f.headerFingerprint,
    })),
    compiledMappings: mappings,
    mappingEntries: entries,
    learners: {
      action: learnersToCreate > 0 ? "CREATE" : "SKIP",
      count: learnersToCreate,
      extendedFieldsIncluded: learnerExtended,
    },
    parents: {
      toCreate: parentsToCreate,
      toReuse: parentsToReuse,
      needsReview: parentsNeedReview,
      linksPlanned: parentLinks,
      extendedFieldsIncluded: parentExtended,
    },
    classrooms: {
      toCreate: classroomsToCreate,
      toReuse: classroomsToReuse,
    },
    familyAccounts: {
      toCreate: accountsToCreate,
      toReuse: accountsToReuse,
    },
    employees: {
      toCreate: employeesToCreate,
      toSkip: employeeSkip,
    },
    joins,
    finance,
    unsupportedFields,
    unresolvedMappings,
    summary: {
      learnersToCreate,
      learnersAlreadyPresent,
      parentsToCreate,
      parentsToReuse,
      parentLinks,
      classrooms: classroomsToCreate + classroomsToReuse,
      familyAccounts: accountsToCreate + accountsToReuse,
      employees: employeesToCreate,
      fieldsUnsupported: unsupportedFields.length,
      fieldsUnresolved: unresolvedMappings.length,
      itemsNeedingAttention,
      financePlannedNotApplicable,
      joinsAuto,
      joinsNeedsConfirmation,
    },
    blockedReasons,
    canProceedToStage,
  };
}

/** Reject plan when analysis fingerprints no longer match current analysis files. */
export function assertPlanFingerprintsFresh(
  plan: CompiledMigrationPlan,
  analysis: MigrationSourceAnalysis
): void {
  if (plan.sourceAnalysisId !== analysis.analysisId) {
    throw new Error(
      "MIGRATION_PLAN_STALE: Plan sourceAnalysisId does not match current analysis."
    );
  }
  if (plan.targetSchoolId !== analysis.targetSchoolId) {
    throw new Error(
      "MIGRATION_SCHOOL_MISMATCH: Plan is locked to a different school than the analysis."
    );
  }
  const byId = new Map(analysis.files.map((f) => [f.fileId, f.headerFingerprint]));
  for (const fp of plan.sourceFingerprints) {
    const current = byId.get(fp.fileId);
    if (!current || current !== fp.headerFingerprint) {
      throw new Error(
        "MIGRATION_PLAN_STALE: Source file headers changed — re-analyse and recompile before apply."
      );
    }
  }
}

export function assertPlanSchool(
  plan: CompiledMigrationPlan,
  targetSchoolId: string
): void {
  if (String(plan.targetSchoolId || "").trim() !== String(targetSchoolId || "").trim()) {
    throw new Error(
      "MIGRATION_SCHOOL_MISMATCH: Compiled plan is locked to another school. No writes occurred."
    );
  }
}
