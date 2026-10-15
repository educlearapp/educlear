/**
 * Line-level credit note: audited reversal of one invoice charge line (e.g. duplicated R400 graduation).
 * Uses isolated fixture files in a temp directory — never touches repo or production data.
 * Run: npx tsx src/services/invoiceLineCreditNote.test.ts
 */
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import {
  CreditNoteError,
  creditNoteEntryId,
  issueInvoiceLineCreditNote,
  reverseInvoiceLineCreditNote,
  type CreditNoteActor,
} from "./invoiceLineCreditNote";
import { BillingUndoError, undoBillingTransaction } from "./billingTransactionUndo";
import { undoInvoiceRun } from "./invoiceRunUndoService";
import { buildStatementManageTransactions, buildStatementTransactions } from "./statementTransactionBuilder";
import { resolveAuthoritativeAccountBalanceFromSnapshot } from "./statementAccounts";
import { buildTransactionExport, filterLedgerForTransactionExport } from "./billingTransactionExport";
import {
  buildLearnerInvoicePeriodIndex,
  computeOpenInvoiceLines,
  learnerHasInvoiceForPeriod,
  readSchoolLedger,
  setBillingLedgerStoreDataDirForTests,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import { setPaymentAllocationStoreDataDirForTests, sumAllocationsToInvoiceReadOnly } from "../utils/paymentAllocationStore";
import { shouldShowLedgerEntryOnStatement } from "../utils/billingDisplayRules";
import type { FamilyAccountAgeAnalysisSnapshot } from "../utils/familyAccountAgeAnalysisStore";

const SCHOOL = "test-credit-note-fixture";
const RUN = `draft:${SCHOOL}:2026-11`;
const INV_A = `invoice-${RUN}-learner-a`;
const INV_B = `invoice-${RUN}-learner-b`;
const INV_C = `invoice-${RUN}-learner-c`;
const INV_IMPORTED = "kidesys-invoice-fixture-0001";
const INV_UNDONE = `invoice-${RUN}-learner-undone`;
const GRAD_A = "line-grad-a";
const GRAD_B = "line-grad-b";
const GRAD_C = "line-grad-c";
const INV_D = `invoice-${RUN}-learner-d`;
const GRAD_D = "line-grad-d";
const NOW = new Date("2026-10-20T08:00:00.000Z");

const FINANCE: CreditNoteActor = { userId: "user-finance", email: "finance@test.local", appRole: "Finance" };
const TEACHER: CreditNoteActor = { userId: "user-teacher", email: "teacher@test.local", appRole: "Teacher" };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function sha(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function novemberInvoice(id: string, accountNo: string, learnerId: string, gradKey: string): BillingLedgerEntry {
  return {
    id,
    schoolId: SCHOOL,
    learnerId,
    accountNo,
    type: "invoice",
    amount: 3650,
    date: "2026-10-15",
    dueDate: "2026-11-03",
    reference: `INV-${accountNo}`,
    description: "PRE-PRIMARY 2026 CRECHE AND GRADE R HALF DAY; Grade R Graduation; JAMF Fee",
    runId: RUN,
    invoicePeriod: "2026-11",
    lineKey: learnerId,
    billedLearnerId: learnerId,
    chargeLines: [
      { lineKey: `line-tuition-${learnerId}`, description: "PRE-PRIMARY 2026 CRECHE AND GRADE R HALF DAY", amount: 2800 },
      { lineKey: gradKey, description: "Grade R Graduation", amount: 400 },
      { lineKey: `line-jamf-${learnerId}`, description: "JAMF Fee", amount: 450 },
    ],
    createdAt: "2026-10-15T07:16:05.120Z",
  };
}

function fixtureLedger(): BillingLedgerEntry[] {
  return [
    {
      id: `invoice-draft:${SCHOOL}:2026-10-learner-a`,
      schoolId: SCHOOL,
      learnerId: "learner-a",
      accountNo: "GRA001",
      type: "invoice",
      amount: 3200,
      date: "2026-09-16",
      reference: "INV-OCT-GRA001",
      description: "Invoice Run For October 2026",
      runId: `draft:${SCHOOL}:2026-10`,
      invoicePeriod: "2026-10",
      billedLearnerId: "learner-a",
      createdAt: "2026-09-16T07:00:00.000Z",
    },
    novemberInvoice(INV_A, "GRA001", "learner-a", GRAD_A),
    novemberInvoice(INV_B, "GRB002", "learner-b", GRAD_B),
    novemberInvoice(INV_C, "GRC003", "learner-c", GRAD_C),
    novemberInvoice(INV_D, "GRD006", "learner-d", GRAD_D),
    { ...novemberInvoice(INV_UNDONE, "GRU004", "learner-u", "line-grad-u"), undoneAt: "2026-10-16T08:00:00.000Z", undoneByCorrectionId: "undo-corr-x", statementHidden: true },
    {
      id: INV_IMPORTED,
      schoolId: SCHOOL,
      learnerId: "",
      accountNo: "GRI005",
      type: "invoice",
      amount: 400,
      date: "2026-03-16",
      reference: "INVOICE 65186",
      description: "invoice",
      source: "kideesys-transaction",
      chargeLines: [{ lineKey: "imported-line", description: "Grade R Graduation", amount: 400 }],
      createdAt: "2026-05-28T08:38:50.489Z",
    },
    {
      id: "pay-gra001-0001",
      schoolId: SCHOOL,
      learnerId: "",
      accountNo: "GRA001",
      type: "payment",
      amount: 3250,
      date: "2026-10-18",
      reference: "PAY-20261018-GRA001-001",
      description: "Payment",
      method: "EFT",
      source: "manual",
      createdAt: "2026-10-18T07:00:00.000Z",
    },
    {
      id: "pay-grb002-0001",
      schoolId: SCHOOL,
      learnerId: "",
      accountNo: "GRB002",
      type: "payment",
      amount: 3650,
      date: "2026-10-18",
      reference: "PAY-20261018-GRB002-001",
      description: "Payment",
      method: "EFT",
      source: "manual",
      createdAt: "2026-10-18T07:00:00.000Z",
    },
  ];
}

function fixtureAllocations() {
  return {
    [SCHOOL]: {
      "pay-gra001-0001": [
        { id: "palloc-a", paymentId: "pay-gra001-0001", schoolId: SCHOOL, accountRef: "GRA001", invoiceId: INV_A, feeCategory: null, allocatedAmount: 3250, createdAt: "2026-10-18T07:00:01.000Z" },
      ],
      "pay-grb002-0001": [
        { id: "palloc-b", paymentId: "pay-grb002-0001", schoolId: SCHOOL, accountRef: "GRB002", invoiceId: INV_B, feeCategory: null, allocatedAmount: 3650, createdAt: "2026-10-18T07:00:01.000Z" },
      ],
    },
  };
}

const SNAPSHOTS: Record<string, FamilyAccountAgeAnalysisSnapshot> = {
  GRA001: { accountRef: "GRA001", balance: 0, importedAt: "2026-05-28T08:38:50.489Z" } as FamilyAccountAgeAnalysisSnapshot,
  GRB002: { accountRef: "GRB002", balance: 0, importedAt: "2099-01-01T00:00:00.000Z" } as FamilyAccountAgeAnalysisSnapshot,
  GRC003: { accountRef: "GRC003", balance: 0, importedAt: "2099-01-01T00:00:00.000Z" } as FamilyAccountAgeAnalysisSnapshot,
  GRD006: { accountRef: "GRD006", balance: 0, importedAt: "2099-01-01T00:00:00.000Z" } as FamilyAccountAgeAnalysisSnapshot,
};

function createFixtureDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "credit-note-"));
  fs.writeFileSync(path.join(dir, "billing-ledger.json"), JSON.stringify({ [SCHOOL]: fixtureLedger() }, null, 2));
  fs.writeFileSync(path.join(dir, "payment-allocations.json"), JSON.stringify(fixtureAllocations(), null, 2));
  return dir;
}

function useFixtureDir(dir: string) {
  setBillingLedgerStoreDataDirForTests(dir);
  setPaymentAllocationStoreDataDirForTests(dir);
}

function files(dir: string): string[] {
  return [sha(path.join(dir, "billing-ledger.json")), sha(path.join(dir, "payment-allocations.json"))];
}

function balanceOf(accountRef: string, ledger: BillingLedgerEntry[]): number {
  const entries = ledger.filter((e) => String(e.accountNo).toUpperCase() === accountRef);
  return resolveAuthoritativeAccountBalanceFromSnapshot(SNAPSHOTS[accountRef], entries);
}

function manageRows(ledger: BillingLedgerEntry[], accountRef: string, showCorrectionsAudit = false) {
  const scoped = ledger.filter((e) => e.accountNo === accountRef);
  return buildStatementManageTransactions({
    schoolId: SCHOOL,
    accountRef,
    ledgerEntries: scoped,
    periodFilteredEntries: scoped,
    period: "all",
    nameByLearnerId: new Map(),
    openingBalance: 0,
    showCorrectionsAudit,
  });
}

const good = (overrides: Record<string, unknown> = {}) => ({
  schoolId: SCHOOL,
  invoiceId: INV_A,
  lineKey: GRAD_A,
  actor: FINANCE,
  reason: "Graduation fee already billed on October invoice",
  confirm: true,
  expectedAmount: 400,
  expectedDescription: "Grade R Graduation",
  now: NOW,
  ...overrides,
});

function expectRejected(name: string, dir: string, run: () => unknown, code: string) {
  const before = files(dir);
  let caught: unknown = null;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof CreditNoteError, `${name}: expected CreditNoteError, got ${String((caught as Error)?.message)}`);
  assert(caught.code === code, `${name}: expected ${code}, got ${caught.code}`);
  const after = files(dir);
  assert(before[0] === after[0] && before[1] === after[1], `${name}: fixture files must be unchanged`);
  console.log(`  ✓ ${name} -> ${code}`);
}

function testRejections(dir: string) {
  console.log("Rejected credit notes leave ledger and allocations byte-identical");
  expectRejected("no authenticated actor", dir, () => issueInvoiceLineCreditNote(good({ actor: null })), "AUTH_REQUIRED");
  expectRejected("Teacher role", dir, () => issueInvoiceLineCreditNote(good({ actor: TEACHER })), "CREDIT_NOTE_ROLE_REQUIRED");
  expectRejected("Viewer role", dir, () => issueInvoiceLineCreditNote(good({ actor: { ...TEACHER, appRole: "Viewer" } })), "CREDIT_NOTE_ROLE_REQUIRED");
  expectRejected("missing reason", dir, () => issueInvoiceLineCreditNote(good({ reason: "  " })), "CREDIT_NOTE_REASON_REQUIRED");
  expectRejected("no confirmation", dir, () => issueInvoiceLineCreditNote(good({ confirm: false })), "CREDIT_NOTE_CONFIRMATION_REQUIRED");
  expectRejected("wrong amount shown (R450)", dir, () => issueInvoiceLineCreditNote(good({ expectedAmount: 450 })), "CREDIT_NOTE_AMOUNT_MISMATCH");
  expectRejected("missing amount", dir, () => issueInvoiceLineCreditNote(good({ expectedAmount: null })), "CREDIT_NOTE_AMOUNT_MISMATCH");
  expectRejected("wrong description shown", dir, () => issueInvoiceLineCreditNote(good({ expectedDescription: "JAMF Fee" })), "CREDIT_NOTE_DESCRIPTION_MISMATCH");
  expectRejected("unknown charge line", dir, () => issueInvoiceLineCreditNote(good({ lineKey: "nope" })), "CHARGE_LINE_NOT_FOUND");
  expectRejected("unknown invoice", dir, () => issueInvoiceLineCreditNote(good({ invoiceId: "nope" })), "INVOICE_NOT_FOUND");
  expectRejected("payment id instead of invoice", dir, () => issueInvoiceLineCreditNote(good({ invoiceId: "pay-gra001-0001" })), "NOT_AN_INVOICE");
  expectRejected("imported Kid-e-Sys invoice", dir, () => issueInvoiceLineCreditNote(good({ invoiceId: INV_IMPORTED, lineKey: "imported-line" })), "INVOICE_NOT_CREDITABLE");
  expectRejected("undone invoice", dir, () => issueInvoiceLineCreditNote(good({ invoiceId: INV_UNDONE, lineKey: "line-grad-u" })), "INVOICE_UNDONE");
}

function testIssue(dir: string) {
  console.log("Authorised credit note on GRA001 graduation line (Finance)");
  const before = readSchoolLedger(SCHOOL).map((e) => ({ ...e }));
  const allocBefore = files(dir)[1];
  const balanceBefore = { GRA001: balanceOf("GRA001", before), GRB002: balanceOf("GRB002", before), GRC003: balanceOf("GRC003", before) };
  const openBefore = computeOpenInvoiceLines(before, "learner-a", "GRA001");

  const result = issueInvoiceLineCreditNote(good());
  assert(result.alreadyIssued === false, "first call creates the credit note");

  const after = readSchoolLedger(SCHOOL);
  const note = after.find((e) => e.id === creditNoteEntryId(INV_A, GRAD_A))!;
  assert(note, "credit note row exists with deterministic id");
  assert(note.type === "credit" && note.amount === 400 && note.source === "educlear_credit_note", "credit R400");
  assert(note.creditNoteInvoiceId === INV_A && note.creditNoteLineKey === GRAD_A, "linked to invoice + line");
  assert(note.accountNo === "GRA001" && note.learnerId === "learner-a" && note.billedLearnerId === "learner-a", "same account/learner as invoice");
  assert(note.issuedByUserId === "user-finance" && note.issuedByRole === "Finance" && note.issuedByEmail === "finance@test.local", "actor recorded");
  assert(note.creditNoteReason === "Graduation fee already billed on October invoice", "reason recorded");
  assert(note.date === "2026-10-20" && note.createdAt === NOW.toISOString(), "issue date recorded");
  assert(note.reference === "CN-INV-GRA001" && note.description === "Credit note: Grade R Graduation (INV-GRA001)", "reference/description");
  assert(!note.correctsEntryId && !note.statementHidden && !note.runId && !note.invoicePeriod, "not a correction journal, not hidden, not part of any run/period");

  assert(after.length === before.length + 1, "exactly one row added, none deleted");
  assert(
    JSON.stringify(after.filter((e) => e.id !== note.id)) === JSON.stringify(before),
    "all existing rows (invoice A incl. charge lines, October invoice, other accounts) byte-identical"
  );
  assert(files(dir)[1] === allocBefore, "payment allocations file untouched");

  assert(balanceOf("GRA001", after) === balanceBefore.GRA001 - 400, `GRA001 balance -R400 (${balanceBefore.GRA001} -> ${balanceOf("GRA001", after)})`);
  assert(balanceOf("GRB002", after) === balanceBefore.GRB002 && balanceOf("GRC003", after) === balanceBefore.GRC003, "other balances unchanged");
  const openAfter = computeOpenInvoiceLines(after, "learner-a", "GRA001");
  const unpaid = (rows: typeof openAfter) => rows.reduce((s, r) => s + r.unpaid, 0);
  assert(unpaid(openAfter) === unpaid(openBefore) - 400, "open invoice amount reduced by R400");
  assert(learnerHasInvoiceForPeriod(after, "learner-a", "2026-11"), "November invoice still counts for duplicate-run protection");
  console.log(`  ✓ one linked credit R400, invoice untouched, allocations untouched, GRA001 ${balanceBefore.GRA001} -> ${balanceOf("GRA001", after)}, others unchanged`);

  const filesBefore = files(dir);
  const again = issueInvoiceLineCreditNote(good({ reason: "Second click" }));
  assert(again.alreadyIssued === true && again.creditNote.id === note.id, "second call reports alreadyIssued");
  assert(JSON.stringify(files(dir)) === JSON.stringify(filesBefore), "second call writes nothing");
  assert(readSchoolLedger(SCHOOL).filter((e) => e.creditNoteInvoiceId === INV_A).length === 1, "exactly one credit note for the line");
  console.log("  ✓ duplicate request is a no-op (exactly once)");

  assert(note.creditNoteCoveredByAllocations === undefined, "partially paid GRA001: R3,250 allocated fits the R3,250 net, no family credit recorded");

  const gradD = issueInvoiceLineCreditNote(good({ invoiceId: INV_D, lineKey: GRAD_D }));
  const jamfD = issueInvoiceLineCreditNote(good({ invoiceId: INV_D, lineKey: "line-jamf-learner-d", expectedAmount: 450, expectedDescription: "JAMF Fee" }));
  assert(!gradD.alreadyIssued && !jamfD.alreadyIssued && gradD.creditNote.id !== jamfD.creditNote.id, "two lines on one invoice -> two separate credit notes");
  assert(balanceOf("GRD006", readSchoolLedger(SCHOOL)) === 3650 - 850, "GRD006 balance 3650 - 400 - 450");
  assert(!gradD.creditNote.creditNoteCoveredByAllocations && !jamfD.creditNote.creditNoteCoveredByAllocations, "unpaid GRD006: nothing covered by allocations");
  console.log("  ✓ two separate line credits on unpaid GRD006");
}

function testPaidInvoiceTreatment(dir: string) {
  console.log("Partially and fully paid invoices");
  const ledger = readSchoolLedger(SCHOOL);
  assert(sumAllocationsToInvoiceReadOnly(SCHOOL, INV_A) === 3250, "GRA001 was partially paid (R3,250 of R3,650)");
  const creditedA = ledger.filter((e) => e.creditNoteInvoiceId === INV_A).reduce((s, e) => s + e.amount, 0);
  assert(3650 - creditedA === 3250, "after the R400 credit the invoice nets to exactly the R3,250 allocated to it");
  const owing = computeOpenInvoiceLines(ledger, "learner-a", "GRA001").reduce((s, l) => s + l.unpaid, 0);
  assert(owing === balanceOf("GRA001", ledger), `amount owing ${owing} = account balance ${balanceOf("GRA001", ledger)} (October invoice still open)`);
  console.log(`  ✓ partially paid: R3,250 allocation unchanged and now covers the invoice net of credit; owing R${owing} = balance`);

  const balanceBefore = balanceOf("GRB002", ledger);
  const allocSha = files(dir)[1];
  const result = issueInvoiceLineCreditNote(good({ invoiceId: INV_B, lineKey: GRAD_B }));
  assert(!result.alreadyIssued && result.creditNote.amount === 400, "fully paid invoice credited without touching its allocation");
  assert(result.creditNote.creditNoteCoveredByAllocations === 400, "credit note records that R400 was already paid (becomes family credit)");
  assert(files(dir)[1] === allocSha, "payment allocations byte-identical (original R3,650 allocation preserved)");
  assert(sumAllocationsToInvoiceReadOnly(SCHOOL, INV_B) === 3650, "allocation still R3,650 as captured");
  const after = readSchoolLedger(SCHOOL);
  assert(balanceOf("GRB002", after) === balanceBefore - 400, `fully paid account ends R400 in credit (${balanceBefore} -> ${balanceOf("GRB002", after)})`);
  assert(computeOpenInvoiceLines(after, "learner-b", "GRB002").length === 0, "nothing owing on the fully paid account");
  const december: BillingLedgerEntry = { ...novemberInvoice("invoice-dec-b", "GRB002", "learner-b", "line-grad-dec-b"), invoicePeriod: "2026-12", runId: "dec", date: "2026-11-15", amount: 3250, chargeLines: [] };
  const openDec = computeOpenInvoiceLines([...after, december], "learner-b", "GRB002");
  assert(openDec.length === 1 && openDec[0].unpaid === 2850, "family credit R400 is applied to the next invoice (R3,250 -> R2,850 owing)");
  console.log(`  ✓ fully paid: credited directly, allocation unchanged, account R${balanceBefore} -> R${balanceOf("GRB002", after)}; the R400 family credit offsets the next invoice`);
}

async function testReversal(dir: string) {
  console.log("Audited credit-note reversal");
  const noteId = creditNoteEntryId(INV_A, GRAD_A);
  const REV_NOW = new Date("2026-10-21T09:00:00.000Z");
  const rev = (overrides: Record<string, unknown> = {}) =>
    reverseInvoiceLineCreditNote({ schoolId: SCHOOL, creditNoteId: noteId, actor: FINANCE, reason: "Credit note issued in error", confirm: true, expectedAmount: 400, now: REV_NOW, ...overrides } as Parameters<typeof reverseInvoiceLineCreditNote>[0]);
  expectRejected("reverse: no actor", dir, () => rev({ actor: null }), "AUTH_REQUIRED");
  expectRejected("reverse: Teacher role", dir, () => rev({ actor: TEACHER }), "CREDIT_NOTE_ROLE_REQUIRED");
  expectRejected("reverse: no reason", dir, () => rev({ reason: "" }), "CREDIT_NOTE_REASON_REQUIRED");
  expectRejected("reverse: no confirmation", dir, () => rev({ confirm: false }), "CREDIT_NOTE_CONFIRMATION_REQUIRED");
  expectRejected("reverse: wrong amount shown", dir, () => rev({ expectedAmount: 450 }), "CREDIT_NOTE_AMOUNT_MISMATCH");
  expectRejected("reverse: an invoice is not a credit note", dir, () => rev({ creditNoteId: INV_A }), "NOT_A_CREDIT_NOTE");
  expectRejected("reverse: unknown id", dir, () => rev({ creditNoteId: "nope" }), "CREDIT_NOTE_NOT_FOUND");

  const before = readSchoolLedger(SCHOOL).map((e) => ({ ...e }));
  const original = before.find((e) => e.id === noteId)!;
  const balanceBefore = balanceOf("GRA001", before);
  const allocSha = files(dir)[1];
  const result = rev();
  assert(!result.alreadyReversed, "first reversal creates the correction");
  const after = readSchoolLedger(SCHOOL);
  const note = after.find((e) => e.id === noteId)!;
  const corr = after.find((e) => e.id === result.correction.id)!;
  assert(after.length === before.length + 1, "nothing deleted; exactly one correction row added");
  const { statementHidden, undoneAt, undoneByCorrectionId, undoneByUserId, undoneByEmail, undoneByRole, undoReason, ...kept } = note;
  assert(JSON.stringify(kept) === JSON.stringify(original), "original credit note preserved (amount, link, issuer, reason, dates)");
  assert(statementHidden === true && undoneAt === REV_NOW.toISOString() && undoneByCorrectionId === corr.id, "credit note marked reversed with timestamp and link");
  assert(undoneByUserId === "user-finance" && undoneByEmail === "finance@test.local" && undoneByRole === "Finance" && undoReason === "Credit note issued in error", "reversal actor and reason recorded");
  assert(corr.type === "invoice" && corr.amount === 400 && corr.correctsEntryId === noteId && corr.statementHidden === true && corr.source === "educlear_undo_correction", "hidden offsetting correction journal");
  assert(corr.learnerId === "" && buildLearnerInvoicePeriodIndex([corr]).size === 0, "correction can never count as a learner invoice for a run period");
  assert(corr.undoReason === "Credit note issued in error" && corr.undoneByUserId === "user-finance", "correction carries the same audit fields");
  assert(JSON.stringify(after.filter((e) => e.id !== noteId && e.id !== corr.id)) === JSON.stringify(before.filter((e) => e.id !== noteId)), "all other rows byte-identical");
  assert(files(dir)[1] === allocSha, "allocations untouched");
  assert(balanceOf("GRA001", after) === balanceBefore + 400, `balance restored (+R400): ${balanceBefore} -> ${balanceOf("GRA001", after)}`);
  const owing = computeOpenInvoiceLines(after, "learner-a", "GRA001").reduce((s, l) => s + l.unpaid, 0);
  assert(owing === balanceOf("GRA001", after), `amount owing ${owing} = balance after reversal`);
  console.log(`  ✓ reversed: credit note kept with who/when/why, hidden correction added, GRA001 R${balanceBefore} -> R${balanceOf("GRA001", after)}, allocations untouched`);

  const staff = manageRows(after, "GRA001");
  assert(!staff.some((r) => r.ledgerEntryId === noteId || r.ledgerEntryId === corr.id), "normal statement hides reversed note and its correction");
  const closing = staff.reduce((s, r) => s + Number(r.amountIn || 0) - Number(r.amountOut || 0), 0);
  assert(closing === balanceOf("GRA001", after), `statement closing ${closing} = balance`);
  const audit = manageRows(after, "GRA001", true);
  assert(audit.some((r) => r.ledgerEntryId === noteId) && audit.some((r) => r.ledgerEntryId === corr.id), "audit view shows both rows");
  const gra = after.filter((e) => e.accountNo === "GRA001");
  const pdf = buildStatementTransactions({ schoolId: SCHOOL, accountRef: "GRA001", ledgerEntries: gra, period: "all", nameByLearnerId: new Map() });
  assert(JSON.stringify(staff.map((r) => [r.type, r.amountIn, r.amountOut, r.balance])) === JSON.stringify(pdf.map((r) => [r.type, r.amountIn, r.amountOut, r.balance])), "PDF = staff statement");
  const parentVisible = gra.filter((e) => shouldShowLedgerEntryOnStatement(e, false)).map((e) => e.id).sort();
  assert(!parentVisible.includes(noteId) && !parentVisible.includes(corr.id), "parent portal hides reversed note and correction");
  const exported = await buildTransactionExport(SCHOOL, { type: "All", hideCorrections: true, fromDate: "2026-01-01", toDate: "2026-12-31" }, { ledger: after });
  assert(!exported.rows.some((r) => r.id === corr.id), "export with corrections hidden omits the correction");
  console.log("  ✓ statement, PDF and parent portal hide the reversed pair; audit view shows both; closing balance = account balance");

  const filesBefore = files(dir);
  const again = rev({ reason: "Second click" });
  assert(again.alreadyReversed && again.correction.id === corr.id, "repeat reversal reports alreadyReversed");
  assert(JSON.stringify(files(dir)) === JSON.stringify(filesBefore), "repeat reversal writes nothing");
  expectRejected("re-issue after reversal", dir, () => issueInvoiceLineCreditNote(good()), "CREDIT_NOTE_REVERSED");
  console.log("  ✓ repeat reversal is a no-op; re-issuing the reversed line is refused");

  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const run = undoInvoiceRun({ schoolId: SCHOOL, runId: RUN });
    assert(!run.success && run.errorCode === "CREDIT_NOTE_CONFLICT", "invoice-run undo stays blocked while any credit note (even reversed) references its invoices");
  } finally {
    process.chdir(cwd);
  }
  console.log("  ✓ invoice-run undo still blocked");
}

async function testUndoGuards(dir: string) {
  console.log("Invoice undo and invoice-run undo refuse invoices with credit notes");
  const before = files(dir);
  let caught: unknown = null;
  try {
    await undoBillingTransaction({ schoolId: SCHOOL, transactionId: INV_A, accountNo: "GRA001", actor: FINANCE });
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof BillingUndoError && caught.code === "INVOICE_HAS_CREDIT_NOTES", `invoice undo blocked, got ${String((caught as Error)?.message)}`);
  assert(JSON.stringify(files(dir)) === JSON.stringify(before), "blocked invoice undo writes nothing");
  console.log("  ✓ invoice undo -> INVOICE_HAS_CREDIT_NOTES");

  const cwd = process.cwd();
  process.chdir(dir);
  try {
    const run = undoInvoiceRun({ schoolId: SCHOOL, runId: RUN });
    assert(!run.success && run.errorCode === "CREDIT_NOTE_CONFLICT", `run undo blocked, got ${run.errorCode}`);
  } finally {
    process.chdir(cwd);
  }
  assert(JSON.stringify(files(dir)) === JSON.stringify(before), "blocked run undo writes nothing");
  console.log("  ✓ invoice-run undo -> CREDIT_NOTE_CONFLICT");

  const other = await undoBillingTransaction({ schoolId: SCHOOL, transactionId: INV_C, accountNo: "GRC003", actor: FINANCE });
  assert(other.alreadyUndone === false, "invoice without credit notes can still be undone");
  console.log("  ✓ invoice without credit note still undoable");
}

async function testDisplayConsistency() {
  console.log("Statement, PDF, parent portal and export show the credit note consistently");
  const ledger = readSchoolLedger(SCHOOL);
  const noteId = creditNoteEntryId(INV_A, GRAD_A);
  const gra = ledger.filter((e) => e.accountNo === "GRA001");

  const staff = manageRows(ledger, "GRA001");
  const row = staff.find((r) => r.ledgerEntryId === noteId)!;
  assert(row, "credit note on staff statement");
  assert(row.type === "Credit Note" && row.amountOut === 400 && row.amountIn === 0, `staff row type/amount, got ${row.type}`);
  assert(row.canUndo === false && row.undoBlockedReason === "Credit notes cannot be undone.", "credit note not undoable, reason shown");
  assert(row.sourceLabel === "EduClear credit note", `source label, got ${row.sourceLabel}`);
  const invoiceRow = staff.find((r) => r.ledgerEntryId === INV_A)!;
  assert(invoiceRow.amountIn === 3650 && invoiceRow.chargeLines?.length === 3, "invoice row still R3,650 with its 3 charge lines");

  const pdf = buildStatementTransactions({ schoolId: SCHOOL, accountRef: "GRA001", ledgerEntries: gra, period: "all", nameByLearnerId: new Map() });
  assert(
    JSON.stringify(staff.map((r) => [r.type, r.amountIn, r.amountOut, r.balance])) ===
      JSON.stringify(pdf.map((r) => [r.type, r.amountIn, r.amountOut, r.balance])),
    "staff statement and PDF rows/balances identical"
  );
  const closing = staff.reduce((sum, r) => sum + Number(r.amountIn || 0) - Number(r.amountOut || 0), 0);
  assert(closing === balanceOf("GRA001", ledger), `statement closing balance ${closing} = account balance ${balanceOf("GRA001", ledger)}`);

  const parentVisible = gra.filter((e) => shouldShowLedgerEntryOnStatement(e, false)).map((e) => e.id).sort();
  const staffVisible = staff.map((r) => r.ledgerEntryId).filter(Boolean).sort();
  assert(parentVisible.includes(noteId), "parent portal shows the credit note");
  assert(JSON.stringify(parentVisible) === JSON.stringify(staffVisible), "parent portal rows = staff statement rows");

  const range = { fromDate: "2026-01-01", toDate: "2026-12-31" };
  const credits = filterLedgerForTransactionExport(ledger, { type: "Credits", hideCorrections: true, ...range });
  assert(credits.some((e) => e.id === noteId), "export Credits filter includes credit note even with corrections hidden");
  const exported = await buildTransactionExport(SCHOOL, { type: "All", hideCorrections: true, ...range }, { ledger });
  const exRow = exported.rows.find((r) => r.id === noteId)!;
  assert(exRow.type === "Credit Note" && exRow.amount === 400 && exRow.source === "educlear_credit_note", "export row labelled Credit Note R400");
  console.log("  ✓ staff = PDF = parent portal; export labels Credit Note; closing balance = account balance");
}

function runChild(dir: string, mode: "issue" | "reverse" = "issue"): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...process.execArgv, __filename], {
      env: { ...process.env, CREDIT_NOTE_CHILD_DIR: dir, CREDIT_NOTE_CHILD_MODE: mode },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => {
      const line = out.split("\n").find((l) => l.startsWith("CHILD_RESULT="));
      if (code === 0 && line) resolve(line.slice("CHILD_RESULT=".length));
      else reject(new Error(`child exit ${code}: ${err.slice(0, 400)}`));
    });
  });
}

async function testConcurrentProcesses() {
  console.log("Concurrent credit note from 4 separate processes");
  const dir = createFixtureDir();
  try {
    const results = await Promise.all([runChild(dir), runChild(dir), runChild(dir), runChild(dir)]);
    useFixtureDir(dir);
    const notes = readSchoolLedger(SCHOOL).filter((e) => e.creditNoteInvoiceId === INV_C);
    assert(results.filter((r) => r === "created").length === 1, `exactly one creator, got ${results.join(",")}`);
    assert(results.filter((r) => r === "alreadyIssued").length === 3, "others report alreadyIssued");
    assert(notes.length === 1, "exactly one credit note");
    console.log(`  ✓ results: ${results.join(", ")}`);

    console.log("Concurrent reversal of that credit note from 4 separate processes");
    const reversals = await Promise.all([runChild(dir, "reverse"), runChild(dir, "reverse"), runChild(dir, "reverse"), runChild(dir, "reverse")]);
    const ledger = readSchoolLedger(SCHOOL);
    const noteId = creditNoteEntryId(INV_C, GRAD_C);
    assert(reversals.filter((r) => r === "reversed").length === 1, `exactly one reversal, got ${reversals.join(",")}`);
    assert(reversals.filter((r) => r === "alreadyReversed").length === 3, "others report alreadyReversed");
    assert(ledger.filter((e) => e.correctsEntryId === noteId).length === 1, "exactly one correction journal");
    assert(ledger.filter((e) => e.id === noteId).length === 1, "credit note kept exactly once");
    console.log(`  ✓ results: ${reversals.join(", ")}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function childMain(dir: string) {
  useFixtureDir(dir);
  if (process.env.CREDIT_NOTE_CHILD_MODE === "reverse") {
    const result = reverseInvoiceLineCreditNote({
      schoolId: SCHOOL, creditNoteId: creditNoteEntryId(INV_C, GRAD_C), actor: FINANCE, reason: "Concurrent reversal test", confirm: true, expectedAmount: 400,
    });
    console.log(`CHILD_RESULT=${result.alreadyReversed ? "alreadyReversed" : "reversed"}`);
    process.exit(0);
  }
  const result = issueInvoiceLineCreditNote(good({ invoiceId: INV_C, lineKey: GRAD_C }));
  console.log(`CHILD_RESULT=${result.alreadyIssued ? "alreadyIssued" : "created"}`);
  process.exit(0);
}

async function main() {
  const dir = createFixtureDir();
  try {
    useFixtureDir(dir);
    testRejections(dir);
    testIssue(dir);
    testPaidInvoiceTreatment(dir);
    await testUndoGuards(dir);
    await testDisplayConsistency();
    await testReversal(dir);
  } finally {
    setBillingLedgerStoreDataDirForTests(null);
    setPaymentAllocationStoreDataDirForTests(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  await testConcurrentProcesses();
  console.log("invoiceLineCreditNote.test.ts: OK");
  process.exit(0);
}

const childDir = process.env.CREDIT_NOTE_CHILD_DIR;
(childDir ? Promise.resolve(childMain(childDir)) : main()).catch((error) => {
  console.error(error);
  process.exit(1);
});
