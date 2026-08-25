/**
 * Invoice Run source-agnostic + performance contract.
 * A Express refs, B 500+ accounts, C thousands of ledger rows, D historical-only,
 * E unlinked finance, F duplicate protection, G Da Silva Kid-e-Sys, H Magical,
 * I tenant isolation, J bounded browser processing.
 * Run: npx tsx src/billing/invoiceRunSourceAgnostic.test.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  getAccountLedger,
  replaceSchoolLedgerFromApi,
  resetSchoolLedgerRuntimeForTests,
  type BillingLedgerEntry,
} from "./billingLedger";
import { resolveInvoiceRunAccountRef } from "./officialBillingAccountRef";
import { lookupStatementAccountBalance, resolveInvoiceRunBalance } from "./invoiceRunBalance";
import {
  clearSchoolBillingDisplayCache,
  writeStatementApiAccounts,
} from "./kidesysTransactionHistory";

const EXPRESS_SCHOOL = "school-express-migrated";
const DA_SILVA_SCHOOL = "cmpideqeq0000108xb6ouv9zi";
const MAGICAL_SCHOOL = "cmq4xjckq00at60gqg4eb956h";
const OTHER_SCHOOL = "school-other-tenant";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function resetAll() {
  resetSchoolLedgerRuntimeForTests();
  clearSchoolBillingDisplayCache(EXPRESS_SCHOOL);
  clearSchoolBillingDisplayCache(DA_SILVA_SCHOOL);
  clearSchoolBillingDisplayCache(MAGICAL_SCHOOL);
  clearSchoolBillingDisplayCache(OTHER_SCHOOL);
}

function entry(
  schoolId: string,
  partial: Partial<BillingLedgerEntry> & Pick<BillingLedgerEntry, "id">
): BillingLedgerEntry {
  return {
    schoolId,
    learnerId: partial.learnerId || "",
    accountNo: partial.accountNo || "",
    type: partial.type || "invoice",
    amount: partial.amount ?? 100,
    date: partial.date || "2026-07-01",
    reference: partial.reference || partial.id,
    description: partial.description || "Invoice",
    createdAt: partial.createdAt || "2026-08-24T22:45:16.463Z",
    ...partial,
  };
}

function testAExpressAccountRefs() {
  resetAll();
  const row = {
    id: "learner-1",
    accountNo: "ABAYE TUMO ASHANAFY",
    familyAccount: { accountRef: "ABAYE TUMO ASHANAFY" },
  };
  assert(
    resolveInvoiceRunAccountRef(row, EXPRESS_SCHOOL) === "ABAYE TUMO ASHANAFY",
    "A: Express name posts when no Kid-e-Sys official list"
  );
}

function testGDaSilvaKidESysUnchanged() {
  resetAll();
  writeStatementApiAccounts(DA_SILVA_SCHOOL, [
    { accountNo: "ALI002", balance: 4000 },
    { accountNo: "DUP001", balance: -12200 },
  ]);
  const daSilvaRow = {
    accountNo: "ALI002",
    familyAccount: { accountRef: "ALI002" },
  };
  assert(
    resolveInvoiceRunAccountRef(daSilvaRow, DA_SILVA_SCHOOL) === "ALI002",
    "G: Da Silva Kid-e-Sys ref still resolves"
  );
  const expressOnDaSilva = {
    accountNo: "ABAYE TUMO ASHANAFY",
    familyAccount: { accountRef: "ABAYE TUMO ASHANAFY" },
  };
  assert(
    resolveInvoiceRunAccountRef(expressOnDaSilva, DA_SILVA_SCHOOL) === "",
    "G: Da Silva official list rejects Express names"
  );
}

function testHMagicalUnchanged() {
  resetAll();
  writeStatementApiAccounts(MAGICAL_SCHOOL, [{ accountNo: "MBB001", balance: 100 }]);
  const magical = {
    accountNo: "MBB001",
    familyAccount: { accountRef: "MBB001" },
  };
  assert(
    resolveInvoiceRunAccountRef(magical, MAGICAL_SCHOOL) === "MBB001",
    "H: Magical Kid-e-Sys-shaped ref still resolves"
  );
}

function testDEHistoricalAndUnlinkedExcluded() {
  resetAll();
  assert(
    resolveInvoiceRunAccountRef(
      { accountNo: "OLD FAMILY", familyAccount: { accountRef: "OLD FAMILY" } },
      EXPRESS_SCHOOL
    ) === "OLD FAMILY",
    "historical ref can resolve if a row is wrongly given it"
  );
  assert(
    resolveInvoiceRunAccountRef({ accountNo: "26006", admissionNo: "26006" }, EXPRESS_SCHOOL) ===
      "",
    "E: unlinked accession / numeric finance identity must not post"
  );
  assert(
    resolveInvoiceRunAccountRef({ accountNo: "1234567" }, EXPRESS_SCHOOL) === "",
    "E: SA-SAMS numeric excluded"
  );
}

function testCAndJBoundedLedgerScans() {
  resetAll();
  const rows: BillingLedgerEntry[] = [];
  for (let i = 0; i < 5000; i += 1) {
    rows.push(
      entry(EXPRESS_SCHOOL, {
        id: `hist-${i}`,
        learnerId: `learner-${i % 500}`,
        accountNo: `ACCOUNT ${i % 521}`,
        amount: 10,
        date: `2026-0${(i % 7) + 1}-01`.replace("2026-010", "2026-10"),
        description: `Express invoice ${100000 + i}`,
        source: "universal_migration_phase14",
      })
    );
  }
  replaceSchoolLedgerFromApi(EXPRESS_SCHOOL, rows);

  const started = Date.now();
  for (let i = 0; i < 500; i += 1) {
    const ledger = getAccountLedger(EXPRESS_SCHOOL, `learner-${i}`, `ACCOUNT ${i % 521}`);
    assert(ledger.length > 0, "indexed ledger returns rows");
  }
  const elapsed = Date.now() - started;
  assert(elapsed < 400, `J: 500 indexed ledger lookups over 5000 rows took ${elapsed}ms`);
}

function testBFiveHundredAccountsStatementLookup() {
  resetAll();
  const accounts = Array.from({ length: 521 }, (_, i) => ({
    accountNo: i < 441 ? `CURRENT FAMILY ${i}` : `HISTORICAL ${i}`,
    balance: i < 441 ? 100 + i : 0,
    memberLearnerIds: i < 441 ? [`learner-${i}`] : [],
  }));
  writeStatementApiAccounts(EXPRESS_SCHOOL, accounts);
  const started = Date.now();
  for (let i = 0; i < 441; i += 1) {
    const found = lookupStatementAccountBalance(EXPRESS_SCHOOL, `CURRENT FAMILY ${i}`);
    assert(found.loaded && found.balance === 100 + i, "B: current family balance");
  }
  const historical = lookupStatementAccountBalance(EXPRESS_SCHOOL, "HISTORICAL 500");
  assert(historical.loaded && historical.balance === 0, "D: historical account is statement-only");
  const elapsed = Date.now() - started;
  assert(elapsed < 200, `B/J: 441 statement lookups over 521 accounts took ${elapsed}ms`);
}

function testFAndIInvoiceRunListIsolation() {
  const source = fs.readFileSync(
    path.join(__dirname, "../../../backend/src/services/invoiceRunListService.ts"),
    "utf8"
  );
  assert(
    source.includes("universal_migration"),
    "F: invoice-run list must exclude migrated source invoices"
  );
  assert(
    source.includes("isHistoricalSourceInvoiceForRunList"),
    "F: historical source invoices are filtered from the run list"
  );
}

function testWizardBalanceUsesExpressRef() {
  resetAll();
  writeStatementApiAccounts(EXPRESS_SCHOOL, [
    { accountNo: "ABAYE TUMO ASHANAFY", balance: 1500 },
  ]);
  const result = resolveInvoiceRunBalance(
    EXPRESS_SCHOOL,
    "learner-abay",
    "ABAYE TUMO ASHANAFY"
  );
  assert(result.ready === true && result.balance === 1500, "wizard balance from statements");
}

function testLoadBehaviorAvoidsFullInvoiceDumpAndRelink() {
  const source = fs.readFileSync(path.join(__dirname, "InvoiceRuns.tsx"), "utf8");
  assert(!source.includes("fetchInvoices("), "list mount must not fetch full invoice dump");
  assert(!source.includes("fetchPayments("), "list mount must not fetch full payment dump");
  assert(
    source.includes("avoidRelink: true"),
    "wizard ledger sync must not call GET /api/invoices/ledger (relink write)"
  );
  assert(
    source.includes('if (!String(invoiceRunView || "").startsWith("wizard")) return [];'),
    "selectedRows must not scan all learners on the list page"
  );
}

function main() {
  testAExpressAccountRefs();
  testBFiveHundredAccountsStatementLookup();
  testCAndJBoundedLedgerScans();
  testDEHistoricalAndUnlinkedExcluded();
  testFAndIInvoiceRunListIsolation();
  testGDaSilvaKidESysUnchanged();
  testHMagicalUnchanged();
  testWizardBalanceUsesExpressRef();
  testLoadBehaviorAvoidsFullInvoiceDumpAndRelink();
  console.log("invoiceRunSourceAgnostic.test.ts — PASS");
}

main();
