/**
 * Post-invoice workflow contract — Invoice Run → Statements → Bulk Email Select All → Send.
 * Source-level + mocked delivery. Does not send live email.
 * Run: npx tsx src/billing/postInvoiceStatementWorkflowContract.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBulkStatementRecipients,
  runBulkStatementSend,
  selectAllEligibleRecipients,
  type BulkRecipient,
} from "./bulkStatementSendLogic.ts";
import { sendStatementEmail } from "./statementDocument.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (name: string) => fs.readFileSync(path.join(__dirname, name), "utf8");

function row(partial: Record<string, unknown>) {
  return {
    name: "Test",
    surname: "Learner",
    learnerId: "L1",
    accountNo: "FAM001",
    status: "Recently Owing",
    balance: 1500,
    lastInvoiceDate: "2026-01-15",
    ...partial,
  };
}

function learner(partial: Record<string, unknown>) {
  return {
    id: "L1",
    accountNo: "FAM001",
    parents: [],
    ...partial,
  };
}

function byEmail(recipients: BulkRecipient[], email: string) {
  const hit = recipients.find((r) => r.email.trim().toLowerCase() === email.toLowerCase());
  assert.ok(hit, `expected recipient ${email}`);
  return hit!;
}

function assertSourceLocks() {
  const bulkUi = read("BulkStatementSend.tsx");
  const logic = read("bulkStatementSendLogic.ts");
  const statementDoc = read("statementDocument.ts");
  const invoiceRuns = read("InvoiceRuns.tsx");
  const billingApi = read("billingApi.ts");
  const smsModal = read("BulkStatementSmsModal.tsx");
  const smsApi = read("statementBulkSmsApi.ts");

  assert.match(bulkUi, /selectAllEligibleRecipients\(prev,\s*lockRef\.current\)/, "Select All wires selectAllEligibleRecipients");
  assert.match(bulkUi, /await sendStatementEmail\(/, "sendOneRecipient calls sendStatementEmail");
  assert.match(bulkUi, /runBulkStatementSend\(/, "runSend uses runBulkStatementSend");
  assert.match(bulkUi, /mode,\s*\n\s*sendOne:\s*sendOneRecipient/, "runBulkStatementSend receives sendOneRecipient");
  assert.match(bulkUi, /retryConfirmOpen \? "failed_only" : "pending"/, "Retry failed uses failed_only mode");
  assert.match(
    bulkUi,
    /Select All selects all eligible email recipients/,
    "confirm copy documents all-eligible Select All"
  );

  assert.match(
    logic,
    /selected:\s*row\.status === "PENDING" && isRecipientSelectable\(row\)/,
    "Select All predicate is PENDING + selectable (not canonical-only)"
  );
  assert.equal(
    /selected:\s*row\.status === "PENDING" && isCanonicalBulkRecipient\(row\)/.test(logic),
    false,
    "Select All must not use canonical-only predicate"
  );

  const sendFnStart = statementDoc.indexOf("export async function sendStatementEmail");
  assert.ok(sendFnStart >= 0, "sendStatementEmail export present");
  const sendFn = statementDoc.slice(sendFnStart, sendFnStart + 900);
  assert.match(sendFn, /staffAuthHeaders\(\)/, "sendStatementEmail still authenticates with staffAuthHeaders");
  assert.match(sendFn, /\/api\/emails\/send-statement/, "sendStatementEmail posts send-statement");

  assert.match(invoiceRuns, /previewInvoiceRun\(/, "Invoice Run preview call present");
  assert.match(
    invoiceRuns,
    /executeInvoiceRun\(buildRunExecutePayload\(run, \{ forExecute: true \}\)\)/,
    "Invoice Run execute uses existing payload helper"
  );
  assert.equal(
    invoiceRuns.split("executeInvoiceRun(").length - 1,
    1,
    "single executeInvoiceRun call site unchanged"
  );
  assert.match(
    billingApi,
    /async function postInvoiceRunEndpoint[\s\S]*staffAuthHeaders\(\)/,
    "invoice-run POSTs still use staffAuthHeaders"
  );

  assert.match(smsModal, /all_eligible/, "Bulk SMS all_eligible strategy unchanged");
  assert.match(smsApi, /all_eligible|eligible/, "Bulk SMS API eligibility surface unchanged");
}

async function testSelectAllFamilyContract() {
  const schoolEmail = "school.office@example.test";
  const built = buildBulkStatementRecipients({
    schoolEmail,
    rows: [
      row({ learnerId: "L-FAM", accountNo: "FAM001", name: "Family", surname: "One" }),
      row({ learnerId: "L-TWO", accountNo: "FAM002", name: "Family", surname: "Two" }),
    ],
    learners: [
      learner({
        id: "L-FAM",
        accountNo: "FAM001",
        parents: [
          {
            firstName: "Parent",
            surname: "A",
            email: "parent.a@example.test",
            isPrimary: true,
            isPayingPerson: true,
          },
          {
            firstName: "Parent",
            surname: "B",
            email: "parent.b@example.test",
            isPrimary: false,
          },
          {
            firstName: "Parent",
            surname: "C",
            email: "",
            isPrimary: false,
          },
          {
            firstName: "Parent",
            surname: "D",
            email: schoolEmail,
            isPrimary: false,
          },
        ],
      }),
      learner({
        id: "L-TWO",
        accountNo: "FAM002",
        parents: [
          {
            firstName: "Guardian",
            surname: "One",
            email: "guardian.one@example.test",
            isPrimary: true,
          },
          {
            firstName: "Guardian",
            surname: "Two",
            email: "guardian.two@example.test",
            isPrimary: false,
            isPayingPerson: true,
          },
        ],
      }),
    ],
  });

  const parentA = byEmail(built, "parent.a@example.test");
  const parentB = byEmail(built, "parent.b@example.test");
  assert.equal(parentA.isCanonicalBillingRecipient, true, "Parent A is canonical");
  assert.equal(parentB.isAdditionalBillingContact, true, "Parent B is additional");
  assert.ok(
    built.some((r) => r.status === "SKIPPED" && r.skipReason === "Missing email"),
    "Parent C missing email is SKIPPED"
  );
  assert.ok(
    built.some(
      (r) =>
        r.status === "SKIPPED" &&
        r.skipReason === "School or internal email" &&
        r.email.trim().toLowerCase() === schoolEmail
    ),
    "Parent D school/internal email is SKIPPED"
  );

  const afterSelectAll = selectAllEligibleRecipients(built);
  assert.equal(byEmail(afterSelectAll, "parent.a@example.test").selected, true, "A selected");
  assert.equal(byEmail(afterSelectAll, "parent.b@example.test").selected, true, "B selected");
  assert.ok(
    afterSelectAll
      .filter((r) => r.skipReason === "Missing email")
      .every((r) => r.selected === false),
    "C missing email not selected"
  );
  assert.ok(
    afterSelectAll
      .filter((r) => r.skipReason === "School or internal email")
      .every((r) => r.selected === false),
    "D internal email not selected"
  );
  assert.equal(byEmail(afterSelectAll, "guardian.one@example.test").selected, true, "FAM002 guardian one selected");
  assert.equal(byEmail(afterSelectAll, "guardian.two@example.test").selected, true, "FAM002 guardian two selected");

  const consentBlocked = buildBulkStatementRecipients({
    rows: [row({ learnerId: "L-BLOCK", accountNo: "BLK001" })],
    learners: [
      learner({
        id: "L-BLOCK",
        accountNo: "BLK001",
        parents: [
          {
            firstName: "Blocked",
            surname: "Parent",
            email: "blocked@example.test",
            billingStatement: false,
            isPrimary: true,
          },
        ],
      }),
    ],
  });
  const afterConsent = selectAllEligibleRecipients(consentBlocked);
  assert.ok(
    afterConsent.every((r) => r.selected === false),
    "consent-blocked not selected by Select All"
  );
  assert.ok(
    afterConsent.some(
      (r) => r.status === "SKIPPED" && r.skipReason === "Billing/email preferences disabled"
    ),
    "consent-blocked classified SKIPPED"
  );

  return afterSelectAll;
}

async function testSelectedFlowIntoSendPath(selected: BulkRecipient[]) {
  const called: string[] = [];
  const next = await runBulkStatementSend({
    lock: { inFlight: false },
    recipients: selected,
    mode: "pending",
    dispatchSpacingMs: 0,
    sendOne: async (recipient) => {
      called.push(recipient.email.trim().toLowerCase());
      // Mirrors BulkStatementSend sendOneRecipient → sendStatementEmail (mocked, no live send).
      return { ok: true };
    },
  });

  const expected = [
    "parent.a@example.test",
    "parent.b@example.test",
    "guardian.one@example.test",
    "guardian.two@example.test",
  ].sort();
  assert.deepEqual([...called].sort(), expected, "Select All → runBulkStatementSend targets only eligible emails");
  assert.ok(
    next
      .filter((r) => expected.includes(r.email.trim().toLowerCase()))
      .every((r) => r.status === "SENT"),
    "eligible selected recipients become SENT after mocked send"
  );
  assert.ok(
    next
      .filter((r) => r.status === "SKIPPED")
      .every((r) => r.selected === false && !called.includes(r.email.trim().toLowerCase())),
    "SKIPPED recipients never reach sendOne"
  );
}

async function testRetryFailedUnchanged() {
  const seed: BulkRecipient[] = [
    {
      id: "sent-1",
      accountNo: "FAM001",
      email: "sent@example.test",
      contactName: "Sent",
      relationship: "Parent",
      learnerId: "L1",
      learnerName: "Kid",
      status: "SENT",
      selected: true,
      isCanonicalBillingRecipient: true,
    },
    {
      id: "fail-1",
      accountNo: "FAM001",
      email: "fail@example.test",
      contactName: "Fail",
      relationship: "Guardian",
      learnerId: "L1",
      learnerName: "Kid",
      status: "FAILED",
      selected: true,
      isAdditionalBillingContact: true,
      errorReason: "mailbox rejected",
    },
    {
      id: "fail-unselected",
      accountNo: "FAM002",
      email: "other-fail@example.test",
      contactName: "Other",
      relationship: "Parent",
      learnerId: "L2",
      learnerName: "Other",
      status: "FAILED",
      selected: false,
      errorReason: "timeout",
    },
  ];
  const called: string[] = [];
  const after = await runBulkStatementSend({
    lock: { inFlight: false },
    recipients: seed,
    mode: "failed_only",
    dispatchSpacingMs: 0,
    sendOne: async (recipient) => {
      called.push(recipient.email);
      return { ok: true };
    },
  });
  assert.deepEqual(called, ["fail@example.test"], "Retry failed targets only selected FAILED");
  assert.equal(after.find((r) => r.id === "sent-1")?.status, "SENT", "SENT not resent");
  assert.equal(after.find((r) => r.id === "fail-unselected")?.status, "FAILED", "unselected FAILED untouched");
}

async function testAuthenticatedSendStatementEmailUntouched() {
  const TOKEN = "post-invoice-contract-token";
  const prevFetch = globalThis.fetch;
  const prevLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  (globalThis as { localStorage: Storage }).localStorage = {
    getItem: (k) => (k === "token" || k === "educlear_staff_token" ? TOKEN : null),
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
    key: () => null,
    length: 0,
  } as Storage;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ success: true, messageId: "msg-contract" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    await sendStatementEmail({
      schoolId: "school-1",
      to: "parent.a@example.test",
      subject: "Statement",
      html: "<p>ok</p>",
      learnerId: "L-FAM",
      accountNo: "FAM001",
      period: "All Time",
    });
    assert.equal(calls.length, 1, "one send-statement request");
    assert.match(calls[0].url, /\/api\/emails\/send-statement/, "authenticated helper path unchanged");
    const headers = calls[0].init?.headers as Record<string, string>;
    assert.match(String(headers?.Authorization || ""), /^Bearer /, "Bearer auth still present");
  } finally {
    globalThis.fetch = prevFetch;
    if (prevLocalStorage) {
      (globalThis as { localStorage: Storage }).localStorage = prevLocalStorage;
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  }
}

async function main() {
  assertSourceLocks();
  console.log("✓ source locks: Select All, send path, invoice run, auth, SMS");

  const selected = await testSelectAllFamilyContract();
  console.log("✓ Select All: canonical + additional; missing/internal/consent excluded");

  await testSelectedFlowIntoSendPath(selected);
  console.log("✓ Select All → runBulkStatementSend → sendOne (sendStatementEmail path) mocked");

  await testRetryFailedUnchanged();
  console.log("✓ Retry failed targets FAILED only");

  await testAuthenticatedSendStatementEmailUntouched();
  console.log("✓ sendStatementEmail auth unchanged");

  console.log("\npostInvoiceStatementWorkflowContract: all tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
