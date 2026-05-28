import { prisma } from "../../../prisma";
import {
  appendSchoolEntry,
  normaliseAmount,
  type BillingLedgerEntry,
  type BillingLedgerEntryType,
} from "../../../utils/billingLedgerStore";
import type { MigrationTargetField } from "../types/MigrationTargetField";
import type {
  MigrationApplyCounts,
  MigrationImportReportRow,
} from "../types/MigrationApply";
import type { MigrationTransactionOutcomeCounts } from "../types/MigrationApply";
import {
  classifyLedgerTransaction,
  formatLedgerDuplicateKey,
} from "./classifyLedgerTransaction";
import type { LedgerDuplicateKey } from "../types/MigrationLedgerPosting";
import type { LearnerIndexEntry } from "./computeTransactionReadiness";
import {
  buildMigrationLearnerMatchIndex,
  learnerMatchKeysInPriorityOrder,
  type LearnerIndexEntry as IndexEntry,
} from "./computeTransactionReadiness";
import type { MigrationFilePreview } from "../types/MigrationFilePreview";
import type { MigrationFileColumnMappings } from "../types/MigrationValidation";
import type { MigrationStage } from "../types/MigrationStage";
import type { LedgerPostingType } from "../types/MigrationLedgerPosting";
import type { MigrationLearnerStatus } from "../types/MigrationLearnerStatus";

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

type MappedRow = Partial<Record<MigrationTargetField, string>>;

function cleanString(v: unknown): string {
  return String(v ?? "").trim();
}

function mapRawRecord(
  raw: Record<string, string>,
  targetToSource: Map<MigrationTargetField, string>
): MappedRow {
  const out: MappedRow = {};
  for (const [target, sourceCol] of targetToSource) {
    const value = cleanString(raw[sourceCol]);
    if (value) out[target as MigrationTargetField] = value;
  }
  return out;
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

function resolveIndexEntry(
  mapped: MappedRow,
  index: Map<string, LearnerIndexEntry>
): { entry: LearnerIndexEntry | null; matched: boolean } {
  const targetToSource = new Map<MigrationTargetField, string>();
  for (const [field, value] of Object.entries(mapped)) {
    if (value) targetToSource.set(field as MigrationTargetField, field);
  }
  const row: Record<string, unknown> = { ...mapped };
  const keys = learnerMatchKeysInPriorityOrder(row, targetToSource);
  for (const key of keys) {
    const entry = index.get(key);
    if (entry) return { entry, matched: true };
  }
  return { entry: null, matched: keys.length > 0 };
}

function prismaEnrollmentToMigrationStatus(enrollmentStatus: string): MigrationLearnerStatus {
  const upper = String(enrollmentStatus || "").toUpperCase();
  if (upper === "ACTIVE") return "ACTIVE";
  if (upper === "HISTORICAL") return "HISTORICAL";
  return "HISTORICAL";
}

export async function buildApplyLearnerMatchIndex(
  tx: TxClient,
  schoolId: string,
  stage: MigrationStage,
  rowsByFileId: Map<string, Record<string, unknown>[]>
): Promise<Map<string, LearnerIndexEntry>> {
  const mappingsByFile = new Map(stage.mappings.map((m) => [m.fileId, m]));
  const previews: MigrationFilePreview[] = stage.files.map((f) => ({
    fileId: f.fileId,
    filename: f.filename,
    category: f.category,
    rowCount: f.rowCount,
    columns: [],
    sampleRows: [],
    warnings: [],
    path: f.path,
  }));

  const stagedIndex = buildMigrationLearnerMatchIndex(
    previews,
    mappingsByFile,
    rowsByFileId
  );

  const dbLearners = await tx.learner.findMany({
    where: { schoolId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      idNumber: true,
      grade: true,
      className: true,
      enrollmentStatus: true,
      familyAccount: { select: { accountRef: true } },
    },
  });

  for (const learner of dbLearners) {
    const status = prismaEnrollmentToMigrationStatus(learner.enrollmentStatus);
    const entry: IndexEntry = {
      status,
      grade: learner.grade || undefined,
      classroom: learner.className || undefined,
    };
    const nameKey = `name:${learner.firstName.toLowerCase()} ${learner.lastName.toLowerCase()}`.trim();
    const idKey = learner.idNumber
      ? `id:${String(learner.idNumber).toLowerCase()}`
      : "";
    const acct = learner.familyAccount?.accountRef
      ? `acct:${learner.familyAccount.accountRef.toLowerCase()}`
      : "";

    const merge = (key: string) => {
      if (!key) return;
      const existing = stagedIndex.get(key);
      if (!existing || status === "ACTIVE") stagedIndex.set(key, entry);
    };
    merge(nameKey);
    merge(idKey);
    merge(acct);
  }

  return stagedIndex;
}

function ledgerEntryTypeForPosting(postingType: LedgerPostingType): BillingLedgerEntryType {
  switch (postingType) {
    case "invoice":
    case "journal_debit":
      return "invoice";
    case "payment":
      return "payment";
    case "journal_credit":
      return "credit";
    default:
      return "invoice";
  }
}

function migrationLedgerEntryId(
  postingType: LedgerPostingType,
  accountRef: string,
  date: string,
  reference: string,
  amount: number
): string {
  const safeRef = (reference || "norefnomig").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const safeAcct = accountRef.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  return `umig-tx-${postingType}-${safeAcct}-${date}-${safeRef}-${amount}`;
}

function duplicateKeySeen(seen: Set<string>, key: LedgerDuplicateKey | null): boolean {
  if (!key) return false;
  const s = formatLedgerDuplicateKey(key);
  if (seen.has(s)) return true;
  seen.add(s);
  return false;
}

export type PostMigrationLedgerContext = {
  tx: TxClient;
  schoolId: string;
  cutoverDate?: string;
  learnerIndex: Map<string, LearnerIndexEntry>;
  seenDuplicateKeys: Set<string>;
  report: MigrationImportReportRow[];
  createdCounts: MigrationApplyCounts;
  skippedCounts: MigrationApplyCounts;
  failedCounts: MigrationApplyCounts;
  transactionOutcomes: MigrationTransactionOutcomeCounts;
};

function bumpTransactionOutcome(
  outcomes: MigrationTransactionOutcomeCounts,
  bucket: keyof MigrationTransactionOutcomeCounts
): void {
  outcomes[bucket] += 1;
}

export async function postSingleMigrationLedgerTransaction(
  ctx: PostMigrationLedgerContext,
  input: {
    mapped: MappedRow;
    sourceFileId: string;
    sourceFilename: string;
    rowNumber: number;
  }
): Promise<void> {
  const { mapped, sourceFileId, sourceFilename, rowNumber } = input;
  const { entry, matched } = resolveIndexEntry(mapped, ctx.learnerIndex);
  const accountStatus = cleanString(mapped.status) || entry?.accountStatus;

  const decision = classifyLedgerTransaction({
    mapped,
    cutoverDate: ctx.cutoverDate,
    learnerEntry: entry,
    hasLearnerOrAccountMatch: matched,
    accountStatus,
  });

  const reportBase = {
    entityType: "transaction" as const,
    sourceFileId,
    sourceFilename,
    rowNumber,
    key: decision.duplicateKey ? formatLedgerDuplicateKey(decision.duplicateKey) : undefined,
  };

  if (decision.historicalOnly || decision.bucket === "historicalOnly") {
    ctx.report.push({
      ...reportBase,
      status: "not_applied",
      message: decision.reason,
    });
    bumpTransactionOutcome(ctx.transactionOutcomes, "historicalNotApplied");
    return;
  }

  if (decision.bucket === "unmatched") {
    ctx.report.push({
      ...reportBase,
      status: "failed",
      message: decision.reason,
    });
    ctx.failedCounts.transactions += 1;
    bumpTransactionOutcome(ctx.transactionOutcomes, "unmatched");
    return;
  }

  if (!decision.canPost) {
    const status = decision.bucket === "blocked" ? "failed" : "skipped";
    ctx.report.push({
      ...reportBase,
      status,
      message: decision.reason,
    });
    if (status === "failed") ctx.failedCounts.transactions += 1;
    else ctx.skippedCounts.transactions += 1;
    bumpTransactionOutcome(ctx.transactionOutcomes, "blocked");
    return;
  }

  if (duplicateKeySeen(ctx.seenDuplicateKeys, decision.duplicateKey)) {
    ctx.report.push({
      ...reportBase,
      status: "skipped",
      message: "Duplicate transaction skipped (account, date, reference, amount, type)",
      key: decision.duplicateKey ? formatLedgerDuplicateKey(decision.duplicateKey) : undefined,
    });
    ctx.skippedCounts.transactions += 1;
    bumpTransactionOutcome(ctx.transactionOutcomes, "duplicateSkipped");
    return;
  }

  const accountRef = cleanString(mapped.accountNumber);
  const familyAccount = await ctx.tx.familyAccount.findFirst({
    where: { schoolId: ctx.schoolId, accountRef },
    select: { id: true, accountRef: true },
  });

  if (!familyAccount) {
    ctx.report.push({
      ...reportBase,
      status: "failed",
      message: "Billing account not found at target school — transaction not posted",
    });
    ctx.failedCounts.transactions += 1;
    bumpTransactionOutcome(ctx.transactionOutcomes, "blocked");
    return;
  }

  const activeLearner = await ctx.tx.learner.findFirst({
    where: {
      schoolId: ctx.schoolId,
      familyAccountId: familyAccount.id,
      enrollmentStatus: "ACTIVE",
    },
    select: { id: true, grade: true, className: true, enrollmentStatus: true },
    orderBy: { createdAt: "asc" },
  });

  if (!activeLearner) {
    ctx.report.push({
      ...reportBase,
      status: "failed",
      message: "No ACTIVE learner on billing account — transaction not posted (head count protected)",
    });
    ctx.failedCounts.transactions += 1;
    bumpTransactionOutcome(ctx.transactionOutcomes, "blocked");
    return;
  }

  const postingType = decision.postingType!;
  const ledgerType = ledgerEntryTypeForPosting(postingType);
  const entryId = migrationLedgerEntryId(
    postingType,
    accountRef,
    decision.date,
    decision.reference,
    decision.amount
  );

  const ledgerEntry: BillingLedgerEntry = {
    id: entryId,
    schoolId: ctx.schoolId,
    learnerId: activeLearner.id,
    accountNo: familyAccount.accountRef,
    type: ledgerType,
    amount: normaliseAmount(decision.amount),
    date: decision.date,
    reference: decision.reference || entryId,
    description:
      cleanString(mapped.description) ||
      cleanString(mapped.transactionType) ||
      `Migration import ${postingType}`,
    source: "universal_migration_phase14",
    createdAt: new Date().toISOString(),
  };

  appendSchoolEntry(ctx.schoolId, ledgerEntry);

  ctx.report.push({
    ...reportBase,
    status: "created",
    message: `Posted ${postingType} to billing ledger (${ledgerType}, R${ledgerEntry.amount.toFixed(2)})`,
    recordId: entryId,
    key: formatLedgerDuplicateKey(decision.duplicateKey!),
  });
  ctx.createdCounts.transactions += 1;
  bumpTransactionOutcome(ctx.transactionOutcomes, "posted");
}

export {
  mapRawRecord,
  buildTargetToSource,
  resolveIndexEntry,
  learnerMatchKeysInPriorityOrder,
};
