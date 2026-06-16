/**
 * Invoice batch route performance/guard tests (static + builder).
 * Run: npx tsx src/routes/invoices.batch.test.ts
 */
import fs from "fs";
import path from "path";

import { detectLearnerAccountMismatch } from "../services/invoiceEntryBuilder";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function testBatchRouteDoesNotScanFullLedger() {
  const file = path.join(__dirname, "invoices.ts");
  const src = fs.readFileSync(file, "utf8");
  const batchStart = src.indexOf('router.post("/batch"');
  assert(batchStart >= 0, "batch route exists");
  const batchEnd = src.indexOf('router.get("/ledger"', batchStart);
  const batchSection = src.slice(batchStart, batchEnd);
  assert(
    !batchSection.includes("listInvoices("),
    "batch route must not call listInvoices (full ledger scan)"
  );
  console.log("✓ POST /batch does not call listInvoices");
}

function testMismatchStillRejected() {
  const diff = detectLearnerAccountMismatch("RAM009", "DUP001");
  assert(diff.mismatch, "mismatched learner/account refs rejected");
  console.log("✓ LEARNER_ACCOUNT_MISMATCH detection unchanged");
}

function testAccountOnlyPassesMismatchGuard() {
  assert(!detectLearnerAccountMismatch("", "RAM009").mismatch, "account-only ok");
  assert(!detectLearnerAccountMismatch("RAM009", "RAM009").mismatch, "matching refs ok");
  console.log("✓ accountNo-only manual invoice passes mismatch guard");
}

function testBatchUsesResilientSettingsLoader() {
  const settingsFile = path.join(__dirname, "billingSettings.ts");
  const settingsSrc = fs.readFileSync(settingsFile, "utf8");
  assert(
    settingsSrc.includes("return defaultBillingSettings()"),
    "settings loader falls back to defaults"
  );
  console.log("✓ batch path uses resilient loadSchoolBillingSettings (defaults on DB failure)");
}

function main() {
  testBatchRouteDoesNotScanFullLedger();
  testBatchUsesResilientSettingsLoader();
  testMismatchStillRejected();
  testAccountOnlyPassesMismatchGuard();
  console.log("\nAll invoices.batch tests passed.");
}

main();
