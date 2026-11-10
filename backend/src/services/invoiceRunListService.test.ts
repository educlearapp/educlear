/**
 * Invoice run list service tests (read-only ledger grouping).
 * Run: npx ts-node --transpile-only src/services/invoiceRunListService.test.ts
 */
import {
  countInvoicesByPeriod,
  formatInvoicePeriodLabel,
  getInvoiceRunDetailFromLedger,
  listInvoiceRunsFromLedger,
} from "./invoiceRunListService";
import type { BillingLedgerEntry } from "../utils/billingLedgerStore";

const SCHOOL = "test-school-invoice-run-list";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function invoice(partial: Partial<BillingLedgerEntry>): BillingLedgerEntry {
  return {
    id: partial.id || `inv-${Math.random()}`,
    schoolId: SCHOOL,
    learnerId: partial.learnerId || "learner-1",
    accountNo: partial.accountNo || "ALI001",
    type: "invoice",
    amount: partial.amount ?? 100,
    date: partial.date || "2026-06-15",
    reference: partial.reference || "INV-1",
    description: partial.description || "Invoice Run For July 2026",
    createdAt: partial.createdAt || "2026-06-15T10:00:00.000Z",
    ...partial,
  };
}

function runTests() {
  assert(formatInvoicePeriodLabel("2026-08") === "August 2026", "period label");

  const ledger: BillingLedgerEntry[] = [
    invoice({
      id: "a1",
      runId: "RUN-1781514127700",
      invoicePeriod: "2026-07",
      amount: 2000,
      learnerId: "l1",
    }),
    invoice({
      id: "a2",
      runId: "RUN-1781514127700",
      invoicePeriod: "2026-07",
      amount: 1500,
      learnerId: "l2",
    }),
    invoice({
      id: "b1",
      runId: "RUN-1783056354816",
      invoicePeriod: "2026-08",
      description: "Invoice Run For August 2026",
      date: "2026-07-03",
      amount: 3000,
      learnerId: "l3",
      undoneAt: "2026-07-03T08:00:00.000Z",
    }),
    invoice({
      id: "c1",
      runId: "",
      invoicePeriod: "2026-05",
      description: "Manual invoice",
      date: "2026-05-10",
      amount: 500,
      learnerId: "l4",
    }),
  ];

  const runs = listInvoiceRunsFromLedger(SCHOOL, { ledger });
  assert(runs.length === 2, `expected 2 runs, got ${runs.length}`);

  const julyRun = runs.find((run) => run.runId === "RUN-1781514127700");
  assert(!!julyRun, "july run present");
  assert(julyRun!.totalInvoices === 2, "july invoice count");
  assert(julyRun!.totalAmount === 3500, "july total amount");
  assert(julyRun!.source === "ledger", "ledger source");

  const augustRun = runs.find((run) => run.runId === "RUN-1783056354816");
  assert(!augustRun, "undone august run must not appear");

  const periodCounts = countInvoicesByPeriod(SCHOOL, { ledger });
  assert(periodCounts["2026-07"] === 2, "july period count");
  assert(!periodCounts["2026-08"], "august period count excludes undone");

  const flyEagleStyle: BillingLedgerEntry[] = [
    ...ledger,
    invoice({
      id: "fe-inv-1",
      runId: "",
      invoicePeriod: "",
      description: "Express invoice 0220534",
      date: "2026-07-15",
      amount: 1400,
      accountNo: "ABAYE TUMO ASHANAFY",
      source: "universal_migration_phase14",
    }),
    invoice({
      id: "fe-open-1",
      runId: "",
      invoicePeriod: "",
      description: "Migrated inferred opening position",
      date: "2018-01-01",
      amount: 500,
      accountNo: "OLD FAMILY",
      source: "universal_migration_opening_balance",
    }),
  ];
  const feRuns = listInvoiceRunsFromLedger("school-express-migrated", { ledger: flyEagleStyle });
  assert(feRuns.length === 2, `historical Express invoices must not become runs, got ${feRuns.length}`);
  assert(
    !feRuns.some((run) => /express invoice/i.test(String(run.description || ""))),
    "Express invoice descriptions must not appear as invoice runs"
  );
  const feCounts = countInvoicesByPeriod("school-express-migrated", { ledger: flyEagleStyle });
  assert(feCounts["2026-07"] === 2, "Express history excluded from invoice-run period counts");

  const otherSchool = listInvoiceRunsFromLedger("other-school", { ledger: flyEagleStyle });
  assert(otherSchool.length === 2, "list grouping is in-memory; schoolId only gates empty id");

  // Completed-run detail: invoice count != unique family accounts; tenant isolation.
  const siblingLedger: BillingLedgerEntry[] = [
    invoice({
      id: "sib-1",
      runId: "draft:school-a:2026-11",
      schoolId: "school-a",
      invoicePeriod: "2026-11",
      date: "2026-10-15",
      description: "Invoice Run For November 2026",
      accountNo: "FAM001",
      familyAccountId: "fa-1",
      learnerId: "l-a",
      amount: 1000,
    }),
    invoice({
      id: "sib-2",
      runId: "draft:school-a:2026-11",
      schoolId: "school-a",
      invoicePeriod: "2026-11",
      date: "2026-10-15",
      description: "Invoice Run For November 2026",
      accountNo: "FAM001",
      familyAccountId: "fa-1",
      learnerId: "l-b",
      amount: 500,
    }),
    invoice({
      id: "sib-3",
      runId: "draft:school-a:2026-11",
      schoolId: "school-a",
      invoicePeriod: "2026-11",
      date: "2026-10-15",
      description: "Invoice Run For November 2026",
      accountNo: "FAM002",
      familyAccountId: "fa-2",
      learnerId: "l-c",
      amount: 800,
    }),
    invoice({
      id: "other-1",
      runId: "draft:school-a:2026-11",
      schoolId: "school-b",
      invoicePeriod: "2026-11",
      date: "2026-10-15",
      description: "Invoice Run For November 2026",
      accountNo: "OTHER1",
      familyAccountId: "fa-x",
      learnerId: "l-x",
      amount: 999,
    }),
  ];

  const detail = getInvoiceRunDetailFromLedger("school-a", "draft:school-a:2026-11", {
    ledger: siblingLedger,
  });
  assert(!!detail, "detail present");
  assert(detail!.totalInvoices === 3, `expected 3 invoices, got ${detail!.totalInvoices}`);
  assert(
    detail!.uniqueFamilyAccountCount === 2,
    `expected 2 family accounts, got ${detail!.uniqueFamilyAccountCount}`
  );
  assert(detail!.totalAmount === 2300, `expected total 2300, got ${detail!.totalAmount}`);
  assert(detail!.invoiceDate === "2026-10-15", "invoice date");
  assert(detail!.invoicePeriod === "2026-11", "invoice period");

  const isolated = getInvoiceRunDetailFromLedger("school-b", "draft:school-a:2026-11", {
    ledger: siblingLedger,
  });
  assert(isolated === null || isolated.totalInvoices === 1, "school-b only sees its own rows");
  const wrongSchool = getInvoiceRunDetailFromLedger("school-a", "draft:school-b:2026-11", {
    ledger: siblingLedger,
  });
  assert(wrongSchool === null, "missing run for school returns null");

  console.log("invoiceRunListService.test.ts: OK");
}

runTests();
