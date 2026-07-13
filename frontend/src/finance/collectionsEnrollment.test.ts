/**
 * Collections enrollment filter tests.
 * Run: npx tsx src/finance/collectionsEnrollment.test.ts
 */
import fs from "fs";
import path from "path";
import type { BillingAccountRow, BillingLedgerEntry } from "../billing/billingLedger";
import { mapApiStatementRowToBillingAccountRow, replaceSchoolLedgerFromApi } from "../billing/billingLedger";
import { buildFinanceAccountSnapshots, groupCollectionsSnapshotsByHealth } from "./financeAccountEngine";
import { DEFAULT_FINANCE_POLICY } from "./financePolicy";
import {
  filterActiveCollectionsSnapshots,
  isActiveCollectionsAccount,
  learnersLinkedToBillingAccount,
} from "./collectionsEnrollment";
import type { FinanceAccountSnapshot } from "./financeAccountEngine";

const MBB_FIXTURE_DIR = path.resolve(
  process.cwd().endsWith("frontend") ? path.join(process.cwd(), "..") : process.cwd(),
  "backend/storage/collections-overdue-design-investigation/stage-7-mbb-production"
);

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function installLocalStorageMock() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
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
    status: input.status || "Recently Owing",
    ageAnalysis: input.ageAnalysis,
  };
}

function snapshot(row: BillingAccountRow): FinanceAccountSnapshot {
  return {
    row,
    accountRef: String(row.accountNo || ""),
    billingAccountRef: String(row.accountNo || ""),
    parentGuardianName: row.accountHolder || "Parent",
    totalBalance: row.balance ?? 0,
    overpaidAmount: 0,
    monthlyFeeTotal: 3000,
    dueNow: row.balance ?? 0,
    overdueAmount: row.balance ?? 0,
    monthsOutstanding: 1,
    nextDueDate: "",
    learnerNames: [],
    healthStatus: "Needs Attention",
    childrenOnAccount: [],
    learnerDetails: [],
    learnerName: row.name || "",
    learnerDisplayName: row.name || "",
    firstLearnerName: row.name || "",
    parentName: row.accountHolder || "Parent",
    summary: {} as any,
    collectionsHealth: "Needs Attention",
    collectionsReason: "",
    collectionsMonthsOutstanding: 1,
    billing: {} as any,
  };
}

function testUnenrolledDebtorExcludedFromCollections() {
  const row = statementRow({
    accountNo: "MOE008",
    learnerId: "learner-moe008",
    familyAccountId: "family-moe008",
    balance: 24290,
    status: "Bad Debt",
  });
  const roster = [
    {
      id: "learner-moe008",
      firstName: "Oteng",
      lastName: "Moeng",
      enrollmentStatus: "HISTORICAL",
      familyAccountId: "family-moe008",
      familyAccount: { accountRef: "MOE008" },
    },
  ];
  const linked = learnersLinkedToBillingAccount(row, roster);
  assert(linked.length === 1, "MOE008 links to historical learner");
  assert(!isActiveCollectionsAccount(row, roster), "unenrolled debtor account is not active collections");
  const filtered = filterActiveCollectionsSnapshots([snapshot(row)], roster);
  assert(filtered.length === 0, "MOE008 absent from active Collections snapshots");
  console.log("✓ unenrolled debtor excluded from active Collections");
}

function testUnenrolledDebtorStatementBalancePreserved() {
  installLocalStorageMock();
  const row = statementRow({
    id: "learner-moe008",
    learnerId: "learner-moe008",
    accountNo: "MOE008",
    balance: 24290,
    status: "Bad Debt",
    ageAnalysis: { accountHolder: "Moeng", balance: 24290, buckets: { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 } },
  });
  const roster = [
    {
      id: "learner-moe008",
      enrollmentStatus: "HISTORICAL",
      familyAccount: { accountRef: "MOE008" },
      billingPlan: [{ amount: 3000 }],
    },
  ];
  const engineSnapshots = buildFinanceAccountSnapshots({
    schoolId: "school-test",
    learners: roster,
    statementRows: [row],
    policy: DEFAULT_FINANCE_POLICY,
    today: "2026-07-13",
  });
  assert(engineSnapshots.length === 1, "statement engine still builds MOE008");
  assert(engineSnapshots[0]!.totalBalance === 24290, "MOE008 balance preserved before filter");
  const active = filterActiveCollectionsSnapshots(engineSnapshots, roster);
  assert(active.length === 0, "MOE008 filtered out of active Collections only");
  console.log("✓ unenrolled debtor statement balance preserved outside Collections filter");
}

function testActiveLearnerIncluded() {
  const row = statementRow({
    accountNo: "RAM019",
    learnerId: "learner-ram019",
    familyAccountId: "family-ram019",
    balance: 2800,
  });
  const roster = [
    {
      id: "learner-ram019",
      enrollmentStatus: "ACTIVE",
      familyAccountId: "family-ram019",
      familyAccount: { accountRef: "RAM019" },
    },
  ];
  assert(isActiveCollectionsAccount(row, roster), "active learner account stays in Collections");
  console.log("✓ active learner included in Collections");
}

function testSiblingWithOneActiveRemains() {
  const row = statementRow({
    accountNo: "SIB001",
    familyAccountId: "family-sib",
    memberLearnerIds: ["learner-active", "learner-historical"],
    balance: 5000,
  });
  const roster = [
    { id: "learner-active", enrollmentStatus: "ACTIVE", familyAccountId: "family-sib", familyAccount: { accountRef: "SIB001" } },
    { id: "learner-historical", enrollmentStatus: "HISTORICAL", familyAccountId: "family-sib", familyAccount: { accountRef: "SIB001" } },
  ];
  assert(isActiveCollectionsAccount(row, roster), "sibling account with one active learner remains");
  console.log("✓ sibling account with one active learner remains");
}

function testOverpaidUnenrolledExcluded() {
  const row = statementRow({
    accountNo: "OVE001",
    learnerId: "learner-ove",
    balance: -500,
    status: "Over Paid",
  });
  const roster = [{ id: "learner-ove", enrollmentStatus: "HISTORICAL", familyAccount: { accountRef: "OVE001" } }];
  assert(!isActiveCollectionsAccount(row, roster), "overpaid unenrolled account excluded");
  console.log("✓ overpaid unenrolled account excluded");
}

function testZeroBalanceUnenrolledExcluded() {
  const row = statementRow({
    accountNo: "ZER001",
    learnerId: "learner-zer",
    balance: 0,
    status: "Up To Date",
  });
  const roster = [{ id: "learner-zer", enrollmentStatus: "HISTORICAL", familyAccount: { accountRef: "ZER001" } }];
  assert(!isActiveCollectionsAccount(row, roster), "zero-balance unenrolled account excluded");
  console.log("✓ zero-balance unenrolled account excluded");
}

function testUnknownLearnerRowKept() {
  const row = statementRow({ accountNo: "UNK001", balance: 1200 });
  const roster = [{ id: "other", enrollmentStatus: "HISTORICAL", familyAccount: { accountRef: "OTH001" } }];
  assert(isActiveCollectionsAccount(row, roster), "unmatched statement row kept when no learner link exists");
  console.log("✓ unmatched statement row kept when no learner link exists");
}

function mapMbbStatementRow(raw: any) {
  const row = {
    accountNo: String(raw.accountNo || ""),
    learnerId: String(raw.learnerId || ""),
    schoolId: String(raw.schoolId || ""),
    balance: round2(Number(raw.balance) || 0),
    status: String(raw.status || ""),
    kidesysSection: String(raw.kidesysSection || ""),
    familyAccountId: String(raw.familyAccountId || ""),
    familyName: String(raw.familyName || raw.accountHolder || "").slice(0, 60),
    memberLearnerIds: Array.isArray(raw.memberLearnerIds) ? raw.memberLearnerIds.map(String) : [],
    memberNames: Array.isArray(raw.memberNames) ? raw.memberNames.map((n: unknown) => String(n || "")) : [],
    lastInvoice: round2(Number(raw.lastInvoice) || 0),
    lastInvoiceDate: String(raw.lastInvoiceDate || "").slice(0, 10),
    lastPayment: round2(Number(raw.lastPayment) || 0),
    lastPaymentDate: String(raw.lastPaymentDate || "").slice(0, 10),
    ageAnalysis: raw.ageAnalysis
      ? {
          balance: round2(Number(raw.ageAnalysis.balance) || 0),
          buckets: raw.ageAnalysis.buckets || null,
          importedAt: raw.ageAnalysis.importedAt ? String(raw.ageAnalysis.importedAt).slice(0, 24) : "",
        }
      : null,
  };
  const copy = { ...row, ageAnalysis: row.ageAnalysis ? { ...row.ageAnalysis } : null };
  if (copy.ageAnalysis && Number(copy.ageAnalysis.balance) === 0 && Number(copy.balance) > 0) {
    const { balance: _drop, ...rest } = copy.ageAnalysis;
    copy.ageAnalysis = { ...rest, buckets: copy.ageAnalysis.buckets };
  }
  return mapApiStatementRowToBillingAccountRow(copy as any);
}

function mapMbbLedgerEntry(schoolId: string, raw: any): BillingLedgerEntry {
  const type = String(raw.type || "invoice").toLowerCase();
  const entryType: BillingLedgerEntry["type"] =
    type === "payment" || type === "credit" || type === "penalty" ? type : "invoice";
  return {
    id: String(raw.id),
    schoolId,
    learnerId: String(raw.learnerId || ""),
    accountNo: String(raw.accountNo || ""),
    type: entryType,
    amount: round2(Number(raw.amount) || 0),
    date: String(raw.date || "").slice(0, 10),
    dueDate: raw.dueDate ? String(raw.dueDate).slice(0, 10) : undefined,
    reference: String(raw.reference || ""),
    description: String(raw.description || ""),
    source: raw.source ? String(raw.source) : undefined,
    createdAt: String(raw.createdAt || new Date().toISOString()),
  };
}

function testMbbProductionFixtureUnchanged() {
  const meta = JSON.parse(fs.readFileSync(path.join(MBB_FIXTURE_DIR, "mbb-production-fixture-meta.json"), "utf8"));
  const statements = JSON.parse(fs.readFileSync(path.join(MBB_FIXTURE_DIR, "mbb-production-statements-sanitized.json"), "utf8"));
  const learnersRaw = JSON.parse(fs.readFileSync(path.join(MBB_FIXTURE_DIR, "mbb-production-learners-sanitized.json"), "utf8"));
  const ledgerRaw = JSON.parse(fs.readFileSync(path.join(MBB_FIXTURE_DIR, "mbb-production-ledger-sanitized.json"), "utf8"));

  const schoolId = meta.schoolId;
  installLocalStorageMock();
  const ledgerEntries = ledgerRaw.map((row: any) => mapMbbLedgerEntry(schoolId, row));
  replaceSchoolLedgerFromApi(schoolId, ledgerEntries);
  localStorage.setItem(`educlearBillingLedgerMigrated:${schoolId}`, "1");

  const statementRows = statements.map(mapMbbStatementRow);
  const enrollmentRoster = learnersRaw.map((l: any) => ({
    ...l,
    enrollmentStatus: l.enrollmentStatus || "ACTIVE",
    enrolled: l.enrolled ?? true,
    isEnrolled: l.isEnrolled ?? true,
  }));

  const snapshots = buildFinanceAccountSnapshots({
    schoolId,
    learners: enrollmentRoster,
    statementRows,
    policy: meta.financePolicy || DEFAULT_FINANCE_POLICY,
    today: "2026-07-13",
  });
  const filtered = filterActiveCollectionsSnapshots(snapshots, enrollmentRoster);

  const beforeGroups = groupCollectionsSnapshotsByHealth(snapshots);
  const afterGroups = groupCollectionsSnapshotsByHealth(filtered);
  const collectableBefore = round2(snapshots.reduce((s, r) => s + Math.max(0, r.dueNow), 0));
  const collectableAfter = round2(filtered.reduce((s, r) => s + Math.max(0, r.dueNow), 0));

  assert(snapshots.length === meta.groupedAccountCount, `MBB account count ${snapshots.length} vs ${meta.groupedAccountCount}`);
  assert(filtered.length === snapshots.length, "MBB enrollment filter excludes zero production accounts");
  assert(collectableBefore === meta.overallCollectable, `MBB collectable ${collectableBefore} vs ${meta.overallCollectable}`);
  assert(collectableAfter === collectableBefore, "MBB collectable unchanged after filter");
  assert(beforeGroups.Excellent.length === meta.collectionsCategoryCounts.Healthy, "MBB Healthy count");
  assert(beforeGroups["Needs Attention"].length === meta.collectionsCategoryCounts["Needs Attention"], "MBB NA count");
  assert(beforeGroups["Action Required"].length === meta.collectionsCategoryCounts["Action Required"], "MBB AR count");
  assert(beforeGroups.Critical.length === meta.collectionsCategoryCounts.Critical, "MBB Critical count");
  assert(afterGroups.Excellent.length === beforeGroups.Excellent.length, "MBB Healthy unchanged after filter");
  assert(afterGroups["Needs Attention"].length === beforeGroups["Needs Attention"].length, "MBB NA unchanged after filter");
  assert(afterGroups["Action Required"].length === beforeGroups["Action Required"].length, "MBB AR unchanged after filter");
  assert(afterGroups.Critical.length === beforeGroups.Critical.length, "MBB Critical unchanged after filter");
  assert(meta.uiPreferences.showBillingSummaryCards === false, "MBB hidden summary cards preference preserved");
  console.log("✓ MBB production fixture unchanged by enrollment filter");
}

testUnenrolledDebtorExcludedFromCollections();
testUnenrolledDebtorStatementBalancePreserved();
testActiveLearnerIncluded();
testSiblingWithOneActiveRemains();
testOverpaidUnenrolledExcluded();
testZeroBalanceUnenrolledExcluded();
testUnknownLearnerRowKept();
testMbbProductionFixtureUnchanged();
console.log("\nAll collectionsEnrollment tests passed.");
