/**
 * Billing statement display + account context tests (Phase 1).
 * Run: npx tsx src/billing/billingStatementDisplay.test.ts
 */
import {
  resolveActiveBillingAccount,
  shouldShowNoAccountsMessage,
} from "./billingStatementDisplay";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function testNoAccountsHiddenWhileLoadingWithNoRows() {
  const show = shouldShowNoAccountsMessage({
    rowsLoading: true,
    syncConfirmedEmpty: false,
    displayRowCount: 0,
    isSearchFiltered: false,
  });
  assert(!show, "does not show No accounts while loading");
  console.log("✓ No accounts hidden while loading");
}

function testNoAccountsShownWhenConfirmedEmpty() {
  const show = shouldShowNoAccountsMessage({
    rowsLoading: false,
    syncConfirmedEmpty: true,
    displayRowCount: 0,
    isSearchFiltered: false,
  });
  assert(show, "shows No accounts when API confirms zero");
  console.log("✓ No accounts shown when API confirms zero");
}

function testNoAccountsHiddenWhenRowsExist() {
  const show = shouldShowNoAccountsMessage({
    rowsLoading: true,
    syncConfirmedEmpty: false,
    displayRowCount: 5,
    isSearchFiltered: false,
  });
  assert(!show, "does not show No accounts when rows exist");
  console.log("✓ No accounts hidden when last-good rows exist");
}

function testSearchFilterStillShowsNoAccounts() {
  const show = shouldShowNoAccountsMessage({
    rowsLoading: false,
    syncConfirmedEmpty: false,
    displayRowCount: 0,
    isSearchFiltered: true,
  });
  assert(show, "search miss still shows empty message");
  console.log("✓ search filter empty still shows message");
}

function testReactContextWinsOverStoredAccount() {
  const context = { accountNo: "TST002", learnerId: "learner-b" };
  const stored = { accountNo: "TST001", learnerId: "learner-a" };
  const resolved = resolveActiveBillingAccount(context, stored);
  assert(resolved?.accountNo === "TST002", "React context account B wins over stored A");
  console.log("✓ React billing context wins over localStorage restore");
}

function testStoredUsedOnlyWhenNoContext() {
  const stored = { accountNo: "TST001", learnerId: "learner-a" };
  const resolved = resolveActiveBillingAccount(null, stored);
  assert(resolved?.accountNo === "TST001", "stored account used when no React context");
  console.log("✓ stored account used only for restore when context empty");
}

function run() {
  testNoAccountsHiddenWhileLoadingWithNoRows();
  testNoAccountsShownWhenConfirmedEmpty();
  testNoAccountsHiddenWhenRowsExist();
  testSearchFilterStillShowsNoAccounts();
  testReactContextWinsOverStoredAccount();
  testStoredUsedOnlyWhenNoContext();
  console.log("\nAll billingStatementDisplay tests passed.");
}

run();
