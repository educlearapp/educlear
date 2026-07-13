/**
 * Finance account health classification tests.
 * Run: npx tsx src/finance/financeAccountEngine.test.ts
 */
import type { BillingAccountRow } from "../billing/billingLedger";
import { DEFAULT_FINANCE_POLICY } from "./financePolicy";
import {
  buildFinanceAccountSnapshots,
  groupFinanceSnapshotsByHealth,
} from "./financeAccountEngine";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function installLocalStorageMock() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    get length() {
      return store.size;
    },
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
  };
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
    kidesysSection: input.kidesysSection,
    ageAnalysis: input.ageAnalysis,
  };
}

function testGroupedBalanceHealthClassification() {
  installLocalStorageMock();

  const rows = [
    statementRow({
      id: "learner-a",
      learnerId: "learner-a",
      accountNo: "MAK020",
      familyAccountId: "family-mak020",
      memberLearnerIds: ["learner-a", "learner-b"],
      name: "Mako",
      surname: "One",
      accountHolder: "Mak Family",
      balance: 9120,
      status: "Recently Owing",
      ageAnalysis: {
        accountHolder: "Mak Family",
        balance: 9120,
        buckets: { current: 9120, d30: 0, d60: 0, d90: 0, d120: 0 },
      },
    }),
    statementRow({
      id: "learner-b",
      learnerId: "learner-b",
      accountNo: "MAK020",
      familyAccountId: "family-mak020",
      memberLearnerIds: ["learner-a", "learner-b"],
      name: "Mako",
      surname: "Two",
      accountHolder: "Mak Family",
      balance: 9120,
      status: "Recently Owing",
      ageAnalysis: {
        accountHolder: "Mak Family",
        balance: 9120,
        buckets: { current: 9120, d30: 0, d60: 0, d90: 0, d120: 0 },
      },
    }),
    statementRow({
      id: "learner-c",
      learnerId: "learner-c",
      accountNo: "NEE001",
      name: "Need",
      surname: "Attention",
      balance: 100,
      status: "Recently Owing",
      ageAnalysis: {
        accountHolder: "Need Attention",
        balance: 100,
        buckets: { current: 0, d30: 100, d60: 0, d90: 0, d120: 0 },
      },
    }),
    statementRow({
      id: "learner-d",
      learnerId: "learner-d",
      accountNo: "ACT001",
      name: "Action",
      surname: "Required",
      balance: 250,
      status: "Bad Debt",
      ageAnalysis: {
        accountHolder: "Action Required",
        balance: 250,
        buckets: { current: 0, d30: 250, d60: 0, d90: 0, d120: 0 },
      },
    }),
    statementRow({
      id: "learner-e",
      learnerId: "learner-e",
      accountNo: "CRI001",
      name: "Critical",
      surname: "Debt",
      balance: 400,
      status: "Bad Debt",
      ageAnalysis: {
        accountHolder: "Critical Debt",
        balance: 400,
        buckets: { current: 0, d30: 400, d60: 0, d90: 0, d120: 0 },
      },
    }),
    statementRow({
      id: "learner-f",
      learnerId: "learner-f",
      accountNo: "FUT001",
      name: "Future",
      surname: "Invoice",
      balance: 100,
      status: "Recently Owing",
    }),
  ];

  localStorage.setItem(
    "educlearBillingLedger",
    JSON.stringify({
      "school-test": [
        {
          id: "future-invoice",
          schoolId: "school-test",
          learnerId: "learner-f",
          accountNo: "FUT001",
          type: "invoice",
          amount: 100,
          date: "2026-07-01",
          dueDate: "2026-07-31",
          reference: "JULY",
          description: "July 2026 fees",
          createdAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    })
  );

  const snapshots = buildFinanceAccountSnapshots({
    schoolId: "school-test",
    learners: [
      { id: "learner-a", firstName: "Mako", lastName: "One", familyAccountId: "family-mak020", billingPlan: [{ amount: 4560 }] },
      { id: "learner-b", firstName: "Mako", lastName: "Two", familyAccountId: "family-mak020", billingPlan: [{ amount: 4560 }] },
      { id: "learner-c", firstName: "Need", lastName: "Attention", billingPlan: [{ amount: 100 }] },
      { id: "learner-d", firstName: "Action", lastName: "Required", totalFee: 100 },
      { id: "learner-e", firstName: "Critical", lastName: "Debt", totalFee: 100 },
      { id: "learner-f", firstName: "Future", lastName: "Invoice", billingPlan: [{ amount: 100 }] },
    ],
    statementRows: rows,
    policy: DEFAULT_FINANCE_POLICY,
    today: "2026-06-27",
  });

  const mak020 = snapshots.find((snapshot) => snapshot.billingAccountRef === "MAK020");
  const future = snapshots.find((snapshot) => snapshot.billingAccountRef === "FUT001");
  assert(snapshots.length === 5, "siblings are grouped by billing account ref");
  assert(Boolean(mak020), "MAK020 grouped snapshot exists");
  assert(mak020!.totalBalance === 9120, "MAK020 exposes the full total balance");
  assert(mak020!.learnerNames.length === 2, "MAK020 exposes both sibling learners");
  assert(mak020!.monthlyFeeTotal === 9120, "MAK020 monthly fee total includes both siblings");
  assert(mak020!.dueNow === 9120, "MAK020 uses positive balance when age buckets are unreliable");
  assert(mak020!.monthsOutstanding === 1, "MAK020 balance is one month of grouped fees");
  assert(mak020!.healthStatus === "Needs Attention", "MAK020 must be Needs Attention by balance/monthly fee");
  assert(mak020!.summary.accountHealth === "Needs Attention", "MAK020 summary must match grouped status");
  assert(Boolean(future), "future invoice account exists");
  assert(future!.dueNow === 0, "future invoice is excluded when reliable due date is not yet due");
  assert(future!.healthStatus === "Excellent", "future-not-due account remains Healthy");

  const groups = groupFinanceSnapshotsByHealth(snapshots);
  assert(groups.Excellent.length === 1, "future-not-due account is the only Healthy account");
  assert(groups["Needs Attention"].length === 2, "up to 1 month fees overdue is Needs Attention");
  assert(groups["Action Required"].length === 1, "more than 1 and up to 3 months fees overdue is Action Required");
  assert(groups.Critical.length === 1, "dashboard critical count uses grouped accounts");
  const classifiedTotal = groups.Excellent.length + groups["Needs Attention"].length + groups["Action Required"].length + groups.Critical.length;
  assert(classifiedTotal === snapshots.length, "health buckets equal total grouped billing accounts");
  console.log("✓ grouped account health uses positive balance/monthly fee and excludes reliable future invoices");
}

/** Confirmed Da Silva classifications — statement balance + billing-plan monthly fee only. */
function testConfirmedActiveAccountClassifications() {
  installLocalStorageMock();
  const schoolId = "school-test";
  const today = "2026-07-13";

  const rows = [
    statementRow({
      id: "learner-ram019",
      learnerId: "learner-ram019",
      accountNo: "RAM019",
      balance: 2800,
      status: "Recently Owing",
      ageAnalysis: { accountHolder: "Ramokoka", balance: 2800, buckets: { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 } },
    }),
    statementRow({
      id: "learner-leg003",
      learnerId: "learner-leg003",
      accountNo: "LEG003",
      balance: 8700,
      status: "Recently Owing",
      ageAnalysis: { accountHolder: "Legari", balance: 8700, buckets: { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 } },
    }),
    statementRow({
      id: "learner-ram011",
      learnerId: "learner-ram011",
      accountNo: "RAM011",
      balance: 7100,
      status: "Recently Owing",
      ageAnalysis: { accountHolder: "Ramalete", balance: 7100, buckets: { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 } },
    }),
  ];

  const learners = [
    { id: "learner-ram019", firstName: "Loatile", lastName: "Ramokoka", enrollmentStatus: "ACTIVE", billingPlan: [{ amount: 2800 }] },
    { id: "learner-leg003", firstName: "Thato", lastName: "Legari", enrollmentStatus: "ACTIVE", billingPlan: [{ amount: 4350 }] },
    { id: "learner-ram011", firstName: "Rethabile", lastName: "Ramalete", enrollmentStatus: "ACTIVE", billingPlan: [{ amount: 3550 }] },
  ];

  const snapshots = buildFinanceAccountSnapshots({
    schoolId,
    learners,
    statementRows: rows,
    policy: DEFAULT_FINANCE_POLICY,
    today,
  });

  const ram019 = snapshots.find((s) => s.accountRef === "RAM019");
  const leg003 = snapshots.find((s) => s.accountRef === "LEG003");
  const ram011 = snapshots.find((s) => s.accountRef === "RAM011");

  assert(Boolean(ram019), "RAM019 snapshot exists");
  assert(ram019!.monthsOutstanding === 1, `RAM019 months expected 1 got ${ram019!.monthsOutstanding}`);
  assert(ram019!.collectionsHealth === "Needs Attention", `RAM019 health expected NA got ${ram019!.collectionsHealth}`);
  assert(ram019!.dueNow === 2800, `RAM019 dueNow expected 2800 got ${ram019!.dueNow}`);

  assert(Boolean(leg003), "LEG003 snapshot exists");
  assert(leg003!.monthsOutstanding === 2, `LEG003 months expected 2 got ${leg003!.monthsOutstanding}`);
  assert(leg003!.collectionsHealth === "Action Required", `LEG003 health expected AR got ${leg003!.collectionsHealth}`);
  assert(leg003!.dueNow === 8700, `LEG003 dueNow expected 8700 got ${leg003!.dueNow}`);

  assert(Boolean(ram011), "RAM011 snapshot exists");
  assert(ram011!.monthsOutstanding === 2, `RAM011 months expected 2 got ${ram011!.monthsOutstanding}`);
  assert(ram011!.collectionsHealth === "Action Required", `RAM011 health expected AR got ${ram011!.collectionsHealth}`);
  assert(ram011!.dueNow === 7100, `RAM011 dueNow expected 7100 got ${ram011!.dueNow}`);

  console.log("✓ RAM019 / LEG003 / RAM011 confirmed classifications unchanged");
}

testGroupedBalanceHealthClassification();
testConfirmedActiveAccountClassifications();
console.log("\nAll financeAccountEngine tests passed.");
