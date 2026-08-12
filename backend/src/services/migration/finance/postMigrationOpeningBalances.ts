/**
 * Post migration opening balances via the existing billing ledger mechanism.
 * Debit (owed) → invoice; credit balance → credit. Never typed as payment.
 *
 * Idempotent: stable entry id umig-opening-{accountRef}; appendSchoolEntrySafe skips duplicates.
 */

import type { PrismaClient } from "@prisma/client";
import {
  appendSchoolEntrySafe,
  normaliseAmount,
  type BillingLedgerEntry,
} from "../../../utils/billingLedgerStore";
import type { MigrationTargetField } from "../types/MigrationTargetField";
import type {
  MigrationApplyCounts,
  MigrationImportReportRow,
} from "../types/MigrationApply";
import {
  UMIG_OPENING_BALANCE_LABEL,
  UMIG_OPENING_BALANCE_SOURCE,
  UMIG_OPENING_REFERENCE_PREFIX,
} from "./FinanceClassification";
import { centsToRandNumber, parseMoneyToCents } from "./moneyCents";

type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
type MappedRow = Partial<Record<MigrationTargetField, string>>;

function cleanString(v: unknown): string {
  return String(v ?? "").trim();
}

function safeAccountToken(accountRef: string): string {
  return accountRef.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);
}

export function migrationOpeningBalanceEntryId(accountRef: string): string {
  return `umig-opening-${safeAccountToken(accountRef)}`;
}

export function migrationOpeningBalanceReference(accountRef: string): string {
  return `${UMIG_OPENING_REFERENCE_PREFIX}${accountRef}`;
}

export type OpeningBalancePostContext = {
  tx: TxClient;
  schoolId: string;
  cutoverDate: string;
  migrationRunId?: string;
  stageId?: string;
  sourceAnalysisId?: string;
  report: MigrationImportReportRow[];
  createdCounts: MigrationApplyCounts;
  skippedCounts: MigrationApplyCounts;
  failedCounts: MigrationApplyCounts;
  /** Collect ledger entry ids posted in this attempt (for compensation). */
  postedLedgerEntryIds: string[];
};

export type OpeningBalanceRowInput = {
  mapped: MappedRow;
  sourceFileId: string;
  sourceFilename: string;
  rowNumber: number;
};

export async function postSingleMigrationOpeningBalance(
  ctx: OpeningBalancePostContext,
  input: OpeningBalanceRowInput
): Promise<"created" | "skipped" | "failed"> {
  const accountRef = cleanString(input.mapped.accountNumber);
  const rawBalance = input.mapped.openingBalance;
  const cents = parseMoneyToCents(rawBalance);

  const reportBase = {
    entityType: "transaction" as const,
    sourceFileId: input.sourceFileId,
    sourceFilename: input.sourceFilename,
    rowNumber: input.rowNumber,
    key: accountRef ? `opening:${accountRef}` : undefined,
  };

  if (!accountRef) {
    ctx.report.push({
      ...reportBase,
      status: "failed",
      message: "Opening balance row missing accountNumber",
    });
    ctx.failedCounts.transactions += 1;
    return "failed";
  }

  if (cents === null) {
    ctx.report.push({
      ...reportBase,
      status: "failed",
      message: "Opening balance amount could not be parsed",
    });
    ctx.failedCounts.transactions += 1;
    return "failed";
  }

  if (cents === 0) {
    ctx.report.push({
      ...reportBase,
      status: "skipped",
      message: "Zero opening balance — nothing to post",
    });
    ctx.skippedCounts.transactions += 1;
    return "skipped";
  }

  if (!cleanString(ctx.cutoverDate)) {
    ctx.report.push({
      ...reportBase,
      status: "failed",
      message: "Cutover date is required before posting opening balances",
    });
    ctx.failedCounts.transactions += 1;
    return "failed";
  }

  const familyAccount = await ctx.tx.familyAccount.findFirst({
    where: { schoolId: ctx.schoolId, accountRef },
    select: { id: true, accountRef: true },
  });
  if (!familyAccount) {
    ctx.report.push({
      ...reportBase,
      status: "failed",
      message: "Family account not found — opening balance not posted",
    });
    ctx.failedCounts.transactions += 1;
    return "failed";
  }

  const learner = await ctx.tx.learner.findFirst({
    where: { schoolId: ctx.schoolId, familyAccountId: familyAccount.id },
    select: { id: true },
    orderBy: [{ enrollmentStatus: "asc" }, { createdAt: "asc" }],
  });

  const entryType = cents > 0 ? "invoice" : "credit";
  const amount = normaliseAmount(centsToRandNumber(Math.abs(cents)));
  const entryId = migrationOpeningBalanceEntryId(accountRef);
  const trace = [
    ctx.migrationRunId ? `run=${ctx.migrationRunId}` : "",
    ctx.stageId ? `stage=${ctx.stageId}` : "",
    ctx.sourceAnalysisId ? `analysis=${ctx.sourceAnalysisId}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const entry: BillingLedgerEntry = {
    id: entryId,
    schoolId: ctx.schoolId,
    learnerId: learner?.id || "",
    accountNo: familyAccount.accountRef,
    type: entryType,
    amount,
    date: ctx.cutoverDate.slice(0, 10),
    reference: migrationOpeningBalanceReference(accountRef),
    description: trace
      ? `${UMIG_OPENING_BALANCE_LABEL} (${trace})`
      : UMIG_OPENING_BALANCE_LABEL,
    source: UMIG_OPENING_BALANCE_SOURCE,
    runId: ctx.migrationRunId || ctx.stageId || undefined,
    createdAt: new Date().toISOString(),
  };

  const result = appendSchoolEntrySafe(ctx.schoolId, entry);
  if (!result.created) {
    ctx.report.push({
      ...reportBase,
      status: "skipped",
      message: "Opening balance already present — skipped (idempotent)",
      recordId: result.entry.id,
    });
    ctx.skippedCounts.transactions += 1;
    return "skipped";
  }

  ctx.postedLedgerEntryIds.push(entryId);
  ctx.report.push({
    ...reportBase,
    status: "created",
    message: `Posted opening balance as ${entryType} (not a payment) ${amount.toFixed(2)}`,
    recordId: entryId,
  });
  ctx.createdCounts.transactions += 1;
  return "created";
}

export async function postOpeningBalancesForMappedRows(
  ctx: OpeningBalancePostContext,
  rows: OpeningBalanceRowInput[]
): Promise<{ created: number; skipped: number; failed: number }> {
  let created = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    if (!cleanString(row.mapped.openingBalance)) continue;
    const status = await postSingleMigrationOpeningBalance(ctx, row);
    if (status === "created") created += 1;
    else if (status === "skipped") skipped += 1;
    else failed += 1;
  }
  return { created, skipped, failed };
}
