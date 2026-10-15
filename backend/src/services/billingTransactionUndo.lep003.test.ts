/**
 * LEP003 regression: imported Kid-e-Sys R3,000 vs manually captured R3,000 payment undo.
 * Uses isolated fixture files in a temp directory — never touches repo or production data.
 * Run: npx tsx src/services/billingTransactionUndo.lep003.test.ts
 */
import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import {
  BillingUndoError,
  undoBillingTransaction,
  undoCorrectionEntryId,
  type UndoBillingTransactionActor,
} from "./billingTransactionUndo";
import { buildStatementManageTransactions, buildStatementTransactions } from "./statementTransactionBuilder";
import { resolveAuthoritativeAccountBalanceFromSnapshot } from "./statementAccounts";
import { buildTransactionExport, filterLedgerForTransactionExport } from "./billingTransactionExport";
import {
  readSchoolLedger,
  setBillingLedgerStoreDataDirForTests,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import {
  listPaymentAllocations,
  setPaymentAllocationStoreDataDirForTests,
} from "../utils/paymentAllocationStore";
import { shouldShowLedgerEntryOnStatement } from "../utils/billingDisplayRules";
import type { FamilyAccountAgeAnalysisSnapshot } from "../utils/familyAccountAgeAnalysisStore";

const SCHOOL = "test-lep003-undo-fixture";
const KIDESYS_PAYMENT_ID = "kidesys-payment-cdaf3b70511006976630";
const MANUAL_PAYMENT_ID = "pay-66d8776c-daab-4f2f-bca4-4b5edf1d1960";
const MAS030_PAYMENT_ID = "pay-mas030-fixture-0001";
const TOPUP_ID = "kidesys-topup-fixture-0001";
const DRAFT_INVOICE_ID = `invoice-draft:${SCHOOL}:2026-10-learner-lep003`;
const SENTINEL_IMPORTED_AT = "2099-01-01T00:00:00.000Z";

const FINANCE: UndoBillingTransactionActor = { userId: "user-finance", email: "finance@test.local", appRole: "Finance" };
const TEACHER: UndoBillingTransactionActor = { userId: "user-teacher", email: "teacher@test.local", appRole: "Teacher" };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function sha(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function fixtureLedger(): BillingLedgerEntry[] {
  const importedAt = "2026-05-28T08:38:50.489Z";
  return [
    {
      id: KIDESYS_PAYMENT_ID,
      schoolId: SCHOOL,
      learnerId: "",
      accountNo: "LEP003",
      type: "payment",
      amount: 3000,
      date: "2026-03-26",
      reference: "PAYMENT 53626",
      description: "payment",
      source: "kideesys-transaction",
      createdAt: importedAt,
    },
    {
      id: "kidesys-invoice-c398e0fab1f9839c9931",
      schoolId: SCHOOL,
      learnerId: "",
      accountNo: "LEP003",
      type: "invoice",
      amount: 3000,
      date: "2026-03-16",
      reference: "INVOICE 65186",
      description: "invoice",
      source: "kideesys-transaction",
      createdAt: importedAt,
    },
    {
      id: "invoice-RUN-1787030625509-learner-lep003",
      schoolId: SCHOOL,
      learnerId: "learner-lep003",
      accountNo: "LEP003",
      type: "invoice",
      amount: 3000,
      date: "2026-08-18",
      reference: "INV-1787030748492",
      description: "School fees",
      runId: "RUN-1787030625509",
      createdAt: "2026-08-18T05:25:48.492Z",
    },
    {
      id: MANUAL_PAYMENT_ID,
      schoolId: SCHOOL,
      learnerId: "",
      accountNo: "LEP003",
      type: "payment",
      amount: 3000,
      date: "2026-03-04",
      reference: "PAY-20260304-LEP003-001",
      description: "Payment",
      method: "EFT",
      source: "manual",
      createdAt: "2026-10-12T10:41:08.346Z",
      idempotencyKey: "66d8776c-daab-4f2f-bca4-4b5edf1d1960",
      capturedByUserId: "user-owner",
    },
    {
      id: MAS030_PAYMENT_ID,
      schoolId: SCHOOL,
      learnerId: "",
      accountNo: "MAS030",
      type: "payment",
      amount: 3550,
      date: "2026-10-14",
      reference: "PAY-20261014-MAS030-001",
      description: "Payment",
      method: "EFT",
      source: "manual",
      createdAt: "2026-10-14T07:00:00.000Z",
    },
    {
      id: TOPUP_ID,
      schoolId: SCHOOL,
      learnerId: "",
      accountNo: "TOP001",
      type: "payment",
      amount: 4000,
      date: "2026-06-05",
      reference: "Payment 12345",
      description: "Kid-e-Sys top-up",
      method: "EFT",
      source: "kidesys_topup",
      createdAt: "2026-06-05T09:00:00.000Z",
    },
  ];
}

function fixtureAllocations() {
  return {
    [SCHOOL]: {
      [MANUAL_PAYMENT_ID]: [
        {
          id: `palloc-${MANUAL_PAYMENT_ID}-0`,
          paymentId: MANUAL_PAYMENT_ID,
          schoolId: SCHOOL,
          accountRef: "LEP003",
          invoiceId: DRAFT_INVOICE_ID,
          feeCategory: null,
          allocatedAmount: 3000,
          allocatedBy: "owner@test.local",
          createdAt: "2026-10-12T10:41:08.900Z",
        },
      ],
      [MAS030_PAYMENT_ID]: [
        {
          id: `palloc-${MAS030_PAYMENT_ID}-0`,
          paymentId: MAS030_PAYMENT_ID,
          schoolId: SCHOOL,
          accountRef: "MAS030",
          invoiceId: `invoice-draft:${SCHOOL}:2026-10-learner-mas030`,
          feeCategory: null,
          allocatedAmount: 3550,
          createdAt: "2026-10-14T07:00:01.000Z",
        },
      ],
    },
  };
}

const SNAPSHOTS: Record<string, FamilyAccountAgeAnalysisSnapshot> = {
  LEP003: { accountRef: "LEP003", balance: 0, importedAt: SENTINEL_IMPORTED_AT } as FamilyAccountAgeAnalysisSnapshot,
  MAS030: { accountRef: "MAS030", balance: 3550, importedAt: SENTINEL_IMPORTED_AT } as FamilyAccountAgeAnalysisSnapshot,
  TOP001: { accountRef: "TOP001", balance: 0, importedAt: SENTINEL_IMPORTED_AT } as FamilyAccountAgeAnalysisSnapshot,
};

function createFixtureDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lep003-undo-"));
  fs.writeFileSync(path.join(dir, "billing-ledger.json"), JSON.stringify({ [SCHOOL]: fixtureLedger() }, null, 2));
  fs.writeFileSync(path.join(dir, "payment-allocations.json"), JSON.stringify(fixtureAllocations(), null, 2));
  return dir;
}

function useFixtureDir(dir: string) {
  setBillingLedgerStoreDataDirForTests(dir);
  setPaymentAllocationStoreDataDirForTests(dir);
}

function balanceOf(accountRef: string, ledger: BillingLedgerEntry[]): number {
  const entries = ledger.filter((e) => String(e.accountNo).toUpperCase() === accountRef);
  return resolveAuthoritativeAccountBalanceFromSnapshot(SNAPSHOTS[accountRef], entries);
}

function manageRows(ledger: BillingLedgerEntry[], showCorrectionsAudit = false) {
  const scoped = ledger.filter((e) => e.accountNo === "LEP003");
  return buildStatementManageTransactions({
    schoolId: SCHOOL,
    accountRef: "LEP003",
    ledgerEntries: scoped,
    periodFilteredEntries: scoped,
    period: "all",
    nameByLearnerId: new Map(),
    openingBalance: 0,
    showCorrectionsAudit,
  });
}

async function expectRejected(
  name: string,
  dir: string,
  run: () => Promise<unknown>,
  check: (error: unknown) => boolean
) {
  const before = [sha(path.join(dir, "billing-ledger.json")), sha(path.join(dir, "payment-allocations.json"))];
  let caught: unknown = null;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  assert(caught, `${name}: expected rejection`);
  assert(check(caught), `${name}: unexpected error ${String((caught as Error)?.message)}`);
  const after = [sha(path.join(dir, "billing-ledger.json")), sha(path.join(dir, "payment-allocations.json"))];
  assert(before[0] === after[0] && before[1] === after[1], `${name}: fixture files must be unchanged`);
  console.log(`  ✓ ${name}`);
}

const undoCode = (code: string) => (error: unknown) => error instanceof BillingUndoError && error.code === code;
const undoMessage = (text: string) => (error: unknown) => String((error as Error)?.message || "").includes(text);

async function testDisplayAndEligibility(dir: string) {
  console.log("Statement display and eligibility");
  const ledger = readSchoolLedger(SCHOOL);
  const rows = manageRows(ledger);
  const kidesys = rows.find((r) => r.ledgerEntryId === KIDESYS_PAYMENT_ID)!;
  const manual = rows.find((r) => r.ledgerEntryId === MANUAL_PAYMENT_ID)!;
  assert(kidesys && manual, "both March R3,000 rows present");
  assert(kidesys.type === "Payment · Kid-e-Sys History · non-posting", `imported label, got ${kidesys.type}`);
  assert(kidesys.isImportedHistory === true && kidesys.canUndo === false, "imported row not undoable");
  assert(/record only/.test(String(kidesys.undoBlockedReason)), "imported row explains why");
  assert(kidesys.recordedLabel === "Imported" && kidesys.recordedDate === "2026-05-28", "import date shown");
  assert(kidesys.reference === "PAYMENT 53626", "original Kid-e-Sys reference shown");
  assert(manual.type === "Payment" && manual.canUndo === true && manual.undoBlockedReason === "", "manual payment undoable");
  assert(manual.sourceLabel === "EduClear manual capture", `manual source label, got ${manual.sourceLabel}`);
  assert(manual.recordedLabel === "Captured" && manual.recordedDate === "2026-10-12", "capture date shown");
  assert(manual.date === "2026-03-04" && manual.reference === "PAY-20260304-LEP003-001", "transaction date + reference");

  const pdfRows = buildStatementTransactions({
    schoolId: SCHOOL,
    accountRef: "LEP003",
    ledgerEntries: ledger.filter((e) => e.accountNo === "LEP003"),
    period: "all",
    nameByLearnerId: new Map(),
  });
  const manageAmounts = rows.map((r) => [r.amountIn, r.amountOut, r.balance]);
  const pdfAmounts = pdfRows.map((r) => [r.amountIn, r.amountOut, r.balance]);
  assert(JSON.stringify(manageAmounts) === JSON.stringify(pdfAmounts), "manage amounts/balances match PDF statement");
  assert(pdfRows.every((r) => !String(r.type).includes("Kid-e-Sys History")), "PDF statement labels unchanged");

  const topupRows = buildStatementManageTransactions({
    schoolId: SCHOOL,
    accountRef: "TOP001",
    ledgerEntries: ledger.filter((e) => e.accountNo === "TOP001"),
    periodFilteredEntries: ledger.filter((e) => e.accountNo === "TOP001"),
    period: "all",
    nameByLearnerId: new Map(),
  });
  assert(topupRows[0].canUndo === false && /top-up/.test(String(topupRows[0].undoBlockedReason)), "top-up blocked with reason");
  assert(balanceOf("LEP003", ledger) === 0, `LEP003 starts at R0, got ${balanceOf("LEP003", ledger)}`);
  console.log("  ✓ labels, dates, sources, eligibility; amounts identical to PDF; LEP003 R0");
  void dir;
}

async function testRejections(dir: string) {
  console.log("Rejected undo attempts leave fixture files byte-identical");
  const base = { schoolId: SCHOOL, transactionId: MANUAL_PAYMENT_ID, accountNo: "LEP003" };
  const good = { reason: "Captured twice in error", confirm: true, expectedAmount: 3000 };
  await expectRejected("no authenticated actor", dir, () => undoBillingTransaction({ ...base, ...good }), undoCode("AUTH_REQUIRED"));
  await expectRejected("Teacher role", dir, () => undoBillingTransaction({ ...base, ...good, actor: TEACHER }), undoCode("UNDO_ROLE_REQUIRED"));
  await expectRejected("Viewer role", dir, () => undoBillingTransaction({ ...base, ...good, actor: { ...TEACHER, appRole: "Viewer" } }), undoCode("UNDO_ROLE_REQUIRED"));
  await expectRejected("missing reason", dir, () => undoBillingTransaction({ ...base, ...good, reason: "  ", actor: FINANCE }), undoCode("UNDO_REASON_REQUIRED"));
  await expectRejected("no confirmation", dir, () => undoBillingTransaction({ ...base, ...good, confirm: false, actor: FINANCE }), undoCode("UNDO_CONFIRMATION_REQUIRED"));
  await expectRejected("wrong amount shown (R300)", dir, () => undoBillingTransaction({ ...base, ...good, expectedAmount: 300, actor: FINANCE }), undoCode("UNDO_AMOUNT_MISMATCH"));
  await expectRejected(
    "historical Kid-e-Sys R3,000 (Finance)",
    dir,
    () => undoBillingTransaction({ ...base, ...good, transactionId: KIDESYS_PAYMENT_ID, actor: FINANCE }),
    undoMessage("Imported Kid-e-Sys history cannot be undone")
  );
  await expectRejected(
    "Kid-e-Sys top-up (Owner)",
    dir,
    () => undoBillingTransaction({ ...base, ...good, transactionId: TOPUP_ID, accountNo: "TOP001", expectedAmount: 4000, actor: { ...FINANCE, appRole: "Owner" } }),
    undoMessage("cannot be undone")
  );
}

async function testSuccessfulUndo(dir: string) {
  console.log("Authorised manual payment undo (Finance)");
  const before = readSchoolLedger(SCHOOL).map((e) => ({ ...e }));
  const untouchedBefore = JSON.stringify(before.filter((e) => e.id !== MANUAL_PAYMENT_ID));
  const balancesBefore = { MAS030: balanceOf("MAS030", before), TOP001: balanceOf("TOP001", before) };

  const result = await undoBillingTransaction({
    schoolId: SCHOOL,
    transactionId: MANUAL_PAYMENT_ID,
    accountNo: "LEP003",
    actor: FINANCE,
    reason: "Captured twice in error",
    confirm: true,
    expectedAmount: 3000,
  });
  assert(result.alreadyUndone === false, "first undo creates correction");

  const after = readSchoolLedger(SCHOOL);
  const original = after.find((e) => e.id === MANUAL_PAYMENT_ID)!;
  const correction = after.find((e) => e.id === undoCorrectionEntryId(MANUAL_PAYMENT_ID))!;
  const src = before.find((e) => e.id === MANUAL_PAYMENT_ID)!;
  for (const key of ["amount", "date", "reference", "method", "source", "createdAt", "accountNo", "idempotencyKey"] as const) {
    assert(original[key] === src[key], `original ${key} preserved`);
  }
  assert(original.undoneAt && original.undoneByCorrectionId === correction.id, "original linked to correction");
  assert(original.undoneByUserId === "user-finance" && original.undoneByRole === "Finance", "actor recorded on original");
  assert(original.undoReason === "Captured twice in error", "reason recorded");
  assert(correction.correctsEntryId === MANUAL_PAYMENT_ID && correction.type === "invoice" && correction.amount === 3000, "correction journal");
  assert(correction.undoneByEmail === "finance@test.local", "actor recorded on correction");
  assert(
    correction.reversedAllocations?.length === 1 &&
      correction.reversedAllocations[0].invoiceId === DRAFT_INVOICE_ID &&
      correction.reversedAllocations[0].allocatedAmount === 3000,
    "October draft allocation preserved as history on the correction"
  );
  assert(listPaymentAllocations(SCHOOL, MANUAL_PAYMENT_ID).length === 0, "October draft allocation no longer active");
  assert(listPaymentAllocations(SCHOOL, MAS030_PAYMENT_ID).length === 1, "MAS030 allocation untouched");
  assert(after.length === before.length + 1, "exactly one row added, none deleted");

  assert(balanceOf("LEP003", after) === 3000, `LEP003 R0 -> R3,000 owing, got ${balanceOf("LEP003", after)}`);
  assert(balanceOf("MAS030", after) === balancesBefore.MAS030 && balanceOf("TOP001", after) === balancesBefore.TOP001, "other balances unchanged");
  const untouchedAfter = JSON.stringify(after.filter((e) => e.id !== MANUAL_PAYMENT_ID && e.id !== correction.id));
  assert(untouchedAfter === untouchedBefore, "all other rows (Kid-e-Sys history, top-up, other accounts) byte-identical");
  assert(after.filter((e) => e.source === "kidesys_topup").length === 1, "top-up count unchanged");
  console.log("  ✓ original preserved + linked correction, actor/reason recorded, allocation history kept, LEP003 R0 -> R3,000, others unchanged");

  const files = [sha(path.join(dir, "billing-ledger.json")), sha(path.join(dir, "payment-allocations.json"))];
  const again = await undoBillingTransaction({
    schoolId: SCHOOL,
    transactionId: MANUAL_PAYMENT_ID,
    accountNo: "LEP003",
    actor: FINANCE,
    reason: "Second click",
    confirm: true,
    expectedAmount: 3000,
  });
  assert(again.alreadyUndone === true, "second undo reports alreadyUndone");
  assert(files[0] === sha(path.join(dir, "billing-ledger.json")) && files[1] === sha(path.join(dir, "payment-allocations.json")), "second undo writes nothing");
  assert(readSchoolLedger(SCHOOL).filter((e) => e.correctsEntryId === MANUAL_PAYMENT_ID).length === 1, "exactly one correction");
  console.log("  ✓ duplicate undo is a no-op (exactly once)");
}

async function testConsistencyAfterUndo() {
  console.log("Statement, parent portal and export consistency after undo");
  const ledger = readSchoolLedger(SCHOOL);
  const lep = ledger.filter((e) => e.accountNo === "LEP003");
  const correctionId = undoCorrectionEntryId(MANUAL_PAYMENT_ID);

  const staff = manageRows(ledger);
  assert(!staff.some((r) => r.ledgerEntryId === MANUAL_PAYMENT_ID || r.ledgerEntryId === correctionId), "staff statement hides undone pair");
  const audit = manageRows(ledger, true);
  const auditOriginal = audit.find((r) => r.ledgerEntryId === MANUAL_PAYMENT_ID)!;
  const auditCorrection = audit.find((r) => r.ledgerEntryId === correctionId)!;
  assert(auditOriginal.type === "Payment (undone)" && auditOriginal.canUndo === false, "audit view marks original undone");
  assert(auditCorrection.type === "Correction Journal" && auditCorrection.canUndo === false, "audit view shows correction journal");

  const pdf = buildStatementTransactions({ schoolId: SCHOOL, accountRef: "LEP003", ledgerEntries: lep, period: "all", nameByLearnerId: new Map() });
  assert(pdf.length === staff.length, "PDF statement and staff statement show the same rows");

  const parentVisible = lep.filter((e) => shouldShowLedgerEntryOnStatement(e, false)).map((e) => e.id).sort();
  const staffVisible = staff.map((r) => r.ledgerEntryId).filter(Boolean).sort();
  assert(JSON.stringify(parentVisible) === JSON.stringify(staffVisible), "parent portal rows match staff statement rows");

  const range = { fromDate: "2026-01-01", toDate: "2026-12-31" };
  const hidden = filterLedgerForTransactionExport(ledger, { type: "All", hideCorrections: true, ...range });
  assert(!hidden.some((e) => e.id === MANUAL_PAYMENT_ID || e.id === correctionId), "export hides pair when corrections hidden");
  const shown = await buildTransactionExport(SCHOOL, { type: "All", hideCorrections: false, ...range }, { ledger });
  const exOriginal = shown.rows.find((r) => r.id === MANUAL_PAYMENT_ID)!;
  const exCorrection = shown.rows.find((r) => r.id === correctionId)!;
  assert(exOriginal.type === "Payment (undone)" && exCorrection.type === "Correction Journal", "export labels the pair");
  console.log("  ✓ staff statement = PDF = parent portal; audit view and export label the undone pair");
}

function runChild(dir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", __filename], {
      env: { ...process.env, LEP003_UNDO_CHILD_DIR: dir },
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
  console.log("Concurrent undo from 4 separate processes");
  const dir = createFixtureDir();
  try {
    const results = await Promise.all([runChild(dir), runChild(dir), runChild(dir), runChild(dir)]);
    useFixtureDir(dir);
    const ledger = readSchoolLedger(SCHOOL);
    const corrections = ledger.filter((e) => e.correctsEntryId === MANUAL_PAYMENT_ID);
    assert(results.filter((r) => r === "created").length === 1, `exactly one creator, got ${results.join(",")}`);
    assert(results.filter((r) => r === "alreadyUndone").length === 3, "others report alreadyUndone");
    assert(corrections.length === 1, "exactly one correction journal");
    assert(corrections[0].reversedAllocations?.length === 1, "allocation history captured once");
    assert(balanceOf("LEP003", ledger) === 3000, "LEP003 R3,000 after concurrent undo");
    console.log(`  ✓ results: ${results.join(", ")}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function childMain(dir: string) {
  useFixtureDir(dir);
  const result = await undoBillingTransaction({
    schoolId: SCHOOL,
    transactionId: MANUAL_PAYMENT_ID,
    accountNo: "LEP003",
    actor: FINANCE,
    reason: "Concurrent click test",
    confirm: true,
    expectedAmount: 3000,
  });
  console.log(`CHILD_RESULT=${result.alreadyUndone ? "alreadyUndone" : "created"}`);
  process.exit(0);
}

async function main() {
  const dir = createFixtureDir();
  try {
    useFixtureDir(dir);
    await testDisplayAndEligibility(dir);
    await testRejections(dir);
    await testSuccessfulUndo(dir);
    await testConsistencyAfterUndo();
  } finally {
    setBillingLedgerStoreDataDirForTests(null);
    setPaymentAllocationStoreDataDirForTests(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  await testConcurrentProcesses();
  console.log("billingTransactionUndo.lep003.test.ts: OK");
  process.exit(0);
}

const childDir = process.env.LEP003_UNDO_CHILD_DIR;
(childDir ? childMain(childDir) : main()).catch((error) => {
  console.error(error);
  process.exit(1);
});
