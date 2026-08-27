/**
 * Invoice run list merge tests (browser draft filtering).
 * Run: node frontend/scripts/invoiceRunList.test.mjs
 */
import {
  beginInvoiceRunWizard,
  listBrowserDraftInvoiceRuns,
  listSchoolInvoiceRunDrafts,
  mergeInvoiceRunLists,
  stampLegacyInvoiceRunDrafts,
} from "../src/billing/invoiceRunList.ts";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const serverRuns = [
  {
    id: "RUN-1781514127700",
    runId: "RUN-1781514127700",
    source: "ledger",
    period: "July 2026",
    invoicePeriod: "2026-07",
    totalInvoices: 2,
    totalAmount: 3500,
  },
];

const ghostAugustDraft = {
  id: "RUN-1783056354816",
  runId: "RUN-1783056354816",
  month: "August 2026",
  invoicePeriod: "2026-08",
  description: "Invoice Run For August 2026",
  totalInvoices: 395,
  totalAmount: 1274650,
};

const activeDraft = {
  id: "RUN-draft-local",
  month: "September 2026",
  invoicePeriod: "2026-09",
  totalInvoices: 0,
  totalAmount: 0,
};

const periodCounts = {
  "2026-07": 2,
  "2026-08": 0,
  "2026-09": 0,
};

const filtered = listBrowserDraftInvoiceRuns(
  [ghostAugustDraft, activeDraft],
  serverRuns,
  periodCounts
);
assert(!filtered.some((run) => run.id === "RUN-1783056354816"), "august ghost hidden");
assert(filtered.some((run) => run.id === "RUN-draft-local"), "unaffected draft kept");

const merged = mergeInvoiceRunLists(serverRuns, [ghostAugustDraft, activeDraft], periodCounts);
assert(merged.serverRuns.length === 1, "server run kept");
assert(merged.browserDraftRuns.length === 1, "one browser draft");
assert(merged.allVisibleRuns.length === 2, "combined visible count");
assert(merged.serverRuns[0].id === "RUN-1781514127700", "existing server-backed run still renders");

const fly = "cmt1e8bjp0jo8lcjeketlynhl";
const other = "cmq4xjckq00at60gqg4eb956h";
const stamped = stampLegacyInvoiceRunDrafts(
  [
    { id: "RUN-legacy-1", month: "September 2026", invoicePeriod: "2026-09", totalInvoices: 0 },
    { id: "RUN-other", schoolId: other, month: "September 2026", invoicePeriod: "2026-09", totalInvoices: 0 },
  ],
  fly
);
assert(stamped[0].schoolId === fly, "legacy drafts are stamped, not deleted");
assert(stamped[1].schoolId === other, "already-scoped drafts keep their school");
assert(listSchoolInvoiceRunDrafts(stamped, fly).every((row) => row.schoolId === fly), "school filter");
assert(!listSchoolInvoiceRunDrafts(stamped, fly).some((row) => row.id === "RUN-other"), "no cross-school leak");

const started = beginInvoiceRunWizard({
  drafts: listSchoolInvoiceRunDrafts(stamped, fly),
  schoolId: fly,
  month: "September 2026",
});
assert(started.persisted === false, "+ Add does not persist");
assert(started.drafts.length === 1, "repeated identity does not duplicate storage");

console.log("invoiceRunList.test.mjs: OK");
