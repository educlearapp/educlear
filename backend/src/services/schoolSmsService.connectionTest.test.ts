/**
 * School SMS connection-test persistence — mocked WinSMS, no DB writes, no SMS sent.
 * A test result may only be stored when the tested key is the school's stored key.
 * Run: node --import tsx src/services/schoolSmsService.connectionTest.test.ts
 */
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { shouldPersistConnectionTestResult } from "./schoolSmsService";
import { getWinSmsCreditBalance } from "./winSmsClient";

function testPersistenceRule() {
  assert.equal(
    shouldPersistConnectionTestResult({ usedStoredKey: true, storedKeyMatchesTestedKey: false }),
    true,
    "testing the stored key persists"
  );
  assert.equal(
    shouldPersistConnectionTestResult({ usedStoredKey: false, storedKeyMatchesTestedKey: true }),
    true,
    "testing a just-saved replacement key (override identical to stored) persists"
  );
  assert.equal(
    shouldPersistConnectionTestResult({ usedStoredKey: false, storedKeyMatchesTestedKey: false }),
    false,
    "testing an unsaved candidate key does not persist"
  );
  console.log("  ✓ connection-test persistence rule (stored / just-saved / unsaved candidate)");
}

function testFailureUsesSamePersistenceRule() {
  const src = fs.readFileSync(path.join(process.cwd(), "src/services/schoolSmsService.ts"), "utf8");
  assert.ok(
    src.includes("persistConnectionFailure(schoolId, message, persistResult)"),
    "failure path uses the same persistence rule as success (no forced write for unsaved keys)"
  );
  assert.ok(
    !src.includes("Boolean(await getSchoolSmsSettingsRow(schoolId))"),
    "failure path no longer persists merely because a settings row exists"
  );
  assert.ok(
    src.includes("persistConnectionSuccess(schoolId, creditBalance, persistResult)"),
    "success path persists when the tested key is the stored key"
  );
  console.log("  ✓ success and failure share one persistence rule in source");
}

async function testMockedWinSmsBalance() {
  const previousFetch = globalThis.fetch;
  const previousDisabled = process.env.DISABLE_OUTBOUND_SMS;
  delete process.env.DISABLE_OUTBOUND_SMS;
  let authHeader = "";
  let requestedUrl = "";
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    requestedUrl = String(url);
    authHeader = String((init?.headers as Record<string, string>)?.AUTHORIZATION || "");
    return new Response(
      JSON.stringify({ statusCode: 200, creditBalance: 321 }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;
  try {
    const { creditBalance } = await getWinSmsCreditBalance("mocked-test-key");
    assert.equal(creditBalance, 321, "mocked WinSMS balance returned");
    assert.ok(requestedUrl.endsWith("/credits/balance"), "balance endpoint used");
    assert.equal(authHeader, "mocked-test-key", "key sent only as AUTHORIZATION header to WinSMS");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDisabled === undefined) delete process.env.DISABLE_OUTBOUND_SMS;
    else process.env.DISABLE_OUTBOUND_SMS = previousDisabled;
  }
  console.log("  ✓ mocked WinSMS balance response (no live provider call)");
}

async function main() {
  testPersistenceRule();
  testFailureUsesSamePersistenceRule();
  await testMockedWinSmsBalance();
  console.log("\nAll school SMS connection-test tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
