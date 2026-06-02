import { buildAccountsFromAgeAnalysisSnapshots } from "./statementAccounts";
import {
  EDUCLEAR_UNDO_CORRECTION_SOURCE,
  isEduClearUndoableLedgerEntry,
  isStatementKidesysUndoBlocked,
} from "../utils/billingDisplayRules";
import {
  readSchoolLedger,
  upsertSchoolEntries,
  type BillingLedgerEntry,
  type BillingLedgerEntryType,
} from "../utils/billingLedgerStore";
import { clearPaymentAllocations } from "../utils/paymentAllocationStore";

export type UndoBillingTransactionInput = {
  schoolId: string;
  transactionId: string;
  accountNo?: string;
  auditNo?: string | number;
};

export type UndoBillingTransactionResult = {
  original: BillingLedgerEntry;
  correction: BillingLedgerEntry;
  alreadyUndone: boolean;
  accounts: Awaited<ReturnType<typeof buildAccountsFromAgeAnalysisSnapshots>>;
  ledgerEntries: BillingLedgerEntry[];
};

export function undoCorrectionEntryId(originalId: string): string {
  const safe = String(originalId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 96);
  return `undo-corr-${safe}`;
}

export function correctionReversalType(
  originalType: BillingLedgerEntryType
): BillingLedgerEntryType {
  switch (originalType) {
    case "invoice":
    case "penalty":
      return "credit";
    case "payment":
      return "invoice";
    case "credit":
    default:
      return "invoice";
  }
}

function buildCorrectionReference(original: BillingLedgerEntry): string {
  const base = String(original.reference || original.id || "TXN").trim() || "TXN";
  const prefixed = `CORRECTION-${base}`;
  return prefixed.length > 120 ? `${prefixed.slice(0, 117)}...` : prefixed;
}

function resolveLedgerEntry(
  entries: BillingLedgerEntry[],
  transactionId: string,
  accountNo: string,
  auditNo?: string | number
): BillingLedgerEntry | null {
  const id = String(transactionId || "").trim();
  if (!id) return null;

  const byId = entries.find((e) => e.id === id);
  if (byId) return byId;

  if (id.startsWith("posting-")) {
    const ledgerId = id.slice("posting-".length);
    const match = entries.find((e) => e.id === ledgerId);
    if (match) return match;
  }

  const accountRef = String(accountNo || "").trim().toUpperCase();
  const scoped = accountRef
    ? entries.filter((e) => String(e.accountNo || "").trim().toUpperCase() === accountRef)
    : entries;

  if (auditNo !== undefined && auditNo !== null && String(auditNo).trim() !== "") {
    const auditNum = Number(auditNo);
    if (Number.isFinite(auditNum) && auditNum > 0) {
      const sorted = [...scoped].sort(
        (a, b) =>
          new Date(a.date || a.createdAt).getTime() - new Date(b.date || b.createdAt).getTime()
      );
      const candidate = sorted[auditNum - 1];
      if (candidate) return candidate;
    }
  }

  return null;
}

function collectAccountLedgerSlice(
  entries: BillingLedgerEntry[],
  accountNo: string
): BillingLedgerEntry[] {
  const ref = String(accountNo || "").trim().toUpperCase();
  if (!ref) return [];
  return entries.filter((e) => String(e.accountNo || "").trim().toUpperCase() === ref);
}

export async function undoBillingTransaction(
  input: UndoBillingTransactionInput
): Promise<UndoBillingTransactionResult> {
  const schoolId = String(input.schoolId || "").trim();
  const transactionId = String(input.transactionId || "").trim();
  if (!schoolId || !transactionId) {
    throw new Error("Missing schoolId or transaction id");
  }

  const ledger = readSchoolLedger(schoolId);
  const entry = resolveLedgerEntry(
    ledger,
    transactionId,
    String(input.accountNo || ""),
    input.auditNo
  );
  if (!entry) {
    throw new Error("Transaction not found");
  }

  const correctionId = undoCorrectionEntryId(entry.id);
  const existingCorrection = ledger.find((e) => e.id === correctionId) ?? null;

  if (entry.undoneByCorrectionId || entry.undoneAt) {
    const correction =
      existingCorrection ||
      ledger.find((e) => e.id === String(entry.undoneByCorrectionId || "").trim()) ||
      null;
    if (!correction) {
      throw new Error("This transaction was already undone but the correction journal is missing.");
    }
    const accounts = await buildAccountsFromAgeAnalysisSnapshots(schoolId);
    return {
      original: entry,
      correction,
      alreadyUndone: true,
      accounts,
      ledgerEntries: collectAccountLedgerSlice(readSchoolLedger(schoolId), entry.accountNo),
    };
  }

  if (existingCorrection) {
    throw new Error("A correction journal already exists for this transaction.");
  }

  if (!isEduClearUndoableLedgerEntry(entry)) {
    if (isStatementKidesysUndoBlocked(entry, undefined, false)) {
      throw new Error("Imported Kid-e-Sys history cannot be undone.");
    }
    throw new Error("This transaction cannot be undone.");
  }

  const now = new Date().toISOString();
  const reversalType = correctionReversalType(entry.type);
  const correction: BillingLedgerEntry = {
    id: correctionId,
    schoolId,
    learnerId: entry.learnerId,
    accountNo: entry.accountNo,
    type: reversalType,
    amount: entry.amount,
    date: entry.date,
    dueDate: entry.dueDate,
    reference: buildCorrectionReference(entry),
    description: `Correction journal (undo ${entry.type})`,
    source: EDUCLEAR_UNDO_CORRECTION_SOURCE,
    correctsEntryId: entry.id,
    statementHidden: true,
    createdAt: now,
  };

  const original: BillingLedgerEntry = {
    ...entry,
    statementHidden: true,
    undoneAt: now,
    undoneByCorrectionId: correctionId,
  };

  upsertSchoolEntries(schoolId, [original, correction]);

  if (entry.type === "payment") {
    clearPaymentAllocations(schoolId, entry.id);
  }

  const accounts = await buildAccountsFromAgeAnalysisSnapshots(schoolId);
  const updatedLedger = readSchoolLedger(schoolId);

  return {
    original,
    correction,
    alreadyUndone: false,
    accounts,
    ledgerEntries: collectAccountLedgerSlice(updatedLedger, entry.accountNo),
  };
}
