/**
 * Billing ledger runtime cache tests.
 * Run: npx tsx src/billing/billingLedger.test.ts
 */
import type { BillingAccountRow, BillingLedgerEntry } from "./billingLedger";
import {
  getSchoolLedgerCacheStatus,
  getSchoolLedgerRuntimeRowCount,
  markSchoolLedgerApiSyncFailed,
  readSchoolLedger,
  replaceSchoolLedgerFromApi,
  resetSchoolLedgerRuntimeForTests,
  shouldShowLedgerFallbackWarning,
  SAFE_LOCAL_LEDGER_CACHE_CHARS,
} from "./billingLedger";
import { DEFAULT_FINANCE_POLICY } from "../finance/financePolicy";
import { buildFinanceAccountSnapshots } from "../finance/financeAccountEngine";

const SCHOOL = "school-ledger-test";
const LEDGER_KEY = "educlearBillingLedger";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function installLocalStorageMock(options?: { quotaOnLedgerWrite?: boolean }) {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    get length() {
      return store.size;
    },
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (options?.quotaOnLedgerWrite && key === LEDGER_KEY && value.length > 512) {
        const err = new DOMException("QuotaExceededError", "QuotaExceededError");
        throw err;
      }
      store.set(key, value);
    },
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
  };
  return store;
}

function statementRow(input: Partial<BillingAccountRow>): BillingAccountRow {
  return {
    id: input.id || input.learnerId || input.accountNo || "row",
    learnerId: input.learnerId || "",
    accountNo: input.accountNo || "",
    familyAccountId: input.familyAccountId,
    memberLearnerIds: input.memberLearnerIds || [],
    memberNames: input.memberNames || [],
    accountHolder: input.accountHolder || "",
    name: input.name || "Learner",
    surname: input.surname || "Test",
    balance: input.balance ?? 0,
    invoiceTotal: 0,
    penaltyTotal: 0,
    paymentTotal: 0,
    creditTotal: 0,
    lastInvoice: "No invoices",
    lastInvoiceDate: "",
    lastPayment: "No payments",
    lastPaymentDate: "",
    status: input.status || "Up To Date",
    ageAnalysis: input.ageAnalysis,
  };
}

function ada004FreshLedger(): BillingLedgerEntry[] {
  return [
    {
      id: "invoice-1781514142509",
      schoolId: SCHOOL,
      learnerId: "learner-ada-a",
      accountNo: "ADA004",
      type: "invoice",
      amount: 3000,
      date: "2026-06-15",
      dueDate: "2026-06-15",
      reference: "65001",
      description: "Invoice Run For July 2026",
      runId: "RUN-1781514127700",
      createdAt: "2026-06-15T00:00:00.000Z",
    },
    {
      id: "invoice-1781514144529",
      schoolId: SCHOOL,
      learnerId: "learner-ada-a",
      accountNo: "ADA004",
      type: "invoice",
      amount: 3550,
      date: "2026-06-15",
      dueDate: "2026-06-15",
      reference: "65000",
      description: "Invoice Run For July 2026",
      runId: "RUN-1781514127700",
      createdAt: "2026-06-15T00:00:00.000Z",
    },
    {
      id: "pay-98f5654f-fc21-45e4-9771-388cd83a232c",
      schoolId: SCHOOL,
      learnerId: "learner-ada-a",
      accountNo: "ADA004",
      type: "payment",
      amount: 4350,
      date: "2026-07-10",
      reference: "PAY-20260710-ADA004-001",
      description: "Payment",
      source: "manual",
      createdAt: "2026-07-10T00:00:00.000Z",
    },
  ];
}

function stalePartialAdaLedger(): BillingLedgerEntry[] {
  return [
    {
      id: "invoice-stale-aftercare-550",
      schoolId: SCHOOL,
      learnerId: "learner-ada-a",
      accountNo: "ADA004",
      type: "invoice",
      amount: 550,
      date: "2026-06-15",
      dueDate: "2026-06-15",
      reference: "STALE",
      description: "Invoice Run For July 2026",
      createdAt: "2026-06-15T00:00:00.000Z",
    },
  ];
}

function financeFixtures() {
  const adaRow = statementRow({
    id: "ada004",
    learnerId: "learner-ada-a",
    accountNo: "ADA004",
    name: "Eldadi",
    surname: "Adamu",
    balance: -850,
    memberLearnerIds: ["learner-ada-a", "learner-ada-b"],
    ageAnalysis: {
      accountHolder: "Zem Adamu",
      balance: -850,
      buckets: { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 },
    },
  });
  const pebRow = statementRow({
    id: "peb002",
    learnerId: "learner-peb",
    accountNo: "PEB002",
    name: "Pebbles",
    surname: "Test",
    balance: 10700,
    ageAnalysis: {
      accountHolder: "Pebbles Test",
      balance: 10700,
      buckets: { current: 10700, d30: 0, d60: 0, d90: 0, d120: 0 },
    },
  });
  const learners = [
    {
      id: "learner-ada-a",
      firstName: "Eldadi",
      lastName: "Adamu",
      billingPlan: [{ amount: 3000 }, { amount: 550 }],
    },
    {
      id: "learner-ada-b",
      firstName: "Sibling",
      lastName: "Adamu",
      billingPlan: [{ amount: 3000 }],
    },
    { id: "learner-peb", firstName: "Pebbles", lastName: "Test", totalFee: 10700 },
  ];
  return { adaRow, pebRow, learners };
}

function testFreshApiLedgerOverridesStaleLocalStorage() {
  installLocalStorageMock();
  resetSchoolLedgerRuntimeForTests();
  localStorage.setItem(
    LEDGER_KEY,
    JSON.stringify({ [SCHOOL]: stalePartialAdaLedger() })
  );

  replaceSchoolLedgerFromApi(SCHOOL, ada004FreshLedger());

  assert(readSchoolLedger(SCHOOL).length === 3, "memory ledger has fresh API rows");
  assert(getSchoolLedgerRuntimeRowCount(SCHOOL) === 3, "runtime row count matches fresh API");
  assert(
    getSchoolLedgerCacheStatus(SCHOOL) === "fresh-local" ||
      getSchoolLedgerCacheStatus(SCHOOL) === "memory-only",
    "cache status is fresh after API replace"
  );

  const { adaRow, pebRow, learners } = financeFixtures();
  const snapshots = buildFinanceAccountSnapshots({
    schoolId: SCHOOL,
    learners,
    statementRows: [adaRow, pebRow],
    policy: DEFAULT_FINANCE_POLICY,
    today: "2026-07-11",
  });
  const ada = snapshots.find((s) => s.accountRef === "ADA004");
  assert(ada?.summary.currentMonthFees === 6550, "ADA004 currentMonthFees uses fresh API ledger");
  console.log("✓ fresh API ledger overrides stale localStorage");
}

function testQuotaFailureDoesNotKeepStaleAuthoritative() {
  installLocalStorageMock({ quotaOnLedgerWrite: true });
  resetSchoolLedgerRuntimeForTests();
  localStorage.setItem(
    LEDGER_KEY,
    JSON.stringify({ [SCHOOL]: stalePartialAdaLedger() })
  );

  replaceSchoolLedgerFromApi(SCHOOL, ada004FreshLedger());

  assert(getSchoolLedgerRuntimeRowCount(SCHOOL) === 3, "memory retains full API ledger after quota failure");
  assert(getSchoolLedgerCacheStatus(SCHOOL) === "memory-only", "status is memory-only when localStorage fails");
  const stored = JSON.parse(localStorage.getItem(LEDGER_KEY) || "{}");
  assert(!Array.isArray(stored[SCHOOL]), "stale school bucket removed from localStorage after failed persist");

  const { adaRow, pebRow, learners } = financeFixtures();
  const ada = buildFinanceAccountSnapshots({
    schoolId: SCHOOL,
    learners,
    statementRows: [adaRow, pebRow],
    policy: DEFAULT_FINANCE_POLICY,
    today: "2026-07-11",
  }).find((s) => s.accountRef === "ADA004");
  assert(ada?.summary.currentMonthFees === 6550, "ADA004 R6550 after quota failure uses memory");
  console.log("✓ quota failure keeps memory authoritative and disables stale localStorage");
}

function testStalePartial550CannotOverrideFreshApi() {
  installLocalStorageMock();
  resetSchoolLedgerRuntimeForTests();
  localStorage.setItem(
    LEDGER_KEY,
    JSON.stringify({ [SCHOOL]: stalePartialAdaLedger() })
  );
  replaceSchoolLedgerFromApi(SCHOOL, ada004FreshLedger());

  const { adaRow, learners } = financeFixtures();
  const ada = buildFinanceAccountSnapshots({
    schoolId: SCHOOL,
    learners,
    statementRows: [adaRow],
    policy: DEFAULT_FINANCE_POLICY,
    today: "2026-07-11",
  }).find((s) => s.accountRef === "ADA004");
  assert(ada?.summary.currentMonthFees !== 550, "stale R550 partial ledger does not win after API replace");
  assert(ada?.summary.currentMonthFees === 6550, "fresh ledger produces R6550");
  console.log("✓ stale R550 partial ledger cannot override fresh API ledger");
}

function testFallbackOnlyWhenApiFails() {
  installLocalStorageMock();
  resetSchoolLedgerRuntimeForTests();
  localStorage.setItem(
    LEDGER_KEY,
    JSON.stringify({ [SCHOOL]: stalePartialAdaLedger() })
  );

  resetSchoolLedgerRuntimeForTests();
  markSchoolLedgerApiSyncFailed(SCHOOL);
  assert(readSchoolLedger(SCHOOL).length === 1, "fallback reads cached ledger when API failed");
  assert(getSchoolLedgerCacheStatus(SCHOOL) === "fallback", "fallback status when API failed");
  assert(shouldShowLedgerFallbackWarning(SCHOOL), "fallback warning shown when API failed");
  console.log("✓ fallback cache used only when API fetch fails");
}

function testCollectionsTotalsWithFreshLedger() {
  installLocalStorageMock();
  resetSchoolLedgerRuntimeForTests();
  replaceSchoolLedgerFromApi(SCHOOL, ada004FreshLedger());

  const { adaRow, pebRow, learners } = financeFixtures();
  const snapshots = buildFinanceAccountSnapshots({
    schoolId: SCHOOL,
    learners,
    statementRows: [adaRow, pebRow],
    policy: DEFAULT_FINANCE_POLICY,
    today: "2026-07-11",
  });
  const total = snapshots.reduce((sum, row) => sum + Math.max(0, row.dueNow), 0);
  const peb = snapshots.find((s) => s.accountRef === "PEB002");
  assert(peb?.dueNow === 10700, "PEB002 dueNow remains R10,700");
  assert(total === 10700, "Collections total remains R10,700 with only PEB002 owing");
  console.log("✓ Collections Centre totals unchanged (PEB002 R10,700)");
}

function testEmptyLocalStorageCannotOverrideFreshApiLedger() {
  installLocalStorageMock();
  resetSchoolLedgerRuntimeForTests();
  localStorage.setItem(LEDGER_KEY, JSON.stringify({ [SCHOOL]: [] }));
  localStorage.setItem(`educlearBillingLedgerMigrated:${SCHOOL}`, "1");

  replaceSchoolLedgerFromApi(SCHOOL, ada004FreshLedger());

  assert(readSchoolLedger(SCHOOL).length === 3, "runtime ledger remains authoritative after empty localStorage");
  assert(
    getSchoolLedgerCacheStatus(SCHOOL) === "fresh-local" ||
      getSchoolLedgerCacheStatus(SCHOOL) === "memory-only",
    "runtime ledger marked fresh after API replace"
  );

  const { adaRow, learners } = financeFixtures();
  const ada = buildFinanceAccountSnapshots({
    schoolId: SCHOOL,
    learners,
    statementRows: [adaRow],
    policy: DEFAULT_FINANCE_POLICY,
    today: "2026-07-11",
  }).find((snapshot) => snapshot.accountRef === "ADA004");
  assert(ada?.summary.currentMonthFees === 6550, "empty localStorage cannot override fresh runtime ledger inputs");
  console.log("✓ empty localStorage cannot override fresh runtime API ledger");
}

function testLargeLedgerSkipsLocalStorageWrite() {
  installLocalStorageMock();
  resetSchoolLedgerRuntimeForTests();
  const huge: BillingLedgerEntry[] = Array.from({ length: 1200 }, (_, index) => ({
    id: `entry-${index}`,
    schoolId: SCHOOL,
    learnerId: "learner-x",
    accountNo: "BIG001",
    type: "invoice" as const,
    amount: 1000,
    date: "2026-01-01",
    reference: `REF-${index}`,
    description: "x".repeat(5000),
    createdAt: "2026-01-01T00:00:00.000Z",
  }));
  const payloadLen = JSON.stringify({ [SCHOOL]: huge }).length;
  assert(payloadLen > SAFE_LOCAL_LEDGER_CACHE_CHARS, "fixture exceeds safe local cache threshold");

  replaceSchoolLedgerFromApi(SCHOOL, huge);
  assert(getSchoolLedgerRuntimeRowCount(SCHOOL) === 1200, "memory stores large ledger");
  assert(getSchoolLedgerCacheStatus(SCHOOL) === "memory-only", "large ledger stays memory-only");
  console.log("✓ large ledger skips localStorage and stays memory-only");
}

testFreshApiLedgerOverridesStaleLocalStorage();
testQuotaFailureDoesNotKeepStaleAuthoritative();
testStalePartial550CannotOverrideFreshApi();
testFallbackOnlyWhenApiFails();
testCollectionsTotalsWithFreshLedger();
testEmptyLocalStorageCannotOverrideFreshApiLedger();
testLargeLedgerSkipsLocalStorageWrite();

console.log("\nAll billingLedger tests passed.");
