/**
 * LEP003 26/03/2026 R3,000: the imported Kid-e-Sys ledger copy (with learner) and its Kid-e-Sys
 * history-store twin (blank name) must render as one statement row; nothing else may change.
 * Uses an isolated temp working directory — never reads or writes repo or production data.
 * Run: npx tsx src/services/statementTransactionBuilder.kidesysHistoryDuplicate.test.ts
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

import type { BillingLedgerEntry } from "../utils/billingLedgerStore";
import type { KidesysHistoryEntry } from "../utils/kidesysTransactionHistoryStore";

const SCHOOL = "test-kidesys-history-duplicate";
const LEARNER_ID = "learner-lep003";
const LEARNER_NAME = "Fixture Learner";
const IMPORTED_AT = "2026-05-28T08:38:50.489Z";
const KIDESYS_PAYMENT_ID = "kidesys-payment-cdaf3b70511006976630";
const MANUAL_PAYMENT_ID = "pay-66d8776c-daab-4f2f-bca4-4b5edf1d1960";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function imported(id: string, accountNo: string, type: "invoice" | "payment", amount: number, date: string, reference: string, extra: Partial<BillingLedgerEntry> = {}): BillingLedgerEntry {
  return { id, schoolId: SCHOOL, learnerId: LEARNER_ID, accountNo, type, amount, date, reference, description: type, source: "kideesys-transaction", createdAt: IMPORTED_AT, ...extra } as BillingLedgerEntry;
}

function history(accountNo: string, type: "invoice" | "payment", amount: number, date: string, number: string, suffix = ""): KidesysHistoryEntry {
  const reference = `${type === "invoice" ? "INVOICE" : "PAYMENT"} ${number}`;
  return {
    id: `kidesys-hist-${type}-${number}-${accountNo}${suffix}`,
    schoolId: SCHOOL,
    accountNo,
    type,
    amount,
    date,
    reference,
    transactionNo: number,
    description: "",
    fullName: "",
    source: "kidesys_display_history",
    importedAt: "2026-05-28T11:55:35.003Z",
    kidesysReference: reference,
    direction: type === "invoice" ? "debit" : "credit",
  };
}

const ledger: BillingLedgerEntry[] = [
  imported("kidesys-invoice-c398e0fab1f9839c9931", "LEP003", "invoice", 3000, "2026-03-16", "INVOICE 65186"),
  imported(KIDESYS_PAYMENT_ID, "LEP003", "payment", 3000, "2026-03-26", "PAYMENT 53626"),
  imported("kidesys-payment-069b2e4310ef2d4f8840", "LEP003", "payment", 3000, "2026-03-02", "PAYMENT 53291"),
  imported("kidesys-payment-hidden-fixture", "LEP003", "payment", 700, "2026-02-10", "PAYMENT 52900", { statementHidden: true } as Partial<BillingLedgerEntry>),
  {
    id: MANUAL_PAYMENT_ID,
    schoolId: SCHOOL,
    learnerId: LEARNER_ID,
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
  } as BillingLedgerEntry,
  {
    id: "pay-11394816-64a5-4fba-a070-7ce751a96cf9",
    schoolId: SCHOOL,
    learnerId: LEARNER_ID,
    accountNo: "LEP003",
    type: "payment",
    amount: 50,
    date: "2026-04-08",
    reference: "PAY-20260408-LEP003-001",
    description: "Payment",
    method: "EFT",
    source: "manual",
    createdAt: "2026-10-12T10:43:45.243Z",
  } as BillingLedgerEntry,
  imported("kidesys-payment-lek003-fixture", "LEK003", "payment", 1200, "2026-03-26", "PAYMENT 53630"),
];

const historyStore: KidesysHistoryEntry[] = [
  history("LEP003", "invoice", 3000, "2026-03-16", "65186"),
  history("LEP003", "payment", 3000, "2026-03-26", "53626"),
  history("LEP003", "payment", 3000, "2026-03-02", "53291"),
  history("LEP003", "payment", 3000, "2026-03-02", "53291", "-second-copy"),
  history("LEP003", "payment", 700, "2026-02-10", "52900"),
  history("LEP003", "payment", 450, "2026-01-10", "52000"),
  history("LEK003", "payment", 1200, "2026-03-26", "53630"),
  history("MOR013", "payment", 1200, "2026-03-26", "53630"),
];

function sha(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

async function main() {
  const repoCwd = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kidesys-history-dup-"));
  fs.mkdirSync(path.join(dir, "data"));
  const historyFile = path.join(dir, "data", "kidesys-transaction-history.json");
  fs.writeFileSync(historyFile, JSON.stringify({ [SCHOOL]: historyStore }, null, 2));
  const historyShaBefore = sha(historyFile);
  const ledgerJsonBefore = JSON.stringify(ledger);
  process.chdir(dir);

  try {
    const { buildStatementManageTransactions, buildStatementTransactions } = await import("./statementTransactionBuilder");
    const nameByLearnerId = new Map([[LEARNER_ID, LEARNER_NAME]]);
    const scoped = (account: string) => ledger.filter((e) => e.accountNo === account);
    const manage = (account: string, period = "All Time", showCorrectionsAudit = false) =>
      buildStatementManageTransactions({
        schoolId: SCHOOL,
        accountRef: account,
        ledgerEntries: scoped(account),
        periodFilteredEntries: scoped(account),
        period,
        nameByLearnerId,
        openingBalance: 0,
        showCorrectionsAudit,
      });
    const pdf = (account: string) =>
      buildStatementTransactions({ schoolId: SCHOOL, accountRef: account, ledgerEntries: scoped(account), period: "All Time", nameByLearnerId });

    console.log("LEP003 26/03/2026 R3,000 renders once (named ledger copy kept)");
    const rows = manage("LEP003");
    const march26 = rows.filter((r) => r.date === "2026-03-26" && r.amountOut === 3000);
    assert(march26.length === 1, `one 26/03 R3,000 row, got ${march26.length}`);
    const kept = march26[0];
    assert(kept.ledgerEntryId === KIDESYS_PAYMENT_ID && kept.isKidesysHistory === false, "kept row is the imported ledger copy");
    assert(kept.learner === LEARNER_NAME, "kept row shows the learner name");
    assert(kept.type === "Payment · Kid-e-Sys History · non-posting" && kept.canUndo === false, "still historical, non-posting, not undoable");
    assert(kept.reference === "PAYMENT 53626" && kept.recordedLabel === "Imported", "original Kid-e-Sys reference and import date kept");
    console.log("  ✓ one row: ledger copy with learner name, historical label, no Undo");

    console.log("Only true duplicates are removed");
    const history = rows.filter((r) => r.isKidesysHistory);
    const historyKeys = history.map((r) => r.key).sort();
    assert(
      JSON.stringify(historyKeys) ===
        JSON.stringify([
          "kidesys-kidesys-hist-payment-52000-LEP003",
          "kidesys-kidesys-hist-payment-52900-LEP003",
          "kidesys-kidesys-hist-payment-53291-LEP003-second-copy",
        ]),
      `remaining history rows ${historyKeys.join(",")}`
    );
    console.log("  ✓ history-only row kept; twin of a statement-hidden ledger copy kept; extra identical history row kept");

    const withoutHistory = rows.filter((r) => !r.isKidesysHistory);
    assert(withoutHistory.length === 5, `5 visible ledger rows, got ${withoutHistory.length}`);
    assert(history.every((r) => r.balance === null), "history rows never carry a balance");
    const balances = withoutHistory.map((r) => [r.ledgerEntryId, r.balance]);
    assert(
      JSON.stringify(balances) ===
        JSON.stringify([
          ["pay-11394816-64a5-4fba-a070-7ce751a96cf9", -6050],
          [KIDESYS_PAYMENT_ID, -6000],
          ["kidesys-invoice-c398e0fab1f9839c9931", -3000],
          [MANUAL_PAYMENT_ID, -6000],
          ["kidesys-payment-069b2e4310ef2d4f8840", -3000],
        ]),
      `running balances unchanged, got ${JSON.stringify(balances)}`
    );
    console.log("  ✓ ledger rows and running balances unchanged");

    console.log("Manual R3,000 payment stays a manual, undoable EduClear payment");
    const manual = rows.find((r) => r.ledgerEntryId === MANUAL_PAYMENT_ID)!;
    assert(manual.type === "Payment" && manual.canUndo === true && manual.undoBlockedReason === "", "manual payment undoable");
    assert(manual.sourceLabel === "EduClear manual capture" && manual.isImportedHistory === false, "manual source label");
    assert(manual.recordedLabel === "Captured" && manual.recordedDate === "2026-10-12", "capture date shown");
    console.log("  ✓ Payment, EduClear manual capture, captured 2026-10-12, Undo available");

    console.log("PDF statement, periods, audit view and other accounts");
    const pdfRows = pdf("LEP003");
    assert(pdfRows.length === rows.length, `PDF rows ${pdfRows.length} = manage rows ${rows.length}`);
    const pdf26 = pdfRows.filter((r) => r.date === "2026-03-26" && r.amountOut === 3000);
    assert(pdf26.length === 1 && pdf26[0].learner === LEARNER_NAME, "PDF shows the named row once");
    assert(manage("LEP003", "Last 12 Months").filter((r) => r.date === "2026-03-26").length === 1, "period-filtered statement deduplicated");
    assert(manage("LEP003", "All Time", true).filter((r) => r.date === "2026-03-26" && r.amountOut === 3000).length === 1, "audit view deduplicated");
    const lek = manage("LEK003");
    assert(lek.length === 1 && lek[0].isKidesysHistory === false, "LEK003 shows its ledger copy once");
    const mor = manage("MOR013");
    assert(mor.length === 1 && mor[0].isKidesysHistory === true, "MOR013 history row without a ledger copy stays visible");
    console.log("  ✓ PDF = staff statement; period + audit views; LEK003 once; MOR013 history kept");

    assert(sha(historyFile) === historyShaBefore, "history store untouched");
    assert(JSON.stringify(ledger) === ledgerJsonBefore, "ledger entries untouched");
    console.log("  ✓ history store and ledger entries unchanged");
    console.log("statementTransactionBuilder.kidesysHistoryDuplicate.test.ts: OK");
  } finally {
    process.chdir(repoCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
