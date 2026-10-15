import { buildAccountsFromAgeAnalysisSnapshots } from "./statementAccounts";
import {
  EDUCLEAR_UNDO_CORRECTION_SOURCE,
  creditNotesForInvoice,
  isEduClearUndoableLedgerEntry,
  isStatementKidesysUndoBlocked,
} from "../utils/billingDisplayRules";
import {
  mutateSchoolLedgerEntries,
  readSchoolLedger,
  type BillingLedgerEntry,
  type BillingLedgerEntryType,
  type ReversedPaymentAllocationSnapshot,
} from "../utils/billingLedgerStore";
import { clearPaymentAllocations, listPaymentAllocations } from "../utils/paymentAllocationStore";

/** Staff roles allowed to undo (reverse) a captured payment. */
export const PAYMENT_UNDO_ALLOWED_ROLES = new Set(["Owner", "Admin", "Finance"]);
export const UNDO_REASON_MIN_LENGTH = 5;
export const UNDO_REASON_MAX_LENGTH = 500;

export type UndoBillingTransactionActor = {
  userId: string;
  email?: string;
  appRole: string;
};

export type UndoBillingTransactionInput = {
  schoolId: string;
  transactionId: string;
  accountNo?: string;
  auditNo?: string | number;
  actor?: UndoBillingTransactionActor | null;
  reason?: string;
  confirm?: boolean;
  /** Amount shown to staff before confirming; must match the ledger row for payments. */
  expectedAmount?: number | string | null;
};

export type UndoBillingTransactionResult = {
  original: BillingLedgerEntry;
  correction: BillingLedgerEntry;
  alreadyUndone: boolean;
  accounts: Awaited<ReturnType<typeof buildAccountsFromAgeAnalysisSnapshots>>;
  ledgerEntries: BillingLedgerEntry[];
};

export class BillingUndoError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "BillingUndoError";
  }
}

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

function roundMoney(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

/** Payment-only safeguards: role, reason, explicit confirmation and the amount staff saw. */
function assertPaymentUndoAllowed(entry: BillingLedgerEntry, input: UndoBillingTransactionInput): string {
  const actor = input.actor;
  if (!actor?.userId) {
    throw new BillingUndoError(401, "AUTH_REQUIRED", "Authentication required");
  }
  if (!PAYMENT_UNDO_ALLOWED_ROLES.has(String(actor.appRole || "").trim())) {
    throw new BillingUndoError(
      403,
      "UNDO_ROLE_REQUIRED",
      "Owner, Admin or Finance role required to undo a payment."
    );
  }
  const reason = String(input.reason || "").trim();
  if (reason.length < UNDO_REASON_MIN_LENGTH) {
    throw new BillingUndoError(400, "UNDO_REASON_REQUIRED", "Enter a reason for undoing this payment.");
  }
  if (reason.length > UNDO_REASON_MAX_LENGTH) {
    throw new BillingUndoError(400, "UNDO_REASON_TOO_LONG", "Undo reason is too long.");
  }
  if (input.confirm !== true) {
    throw new BillingUndoError(400, "UNDO_CONFIRMATION_REQUIRED", "Confirm the payment undo to continue.");
  }
  const expected = roundMoney(input.expectedAmount);
  if (!Number.isFinite(expected) || Math.abs(expected - roundMoney(entry.amount)) > 0.001) {
    throw new BillingUndoError(
      409,
      "UNDO_AMOUNT_MISMATCH",
      "The payment amount no longer matches the selected transaction. Refresh the statement and try again."
    );
  }
  return reason;
}

function snapshotAllocations(schoolId: string, paymentId: string): ReversedPaymentAllocationSnapshot[] {
  return listPaymentAllocations(schoolId, paymentId).map((row) => ({
    id: row.id,
    invoiceId: row.invoiceId,
    feeCategory: row.feeCategory,
    allocatedAmount: row.allocatedAmount,
    ...(row.allocatedBy ? { allocatedBy: row.allocatedBy } : {}),
    createdAt: row.createdAt,
  }));
}

type UndoCommitResult =
  | { kind: "missing" }
  | { kind: "changed" }
  | { kind: "alreadyUndone"; latest: BillingLedgerEntry; correction: BillingLedgerEntry | null }
  | { kind: "created"; original: BillingLedgerEntry; correction: BillingLedgerEntry };

async function alreadyUndoneResult(
  schoolId: string,
  entry: BillingLedgerEntry,
  correction: BillingLedgerEntry
): Promise<UndoBillingTransactionResult> {
  const accounts = await buildAccountsFromAgeAnalysisSnapshots(schoolId);
  return {
    original: entry,
    correction,
    alreadyUndone: true,
    accounts,
    ledgerEntries: collectAccountLedgerSlice(readSchoolLedger(schoolId), entry.accountNo),
  };
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

  const reason = entry.type === "payment" ? assertPaymentUndoAllowed(entry, input) : String(input.reason || "").trim();

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
    return alreadyUndoneResult(schoolId, entry, correction);
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

  const creditNoteBlocked = () =>
    new BillingUndoError(
      409,
      "INVOICE_HAS_CREDIT_NOTES",
      "This invoice has a credit note against it and cannot be undone."
    );
  if (entry.type === "invoice" && creditNotesForInvoice(ledger, entry.id).length) {
    throw creditNoteBlocked();
  }

  const reversedAllocations = entry.type === "payment" ? snapshotAllocations(schoolId, entry.id) : [];
  const actor = input.actor;
  const auditFields = {
    ...(actor?.userId ? { undoneByUserId: actor.userId } : {}),
    ...(actor?.email ? { undoneByEmail: actor.email } : {}),
    ...(actor?.appRole ? { undoneByRole: actor.appRole } : {}),
    ...(reason ? { undoReason: reason } : {}),
  };

  const committed = mutateSchoolLedgerEntries<UndoCommitResult>(schoolId, (current) => {
    const latest = current.find((e) => e.id === entry.id);
    const raced = current.find((e) => e.id === correctionId);
    if (!latest) {
      return { upserts: [], result: { kind: "missing" } };
    }
    if (raced || latest.undoneAt || latest.undoneByCorrectionId) {
      return { upserts: [], result: { kind: "alreadyUndone", latest, correction: raced ?? null } };
    }
    if (latest.type === "payment" && Math.abs(roundMoney(latest.amount) - roundMoney(entry.amount)) > 0.001) {
      return { upserts: [], result: { kind: "changed" } };
    }
    if (latest.type === "invoice" && creditNotesForInvoice(current, latest.id).length) {
      throw creditNoteBlocked();
    }

    const now = new Date().toISOString();
    const correction: BillingLedgerEntry = {
      id: correctionId,
      schoolId,
      learnerId: latest.learnerId,
      accountNo: latest.accountNo,
      type: correctionReversalType(latest.type),
      amount: latest.amount,
      date: latest.date,
      dueDate: latest.dueDate,
      reference: buildCorrectionReference(latest),
      description: `Correction journal (undo ${latest.type})`,
      source: EDUCLEAR_UNDO_CORRECTION_SOURCE,
      correctsEntryId: latest.id,
      statementHidden: true,
      createdAt: now,
      ...auditFields,
      ...(reversedAllocations.length ? { reversedAllocations } : {}),
    };
    const original: BillingLedgerEntry = {
      ...latest,
      statementHidden: true,
      undoneAt: now,
      undoneByCorrectionId: correctionId,
      ...auditFields,
    };
    return { upserts: [original, correction], result: { kind: "created", original, correction } };
  });

  if (committed.kind === "missing") {
    throw new Error("Transaction not found");
  }
  if (committed.kind === "changed") {
    throw new BillingUndoError(
      409,
      "UNDO_AMOUNT_MISMATCH",
      "The payment amount no longer matches the selected transaction. Refresh the statement and try again."
    );
  }
  if (committed.kind === "alreadyUndone") {
    const fresh = readSchoolLedger(schoolId);
    const latest = fresh.find((e) => e.id === entry.id) ?? committed.latest;
    const correction =
      committed.correction ??
      fresh.find((e) => e.id === correctionId) ??
      fresh.find((e) => e.id === String(latest.undoneByCorrectionId || "").trim()) ??
      null;
    if (!correction) {
      throw new Error("This transaction was already undone but the correction journal is missing.");
    }
    return alreadyUndoneResult(schoolId, latest, correction);
  }

  if (entry.type === "payment") {
    clearPaymentAllocations(schoolId, entry.id);
  }

  const accounts = await buildAccountsFromAgeAnalysisSnapshots(schoolId);
  const updatedLedger = readSchoolLedger(schoolId);

  return {
    original: committed.original,
    correction: committed.correction,
    alreadyUndone: false,
    accounts,
    ledgerEntries: collectAccountLedgerSlice(updatedLedger, entry.accountNo),
  };
}
