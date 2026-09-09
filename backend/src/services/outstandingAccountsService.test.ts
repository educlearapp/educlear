/**
 * Outstanding Accounts service unit tests.
 * Run: npx tsx src/services/outstandingAccountsService.test.ts
 */
import assert from "assert";
import type { BillingStatementAccountRow } from "./statementAccounts";
import type { BillingLedgerEntry } from "../utils/billingLedgerStore";
import {
  buildOutstandingSummary,
  calendarDaysBetween,
  filterPositiveBalanceAccounts,
  mapOutstandingRows,
  resolveOldestPastDue,
  selectOutstandingBillingContact,
} from "./outstandingAccountsService";

function baseAccount(partial: Partial<BillingStatementAccountRow>): BillingStatementAccountRow {
  return {
    accountNo: "FAM001",
    learnerId: "L1",
    schoolId: "school-1",
    name: "John",
    surname: "Smith",
    balance: 4500,
    lastInvoice: 1000,
    lastInvoiceDate: "2026-08-01",
    lastInvoiceLabel: null,
    lastPayment: 500,
    lastPaymentDate: "2026-07-15",
    status: "Recently Owing",
    kidesysSection: "",
    familyAccountId: "FA1",
    familyName: "Smith",
    memberLearnerIds: ["L1", "L2"],
    memberNames: ["John Smith", "Mary Smith"],
    accountHolder: "Smith",
    eduClearAccountNo: "FAM001",
    sourceAccountRef: "FAM001",
    ...partial,
  };
}

function testBalanceInclusion() {
  const rows = filterPositiveBalanceAccounts([
    baseAccount({ accountNo: "POS", balance: 12.5 }),
    baseAccount({ accountNo: "ZERO", balance: 0 }),
    baseAccount({ accountNo: "CREDIT", balance: -40 }),
    baseAccount({ accountNo: "TINY", balance: 0.004 }), // rounds to 0
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].accountNo, "POS");
  console.log("✓ balance > 0 only; zero/credit/rounded-zero excluded");
}

function testMultiLearnerOneRow() {
  const mapped = mapOutstandingRows({
    statementAccounts: [baseAccount({ balance: 4500 })],
    learnersById: new Map([
      ["L1", { id: "L1", grade: "Grade 3", className: "3A" }],
      ["L2", { id: "L2", grade: "Grade 7", className: "7B" }],
    ]),
    links: [],
    parentsByFamilyId: new Map(),
    ledger: [],
    asOfDate: "2026-09-09",
  });
  assert.equal(mapped.length, 1);
  assert.deepEqual(mapped[0].learnerNames, ["John Smith", "Mary Smith"]);
  assert.equal(mapped[0].outstandingBalance, 4500);
  assert.deepEqual(mapped[0].grades, ["Grade 3", "Grade 7"]);
  assert.deepEqual(mapped[0].classes, ["3A", "7B"]);
  const summary = buildOutstandingSummary(mapped);
  assert.equal(summary.outstandingAccountCount, 1);
  assert.equal(summary.learnersAffected, 2);
  assert.equal(summary.totalOutstanding, 4500);
  console.log("✓ multi-learner: one row, both names, balance once, learnersAffected=2");
}

function testContactRanking() {
  const contact = selectOutstandingBillingContact(
    [
      {
        learnerId: "L1",
        isPrimary: false,
        isPayingPerson: true,
        billingStatement: true,
        relation: "Father",
        parent: {
          id: "P-pay",
          firstName: "Pay",
          surname: "Parent",
          cellNo: "0821111111",
          workNo: "0112223333",
          homeNo: null,
          email: null,
          communicationBilling: true,
        },
      },
      {
        learnerId: "L1",
        isPrimary: true,
        isPayingPerson: false,
        billingStatement: true,
        relation: "Mother",
        parent: {
          id: "P-pri",
          firstName: "Primary",
          surname: "Parent",
          cellNo: "0839999999",
          workNo: null,
          homeNo: "0114445555",
          email: "primary@example.com",
          communicationBilling: true,
        },
      },
    ],
    ["L1"]
  );
  assert.equal(contact.parentId, "P-pri", "isPrimary (+10) beats isPayingPerson (+6)");
  assert.equal(contact.primaryCellphone, "0839999999");
  assert.equal(contact.alternateContact, "0114445555");
  assert.equal(contact.email, "primary@example.com");
  console.log("✓ contact ranking prefers isPrimary; cell/work-home/email populated");
}

function testMissingEmailDoesNotExclude() {
  const contact = selectOutstandingBillingContact(
    [
      {
        learnerId: "L1",
        isPrimary: true,
        isPayingPerson: false,
        billingStatement: true,
        relation: "Guardian",
        parent: {
          id: "P1",
          firstName: "No",
          surname: "Email",
          cellNo: "0810000000",
          workNo: null,
          homeNo: null,
          email: null,
          communicationBilling: true,
        },
      },
    ],
    ["L1"]
  );
  assert.equal(contact.name, "No Email");
  assert.equal(contact.email, null);
  assert.equal(contact.primaryCellphone, "0810000000");
  console.log("✓ missing email does not exclude account contact");
}

function testMissingParentSafe() {
  const mapped = mapOutstandingRows({
    statementAccounts: [baseAccount({ balance: 100 })],
    learnersById: new Map([["L1", { id: "L1", grade: "1", className: null }]]),
    links: [],
    parentsByFamilyId: new Map(),
    ledger: [],
    asOfDate: "2026-09-09",
  });
  assert.equal(mapped[0].parentGuardianName, null);
  assert.equal(mapped[0].primaryCellphone, null);
  console.log("✓ missing parent data does not crash");
}

function testDaysOverdueFromDueDateNotInvoiceDate() {
  const ledger: BillingLedgerEntry[] = [
    {
      id: "inv-1",
      schoolId: "school-1",
      learnerId: "L1",
      accountNo: "FAM001",
      type: "invoice",
      amount: 2000,
      date: "2026-01-01",
      dueDate: "2026-06-01",
      createdAt: "2026-01-01T00:00:00.000Z",
      description: "Fees",
      reference: "INV1",
    },
  ];
  const overdue = resolveOldestPastDue(ledger, "FAM001", ["L1"], "2026-09-09");
  assert.equal(overdue.oldestDueDate, "2026-06-01");
  assert.equal(overdue.daysOverdue, calendarDaysBetween("2026-06-01", "2026-09-09"));
  assert.notEqual(overdue.daysOverdue, calendarDaysBetween("2026-01-01", "2026-09-09"));
  console.log("✓ days overdue uses dueDate, not invoice date");
}

function testUnknownOverdueWhenNoDue() {
  const ledger: BillingLedgerEntry[] = [
    {
      id: "pay-1",
      schoolId: "school-1",
      learnerId: "L1",
      accountNo: "FAM001",
      type: "payment",
      amount: 100,
      date: "2026-08-01",
      createdAt: "2026-08-01T00:00:00.000Z",
      description: "Payment",
      reference: "P1",
    },
  ];
  const overdue = resolveOldestPastDue(ledger, "FAM001", ["L1"], "2026-09-09");
  assert.equal(overdue.daysOverdue, null);
  assert.equal(overdue.oldestDueDate, null);
  console.log("✓ unknown overdue when no past-due invoice");
}

function testSummaryEqualsRowSum() {
  const mapped = mapOutstandingRows({
    statementAccounts: [
      baseAccount({ accountNo: "A", balance: 1000.1, memberLearnerIds: ["L1"], memberNames: ["A"] }),
      baseAccount({
        accountNo: "B",
        balance: 2000.2,
        familyAccountId: "FA2",
        memberLearnerIds: ["L2", "L3"],
        memberNames: ["B1", "B2"],
      }),
    ],
    learnersById: new Map(),
    links: [],
    parentsByFamilyId: new Map(),
    ledger: [],
    asOfDate: "2026-09-09",
  });
  const summary = buildOutstandingSummary(mapped);
  const manual = mapped.reduce((s, r) => s + r.outstandingBalance, 0);
  assert.equal(summary.totalOutstanding, Math.round(manual * 100) / 100);
  assert.equal(summary.outstandingAccountCount, 2);
  assert.equal(summary.learnersAffected, 3);
  console.log("✓ summary totals match filtered rows");
}

function testWorkNoPreferredOverHomeNo() {
  const contact = selectOutstandingBillingContact(
    [
      {
        learnerId: "L1",
        isPrimary: true,
        isPayingPerson: false,
        billingStatement: true,
        relation: null,
        parent: {
          id: "P1",
          firstName: "A",
          surname: "B",
          cellNo: "0811",
          workNo: "011WORK",
          homeNo: "011HOME",
          email: "a@b.com",
          communicationBilling: true,
        },
      },
    ],
    ["L1"]
  );
  assert.equal(contact.alternateContact, "011WORK");
  console.log("✓ alternate contact prefers workNo over homeNo");
}

testBalanceInclusion();
testMultiLearnerOneRow();
testContactRanking();
testMissingEmailDoesNotExclude();
testMissingParentSafe();
testDaysOverdueFromDueDateNotInvoiceDate();
testUnknownOverdueWhenNoDue();
testSummaryEqualsRowSum();
testWorkNoPreferredOverHomeNo();
console.log("\nAll outstandingAccountsService tests passed.");
