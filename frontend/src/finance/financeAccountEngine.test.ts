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
      { id: "learner-d", firstName: "Action", lastName: "Required", billingPlan: [{ amount: 100 }] },
      { id: "learner-e", firstName: "Critical", lastName: "Debt", billingPlan: [{ amount: 100 }] },
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

testGroupedBalanceHealthClassification();
console.log("\nAll financeAccountEngine tests passed.");
