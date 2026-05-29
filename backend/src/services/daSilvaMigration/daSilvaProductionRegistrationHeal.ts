import fs from "fs";
import path from "path";
import crypto from "crypto";

import type { PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "../../prisma";
import { buildRegistrationStats } from "../registrationStatsService";
import { buildAccountsFromAgeAnalysisSnapshots } from "../statementAccounts";
import { readSchoolBillingPlans, upsertSchoolBillingPlans } from "../../utils/learnerBillingPlanStore";
import { readSchoolLedger } from "../../utils/billingLedgerStore";
import { readSchoolKidesysHistory } from "../../utils/kidesysTransactionHistoryStore";
import {
  readSchoolFamilyAccountAgeAnalysisSnapshots,
  type FamilyAccountAgeAnalysisSnapshot,
} from "../../utils/familyAccountAgeAnalysisStore";
import { resolveLearnerGender } from "../../utils/learnerGender";
import { buildLearnerMatchKey } from "./parsers";
import {
  repairDaSilvaSasamsLearners,
  repairDaSilvaSasamsParents,
  resolveLatestDaSilvaStagingProject,
} from "./daSilvaCurrentDbRepair";
import { DA_SILVA_FINAL_IMPORT_EXPECTED } from "./daSilvaFinalImportGate";
import { DA_SILVA_EXPECTED_LEARNER_COUNT } from "./daSilvaConstants";

const PRE_SCHOOL_CRECHE = "Pre-School Creche";
const CRECHE_CANONICAL = "Creche";

export type HealDryRunBefore = {
  learnersMissingGender: number;
  learnersMissingIdNumber: number;
  parentsMissingIdNumber: number;
  preSchoolCreche: number;
  billingPlansCount: number;
  statementAccounts: number;
};

export type HealAfterMetrics = {
  children: number;
  boys: number;
  girls: number;
  parents: number;
  parentsWithId: number;
  learnersWithBillingPlans: number;
  preSchoolCreche: number;
  statementAccounts: number;
};

export type BillingFingerprint = {
  familyAccountCount: number;
  accountRefDigest: string;
  ageAnalysisAccountCount: number;
  ageAnalysisNetOutstanding: number;
  ledgerEntryCount: number;
  ledgerInvoiceCount: number;
  ledgerPaymentCount: number;
  historyRowCount: number;
};

export type ProductionRegistrationHealResult = {
  mode: "dry-run" | "apply";
  schoolId: string;
  sourceDir: string;
  dataRoot: string;
  dryRunBefore: HealDryRunBefore;
  applied: string[];
  after: HealAfterMetrics;
  billingBefore: BillingFingerprint;
  billingAfter: BillingFingerprint;
  billingUntouched: boolean;
  auditPass: boolean;
  auditNotes: string[];
};

function hasText(value: unknown): boolean {
  return Boolean(String(value ?? "").trim());
}

function pickString(
  incoming: string | null | undefined,
  existing: string | null | undefined
): string | undefined {
  const inc = String(incoming ?? "").trim();
  if (!inc) return undefined;
  const cur = String(existing ?? "").trim();
  if (cur === inc) return undefined;
  return inc;
}

function pickDate(
  incoming: Date | null | undefined,
  existing: Date | null | undefined
): Date | undefined {
  if (!incoming) return undefined;
  if (existing && incoming.getTime() === existing.getTime()) return undefined;
  return incoming;
}

function digestAccountRefs(refs: string[]): string {
  const sorted = [...refs].map((r) => String(r || "").trim().toUpperCase()).filter(Boolean).sort();
  return crypto.createHash("sha256").update(sorted.join("|")).digest("hex").slice(0, 16);
}

function sumAgeAnalysisNet(snapshots: Record<string, FamilyAccountAgeAnalysisSnapshot>): number {
  return Object.values(snapshots).reduce((sum, row) => sum + (Number(row.balance) || 0), 0);
}

export async function captureBillingFingerprint(
  schoolId: string,
  dataRoot: string
): Promise<BillingFingerprint> {
  const prevCwd = process.cwd();
  if (dataRoot && path.resolve(dataRoot) !== path.resolve(prevCwd)) {
    process.chdir(dataRoot);
  }
  try {
    const familyAccounts = await defaultPrisma.familyAccount.findMany({
      where: { schoolId },
      select: { accountRef: true },
      orderBy: { accountRef: "asc" },
    });
    const refs = familyAccounts.map((r) => String(r.accountRef || "").trim());
    const ageSnapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId);
    const ledger = readSchoolLedger(schoolId);
    const history = readSchoolKidesysHistory(schoolId);

    return {
      familyAccountCount: familyAccounts.length,
      accountRefDigest: digestAccountRefs(refs),
      ageAnalysisAccountCount: Object.keys(ageSnapshots).length,
      ageAnalysisNetOutstanding: Math.round(sumAgeAnalysisNet(ageSnapshots) * 100) / 100,
      ledgerEntryCount: ledger.length,
      ledgerInvoiceCount: ledger.filter((e) => e.type === "invoice").length,
      ledgerPaymentCount: ledger.filter((e) => e.type === "payment").length,
      historyRowCount: history.length,
    };
  } finally {
    if (dataRoot && path.resolve(dataRoot) !== path.resolve(prevCwd)) {
      process.chdir(prevCwd);
    }
  }
}

export async function collectHealDryRunBefore(
  schoolId: string,
  dataRoot: string
): Promise<HealDryRunBefore> {
  const activeWhere = { schoolId, enrollmentStatus: "ACTIVE" as const };
  const [activeLearners, parentsMissingId, preSchoolCreche] = await Promise.all([
    defaultPrisma.learner.findMany({
      where: activeWhere,
      select: { gender: true, idNumber: true },
    }),
    defaultPrisma.parent.count({
      where: {
        schoolId,
        OR: [{ idNumber: null }, { idNumber: "" }],
      },
    }),
    defaultPrisma.learner.count({
      where: {
        ...activeWhere,
        OR: [
          { className: { equals: PRE_SCHOOL_CRECHE, mode: "insensitive" } },
          { grade: { equals: PRE_SCHOOL_CRECHE, mode: "insensitive" } },
        ],
      },
    }),
  ]);

  let learnersMissingGender = 0;
  let learnersMissingIdNumber = 0;
  for (const row of activeLearners) {
    if (!resolveLearnerGender({ gender: row.gender, idNumber: row.idNumber })) {
      learnersMissingGender += 1;
    }
    if (!hasText(row.idNumber)) learnersMissingIdNumber += 1;
  }

  const prevCwd = process.cwd();
  if (dataRoot && path.resolve(dataRoot) !== path.resolve(prevCwd)) {
    process.chdir(dataRoot);
  }
  let billingPlansCount = 0;
  let statementAccounts = 0;
  try {
    billingPlansCount = Object.keys(readSchoolBillingPlans(schoolId)).length;
    const accounts = await buildAccountsFromAgeAnalysisSnapshots(schoolId);
    statementAccounts = accounts.length;
  } finally {
    if (dataRoot && path.resolve(dataRoot) !== path.resolve(prevCwd)) {
      process.chdir(prevCwd);
    }
  }

  return {
    learnersMissingGender,
    learnersMissingIdNumber,
    parentsMissingIdNumber: parentsMissingId,
    preSchoolCreche,
    billingPlansCount,
    statementAccounts,
  };
}

export async function collectHealAfterMetrics(
  schoolId: string,
  dataRoot: string
): Promise<HealAfterMetrics> {
  const { stats } = await buildRegistrationStats(schoolId);
  const parentsWithId = await defaultPrisma.parent.count({
    where: {
      schoolId,
      NOT: { OR: [{ idNumber: null }, { idNumber: "" }] },
    },
  });
  const preSchoolCreche = await defaultPrisma.learner.count({
    where: {
      schoolId,
      enrollmentStatus: "ACTIVE",
      OR: [
        { className: { equals: PRE_SCHOOL_CRECHE, mode: "insensitive" } },
        { grade: { equals: PRE_SCHOOL_CRECHE, mode: "insensitive" } },
      ],
    },
  });

  const prevCwd = process.cwd();
  if (dataRoot && path.resolve(dataRoot) !== path.resolve(prevCwd)) {
    process.chdir(dataRoot);
  }
  let learnersWithBillingPlans = 0;
  let statementAccounts = 0;
  try {
    learnersWithBillingPlans = Object.keys(readSchoolBillingPlans(schoolId)).length;
    statementAccounts = (await buildAccountsFromAgeAnalysisSnapshots(schoolId)).length;
  } finally {
    if (dataRoot && path.resolve(dataRoot) !== path.resolve(prevCwd)) {
      process.chdir(prevCwd);
    }
  }

  return {
    children: stats.children,
    boys: stats.boys,
    girls: stats.girls,
    parents: stats.parents,
    parentsWithId,
    learnersWithBillingPlans,
    preSchoolCreche,
    statementAccounts,
  };
}

async function healCrecheLabels(schoolId: string, apply: boolean): Promise<number> {
  const rows = await defaultPrisma.learner.findMany({
    where: {
      schoolId,
      enrollmentStatus: "ACTIVE",
      OR: [
        { className: { equals: PRE_SCHOOL_CRECHE, mode: "insensitive" } },
        { grade: { equals: PRE_SCHOOL_CRECHE, mode: "insensitive" } },
      ],
    },
    select: { id: true, grade: true },
  });
  if (!apply || !rows.length) return rows.length;

  for (const row of rows) {
    await defaultPrisma.learner.update({
      where: { id: row.id },
      data: {
        className: CRECHE_CANONICAL,
        grade:
          String(row.grade || "").toLowerCase() === PRE_SCHOOL_CRECHE.toLowerCase()
            ? CRECHE_CANONICAL
            : row.grade,
      },
    });
  }

  const classroomRow = await defaultPrisma.classroom.findFirst({
    where: { schoolId, name: { equals: PRE_SCHOOL_CRECHE, mode: "insensitive" } },
  });
  if (classroomRow) {
    const existingCreche = await defaultPrisma.classroom.findFirst({
      where: { schoolId, name: { equals: CRECHE_CANONICAL, mode: "insensitive" } },
    });
    if (!existingCreche) {
      await defaultPrisma.classroom.update({
        where: { id: classroomRow.id },
        data: { name: CRECHE_CANONICAL },
      });
    }
  }

  return rows.length;
}

async function healFromSourceDatabase(opts: {
  schoolId: string;
  sourcePrisma: PrismaClient;
  sourceSchoolId: string;
  apply: boolean;
}): Promise<{ learnersUpdated: number; parentsUpdated: number; linksUpserted: number }> {
  const sourceLearners = await opts.sourcePrisma.learner.findMany({
    where: { schoolId: opts.sourceSchoolId, enrollmentStatus: "ACTIVE" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      className: true,
      grade: true,
      admissionNo: true,
      idNumber: true,
      birthDate: true,
      gender: true,
      citizenship: true,
      homeLanguage: true,
      createdAt: true,
    },
  });

  const targetLearners = await defaultPrisma.learner.findMany({
    where: { schoolId: opts.schoolId, enrollmentStatus: "ACTIVE" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      className: true,
      grade: true,
      admissionNo: true,
      idNumber: true,
      birthDate: true,
      gender: true,
      citizenship: true,
      homeLanguage: true,
      createdAt: true,
    },
  });

  const byAdmission = new Map<string, (typeof targetLearners)[0]>();
  const byMatchKey = new Map<string, (typeof targetLearners)[0]>();
  for (const row of targetLearners) {
    const adm = String(row.admissionNo || "").trim();
    if (adm) byAdmission.set(adm, row);
    const fullName = `${row.firstName} ${row.lastName}`.trim();
    byMatchKey.set(buildLearnerMatchKey(fullName, String(row.className || "")), row);
  }

  let learnersUpdated = 0;
  for (const src of sourceLearners) {
    const adm = String(src.admissionNo || "").trim();
    const fullName = `${src.firstName} ${src.lastName}`.trim();
    const matchKey = buildLearnerMatchKey(fullName, String(src.className || ""));
    const target =
      (adm && byAdmission.get(adm)) || byMatchKey.get(matchKey) || null;
    if (!target) continue;

    const data: Record<string, unknown> = {};
    const idNumber = pickString(src.idNumber, target.idNumber);
    const gender = pickString(src.gender, target.gender);
    const className = pickString(src.className, target.className);
    const grade = pickString(src.grade, target.grade);
    const citizenship = pickString(src.citizenship, target.citizenship);
    const homeLanguage = pickString(src.homeLanguage, target.homeLanguage);
    const birthDate = pickDate(src.birthDate, target.birthDate);
    if (idNumber) data.idNumber = idNumber;
    if (gender) data.gender = gender;
    if (className) data.className = className;
    if (grade) data.grade = grade;
    if (citizenship) data.citizenship = citizenship;
    if (homeLanguage) data.homeLanguage = homeLanguage;
    if (birthDate) data.birthDate = birthDate;
    if (src.createdAt && target.createdAt.getTime() !== src.createdAt.getTime()) {
      data.createdAt = src.createdAt;
    }

    if (!Object.keys(data).length) continue;
    learnersUpdated += 1;
    if (opts.apply) {
      await defaultPrisma.learner.update({ where: { id: target.id }, data });
    }
  }

  const sourceParents = await opts.sourcePrisma.parent.findMany({
    where: { schoolId: opts.sourceSchoolId },
    select: {
      id: true,
      firstName: true,
      surname: true,
      cellNo: true,
      email: true,
      idNumber: true,
      relationship: true,
      workNo: true,
      homeNo: true,
      links: { select: { learnerId: true, relation: true, isPrimary: true } },
    },
  });

  const targetParents = await defaultPrisma.parent.findMany({
    where: { schoolId: opts.schoolId },
    select: { id: true, firstName: true, surname: true, cellNo: true },
  });
  const parentByKey = new Map(
    targetParents.map((p) => [
      `${String(p.firstName || "").trim().toLowerCase()}|${String(p.surname || "").trim().toLowerCase()}|${String(p.cellNo || "").trim()}`,
      p,
    ])
  );

  const sourceLearnerIdToTarget = new Map<string, string>();
  for (const src of sourceLearners) {
    const adm = String(src.admissionNo || "").trim();
    const fullName = `${src.firstName} ${src.lastName}`.trim();
    const matchKey = buildLearnerMatchKey(fullName, String(src.className || ""));
    const target =
      (adm && byAdmission.get(adm)) || byMatchKey.get(matchKey) || null;
    if (target) sourceLearnerIdToTarget.set(src.id, target.id);
  }

  let parentsUpdated = 0;
  let linksUpserted = 0;
  for (const src of sourceParents) {
    const key = `${String(src.firstName || "").trim().toLowerCase()}|${String(src.surname || "").trim().toLowerCase()}|${String(src.cellNo || "").trim()}`;
    let parentId = parentByKey.get(key)?.id;
    if (!parentId && opts.apply) {
      const created = await defaultPrisma.parent.create({
        data: {
          schoolId: opts.schoolId,
          familyAccountId: null,
          firstName: src.firstName,
          surname: src.surname,
          cellNo: src.cellNo,
          email: hasText(src.email) ? src.email : null,
          idNumber: src.idNumber,
          relationship: src.relationship,
          workNo: src.workNo || null,
          homeNo: src.homeNo || null,
          outstandingAmount: 0,
        },
        select: { id: true },
      });
      parentId = created.id;
      parentByKey.set(key, { id: parentId, firstName: src.firstName, surname: src.surname, cellNo: src.cellNo });
      parentsUpdated += 1;
    } else if (parentId) {
      const existing = await defaultPrisma.parent.findUnique({
        where: { id: parentId },
        select: {
          firstName: true,
          surname: true,
          cellNo: true,
          email: true,
          idNumber: true,
          relationship: true,
          workNo: true,
          homeNo: true,
        },
      });
      if (existing) {
        const data: Record<string, unknown> = {};
        const firstName = pickString(src.firstName, existing.firstName);
        const surname = pickString(src.surname, existing.surname);
        const email = pickString(src.email, existing.email);
        const idNumber = pickString(src.idNumber, existing.idNumber);
        const relationship = pickString(src.relationship, existing.relationship);
        const workNo = pickString(src.workNo, existing.workNo);
        const homeNo = pickString(src.homeNo, existing.homeNo);
        if (firstName) data.firstName = firstName;
        if (surname) data.surname = surname;
        if (email) data.email = email;
        if (idNumber) data.idNumber = idNumber;
        if (relationship) data.relationship = relationship;
        if (workNo) data.workNo = workNo;
        if (homeNo) data.homeNo = homeNo;
        if (Object.keys(data).length) {
          parentsUpdated += 1;
          if (opts.apply) {
            await defaultPrisma.parent.update({ where: { id: parentId }, data });
          }
        }
      }
    }

    if (!parentId) continue;

    for (const link of src.links) {
      const targetLearnerId = sourceLearnerIdToTarget.get(link.learnerId);
      if (!targetLearnerId) continue;
      linksUpserted += 1;
      if (!opts.apply) continue;
      await defaultPrisma.parentLearnerLink.upsert({
        where: { parentId_learnerId: { parentId, learnerId: targetLearnerId } },
        create: {
          schoolId: opts.schoolId,
          parentId,
          learnerId: targetLearnerId,
          relation: link.relation,
          isPrimary: link.isPrimary,
        },
        update: {
          relation: hasText(link.relation) ? link.relation : undefined,
          isPrimary: link.isPrimary,
        },
      });
    }
  }

  return { learnersUpdated, parentsUpdated, linksUpserted };
}

function loadSourceBillingPlans(
  sourceDir: string,
  sourceSchoolId: string
): Record<string, import("../../utils/learnerBillingPlanStore").StoredBillingPlanItem[]> {
  const filePath = path.join(sourceDir, "data", "learner-billing-plans.json");
  if (!fs.existsSync(filePath)) return {};
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<
    string,
    Record<string, import("../../utils/learnerBillingPlanStore").StoredBillingPlanItem[]>
  >;
  if (raw[sourceSchoolId]) return raw[sourceSchoolId];
  const match = Object.entries(raw).find(
    ([, plans]) => plans && typeof plans === "object" && Object.keys(plans).length >= 300
  );
  return match?.[1] || {};
}

async function healBillingPlansFromSource(opts: {
  schoolId: string;
  sourceDir: string;
  sourceSchoolId: string;
  sourcePrisma?: PrismaClient;
  apply: boolean;
}): Promise<number> {
  const sourcePlans = loadSourceBillingPlans(opts.sourceDir, opts.sourceSchoolId);
  const sourceIds = Object.keys(sourcePlans);
  if (!sourceIds.length) return 0;

  const sourceLearners = opts.sourcePrisma
    ? await opts.sourcePrisma.learner.findMany({
        where: { schoolId: opts.sourceSchoolId, id: { in: sourceIds } },
        select: {
          id: true,
          admissionNo: true,
          firstName: true,
          lastName: true,
          className: true,
        },
      })
    : [];

  const targetLearners = await defaultPrisma.learner.findMany({
    where: { schoolId: opts.schoolId, enrollmentStatus: "ACTIVE" },
    select: {
      id: true,
      admissionNo: true,
      firstName: true,
      lastName: true,
      className: true,
    },
  });

  const targetByAdmission = new Map<string, string>();
  const targetByMatchKey = new Map<string, string>();
  for (const row of targetLearners) {
    const adm = String(row.admissionNo || "").trim();
    if (adm) targetByAdmission.set(adm, row.id);
    const fullName = `${row.firstName} ${row.lastName}`.trim();
    targetByMatchKey.set(buildLearnerMatchKey(fullName, String(row.className || "")), row.id);
  }

  const remapped: Record<string, import("../../utils/learnerBillingPlanStore").StoredBillingPlanItem[]> =
    {};
  for (const src of sourceLearners) {
    const items = sourcePlans[src.id];
    if (!items?.length) continue;
    const adm = String(src.admissionNo || "").trim();
    const fullName = `${src.firstName} ${src.lastName}`.trim();
    const matchKey = buildLearnerMatchKey(fullName, String(src.className || ""));
    const targetId =
      (adm && targetByAdmission.get(adm)) || targetByMatchKey.get(matchKey) || null;
    if (!targetId) continue;
    remapped[targetId] = items;
  }

  if (!Object.keys(remapped).length || !opts.apply) {
    return Object.keys(remapped).length;
  }

  upsertSchoolBillingPlans(opts.schoolId, remapped);
  return Object.keys(remapped).length;
}

function fingerprintsEqual(a: BillingFingerprint, b: BillingFingerprint): boolean {
  return (
    a.familyAccountCount === b.familyAccountCount &&
    a.accountRefDigest === b.accountRefDigest &&
    a.ageAnalysisAccountCount === b.ageAnalysisAccountCount &&
    Math.abs(a.ageAnalysisNetOutstanding - b.ageAnalysisNetOutstanding) < 0.02 &&
    a.ledgerEntryCount === b.ledgerEntryCount &&
    a.ledgerInvoiceCount === b.ledgerInvoiceCount &&
    a.ledgerPaymentCount === b.ledgerPaymentCount &&
    a.historyRowCount === b.historyRowCount
  );
}

export function evaluateHealAudit(
  after: HealAfterMetrics,
  billingUntouched: boolean
): { auditPass: boolean; auditNotes: string[] } {
  const notes: string[] = [];
  if (after.statementAccounts !== DA_SILVA_FINAL_IMPORT_EXPECTED.billingAccounts) {
    notes.push(
      `statement accounts ${after.statementAccounts} (expected ${DA_SILVA_FINAL_IMPORT_EXPECTED.billingAccounts})`
    );
  }
  if (!billingUntouched) notes.push("billing fingerprint changed");
  if (after.children < DA_SILVA_EXPECTED_LEARNER_COUNT - 2) {
    notes.push(`children ${after.children} (expected ~${DA_SILVA_EXPECTED_LEARNER_COUNT})`);
  }
  if (after.boys <= 0 || after.girls <= 0) {
    notes.push(`boys/girls ${after.boys}/${after.girls}`);
  }
  if (after.preSchoolCreche > 0) {
    notes.push(`preSchoolCreche ${after.preSchoolCreche}`);
  }
  return { auditPass: notes.length === 0, auditNotes: notes };
}

export async function runDaSilvaProductionRegistrationHeal(opts: {
  schoolId: string;
  sourceDir: string;
  dataRoot?: string;
  apply: boolean;
  sourceDatabaseUrl?: string;
  sourceSchoolId?: string;
}): Promise<ProductionRegistrationHealResult> {
  const dataRoot = opts.dataRoot || opts.sourceDir;
  const applied: string[] = [];

  const dryRunBefore = await collectHealDryRunBefore(opts.schoolId, dataRoot);
  const billingBefore = await captureBillingFingerprint(opts.schoolId, dataRoot);

  let sourcePrisma: PrismaClient | null = null;
  if (opts.sourceDatabaseUrl) {
    const { PrismaClient } = await import("@prisma/client");
    sourcePrisma = new PrismaClient({
      datasources: { db: { url: opts.sourceDatabaseUrl } },
    });
  }

  const sourceSchoolId = opts.sourceSchoolId || opts.schoolId;

  try {
    if (sourcePrisma) {
      const dbHeal = await healFromSourceDatabase({
        schoolId: opts.schoolId,
        sourcePrisma,
        sourceSchoolId,
        apply: opts.apply,
      });
      if (opts.apply) {
        applied.push(
          `source-db learners=${dbHeal.learnersUpdated} parents=${dbHeal.parentsUpdated} links=${dbHeal.linksUpserted}`
        );
      } else {
        applied.push(
          `would source-db heal learners=${dbHeal.learnersUpdated} parents=${dbHeal.parentsUpdated} links=${dbHeal.linksUpserted}`
        );
      }
    } else {
      try {
        const { projectId } = resolveLatestDaSilvaStagingProject(opts.schoolId);
        const sasams = await repairDaSilvaSasamsLearners({
          schoolId: opts.schoolId,
          projectId,
          apply: opts.apply,
        });
        const parents = await repairDaSilvaSasamsParents({
          schoolId: opts.schoolId,
          projectId,
          apply: opts.apply,
        });
        const label = opts.apply ? "sasams" : "would sasams";
        applied.push(
          `${label} learners updated=${sasams.updated} parents=${parents.parentsUpdated} links=${parents.linksUpserted}`
        );
      } catch (error) {
        applied.push(
          `sasams staging skipped (${error instanceof Error ? error.message : String(error)})`
        );
      }
    }

    const crecheCount = await healCrecheLabels(opts.schoolId, opts.apply);
    applied.push(
      opts.apply
        ? `creche labels normalized (${crecheCount})`
        : `would normalize creche (${crecheCount})`
    );

    const planCount = await healBillingPlansFromSource({
      schoolId: opts.schoolId,
      sourceDir: opts.sourceDir,
      sourceSchoolId,
      sourcePrisma: sourcePrisma || undefined,
      apply: opts.apply,
    });
    applied.push(
      opts.apply
        ? `billing plans remapped (${planCount})`
        : `would remap billing plans (${planCount})`
    );
  } finally {
    if (sourcePrisma) await sourcePrisma.$disconnect();
  }

  const after = await collectHealAfterMetrics(opts.schoolId, dataRoot);
  const billingAfter = await captureBillingFingerprint(opts.schoolId, dataRoot);
  const billingUntouched = fingerprintsEqual(billingBefore, billingAfter);
  const { auditPass, auditNotes } = evaluateHealAudit(after, billingUntouched);

  return {
    mode: opts.apply ? "apply" : "dry-run",
    schoolId: opts.schoolId,
    sourceDir: opts.sourceDir,
    dataRoot,
    dryRunBefore,
    applied,
    after,
    billingBefore,
    billingAfter,
    billingUntouched,
    auditPass,
    auditNotes,
  };
}
