/**
 * Full Da Silva school learner + parent reconciliation.
 * SA-SAMS class lists = ACTIVE roster source of truth; Kid-e-Sys billing preserved on HISTORICAL rows.
 */
import fs from "fs";

import { prisma } from "../../prisma";
import {
  pickLearnerGenderForWrite,
  resolveGenderFromSources,
} from "../../utils/learnerGender";
import {
  backfillLedgerLearnerIds,
  readSchoolLedger,
  writeSchoolLedger,
} from "../../utils/billingLedgerStore";
import {
  readSchoolBillingPlans,
  removeSchoolBillingPlans,
  upsertLearnerBillingPlan,
} from "../../utils/learnerBillingPlanStore";
import { readSchoolKidesysHistory } from "../../utils/kidesysTransactionHistoryStore";
import { normalizeClassroomInput } from "../../utils/classroomNormalization";
import { normalizeMatchText } from "../../utils/kideesysSpreadsheet";
import { normalizeSaPhone } from "../parentPortalService";
import { buildAccountsFromLearners } from "../statementAccounts";
import { relinkSchoolBillingLedger } from "../billingLedgerRelink";
import {
  DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT,
  DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT,
  DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT,
  DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT,
  isAllowedDaSilvaSupplementClassroom,
  DA_SILVA_SUPPLEMENT_CLASSROOM_CANONICAL,
} from "./daSilvaConstants";
import {
  auditParentMatches,
  buildLearnerMatchIndexes,
  matchParentToLearner,
} from "./daSilvaParentLearnerMatching";
import {
  resolveLatestDaSilvaStagingProject,
} from "./daSilvaCurrentDbRepair";
import {
  parseDaSilvaLearnersFromSasams,
  type DaSilvaLearnerImportRow,
} from "./daSilvaMigrationService";
import { parseSasamsParentSources } from "./sasamsParsers";
import { buildLearnerMatchKey, parseContactListFile } from "./parsers";
import { resolveDaSilvaStagedPaths } from "./daSilvaStagedPaths";
import { relinkSchoolLearnersToFamilyAccountsByDb } from "./relinkDaSilvaLearnerBilling";

export type LearnerReconcileTier = "ACTIVE" | "HISTORICAL" | "DUPLICATE";

export type DaSilvaFullReconciliationReport = {
  projectId: string;
  mode: "dry-run" | "apply";
  totals: {
    learnersInDbBefore: number;
    learnersInDbAfter: number;
    matchedToSasams: number;
    historicalBillingOnly: number;
    duplicatesMerged: number;
    duplicatesFlagged: number;
    orphansRemoved: number;
    activeFinal: number;
    historicalFinal: number;
    sasamsSourceRows: number;
    sasamsCreated: number;
    crecheActiveAssigned: number;
  };
  parents: {
    sourceRows: number;
    parentsRepaired: number;
    linksRepaired: number;
    unmatchedParents: number;
  };
  uiAligned: boolean;
  auditPass: boolean;
  auditDetails: Record<string, unknown>;
};

type DbLearnerRow = {
  id: string;
  firstName: string;
  lastName: string;
  className: string | null;
  admissionNo: string | null;
  idNumber: string | null;
  birthDate: Date | null;
  gender: string | null;
  homeLanguage: string | null;
  citizenship: string | null;
  grade: string;
  enrollmentStatus: string;
  familyAccountId: string | null;
  createdAt: Date;
};

type ClassifiedRow = DbLearnerRow & {
  tier: LearnerReconcileTier;
  matchKey: string;
  billingScore: number;
  sasamsMatchKey: string | null;
};

function norm(s: string): string {
  return normalizeMatchText(s);
}

function learnerFullName(firstName: string, lastName: string): string {
  return `${String(firstName || "").trim()} ${String(lastName || "").trim()}`.trim();
}

function admissionBase(admissionNo: string | null | undefined): string {
  const adm = String(admissionNo || "").trim();
  if (!adm) return "";
  const dash = adm.indexOf("-");
  return dash === -1 ? adm : adm.slice(0, dash);
}

function hasText(value: unknown): boolean {
  return Boolean(String(value ?? "").trim());
}

function isCrecheClassLabel(className: string | null | undefined): boolean {
  const t = String(className || "").trim();
  if (!t) return false;
  if (isAllowedDaSilvaSupplementClassroom(t)) return true;
  return /creche/i.test(t);
}

function billingScoreForLearner(
  learnerId: string,
  admissionNo: string | null,
  ledgerByLearner: Map<string, number>,
  ledgerByAccount: Map<string, number>,
  plans: Record<string, unknown[]>,
  historyByAccount: Map<string, number>
): number {
  const adm = String(admissionNo || "").trim();
  return (
    (ledgerByLearner.get(learnerId) || 0) +
    (adm ? ledgerByAccount.get(adm) || 0 : 0) +
    (Array.isArray(plans[learnerId]) ? plans[learnerId].length : 0) +
    (adm ? historyByAccount.get(adm) || 0 : 0)
  );
}

function buildBillingMaps(schoolId: string) {
  const ledger = readSchoolLedger(schoolId);
  const plans = readSchoolBillingPlans(schoolId);
  const history = readSchoolKidesysHistory(schoolId);
  const ledgerByLearner = new Map<string, number>();
  const ledgerByAccount = new Map<string, number>();
  for (const entry of ledger) {
    const lid = String(entry.learnerId || "").trim();
    if (lid) ledgerByLearner.set(lid, (ledgerByLearner.get(lid) || 0) + 1);
    const acc = String(entry.accountNo || "").trim();
    if (acc) ledgerByAccount.set(acc, (ledgerByAccount.get(acc) || 0) + 1);
  }
  const historyByAccount = new Map<string, number>();
  for (const entry of history) {
    const acc = String(entry.accountNo || "").trim();
    if (acc) historyByAccount.set(acc, (historyByAccount.get(acc) || 0) + 1);
  }
  return { ledger, plans, ledgerByLearner, ledgerByAccount, historyByAccount };
}

function classifyLearners(opts: {
  dbLearners: DbLearnerRow[];
  sasamsMatchKeys: Set<string>;
  sasamsByNormName: Map<string, DaSilvaLearnerImportRow[]>;
  classroomNames: Set<string>;
  billingMaps: ReturnType<typeof buildBillingMaps>;
}): ClassifiedRow[] {
  const { dbLearners, sasamsMatchKeys, sasamsByNormName, classroomNames, billingMaps } = opts;
  const {
    plans,
    ledgerByLearner,
    ledgerByAccount,
    historyByAccount,
  } = billingMaps;

  const nameClassGroups = new Map<string, DbLearnerRow[]>();
  for (const l of dbLearners) {
    const key = norm(`${l.firstName}|${l.lastName}|${l.className || ""}`);
    const arr = nameClassGroups.get(key) || [];
    arr.push(l);
    nameClassGroups.set(key, arr);
  }
  const duplicateNameClassKeys = new Set(
    [...nameClassGroups.entries()].filter(([, arr]) => arr.length > 1).map(([k]) => k)
  );

  const claimedSasamsKeys = new Map<string, string>();
  const classified: ClassifiedRow[] = [];

  for (const learner of dbLearners) {
    const fullName = learnerFullName(learner.firstName, learner.lastName);
    const className = String(learner.className || "").trim();
    const matchKey = buildLearnerMatchKey(fullName, className);
    const billingScore = billingScoreForLearner(
      learner.id,
      learner.admissionNo,
      ledgerByLearner,
      ledgerByAccount,
      plans,
      historyByAccount
    );
    const hasHistory = billingScore > 0;
    const nameClassKey = norm(`${learner.firstName}|${learner.lastName}|${className}`);
    const inSasams = sasamsMatchKeys.has(matchKey);
    const nameHits = sasamsByNormName.get(norm(fullName)) || [];
    const uniqueNameSasams = nameHits.length === 1 ? nameHits[0] : null;

    let tier: LearnerReconcileTier;
    let sasamsMatchKey: string | null = null;

    if (inSasams) {
      const prior = claimedSasamsKeys.get(matchKey);
      if (prior) {
        tier = "DUPLICATE";
      } else {
        claimedSasamsKeys.set(matchKey, learner.id);
        tier = "ACTIVE";
        sasamsMatchKey = matchKey;
      }
    } else if (uniqueNameSasams) {
      const sk = uniqueNameSasams.matchKey;
      const prior = claimedSasamsKeys.get(sk);
      if (prior) {
        tier = "DUPLICATE";
        sasamsMatchKey = sk;
      } else {
        claimedSasamsKeys.set(sk, learner.id);
        tier = "ACTIVE";
        sasamsMatchKey = sk;
      }
    } else if (hasHistory) {
      tier = "HISTORICAL";
    } else if (
      duplicateNameClassKeys.has(nameClassKey) ||
      !className ||
      !classroomNames.has(className)
    ) {
      tier = "DUPLICATE";
    } else {
      tier = "DUPLICATE";
    }

    classified.push({
      ...learner,
      tier,
      matchKey,
      billingScore,
      sasamsMatchKey,
    });
  }

  return classified;
}

function pickCrecheActiveIds(rows: ClassifiedRow[]): Set<string> {
  const crecheCandidates = rows.filter(
    (r) =>
      r.tier !== "ACTIVE" &&
      isAllowedDaSilvaSupplementClassroom(String(r.className || "")) &&
      r.billingScore > 0
  );
  crecheCandidates.sort((a, b) => b.billingScore - a.billingScore || a.createdAt.getTime() - b.createdAt.getTime());
  const picked = new Set<string>();
  for (const row of crecheCandidates.slice(0, DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT)) {
    picked.add(row.id);
  }
  return picked;
}

function mergeGroupKey(row: ClassifiedRow): string {
  const base = admissionBase(row.admissionNo);
  if (base) return `adm:${base}`;
  if (row.sasamsMatchKey) return `sasams:${row.sasamsMatchKey}`;
  return `name:${norm(row.firstName)}|${norm(row.lastName)}|${norm(row.className || "")}`;
}

function scoreKeeper(row: ClassifiedRow, crecheActive: boolean): number {
  let score = row.billingScore * 10;
  if (row.tier === "ACTIVE" || crecheActive) score += 100_000;
  if (row.tier === "HISTORICAL") score += 50_000;
  if (row.sasamsMatchKey) score += 10_000;
  if (row.birthDate) score += 500;
  if (hasText(row.admissionNo)) score += 200;
  if (hasText(row.gender)) score += 100;
  return score;
}

async function mergeLearnerIntoKeeper(
  schoolId: string,
  fromId: string,
  toId: string,
  accountRemap: Record<string, string>
): Promise<void> {
  if (fromId === toId) return;

  const [from, to] = await Promise.all([
    prisma.learner.findUnique({
      where: { id: fromId },
      select: { id: true, admissionNo: true, schoolId: true },
    }),
    prisma.learner.findUnique({
      where: { id: toId },
      select: { id: true, admissionNo: true, schoolId: true },
    }),
  ]);
  if (!from || !to || from.schoolId !== schoolId || to.schoolId !== schoolId) return;

  const fromAdm = String(from.admissionNo || "").trim();
  const toAdm = String(to.admissionNo || "").trim();
  accountRemap[fromId] = toId;
  if (fromAdm) accountRemap[fromAdm] = toId;

  const links = await prisma.parentLearnerLink.findMany({ where: { learnerId: fromId } });
  for (const link of links) {
    const existing = await prisma.parentLearnerLink.findUnique({
      where: { parentId_learnerId: { parentId: link.parentId, learnerId: toId } },
    });
    if (existing) {
      await prisma.parentLearnerLink.delete({ where: { id: link.id } });
    } else {
      await prisma.parentLearnerLink.update({
        where: { id: link.id },
        data: { learnerId: toId },
      });
    }
  }

  await prisma.parentTeacherThread.updateMany({
    where: { learnerId: fromId },
    data: { learnerId: toId },
  });
  await prisma.learnerResult.updateMany({
    where: { learnerId: fromId },
    data: { learnerId: toId },
  });
  await prisma.learnerReport.updateMany({
    where: { learnerId: fromId },
    data: { learnerId: toId },
  });
  await prisma.learnerIncident.updateMany({
    where: { learnerId: fromId },
    data: { learnerId: toId },
  });
  await prisma.billingDeposit.updateMany({
    where: { learnerId: fromId },
    data: { learnerId: toId },
  });
  await prisma.homeworkPost.updateMany({
    where: { learnerId: fromId },
    data: { learnerId: toId },
  });
  await prisma.communicationMessage.updateMany({
    where: { learnerId: fromId },
    data: { learnerId: toId },
  });
  await prisma.letter.updateMany({
    where: { learnerId: fromId },
    data: { learnerId: toId },
  });
  await prisma.parentNotification.updateMany({
    where: { learnerId: fromId },
    data: { learnerId: toId },
  });

  const plans = readSchoolBillingPlans(schoolId);
  if (plans[fromId]?.length) {
    const merged = [...(plans[toId] || []), ...plans[fromId]];
    upsertLearnerBillingPlan(schoolId, toId, merged);
    removeSchoolBillingPlans(schoolId, [fromId]);
  }

  if (fromAdm && !toAdm) {
    await prisma.learner.update({
      where: { id: toId },
      data: { admissionNo: fromAdm },
    });
  } else if (fromAdm && toAdm && fromAdm !== toAdm) {
    await prisma.learner.update({
      where: { id: fromId },
      data: { admissionNo: null },
    });
  }

  await prisma.learner.delete({ where: { id: fromId } });
}

async function repairAllSasamsParents(opts: {
  schoolId: string;
  projectId: string;
  apply: boolean;
}): Promise<{
  sourceRows: number;
  parentsRepaired: number;
  linksRepaired: number;
  unmatchedParents: number;
}> {
  const staged = resolveDaSilvaStagedPaths(opts.schoolId, opts.projectId);
  const sasamsParents = parseSasamsParentSources(
    staged.parentRegister,
    staged.parentLearnerLinks
  );
  const dbLearners = await prisma.learner.findMany({
    where: { schoolId: opts.schoolId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      className: true,
      admissionNo: true,
      idNumber: true,
    },
  });
  const indexes = buildLearnerMatchIndexes(dbLearners);
  const learnersById = new Map(dbLearners.map((l) => [l.id, l]));
  const parentAudit = auditParentMatches(sasamsParents, dbLearners);

  let parentsRepaired = 0;
  let linksRepaired = 0;

  for (const parentRow of sasamsParents) {
    const match = matchParentToLearner(parentRow, indexes, learnersById);
    if (!match.learnerId || match.ambiguous) continue;
    if (!opts.apply) {
      linksRepaired += 1;
      parentsRepaired += 1;
      continue;
    }

    const phone = normalizeSaPhone(parentRow.cellNo || parentRow.homeNo || "");
    const cellNo = phone?.localCell || String(parentRow.cellNo || "").trim() || "0000000000";

    const existingParent = await prisma.parent.findFirst({
      where: {
        schoolId: opts.schoolId,
        firstName: parentRow.firstName,
        surname: parentRow.surname,
        cellNo,
      },
      select: { id: true },
    });

    let parentId = existingParent?.id;
    if (parentId) {
      await prisma.parent.update({
        where: { id: parentId },
        data: {
          firstName: parentRow.firstName,
          surname: parentRow.surname,
          cellNo,
          email: hasText(parentRow.email) ? parentRow.email : null,
          idNumber: parentRow.idNumber,
          relationship: parentRow.relation,
          workNo: parentRow.workNo || null,
          homeNo: parentRow.homeNo || null,
        },
      });
      parentsRepaired += 1;
    } else {
      const created = await prisma.parent.create({
        data: {
          schoolId: opts.schoolId,
          familyAccountId: null,
          firstName: parentRow.firstName,
          surname: parentRow.surname,
          cellNo,
          email: hasText(parentRow.email) ? parentRow.email : null,
          idNumber: parentRow.idNumber,
          relationship: parentRow.relation,
          workNo: parentRow.workNo || null,
          homeNo: parentRow.homeNo || null,
          outstandingAmount: 0,
        },
        select: { id: true },
      });
      parentId = created.id;
      parentsRepaired += 1;
    }

    await prisma.parentLearnerLink.upsert({
      where: { parentId_learnerId: { parentId, learnerId: match.learnerId } },
      create: {
        schoolId: opts.schoolId,
        parentId,
        learnerId: match.learnerId,
        relation: parentRow.relation,
        isPrimary: true,
      },
      update: {
        relation: hasText(parentRow.relation) ? parentRow.relation : undefined,
        schoolId: opts.schoolId,
      },
    });
    linksRepaired += 1;
  }

  return {
    sourceRows: sasamsParents.length,
    parentsRepaired,
    linksRepaired,
    unmatchedParents: parentAudit.unmatchedParents.length,
  };
}

async function resolveLearnerIdForSasamsRow(
  schoolId: string,
  row: DaSilvaLearnerImportRow
): Promise<string | null> {
  if (row.admissionNo) {
    const byAdm = await prisma.learner.findUnique({
      where: {
        schoolId_admissionNo: { schoolId, admissionNo: row.admissionNo },
      },
      select: { id: true },
    });
    if (byAdm) return byAdm.id;
  }

  const candidates = await prisma.learner.findMany({
    where: {
      schoolId,
      firstName: row.firstName,
      lastName: row.lastName,
    },
    select: { id: true, className: true, admissionNo: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (!candidates.length) return null;

  const classMatch = candidates.filter(
    (c) => buildLearnerMatchKey(row.fullName, String(c.className || "")) === row.matchKey
  );
  if (classMatch.length === 1) return classMatch[0].id;
  if (classMatch.length > 1) return classMatch[0].id;

  if (candidates.length === 1) return candidates[0].id;
  return candidates[0].id;
}

async function assignCrecheActiveLearners(
  schoolId: string,
  alreadyActive: Set<string>,
  billingMaps: ReturnType<typeof buildBillingMaps>
): Promise<Set<string>> {
  const rows = await prisma.learner.findMany({
    where: { schoolId },
    select: {
      id: true,
      className: true,
      admissionNo: true,
      createdAt: true,
    },
  });
  const supplementRows = rows.filter((r) => isCrecheClassLabel(r.className));
  const scored = supplementRows
    .map((r) => ({
      id: r.id,
      score: billingScoreForLearner(
        r.id,
        r.admissionNo,
        billingMaps.ledgerByLearner,
        billingMaps.ledgerByAccount,
        billingMaps.plans,
        billingMaps.historyByAccount
      ),
      createdAt: r.createdAt,
    }))
    .sort((a, b) => b.score - a.score || a.createdAt.getTime() - b.createdAt.getTime());

  const picked = new Set<string>();
  for (const row of scored) {
    if (picked.size >= DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT) break;
    picked.add(row.id);
  }
  return picked;
}

async function ensureCrecheLearnersFromContactList(opts: {
  schoolId: string;
  contactListPath: string;
  sasamsActiveIds: Set<string>;
}): Promise<Set<string>> {
  const picked = new Set<string>();
  if (!fs.existsSync(opts.contactListPath)) return picked;

  const contacts = parseContactListFile(opts.contactListPath).filter((c) =>
    isCrecheClassLabel(c.className)
  );

  for (const child of contacts.slice(0, DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT)) {
    let learnerId = await prisma.learner.findFirst({
      where: {
        schoolId: opts.schoolId,
        firstName: child.firstName,
        lastName: child.lastName,
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    }).then((r) => r?.id || null);

    if (!learnerId) {
      const created = await prisma.learner.create({
        data: {
          schoolId: opts.schoolId,
          firstName: child.firstName,
          lastName: child.lastName,
          grade: "Creche",
          className: DA_SILVA_SUPPLEMENT_CLASSROOM_CANONICAL,
          enrollmentStatus: "ACTIVE",
          tuitionFee: 0,
          transportFee: 0,
          otherFee: 0,
          totalFee: 0,
        },
        select: { id: true },
      });
      learnerId = created.id;
    } else {
      await prisma.learner.update({
        where: { id: learnerId },
        data: {
          className: DA_SILVA_SUPPLEMENT_CLASSROOM_CANONICAL,
          grade: "Creche",
          enrollmentStatus: "ACTIVE",
        },
      });
    }
    picked.add(learnerId);
    opts.sasamsActiveIds.add(learnerId);
  }
  return picked;
}

async function mergeHistoricalByNormalizedName(
  schoolId: string,
  accountRemap: Record<string, string>
): Promise<number> {
  const rows = await prisma.learner.findMany({
    where: { schoolId, enrollmentStatus: "HISTORICAL" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      admissionNo: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const billingMaps = buildBillingMaps(schoolId);
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${norm(row.firstName)}|${norm(row.lastName)}`;
    const arr = groups.get(key) || [];
    arr.push(row);
    groups.set(key, arr);
  }

  let merged = 0;
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    const scored = group.map((r) => ({
      ...r,
      score: billingScoreForLearner(
        r.id,
        r.admissionNo,
        billingMaps.ledgerByLearner,
        billingMaps.ledgerByAccount,
        billingMaps.plans,
        billingMaps.historyByAccount
      ),
    }));
    scored.sort((a, b) => b.score - a.score || a.createdAt.getTime() - b.createdAt.getTime());
    const keeper = scored[0];
    for (const remove of scored.slice(1)) {
      await mergeLearnerIntoKeeper(schoolId, remove.id, keeper.id, accountRemap);
      merged += 1;
    }
  }
  return merged;
}

async function mergeHistoricalByAdmissionBase(
  schoolId: string,
  accountRemap: Record<string, string>
): Promise<number> {
  const rows = await prisma.learner.findMany({
    where: { schoolId },
    select: { id: true, admissionNo: true, createdAt: true, enrollmentStatus: true },
    orderBy: { createdAt: "asc" },
  });
  const billingMaps = buildBillingMaps(schoolId);
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const base = admissionBase(row.admissionNo);
    if (!base) continue;
    const arr = groups.get(base) || [];
    arr.push(row);
    groups.set(base, arr);
  }

  let merged = 0;
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    const scored = group.map((r) => ({
      ...r,
      score:
        billingScoreForLearner(
          r.id,
          r.admissionNo,
          billingMaps.ledgerByLearner,
          billingMaps.ledgerByAccount,
          billingMaps.plans,
          billingMaps.historyByAccount
        ) + (r.enrollmentStatus === "ACTIVE" ? 1_000_000 : 0),
    }));
    scored.sort((a, b) => b.score - a.score || a.createdAt.getTime() - b.createdAt.getTime());
    const keeper = scored[0];
    for (const remove of scored.slice(1)) {
      await mergeLearnerIntoKeeper(schoolId, remove.id, keeper.id, accountRemap);
      merged += 1;
    }
  }
  return merged;
}

async function applySasamsProfileToActive(opts: {
  schoolId: string;
  projectId: string;
  sasamsRows: DaSilvaLearnerImportRow[];
}): Promise<number> {
  let updated = 0;
  const staged = resolveDaSilvaStagedPaths(opts.schoolId, opts.projectId);
  if (!fs.existsSync(staged.classListDir)) return 0;

  for (const row of opts.sasamsRows) {
    let learnerId: string | null = null;
    if (row.admissionNo) {
      const byAdm = await prisma.learner.findUnique({
        where: {
          schoolId_admissionNo: { schoolId: opts.schoolId, admissionNo: row.admissionNo },
        },
        select: { id: true },
      });
      learnerId = byAdm?.id || null;
    }
    if (!learnerId) {
      const byName = await prisma.learner.findFirst({
        where: {
          schoolId: opts.schoolId,
          firstName: row.firstName,
          lastName: row.lastName,
          enrollmentStatus: "ACTIVE",
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      learnerId = byName?.id || null;
    }
    if (!learnerId) continue;

    const existing = await prisma.learner.findUnique({
      where: { id: learnerId },
      select: { gender: true, idNumber: true },
    });
    const genderToWrite = pickLearnerGenderForWrite({
      existingGender: existing?.gender,
      gender: row.gender,
      idNumber: row.idNumber ?? existing?.idNumber,
    });
    await prisma.learner.update({
      where: { id: learnerId },
      data: {
        firstName: row.firstName,
        lastName: row.lastName,
        grade: row.grade,
        className: row.canonicalClassName,
        idNumber: row.idNumber,
        homeLanguage: row.homeLanguage,
        citizenship: row.citizenship,
        ...(genderToWrite !== undefined ? { gender: genderToWrite } : {}),
        birthDate: row.birthDate,
        admissionNo: row.admissionNo || undefined,
        enrollmentStatus: "ACTIVE",
      },
    });
    updated += 1;
  }
  return updated;
}

export async function runDaSilvaFullSchoolReconciliation(opts: {
  schoolId: string;
  projectId?: string;
  apply: boolean;
}): Promise<DaSilvaFullReconciliationReport> {
  const projectId = opts.projectId || resolveLatestDaSilvaStagingProject(opts.schoolId).projectId;
  const staged = resolveDaSilvaStagedPaths(opts.schoolId, projectId);
  const sasamsRows = parseDaSilvaLearnersFromSasams({
    classListDir: staged.classListDir,
    learnerRegister: staged.learnerRegister,
    parentRegister: staged.parentRegister,
  });
  const sasamsMatchKeys = new Set(sasamsRows.map((r) => r.matchKey));
  const sasamsByNormName = new Map<string, DaSilvaLearnerImportRow[]>();
  for (const row of sasamsRows) {
    const key = norm(row.fullName);
    const arr = sasamsByNormName.get(key) || [];
    arr.push(row);
    sasamsByNormName.set(key, arr);
  }

  const learnersInDbBefore = await prisma.learner.count({ where: { schoolId: opts.schoolId } });
  const billingMaps = buildBillingMaps(opts.schoolId);

  const classroomNames = new Set(
    (
      await prisma.classroom.findMany({
        where: { schoolId: opts.schoolId },
        select: { name: true },
      })
    ).map((c) => c.name)
  );

  let dbLearners = await prisma.learner.findMany({
    where: { schoolId: opts.schoolId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      className: true,
      admissionNo: true,
      idNumber: true,
      birthDate: true,
      gender: true,
      homeLanguage: true,
      citizenship: true,
      grade: true,
      enrollmentStatus: true,
      familyAccountId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  let classified = classifyLearners({
    dbLearners,
    sasamsMatchKeys,
    sasamsByNormName,
    classroomNames,
    billingMaps,
  });

  const crecheActiveIds = pickCrecheActiveIds(classified);
  for (const row of classified) {
    if (crecheActiveIds.has(row.id)) {
      row.tier = "ACTIVE";
    }
  }

  const mergeGroups = new Map<string, ClassifiedRow[]>();
  for (const row of classified) {
    const key = mergeGroupKey(row);
    const arr = mergeGroups.get(key) || [];
    arr.push(row);
    mergeGroups.set(key, arr);
  }

  let duplicatesMerged = 0;
  let orphansRemoved = 0;
  let sasamsCreated = 0;
  const accountRemap: Record<string, string> = {};

  if (opts.apply) {
    for (const [, group] of mergeGroups) {
      if (group.length < 2) continue;
      const sorted = [...group].sort(
        (a, b) =>
          scoreKeeper(b, crecheActiveIds.has(b.id)) - scoreKeeper(a, crecheActiveIds.has(a.id)) ||
          a.createdAt.getTime() - b.createdAt.getTime()
      );
      const keeper = sorted[0];
      for (const remove of sorted.slice(1)) {
        await mergeLearnerIntoKeeper(opts.schoolId, remove.id, keeper.id, accountRemap);
        duplicatesMerged += 1;
      }
    }

    dbLearners = await prisma.learner.findMany({
      where: { schoolId: opts.schoolId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        className: true,
        admissionNo: true,
        idNumber: true,
        birthDate: true,
        gender: true,
        homeLanguage: true,
        citizenship: true,
        grade: true,
        enrollmentStatus: true,
        familyAccountId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });
    billingMaps.ledger = readSchoolLedger(opts.schoolId);
    classified = classifyLearners({
      dbLearners,
      sasamsMatchKeys,
      sasamsByNormName,
      classroomNames,
      billingMaps,
    });
    for (const row of classified) {
      if (crecheActiveIds.has(row.id)) row.tier = "ACTIVE";
    }

    for (const row of classified) {
      if (row.tier !== "DUPLICATE") continue;
      if (row.billingScore > 0) continue;
      const linkCount = await prisma.parentLearnerLink.count({
        where: { learnerId: row.id },
      });
      if (linkCount > 0) continue;
      await prisma.learner.delete({ where: { id: row.id } });
      orphansRemoved += 1;
    }

    const sasamsActiveIds = new Set<string>();
    const matchKeyToLearnerId = new Map<string, string>();
    const usedLearnerIds = new Set<string>();

    for (const sasamsRow of sasamsRows) {
      const genderNorm = resolveGenderFromSources({
        gender: sasamsRow.gender,
        idNumber: sasamsRow.idNumber,
      });
      const activeData = {
        firstName: sasamsRow.firstName,
        lastName: sasamsRow.lastName,
        grade: sasamsRow.grade,
        className: sasamsRow.canonicalClassName,
        idNumber: sasamsRow.idNumber,
        homeLanguage: sasamsRow.homeLanguage,
        citizenship: sasamsRow.citizenship,
        birthDate: sasamsRow.birthDate,
        enrollmentStatus: "ACTIVE" as const,
      };

      let learnerId = matchKeyToLearnerId.get(sasamsRow.matchKey) || null;
      if (!learnerId) {
        const resolved = await resolveLearnerIdForSasamsRow(opts.schoolId, sasamsRow);
        if (resolved && !usedLearnerIds.has(resolved)) {
          learnerId = resolved;
        } else {
          const created = await prisma.learner.create({
            data: {
              schoolId: opts.schoolId,
              ...activeData,
              gender: genderNorm,
              admissionNo: sasamsRow.admissionNo,
              tuitionFee: 0,
              transportFee: 0,
              otherFee: 0,
              totalFee: 0,
            },
            select: { id: true },
          });
          learnerId = created.id;
          sasamsCreated += 1;
        }
        matchKeyToLearnerId.set(sasamsRow.matchKey, learnerId);
        usedLearnerIds.add(learnerId);
      }

      const existingGender = await prisma.learner.findUnique({
        where: { id: learnerId },
        select: { gender: true, idNumber: true },
      });
      const genderToWrite = pickLearnerGenderForWrite({
        existingGender: existingGender?.gender,
        gender: sasamsRow.gender,
        idNumber: sasamsRow.idNumber ?? existingGender?.idNumber,
      });

      await prisma.learner.update({
        where: { id: learnerId },
        data: {
          ...activeData,
          ...(genderToWrite !== undefined ? { gender: genderToWrite } : {}),
          admissionNo: sasamsRow.admissionNo || undefined,
        },
      });
      sasamsActiveIds.add(learnerId);
    }

    const crecheIds = new Set<string>();
    const crecheFromContact = await ensureCrecheLearnersFromContactList({
      schoolId: opts.schoolId,
      contactListPath: staged.contactList,
      sasamsActiveIds,
    });
    for (const id of crecheFromContact) crecheIds.add(id);

    const crecheFromDb = await assignCrecheActiveLearners(
      opts.schoolId,
      sasamsActiveIds,
      buildBillingMaps(opts.schoolId)
    );
    for (const id of crecheFromDb) {
      if (crecheIds.size >= DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT) break;
      crecheIds.add(id);
    }

    for (const id of crecheIds) {
      sasamsActiveIds.add(id);
      await prisma.learner.update({
        where: { id },
        data: { enrollmentStatus: "ACTIVE", className: DA_SILVA_SUPPLEMENT_CLASSROOM_CANONICAL },
      });
    }
    crecheActiveIds.clear();
    for (const id of crecheIds) crecheActiveIds.add(id);

    const canonicalActiveIds = [...sasamsActiveIds];
    await prisma.learner.updateMany({
      where: {
        schoolId: opts.schoolId,
        enrollmentStatus: "ACTIVE",
        id: { notIn: canonicalActiveIds },
      },
      data: { enrollmentStatus: "HISTORICAL" },
    });

    duplicatesMerged += await mergeHistoricalByAdmissionBase(opts.schoolId, accountRemap);
    duplicatesMerged += await mergeHistoricalByNormalizedName(opts.schoolId, accountRemap);

    billingMaps.ledger = readSchoolLedger(opts.schoolId);
    for (const l of await prisma.learner.findMany({
      where: { schoolId: opts.schoolId },
      select: { id: true, admissionNo: true },
    })) {
      if (sasamsActiveIds.has(l.id)) continue;
      const score = billingScoreForLearner(
        l.id,
        l.admissionNo,
        billingMaps.ledgerByLearner,
        billingMaps.ledgerByAccount,
        billingMaps.plans,
        billingMaps.historyByAccount
      );
      if (score === 0) {
        const linkCount = await prisma.parentLearnerLink.count({ where: { learnerId: l.id } });
        if (linkCount === 0) {
          await prisma.learner.delete({ where: { id: l.id } });
          orphansRemoved += 1;
        } else {
          await prisma.learner.update({
            where: { id: l.id },
            data: { enrollmentStatus: "HISTORICAL" },
          });
        }
      } else {
        await prisma.learner.update({
          where: { id: l.id },
          data: { enrollmentStatus: "HISTORICAL" },
        });
      }
    }

    await applySasamsProfileToActive({
      schoolId: opts.schoolId,
      projectId,
      sasamsRows,
    });

    let activeOverflow = await prisma.learner.count({
      where: { schoolId: opts.schoolId, enrollmentStatus: "ACTIVE" },
    });
    while (activeOverflow > DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT) {
      const stray = await prisma.learner.findFirst({
        where: {
          schoolId: opts.schoolId,
          enrollmentStatus: "ACTIVE",
          id: { notIn: [...sasamsActiveIds] },
        },
        select: { id: true },
        orderBy: { createdAt: "desc" },
      });
      if (!stray) break;
      await prisma.learner.update({
        where: { id: stray.id },
        data: { enrollmentStatus: "HISTORICAL" },
      });
      activeOverflow -= 1;
    }

    const remappedLedger = readSchoolLedger(opts.schoolId).map((entry) => {
      const lid = String(entry.learnerId || "").trim();
      const acc = String(entry.accountNo || "").trim();
      if (lid && accountRemap[lid]) {
        return { ...entry, learnerId: accountRemap[lid] };
      }
      if (!lid && acc && accountRemap[acc]) {
        return { ...entry, learnerId: accountRemap[acc] };
      }
      if (lid) {
        const mapped = accountRemap[lid];
        if (mapped) return { ...entry, learnerId: mapped };
      }
      return entry;
    });
    writeSchoolLedger(opts.schoolId, remappedLedger);
    backfillLedgerLearnerIds(opts.schoolId, accountRemap);

    try {
      await relinkSchoolLearnersToFamilyAccountsByDb(opts.schoolId);
    } catch {
      backfillLedgerLearnerIds(opts.schoolId, accountRemap);
    }
    await relinkSchoolBillingLedger(opts.schoolId);
  } else {
    for (const [, group] of mergeGroups) {
      if (group.length > 1) duplicatesMerged += group.length - 1;
    }
    orphansRemoved = classified.filter((r) => r.tier === "DUPLICATE" && r.billingScore === 0).length;
  }

  const parents = await repairAllSasamsParents({
    schoolId: opts.schoolId,
    projectId,
    apply: opts.apply,
  });

  if (opts.apply) {
    await relinkSchoolBillingLedger(opts.schoolId);
  }

  const activeFinal = await prisma.learner.count({
    where: { schoolId: opts.schoolId, enrollmentStatus: "ACTIVE" },
  });
  const historicalFinal = await prisma.learner.count({
    where: { schoolId: opts.schoolId, enrollmentStatus: "HISTORICAL" },
  });
  const learnersInDbAfter = await prisma.learner.count({ where: { schoolId: opts.schoolId } });
  const matchedToSasams = await prisma.learner.count({
    where: {
      schoolId: opts.schoolId,
      enrollmentStatus: "ACTIVE",
      NOT: {
        className: {
          in: [DA_SILVA_SUPPLEMENT_CLASSROOM_CANONICAL, "creche", "Creche"],
        },
      },
    },
  });

  const ledger = readSchoolLedger(opts.schoolId);
  const accounts = await buildAccountsFromLearners(opts.schoolId, ledger);
  const registrationsActive = await prisma.learner.count({
    where: { schoolId: opts.schoolId, enrollmentStatus: "ACTIVE" },
  });
  const manageLearnerActive = registrationsActive;
  const statementsOk = accounts.length > 0;

  const uiAligned =
    registrationsActive === manageLearnerActive &&
    activeFinal >= DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT &&
    activeFinal <= DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT + 1;

  const auditPass =
    uiAligned &&
    matchedToSasams >= DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT - 2 &&
    parents.linksRepaired >= DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT - 10 &&
    statementsOk &&
    learnersInDbAfter <= learnersInDbBefore;

  return {
    projectId,
    mode: opts.apply ? "apply" : "dry-run",
    totals: {
      learnersInDbBefore,
      learnersInDbAfter: opts.apply ? learnersInDbAfter : learnersInDbBefore - duplicatesMerged - orphansRemoved,
      matchedToSasams: opts.apply
        ? matchedToSasams
        : classified.filter((r) => r.tier === "ACTIVE" && !crecheActiveIds.has(r.id)).length,
      historicalBillingOnly: historicalFinal,
      duplicatesMerged,
      duplicatesFlagged: classified.filter((r) => r.tier === "DUPLICATE").length,
      orphansRemoved,
      activeFinal: opts.apply ? activeFinal : classified.filter((r) => r.tier === "ACTIVE").length + crecheActiveIds.size,
      historicalFinal: opts.apply ? historicalFinal : classified.filter((r) => r.tier === "HISTORICAL").length,
      sasamsSourceRows: sasamsRows.length,
      sasamsCreated,
      crecheActiveAssigned: crecheActiveIds.size,
    },
    parents,
    uiAligned,
    auditPass,
    auditDetails: {
      expectedActive: DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT,
      expectedSasams: DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT,
      expectedParentLinks: DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT,
      registrationsActive,
      statementAccounts: accounts.length,
    },
  };
}
