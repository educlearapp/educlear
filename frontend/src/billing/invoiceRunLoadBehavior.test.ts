/**
 * Invoice Runs list load behaviour — no full ledger on list mount.
 * Run: npx tsx src/billing/invoiceRunLoadBehavior.test.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { API_URL } from "../api";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const invoiceRunsSource = fs.readFileSync(path.join(__dirname, "InvoiceRuns.tsx"), "utf8");

function testListMountUsesStatementsNotFullLedger() {
  assert(
    invoiceRunsSource.includes("syncStatementSummariesFromApi"),
    "list mount should sync lightweight statements"
  );
  assert(
    !/useEffect\(\(\) => \{[\s\S]*syncBillingLedgerFromApi[\s\S]*\}, \[\]\)/.test(
      invoiceRunsSource
    ),
    "full ledger sync must not run on empty-deps mount"
  );
  const wizardSync = invoiceRunsSource.match(
    /if \(!shouldSyncInvoiceRunLedger\(invoiceRunView\)\)[\s\S]{0,400}syncBillingLedgerFromApi/
  );
  assert(Boolean(wizardSync), "candidate wizard steps should still trigger full ledger sync once");
  assert(
    invoiceRunsSource.includes("shouldSyncInvoiceRunLedger"),
    "wizardStart must not sync the full ledger"
  );
  assert(
    invoiceRunsSource.includes("shouldBuildInvoiceRunCandidates"),
    "wizardStart must not build the full invoice candidate dataset"
  );
  assert(
    invoiceRunsSource.includes("learnerHasOfficialLinkedFamilyAccount"),
    "invoice candidates must require a linked FamilyAccount"
  );
  assert(
    invoiceRunsSource.includes("avoidRelink: true"),
    "wizard ledger sync must avoid GET /api/invoices/ledger relink"
  );
  assert(
    !invoiceRunsSource.includes("fetchInvoices("),
    "Invoice Run list must not fetch the full invoice dump"
  );
}

function testPreviewInFlightGuardPresent() {
  assert(
    invoiceRunsSource.includes("invoiceRunPreviewInFlightRef"),
    "preview in-flight guard should exist"
  );
}

function testBalanceNeverDefaultsToZeroPlaceholder() {
  assert(
    invoiceRunsSource.includes("formatInvoiceRunBalanceResult"),
    "balance rendering should use loading-aware formatter"
  );
  assert(
    !invoiceRunsSource.includes("if (!ledgerHydrated) return 0"),
    "removed false-zero ledgerHydrated fallback"
  );
}

function testLedgerEndpointNotHardcodedOnListOnly() {
  const ledgerUrl = `${API_URL}/api/invoices/ledger`;
  assert(
    !invoiceRunsSource.includes(`fetch("${ledgerUrl}")`),
    "InvoiceRuns should not directly fetch full ledger URL on list"
  );
}

function main() {
  testListMountUsesStatementsNotFullLedger();
  testPreviewInFlightGuardPresent();
  testBalanceNeverDefaultsToZeroPlaceholder();
  testLedgerEndpointNotHardcodedOnListOnly();
  console.log("invoiceRunLoadBehavior.test.ts — PASS");
}

main();
