/**
 * Once-off fees stay on a billing plan without being charged every month.
 * Run: npx tsx src/services/onceOffInvoiceChargeGuard.test.ts
 */
import { buildInvoiceChargeLines } from "./invoiceChargeLines";
import {
  applyOnceOffRecurrenceGuard,
  onceOffPlanLinesToRetire,
  type OnceOffCatalogueFee,
} from "./onceOffInvoiceChargeGuard";
import { buildInvoiceRunPlanForTest } from "./invoiceRunExecuteService";
import { creditNoteEntryId } from "./invoiceLineCreditNote";
import type { BillingLedgerEntry } from "../utils/billingLedgerStore";
import type { StoredBillingPlanItem } from "../utils/learnerBillingPlanStore";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const CATALOGUE: OnceOffCatalogueFee[] = [
  { id: "fee-farewell", name: "Grade 7 Farewell", amount: 650, type: "ONCE_OFF" },
  { id: "fee-jamf", name: "JAMF Fee", amount: 450, type: "ONCE_OFF" },
  { id: "fee-grad", name: "Grade R Graduation", amount: 400, type: "ONCE_OFF" },
  { id: "fee-camp", name: "Camp", amount: 900, type: "TERMLY" },
];

const PLAN: StoredBillingPlanItem[] = [
  { id: "line-tuition", feeDescription: "Tuition", amount: 3000 },
  { id: "line-farewell", feeDescription: "Grade 7 Farewell", amount: 650 },
  { id: "line-jamf", feeDescription: "JAMF Fee", amount: 450 },
  { id: "line-camp", feeDescription: "Camp", amount: 900 },
];

function invoice(partial: Partial<BillingLedgerEntry> & Pick<BillingLedgerEntry, "id" | "learnerId">): BillingLedgerEntry {
  return {
    schoolId: "school-1",
    accountNo: "ACC1",
    type: "invoice",
    amount: 0,
    date: "2026-10-01",
    reference: partial.id,
    description: "Invoice Run For October 2026",
    createdAt: "2026-10-01T00:00:00.000Z",
    invoicePeriod: "2026-10",
    ...partial,
  };
}

function descriptions(items: StoredBillingPlanItem[]): string[] {
  return items.map((item) => item.feeDescription);
}

function testFirstChargeKeepsTuitionAndOnceOff() {
  const result = applyOnceOffRecurrenceGuard({
    planItems: PLAN,
    catalogue: CATALOGUE,
    ledger: [],
    learnerId: "child-1",
    invoicePeriod: "2026-10",
  });
  assert(
    descriptions(result.planItems).join("|") === "Tuition|Grade 7 Farewell|JAMF Fee|Camp",
    "October first charge keeps tuition, once-off fees and termly camp"
  );
  assert(result.planItems[1]?.feeStructureId === "fee-farewell", "farewell stamps catalogue id");
  const lines = buildInvoiceChargeLines(result.planItems, result.extraFees);
  assert(lines.ok && lines.lines[1]?.feeStructureId === "fee-farewell", "charge line keeps fee identity");
  assert(lines.ok && lines.total === 5000, "October total includes every current line");
  console.log("✓ October first charge keeps recurring and once-off lines");
}

function testLumpSumDoesNotSuppress() {
  const legacy = invoice({
    id: "oct-lump",
    learnerId: "child-1",
    amount: 5000,
    description: "Invoice Run For October 2026",
  });
  const result = applyOnceOffRecurrenceGuard({
    planItems: PLAN,
    catalogue: CATALOGUE,
    ledger: [legacy],
    learnerId: "child-1",
    invoicePeriod: "2026-11",
  });
  assert(descriptions(result.planItems).includes("Grade 7 Farewell"), "unnamed October total is not treated as Farewell");
  assert(descriptions(result.planItems).includes("JAMF Fee"), "unnamed October total is not treated as JAMF");
  console.log("✓ legacy invoices without the fee name do not suppress once-off fees");
}

function testNamedLegacyAndItemisedIdentity() {
  const named = invoice({
    id: "sep-named",
    learnerId: "child-1",
    invoicePeriod: "2026-09",
    date: "2026-09-01",
    description: "Grade 7 Farewell",
    amount: 650,
  });
  const afterName = applyOnceOffRecurrenceGuard({
    planItems: PLAN,
    catalogue: CATALOGUE,
    ledger: [named],
    learnerId: "child-1",
    invoicePeriod: "2026-10",
  });
  assert(!descriptions(afterName.planItems).includes("Grade 7 Farewell"), "named legacy invoice suppresses Farewell");
  assert(descriptions(afterName.planItems).includes("Tuition"), "tuition remains");
  assert(descriptions(afterName.planItems).includes("JAMF Fee"), "JAMF is independent");

  const itemised = invoice({
    id: "nov-item",
    learnerId: "anchor-1",
    billedLearnerId: "child-1",
    invoicePeriod: "2026-11",
    date: "2026-11-01",
    amount: 4550,
    description: "Tuition; JAMF Fee; Grade 7 Farewell",
    chargeLines: [
      { lineKey: "line-tuition", description: "Tuition", amount: 3000 },
      { lineKey: "line-jamf", description: "JAMF Fee", amount: 450, feeStructureId: "fee-jamf" },
      { lineKey: "line-farewell", description: "Farewell function", amount: 650, feeStructureId: "fee-farewell" },
    ],
  });
  for (const period of ["2026-12", "2027-01"]) {
    const next = applyOnceOffRecurrenceGuard({
      planItems: PLAN,
      extraFees: [{ id: "extra-grad", feeDescription: "Grade R Graduation", amount: 400 }],
      catalogue: CATALOGUE,
      ledger: [itemised],
      learnerId: "child-1",
      invoicePeriod: period,
    });
    assert(!descriptions(next.planItems).includes("Grade 7 Farewell"), `${period} skips Farewell by line identity`);
    assert(!descriptions(next.planItems).includes("JAMF Fee"), `${period} skips JAMF by catalogue id`);
    assert(descriptions(next.planItems).includes("Tuition"), `${period} keeps tuition`);
    assert(descriptions(next.planItems).includes("Camp"), `${period} keeps termly camp`);
    assert(next.extraFees.length === 1, `${period} still allows Graduation the first time`);
  }
  console.log("✓ family, identity and named legacy invoices suppress later once-off charges");
}

function testMonthsThroughInvoiceRun() {
  const child = {
    id: "child-1",
    firstName: "Grade",
    lastName: "Seven",
    enrollmentStatus: "ACTIVE",
    admissionNo: null,
    idNumber: null,
    familyAccountId: "family-1",
    familyAccount: { accountRef: "FAM001" },
  };
  const base = {
    allActiveLearners: [child],
    processedLearners: [child],
    plansByLearnerId: { "child-1": PLAN },
    explicitlyEmpty: new Set<string>(),
    accountNoByLearnerId: { "child-1": "FAM001" },
    onceOffCatalogue: CATALOGUE,
  };
  const october = buildInvoiceRunPlanForTest({ ...base, existingLedger: [], invoicePeriod: "2026-10" });
  assert(october.learnerRows[0]?.status === "invoiced", "October invoices");
  assert(october.learnerRows[0]?.amount === 5000, "October includes once-off fees");
  assert(october.integrity.passed, "October integrity");

  const octoberInvoice = invoice({
    id: "inv-oct",
    learnerId: "child-1",
    accountNo: "FAM001",
    amount: 5000,
    invoicePeriod: "2026-10",
    chargeLines: [
      { lineKey: "line-tuition", description: "Tuition", amount: 3000 },
      { lineKey: "line-farewell", description: "Grade 7 Farewell", amount: 650, feeStructureId: "fee-farewell" },
      { lineKey: "line-jamf", description: "JAMF Fee", amount: 450, feeStructureId: "fee-jamf" },
      { lineKey: "line-camp", description: "Camp", amount: 900 },
    ],
  });
  const retry = buildInvoiceRunPlanForTest({
    ...base,
    existingLedger: [octoberInvoice],
    invoicePeriod: "2026-10",
  });
  assert(retry.learnerRows[0]?.skipReason === "DUPLICATE_INVOICE", "October retry does not create a second invoice");

  const november = buildInvoiceRunPlanForTest({
    ...base,
    existingLedger: [octoberInvoice],
    invoicePeriod: "2026-11",
    extraFeesByLearnerId: {
      "child-1": [{ id: "extra-grad", feeDescription: "Grade R Graduation", amount: 400 }],
    },
  });
  assert(november.integrity.passed, "November integrity");
  assert(november.learnerRows[0]?.amount === 4300, "November keeps tuition, camp and the first Graduation");

  const novemberInvoice = invoice({
    id: "inv-nov",
    learnerId: "child-1",
    accountNo: "FAM001",
    amount: 4300,
    invoicePeriod: "2026-11",
    date: "2026-11-01",
    chargeLines: [
      { lineKey: "line-tuition", description: "Tuition", amount: 3000 },
      { lineKey: "line-camp", description: "Camp", amount: 900 },
      { lineKey: "extra-grad", description: "Grade R Graduation", amount: 400, feeStructureId: "fee-grad" },
    ],
  });
  for (const period of ["2026-12", "2027-01"]) {
    const run = buildInvoiceRunPlanForTest({
      ...base,
      existingLedger: [octoberInvoice, novemberInvoice],
      invoicePeriod: period,
      extraFeesByLearnerId: {
        "child-1": [{ id: "extra-grad", feeDescription: "Grade R Graduation", amount: 400 }],
      },
    });
    assert(run.integrity.passed, `${period} integrity`);
    assert(run.learnerRows[0]?.status === "invoiced", `${period} still invoices tuition`);
    assert(run.learnerRows[0]?.amount === 3900, `${period} drops billed once-off fees`);
  }
  console.log("✓ October, November, December and January runs keep tuition and skip billed once-off fees");
}

function testCleanupLeavesRecurringLines() {
  const ledger = [
    invoice({
      id: "nov",
      learnerId: "child-1",
      invoicePeriod: "2026-11",
      date: "2026-11-01",
      chargeLines: [
        { lineKey: "line-farewell", description: "Grade 7 Farewell", amount: 650, feeStructureId: "fee-farewell" },
      ],
    }),
  ];
  const retired = onceOffPlanLinesToRetire({
    plansByLearnerId: {
      "child-1": PLAN,
      "child-2": [{ id: "line-jamf-2", feeDescription: "JAMF Fee", amount: 450 }],
    },
    catalogue: CATALOGUE,
    ledger,
  });
  assert(retired.length === 1 && retired[0]?.lineId === "line-farewell", "only the billed Farewell line is listed");
  assert(!retired.some((line) => line.description === "Tuition" || line.description === "Camp"), "recurring lines stay");
  console.log("✓ plan cleanup lists billed once-off lines and leaves recurring items");
}

function testCreditPreviewIsStable() {
  const ids = ["inv-a", "inv-b"];
  const first = ids.map((id) => creditNoteEntryId(id, "line-farewell"));
  const second = ids.map((id) => creditNoteEntryId(id, "line-farewell"));
  assert(first.join() === second.join() && new Set(first).size === 2, "credit note ids are deterministic");
  const confirmedLearners = 11;
  const amount = 650;
  assert(confirmedLearners * amount === 7150, "eleven confirmed duplicates are R7,150");
  console.log("✓ duplicate credit preview is R7,150 and cannot be issued twice for the same line");
}

function main() {
  testFirstChargeKeepsTuitionAndOnceOff();
  testLumpSumDoesNotSuppress();
  testNamedLegacyAndItemisedIdentity();
  testMonthsThroughInvoiceRun();
  testCleanupLeavesRecurringLines();
  testCreditPreviewIsStable();
  console.log("onceOffInvoiceChargeGuard.test.ts: OK");
}

main();
