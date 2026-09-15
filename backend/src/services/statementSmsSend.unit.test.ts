/**
 * Statement SMS send orchestration with injectable deps (no live WinSMS/DB).
 * Run: npx ts-node --transpile-only src/services/statementSmsSend.unit.test.ts
 */
import assert from "assert";
import {
  buildStatementSmsDestinations,
  selectStatementSmsPairs,
  type StatementSmsParentPair,
} from "./statementSmsService";

function pair(id: string, cellNo: string, opts: Partial<{ sms: boolean; billing: boolean }> = {}): StatementSmsParentPair {
  return {
    parent: {
      id,
      schoolId: "school-1",
      firstName: id,
      surname: "Guard",
      cellNo,
      communicationBilling: opts.billing ?? true,
      communicationBySMS: opts.sms ?? true,
    },
    link: {
      billingStatement: true,
      isPrimary: id === "p1",
      isPayingPerson: id === "p1",
      relation: "Parent",
    },
  };
}

/** Mirrors sendStatementSms destination loop: one WinSMS call per unique mobile. */
async function sendToDestinations(
  pairs: StatementSmsParentPair[],
  sendFn: (mobile: string) => Promise<void>
): Promise<{ sent: number; failed: number; results: Array<{ mobile: string; status: string }> }> {
  const destinations = buildStatementSmsDestinations(pairs);
  let sent = 0;
  let failed = 0;
  const results: Array<{ mobile: string; status: string }> = [];
  for (const dest of destinations) {
    try {
      await sendFn(dest.mobileNumber);
      sent += 1;
      results.push({ mobile: dest.mobileMasked, status: "sent" });
    } catch {
      failed += 1;
      results.push({ mobile: dest.mobileMasked, status: "failed" });
    }
  }
  return { sent, failed, results };
}

async function testBothParentsSeparateSends() {
  const p1 = pair("p1", "0821111111");
  const p2 = pair("p2", "0822222222");
  const selected = selectStatementSmsPairs([p1, p2], { mode: "all" });
  assert.ok(selected.ok);
  const mobiles: string[] = [];
  const outcome = await sendToDestinations(selected.ok ? selected.pairs : [], async (m) => {
    mobiles.push(m);
  });
  assert.strictEqual(outcome.sent, 2);
  assert.strictEqual(outcome.failed, 0);
  assert.strictEqual(mobiles.length, 2);
  assert.notStrictEqual(mobiles[0], mobiles[1]);
}

async function testSameMobileOneSend() {
  const p1 = pair("p1", "0825555507");
  const p2 = pair("p2", "27825555507");
  const selected = selectStatementSmsPairs([p1, p2], { mode: "all" });
  assert.ok(selected.ok);
  let calls = 0;
  const outcome = await sendToDestinations(selected.ok ? selected.pairs : [], async () => {
    calls += 1;
  });
  assert.strictEqual(calls, 1);
  assert.strictEqual(outcome.sent, 1);
}

async function testPartialSuccessReporting() {
  const p1 = pair("p1", "0821111111");
  const p2 = pair("p2", "0822222222");
  const selected = selectStatementSmsPairs([p1, p2], { mode: "all" });
  assert.ok(selected.ok);
  let n = 0;
  const outcome = await sendToDestinations(selected.ok ? selected.pairs : [], async () => {
    n += 1;
    if (n === 2) throw new Error("WinSMS fail");
  });
  assert.strictEqual(outcome.sent, 1);
  assert.strictEqual(outcome.failed, 1);
  assert.ok(!(outcome.sent === 2));
  const summary = `${outcome.sent} SMS sent. ${outcome.failed} SMS failed.`;
  assert.strictEqual(summary, "1 SMS sent. 1 SMS failed.");
}

async function testSmsConsentExcludes() {
  const p1 = pair("p1", "0821111111");
  const p2 = pair("p2", "0822222222", { sms: false });
  const rankedEligible = selectStatementSmsPairs([p1, p2], { mode: "all" });
  assert.ok(rankedEligible.ok);
  if (rankedEligible.ok) {
    assert.strictEqual(rankedEligible.pairs.length, 1);
    assert.strictEqual(rankedEligible.pairs[0].parent.id, "p1");
  }
}

async function testBillingCommExcludes() {
  const p1 = pair("p1", "0821111111", { billing: false });
  const p2 = pair("p2", "0822222222");
  const selected = selectStatementSmsPairs([p1, p2], { mode: "all" });
  assert.ok(selected.ok);
  if (selected.ok) {
    assert.strictEqual(selected.pairs.length, 1);
    assert.strictEqual(selected.pairs[0].parent.id, "p2");
  }
}

async function main() {
  await testBothParentsSeparateSends();
  await testSameMobileOneSend();
  await testPartialSuccessReporting();
  await testSmsConsentExcludes();
  await testBillingCommExcludes();
  console.log("statementSmsSend.unit.test.ts: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
