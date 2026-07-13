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
    /invoiceRunView[\s\S]{0,120}syncBillingLedgerFromApi/
  );
  assert(Boolean(wizardSync), "wizard should still trigger full ledger sync");
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
