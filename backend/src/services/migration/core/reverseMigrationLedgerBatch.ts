import {
  appendSchoolEntry,
  readSchoolLedger,
  type BillingLedgerEntry,
  type BillingLedgerEntryType,
} from "../../../utils/billingLedgerStore";
import type { LedgerPostingType } from "../types/MigrationLedgerPosting";
import type {
  MigrationApplyCounts,
  MigrationImportReportRow,
} from "../types/MigrationApply";
import type {
  MigrationReversalReportRow,
  MigrationReversalRequest,
  MigrationReversalResult,
} from "../types/MigrationReversal";
import {
  batchHasCreatedTransactions,
} from "./rollbackMigrationBatch";
import {
  getImportBatch,
  updateImportBatch,
} from "./migrationImportBatchStore";

const MIGRATION_LEDGER_SOURCE = "universal_migration_phase14";
const REVERSAL_SOURCE = "universal_migration_reversal_phase15";

function cleanString(v: unknown): string {
  return String(v ?? "").trim();
}

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

function bumpTransactionCount(counts: MigrationApplyCounts): void {
  counts.transactions += 1;
}

export class MigrationReversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationReversalError";
  }
}

function reversalEntryId(batchId: string, originalId: string): string {
  const safeBatch = batchId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 24);
  const safeOrig = originalId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return `umig-rev-${safeBatch}-${safeOrig}`;
}

function parsePostingTypeFromEntryId(entryId: string): LedgerPostingType | null {
  const match = /^umig-tx-([^-]+)-/.exec(entryId);
  if (!match) return null;
  const raw = match[1] as LedgerPostingType;
  if (
    raw === "invoice" ||
    raw === "payment" ||
    raw === "journal_debit" ||
    raw === "journal_credit"
  ) {
    return raw;
  }
  return null;
}

function inferPostingTypeFromLedgerType(type: BillingLedgerEntryType): LedgerPostingType {
  switch (type) {
    case "payment":
      return "payment";
    case "credit":
      return "journal_credit";
    case "penalty":
    case "invoice":
    default:
      return "invoice";
  }
}

function reversalLedgerType(postingType: LedgerPostingType): BillingLedgerEntryType {
  switch (postingType) {
    case "invoice":
    case "journal_debit":
      return "credit";
    case "payment":
    case "journal_credit":
      return "invoice";
    default:
      return "credit";
  }
}

function buildReversalReference(batchId: string, originalReference: string): string {
  const base = cleanString(originalReference) || batchId;
  const prefixed = `REVERSAL-${base}`;
  return prefixed.length > 120 ? `${prefixed.slice(0, 117)}...` : prefixed;
}

function isMigrationBatchLedgerEntry(entry: BillingLedgerEntry, recordId: string): boolean {
  if (entry.id !== recordId) return false;
  const source = cleanString(entry.source);
  if (source === MIGRATION_LEDGER_SOURCE) return true;
  return entry.id.startsWith("umig-tx-");
}

function findLedgerEntryById(
  entries: BillingLedgerEntry[],
  recordId: string,
  targetSchoolId: string
): BillingLedgerEntry | null {
  const match = entries.find((e) => e.id === recordId);
  if (!match) return null;
  if (cleanString(match.schoolId) !== targetSchoolId) return null;
  return match;
}

function createdTransactionRows(reportRows: MigrationImportReportRow[]): MigrationImportReportRow[] {
  return reportRows.filter(
    (row) => row.status === "created" && row.entityType === "transaction" && cleanString(row.recordId)
  );
}

export async function reverseMigrationLedgerBatch(
  input: MigrationReversalRequest
): Promise<MigrationReversalResult> {
  const batchId = cleanString(input.batchId);
  const targetSchoolId = cleanString(input.targetSchoolId);
  const confirmationText = cleanString(input.confirmationText);

  if (!batchId) throw new MigrationReversalError("batchId is required");
  if (!targetSchoolId) throw new MigrationReversalError("targetSchoolId is required");
  if (!confirmationText) throw new MigrationReversalError("confirmationText is required");

  const batch = getImportBatch(batchId);
  if (!batch) throw new MigrationReversalError("Import batch not found");

  if (batch.status === "rolled_back") {
    throw new MigrationReversalError("This batch has already been rolled back");
  }

  if (batch.status !== "completed") {
    throw new MigrationReversalError(
      `Reversal rollback is only allowed for completed batches (current status: ${batch.status})`
    );
  }

  if (batch.targetSchoolId !== targetSchoolId) {
    throw new MigrationReversalError("targetSchoolId does not match this import batch");
  }

  const expectedPhrase = cleanString(batch.targetSchoolName);
  if (confirmationText.trim().toLowerCase() !== expectedPhrase.trim().toLowerCase()) {
    throw new MigrationReversalError(
      `Confirmation phrase must match the target school name exactly (${expectedPhrase})`
    );
  }

  const reportRows = batch.reportRows ?? [];
  if (!batchHasCreatedTransactions(reportRows)) {
    throw new MigrationReversalError(
      "This batch has no posted ledger transactions to reverse"
    );
  }

  const transactionRows = createdTransactionRows(reportRows);
  const ledgerEntries = readSchoolLedger(targetSchoolId);
  const ledgerById = new Map(ledgerEntries.map((e) => [e.id, e]));

  const reversedCounts = emptyCounts();
  const skippedCounts = emptyCounts();
  const failedCounts = emptyCounts();
  const report: MigrationReversalReportRow[] = [];

  const pushRow = (row: MigrationReversalReportRow) => {
    report.push(row);
    if (row.status === "reversed") bumpTransactionCount(reversedCounts);
    else if (row.status === "skipped") bumpTransactionCount(skippedCounts);
    else bumpTransactionCount(failedCounts);
  };

  for (const row of transactionRows) {
    const recordId = cleanString(row.recordId);
    const reportBase = {
      entityType: "transaction" as const,
      recordId,
      sourceFileId: row.sourceFileId,
      sourceFilename: row.sourceFilename,
      rowNumber: row.rowNumber,
    };

    const revId = reversalEntryId(batchId, recordId);
    if (ledgerById.has(revId)) {
      pushRow({
        ...reportBase,
        status: "skipped",
        message: "Reversal entry already exists for this transaction",
        reversalRecordId: revId,
      });
      continue;
    }

    const original = findLedgerEntryById(ledgerEntries, recordId, targetSchoolId);
    if (!original) {
      pushRow({
        ...reportBase,
        status: "failed",
        message: "Original ledger entry not found at target school — reversal not applied",
      });
      continue;
    }

    if (!isMigrationBatchLedgerEntry(original, recordId)) {
      pushRow({
        ...reportBase,
        status: "failed",
        message: "Ledger entry does not match a universal migration posted transaction",
      });
      continue;
    }

    const postingType =
      parsePostingTypeFromEntryId(original.id) ?? inferPostingTypeFromLedgerType(original.type);
    const reversalType = reversalLedgerType(postingType);
    const now = new Date().toISOString();

    const reversalEntry: BillingLedgerEntry = {
      id: revId,
      schoolId: targetSchoolId,
      learnerId: original.learnerId,
      accountNo: original.accountNo,
      type: reversalType,
      amount: original.amount,
      date: original.date,
      dueDate: original.dueDate,
      reference: buildReversalReference(batchId, original.reference),
      description: `Migration reversal for batch ${batchId}`,
      source: REVERSAL_SOURCE,
      createdAt: now,
    };

    appendSchoolEntry(targetSchoolId, reversalEntry);
    ledgerById.set(revId, reversalEntry);

    pushRow({
      ...reportBase,
      status: "reversed",
      message: `Reversal ${reversalType} posted (offsets ${original.type}, R${original.amount.toFixed(2)})`,
      reversalRecordId: revId,
    });
  }

  const rolledBackAt = new Date().toISOString();
  const success = failedCounts.transactions === 0;

  const result: MigrationReversalResult = {
    batchId: batch.batchId,
    targetSchoolId: batch.targetSchoolId,
    targetSchoolName: batch.targetSchoolName,
    rolledBackAt,
    success,
    reversedCounts,
    skippedCounts,
    failedCounts,
    report,
  };

  updateImportBatch(batch.batchId, {
    status: "rolled_back",
    rolledBackAt,
    reversalReport: report,
  });

  return result;
}
