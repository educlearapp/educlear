import { prisma } from "../../../prisma";
import { normalizeClassroomInput } from "../../../utils/classroomNormalization";
import { resolveGenderFromSources } from "../../../utils/learnerGender";
import {
  createMigrationImportBatch,
  updateImportBatch,
} from "./migrationImportBatchStore";
import { getStage } from "../staging/migrationStageStore";
import type {
  MigrationApplyCounts,
  MigrationApplyRequest,
  MigrationApplyResult,
  MigrationImportEntityType,
  MigrationImportReportRow,
  MigrationTransactionOutcomeCounts,
} from "../types/MigrationApply";
import {
  buildApplyLearnerMatchIndex,
  postSingleMigrationLedgerTransaction,
} from "./postMigrationLedgerTransactions";
import { linkMigrationLearnersToFamilyAccounts } from "./linkMigrationLearnersToFamilyAccounts";
import type { MigrationStage } from "../types/MigrationStage";
import {
  BILLING_TARGET_FIELDS,
  LEARNER_TARGET_FIELDS,
  PARENT_TARGET_FIELDS,
  TRANSACTION_TARGET_FIELDS,
  type MigrationTargetField,
} from "../types/MigrationTargetField";
import type { MigrationFileColumnMappings } from "../types/MigrationValidation";
import { migrationTargetCategory } from "../staging/buildMigrationStage";
import { parseEmployeesFile } from "../adapters/kideesys/parseEmployeesFile";
import {
  assertLearnerCreateGuard,
  computeMigrationApplyPreview,
} from "./computeMigrationApplyPreview";
import {
  resolveBoundTargetSchoolId,
  MigrationSchoolBindingError,
} from "./migrationSchoolBinding";
import { parseStagedMigrationSource, resolveSafeMigrationFilePath } from "./parseStagedMigrationFile";
import { applyParentIdentityPlan } from "../parentIdentity";
import {
  enrichParentMappedFromContactList,
  runUniversalMigrationParentPreflight,
  type UniversalParentRowContext,
} from "./universalMigrationParentIdentity";
import {
  assertPlanFingerprintsFresh,
  assertPlanSchool,
  getBoundCompiledPlan,
} from "../migrationPlan";
import { getBoundSourceAnalysis } from "../sourceAnalysis/migrationSourceAnalysisStore";
import { postOpeningBalancesForMappedRows } from "../finance/postMigrationOpeningBalances";
import { applyMigrationBillingPlansFromMappedRows } from "../finance/applyMigrationBillingPlansFromStage";
import { removeSchoolEntriesByIds } from "../../../utils/billingLedgerStore";
import { classifyFinanceSourceRow } from "../finance/classifyFinanceSourceRow";
import {
  allocateMigrationAdmissionNo,
  classifyMigrationLearnerIdentity,
  migrationLearnerBatchKey,
  type MigrationLearnerIdentityCandidate,
} from "./migrationLearnerIdentity";
import { openingBalanceRowsToPost } from "./migrationOpeningBalanceSafety";
import {
  saveMigrationIntegrity,
  type MigrationIntegrityFinding,
} from "./migrationIntegrityStore";
import { shouldAutoPostExpressInvoiceTransactions } from "./expressInvoiceAuthority";

const MIGRATION_APPLY_TX_OPTIONS = { maxWait: 30000, timeout: 180000 };

const LEARNER_FIELDS = new Set<string>(LEARNER_TARGET_FIELDS);
const PARENT_FIELDS = new Set<string>(PARENT_TARGET_FIELDS);
const BILLING_FIELDS = new Set<string>(BILLING_TARGET_FIELDS);
const TRANSACTION_FIELDS = new Set<string>(TRANSACTION_TARGET_FIELDS);

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

type MappedRow = Record<MigrationTargetField, string>;

type FileApplyPlan = {
  fileId: string;
  filename: string;
  path: string;
  category: string;
  worksheetName?: string;
  sheetRole?: string;
  mappings: MigrationFileColumnMappings["mappings"];
  entityKinds: Set<"learner" | "parent" | "billing" | "transaction">;
  /** Kid-e-Sys employee_contact_list.xls — parsed without column mappings. */
  kidESysStaffImport?: boolean;
};

function emptyCounts(): MigrationApplyCounts {
  return {
    learners: 0,
    parents: 0,
    employees: 0,
    billingAccounts: 0,
    transactions: 0,
    classrooms: 0,
    parentLearnerLinks: 0,
  };
}

function cleanString(v: unknown): string {
  return String(v ?? "").trim();
}

function isMigrationClassroomPlaceholder(value: string | null | undefined): boolean {
  return cleanString(value).toLowerCase() === "no classroom";
}

function buildTargetToSource(
  mappings: MigrationFileColumnMappings["mappings"]
): Map<MigrationTargetField, string> {
  const map = new Map<MigrationTargetField, string>();
  for (const m of mappings) {
    const target = String(m.targetField || "").trim() as MigrationTargetField;
    const source = String(m.sourceColumn || "").trim();
    if (target && source) map.set(target, source);
  }
  return map;
}

function mapRawRecord(
  raw: Record<string, string>,
  targetToSource: Map<MigrationTargetField, string>
): MappedRow {
  const out = {} as MappedRow;
  for (const [target, sourceCol] of targetToSource) {
    const value = cleanString(raw[sourceCol]);
    if (value) out[target] = value;
  }
  return out;
}

function splitPersonName(fullOrSingle: string): { firstName: string; lastName: string } {
  const trimmed = cleanString(fullOrSingle);
  if (!trimmed) return { firstName: "", lastName: "" };
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function learnerNamesFromMapped(mapped: MappedRow): { firstName: string; lastName: string } {
  const first = cleanString(mapped.firstName);
  const last = cleanString(mapped.lastName);
  if (first || last) return { firstName: first, lastName: last };
  return splitPersonName(cleanString(mapped.fullName));
}

function fileEntityKinds(
  mappings: MigrationFileColumnMappings["mappings"]
): Set<"learner" | "parent" | "billing" | "transaction"> {
  const kinds = new Set<"learner" | "parent" | "billing" | "transaction">();
  for (const m of mappings) {
    const cat = migrationTargetCategory(String(m.targetField || "") as MigrationTargetField);
    if (cat === "learner" || cat === "parent" || cat === "billing" || cat === "transaction") {
      kinds.add(cat);
    }
  }
  return kinds;
}

function hasTargetsInSet(
  mappings: MigrationFileColumnMappings["mappings"],
  allowed: Set<string>
): boolean {
  for (const m of mappings) {
    if (allowed.has(String(m.targetField || "").trim())) return true;
  }
  return false;
}

function buildFilePlans(stage: MigrationStage): FileApplyPlan[] {
  const byFileId = new Map(stage.mappings.map((m) => [m.fileId, m]));
  const plans: FileApplyPlan[] = [];

  for (const file of stage.files) {
    const pathValue = cleanString(file.path);
    if (!pathValue) {
      throw new Error(
        `Dry run "${stage.stageId}" is missing on-disk file path for "${file.filename}". Re-create the dry run from Upload Area while source files are still on the server.`
      );
    }

    const sheetRole = String(file.sheetRole || "DATA").toUpperCase();
    if (sheetRole === "SUMMARY" || sheetRole === "SUPPORTING") {
      continue;
    }

    const category = String(file.category || "").trim();
    const resolvedPath = resolveSafeMigrationFilePath(pathValue);

    if (category === "staff") {
      plans.push({
        fileId: file.fileId,
        filename: file.filename,
        path: resolvedPath,
        category,
        worksheetName: file.worksheetName,
        sheetRole: file.sheetRole,
        mappings: byFileId.get(file.fileId)?.mappings ?? [],
        entityKinds: new Set(),
        kidESysStaffImport: true,
      });
      continue;
    }

    const fileMappings = byFileId.get(file.fileId);
    if (!fileMappings?.mappings?.length) continue;

    const kinds = fileEntityKinds(fileMappings.mappings);
    if (kinds.size === 0) continue;

    plans.push({
      fileId: file.fileId,
      filename: file.filename,
      path: resolvedPath,
      category,
      worksheetName: file.worksheetName,
      sheetRole: file.sheetRole,
      mappings: fileMappings.mappings,
      entityKinds: kinds,
    });
  }

  if (plans.length === 0) {
    throw new Error("No import files with valid paths found on this dry run stage");
  }

  return plans;
}

function employeeDuplicateKey(emp: {
  fullName: string;
  firstName: string;
  lastName: string;
}): string {
  const full = cleanString(emp.fullName).toLowerCase();
  if (full) return `name:${full}`;
  return `name:${cleanString(emp.firstName).toLowerCase()}|${cleanString(emp.lastName).toLowerCase()}`;
}

function pushReport(
  report: MigrationImportReportRow[],
  row: MigrationImportReportRow
): void {
  report.push(row);
}

function bumpCount(
  bucket: MigrationApplyCounts,
  entity: MigrationImportEntityType
): void {
  switch (entity) {
    case "learner":
      bucket.learners += 1;
      break;
    case "parent":
      bucket.parents += 1;
      break;
    case "employee":
      bucket.employees += 1;
      break;
    case "billingAccount":
      bucket.billingAccounts += 1;
      break;
    case "transaction":
      bucket.transactions += 1;
      break;
    case "classroom":
      bucket.classrooms += 1;
      break;
    case "parentLearnerLink":
      bucket.parentLearnerLinks += 1;
      break;
    default:
      break;
  }
}

function learnerDuplicateKey(mapped: MappedRow, schoolId: string): string {
  const names = learnerNamesFromMapped(mapped);
  return (
    migrationLearnerBatchKey({
      schoolId,
      firstName: names.firstName,
      lastName: names.lastName,
      idNumber: mapped.idNumber,
      dateOfBirth: mapped.dateOfBirth,
      sourceLearnerId: mapped.learnerNumber,
    }) ||
    `weak:${names.firstName.toLowerCase()}|${names.lastName.toLowerCase()}`
  );
}

function billingDuplicateKey(mapped: MappedRow): string {
  const account = cleanString(mapped.accountNumber);
  return account ? `acct:${account.toLowerCase()}` : "";
}

function emptyTransactionOutcomes(): MigrationTransactionOutcomeCounts {
  return {
    posted: 0,
    historicalNotApplied: 0,
    blocked: 0,
    unmatched: 0,
    duplicateSkipped: 0,
  };
}

/** Map source status strings to Prisma LearnerEnrollmentStatus (schema-backed only). */
function enrollmentStatusFromMapped(raw: string | undefined): "ACTIVE" | "HISTORICAL" | null {
  const v = cleanString(raw).toLowerCase();
  if (!v) return null;
  if (
    v === "active" ||
    v === "enrolled" ||
    v === "current" ||
    v === "a"
  ) {
    return "ACTIVE";
  }
  if (
    v === "historical" ||
    v === "inactive" ||
    v === "left" ||
    v === "alumni" ||
    v === "withdrawn" ||
    v === "exited"
  ) {
    return "HISTORICAL";
  }
  return null;
}

/**
 * Phase 1F — when stage is bound to a compiled plan, reject stale fingerprints / wrong school
 * before any writes.
 */
function assertStageCompiledPlanFresh(stage: MigrationStage, targetSchoolId: string): void {
  const planId = cleanString(stage.compiledPlanId);
  const analysisId = cleanString(stage.sourceAnalysisId);
  if (!planId && !analysisId) return;

  if (planId) {
    const plan = getBoundCompiledPlan(planId, {
      targetSchoolId,
      sourceAnalysisId: analysisId || undefined,
    });
    if (!plan) {
      throw new MigrationApplyError(
        "MIGRATION_SCHOOL_MISMATCH: Compiled plan is not bound to this school. No writes occurred.",
        { success: false, error: "MIGRATION_SCHOOL_MISMATCH" }
      );
    }
    try {
      assertPlanSchool(plan, targetSchoolId);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "MIGRATION_SCHOOL_MISMATCH";
      throw new MigrationApplyError(message, { success: false, error: message });
    }
    if (analysisId) {
      const analysis = getBoundSourceAnalysis(analysisId, { targetSchoolId });
      if (!analysis) {
        throw new MigrationApplyError(
          "MIGRATION_PLAN_STALE: Source Analysis missing for compiled plan. Re-analyse before apply.",
          { success: false, error: "MIGRATION_PLAN_STALE" }
        );
      }
      try {
        assertPlanFingerprintsFresh(plan, analysis);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "MIGRATION_PLAN_STALE";
        throw new MigrationApplyError(message, { success: false, error: message });
      }
    } else if (Array.isArray(stage.sourceFingerprints) && stage.sourceFingerprints.length) {
      // Compare stage-captured fingerprints to plan
      const byId = new Map(plan.sourceFingerprints.map((f) => [f.fileId, f.headerFingerprint]));
      for (const fp of stage.sourceFingerprints) {
        const expected = byId.get(fp.fileId);
        if (!expected || expected !== fp.headerFingerprint) {
          throw new MigrationApplyError(
            "MIGRATION_PLAN_STALE: Stage fingerprints do not match compiled plan — re-stage before apply.",
            { success: false, error: "MIGRATION_PLAN_STALE" }
          );
        }
      }
    }
  }
}

function stageHasTransactionFiles(stage: MigrationStage): boolean {
  return stage.stagedCounts.transactions > 0;
}

function validateTransactionApplyGate(
  stage: MigrationStage,
  proceedWithEligibleActiveOnly: boolean
): void {
  if (!stageHasTransactionFiles(stage)) return;

  if (!cleanString(stage.cutoverDate)) {
    throw new MigrationApplyError(
      "Cutover date is required before applying transaction files. Set cutover date on the dry run and re-stage."
    );
  }

  const readiness = stage.transactionReadiness;
  const blocked = readiness?.blockedTransactions ?? 0;
  const unmatched = readiness?.unmatchedTransactions ?? 0;

  if ((blocked > 0 || unmatched > 0) && !proceedWithEligibleActiveOnly) {
    throw new MigrationApplyError(
      `Transaction apply blocked: ${blocked} blocked and ${unmatched} unmatched transaction(s) in dry run. ` +
        "Tick “Proceed with eligible active transactions only” in the readiness checklist, or fix mappings before apply."
    );
  }
}

export class MigrationApplyError extends Error {
  constructor(
    message: string,
    public readonly result?: Partial<MigrationApplyResult>
  ) {
    super(message);
    this.name = "MigrationApplyError";
  }
}

export async function applyMigrationStage(
  input: MigrationApplyRequest
): Promise<MigrationApplyResult> {
  const stageId = cleanString(input.stageId);
  const confirmationText = cleanString(input.confirmationText);
  const isFullPreflight =
    input.mode === "FULL_MIGRATION_PREFLIGHT" || Boolean(input.fullMigrationPreflight);

  if (!stageId) throw new MigrationApplyError("stageId is required");
  if (!confirmationText) throw new MigrationApplyError("confirmationText is required");

  const stage = getStage(stageId);
  if (!stage) throw new MigrationApplyError("Dry run stage not found");

  let targetSchoolId: string;
  try {
    targetSchoolId = resolveBoundTargetSchoolId({
      stage,
      requestedTargetSchoolId: input.targetSchoolId,
    });
  } catch (e: unknown) {
    if (e instanceof MigrationSchoolBindingError) {
      throw new MigrationApplyError(e.message, {
        success: false,
        error: e.message,
        migrationStatus: undefined,
      });
    }
    throw e;
  }

  if (!stage.canApply) {
    throw new MigrationApplyError("Dry run cannot be applied (canApply is false)");
  }

  if (stage.validationSummary.errors > 0) {
    throw new MigrationApplyError(
      `Dry run has ${stage.validationSummary.errors} validation error(s) — fix before applying`
    );
  }

  if (!stage.validationSummary.canProceed) {
    throw new MigrationApplyError("Dry run validation did not pass (canProceed is false)");
  }

  if (stage.validationSummary.mode !== "full") {
    throw new MigrationApplyError(
      "Dry run was not validated against full uploaded files — re-stage after full-file validation"
    );
  }

  const school = await prisma.school.findUnique({
    where: { id: targetSchoolId },
    select: { id: true, name: true },
  });
  if (!school) {
    throw new MigrationApplyError(
      `Target school not found for bound migration (${targetSchoolId}). Re-stage against an existing school.`
    );
  }

  assertStageCompiledPlanFresh(stage, targetSchoolId);

  // Bound name snapshot may drift; confirmation must match live school name.
  const expectedPhrase = cleanString(school.name);
  if (
    confirmationText.trim().toLowerCase() !== expectedPhrase.trim().toLowerCase()
  ) {
    throw new MigrationApplyError(
      `Confirmation phrase must match the target school name exactly (${expectedPhrase})`
    );
  }

  const filePlans = buildFilePlans(stage);
  const proceedWithEligibleActiveOnly = Boolean(input.proceedWithEligibleActiveOnly);
  if (!isFullPreflight) {
    validateTransactionApplyGate(stage, proceedWithEligibleActiveOnly);
  }

  const applyExpectations = await computeMigrationApplyPreview(stage, targetSchoolId);
  try {
    assertLearnerCreateGuard(applyExpectations);
  } catch (guardError: unknown) {
    const message =
      guardError instanceof Error ? guardError.message : "Learner create guard failed";
    throw new MigrationApplyError(message, { applyExpectations });
  }

  type ParsedFile = {
    plan: FileApplyPlan;
    rows: Record<string, string>[];
    targetToSource: Map<MigrationTargetField, string>;
  };

  const parsedFiles: ParsedFile[] = [];
  for (const plan of filePlans) {
    if (plan.kidESysStaffImport) continue;
    const rows = await parseStagedMigrationSource(
      { path: plan.path, filename: plan.filename, worksheetName: plan.worksheetName },
      stage.sourceSystem
    );
    parsedFiles.push({
      plan,
      rows,
      targetToSource: buildTargetToSource(plan.mappings),
    });
  }

  // --- Parent identity preflight (ZERO writes) before any school mutation ---
  const deferParents = Boolean(input.deferParentsToParentFamilyPlan);
  const parentRowContexts: UniversalParentRowContext[] = [];
  if (!deferParents) {
    for (const { plan, rows, targetToSource } of parsedFiles) {
      const applyParents =
        plan.category === "parents" &&
        plan.entityKinds.has("parent") &&
        hasTargetsInSet(plan.mappings, PARENT_FIELDS);
      if (!applyParents) continue;
      for (let i = 0; i < rows.length; i++) {
        let mapped = mapRawRecord(rows[i]!, targetToSource);
        mapped = enrichParentMappedFromContactList(mapped, rows[i]!);
        parentRowContexts.push({
          fileId: plan.fileId,
          filename: plan.filename,
          rowNumber: i + 1,
          mapped,
          raw: rows[i]!,
        });
      }
    }
  }

  let parentIdentityPreflight: MigrationApplyResult["parentIdentityPreflight"];
  let parentIdentityReview: MigrationApplyResult["parentIdentityReview"];
  let parentPreflightClear = true;

  if (parentRowContexts.length > 0) {
    const preflight = await runUniversalMigrationParentPreflight({
      prisma,
      schoolId: targetSchoolId,
      sourceSystem: stage.sourceSystem,
      parentRows: parentRowContexts,
      resolutions: input.parentIdentityResolutions,
    });
    parentIdentityPreflight = preflight.report;
    parentIdentityReview = preflight.reviewContract;
    parentPreflightClear = preflight.clear;
  }

  const emptyResultBase = (): MigrationApplyResult => ({
    batchId: "",
    stageId: stage.stageId,
    targetSchoolId: school.id,
    targetSchoolName: school.name,
    appliedAt: new Date().toISOString(),
    success: false,
    createdCounts: emptyCounts(),
    skippedCounts: emptyCounts(),
    failedCounts: emptyCounts(),
    transactionOutcomes: emptyTransactionOutcomes(),
    report: [],
    applyExpectations,
    parentIdentityPreflight,
    parentIdentityReview,
  });

  // TRUE zero-write full migration preflight
  if (isFullPreflight) {
    return {
      ...emptyResultBase(),
      success: true,
      migrationStatus: "FULL_MIGRATION_PREFLIGHT",
      error: parentPreflightClear
        ? undefined
        : parentIdentityReview?.message || "MIGRATION REQUIRES REVIEW",
    };
  }

  // Unresolved parent identity → ZERO school writes (no half-migrated school)
  if (parentRowContexts.length > 0 && !parentPreflightClear) {
    const blocked: MigrationApplyResult = {
      ...emptyResultBase(),
      success: false,
      migrationStatus: "MIGRATION_REQUIRES_REVIEW",
      error:
        parentIdentityReview?.message ||
        "MIGRATION REQUIRES REVIEW — resolve parent identity before apply",
    };
    throw new MigrationApplyError(
      blocked.error || "MIGRATION_REQUIRES_REVIEW",
      blocked
    );
  }

  const batch = createMigrationImportBatch({
    stageId: stage.stageId,
    targetSchoolId: school.id,
    targetSchoolName: school.name,
    sourceSystem: stage.sourceSystem,
    status: "applying",
    stagedCounts: stage.stagedCounts,
  });

  const createdCounts = emptyCounts();
  const skippedCounts = emptyCounts();
  const failedCounts = emptyCounts();
  const transactionOutcomes = emptyTransactionOutcomes();
  const report: MigrationImportReportRow[] = [];
  /** Ledger entry ids written during this apply — compensated if Prisma TX fails afterward. */
  const postedLedgerEntryIds: string[] = [];

  const baseResult = (): MigrationApplyResult => ({
    batchId: batch.batchId,
    stageId: stage.stageId,
    targetSchoolId: school.id,
    targetSchoolName: school.name,
    appliedAt: new Date().toISOString(),
    success: false,
    createdCounts: { ...createdCounts },
    skippedCounts: { ...skippedCounts },
    failedCounts: { ...failedCounts },
    transactionOutcomes: { ...transactionOutcomes },
    report: [...report],
    applyExpectations,
    parentIdentityPreflight,
    parentIdentityReview,
  });

  try {
    const seenLearners = new Set<string>();
    const seenBilling = new Set<string>();
    const seenEmployees = new Set<string>();
    const seenClassrooms = new Set<string>();
    const seenLedgerDuplicateKeys = new Set<string>();

    const rowsByFileId = new Map<string, Record<string, unknown>[]>();
    for (const { plan, rows } of parsedFiles) {
      rowsByFileId.set(plan.fileId, rows);
    }

    const integrityFindings: MigrationIntegrityFinding[] = [];

    await prisma.$transaction(async (tx) => {
      const learnerIndex = await buildApplyLearnerMatchIndex(
        tx,
        targetSchoolId,
        stage,
        rowsByFileId
      );
      const schoolLearnerRows = await tx.learner.findMany({
        where: { schoolId: targetSchoolId },
        select: {
          id: true,
          schoolId: true,
          firstName: true,
          lastName: true,
          idNumber: true,
          birthDate: true,
          admissionNo: true,
          enrollmentStatus: true,
          familyAccountId: true,
        },
      });
      const schoolLearnerCandidates: MigrationLearnerIdentityCandidate[] = [
        ...schoolLearnerRows,
      ];
      const takenAdmissionNos = new Set(
        schoolLearnerRows
          .map((row) => String(row.admissionNo || "").trim().toUpperCase())
          .filter(Boolean)
      );

      for (const plan of filePlans) {
        if (!plan.kidESysStaffImport) continue;
        const employees = parseEmployeesFile(plan.path);
        for (let i = 0; i < employees.length; i++) {
          const emp = employees[i]!;
          const rowNumber = i + 1;
          const dupKey = employeeDuplicateKey(emp);
          if (!dupKey || dupKey === "name:|") {
            pushReport(report, {
              entityType: "employee",
              sourceFileId: plan.fileId,
              sourceFilename: plan.filename,
              rowNumber,
              status: "failed",
              message: "Staff row missing name",
            });
            bumpCount(failedCounts, "employee");
            continue;
          }
          if (seenEmployees.has(dupKey)) {
            pushReport(report, {
              entityType: "employee",
              sourceFileId: plan.fileId,
              sourceFilename: plan.filename,
              rowNumber,
              status: "skipped",
              message: "Duplicate staff member in import batch",
              key: dupKey,
            });
            bumpCount(skippedCounts, "employee");
            continue;
          }
          const existing = await tx.employee.findFirst({
            where: {
              schoolId: targetSchoolId,
              OR: [
                { fullName: emp.fullName },
                {
                  AND: [{ firstName: emp.firstName }, { lastName: emp.lastName }],
                },
              ],
            },
            select: { id: true },
          });
          if (existing) {
            seenEmployees.add(dupKey);
            pushReport(report, {
              entityType: "employee",
              sourceFileId: plan.fileId,
              sourceFilename: plan.filename,
              rowNumber,
              status: "skipped",
              message: "Staff member already exists for this school",
              key: dupKey,
              recordId: existing.id,
            });
            bumpCount(skippedCounts, "employee");
            continue;
          }
          const created = await tx.employee.create({
            data: {
              schoolId: targetSchoolId,
              firstName: emp.firstName,
              lastName: emp.lastName,
              fullName: emp.fullName,
              mobileNumber: emp.mobileNumber || null,
              email: emp.email || null,
              physicalAddress: emp.physicalAddress || null,
            },
            select: { id: true },
          });
          seenEmployees.add(dupKey);
          pushReport(report, {
            entityType: "employee",
            sourceFileId: plan.fileId,
            sourceFilename: plan.filename,
            rowNumber,
            status: "created",
            message: "Staff member created",
            key: dupKey,
            recordId: created.id,
          });
          bumpCount(createdCounts, "employee");
        }
      }

      for (const { plan, rows, targetToSource } of parsedFiles) {
        const applyLearners =
          plan.category === "learners" &&
          plan.entityKinds.has("learner") &&
          hasTargetsInSet(plan.mappings, LEARNER_FIELDS);
        const applyBilling =
          plan.category === "billing" &&
          plan.entityKinds.has("billing") &&
          hasTargetsInSet(plan.mappings, BILLING_FIELDS);
        const applyTransactions =
          plan.entityKinds.has("transaction") && hasTargetsInSet(plan.mappings, TRANSACTION_FIELDS);

        for (let i = 0; i < rows.length; i++) {
          const rowNumber = i + 1;
          const mapped = mapRawRecord(rows[i]!, targetToSource);

          if (applyTransactions) {
            continue;
          }

          let familyAccountId: string | null = null;

          if (applyBilling) {
            const accountNumber = cleanString(mapped.accountNumber);
            if (!accountNumber) {
              pushReport(report, {
                entityType: "billingAccount",
                sourceFileId: plan.fileId,
                sourceFilename: plan.filename,
                rowNumber,
                status: "failed",
                message: "Missing accountNumber for billing row",
              });
              bumpCount(failedCounts, "billingAccount");
            } else {
              const dupKey = billingDuplicateKey(mapped);
              if (seenBilling.has(dupKey)) {
                pushReport(report, {
                  entityType: "billingAccount",
                  sourceFileId: plan.fileId,
                  sourceFilename: plan.filename,
                  rowNumber,
                  status: "skipped",
                  message: "Duplicate billing account in import batch",
                  key: dupKey,
                });
                bumpCount(skippedCounts, "billingAccount");
              } else {
                const existing = await tx.familyAccount.findFirst({
                  where: { schoolId: targetSchoolId, accountRef: accountNumber },
                  select: { id: true },
                });
                if (existing) {
                  familyAccountId = existing.id;
                  seenBilling.add(dupKey);
                  pushReport(report, {
                    entityType: "billingAccount",
                    sourceFileId: plan.fileId,
                    sourceFilename: plan.filename,
                    rowNumber,
                    status: "skipped",
                    message: "Billing account already exists for this school",
                    key: dupKey,
                    recordId: existing.id,
                  });
                  bumpCount(skippedCounts, "billingAccount");
                } else {
                  const accountName =
                    cleanString(mapped.accountName) ||
                    cleanString(mapped.billingPlan) ||
                    accountNumber;
                  const created = await tx.familyAccount.create({
                    data: {
                      schoolId: targetSchoolId,
                      accountRef: accountNumber,
                      familyName: accountName,
                    },
                    select: { id: true },
                  });
                  familyAccountId = created.id;
                  seenBilling.add(dupKey);
                  pushReport(report, {
                    entityType: "billingAccount",
                    sourceFileId: plan.fileId,
                    sourceFilename: plan.filename,
                    rowNumber,
                    status: "created",
                    message: "Family billing account created",
                    key: dupKey,
                    recordId: created.id,
                  });
                  bumpCount(createdCounts, "billingAccount");
                }
              }
            }
          }

          // Parents are NOT created here — applyParentIdentityPlan runs after learners.

          if (applyLearners) {
            const names = learnerNamesFromMapped(mapped);
            if (!names.firstName && !names.lastName) {
              pushReport(report, {
                entityType: "learner",
                sourceFileId: plan.fileId,
                sourceFilename: plan.filename,
                rowNumber,
                status: "failed",
                message: "Learner row missing name",
              });
              bumpCount(failedCounts, "learner");
              continue;
            }

            const dupKey = learnerDuplicateKey(mapped, targetSchoolId);
            if (seenLearners.has(dupKey)) {
              pushReport(report, {
                entityType: "learner",
                sourceFileId: plan.fileId,
                sourceFilename: plan.filename,
                rowNumber,
                status: "skipped",
                message: "Duplicate learner in import batch",
                key: dupKey,
              });
              bumpCount(skippedCounts, "learner");
              continue;
            }

            const classNorm = normalizeClassroomInput(
              cleanString(mapped.classroom),
              cleanString(mapped.grade)
            );
            const canonicalClass = classNorm.classroomName || null;

            if (
              canonicalClass &&
              !isMigrationClassroomPlaceholder(canonicalClass) &&
              !seenClassrooms.has(canonicalClass)
            ) {
              const classroom = await tx.classroom.upsert({
                where: {
                  schoolId_name: { schoolId: targetSchoolId, name: canonicalClass },
                },
                create: {
                  schoolId: targetSchoolId,
                  name: canonicalClass,
                  teacherName: "",
                  teacherEmail: "",
                },
                update: {},
                select: { id: true },
              });
              seenClassrooms.add(canonicalClass);
              pushReport(report, {
                entityType: "classroom",
                sourceFileId: plan.fileId,
                sourceFilename: plan.filename,
                rowNumber,
                status: "created",
                message: "Classroom ensured",
                key: canonicalClass,
                recordId: classroom.id,
              });
              bumpCount(createdCounts, "classroom");
            }

            const idNumber = cleanString(mapped.idNumber) || null;
            const classified = classifyMigrationLearnerIdentity({
              incoming: {
                schoolId: targetSchoolId,
                firstName: names.firstName,
                lastName: names.lastName,
                idNumber,
                dateOfBirth: cleanString(mapped.dateOfBirth) || null,
                sourceLearnerId: cleanString(mapped.learnerNumber) || null,
              },
              candidates: schoolLearnerCandidates,
            });

            if (classified.hit) {
              seenLearners.add(dupKey);
              pushReport(report, {
                entityType: "learner",
                sourceFileId: plan.fileId,
                sourceFilename: plan.filename,
                rowNumber,
                status: "skipped",
                message: classified.operatorMessage,
                key: dupKey,
                recordId: classified.hit.learnerId,
              });
              bumpCount(skippedCounts, "learner");
              integrityFindings.push({
                findingId: `learner_${classified.hit.learnerId}_${classified.classification}`,
                severity:
                  classified.classification === "EXISTING_HISTORICAL_LEARNER_REACTIVATION_REVIEW"
                    ? "BLOCKING"
                    : "WARNING",
                title:
                  classified.classification === "EXISTING_HISTORICAL_LEARNER_REACTIVATION_REVIEW"
                    ? "Historical learner needs reactivation review"
                    : "Existing learner — review before linking",
                message: classified.operatorMessage,
                learnerKeys: [classified.hit.learnerId],
              });
              continue;
            }

            const birthRaw = cleanString(mapped.dateOfBirth);
            const birthDate = birthRaw ? new Date(birthRaw) : null;
            const accountNumber = cleanString(mapped.accountNumber);
            let learnerFamilyAccountId = familyAccountId;
            if (accountNumber && !learnerFamilyAccountId) {
              const existingFa = await tx.familyAccount.findFirst({
                where: { schoolId: targetSchoolId, accountRef: accountNumber },
                select: { id: true },
              });
              if (existingFa) {
                learnerFamilyAccountId = existingFa.id;
              }
            }

            const enrollmentStatus = enrollmentStatusFromMapped(
              cleanString((mapped as MappedRow & { status?: string }).status)
            );
            const learnerNotes =
              cleanString((mapped as MappedRow & { notes?: string }).notes) || null;
            const admissionNo = allocateMigrationAdmissionNo({
              learnerNumber: cleanString(mapped.learnerNumber),
              accountNumber,
              takenAdmissionNos,
            });
            if (admissionNo) takenAdmissionNos.add(admissionNo.toUpperCase());
            const created = await tx.learner.create({
              data: {
                schoolId: targetSchoolId,
                familyAccountId: learnerFamilyAccountId,
                firstName: names.firstName,
                lastName: names.lastName || names.firstName,
                nickname: cleanString((mapped as MappedRow & { nickname?: string }).nickname) || null,
                grade: cleanString(mapped.grade) || classNorm.gradeLabel || "",
                className: canonicalClass,
                idNumber,
                admissionNo,
                gender: resolveGenderFromSources({
                  gender: cleanString(mapped.gender) || null,
                  idNumber,
                }),
                birthDate:
                  birthDate && !Number.isNaN(birthDate.getTime()) ? birthDate : null,
                homeLanguage:
                  cleanString((mapped as MappedRow & { homeLanguage?: string }).homeLanguage) ||
                  null,
                citizenship:
                  cleanString((mapped as MappedRow & { citizenship?: string }).citizenship) ||
                  null,
                ...(enrollmentStatus ? { enrollmentStatus } : {}),
                ...(learnerNotes ? { notes: learnerNotes } : {}),
                // admissionDate intentionally omitted — not on Prisma Learner
              },
              select: { id: true },
            });

            seenLearners.add(dupKey);
            pushReport(report, {
              entityType: "learner",
              sourceFileId: plan.fileId,
              sourceFilename: plan.filename,
              rowNumber,
              status: "created",
              message: "Learner created",
              key: dupKey,
              recordId: created.id,
            });
            bumpCount(createdCounts, "learner");
            schoolLearnerCandidates.push({
              id: created.id,
              schoolId: targetSchoolId,
              firstName: names.firstName,
              lastName: names.lastName || names.firstName,
              idNumber,
              birthDate: birthDate && !Number.isNaN(birthDate.getTime()) ? birthDate : null,
              admissionNo,
              enrollmentStatus: enrollmentStatus || "ACTIVE",
              familyAccountId: learnerFamilyAccountId,
            });
          }
        }
      }

      // Authoritative parent identity apply (only when preflight was clear)
      if (parentIdentityPreflight && parentRowContexts.length > 0) {
        // Re-resolve learner links against DB now that learners may have been created.
        const refreshed = await runUniversalMigrationParentPreflight({
          prisma: tx as unknown as typeof prisma,
          schoolId: targetSchoolId,
          sourceSystem: stage.sourceSystem,
          parentRows: parentRowContexts,
          resolutions: input.parentIdentityResolutions,
        });
        if (!refreshed.clear) {
          throw new Error(
            "Parent identity became unresolved after learner apply — aborting transaction"
          );
        }
        const parentApply = await applyParentIdentityPlan(
          { prisma: tx as any, schoolId: targetSchoolId, requireFullyResolved: true },
          refreshed.report
        );
        if (parentApply.status !== "APPLIED") {
          throw new Error(parentApply.message || "Parent identity apply blocked");
        }
        createdCounts.parents += parentApply.parentsCreated;
        createdCounts.parentLearnerLinks += parentApply.linksUpserted;
        if (parentApply.parentsReused > 0) {
          skippedCounts.parents += parentApply.parentsReused;
        }
        parentIdentityPreflight = refreshed.report;
        parentIdentityReview = refreshed.reviewContract;
        pushReport(report, {
          entityType: "parent",
          sourceFileId: stage.stageId,
          sourceFilename: "parent-identity-resolver",
          rowNumber: 0,
          status: "created",
          message: `Parent identity applied: reused=${parentApply.parentsReused} created=${parentApply.parentsCreated} links=${parentApply.linksUpserted}`,
        });
      }

      const linkResult = await linkMigrationLearnersToFamilyAccounts(targetSchoolId, tx);
      if (linkResult.learnersLinked > 0 || linkResult.parentsLinked > 0) {
        pushReport(report, {
          entityType: "learner",
          sourceFileId: stage.stageId,
          sourceFilename: "post-apply-link",
          rowNumber: 0,
          status: "created",
          message: `Linked ${linkResult.learnersLinked} learner(s) and ${linkResult.parentsLinked} parent(s) to family accounts`,
        });
      }
      for (const signal of linkResult.reviewSignals) {
        integrityFindings.push({
          findingId: `surname_${signal.learnerKeys.join("_")}`,
          severity: "WARNING",
          title: "Family link needs review",
          message: signal.message,
          learnerKeys: signal.learnerKeys,
        });
        pushReport(report, {
          entityType: "learner",
          sourceFileId: stage.stageId,
          sourceFilename: "family-review",
          rowNumber: 0,
          status: "skipped",
          message: signal.message,
        });
      }

      // Phase 1G — opening balances (ledger invoice/credit), then post-cutover txs, then billing plans.
      // Prisma and file-backed ledger are not one atomic TX: track ids for compensation on failure.
      const openingRows: Array<{
        mapped: MappedRow;
        sourceFileId: string;
        sourceFilename: string;
        rowNumber: number;
      }> = [];
      const billingPlanRows: typeof openingRows = [];
      let hasOpeningBalanceMapping = false;

      for (const { plan, rows, targetToSource } of parsedFiles) {
        for (let i = 0; i < rows.length; i++) {
          const mapped = mapRawRecord(rows[i]!, targetToSource);
          if (cleanString((mapped as MappedRow).openingBalance)) {
            hasOpeningBalanceMapping = true;
            openingRows.push({
              mapped: mapped as MappedRow,
              sourceFileId: plan.fileId,
              sourceFilename: plan.filename,
              rowNumber: i + 1,
            });
          }
          if (
            cleanString((mapped as MappedRow).billingPlan) ||
            cleanString((mapped as MappedRow).feeAmount)
          ) {
            billingPlanRows.push({
              mapped: mapped as MappedRow,
              sourceFileId: plan.fileId,
              sourceFilename: plan.filename,
              rowNumber: i + 1,
            });
          }
        }
      }

      if (hasOpeningBalanceMapping && !cleanString(stage.cutoverDate)) {
        throw new MigrationApplyError(
          "Cutover date is required before posting opening balances. Set cutover on the dry run and re-stage."
        );
      }

      if (openingRows.length > 0) {
        const collapsed = openingBalanceRowsToPost(
          openingRows.map((row) => ({
            accountRef: cleanString(row.mapped.accountNumber),
            openingBalance: row.mapped.openingBalance,
            sourceFileId: row.sourceFileId,
            sourceFilename: row.sourceFilename,
            rowNumber: row.rowNumber,
          }))
        );
        for (const fail of collapsed.failed) {
          failedCounts.transactions += 1;
          integrityFindings.push({
            findingId: `opening_conflict_${fail.accountRef}`,
            severity: "BLOCKING",
            title: "Opening balance conflict",
            message: fail.message,
            accountRef: fail.accountRef,
          });
          pushReport(report, {
            entityType: "transaction",
            sourceFileId: stage.stageId,
            sourceFilename: fail.sourceFilenames[0] || "opening-balance",
            rowNumber: fail.rowNumbers[0] || 0,
            status: "failed",
            message: fail.message,
            key: `opening:${fail.accountRef}`,
          });
        }
        const firstRowByAccount = new Map<string, (typeof openingRows)[number]>();
        for (const row of openingRows) {
          const ref = cleanString(row.mapped.accountNumber);
          if (ref && !firstRowByAccount.has(ref)) firstRowByAccount.set(ref, row);
        }
        const uniqueOpeningRows = collapsed.toPost
          .map((row) => firstRowByAccount.get(row.accountRef))
          .filter((row): row is (typeof openingRows)[number] => Boolean(row));
        if (uniqueOpeningRows.length > 0) {
          await postOpeningBalancesForMappedRows(
            {
              tx,
              schoolId: targetSchoolId,
              cutoverDate: cleanString(stage.cutoverDate),
              migrationRunId: stage.migrationRunId || stage.stageId,
              stageId: stage.stageId,
              sourceAnalysisId: stage.sourceAnalysisId || undefined,
              report,
              createdCounts,
              skippedCounts,
              failedCounts,
              postedLedgerEntryIds,
            },
            uniqueOpeningRows
          );
        }
      }

      const ledgerCtx = {
        tx,
        schoolId: targetSchoolId,
        cutoverDate: stage.cutoverDate,
        learnerIndex,
        seenDuplicateKeys: seenLedgerDuplicateKeys,
        report,
        createdCounts,
        skippedCounts,
        failedCounts,
        transactionOutcomes,
      };

      for (const { plan, rows, targetToSource } of parsedFiles) {
        const applyTransactions =
          plan.entityKinds.has("transaction") && hasTargetsInSet(plan.mappings, TRANSACTION_FIELDS);
        if (!applyTransactions) continue;
        if (!shouldAutoPostExpressInvoiceTransactions(plan.filename)) {
          pushReport(report, {
            entityType: "transaction",
            sourceFileId: plan.fileId,
            sourceFilename: plan.filename,
            rowNumber: 0,
            status: "not_applied",
            message:
              "This export is supporting detail only (for example item sales). It is not posted as family invoices or payments.",
          });
          continue;
        }

        for (let i = 0; i < rows.length; i++) {
          const rowNumber = i + 1;
          const mapped = mapRawRecord(rows[i]!, targetToSource);
          // Never post UNKNOWN_FINANCE; never treat openingBalance columns as ordinary txs
          if (cleanString((mapped as MappedRow).openingBalance)) continue;
          const classified = classifyFinanceSourceRow({
            mapped: mapped as MappedRow,
            treatPreCutoverAsHistory: hasOpeningBalanceMapping,
            isPreCutover: Boolean(
              stage.cutoverDate &&
                cleanString((mapped as MappedRow).transactionDate) &&
                cleanString((mapped as MappedRow).transactionDate).slice(0, 10) <
                  cleanString(stage.cutoverDate).slice(0, 10)
            ),
          });
          if (
            classified.classification === "UNKNOWN_FINANCE" ||
            classified.classification === "TRANSACTION_HISTORY" ||
            classified.classification === "OPENING_BALANCE"
          ) {
            pushReport(report, {
              entityType: "transaction",
              sourceFileId: plan.fileId,
              sourceFilename: plan.filename,
              rowNumber,
              status: "not_applied",
              message: classified.reason,
            });
            continue;
          }
          const beforeIds = new Set(
            // capture via report recordIds after post — track by wrapping
            [] as string[]
          );
          void beforeIds;
          await postSingleMigrationLedgerTransaction(ledgerCtx, {
            mapped,
            sourceFileId: plan.fileId,
            sourceFilename: plan.filename,
            rowNumber,
          });
          // Idempotent umig-tx ids — compensation uses report-created ids collected below
        }
      }

      // Collect newly created transaction ledger ids from report for compensation
      for (const row of report) {
        if (
          row.entityType === "transaction" &&
          row.status === "created" &&
          row.recordId &&
          !postedLedgerEntryIds.includes(row.recordId)
        ) {
          postedLedgerEntryIds.push(row.recordId);
        }
      }

      if (billingPlanRows.length > 0) {
        await applyMigrationBillingPlansFromMappedRows(
          {
            tx,
            schoolId: targetSchoolId,
            report,
            createdCounts,
            skippedCounts,
            failedCounts,
          },
          billingPlanRows
        );
      }
    }, MIGRATION_APPLY_TX_OPTIONS);

    saveMigrationIntegrity({
      stageId: stage.stageId,
      targetSchoolId,
      updatedAt: new Date().toISOString(),
      findings: integrityFindings,
      blockingCount: integrityFindings.filter((f) => f.severity === "BLOCKING").length,
    });

    const result: MigrationApplyResult = {
      ...baseResult(),
      success: true,
      migrationStatus: "APPLIED",
      createdCounts: { ...createdCounts },
      skippedCounts: { ...skippedCounts },
      failedCounts: { ...failedCounts },
      transactionOutcomes: { ...transactionOutcomes },
      report,
      applyExpectations,
      parentIdentityPreflight,
      parentIdentityReview,
    };

    updateImportBatch(batch.batchId, {
      status: "completed",
      completedAt: result.appliedAt,
      result,
      createdCounts: result.createdCounts,
      skippedCounts: result.skippedCounts,
      failedCounts: result.failedCounts,
      reportRows: result.report,
    });

    return result;
  } catch (e: unknown) {
    // Compensate file-backed ledger writes if apply failed after partial ledger posts.
    if (postedLedgerEntryIds.length > 0) {
      try {
        removeSchoolEntriesByIds(targetSchoolId, postedLedgerEntryIds);
      } catch (compErr: unknown) {
        console.error(
          "migration apply ledger compensation failed",
          compErr instanceof Error ? compErr.message : compErr
        );
      }
    }
    const message = e instanceof Error ? e.message : "Apply failed";
    const failedResult: MigrationApplyResult = {
      ...baseResult(),
      success: false,
      error: message,
    };

    updateImportBatch(batch.batchId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      result: failedResult,
      createdCounts: failedResult.createdCounts,
      skippedCounts: failedResult.skippedCounts,
      failedCounts: failedResult.failedCounts,
      reportRows: failedResult.report,
    });

    throw new MigrationApplyError(message, failedResult);
  }
}
