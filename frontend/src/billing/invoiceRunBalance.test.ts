/**
 * Invoice Run balance display + load behaviour tests.
 * Run: npx tsx src/billing/invoiceRunBalance.test.ts
 */
import {
  formatInvoiceRunBalanceAmount,
  formatInvoiceRunBalanceResult,
  INVOICE_RUN_BALANCE_LOADING_LABEL,
  invoiceRunBalanceStatusLabel,
  lookupStatementAccountBalance,
  resolveInvoiceRunBalance,
  sumInvoiceRunBalanceAndAmount,
} from "./invoiceRunBalance";
import {
  clearSchoolLedgerRuntime,
  isSchoolLedgerFreshFromApi,
  replaceSchoolLedgerFromApi,
  resetSchoolLedgerRuntimeForTests,
  type BillingLedgerEntry,
} from "./billingLedger";
import {
  clearSchoolBillingDisplayCache,
  writeStatementApiAccounts,
} from "./kidesysTransactionHistory";

const SCHOOL = "test-school-invoice-run-balance";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function reset() {
  resetSchoolLedgerRuntimeForTests();
  clearSchoolLedgerRuntime(SCHOOL);
  clearSchoolBillingDisplayCache(SCHOOL);
}

function seedStatements(rows: Array<{ accountNo: string; balance: number }>) {
  writeStatementApiAccounts(
    SCHOOL,
    rows.map((row) => ({
      accountNo: row.accountNo,
      balance: row.balance,
      name: "Test",
      surname: "Learner",
    }))
  );
}

function seedLedger(entries: BillingLedgerEntry[]) {
  replaceSchoolLedgerFromApi(SCHOOL, entries);
}

function testPendingDoesNotFormatAsZero() {
  reset();
  const pending = resolveInvoiceRunBalance(SCHOOL, "learner-1", "TST001");
  assert(!pending.ready && pending.pending, "balance should be pending");
  assert(
    formatInvoiceRunBalanceResult(pending) === INVOICE_RUN_BALANCE_LOADING_LABEL,
    "pending balance must not render as R0"
  );
  assert(
    formatInvoiceRunBalanceAmount(null) === INVOICE_RUN_BALANCE_LOADING_LABEL,
    "null amount must not render as R0"
  );
}

function testRealZeroAfterStatementsLoad() {
  reset();
  seedStatements([{ accountNo: "ZERO001", balance: 0 }]);
  const result = resolveInvoiceRunBalance(SCHOOL, "learner-1", "ZERO001");
  assert(result.ready && result.balance === 0, "authoritative zero should be ready");
  const formatted = formatInvoiceRunBalanceResult(result);
  assert(/R\s*0[.,]00/.test(formatted), `real zero should display R0.00 got ${formatted}`);
}

function testPositiveNegativeOverpaid() {
  reset();
  seedStatements([
    { accountNo: "POS001", balance: 2500 },
    { accountNo: "NEG001", balance: -150 },
  ]);

  const positive = resolveInvoiceRunBalance(SCHOOL, "l1", "POS001");
  const overpaid = resolveInvoiceRunBalance(SCHOOL, "l2", "NEG001");

  assert(positive.ready && positive.balance === 2500, "positive balance");
  assert(overpaid.ready && overpaid.balance === -150, "overpaid balance");
  assert(invoiceRunBalanceStatusLabel(2500) === "Recently Owing", "positive status");
  assert(invoiceRunBalanceStatusLabel(-150) === "Over Paid", "overpaid status");
  assert(invoiceRunBalanceStatusLabel(6000) === "Bad Debt", "bad debt status");
}

function testLedgerFreshPreferredOverStatements() {
  reset();
  seedStatements([{ accountNo: "ACC001", balance: 100 }]);
  seedLedger([
    {
      id: "inv-1",
      schoolId: SCHOOL,
      learnerId: "learner-1",
      accountNo: "ACC001",
      type: "invoice",
      amount: 500,
      date: "2027-01-01",
      reference: "INV-1",
      description: "Tuition",
      createdAt: "2027-01-01T00:00:00.000Z",
    },
  ]);

  assert(isSchoolLedgerFreshFromApi(SCHOOL), "ledger should be fresh from API");
  const result = resolveInvoiceRunBalance(SCHOOL, "learner-1", "ACC001");
  assert(result.ready && result.source === "ledger" && result.balance === 500, "ledger wins");
}

function testLookupStatementAccountBalance() {
  reset();
  const pending = lookupStatementAccountBalance(SCHOOL, "ACC001");
  assert(!pending.loaded, "statements not loaded yet");

  seedStatements([{ accountNo: "acc001", balance: 42 }]);
  const loaded = lookupStatementAccountBalance(SCHOOL, "ACC001");
  assert(loaded.loaded && loaded.balance === 42, "statement account lookup");
}

function testNewBalancePendingWhenBalancePending() {
  assert(sumInvoiceRunBalanceAndAmount(null, 500) === null, "new balance pending");
  assert(sumInvoiceRunBalanceAndAmount(100, 500) === 600, "new balance ready");
}

function main() {
  testPendingDoesNotFormatAsZero();
  testRealZeroAfterStatementsLoad();
  testPositiveNegativeOverpaid();
  testLedgerFreshPreferredOverStatements();
  testLookupStatementAccountBalance();
  testNewBalancePendingWhenBalancePending();
  console.log("invoiceRunBalance.test.ts — PASS");
}

main();
