/**
 * Fly Eagle-scale Invoice Run wizard architecture: no historic ledger in the wizard.
 * Run: npx tsx src/billing/invoiceRunWizardArchitecture.test.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  beginInvoiceRunWizard,
  buildInvoiceRunExtraFeesByLearnerId,
  learnerHasOfficialLinkedFamilyAccount,
  listSchoolInvoiceRunDrafts,
  mapInvoiceRunPreviewToWizardRows,
  mergeInvoiceRunLists,
  paginateInvoiceRunRows,
  persistInvoiceRunDraft,
  shouldHydrateHistoricBillingLedger,
  shouldPrefetchInvoiceRunPreview,
  shouldSyncInvoiceRunLedger,
  toThinInvoiceRunDraft,
  type InvoiceRunPreviewLearner,
} from "./invoiceRunList";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLY_EAGLE = "cmt1e8bjp0jo8lcjeketlynhl";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function testNetworkContractFromSource() {
  const invoiceRuns = fs.readFileSync(path.join(__dirname, "InvoiceRuns.tsx"), "utf8");
  const dashboard = fs.readFileSync(path.join(__dirname, "../SchoolDashboard.tsx"), "utf8");
  const billingApi = fs.readFileSync(path.join(__dirname, "billingApi.ts"), "utf8");

  for (const view of [
    "wizardStart",
    "wizardSettings",
    "wizardChildren",
    "wizardFees",
    "wizardPreview",
  ]) {
    assert(shouldSyncInvoiceRunLedger(view) === false, `${view} must not sync historic ledger`);
  }

  assert(!invoiceRuns.includes("fetchInvoices("), "wizard must not GET /api/invoices");
  assert(!invoiceRuns.includes("fetchPayments("), "wizard must not GET /api/payments");
  assert(!invoiceRuns.includes("syncBillingLedgerFromApi"), "wizard must not hydrate historic ledger");
  assert(invoiceRuns.includes("previewInvoiceRun"), "wizard uses server preview");
  assert(invoiceRuns.includes("dryRun: true") === false, "preview helper lives in billingApi");
  assert(billingApi.includes('"/api/invoice-runs/preview"'), "preview endpoint");
  assert(billingApi.includes("dryRun: true"), "preview is dry-run");
  assert(billingApi.includes('"/api/invoice-runs/execute"'), "execute remains the write path");
  assert(invoiceRuns.includes("executeInvoiceRun(buildRunExecutePayload(run, { forExecute: true }))"), "execute is explicit");
  const executeCalls = invoiceRuns.split("executeInvoiceRun(").length - 1;
  assert(executeCalls === 1, "only one execute call site");

  assert(
    dashboard.includes("includeHistoricLedger: false"),
    "school load / Invoice Runs must not download invoices+payments"
  );
  assert(
    dashboard.includes("includeHistoricLedger: true"),
    "statements/invoices/payments pages may still hydrate historic ledger"
  );
  assert(shouldHydrateHistoricBillingLedger("runs") === false, "Invoice Runs page skips historic hydrate");
  assert(shouldHydrateHistoricBillingLedger("statements") === true, "Statements may hydrate historic ledger");
  assert(shouldPrefetchInvoiceRunPreview("wizardStart") === false, "Start does not prefetch preview");
  assert(shouldPrefetchInvoiceRunPreview("wizardSettings") === false, "Settings does not prefetch until Next");
  assert(shouldPrefetchInvoiceRunPreview("wizardChildren") === true, "Children uses preview");
}

function testFlyEagleScalePreviewMappingAndPagination() {
  const localLearners = Array.from({ length: 441 }, (_, i) => ({
    id: `learner-${i}`,
    firstName: i < 426 ? `Linked${i}` : `Unlinked${i}`,
    surname: "Learner",
    classroom: `G${(i % 7) + 1}`,
    familyAccountId: i < 426 ? `fa-${i}` : "",
    accountNo: i < 426 ? `FAMILY ${i}` : String(26000 + i),
  }));

  const previewLearners: InvoiceRunPreviewLearner[] = localLearners.map((learner, i) => {
    if (i >= 426) {
      return {
        learnerId: learner.id,
        learnerName: `${learner.firstName} ${learner.surname}`,
        accountNo: "",
        status: "skipped",
        amount: 0,
        skipReason: i === 440 ? "BILLING_PLAN_EMPTY" : "ACCOUNT_NOT_FOUND",
      };
    }
    if (i >= 414) {
      return {
        learnerId: learner.id,
        learnerName: `${learner.firstName} ${learner.surname}`,
        accountNo: learner.accountNo,
        status: "skipped",
        amount: 0,
        skipReason: "BILLING_PLAN_EMPTY",
      };
    }
    return {
      learnerId: learner.id,
      learnerName: `${learner.firstName} ${learner.surname}`,
      accountNo: learner.accountNo,
      status: "invoiced",
      amount: 1400,
    };
  });

  const started = Date.now();
  const rows = mapInvoiceRunPreviewToWizardRows({
    previewLearners,
    localLearners,
    extraFeesAll: [{ feeDescription: "Aftercare", amount: 50 }],
    excludedLearnerIds: ["learner-0"],
  });
  const elapsed = Date.now() - started;
  assert(elapsed < 250, `Fly Eagle preview map of 441 rows took ${elapsed}ms`);
  assert(rows.length === 440, "excluded learner is omitted");
  const invoiced = rows.filter((row) => row.serverStatus === "invoiced");
  const skipped = rows.filter((row) => row.serverStatus === "skipped");
  assert(invoiced.length === 413, "414 plans minus one exclusion");
  assert(skipped.length === 27, "12 no-plan + 15 unlinked remain skipped");
  assert(
    skipped.every((row) =>
      ["BILLING_PLAN_EMPTY", "ACCOUNT_NOT_FOUND"].includes(String(row.skipReason || ""))
    ),
    "skip reasons preserved"
  );
  assert(
    invoiced.every((row) =>
      learnerHasOfficialLinkedFamilyAccount({ familyAccountId: row.familyAccountId })
    ),
    "invoiced rows are linked"
  );
  assert(
    skipped.filter((row) => String(row.skipReason) === "ACCOUNT_NOT_FOUND").length === 14,
    "14 unlinked-with-plan stay excluded"
  );

  const page1 = paginateInvoiceRunRows(invoiced, 1, 10);
  assert(page1.length === 10, "Children page size 10");
  assert(page1[0].id === invoiced[0].id, "page 1 starts at first invoiced");
  const lastPage = paginateInvoiceRunRows(invoiced, 99, 10);
  assert(lastPage.length <= 10, "last page is bounded");
  assert(lastPage.length > 0, "last page still has rows");
}

function testThinDraftStripsFatCandidateRows() {
  const fatRows = Array.from({ length: 441 }, (_, i) => ({
    id: `learner-${i}`,
    learnerName: `Child ${i}`,
    invoiceAmount: 1400,
    fees: [{ type: "EXTRA", description: "Trip", amount: 20 }],
  }));
  const thin = toThinInvoiceRunDraft({
    id: `draft:${FLY_EAGLE}:2026-09`,
    schoolId: FLY_EAGLE,
    month: "September 2026",
    invoicePeriod: "2026-09",
    invoiceDate: "2026-08-27",
    dueDate: "2026-09-07",
    extraFeesAll: [{ feeDescription: "Aftercare", amount: 50 }],
    rows: fatRows,
    totalInvoices: 441,
    totalAmount: 617400,
    executed: false,
  });
  assert(Array.isArray(thin.rows) && thin.rows.length === 0, "fat candidate rows are not persisted");
  assert(thin.totalInvoices === 0, "unexecuted draft totals stay zero");
  assert(thin.extraFeesAll?.[0]?.amount === 50, "extra fees all preserved");
  const extras = thin.extraFeesByLearnerId as Record<string, { amount: number }[]>;
  assert(extras["learner-1"]?.[0]?.amount === 20, "per-learner extras extracted from fat rows");

  const persisted = persistInvoiceRunDraft([], thin, FLY_EAGLE);
  const listed = listSchoolInvoiceRunDrafts(persisted, FLY_EAGLE);
  assert(listed.length === 1, "school-scoped persist");
  assert(JSON.stringify(listed[0].rows) === "[]", "stored draft remains thin");
}

function testExtraFeesApplyOnlyToInvoicedIds() {
  const extras = buildInvoiceRunExtraFeesByLearnerId(
    ["learner-1", "learner-2"],
    { "learner-1": [{ feeDescription: "Book", amount: 10 }] },
    [{ feeDescription: "Aftercare", amount: 50 }]
  );
  assert(extras?.["learner-1"]?.length === 2, "all + specific extras");
  assert(extras?.["learner-2"]?.length === 1, "all extras only");
  assert(!extras?.["learner-skip"], "no-plan/unlinked ids are not given extras");
}

function testHistoricInvoiceCountDoesNotCreateFakeRuns() {
  const historicInvoices = Array.from({ length: 3700 }, (_, i) => ({
    id: `inv-${i}`,
    source: "universal_migration_phase14",
    createdAt: "2026-08-24T22:45:16.463Z",
  }));
  const historicPayments = Array.from({ length: 3800 }, (_, i) => ({ id: `pay-${i}` }));
  assert(historicInvoices.length === 3700, "scale fixture invoices");
  assert(historicPayments.length === 3800, "scale fixture payments");

  const merged = mergeInvoiceRunLists(
    [],
    [
      {
        id: `draft:${FLY_EAGLE}:2026-09`,
        schoolId: FLY_EAGLE,
        month: "September 2026",
        invoicePeriod: "2026-09",
        totalInvoices: 0,
        totalAmount: 0,
        executed: false,
        rows: [],
      },
    ],
    {}
  );
  assert(merged.serverRuns.length === 0, "migrated Express history is not a server invoice run");
  assert(merged.browserDraftRuns.length === 1, "thin September draft is the only list extra");

  const started = beginInvoiceRunWizard({
    drafts: merged.browserDraftRuns,
    schoolId: FLY_EAGLE,
    month: "September 2026",
  });
  assert(started.persisted === false, "+ Add still does not persist");
  assert(started.reused === true, "reuses the thin school+period draft");
}

function main() {
  testNetworkContractFromSource();
  testFlyEagleScalePreviewMappingAndPagination();
  testThinDraftStripsFatCandidateRows();
  testExtraFeesApplyOnlyToInvoicedIds();
  testHistoricInvoiceCountDoesNotCreateFakeRuns();
  console.log("invoiceRunWizardArchitecture.test.ts — PASS");
}

main();
