/**
 * Invoice Run browser-draft + wizardStart performance contract.
 * Run: npx tsx src/billing/invoiceRunDrafts.test.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  beginInvoiceRunWizard,
  learnerHasOfficialLinkedFamilyAccount,
  listSchoolInvoiceRunDrafts,
  mergeInvoiceRunLists,
  persistInvoiceRunDraft,
  shouldBuildInvoiceRunCandidates,
  shouldSyncInvoiceRunLedger,
  stampLegacyInvoiceRunDrafts,
  type InvoiceRunListRow,
} from "./invoiceRunList";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLY_EAGLE = "cmt1e8bjp0jo8lcjeketlynhl";
const MAGICAL = "cmq4xjckq00at60gqg4eb956h";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function septemberDraft(id: string, schoolId?: string): InvoiceRunListRow {
  return {
    id,
    month: "September 2026",
    period: "September 2026",
    invoicePeriod: "2026-09",
    description: "Invoice Run For September 2026",
    totalInvoices: 0,
    totalAmount: 0,
    executed: false,
    ...(schoolId ? { schoolId } : {}),
  };
}

function testRepeatedAddDoesNotCreateDuplicateSeptemberDrafts() {
  const existingFive = [
    septemberDraft("RUN-1"),
    septemberDraft("RUN-2"),
    septemberDraft("RUN-3"),
    septemberDraft("RUN-4"),
    septemberDraft("RUN-5"),
  ];
  const stamped = stampLegacyInvoiceRunDrafts(existingFive, FLY_EAGLE);
  assert(stamped.length === 5, "legacy September drafts are not deleted on migrate");

  let drafts = listSchoolInvoiceRunDrafts(stamped, FLY_EAGLE);
  let lastId = "";
  for (let i = 0; i < 5; i += 1) {
    const started = beginInvoiceRunWizard({
      drafts,
      schoolId: FLY_EAGLE,
      month: "September 2026",
    });
    assert(started.persisted === false, "+ Add must not persist a draft");
    assert(started.drafts.length === 5, "repeated + Add must not grow the draft list");
    assert(started.reused === true, "existing unexecuted September draft is reused");
    lastId = started.selectedRun.id;
    drafts = started.drafts;
  }
  assert(lastId === "RUN-1", "reuse the first unexecuted school+period draft");

  const emptyStart = beginInvoiceRunWizard({
    drafts: [],
    schoolId: FLY_EAGLE,
    month: "September 2026",
  });
  assert(emptyStart.persisted === false, "first + Add still does not persist");
  const secondEmpty = beginInvoiceRunWizard({
    drafts: emptyStart.drafts,
    schoolId: FLY_EAGLE,
    month: "September 2026",
  });
  assert(secondEmpty.drafts.length === 0, "in-memory + Add does not append storage rows");
  assert(secondEmpty.selectedRun.id === emptyStart.selectedRun.id, "stable school+period draft id");
}

function testDraftsCannotLeakBetweenSchools() {
  const mixed = [
    ...stampLegacyInvoiceRunDrafts([septemberDraft("RUN-fly")], FLY_EAGLE),
    septemberDraft("RUN-magical", MAGICAL),
  ];
  const fly = listSchoolInvoiceRunDrafts(mixed, FLY_EAGLE);
  const magical = listSchoolInvoiceRunDrafts(mixed, MAGICAL);
  assert(fly.length === 1 && fly[0].id === "RUN-fly", "Fly Eagle sees only Fly Eagle drafts");
  assert(magical.length === 1 && magical[0].id === "RUN-magical", "Magical sees only Magical drafts");
  assert(
    !fly.some((row) => row.schoolId === MAGICAL),
    "another school's draft must not appear on Fly Eagle"
  );

  const flyWizard = beginInvoiceRunWizard({
    drafts: fly,
    schoolId: FLY_EAGLE,
    month: "September 2026",
  });
  const persisted = persistInvoiceRunDraft(
    mixed,
    flyWizard.selectedRun,
    FLY_EAGLE
  );
  const afterMagical = listSchoolInvoiceRunDrafts(persisted, MAGICAL);
  assert(afterMagical.length === 1 && afterMagical[0].id === "RUN-magical", "persist stays school-scoped");
}

function testWizardStartDoesNotBuildCandidatesOrSyncLedger() {
  assert(shouldBuildInvoiceRunCandidates("wizardStart") === false, "wizardStart skips candidate rows");
  assert(shouldBuildInvoiceRunCandidates("wizardSettings") === false, "wizardSettings skips candidate rows");
  assert(shouldSyncInvoiceRunLedger("wizardStart") === false, "wizardStart skips full ledger sync");
  assert(shouldSyncInvoiceRunLedger("wizardSettings") === false, "wizardSettings skips full ledger sync");
  assert(shouldBuildInvoiceRunCandidates("wizardChildren") === true, "Children builds candidates");
  assert(shouldSyncInvoiceRunLedger("wizardFees") === true, "Fees syncs ledger");
  assert(shouldSyncInvoiceRunLedger("wizardPreview") === true, "Preview syncs ledger");
}

function testUnlinkedLearnersExcludedFromCandidates() {
  assert(
    learnerHasOfficialLinkedFamilyAccount({
      id: "linked",
      familyAccountId: "fa-1",
      familyAccount: { id: "fa-1", accountRef: "WOLDE HAPPY BLESSING" },
    }) === true,
    "linked FamilyAccount is eligible"
  );
  assert(
    learnerHasOfficialLinkedFamilyAccount({
      id: "unlinked",
      familyAccountId: null,
      accountNo: "26006",
      admissionNo: "26006",
    }) === false,
    "unlinked learner is excluded"
  );
  assert(
    learnerHasOfficialLinkedFamilyAccount({
      id: "unlinked-with-plan",
      familyAccountId: "",
      accountNo: "MHONDIWA SYDNEY",
    }) === false,
    "unlinked learner with a plan still excluded without FamilyAccount"
  );
}

function testServerBackedRunsStillRender() {
  const serverRuns: InvoiceRunListRow[] = [
    {
      id: "RUN-server-july",
      runId: "RUN-server-july",
      source: "ledger",
      period: "July 2026",
      invoicePeriod: "2026-07",
      totalInvoices: 2,
      totalAmount: 3500,
      executed: true,
    },
  ];
  const merged = mergeInvoiceRunLists(
    serverRuns,
    [septemberDraft("RUN-draft", FLY_EAGLE)],
    { "2026-07": 2, "2026-09": 0 }
  );
  assert(merged.serverRuns.length === 1, "server-backed run remains visible");
  assert(merged.serverRuns[0].id === "RUN-server-july", "server run id preserved");
  assert(merged.browserDraftRuns.length === 1, "unexecuted draft still listed separately");
  assert(merged.allVisibleRuns.length === 2, "ledger + draft both render");
}

function testPersistUpsertsOneUnexecutedDraftPerSchoolPeriod() {
  const drafts = stampLegacyInvoiceRunDrafts(
    [septemberDraft("RUN-1"), septemberDraft("RUN-2")],
    FLY_EAGLE
  );
  const saved = persistInvoiceRunDraft(
    drafts,
    {
      id: "draft:new",
      schoolId: FLY_EAGLE,
      month: "September 2026",
      period: "September 2026",
      invoicePeriod: "2026-09",
      totalInvoices: 0,
      totalAmount: 0,
    },
    FLY_EAGLE
  );
  const flySept = listSchoolInvoiceRunDrafts(saved, FLY_EAGLE).filter(
    (row) => String(row.invoicePeriod || "") === "2026-09"
  );
  assert(flySept.length === 1, "at most one unexecuted draft per school+period after persist");
}

function testCreateNewRunDoesNotWriteServerInvoices() {
  const source = fs.readFileSync(path.join(__dirname, "InvoiceRuns.tsx"), "utf8");
  const start = source.indexOf("const createNewRun");
  const end = source.indexOf("const openRun");
  assert(start >= 0 && end > start, "createNewRun is present");
  const body = source.slice(start, end);
  assert(!body.includes("executeInvoiceRun"), "+ Add must not execute a server invoice run");
  assert(!body.includes("previewInvoiceRun"), "+ Add must not preview/execute invoices");
  assert(!body.includes("saveRunDraft"), "+ Add must not persist a list-visible draft");
  assert(body.includes("wizardStart"), "+ Add still opens wizardStart");
  assert(body.includes("beginInvoiceRunWizard"), "+ Add uses school+period draft identity");
  assert(body.includes('writeJson("educlearSelectedInvoiceRun"'), "+ Add may keep session selection only");

  assert(
    source.includes("executeInvoiceRun(buildRunExecutePayload(run))"),
    "execute remains the invoice-writing operation"
  );
  const executeCount = source.split("executeInvoiceRun(").length - 1;
  assert(executeCount === 1, "only one executeInvoiceRun call site in InvoiceRuns");

  const billingApi = fs.readFileSync(path.join(__dirname, "billingApi.ts"), "utf8");
  assert(
    billingApi.includes('"/api/invoice-runs/execute"'),
    "POST /api/invoice-runs/execute is the write path"
  );
  assert(
    billingApi.includes("dryRun: false"),
    "execute is the non-dry-run invoice write"
  );
  assert(
    billingApi.includes("dryRun: true"),
    "preview stays dry-run and non-writing"
  );
}

function main() {
  testRepeatedAddDoesNotCreateDuplicateSeptemberDrafts();
  testDraftsCannotLeakBetweenSchools();
  testWizardStartDoesNotBuildCandidatesOrSyncLedger();
  testUnlinkedLearnersExcludedFromCandidates();
  testServerBackedRunsStillRender();
  testPersistUpsertsOneUnexecutedDraftPerSchoolPeriod();
  testCreateNewRunDoesNotWriteServerInvoices();
  console.log("invoiceRunDrafts.test.ts — PASS");
}

main();
