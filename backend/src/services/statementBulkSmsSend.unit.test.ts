/**
 * Bulk Statement SMS send orchestration tests with injectable send fn (no live WinSMS).
 * Run: npx ts-node --transpile-only src/services/statementBulkSmsSend.unit.test.ts
 */
import assert from "assert";
import {
  BULK_STATEMENT_SMS_CONCURRENCY,
  dedupeFamilyAccountIds,
} from "./statementBulkSmsService";
import {
  buildStatementSmsDestinations,
  selectStatementSmsPairs,
  type StatementSmsParentPair,
} from "./statementSmsService";
import { isOutboundSmsDisabled } from "../utils/outboundSafety";

function pair(id: string, cellNo: string): StatementSmsParentPair {
  return {
    parent: {
      id,
      schoolId: "school-1",
      firstName: id,
      surname: "Guard",
      cellNo,
      communicationBilling: true,
      communicationBySMS: true,
    },
    link: {
      billingStatement: true,
      isPrimary: id === "p1",
      isPayingPerson: id === "p1",
      relation: "Parent",
    },
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const limit = Math.max(1, Math.min(concurrency, items.length || 1));
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  if (!items.length) return [];
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

async function testOneFailedOthersSucceed() {
  const selected = selectStatementSmsPairs(
    [pair("p1", "0821111111"), pair("p2", "0822222222"), pair("p3", "0823333333")],
    { mode: "all" }
  );
  assert.ok(selected.ok);
  const destinations = buildStatementSmsDestinations(selected.ok ? selected.pairs : []);
  assert.strictEqual(destinations.length, 3);

  let inFlight = 0;
  let maxInFlight = 0;
  const outcome = await mapPool(destinations, BULK_STATEMENT_SMS_CONCURRENCY, async (dest) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    if (dest.mobileNumber.endsWith("2222222") || dest.mobileNumber.includes("822222222")) {
      return { status: "failed" as const, mobile: dest.mobileMasked };
    }
    return { status: "sent" as const, mobile: dest.mobileMasked };
  });

  assert.strictEqual(outcome.filter((r) => r.status === "sent").length, 2);
  assert.strictEqual(outcome.filter((r) => r.status === "failed").length, 1);
  assert.ok(maxInFlight <= BULK_STATEMENT_SMS_CONCURRENCY);
}

async function testDuplicateAccountIds() {
  assert.deepStrictEqual(dedupeFamilyAccountIds(["fa1", "fa1", "fa2"]), ["fa1", "fa2"]);
}

function testOutboundDisabledEnvReadable() {
  const prev = process.env.DISABLE_OUTBOUND_SMS;
  process.env.DISABLE_OUTBOUND_SMS = "true";
  assert.strictEqual(isOutboundSmsDisabled(), true);
  process.env.DISABLE_OUTBOUND_SMS = "false";
  assert.strictEqual(isOutboundSmsDisabled(), false);
  if (prev === undefined) delete process.env.DISABLE_OUTBOUND_SMS;
  else process.env.DISABLE_OUTBOUND_SMS = prev;
}

async function main() {
  await testOneFailedOthersSucceed();
  await testDuplicateAccountIds();
  testOutboundDisabledEnvReadable();
  console.log("statementBulkSmsSend.unit.test.ts: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
