/**
 * Bulk statement send: selection, dedupe, sequential mocked delivery.
 * Run: npx tsx src/billing/bulkStatementSendLogic.test.ts
 */
import assert from "assert";
import {
  buildBulkStatementRecipients,
  confirmBulkSendMessage,
  countPendingRecipients,
  countSkippedRecipients,
  filterRowsForBulkStatementSend,
  isBulkSendLocked,
  matchesBulkAccountStatus,
  recipientDedupKey,
  resolveBulkStatementPeriod,
  runBulkStatementSend,
  statusFromLiveSendResult,
  summarizeBulkSend,
  type BulkRecipient,
  type BulkSendLock,
} from "./bulkStatementSendLogic";

function assertTrue(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function row(partial: Record<string, unknown>) {
  return {
    name: "Test",
    surname: "Learner",
    learnerId: "L1",
    accountNo: "BAD001",
    status: "Bad Debt",
    balance: 15000,
    lastInvoiceDate: "2024-01-15",
    ...partial,
  };
}

function learner(partial: Record<string, unknown>) {
  return {
    id: "L1",
    accountNo: "BAD001",
    parents: [{ firstName: "Pat", surname: "One", relationship: "Parent", email: "one@example.test" }],
    ...partial,
  };
}

async function main() {
  const oldDebt = row({
    status: "Bad Debt",
    balance: 22000,
    lastInvoiceDate: "2020-03-01",
    accountNo: "BAD001",
    learnerId: "L-BAD",
  });
  const recent = row({
    status: "Recently Owing",
    balance: 2500,
    lastInvoiceDate: "2020-06-01",
    accountNo: "REC001",
    learnerId: "L-REC",
  });
  const paid = row({
    status: "Paid Up",
    balance: 0,
    lastInvoiceDate: "2026-08-01",
    accountNo: "PAY001",
    learnerId: "L-PAY",
  });
  const upToDate = row({
    status: "Up To Date",
    balance: 0,
    lastInvoiceDate: "2026-08-01",
    accountNo: "UTD001",
    learnerId: "L-UTD",
  });

  const badDebtRows = filterRowsForBulkStatementSend([oldDebt, recent, paid], {
    accountStatus: "Bad Debt",
  });
  assertTrue(badDebtRows.length === 1, "Bad Debt filter should include old outstanding account");
  assertTrue(badDebtRows[0].accountNo === "BAD001", "Bad Debt row is BAD001");

  const owingRows = filterRowsForBulkStatementSend([oldDebt, recent, paid], {
    accountStatus: "Recently Owing",
  });
  assertTrue(owingRows.length === 1 && owingRows[0].accountNo === "REC001", "Recently Owing selection");

  const paidRows = filterRowsForBulkStatementSend([paid, upToDate, oldDebt], {
    accountStatus: "Paid Up",
  });
  assertTrue(
    paidRows.some((r) => r.accountNo === "PAY001") && paidRows.some((r) => r.accountNo === "UTD001"),
    "Paid Up matches Paid Up and Up To Date"
  );

  const allWithPeriodIgnored = filterRowsForBulkStatementSend([oldDebt, recent], {
    accountStatus: "All",
  });
  assertTrue(allWithPeriodIgnored.length === 2, "Statement period must not control debt eligibility");
  assertTrue(matchesBulkAccountStatus("Bad Debt", "Bad Debt"), "exact Bad Debt match");

  const dupLearners = [
    learner({
      id: "L-DUP",
      accountNo: "FAM001",
      parents: [
        { firstName: "A", surname: "One", email: " Same@Example.TEST " },
        { firstName: "A", surname: "One", email: "same@example.test" },
        { firstName: "B", surname: "Two", email: "two@example.test" },
      ],
    }),
  ];
  const dupRecipients = buildBulkStatementRecipients({
    rows: [row({ learnerId: "L-DUP", accountNo: "FAM001", status: "Recently Owing" })],
    learners: dupLearners,
  });
  const pendingDup = dupRecipients.filter((r) => r.status === "PENDING");
  assertTrue(pendingDup.length === 2, "same account + same email dedupes; different emails remain");
  const emails = pendingDup.map((r) => r.email.trim().toLowerCase()).sort();
  assertTrue(emails[0] === "same@example.test" && emails[1] === "two@example.test", "keeps one same-email recipient");
  assertTrue(recipientDedupKey("fam001", "A@X.COM") === recipientDedupKey("FAM001", "a@x.com"), "dedupe key");

  const missingEmail = buildBulkStatementRecipients({
    rows: [row({ learnerId: "L-NOMAIL", accountNo: "NOMAIL1" })],
    learners: [learner({ id: "L-NOMAIL", accountNo: "NOMAIL1", parents: [] , parentEmail: "" })],
  });
  assertTrue(missingEmail.length === 1 && missingEmail[0].status === "SKIPPED", "missing email → SKIPPED");
  assertTrue(missingEmail[0].skipReason === "Missing email", "missing email reason");

  const missingAccount = buildBulkStatementRecipients({
    rows: [row({ learnerId: "L-NOACC", accountNo: "-" })],
    learners: [learner({ id: "L-NOACC", accountNo: "-", parents: [{ email: "x@example.test" }] })],
  });
  assertTrue(missingAccount[0].status === "SKIPPED", "missing account → SKIPPED");
  assertTrue(String(missingAccount[0].skipReason || "").includes("account"), "missing account reason");

  assertTrue(statusFromLiveSendResult({ ok: true }) === "SENT", "success → SENT");
  assertTrue(statusFromLiveSendResult({ ok: false, error: "no" }) === "FAILED", "failure → FAILED");
  assertTrue(statusFromLiveSendResult(null) === "FAILED", "missing result never SENT");
  assertTrue(statusFromLiveSendResult(undefined) === "FAILED", "undefined result never SENT");
  assertTrue(statusFromLiveSendResult({} as any) !== "SENT", "unmatched object never SENT");

  const mixedSeed: BulkRecipient[] = [
    {
      id: "1",
      accountNo: "A1",
      email: "ok@example.test",
      contactName: "Ok",
      relationship: "Parent",
      learnerId: "L1",
      learnerName: "A",
      status: "PENDING",
    },
    {
      id: "2",
      accountNo: "A2",
      email: "fail@example.test",
      contactName: "Fail",
      relationship: "Parent",
      learnerId: "L2",
      learnerName: "B",
      status: "PENDING",
    },
    {
      id: "3",
      accountNo: "A3",
      email: "later@example.test",
      contactName: "Later",
      relationship: "Parent",
      learnerId: "L3",
      learnerName: "C",
      status: "PENDING",
    },
    {
      id: "4",
      accountNo: "A4",
      email: "",
      contactName: "Skip",
      relationship: "Parent",
      learnerId: "L4",
      learnerName: "D",
      status: "SKIPPED",
      skipReason: "Missing email",
    },
  ];

  const order: string[] = [];
  const mixed = await runBulkStatementSend({
    lock: { inFlight: false },
    recipients: mixedSeed,
    sendOne: async (recipient) => {
      order.push(recipient.accountNo);
      if (recipient.accountNo === "A2") return { ok: false, error: "mailbox rejected" };
      return { ok: true };
    },
  });
  assertTrue(order.join(",") === "A1,A2,A3", "failure does not stop later recipients");
  assertTrue(mixed.find((r) => r.accountNo === "A1")?.status === "SENT", "one success → SENT");
  assertTrue(mixed.find((r) => r.accountNo === "A2")?.status === "FAILED", "one failure → FAILED");
  assertTrue(mixed.find((r) => r.accountNo === "A3")?.status === "SENT", "later recipient still sent");
  assertTrue(mixed.find((r) => r.accountNo === "A4")?.status === "SKIPPED", "skipped stays skipped");
  const mixedSummary = summarizeBulkSend(mixed);
  assertTrue(mixedSummary.outcome === "PARTIAL", "mixed batch → PARTIAL");
  assertTrue(mixedSummary.attempted === 3 && mixedSummary.sent === 2 && mixedSummary.failed === 1, "mixed counts");
  assertTrue(mixedSummary.skipped === 1, "skipped count");

  const allOk = await runBulkStatementSend({
    lock: { inFlight: false },
    recipients: mixedSeed.filter((r) => r.status === "PENDING").slice(0, 1),
    sendOne: async () => ({ ok: true }),
  });
  assertTrue(summarizeBulkSend(allOk).outcome === "COMPLETE", "all success → COMPLETE");

  const allFail = await runBulkStatementSend({
    lock: { inFlight: false },
    recipients: mixedSeed.filter((r) => r.id === "2"),
    sendOne: async () => ({ ok: false, error: "down" }),
  });
  assertTrue(summarizeBulkSend(allFail).outcome === "FAILED", "all failure → FAILED");

  const lock: BulkSendLock = { inFlight: true };
  const blocked = await runBulkStatementSend({
    lock,
    recipients: mixedSeed.filter((r) => r.status === "PENDING").slice(0, 1),
    sendOne: async () => {
      throw new Error("should not send while locked");
    },
  });
  assertTrue(blocked[0].status === "PENDING", "Send locked during processing / in-flight");
  assertTrue(isBulkSendLocked(lock), "lock flag");

  let secondStarted = false;
  const liveLock: BulkSendLock = { inFlight: false };
  const first = runBulkStatementSend({
    lock: liveLock,
    recipients: mixedSeed.filter((r) => r.id === "1"),
    sendOne: async () => {
      const blockedAgain = await runBulkStatementSend({
        lock: liveLock,
        recipients: mixedSeed.filter((r) => r.id === "1"),
        sendOne: async () => {
          secondStarted = true;
          return { ok: true };
        },
      });
      assertTrue(blockedAgain[0].status === "SENDING" || blockedAgain[0].status === "PENDING" || blockedAgain[0].status === "SENT", "nested start ignored");
      return { ok: true };
    },
  });
  await first;
  assertTrue(secondStarted === false, "second batch does not start while first is running");

  const retryLock: BulkSendLock = { inFlight: false };
  const afterFail = await runBulkStatementSend({
    lock: retryLock,
    recipients: [
      { ...mixedSeed[0], status: "SENT" },
      { ...mixedSeed[1], status: "FAILED", errorReason: "mailbox rejected" },
    ],
    mode: "failed_only",
    sendOne: async (recipient) => {
      assertTrue(recipient.status !== "SENT" && recipient.accountNo !== "A1", "retry must not resend SENT");
      return { ok: true };
    },
  });
  assertTrue(afterFail.find((r) => r.accountNo === "A1")?.status === "SENT", "SENT untouched on retry");
  assertTrue(afterFail.find((r) => r.accountNo === "A2")?.status === "SENT", "FAILED retried");

  assertTrue(confirmBulkSendMessage(7) === "Send statements to 7 recipients?", "confirm copy");
  assertTrue(resolveBulkStatementPeriod("This Year") === "Last 12 Months", "This Year maps to valid period");
  assertTrue(resolveBulkStatementPeriod("Last 30 Days") === "All Time", "invalid Last 30 Days does not pass through");
  assertTrue(resolveBulkStatementPeriod("Last 3 Months") === "Last 3 Months", "Last 3 Months valid");
  assertTrue(countPendingRecipients(mixedSeed) === 3, "pending count");
  assertTrue(countSkippedRecipients(mixedSeed) === 1, "skipped count");

  const unmatchedMapped = statusFromLiveSendResult(undefined);
  assertTrue(unmatchedMapped !== "SENT" && unmatchedMapped !== "Sent", "unmatched/missing never Sent");

  const originalFetch = globalThis.fetch;
  const posted: string[] = [];
  globalThis.fetch = (async (input: any) => {
    posted.push(String(input));
    return new Response(JSON.stringify({ success: true, messageId: "mock-msg" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const { sendStatementEmail } = await import("./statementDocument");
    await sendStatementEmail({
      schoolId: "school-1",
      to: "parent@example.test",
      subject: "Statement",
      html: "<p>Statement</p>",
      learnerId: "L1",
      accountNo: "ACC1",
      period: "All Time",
    });
    assertTrue(
      posted.some((url) => url.includes("/api/emails/send-statement")),
      "existing single-statement email path remains /api/emails/send-statement"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("bulkStatementSendLogic.test.ts: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
