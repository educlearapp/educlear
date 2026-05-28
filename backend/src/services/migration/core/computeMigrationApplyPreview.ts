import { prisma } from "../../../prisma";
import { normalizeClassroomInput } from "../../../utils/classroomNormalization";
import type { MigrationApplyExpectations } from "../types/MigrationApplyExpectations";
import type { MigrationStage } from "../types/MigrationStage";
import type { MigrationTargetField } from "../types/MigrationTargetField";
import {
  BILLING_TARGET_FIELDS,
  LEARNER_TARGET_FIELDS,
  PARENT_TARGET_FIELDS,
  TRANSACTION_TARGET_FIELDS,
} from "../types/MigrationTargetField";
import type { MigrationFileColumnMappings } from "../types/MigrationValidation";
import { migrationTargetCategory } from "../staging/buildMigrationStage";
import { parseStagedMigrationFile } from "./parseStagedMigrationFile";

const LEARNER_FIELDS = new Set<string>(LEARNER_TARGET_FIELDS);
const PARENT_FIELDS = new Set<string>(PARENT_TARGET_FIELDS);
const BILLING_FIELDS = new Set<string>(BILLING_TARGET_FIELDS);
const TRANSACTION_FIELDS = new Set<string>(TRANSACTION_TARGET_FIELDS);

export type { MigrationApplyExpectations };

type FilePlan = {
  fileId: string;
  filename: string;
  path: string;
  category: string;
  mappings: MigrationFileColumnMappings["mappings"];
};

function cleanString(v: unknown): string {
  return String(v ?? "").trim();
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

type MappedRow = Partial<Record<MigrationTargetField, string>>;

function mapRawRecord(
  raw: Record<string, string>,
  targetToSource: Map<MigrationTargetField, string>
): MappedRow {
  const out: MappedRow = {};
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

function enrichParentMappedFromContactList(
  mapped: MappedRow,
  raw: Record<string, string>
): MappedRow {
  if (cleanString(mapped.parentPhone)) return mapped;
  const work = cleanString(raw["Work No"]);
  const home = cleanString(raw["Home No"]);
  if (work) return { ...mapped, parentPhone: work };
  if (home) return { ...mapped, parentPhone: home };
  return mapped;
}

function learnerDuplicateKey(mapped: MappedRow): string {
  const idNumber = cleanString(mapped.idNumber);
  if (idNumber) return `id:${idNumber.toLowerCase()}`;
  const names = learnerNamesFromMapped(mapped);
  const classroom = cleanString(mapped.classroom);
  const classNorm = normalizeClassroomInput(classroom, cleanString(mapped.grade));
  const classLabel = classNorm.classroomName || classroom;
  return `name:${names.firstName.toLowerCase()}|${names.lastName.toLowerCase()}|${classLabel.toLowerCase()}`;
}

function parentDuplicateKey(mapped: MappedRow): string {
  const phone = cleanString(mapped.parentPhone);
  const email = cleanString(mapped.parentEmail).toLowerCase();
  const name = cleanString(mapped.parentName).toLowerCase();
  if (phone) return `phone:${phone.replace(/\D/g, "")}`;
  if (email) return `email:${email}`;
  if (name) return `name:${name}`;
  return "";
}

function billingDuplicateKey(mapped: MappedRow): string {
  const account = cleanString(mapped.accountNumber);
  return account ? `acct:${account.toLowerCase()}` : "";
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

function buildFilePlans(stage: MigrationStage): FilePlan[] {
  const byFileId = new Map(stage.mappings.map((m) => [m.fileId, m]));
  const plans: FilePlan[] = [];

  for (const file of stage.files) {
    const pathValue = cleanString(file.path);
    if (!pathValue) continue;
    const category = String(file.category || "").trim();
    if (category === "staff") continue;

    const fileMappings = byFileId.get(file.fileId);
    if (!fileMappings?.mappings?.length) continue;
    if (fileEntityKinds(fileMappings.mappings).size === 0) continue;

    plans.push({
      fileId: file.fileId,
      filename: file.filename,
      path: pathValue,
      category,
      mappings: fileMappings.mappings,
    });
  }

  return plans;
}

function learnerDupKeyFromDb(learner: {
  firstName: string;
  lastName: string;
  idNumber: string | null;
  className: string | null;
}): string {
  if (learner.idNumber) return `id:${String(learner.idNumber).toLowerCase()}`;
  const classLabel = learner.className || "";
  return `name:${learner.firstName.toLowerCase()}|${learner.lastName.toLowerCase()}|${classLabel.toLowerCase()}`;
}

export async function computeMigrationApplyPreview(
  stage: MigrationStage,
  targetSchoolId: string
): Promise<MigrationApplyExpectations> {
  const plans = buildFilePlans(stage);
  const existingLearnerKeys = new Set<string>();
  const existingBillingKeys = new Set<string>();

  const dbLearners = await prisma.learner.findMany({
    where: { schoolId: targetSchoolId },
    select: {
      firstName: true,
      lastName: true,
      idNumber: true,
      className: true,
    },
  });
  for (const learner of dbLearners) {
    existingLearnerKeys.add(learnerDupKeyFromDb(learner));
  }

  const dbAccounts = await prisma.familyAccount.findMany({
    where: { schoolId: targetSchoolId },
    select: { accountRef: true },
  });
  for (const acct of dbAccounts) {
    const ref = cleanString(acct.accountRef).toLowerCase();
    if (ref) existingBillingKeys.add(`acct:${ref}`);
  }

  const seenLearners = new Set<string>();
  const seenParents = new Set<string>();
  const seenBilling = new Set<string>();
  let learnerCreates = 0;
  let parentCreates = 0;
  let parentLearnerLinks = 0;
  let billingCreates = 0;

  for (const plan of plans) {
    const rows = await parseStagedMigrationFile(plan.path, plan.filename, stage.sourceSystem);
    const targetToSource = buildTargetToSource(plan.mappings);
    const kinds = fileEntityKinds(plan.mappings);

    const applyLearners =
      plan.category === "learners" &&
      kinds.has("learner") &&
      hasTargetsInSet(plan.mappings, LEARNER_FIELDS);
    const applyParents =
      plan.category === "parents" &&
      kinds.has("parent") &&
      hasTargetsInSet(plan.mappings, PARENT_FIELDS);
    const applyBilling =
      plan.category === "billing" &&
      kinds.has("billing") &&
      hasTargetsInSet(plan.mappings, BILLING_FIELDS);

    for (const row of rows) {
      let mapped = mapRawRecord(row, targetToSource);
      if (applyParents) {
        mapped = enrichParentMappedFromContactList(mapped, row);
      }

      if (applyBilling) {
        const accountNumber = cleanString(mapped.accountNumber);
        if (!accountNumber) continue;
        const dupKey = billingDuplicateKey(mapped);
        if (!dupKey || seenBilling.has(dupKey) || existingBillingKeys.has(dupKey)) continue;
        seenBilling.add(dupKey);
        billingCreates += 1;
      }

      if (applyParents) {
        const parentKey = parentDuplicateKey(mapped);
        if (!parentKey) continue;
        if (seenParents.has(parentKey)) continue;
        seenParents.add(parentKey);
        parentCreates += 1;

        const learnerKey = learnerDuplicateKey(mapped);
        const names = learnerNamesFromMapped(mapped);
        if (
          (names.firstName || names.lastName) &&
          learnerKey &&
          (existingLearnerKeys.has(learnerKey) || seenLearners.has(learnerKey))
        ) {
          parentLearnerLinks += 1;
        }
      }

      if (!applyLearners) continue;

      const names = learnerNamesFromMapped(mapped);
      if (!names.firstName && !names.lastName) continue;

      const dupKey = learnerDuplicateKey(mapped);
      if (!dupKey || dupKey === "name:||") continue;
      if (seenLearners.has(dupKey) || existingLearnerKeys.has(dupKey)) continue;

      seenLearners.add(dupKey);
      learnerCreates += 1;
    }
  }

  const stagedLearners = stage.stagedCounts.learners;
  const maxAllowed = Math.ceil(stagedLearners * 1.05);

  return {
    learnerCreatesFromLearnerFiles: learnerCreates,
    stagedLearnerCount: stagedLearners,
    maxAllowedLearnerCreates: maxAllowed,
    parentCreates,
    parentLearnerLinks,
    billingAccountCreates: billingCreates,
    transactionsEligibleToPost: stage.transactionReadiness?.eligibleActiveTransactions ?? 0,
    transactionsStaged: stage.stagedCounts.transactions,
  };
}

export function assertLearnerCreateGuard(expectations: MigrationApplyExpectations): void {
  if (expectations.learnerCreatesFromLearnerFiles <= expectations.maxAllowedLearnerCreates) {
    return;
  }
  throw new Error(
    `Apply blocked: would create ${expectations.learnerCreatesFromLearnerFiles} learner(s) from learner-class files, ` +
      `but dry run staged ${expectations.stagedLearnerCount} (max ${expectations.maxAllowedLearnerCreates} with 5% tolerance). ` +
      "Learners must only be created from learner-category class list files — check column mappings on billing, contact, or transaction files."
  );
}
