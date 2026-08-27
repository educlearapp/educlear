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
  assert(
    !invoiceRunsSource.includes("shouldSyncInvoiceRunLedger"),
    "Invoice Runs wizard must not gate on historic ledger sync"
  );
  assert(
    invoiceRunsSource.includes("shouldPrefetchInvoiceRunPreview"),
    "candidate wizard steps prefetch bounded server preview"
  );
  assert(
    invoiceRunsSource.includes("toThinInvoiceRunDraft"),
    "browser drafts must be thinned before persist"
  );
  assert(
    invoiceRunsSource.includes("childrenPaginatedRows"),
    "Children must render the active page only"
  );
  assert(
    invoiceRunsSource.includes("learnerHasOfficialLinkedFamilyAccount"),
    "invoice candidates must require a linked FamilyAccount"
  );
  assert(
    !invoiceRunsSource.includes("avoidRelink: true"),
    "wizard must not sync the historic ledger even with avoidRelink"
  );
  assert(
    !invoiceRunsSource.includes("fetchInvoices("),
    "Invoice Run list must not fetch the full invoice dump"
  );
  assert(
    !invoiceRunsSource.includes("syncBillingLedgerFromApi"),
    "Invoice Runs must not call syncBillingLedgerFromApi"
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
