import { prisma } from "../prisma";
import {
  isDaSilvaSchoolId,
  refreshDaSilvaSchoolIdCache,
} from "./daSilvaSchoolResolve";
import {
  readSchoolBillingPlans as readSchoolBillingPlansFromJson,
  type StoredBillingPlanItem,
} from "../utils/learnerBillingPlanStore";

const UPSERT_BATCH_SIZE = 10;

function normalizeItems(items: StoredBillingPlanItem[]): StoredBillingPlanItem[] {
  return items
    .map((item) => ({
      feeDescription: String(item.feeDescription || "").trim(),
      amount: Number(item.amount) || 0,
    }))
    .filter((item) => item.feeDescription);
}

function groupLinesByLearner(
  lines: Array<{
    learnerId: string;
    feeDescription: string;
    amount: number;
    sortOrder: number;
  }>
): Record<string, StoredBillingPlanItem[]> {
  const grouped: Record<string, StoredBillingPlanItem[]> = {};
  for (const line of lines) {
    if (!grouped[line.learnerId]) grouped[line.learnerId] = [];
    grouped[line.learnerId].push({
      feeDescription: line.feeDescription,
      amount: line.amount,
    });
  }
  return grouped;
}

export async function readLearnerBillingPlanFromDb(
  schoolId: string,
  learnerId: string
): Promise<StoredBillingPlanItem[]> {
  const schoolKey = String(schoolId || "").trim();
  const learnerKey = String(learnerId || "").trim();
  if (!schoolKey || !learnerKey) return [];

  const lines = await prisma.learnerBillingPlanLine.findMany({
    where: { schoolId: schoolKey, learnerId: learnerKey },
    orderBy: [{ sortOrder: "asc" }],
    select: {
      feeDescription: true,
      amount: true,
    },
  });

  return normalizeItems(
    lines.map((line) => ({
      feeDescription: line.feeDescription,
      amount: line.amount,
    }))
  );
}

export async function readSchoolBillingPlansFromDb(
  schoolId: string
): Promise<Record<string, StoredBillingPlanItem[]>> {
  const key = String(schoolId || "").trim();
  if (!key) return {};

  const lines = await prisma.learnerBillingPlanLine.findMany({
    where: { schoolId: key },
    orderBy: [{ learnerId: "asc" }, { sortOrder: "asc" }],
    select: {
      learnerId: true,
      feeDescription: true,
      amount: true,
      sortOrder: true,
    },
  });

  return groupLinesByLearner(lines);
}

export async function countSchoolBillingPlansInDb(schoolId: string): Promise<number> {
  const key = String(schoolId || "").trim();
  if (!key) return 0;

  const rows = await prisma.learnerBillingPlanLine.groupBy({
    by: ["learnerId"],
    where: { schoolId: key },
  });
  return rows.length;
}

export async function upsertLearnerBillingPlanToDb(
  schoolId: string,
  learnerId: string,
  items: StoredBillingPlanItem[]
): Promise<void> {
  const schoolKey = String(schoolId || "").trim();
  const learnerKey = String(learnerId || "").trim();
  if (!schoolKey || !learnerKey) return;

  const normalized = normalizeItems(items);
  await prisma.learnerBillingPlanLine.deleteMany({
    where: { schoolId: schoolKey, learnerId: learnerKey },
  });
  if (!normalized.length) return;

  await prisma.learnerBillingPlanLine.createMany({
    data: normalized.map((item, sortOrder) => ({
      schoolId: schoolKey,
      learnerId: learnerKey,
      feeDescription: item.feeDescription,
      amount: item.amount,
      sortOrder,
    })),
  });
}

export async function removeLearnerBillingPlanFromDb(
  schoolId: string,
  learnerId: string
): Promise<void> {
  const schoolKey = String(schoolId || "").trim();
  const learnerKey = String(learnerId || "").trim();
  if (!schoolKey || !learnerKey) return;

  await prisma.learnerBillingPlanLine.deleteMany({
    where: { schoolId: schoolKey, learnerId: learnerKey },
  });
}

async function resolvedSchoolIdsForBillingPlanReads(schoolId: string): Promise<string[]> {
  const key = String(schoolId || "").trim();
  if (!key) return [];
  if (isDaSilvaSchoolId(key)) {
    return refreshDaSilvaSchoolIdCache();
  }
  return [key];
}

/** Learners who explicitly removed all plan lines; blocks orphan/admissionNo fallback. */
export async function readExplicitlyEmptyBillingPlanLearnerIds(
  schoolId: string
): Promise<Set<string>> {
  const schoolIds = await resolvedSchoolIdsForBillingPlanReads(schoolId);
  if (!schoolIds.length) return new Set();

  const rows = await prisma.learnerBillingPlanCleared.findMany({
    where: { schoolId: { in: schoolIds } },
    select: { learnerId: true },
  });

  return new Set(rows.map((row) => row.learnerId));
}

export async function markLearnerBillingPlanExplicitlyEmpty(
  schoolId: string,
  learnerId: string
): Promise<void> {
  const schoolKey = String(schoolId || "").trim();
  const learnerKey = String(learnerId || "").trim();
  if (!schoolKey || !learnerKey) return;

  await prisma.learnerBillingPlanCleared.upsert({
    where: {
      schoolId_learnerId: {
        schoolId: schoolKey,
        learnerId: learnerKey,
      },
    },
    create: {
      schoolId: schoolKey,
      learnerId: learnerKey,
    },
    update: {
      clearedAt: new Date(),
    },
  });
}

export async function clearLearnerBillingPlanExplicitlyEmpty(
  schoolId: string,
  learnerId: string
): Promise<void> {
  const schoolKey = String(schoolId || "").trim();
  const learnerKey = String(learnerId || "").trim();
  if (!schoolKey || !learnerKey) return;

  await prisma.learnerBillingPlanCleared.deleteMany({
    where: { schoolId: schoolKey, learnerId: learnerKey },
  });
}

export async function upsertSchoolBillingPlansToDb(
  schoolId: string,
  plans: Record<string, StoredBillingPlanItem[]>
): Promise<number> {
  const schoolKey = String(schoolId || "").trim();
  if (!schoolKey) return 0;

  const entries = Object.entries(plans).filter(([learnerId]) => String(learnerId || "").trim());
  if (!entries.length) return 0;

  let savedCount = 0;

  for (let offset = 0; offset < entries.length; offset += UPSERT_BATCH_SIZE) {
    const batch = entries.slice(offset, offset + UPSERT_BATCH_SIZE);
    await Promise.all(
      batch.map(async ([learnerId, items]) => {
        const normalized = normalizeItems(items);
        await prisma.learnerBillingPlanLine.deleteMany({
          where: { schoolId: schoolKey, learnerId },
        });
        if (!normalized.length) return;

        await prisma.learnerBillingPlanLine.createMany({
          data: normalized.map((item, sortOrder) => ({
            schoolId: schoolKey,
            learnerId,
            feeDescription: item.feeDescription,
            amount: item.amount,
            sortOrder,
          })),
        });
        savedCount += 1;
      })
    );
  }

  return savedCount;
}

function mergeSchoolBillingPlanMaps(
  target: Record<string, StoredBillingPlanItem[]>,
  source: Record<string, StoredBillingPlanItem[]>
): void {
  for (const [learnerId, items] of Object.entries(source)) {
    if (items?.length) target[learnerId] = items;
  }
}

async function readSchoolBillingPlansFromDbResolved(
  schoolId: string
): Promise<Record<string, StoredBillingPlanItem[]>> {
  const key = String(schoolId || "").trim();
  if (!key) return {};

  if (isDaSilvaSchoolId(key)) {
    const schoolIds = await refreshDaSilvaSchoolIdCache();
    const merged: Record<string, StoredBillingPlanItem[]> = {};
    for (const sid of schoolIds) {
      mergeSchoolBillingPlanMaps(merged, await readSchoolBillingPlansFromDb(sid));
    }
    return merged;
  }

  return readSchoolBillingPlansFromDb(key);
}

/** DB is source of truth; JSON is legacy fallback with one-time migration into DB. */
export async function readSchoolBillingPlansResolved(
  schoolId: string
): Promise<Record<string, StoredBillingPlanItem[]>> {
  const key = String(schoolId || "").trim();
  if (!key) return {};

  const fromDb = await readSchoolBillingPlansFromDbResolved(key);
  const dbLearnerCount = Object.keys(fromDb).length;
  if (dbLearnerCount > 0) return fromDb;

  const fromJson = readSchoolBillingPlansFromJson(key);
  const jsonLearnerCount = Object.keys(fromJson).length;
  if (jsonLearnerCount === 0) return {};

  const migratedCount = await upsertSchoolBillingPlansToDb(key, fromJson);
  console.log(
    `[billingPlansReload] schoolId=${key} migratedFromJson=${migratedCount} jsonLearnerCount=${jsonLearnerCount}`
  );
  return readSchoolBillingPlansFromDb(key);
}
