import crypto from "crypto";

import {
  PAYMENT_UNDO_ALLOWED_ROLES,
  UNDO_REASON_MAX_LENGTH,
  UNDO_REASON_MIN_LENGTH,
  undoCorrectionEntryId,
} from "./billingTransactionUndo";
import {
  EDUCLEAR_CREDIT_NOTE_SOURCE,
  EDUCLEAR_UNDO_CORRECTION_SOURCE,
  creditNotesForInvoice,
  isEduClearCreditNoteEntry,
  isEduClearUndoableLedgerEntry,
  isUndoneLedgerEntry,
} from "../utils/billingDisplayRules";
import {
  mutateSchoolLedgerEntries,
  readSchoolLedger,
  type BillingInvoiceChargeLine,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import { sumAllocationsToInvoiceReadOnly } from "../utils/paymentAllocationStore";

/** Same staff roles as payment undo. */
export const CREDIT_NOTE_ALLOWED_ROLES = PAYMENT_UNDO_ALLOWED_ROLES;

export type CreditNoteActor = {
  userId: string;
  email?: string;
  appRole: string;
};

export type IssueInvoiceLineCreditNoteInput = {
  schoolId: string;
  invoiceId: string;
  lineKey: string;
  actor?: CreditNoteActor | null;
  reason?: string;
  confirm?: boolean;
  /** Line amount staff saw; must match the invoice's snapshotted charge line. */
  expectedAmount?: number | string | null;
  /** Optional line description staff saw; when given it must match. */
  expectedDescription?: string | null;
  /** Test hook for a fixed issue timestamp. */
  now?: Date;
};

export type IssueInvoiceLineCreditNoteResult = {
  invoice: BillingLedgerEntry;
  creditNote: BillingLedgerEntry;
  alreadyIssued: boolean;
  ledgerEntries: BillingLedgerEntry[];
};

export class CreditNoteError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "CreditNoteError";
  }
}

const MONEY_EPS = 0.001;

function reversedLineError(): CreditNoteError {
  return new CreditNoteError(
    409,
    "CREDIT_NOTE_REVERSED",
    "The credit note for this charge line was reversed. It cannot be issued again automatically."
  );
}

function roundMoney(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

/** Deterministic id: one credit note per invoice charge line, ever. */
export function creditNoteEntryId(invoiceId: string, lineKey: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${String(invoiceId || "").trim()}|${String(lineKey || "").trim()}`)
    .digest("hex")
    .slice(0, 32);
  return `credit-note-${digest}`;
}

function assertActorAndIntent(
  input: Pick<IssueInvoiceLineCreditNoteInput, "actor" | "reason" | "confirm">
): { actor: CreditNoteActor; reason: string } {
  const actor = input.actor;
  if (!actor?.userId) {
    throw new CreditNoteError(401, "AUTH_REQUIRED", "Authentication required");
  }
  if (!CREDIT_NOTE_ALLOWED_ROLES.has(String(actor.appRole || "").trim())) {
    throw new CreditNoteError(403, "CREDIT_NOTE_ROLE_REQUIRED", "Owner, Admin or Finance role required to issue a credit note.");
  }
  const reason = String(input.reason || "").trim();
  if (reason.length < UNDO_REASON_MIN_LENGTH) {
    throw new CreditNoteError(400, "CREDIT_NOTE_REASON_REQUIRED", "Enter a reason for this credit note.");
  }
  if (reason.length > UNDO_REASON_MAX_LENGTH) {
    throw new CreditNoteError(400, "CREDIT_NOTE_REASON_TOO_LONG", "Credit note reason is too long.");
  }
  if (input.confirm !== true) {
    throw new CreditNoteError(400, "CREDIT_NOTE_CONFIRMATION_REQUIRED", "Confirm the credit note to continue.");
  }
  return { actor, reason };
}

function findChargeLine(invoice: BillingLedgerEntry, lineKey: string): BillingInvoiceChargeLine {
  const lines = Array.isArray(invoice.chargeLines) ? invoice.chargeLines : [];
  const matches = lines.filter((line) => String(line?.lineKey || "").trim() === lineKey);
  if (!matches.length) {
    throw new CreditNoteError(404, "CHARGE_LINE_NOT_FOUND", "That charge line is not on this invoice.");
  }
  if (matches.length > 1) {
    throw new CreditNoteError(409, "CHARGE_LINE_AMBIGUOUS", "This invoice has more than one charge line with that key.");
  }
  return matches[0];
}

/** All checks that must hold before (and again inside the ledger lock) a credit note is written. */
function assertCreditable(
  schoolId: string,
  ledger: BillingLedgerEntry[],
  invoice: BillingLedgerEntry,
  line: BillingInvoiceChargeLine,
  creditId: string
): { amount: number; overAllocated: number } {
  if (isUndoneLedgerEntry(invoice)) {
    throw new CreditNoteError(409, "INVOICE_UNDONE", "This invoice has been undone and cannot be credited.");
  }
  if (!isEduClearUndoableLedgerEntry(invoice)) {
    throw new CreditNoteError(400, "INVOICE_NOT_CREDITABLE", "Only EduClear-generated invoices can be credited.");
  }
  const amount = roundMoney(line.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new CreditNoteError(400, "CHARGE_LINE_NOT_CREDITABLE", "Only positive charge lines can be credited.");
  }

  const existing = creditNotesForInvoice(ledger, invoice.id).filter((entry) => entry.id !== creditId);
  if (existing.some((entry) => String(entry.creditNoteLineKey || "").trim() === String(line.lineKey).trim())) {
    throw new CreditNoteError(409, "CHARGE_LINE_ALREADY_CREDITED", "This charge line already has a credit note.");
  }
  const alreadyCredited = roundMoney(existing.reduce((sum, entry) => sum + roundMoney(entry.amount), 0));
  const invoiceAmount = roundMoney(invoice.amount);
  if (alreadyCredited + amount > invoiceAmount + MONEY_EPS) {
    throw new CreditNoteError(409, "CREDIT_EXCEEDS_INVOICE", "Credit notes would exceed the invoice amount.");
  }

  // Allocations are payment history and stay as captured. Any part of this credit already covered by
  // payments allocated to the invoice remains on the family account as credit (balance and FIFO are ledger-based).
  const allocated = sumAllocationsToInvoiceReadOnly(schoolId, invoice.id);
  const overAllocated = roundMoney(Math.min(amount, Math.max(0, allocated - (invoiceAmount - alreadyCredited - amount))));
  return { amount, overAllocated };
}

function accountSlice(entries: BillingLedgerEntry[], accountNo: string): BillingLedgerEntry[] {
  const ref = String(accountNo || "").trim().toUpperCase();
  if (!ref) return [];
  return entries.filter((entry) => String(entry.accountNo || "").trim().toUpperCase() === ref);
}

function buildCreditNote(
  schoolId: string,
  invoice: BillingLedgerEntry,
  line: BillingInvoiceChargeLine,
  amount: number,
  overAllocated: number,
  creditId: string,
  actor: CreditNoteActor,
  reason: string,
  now: Date
): BillingLedgerEntry {
  const invoiceRef = String(invoice.reference || invoice.id).trim();
  const reference = `CN-${invoiceRef}`;
  return {
    id: creditId,
    schoolId,
    learnerId: invoice.learnerId,
    accountNo: invoice.accountNo,
    ...(invoice.billedLearnerId ? { billedLearnerId: invoice.billedLearnerId } : {}),
    ...(invoice.familyAccountId ? { familyAccountId: invoice.familyAccountId } : {}),
    type: "credit",
    amount,
    date: now.toISOString().slice(0, 10),
    reference: reference.length > 120 ? reference.slice(0, 120) : reference,
    description: `Credit note: ${String(line.description || "").trim()} (${invoiceRef})`,
    source: EDUCLEAR_CREDIT_NOTE_SOURCE,
    creditNoteInvoiceId: invoice.id,
    creditNoteLineKey: String(line.lineKey).trim(),
    creditNoteReason: reason,
    ...(overAllocated > 0 ? { creditNoteCoveredByAllocations: overAllocated } : {}),
    issuedByUserId: actor.userId,
    ...(actor.email ? { issuedByEmail: actor.email } : {}),
    issuedByRole: actor.appRole,
    createdAt: now.toISOString(),
  };
}

type CommitResult =
  | { kind: "created"; invoice: BillingLedgerEntry; creditNote: BillingLedgerEntry }
  | { kind: "alreadyIssued"; invoice: BillingLedgerEntry; creditNote: BillingLedgerEntry };

/**
 * Issue one audited credit note reversing a single snapshotted charge line of an EduClear invoice.
 * The invoice, its charge lines, other entries and payment allocations are never modified.
 */
export function issueInvoiceLineCreditNote(
  input: IssueInvoiceLineCreditNoteInput
): IssueInvoiceLineCreditNoteResult {
  const schoolId = String(input.schoolId || "").trim();
  const invoiceId = String(input.invoiceId || "").trim();
  const lineKey = String(input.lineKey || "").trim();
  if (!schoolId || !invoiceId || !lineKey) {
    throw new CreditNoteError(400, "INVALID_REQUEST", "Missing schoolId, invoice id or line key");
  }
  const { actor, reason } = assertActorAndIntent(input);

  const ledger = readSchoolLedger(schoolId);
  const invoice = ledger.find((entry) => entry.id === invoiceId);
  if (!invoice) {
    throw new CreditNoteError(404, "INVOICE_NOT_FOUND", "Invoice not found");
  }
  if (invoice.type !== "invoice") {
    throw new CreditNoteError(400, "NOT_AN_INVOICE", "Credit notes can only be issued against invoices.");
  }
  const line = findChargeLine(invoice, lineKey);

  const expected = roundMoney(input.expectedAmount);
  if (!Number.isFinite(expected) || Math.abs(expected - roundMoney(line.amount)) > MONEY_EPS) {
    throw new CreditNoteError(
      409,
      "CREDIT_NOTE_AMOUNT_MISMATCH",
      "The charge line amount no longer matches. Refresh the statement and try again."
    );
  }
  const expectedDescription = String(input.expectedDescription ?? "").trim();
  if (expectedDescription && expectedDescription !== String(line.description || "").trim()) {
    throw new CreditNoteError(
      409,
      "CREDIT_NOTE_DESCRIPTION_MISMATCH",
      "The charge line description no longer matches. Refresh the statement and try again."
    );
  }

  const creditId = creditNoteEntryId(invoice.id, lineKey);
  const existing = ledger.find((entry) => entry.id === creditId);
  if (existing) {
    if (isUndoneLedgerEntry(existing)) throw reversedLineError();
    return { invoice, creditNote: existing, alreadyIssued: true, ledgerEntries: accountSlice(ledger, invoice.accountNo) };
  }
  assertCreditable(schoolId, ledger, invoice, line, creditId);

  const lineSnapshot = JSON.stringify(line);
  const now = input.now ?? new Date();
  const committed = mutateSchoolLedgerEntries<CommitResult>(schoolId, (current) => {
    const latest = current.find((entry) => entry.id === invoice.id);
    if (!latest || latest.type !== "invoice") {
      throw new CreditNoteError(404, "INVOICE_NOT_FOUND", "Invoice not found");
    }
    const raced = current.find((entry) => entry.id === creditId);
    if (raced) {
      if (isUndoneLedgerEntry(raced)) throw reversedLineError();
      return { upserts: [], result: { kind: "alreadyIssued", invoice: latest, creditNote: raced } };
    }
    if (
      roundMoney(latest.amount) !== roundMoney(invoice.amount) ||
      JSON.stringify(findChargeLine(latest, lineKey)) !== lineSnapshot
    ) {
      throw new CreditNoteError(409, "INVOICE_CHANGED", "The invoice changed. Refresh the statement and try again.");
    }
    const { amount, overAllocated } = assertCreditable(schoolId, current, latest, line, creditId);
    const creditNote = buildCreditNote(schoolId, latest, line, amount, overAllocated, creditId, actor, reason, now);
    return { upserts: [creditNote], result: { kind: "created", invoice: latest, creditNote } };
  });

  const updated = readSchoolLedger(schoolId);
  return {
    invoice: committed.invoice,
    creditNote: committed.creditNote,
    alreadyIssued: committed.kind === "alreadyIssued",
    ledgerEntries: accountSlice(updated, invoice.accountNo),
  };
}

export type ReverseInvoiceLineCreditNoteInput = {
  schoolId: string;
  creditNoteId: string;
  actor?: CreditNoteActor | null;
  reason?: string;
  confirm?: boolean;
  /** Credit note amount staff saw; must match the ledger row. */
  expectedAmount?: number | string | null;
  /** Test hook for a fixed reversal timestamp. */
  now?: Date;
};

export type ReverseInvoiceLineCreditNoteResult = {
  creditNote: BillingLedgerEntry;
  correction: BillingLedgerEntry;
  alreadyReversed: boolean;
  ledgerEntries: BillingLedgerEntry[];
};

type ReverseCommitResult =
  | { kind: "reversed" | "alreadyReversed"; creditNote: BillingLedgerEntry; correction: BillingLedgerEntry | null };

/**
 * Audited reversal of an EduClear credit note, using the same correction-journal pattern as Undo:
 * the credit note is kept and marked undone (who, when, why) and a hidden offsetting correction is added.
 * Nothing is deleted. The correction is account-level (no learner id) so it can never count as a
 * learner's invoice for an invoice-run period.
 */
export function reverseInvoiceLineCreditNote(
  input: ReverseInvoiceLineCreditNoteInput
): ReverseInvoiceLineCreditNoteResult {
  const schoolId = String(input.schoolId || "").trim();
  const creditNoteId = String(input.creditNoteId || "").trim();
  if (!schoolId || !creditNoteId) {
    throw new CreditNoteError(400, "INVALID_REQUEST", "Missing schoolId or credit note id");
  }
  const { actor, reason } = assertActorAndIntent(input);

  const ledger = readSchoolLedger(schoolId);
  const note = ledger.find((entry) => entry.id === creditNoteId);
  if (!note) {
    throw new CreditNoteError(404, "CREDIT_NOTE_NOT_FOUND", "Credit note not found");
  }
  if (!isEduClearCreditNoteEntry(note)) {
    throw new CreditNoteError(400, "NOT_A_CREDIT_NOTE", "Only EduClear credit notes can be reversed here.");
  }
  const expected = roundMoney(input.expectedAmount);
  if (!Number.isFinite(expected) || Math.abs(expected - roundMoney(note.amount)) > MONEY_EPS) {
    throw new CreditNoteError(409, "CREDIT_NOTE_AMOUNT_MISMATCH", "The credit note amount no longer matches. Refresh and try again.");
  }

  const correctionId = undoCorrectionEntryId(note.id);
  const now = input.now ?? new Date();
  const auditFields = {
    undoneByUserId: actor.userId,
    ...(actor.email ? { undoneByEmail: actor.email } : {}),
    undoneByRole: actor.appRole,
    undoReason: reason,
  };

  const committed = mutateSchoolLedgerEntries<ReverseCommitResult>(schoolId, (current) => {
    const latest = current.find((entry) => entry.id === note.id);
    if (!latest || !isEduClearCreditNoteEntry(latest)) {
      throw new CreditNoteError(404, "CREDIT_NOTE_NOT_FOUND", "Credit note not found");
    }
    const raced = current.find((entry) => entry.id === correctionId) ?? null;
    if (raced || isUndoneLedgerEntry(latest)) {
      return { upserts: [], result: { kind: "alreadyReversed", creditNote: latest, correction: raced } };
    }
    if (Math.abs(roundMoney(latest.amount) - roundMoney(note.amount)) > MONEY_EPS) {
      throw new CreditNoteError(409, "CREDIT_NOTE_AMOUNT_MISMATCH", "The credit note amount no longer matches. Refresh and try again.");
    }
    const at = now.toISOString();
    const base = String(latest.reference || latest.id).trim();
    const correction: BillingLedgerEntry = {
      id: correctionId,
      schoolId,
      learnerId: "",
      accountNo: latest.accountNo,
      ...(latest.familyAccountId ? { familyAccountId: latest.familyAccountId } : {}),
      type: "invoice",
      amount: latest.amount,
      date: latest.date,
      reference: `CORRECTION-${base}`.slice(0, 120),
      description: "Correction journal (reverse credit note)",
      source: EDUCLEAR_UNDO_CORRECTION_SOURCE,
      correctsEntryId: latest.id,
      statementHidden: true,
      createdAt: at,
      ...auditFields,
    };
    const reversed: BillingLedgerEntry = {
      ...latest,
      statementHidden: true,
      undoneAt: at,
      undoneByCorrectionId: correctionId,
      ...auditFields,
    };
    return { upserts: [reversed, correction], result: { kind: "reversed", creditNote: reversed, correction } };
  });

  const updated = readSchoolLedger(schoolId);
  const correction =
    committed.correction ??
    updated.find((entry) => entry.id === correctionId) ??
    updated.find((entry) => entry.id === String(committed.creditNote.undoneByCorrectionId || "").trim()) ??
    null;
  if (!correction) {
    throw new CreditNoteError(500, "CORRECTION_MISSING", "This credit note was reversed but its correction journal is missing.");
  }
  return {
    creditNote: committed.creditNote,
    correction,
    alreadyReversed: committed.kind === "alreadyReversed",
    ledgerEntries: accountSlice(updated, note.accountNo),
  };
}
