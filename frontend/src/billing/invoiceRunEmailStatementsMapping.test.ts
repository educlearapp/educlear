/**
 * Email Statements wizard row enrichment (post-71978b5 mapping gap).
 * Run: npx tsx src/billing/invoiceRunEmailStatementsMapping.test.ts
 */
import assert from "node:assert/strict";
import {
  enrichInvoiceRunWizardRowContactAndLabels,
  mapInvoiceRunPreviewToWizardRows,
} from "./invoiceRunList.ts";

function testCanonicalParentEmail() {
  const mapped = mapInvoiceRunPreviewToWizardRows({
    previewLearners: [
      {
        learnerId: "l1",
        learnerName: "Test Synthetic",
        accountNo: "ACC1",
        status: "invoiced",
        amount: 600,
      },
    ],
    localLearners: [
      {
        id: "l1",
        firstName: "Test",
        surname: "Synthetic",
        accountNo: "ACC1",
        familyAccountId: "fa1",
      },
    ],
  });
  assert.equal(mapped.length, 1);
  const enriched = enrichInvoiceRunWizardRowContactAndLabels({
    row: mapped[0],
    index: 0,
    localLearner: mapped[0],
    parent: { firstName: "Pat", surname: "Parent", email: "parent@example.com" },
    billingContact: { name: "Pat Parent", email: "parent@example.com" },
    invoiceNo: "INV-TEST-0001",
  });
  assert.equal(enriched.learnerId, "l1");
  assert.equal(enriched.accountNo, "ACC1");
  assert.equal(enriched.parentName, "Pat Parent");
  assert.equal(enriched.parentEmail, "parent@example.com");
  assert.equal(enriched.statementNo, "ST0001");
  assert.equal(enriched.invoiceNo, "INV-TEST-0001");
  assert.notEqual(enriched.statementNo, undefined);
  console.log("✓ canonical parent.email + statementNo/invoiceNo");
}

function testLegacyFallbackEmail() {
  const enriched = enrichInvoiceRunWizardRowContactAndLabels({
    row: { learnerId: "l2", accountNo: "A2", learnerName: "Kid Two" },
    index: 1,
    localLearner: { id: "l2", parentEmail: "legacy-learner@example.com" },
    parent: { name: "Legacy Guardian", parentEmail: "legacy-parent@example.com" },
    billingContact: null,
    invoiceNo: "65001",
  });
  assert.equal(enriched.parentEmail, "legacy-parent@example.com");
  assert.equal(enriched.parentName, "Legacy Guardian");
  assert.equal(enriched.statementNo, "ST0002");
  assert.equal(enriched.invoiceNo, "65001");
  console.log("✓ legacy parent.parentEmail fallback");
}

function testLearnerGuardianEmailFallback() {
  const enriched = enrichInvoiceRunWizardRowContactAndLabels({
    row: { learnerId: "l3", accountNo: "A3" },
    index: 2,
    localLearner: { id: "l3", guardianEmail: "guardian@example.com", guardianName: "Gua Rdian" },
    parent: null,
    billingContact: null,
  });
  assert.equal(enriched.parentEmail, "guardian@example.com");
  assert.equal(enriched.parentName, "Gua Rdian");
  assert.equal(enriched.statementNo, "ST0003");
  assert.ok(enriched.invoiceNo);
  console.log("✓ learner guardianEmail fallback");
}

function testMissingEmailStaysEmptyForUi() {
  const enriched = enrichInvoiceRunWizardRowContactAndLabels({
    row: { learnerId: "l4", accountNo: "A4", learnerName: "No Email" },
    index: 3,
    localLearner: { id: "l4" },
    parent: { name: "No Mail Parent" },
    billingContact: { name: "No Mail Parent", email: "" },
  });
  assert.equal(enriched.parentEmail, "");
  assert.equal(Boolean(enriched.parentEmail), false, "UI Missing Email gate");
  assert.equal(enriched.statementNo, "ST0004");
  assert.notEqual(String(enriched.statementNo), "undefined");
  assert.ok(String(enriched.statementNo).length > 0);
  console.log("✓ no-email case leaves parentEmail empty; statementNo defined");
}

function testBillingContactPreferredOverLegacy() {
  const enriched = enrichInvoiceRunWizardRowContactAndLabels({
    row: { learnerId: "l5" },
    index: 0,
    localLearner: { id: "l5", parentEmail: "old@example.com" },
    parent: { email: "parent-field@example.com", parentEmail: "legacy@example.com" },
    billingContact: { name: "Canonical", email: "canonical@example.com" },
    invoiceNo: "X1",
  });
  assert.equal(enriched.parentEmail, "canonical@example.com");
  assert.equal(enriched.parentName, "Canonical");
  console.log("✓ resolveStatementBillingContact email preferred");
}

function main() {
  testCanonicalParentEmail();
  testLegacyFallbackEmail();
  testLearnerGuardianEmailFallback();
  testMissingEmailStaysEmptyForUi();
  testBillingContactPreferredOverLegacy();
  console.log("\nAll invoiceRunEmailStatementsMapping tests passed.");
}

main();
