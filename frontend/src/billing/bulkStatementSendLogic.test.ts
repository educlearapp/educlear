/**
 * Bulk statement send: selection, dedupe, bounded-concurrent mocked delivery.
 * Run: npx tsx src/billing/bulkStatementSendLogic.test.ts
 */
import assert from "assert";
import {
  applyRecipientSelected,
  buildBulkStatementRecipients,
  clampBulkSendConcurrency,
  confirmBulkSendMessage,
  countEligibleRecipients,
  countPendingRecipients,
  countSelectedRecipients,
  countSkippedRecipients,
  deselectAllRecipients,
  filterRowsForBulkStatementSend,
  isBulkSendButtonEnabled,
  isBulkSendLocked,
  isPermanentBulkSendClientError,
  isRecipientSelectable,
  isRetryableBulkRateLimit,
  matchesBulkAccountStatus,
  parseBulkSendHttpStatus,
  recipientDedupKey,
  resolveBulkRateLimitBackoffMs,
  resolveBulkStatementPeriod,
  runBulkStatementSend,
  selectAllEligibleRecipients,
  statusFromLiveSendResult,
  summarizeBulkSend,
  nextDispatchDue,
  BULK_STATEMENT_DISPATCH_SPACING_MS,
  BULK_STATEMENT_SEND_CONCURRENCY,
  type BulkRecipient,
  type BulkSendLock,
} from "./bulkStatementSendLogic";

function assertTrue(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pendingSelected(count: number, start = 1): BulkRecipient[] {
  return Array.from({ length: count }, (_, i) => {
    const n = start + i;
    return {
      id: `P${n}`,
      accountNo: `A${n}`,
      email: `p${n}@example.test`,
      contactName: `Parent ${n}`,
      relationship: "Parent",
      learnerId: `L${n}`,
      learnerName: `Learner ${n}`,
      status: "PENDING" as const,
      selected: true,
    };
  });
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
  assertTrue(dupRecipients.every((r) => r.selected === false), "initial eligible recipients are unselected");
  assertTrue(
    pendingDup.filter((r) => r.isCanonicalBillingRecipient).length === 1,
    "exactly one canonical billing recipient"
  );
  assertTrue(
    pendingDup.filter((r) => r.isAdditionalBillingContact).length === 1,
    "second distinct email is additional (manual only)"
  );
  const emails = pendingDup.map((r) => r.email.trim().toLowerCase()).sort();
  assertTrue(emails[0] === "same@example.test" && emails[1] === "two@example.test", "keeps one same-email recipient");
  assertTrue(recipientDedupKey("fam001", "A@X.COM") === recipientDedupKey("FAM001", "a@x.com"), "dedupe key");
  const selectAllDup = selectAllEligibleRecipients(dupRecipients);
  assertTrue(
    selectAllDup.filter((r) => r.selected).length === 1,
    "Select All selects only the canonical contact"
  );

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
      selected: false,
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
      selected: false,
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
      selected: false,
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
      selected: false,
      skipReason: "Missing email",
    },
  ];

  assertTrue(mixedSeed.every((r) => r.selected === false), "seed starts unselected");
  assertTrue(isBulkSendButtonEnabled(mixedSeed) === false, "Send disabled when selected count = 0");
  assertTrue(countEligibleRecipients(mixedSeed) === 3, "eligible excludes SKIPPED");
  assertTrue(countSelectedRecipients(mixedSeed) === 0, "selected starts at 0");

  const skippedTried = applyRecipientSelected(mixedSeed, "4", true);
  assertTrue(skippedTried.find((r) => r.id === "4")?.selected === false, "SKIPPED cannot be selected");
  assertTrue(isRecipientSelectable(mixedSeed[3]) === false, "SKIPPED is not selectable");

  const oneSelected = applyRecipientSelected(mixedSeed, "1", true);
  assertTrue(isBulkSendButtonEnabled(oneSelected) === true, "Send enabled after selecting one pending");
  const sentOne: string[] = [];
  const oneResult = await runBulkStatementSend({ dispatchSpacingMs: 0,
    lock: { inFlight: false },
    recipients: oneSelected,
    sendOne: async (recipient) => {
      sentOne.push(recipient.accountNo);
      return { ok: true };
    },
  });
  assertTrue(sentOne.join(",") === "A1", "selecting one recipient sends exactly one");
  assertTrue(oneResult.find((r) => r.accountNo === "A2")?.status === "PENDING", "unselected recipient never sent");
  assertTrue(oneResult.find((r) => r.accountNo === "A3")?.status === "PENDING", "second unselected stays PENDING");
  assertTrue(confirmBulkSendMessage(sentOne.length) === "Send statements to 1 selected recipients?", "confirm count equals actual selected-send count");

  const twoSelected = applyRecipientSelected(applyRecipientSelected(mixedSeed, "1", true), "3", true);
  const sentTwo: string[] = [];
  await runBulkStatementSend({ dispatchSpacingMs: 0,
    lock: { inFlight: false },
    recipients: twoSelected,
    sendOne: async (recipient) => {
      sentTwo.push(recipient.accountNo);
      return { ok: true };
    },
  });
  assertTrue(sentTwo.join(",") === "A1,A3", "selecting two sends exactly two");
  assertTrue(confirmBulkSendMessage(sentTwo.length) === "Send statements to 2 selected recipients?", "confirm copy matches two selected");

  const allEligible = selectAllEligibleRecipients(mixedSeed);
  assertTrue(allEligible.filter((r) => r.selected).map((r) => r.id).join(",") === "1,2,3", "Select All selects all eligible recipients only");
  assertTrue(allEligible.find((r) => r.id === "4")?.selected === false, "Select All does not select SKIPPED");
  const noneSelected = deselectAllRecipients(allEligible);
  assertTrue(noneSelected.every((r) => r.selected === false), "Deselect All selects none");

  const withAdditional: BulkRecipient[] = [
    {
      id: "c1",
      accountNo: "FAM9",
      email: "primary@example.test",
      contactName: "Primary",
      relationship: "Father",
      learnerId: "L9",
      learnerName: "Kid",
      status: "PENDING",
      selected: false,
      isCanonicalBillingRecipient: true,
    },
    {
      id: "a1",
      accountNo: "FAM9",
      email: "second@example.test",
      contactName: "Second",
      relationship: "Mother",
      learnerId: "L9",
      learnerName: "Kid",
      status: "PENDING",
      selected: false,
      isCanonicalBillingRecipient: false,
      isAdditionalBillingContact: true,
    },
  ];
  const selectCanonicalOnly = selectAllEligibleRecipients(withAdditional);
  assertTrue(selectCanonicalOnly.find((r) => r.id === "c1")?.selected === true, "Select All selects canonical");
  assertTrue(
    selectCanonicalOnly.find((r) => r.id === "a1")?.selected === false,
    "Select All does not select additional contact"
  );
  const manualAdditional = applyRecipientSelected(selectCanonicalOnly, "a1", true);
  assertTrue(manualAdditional.find((r) => r.id === "a1")?.selected === true, "additional can be selected manually");

  const unselectedNeverCalled: string[] = [];
  await runBulkStatementSend({ dispatchSpacingMs: 0,
    lock: { inFlight: false },
    recipients: mixedSeed,
    sendOne: async (recipient) => {
      unselectedNeverCalled.push(recipient.accountNo);
      return { ok: true };
    },
  });
  assertTrue(unselectedNeverCalled.length === 0, "unselected recipient never reaches sendStatementEmail");

  const order: string[] = [];
  const mixed = await runBulkStatementSend({ dispatchSpacingMs: 0,
    lock: { inFlight: false },
    recipients: selectAllEligibleRecipients(mixedSeed),
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

  const allOk = await runBulkStatementSend({ dispatchSpacingMs: 0,
    lock: { inFlight: false },
    recipients: applyRecipientSelected(mixedSeed.filter((r) => r.status === "PENDING").slice(0, 1), "1", true),
    sendOne: async () => ({ ok: true }),
  });
  assertTrue(summarizeBulkSend(allOk).outcome === "COMPLETE", "all success → COMPLETE");

  const allFail = await runBulkStatementSend({ dispatchSpacingMs: 0,
    lock: { inFlight: false },
    recipients: applyRecipientSelected(mixedSeed.filter((r) => r.id === "2"), "2", true),
    sendOne: async () => ({ ok: false, error: "down" }),
  });
  assertTrue(summarizeBulkSend(allFail).outcome === "FAILED", "all failure → FAILED");

  const lock: BulkSendLock = { inFlight: true };
  const blocked = await runBulkStatementSend({ dispatchSpacingMs: 0,
    lock,
    recipients: applyRecipientSelected(mixedSeed.filter((r) => r.status === "PENDING").slice(0, 1), "1", true),
    sendOne: async () => {
      throw new Error("should not send while locked");
    },
  });
  assertTrue(blocked[0].status === "PENDING", "Send locked during processing / in-flight");
  assertTrue(isBulkSendLocked(lock), "lock flag");
  const lockedSelection = applyRecipientSelected(oneSelected, "3", true, lock);
  assertTrue(lockedSelection.find((r) => r.id === "3")?.selected === false, "lock prevents selection changes during active send");
  const lockedSelectAll = selectAllEligibleRecipients(mixedSeed, lock);
  assertTrue(lockedSelectAll.every((r) => r.selected === false), "Select All disabled while locked");
  const lockedDeselect = deselectAllRecipients(oneSelected, lock);
  assertTrue(lockedDeselect.find((r) => r.id === "1")?.selected === true, "Deselect All disabled while locked");

  let secondStarted = false;
  const liveLock: BulkSendLock = { inFlight: false };
  const first = runBulkStatementSend({ dispatchSpacingMs: 0,
    lock: liveLock,
    recipients: applyRecipientSelected(mixedSeed.filter((r) => r.id === "1"), "1", true),
    sendOne: async () => {
      const blockedAgain = await runBulkStatementSend({ dispatchSpacingMs: 0,
        lock: liveLock,
        recipients: applyRecipientSelected(mixedSeed.filter((r) => r.id === "1"), "1", true),
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
  const retryCalled: string[] = [];
  const afterFail = await runBulkStatementSend({ dispatchSpacingMs: 0,
    lock: retryLock,
    recipients: [
      { ...mixedSeed[0], status: "SENT", selected: true },
      { ...mixedSeed[1], status: "FAILED", selected: true, errorReason: "mailbox rejected" },
      { ...mixedSeed[2], status: "FAILED", selected: false, errorReason: "never selected" },
    ],
    mode: "failed_only",
    sendOne: async (recipient) => {
      retryCalled.push(recipient.accountNo);
      assertTrue(recipient.status !== "SENT" && recipient.accountNo !== "A1", "retry must not resend SENT");
      assertTrue(recipient.accountNo !== "A3", "retry FAILED does not include previously unselected recipients");
      return { ok: true };
    },
  });
  assertTrue(retryCalled.join(",") === "A2", "retry only the selected FAILED recipient");
  assertTrue(afterFail.find((r) => r.accountNo === "A1")?.status === "SENT", "SENT untouched on retry");
  assertTrue(afterFail.find((r) => r.accountNo === "A2")?.status === "SENT", "FAILED retried");
  assertTrue(afterFail.find((r) => r.accountNo === "A3")?.status === "FAILED", "unselected FAILED is not retried");

  const sentTried = applyRecipientSelected(
    [{ ...mixedSeed[0], status: "SENT", selected: false }],
    "1",
    true
  );
  assertTrue(sentTried[0].selected === false, "SENT recipients cannot be selected");
  const resentSent: string[] = [];
  await runBulkStatementSend({ dispatchSpacingMs: 0,
    lock: { inFlight: false },
    recipients: [{ ...mixedSeed[0], status: "SENT", selected: true }],
    mode: "failed_only",
    sendOne: async (recipient) => {
      resentSent.push(recipient.accountNo);
      return { ok: true };
    },
  });
  assertTrue(resentSent.length === 0, "SENT recipients cannot be resent by retry");

  assertTrue(confirmBulkSendMessage(7) === "Send statements to 7 selected recipients?", "confirm copy");
  assertTrue(resolveBulkStatementPeriod("This Year") === "Last 12 Months", "This Year maps to valid period");
  assertTrue(resolveBulkStatementPeriod("Last 30 Days") === "All Time", "invalid Last 30 Days does not pass through");
  assertTrue(resolveBulkStatementPeriod("Last 3 Months") === "Last 3 Months", "Last 3 Months valid");
  assertTrue(countPendingRecipients(mixedSeed) === 3, "pending count");
  assertTrue(countSkippedRecipients(mixedSeed) === 1, "skipped count");

  assertTrue(BULK_STATEMENT_SEND_CONCURRENCY === 5, "default concurrency cap is 5");
  assertTrue(clampBulkSendConcurrency(99) === 5, "requested concurrency cannot exceed 5");
  assertTrue(clampBulkSendConcurrency(0) === 5, "invalid concurrency falls back to 5");
  assertTrue(clampBulkSendConcurrency(1) === 1, "concurrency 1 remains allowed");

  const skippedInQueue: string[] = [];
  const skippedQueueSeed: BulkRecipient[] = [
    ...pendingSelected(2),
    {
      id: "SKIP1",
      accountNo: "SKIP001",
      email: "",
      contactName: "Skip",
      relationship: "Parent",
      learnerId: "LS",
      learnerName: "Skip",
      status: "SKIPPED",
      selected: true,
      skipReason: "Missing email",
    },
  ];
  await runBulkStatementSend({ dispatchSpacingMs: 0,
    lock: { inFlight: false },
    recipients: skippedQueueSeed,
    sendOne: async (recipient) => {
      skippedInQueue.push(recipient.id);
      return { ok: true };
    },
  });
  assertTrue(skippedInQueue.join(",") === "P1,P2", "SKIPPED recipients never enter the queue");

  let peakInFlight = 0;
  let inFlight = 0;
  let peakSendingStatus = 0;
  const twelve = pendingSelected(12);
  const concurrent = await runBulkStatementSend({ dispatchSpacingMs: 0,
    lock: { inFlight: false },
    recipients: twelve,
    concurrency: 99,
    sendOne: async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await sleep(25);
      inFlight -= 1;
      return { ok: true };
    },
    onProgress: (rows) => {
      peakSendingStatus = Math.max(
        peakSendingStatus,
        rows.filter((row) => row.status === "SENDING").length
      );
    },
  });
  assertTrue(peakInFlight <= 5, "Maximum concurrency never exceeds 5");
  assertTrue(peakInFlight === 5, "pool reaches the cap of 5 simultaneous sends");
  assertTrue(peakSendingStatus <= 5, "SENDING rows never exceed 5");
  assertTrue(concurrent.every((row) => row.status === "SENT"), "all concurrent successes become SENT");

  const twentyThreeCalls: string[] = [];
  const twentyThreeSeed: BulkRecipient[] = [
    ...pendingSelected(23),
    {
      id: "SKIP23",
      accountNo: "SK23",
      email: "",
      contactName: "Skip",
      relationship: "Parent",
      learnerId: "LS23",
      learnerName: "Skip",
      status: "SKIPPED",
      selected: true,
      skipReason: "Missing email",
    },
  ];
  const twentyThree = await runBulkStatementSend({ dispatchSpacingMs: 0,
    lock: { inFlight: false },
    recipients: twentyThreeSeed,
    sendOne: async (recipient) => {
      twentyThreeCalls.push(recipient.id);
      await sleep(5);
      return { ok: true };
    },
  });
  assertTrue(twentyThreeCalls.length === 23, "23 recipients results in exactly 23 send calls");
  const twentyThreeSummary = summarizeBulkSend(twentyThree);
  assertTrue(twentyThreeSummary.attempted === 23 && twentyThreeSummary.sent === 23 && twentyThreeSummary.failed === 0, "completion counts reconcile exactly");
  assertTrue(twentyThreeSummary.skipped === 1 && twentyThreeSummary.outcome === "COMPLETE", "skipped stays out of attempted count");

  const failDoesNotStop: string[] = [];
  const failSeed = pendingSelected(8);
  const failMixed = await runBulkStatementSend({ dispatchSpacingMs: 0,
    lock: { inFlight: false },
    recipients: failSeed,
    sendOne: async (recipient) => {
      failDoesNotStop.push(recipient.id);
      await sleep(8);
      if (recipient.id === "P2") return { ok: false, error: "mailbox rejected" };
      return { ok: true };
    },
  });
  assertTrue(failDoesNotStop.length === 8, "one failure does not stop the remaining recipients");
  assertTrue(failMixed.find((row) => row.id === "P2")?.status === "FAILED", "failed row is FAILED");
  assertTrue(failMixed.filter((row) => row.status === "SENT").length === 7, "other recipients still SENT");
  assertTrue(summarizeBulkSend(failMixed).outcome === "PARTIAL", "mixed concurrent batch → PARTIAL");

  const firstPass = await runBulkStatementSend({ dispatchSpacingMs: 0,
    lock: { inFlight: false },
    recipients: pendingSelected(4),
    sendOne: async () => {
      await sleep(5);
      return { ok: true };
    },
  });
  assertTrue(firstPass.every((row) => row.status === "SENT"), "first pass marks SENT only after success");
  const duplicateCalls: string[] = [];
  await runBulkStatementSend({ dispatchSpacingMs: 0,
    lock: { inFlight: false },
    recipients: firstPass.map((row) => ({ ...row, selected: true })),
    sendOne: async (recipient) => {
      duplicateCalls.push(recipient.id);
      return { ok: true };
    },
  });
  assertTrue(duplicateCalls.length === 0, "SENT recipients are never duplicated");

  const retryOnlyFailed: string[] = [];
  const retrySeed: BulkRecipient[] = [
    { ...pendingSelected(1)[0], status: "SENT", selected: true },
    { ...pendingSelected(1, 2)[0], status: "FAILED", selected: true, errorReason: "down" },
    { ...pendingSelected(1, 3)[0], status: "FAILED", selected: false, errorReason: "unselected" },
    { ...pendingSelected(1, 4)[0], status: "PENDING", selected: true },
    {
      id: "SKIP-R",
      accountNo: "SKR",
      email: "",
      contactName: "Skip",
      relationship: "Parent",
      learnerId: "LSR",
      learnerName: "Skip",
      status: "SKIPPED",
      selected: true,
      skipReason: "Missing email",
    },
  ];
  const retried = await runBulkStatementSend({ dispatchSpacingMs: 0,
    lock: { inFlight: false },
    recipients: retrySeed,
    mode: "failed_only",
    sendOne: async (recipient) => {
      retryOnlyFailed.push(recipient.id);
      await sleep(5);
      return { ok: true };
    },
  });
  assertTrue(retryOnlyFailed.join(",") === "P2", "Retry Failed sends only failed selected recipients");
  assertTrue(retried.find((row) => row.id === "P1")?.status === "SENT", "retry does not resend SENT");
  assertTrue(retried.find((row) => row.id === "P3")?.status === "FAILED", "unselected FAILED stays FAILED");
  assertTrue(retried.find((row) => row.id === "P4")?.status === "PENDING", "retry does not pick PENDING");
  assertTrue(retried.find((row) => row.id === "SKIP-R")?.status === "SKIPPED", "retry does not send SKIPPED");

  assertTrue(parseBulkSendHttpStatus("Too many requests") === 429, "Resend too-many-requests maps to 429");
  assertTrue(parseBulkSendHttpStatus("Resend email send failed with HTTP 429") === 429, "HTTP_429 text maps");
  assertTrue(isRetryableBulkRateLimit({ ok: false, error: "Too many requests", httpStatus: 429 }) === true, "429 is retryable");
  assertTrue(isPermanentBulkSendClientError({ ok: false, error: "HTTP 422 invalid recipient", httpStatus: 422 }) === true, "422 is permanent");
  assertTrue(isRetryableBulkRateLimit({ ok: false, error: "HTTP 422 invalid recipient", httpStatus: 422 }) === false, "422 is not retried");
  assertTrue(isRetryableBulkRateLimit({ ok: true }) === false, "HTTP 200 is never retried");
  assertTrue(resolveBulkRateLimitBackoffMs({ ok: false, error: "x", retryAfterMs: 800 }) === 800, "Retry-After ms honored");
  assertTrue(resolveBulkRateLimitBackoffMs({ ok: false, error: "retry-after: 2" }) === 2000, "Retry-After seconds honored");
  assertTrue(BULK_STATEMENT_DISPATCH_SPACING_MS === 220, "default dispatch spacing is ~4.5 req/s");

  const callCounts: Record<string, number> = {};
  const rateLimitedSeed = pendingSelected(3);
  const after429 = await runBulkStatementSend({
    dispatchSpacingMs: 0,
    lock: { inFlight: false },
    recipients: rateLimitedSeed,
    sleepImpl: async () => {},
    sendOne: async (recipient) => {
      callCounts[recipient.id] = (callCounts[recipient.id] || 0) + 1;
      if (recipient.id === "P2" && callCounts[recipient.id] === 1) {
        return { ok: false, error: "Too many requests", httpStatus: 429, retryAfterMs: 250 };
      }
      return { ok: true };
    },
  });
  assertTrue(callCounts.P1 === 1 && callCounts.P3 === 1, "non-429 recipients send once");
  assertTrue(callCounts.P2 === 2, "one 429 retries only that recipient");
  assertTrue(after429.find((row) => row.id === "P2")?.status === "SENT", "429 retry can become SENT");
  assertTrue(after429.filter((row) => row.status === "SENT").length === 3, "final counts remain accurate after 429 retry");

  const backoffs: number[] = [];
  let nowMs = 0;
  await runBulkStatementSend({
    dispatchSpacingMs: 0,
    lock: { inFlight: false },
    recipients: pendingSelected(1),
    nowImpl: () => nowMs,
    sleepImpl: async (ms) => {
      backoffs.push(ms);
      nowMs += ms;
    },
    sendOne: async () => {
      if (backoffs.length === 0) {
        return { ok: false, error: "HTTP 429", httpStatus: 429, retryAfterMs: 700 };
      }
      return { ok: true };
    },
  });
  assertTrue(backoffs.includes(700), "Retry-After/backoff is respected where available");

  const permanentCalls: Record<string, number> = {};
  const permanent = await runBulkStatementSend({
    dispatchSpacingMs: 0,
    lock: { inFlight: false },
    recipients: pendingSelected(2),
    sleepImpl: async () => {},
    sendOne: async (recipient) => {
      permanentCalls[recipient.id] = (permanentCalls[recipient.id] || 0) + 1;
      if (recipient.id === "P1") return { ok: false, error: "HTTP 422 invalid recipient", httpStatus: 422 };
      return { ok: false, error: "HTTP 400 missing fields", httpStatus: 400 };
    },
  });
  assertTrue(permanentCalls.P1 === 1 && permanentCalls.P2 === 1, "permanent 422/400 does not retry");
  assertTrue(permanent.every((row) => row.status === "FAILED"), "permanent client errors stay FAILED");

  const successIds: string[] = [];
  await runBulkStatementSend({
    dispatchSpacingMs: 0,
    lock: { inFlight: false },
    recipients: pendingSelected(5),
    sleepImpl: async () => {},
    sendOne: async (recipient) => {
      successIds.push(recipient.id);
      return { ok: true };
    },
  });
  assertTrue(successIds.sort().join(",") === "P1,P2,P3,P4,P5", "HTTP 200 is never duplicated");

  let clock = 0;
  const dispatchAt: number[] = [];
  await runBulkStatementSend({
    dispatchSpacingMs: 40,
    concurrency: 1,
    lock: { inFlight: false },
    recipients: pendingSelected(6),
    nowImpl: () => clock,
    sleepImpl: async (ms) => {
      clock += ms;
    },
    sendOne: async () => {
      dispatchAt.push(clock);
      return { ok: true };
    },
  });
  const gaps = dispatchAt.slice(1).map((t, i) => t - dispatchAt[i]);
  assertTrue(dispatchAt.length === 6, "bounded dispatch still sends every recipient");
  assertTrue(
    gaps.every((gap) => gap >= 40),
    "dispatch rate is bounded"
  );
  assertTrue(nextDispatchDue(null, 1000, 220) === 1000, "first dispatch has no delay");
  assertTrue(nextDispatchDue(1000, 1000, 220) === 1220, "later dispatches are spaced");
  assertTrue(nextDispatchDue(1000, 2000, 220) === 2000, "spacing does not add delay when already behind");

  const reduced: number[] = [];
  const hammered = await runBulkStatementSend({
    dispatchSpacingMs: 0,
    lock: { inFlight: false },
    recipients: pendingSelected(6),
    sleepImpl: async () => {},
    onRateLimit: (state) => reduced.push(state.effectiveConcurrency),
    sendOne: async () => ({ ok: false, error: "HTTP 429", httpStatus: 429, retryAfterMs: 200 }),
  });
  assertTrue(reduced.includes(3) && reduced.includes(2), "repeated 429 reduces concurrency 5 → 3 → 2");
  assertTrue(hammered.every((row) => row.status === "FAILED"), "exhausted 429 retries become FAILED");
  assertTrue(summarizeBulkSend(hammered).attempted === 6 && summarizeBulkSend(hammered).failed === 6, "final counts remain accurate after rate-limit failures");
  assertTrue(summarizeBulkSend(hammered).sent === 0, "no false SENT after 429 exhaustion");

  const unmatchedMapped = statusFromLiveSendResult(undefined);
  assertTrue(unmatchedMapped !== "SENT" && unmatchedMapped !== "Sent", "unmatched/missing never Sent");

  // --- Recipient policy (canonical billing contact / consent / validation) ---
  const oneAccountOneParent = buildBulkStatementRecipients({
    rows: [row({ learnerId: "L-ONE", accountNo: "ONE001" })],
    learners: [
      learner({
        id: "L-ONE",
        accountNo: "ONE001",
        parents: [{ firstName: "Only", surname: "Parent", email: "only@example.test", isPrimary: true }],
      }),
    ],
  });
  assertTrue(
    oneAccountOneParent.filter((r) => r.status === "PENDING").length === 1,
    "A: one account + one valid billing recipient => one eligible"
  );
  assertTrue(oneAccountOneParent[0].isCanonicalBillingRecipient === true, "A: marked canonical");

  const multiParent = buildBulkStatementRecipients({
    rows: [row({ learnerId: "L-MULTI", accountNo: "MULTI1" })],
    learners: [
      learner({
        id: "L-MULTI",
        accountNo: "MULTI1",
        parents: [
          {
            firstName: "Secondary",
            surname: "Parent",
            email: "second@example.test",
            isPrimary: false,
            isPayingPerson: false,
          },
          {
            firstName: "Primary",
            surname: "Parent",
            email: "primary@example.test",
            isPrimary: true,
            isPayingPerson: true,
          },
        ],
      }),
    ],
  });
  const multiPending = multiParent.filter((r) => r.status === "PENDING");
  assertTrue(multiPending.length === 2, "B: multiple valid parents remain listed");
  const multiCanonical = multiPending.find((r) => r.isCanonicalBillingRecipient);
  assertTrue(multiCanonical?.email === "primary@example.test", "B: canonical is primary/paying contact");
  assertTrue(
    selectAllEligibleRecipients(multiParent).filter((r) => r.selected).length === 1,
    "B: Select All sends only canonical"
  );

  const consentBlocked = buildBulkStatementRecipients({
    rows: [row({ learnerId: "L-CONSENT", accountNo: "CON001" })],
    learners: [
      learner({
        id: "L-CONSENT",
        accountNo: "CON001",
        parents: [
          {
            firstName: "No",
            surname: "Mail",
            email: "blocked@example.test",
            communicationByEmail: false,
            isPrimary: true,
          },
        ],
      }),
    ],
  });
  assertTrue(
    consentBlocked.some((r) => r.status === "SKIPPED" && r.skipReason === "Billing/email preferences disabled"),
    "D: consent disabled matches single-send exclusion"
  );
  assertTrue(consentBlocked.every((r) => r.status !== "PENDING"), "D: no pending when only consent-blocked contact");

  const malformed = buildBulkStatementRecipients({
    rows: [row({ learnerId: "L-BADMAIL", accountNo: "BADMAIL" })],
    learners: [
      learner({
        id: "L-BADMAIL",
        accountNo: "BADMAIL",
        parents: [{ firstName: "Bad", surname: "Mail", email: "thatomoesbv.co.za", isPrimary: true }],
      }),
    ],
  });
  assertTrue(
    malformed.some((r) => r.status === "SKIPPED" && r.skipReason === "Invalid email"),
    "F: malformed email skipped"
  );

  const schoolInbox = buildBulkStatementRecipients({
    rows: [row({ learnerId: "L-SCH", accountNo: "SIL007" })],
    schoolEmail: "dasilvaacademy@gmail.com",
    learners: [
      learner({
        id: "L-SCH",
        accountNo: "SIL007",
        parents: [
          {
            firstName: "Jose",
            surname: "Guardian",
            email: "dasilvaacademy@gmail.com",
            isPrimary: true,
          },
          {
            firstName: "Tony",
            surname: "Parent",
            email: "tony.parent@example.test",
            isPrimary: false,
            isPayingPerson: true,
          },
        ],
      }),
    ],
  });
  assertTrue(
    schoolInbox.some((r) => r.status === "SKIPPED" && r.skipReason === "School or internal email"),
    "G: school inbox blocked from recipients"
  );
  assertTrue(
    schoolInbox.some((r) => r.status === "PENDING" && r.email === "tony.parent@example.test" && r.isCanonicalBillingRecipient),
    "G: legitimate parent becomes canonical instead"
  );

  const sharedEmailAcrossAccounts = buildBulkStatementRecipients({
    rows: [
      row({ learnerId: "L-A1", accountNo: "ACC001" }),
      row({ learnerId: "L-A2", accountNo: "ACC002" }),
    ],
    learners: [
      learner({
        id: "L-A1",
        accountNo: "ACC001",
        parents: [{ firstName: "Shared", surname: "One", email: "shared.house@example.test", isPrimary: true }],
      }),
      learner({
        id: "L-A2",
        accountNo: "ACC002",
        parents: [{ firstName: "Shared", surname: "One", email: "shared.house@example.test", isPrimary: true }],
      }),
    ],
  });
  const sharedPending = sharedEmailAcrossAccounts.filter((r) => r.status === "PENDING");
  assertTrue(sharedPending.length === 2, "H: same email on different accounts stays two recipients");
  assertTrue(
    new Set(sharedPending.map((r) => r.accountNo)).size === 2,
    "H: accounts are not merged by matching email"
  );

  const billingStatementFalse = buildBulkStatementRecipients({
    rows: [row({ learnerId: "L-BS", accountNo: "BS001" })],
    learners: [
      learner({
        id: "L-BS",
        accountNo: "BS001",
        parents: [
          {
            firstName: "Off",
            surname: "Statements",
            email: "off@example.test",
            billingStatement: false,
            isPrimary: true,
          },
        ],
      }),
    ],
  });
  assertTrue(
    billingStatementFalse.some(
      (r) => r.status === "SKIPPED" && r.skipReason === "Billing/email preferences disabled"
    ),
    "D: billingStatement false excluded"
  );

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
