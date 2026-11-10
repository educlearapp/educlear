/**
 * Completed invoice-run detail / Print Statements helpers.
 * Run: npx tsx src/billing/invoiceRunCompletedDetail.test.ts
 */
import assert from "node:assert/strict";
import {
  canLaunchInvoiceRunPrint,
  invoiceRunPrintEmptyMessage,
  mapInvoiceRunDetailToManageRows,
  mapInvoiceRunFamilyAccountsToStatementRows,
  shouldLoadCompletedInvoiceRunDetail,
  type InvoiceRunCompletedDetail,
} from "./invoiceRunCompletedDetail.ts";

function sampleDetail(): InvoiceRunCompletedDetail {
  return {
    schoolId: "cmpideqeq0000108xb6ouv9zi",
    runId: "draft:cmpideqeq0000108xb6ouv9zi:2026-11",
    description: "Invoice Run For November 2026",
    invoicePeriod: "2026-11",
    period: "November 2026",
    invoiceDate: "2026-10-15",
    dueDate: "2026-11-07",
    totalInvoices: 3,
    totalAmount: 2300,
    uniqueFamilyAccountCount: 2,
    invoices: [
      {
        id: "i1",
        learnerId: "l1",
        accountNo: "FAM001",
        familyAccountId: "fa-1",
        amount: 1000,
        date: "2026-10-15",
        reference: "INV-1",
        description: "Invoice Run For November 2026",
      },
      {
        id: "i2",
        learnerId: "l2",
        accountNo: "FAM001",
        familyAccountId: "fa-1",
        amount: 500,
        date: "2026-10-15",
        reference: "INV-2",
        description: "Invoice Run For November 2026",
      },
      {
        id: "i3",
        learnerId: "l3",
        accountNo: "FAM002",
        familyAccountId: "fa-2",
        amount: 800,
        date: "2026-10-15",
        reference: "INV-3",
        description: "Invoice Run For November 2026",
      },
    ],
    familyAccounts: [
      {
        key: "family:fa-1",
        accountNo: "FAM001",
        familyAccountId: "fa-1",
        learnerIds: ["l1", "l2"],
        invoiceCount: 2,
        invoiceAmount: 1500,
        anchorLearnerId: "l1",
      },
      {
        key: "family:fa-2",
        accountNo: "FAM002",
        familyAccountId: "fa-2",
        learnerIds: ["l3"],
        invoiceCount: 1,
        invoiceAmount: 800,
        anchorLearnerId: "l3",
      },
    ],
  };
}

function main() {
  assert.equal(
    shouldLoadCompletedInvoiceRunDetail({
      id: "draft:cmpideqeq0000108xb6ouv9zi:2026-11",
      source: "ledger",
      totalInvoices: 393,
      executed: true,
    }),
    true,
    "ledger-backed completed runs must reload detail"
  );
  assert.equal(
    shouldLoadCompletedInvoiceRunDetail({
      id: "draft:x:pending",
      source: "browser-draft",
      executed: false,
      totalInvoices: 0,
    }),
    false,
    "empty browser drafts do not reload"
  );

  const manageRows = mapInvoiceRunDetailToManageRows(sampleDetail());
  assert.equal(manageRows.length, 3, "manage rows follow invoice lines");
  const statementRows = mapInvoiceRunFamilyAccountsToStatementRows(sampleDetail());
  assert.equal(statementRows.length, 2, "statement rows follow unique family accounts");
  assert.notEqual(manageRows.length, statementRows.length, "393 invoices must not imply 393 statements");

  assert.equal(canLaunchInvoiceRunPrint(0), false, "empty batch cannot print");
  assert.equal(canLaunchInvoiceRunPrint(2), true, "non-empty batch can print");
  assert.match(invoiceRunPrintEmptyMessage("statements"), /No family account statements/);

  console.log("invoiceRunCompletedDetail.test.ts — PASS");
}

main();
