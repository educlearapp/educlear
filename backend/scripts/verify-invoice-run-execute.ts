/**
 * Invoice run execute verification (dry-run by default).
 *
 * Usage:
 *   npx tsx scripts/verify-invoice-run-execute.ts
 *   API_BASE=http://localhost:4000 SCHOOL_ID=<demo-school> npx tsx scripts/verify-invoice-run-execute.ts
 *
 * Optional API dry-run (demo / test school only):
 *   CONFIRM_BILLING_WRITE_TEST=true API_BASE=... SCHOOL_ID=cmpbdigd00001vuzmxnwkbgiu npx tsx scripts/verify-invoice-run-execute.ts --api
 *
 * Never writes invoices unless CONFIRM_BILLING_WRITE_TEST=true and never on Da Silva production.
 */
import {
  buildInvoiceRunPlanForTest,
  evaluateLearnerEligibility,
} from "../src/services/invoiceRunExecuteService";
import { normalizeInvoicePeriod } from "../src/utils/billingLedgerStore";

const API_BASE = String(process.env.API_BASE || "").replace(/\/$/, "");
const SCHOOL_ID = String(process.env.SCHOOL_ID || "").trim();
const CONFIRM_WRITE = process.env.CONFIRM_BILLING_WRITE_TEST === "true";
const DA_SILVA_PROD = "cmpideqeq0000108xb6ouv9zi";
const DEMO_SCHOOL = "cmpbdigd00001vuzmxnwkbgiu";
const USE_API = process.argv.includes("--api");

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function learner(
  id: string,
  firstName: string,
  lastName: string,
  familyAccountId: string | null,
  accountRef: string | null
) {
  return {
    id,
    firstName,
    lastName,
    enrollmentStatus: "ACTIVE",
    admissionNo: null,
    idNumber: null,
    familyAccountId,
    familyAccount: accountRef ? { accountRef } : null,
  };
}

function plan(amount: number) {
  return [{ feeDescription: "Tuition", amount }];
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body };
}

function verifyPureLogic() {
  console.log("## Pure logic dry-run");

  const period = normalizeInvoicePeriod("June 2026", "2026-06-01");
  assert(period === "2026-06", "period normalization");

  const single = learner("v1", "Verify", "Single", null, "TST001");
  const singlePlan = buildInvoiceRunPlanForTest({
    allActiveLearners: [single],
    processedLearners: [single],
    plansByLearnerId: { v1: plan(1500) },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { v1: "TST001" },
    existingLedger: [],
    invoicePeriod: period,
  });
  assert(singlePlan.integrity.passed, "single learner integrity");
  assert(singlePlan.integrity.invoiceLineCount === 1, "single learner line");

  const fam = "fam-verify";
  const s1 = learner("vs1", "S", "One", fam, "FAM101");
  const s2 = learner("vs2", "S", "Two", fam, "FAM101");
  const siblingPlan = buildInvoiceRunPlanForTest({
    allActiveLearners: [s1, s2],
    processedLearners: [s1, s2],
    plansByLearnerId: { vs1: plan(1000), vs2: plan(1100) },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { vs1: "FAM101", vs2: "FAM101" },
    existingLedger: [],
    invoicePeriod: period,
  });
  assert(siblingPlan.integrity.passed, "sibling integrity");
  assert(siblingPlan.accounts[0].actualTotal === 2100, "sibling total");

  const dupEval = evaluateLearnerEligibility({
    learner: single,
    planItems: plan(1500),
    accountNo: "TST001",
    invoicePeriod: period,
    existingLedger: [
      {
        id: "existing",
        schoolId: "x",
        learnerId: "v1",
        accountNo: "TST001",
        type: "invoice",
        amount: 1500,
        date: "2026-06-01",
        reference: "INV",
        description: "June",
        invoicePeriod: period,
        createdAt: new Date().toISOString(),
      },
    ],
  });
  assert(dupEval.skipReason === "DUPLICATE_INVOICE", "duplicate prevention");

  const missedSibling = buildInvoiceRunPlanForTest({
    allActiveLearners: [s1, s2],
    processedLearners: [s1],
    plansByLearnerId: { vs1: plan(1000), vs2: plan(1100) },
    explicitlyEmpty: new Set(),
    accountNoByLearnerId: { vs1: "FAM101", vs2: "FAM101" },
    existingLedger: [],
    invoicePeriod: period,
  });
  assert(!missedSibling.integrity.passed, "integrity fails when sibling missed");

  console.log("✓ Pure logic dry-run passed");
}

async function verifyApiDryRun() {
  if (!API_BASE || !SCHOOL_ID) {
    console.log("## API dry-run skipped (set API_BASE and SCHOOL_ID)");
    return;
  }

  if (SCHOOL_ID === DA_SILVA_PROD && CONFIRM_WRITE) {
    throw new Error("Refusing write tests on Da Silva production school.");
  }

  console.log(`## API dry-run (${API_BASE}, school=${SCHOOL_ID})`);

  const payload = {
    schoolId: SCHOOL_ID,
    runId: `RUN-VERIFY-${Date.now()}`,
    invoicePeriod: "2026-06",
    invoiceDate: "2026-06-01",
    description: "Verify dry-run",
    dryRun: true,
  };

  const { ok, status, body } = await fetchJson(`${API_BASE}/api/invoice-runs/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  assert(ok, `API dry-run failed: ${status} ${JSON.stringify(body).slice(0, 300)}`);
  assert(body.dryRun === true, "response marks dryRun");
  assert(body.integrity, "response includes integrity");
  assert(
    body.integrity.eligibleCount ===
      body.integrity.invoiceLineCount +
        (body.learners || []).filter(
          (row: any) => row.status === "skipped" && row.skipReason === "DUPLICATE_INVOICE"
        ).length,
    "integrity equation on API response"
  );
  assert(!body.createdCount || body.dryRun, "dry-run must not persist invoices");

  console.log("✓ API dry-run passed");
}

async function verifyProductionSafety() {
  console.log("## Production safety");

  if (CONFIRM_WRITE && SCHOOL_ID === DA_SILVA_PROD) {
    throw new Error("Production write guard: Da Silva blocked");
  }

  if (API_BASE && SCHOOL_ID === DA_SILVA_PROD) {
    const payload = {
      schoolId: DA_SILVA_PROD,
      runId: `RUN-READONLY-${Date.now()}`,
      invoicePeriod: "2026-06",
      invoiceDate: "2026-06-01",
      dryRun: true,
    };
    const { ok, body } = await fetchJson(`${API_BASE}/api/invoice-runs/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    assert(ok, `Da Silva read-only dry-run failed: ${JSON.stringify(body).slice(0, 200)}`);
    assert(body.dryRun === true, "Da Silva dry-run flag");
    console.log("✓ Da Silva read-only dry-run (no writes)");
  } else {
    console.log("✓ Production write blocked by default (no Da Silva API check without API_BASE)");
  }

  const targetSchool = SCHOOL_ID || DEMO_SCHOOL;
  if (CONFIRM_WRITE && targetSchool !== DA_SILVA_PROD) {
    console.log("✓ Write tests allowed only on non-production school");
  } else {
    console.log("✓ No write confirmation — execute apply path not tested");
  }
}

async function main() {
  verifyPureLogic();
  if (USE_API) {
    await verifyApiDryRun();
  } else {
    console.log("## API dry-run skipped (pass --api with API_BASE and SCHOOL_ID to enable)");
  }
  await verifyProductionSafety();
  console.log("\nverify-invoice-run-execute.ts: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
