import crypto from "crypto";
import fs from "fs";
import path from "path";

import { prisma } from "../../prisma";
import { parseBillingPlanFile } from "../daSilvaMigration/parsers";
import type { DbLearnerForParentMatch } from "../daSilvaMigration/daSilvaParentLearnerMatching";
import {
  readSchoolBillingPlans,
  upsertSchoolBillingPlans,
  type StoredBillingPlanItem,
} from "../../utils/learnerBillingPlanStore";
import {
  buildBillingPlanMatchIndexes,
  groupBillingPlanItems,
  matchBillingPlanGroupToLearner,
  sumPlanAmount,
  type BillingPlanMatchRow,
} from "./billingPlanLearnerMatch";
import { resolveSpreadsheetPathForParsing } from "./spreadsheetUpload";

const SESSION_ROOT = path.join(process.cwd(), "uploads", "migration-centre", "billing-plans");
const PREVIEW_SAMPLE = 80;
const AMOUNT_EXAMPLE_COUNT = 12;

export type MigrationBillingPlanPreviewRow = BillingPlanMatchRow & {
  learnerName: string;
  fees: StoredBillingPlanItem[];
  status: string;
};

export type MigrationBillingPlansPreview = {
  success: boolean;
  schoolId: string;
  schoolName: string;
  sessionId: string;
  fileName: string;
  canApply: boolean;
  counts: {
    dbActiveLearners: number;
    billingFileLearners: number;
    matched: number;
    unmatched: number;
    ambiguous: number;
    learnersWithoutPlan: number;
    existingPlanLearners: number;
    plansToWrite: number;
  };
  rows: MigrationBillingPlanPreviewRow[];
  /** @deprecated Use rows — kept for legacy super-admin UI */
  matched: MigrationBillingPlanPreviewRow[];
  /** @deprecated Use rows */
  unmatched: MigrationBillingPlanPreviewRow[];
  learnersWithoutPlan: Array<{
    learnerId: string;
    firstName: string;
    lastName: string;
    className: string | null;
    admissionNo: string | null;
    idNumber: string | null;
  }>;
  amountExamples: Array<{
    fullName: string;
    className: string;
    totalAmount: number;
    feeCount: number;
    fees: StoredBillingPlanItem[];
  }>;
};

type SessionPayload = {
  schoolId: string;
  fileName: string;
  createdAt: string;
  plansByLearnerId: Record<string, StoredBillingPlanItem[]>;
};

function sessionPath(schoolId: string, sessionId: string): string {
  return path.join(SESSION_ROOT, schoolId, `${sessionId}.json`);
}

function newSessionId(): string {
  return `bp-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

async function loadActiveLearners(schoolId: string): Promise<DbLearnerForParentMatch[]> {
  return prisma.learner.findMany({
    where: { schoolId, enrollmentStatus: "ACTIVE" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      className: true,
      admissionNo: true,
      idNumber: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

function rowStatus(row: BillingPlanMatchRow): string {
  if (row.ambiguous) return "Ambiguous";
  if (row.learnerId) return "Matched";
  return "Unmatched";
}

export async function previewMigrationBillingPlansImport(opts: {
  schoolId: string;
  billingPlanFilePath: string;
  originalFileName: string;
}): Promise<MigrationBillingPlansPreview> {
  const schoolId = String(opts.schoolId || "").trim();
  if (!schoolId) throw new Error("schoolId required");

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new Error("School not found");

  const { parsePath, cleanup } = resolveSpreadsheetPathForParsing(
    path.resolve(opts.billingPlanFilePath)
  );
  let billingItems;
  try {
    billingItems = parseBillingPlanFile(parsePath);
  } finally {
    cleanup();
  }

  if (!billingItems.length) {
    throw new Error("No billing plan rows parsed from file");
  }

  const dbLearners = await loadActiveLearners(schoolId);
  const indexes = buildBillingPlanMatchIndexes(dbLearners);
  const planByKey = groupBillingPlanItems(billingItems);

  const previewRows: MigrationBillingPlanPreviewRow[] = [];
  const plansByLearnerId = new Map<string, StoredBillingPlanItem[]>();

  for (const [billingMatchKey, group] of planByKey) {
    const totalAmount = sumPlanAmount(group.items);
    const match = matchBillingPlanGroupToLearner(group, indexes);
    const row: BillingPlanMatchRow = {
      billingMatchKey,
      fullName: group.fullName,
      className: group.className,
      feeLineCount: group.items.length,
      totalAmount,
      learnerId: match.learnerId,
      strategy: match.strategy,
      ambiguous: match.ambiguous,
    };

    const learner = match.learnerId
      ? dbLearners.find((l) => l.id === match.learnerId)
      : undefined;
    const fees = group.items;

    if (match.learnerId && !match.ambiguous && !plansByLearnerId.has(match.learnerId)) {
      plansByLearnerId.set(match.learnerId, fees);
    }

    previewRows.push({
      ...row,
      learnerName: learner ? `${learner.firstName} ${learner.lastName}` : "",
      fees,
      status: rowStatus(row),
    });
  }

  const matchedLearnerIds = new Set(
    previewRows.filter((r) => r.learnerId && !r.ambiguous).map((r) => r.learnerId as string)
  );
  const unmatchedCount = previewRows.filter((r) => !r.learnerId || r.ambiguous).length;
  const ambiguousCount = previewRows.filter((r) => r.ambiguous).length;
  const matchedCount = previewRows.filter((r) => r.learnerId && !r.ambiguous).length;

  const learnersWithoutPlan = dbLearners
    .filter((l) => !matchedLearnerIds.has(l.id))
    .map((l) => ({
      learnerId: l.id,
      firstName: l.firstName,
      lastName: l.lastName,
      className: l.className,
      admissionNo: l.admissionNo,
      idNumber: l.idNumber,
    }));

  const existingPlans = readSchoolBillingPlans(schoolId);
  const existingPlanLearners = Object.keys(existingPlans).length;

  const matchedDetails = previewRows.filter((r) => r.learnerId && !r.ambiguous);
  const amountExamples = [...matchedDetails]
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, AMOUNT_EXAMPLE_COUNT)
    .map((r) => ({
      fullName: r.fullName,
      className: r.className,
      totalAmount: r.totalAmount,
      feeCount: r.feeLineCount,
      fees: r.fees,
    }));

  const sessionId = newSessionId();
  const sessionDir = path.join(SESSION_ROOT, schoolId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const plansRecord: Record<string, StoredBillingPlanItem[]> = {};
  for (const [learnerId, items] of plansByLearnerId) {
    plansRecord[learnerId] = items;
  }

  const payload: SessionPayload = {
    schoolId,
    fileName: opts.originalFileName,
    createdAt: new Date().toISOString(),
    plansByLearnerId: plansRecord,
  };
  fs.writeFileSync(sessionPath(schoolId, sessionId), JSON.stringify(payload, null, 2), "utf8");

  return {
    success: true,
    schoolId,
    schoolName: school.name,
    sessionId,
    fileName: opts.originalFileName,
    canApply: matchedCount > 0 && plansByLearnerId.size > 0,
    counts: {
      dbActiveLearners: dbLearners.length,
      billingFileLearners: planByKey.size,
      matched: matchedCount,
      unmatched: unmatchedCount,
      ambiguous: ambiguousCount,
      learnersWithoutPlan: learnersWithoutPlan.length,
      existingPlanLearners,
      plansToWrite: plansByLearnerId.size,
    },
    rows: previewRows.slice(0, PREVIEW_SAMPLE),
    matched: previewRows.filter((r) => r.learnerId && !r.ambiguous).slice(0, PREVIEW_SAMPLE),
    unmatched: previewRows.filter((r) => !r.learnerId || r.ambiguous).slice(0, PREVIEW_SAMPLE),
    learnersWithoutPlan: learnersWithoutPlan.slice(0, PREVIEW_SAMPLE),
    amountExamples,
  };
}

export async function applyMigrationBillingPlansImport(opts: {
  schoolId: string;
  sessionId: string;
}): Promise<{
  success: boolean;
  schoolId: string;
  learnersUpdated: number;
  fileName: string;
}> {
  const schoolId = String(opts.schoolId || "").trim();
  const sessionId = String(opts.sessionId || "").trim();
  if (!schoolId || !sessionId) {
    throw new Error("schoolId and sessionId required");
  }

  const file = sessionPath(schoolId, sessionId);
  if (!fs.existsSync(file)) {
    throw new Error("Import session expired or not found — run preview again");
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(fs.readFileSync(file, "utf8")) as SessionPayload;
  } catch {
    throw new Error("Invalid import session data");
  }

  if (payload.schoolId !== schoolId) {
    throw new Error("Session does not match school");
  }

  const planKeys = Object.keys(payload.plansByLearnerId || {});
  if (!planKeys.length) {
    throw new Error("No billing plans to apply");
  }

  upsertSchoolBillingPlans(schoolId, payload.plansByLearnerId);

  try {
    fs.unlinkSync(file);
  } catch {
    /* ignore */
  }

  return {
    success: true,
    schoolId,
    learnersUpdated: planKeys.length,
    fileName: payload.fileName,
  };
}
