/**
 * Apply billing-plan lines from staged universal migration rows.
 * Reuses learnerBillingPlanDbStore upsert (replace-per-learner, idempotent for same content).
 */

import type { PrismaClient } from "@prisma/client";
import { upsertSchoolBillingPlansToDb } from "../../learnerBillingPlanDbStore";
import type { StoredBillingPlanItem } from "../../../utils/learnerBillingPlanStore";
import type { MigrationTargetField } from "../types/MigrationTargetField";
import type {
  MigrationApplyCounts,
  MigrationImportReportRow,
} from "../types/MigrationApply";
import { parseMoneyToCents, centsToRandNumber } from "./moneyCents";

type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type MappedRow = Partial<Record<MigrationTargetField, string>>;

function cleanString(v: unknown): string {
  return String(v ?? "").trim();
}

export type BillingPlanApplyContext = {
  tx: TxClient;
  schoolId: string;
  report: MigrationImportReportRow[];
  createdCounts: MigrationApplyCounts;
  skippedCounts: MigrationApplyCounts;
  failedCounts: MigrationApplyCounts;
};

export type BillingPlanRowInput = {
  mapped: MappedRow;
  sourceFileId: string;
  sourceFilename: string;
  rowNumber: number;
};

async function resolveLearnerId(
  tx: TxClient,
  schoolId: string,
  mapped: MappedRow
): Promise<string | null> {
  const admissionNo = cleanString(mapped.learnerNumber);
  const idNumber = cleanString(mapped.idNumber);
  const first = cleanString(mapped.firstName);
  const last = cleanString(mapped.lastName);
  const accountNumber = cleanString(mapped.accountNumber);

  if (admissionNo) {
    const byAdm = await tx.learner.findFirst({
      where: { schoolId, admissionNo },
      select: { id: true },
    });
    if (byAdm) return byAdm.id;
  }
  if (idNumber) {
    const byId = await tx.learner.findFirst({
      where: { schoolId, idNumber },
      select: { id: true },
    });
    if (byId) return byId.id;
  }
  if (first && last) {
    const byName = await tx.learner.findFirst({
      where: { schoolId, firstName: first, lastName: last },
      select: { id: true },
    });
    if (byName) return byName.id;
  }
  if (accountNumber) {
    const fa = await tx.familyAccount.findFirst({
      where: { schoolId, accountRef: accountNumber },
      select: { id: true },
    });
    if (fa) {
      const learner = await tx.learner.findFirst({
        where: { schoolId, familyAccountId: fa.id },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      if (learner) return learner.id;
    }
  }
  return null;
}

export async function applyMigrationBillingPlansFromMappedRows(
  ctx: BillingPlanApplyContext,
  rows: BillingPlanRowInput[]
): Promise<{ learnersUpdated: number; skipped: number; failed: number }> {
  const plans: Record<string, StoredBillingPlanItem[]> = {};
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const planName = cleanString(row.mapped.billingPlan);
    const feeRaw = row.mapped.feeAmount;
    if (!planName && !cleanString(feeRaw)) {
      skipped += 1;
      continue;
    }

    const learnerId = await resolveLearnerId(ctx.tx, ctx.schoolId, row.mapped);
    if (!learnerId) {
      ctx.report.push({
        entityType: "billingAccount",
        sourceFileId: row.sourceFileId,
        sourceFilename: row.sourceFilename,
        rowNumber: row.rowNumber,
        status: "failed",
        message: "Billing plan row could not be matched to a learner",
      });
      ctx.failedCounts.billingAccounts += 1;
      failed += 1;
      continue;
    }

    const cents = parseMoneyToCents(feeRaw);
    const amount = cents === null ? 0 : centsToRandNumber(Math.abs(cents));
    const item: StoredBillingPlanItem = {
      feeDescription: planName || "Migrated fee",
      amount,
    };
    const existing = plans[learnerId] || [];
    // Avoid duplicate identical lines within batch
    if (
      !existing.some(
        (e) => e.feeDescription === item.feeDescription && e.amount === item.amount
      )
    ) {
      existing.push(item);
    }
    plans[learnerId] = existing;
  }

  if (!Object.keys(plans).length) {
    return { learnersUpdated: 0, skipped, failed };
  }

  const learnersUpdated = await upsertSchoolBillingPlansToDb(ctx.schoolId, plans);
  ctx.report.push({
    entityType: "billingAccount",
    sourceFileId: "billing-plans",
    sourceFilename: "billing-plans",
    rowNumber: 0,
    status: "created",
    message: `Billing plans upserted for ${learnersUpdated} learner(s)`,
  });
  ctx.createdCounts.billingAccounts += learnersUpdated;
  return { learnersUpdated, skipped, failed };
}
