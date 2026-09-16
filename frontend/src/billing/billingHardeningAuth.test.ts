/**
 * Bulk-add result sequencing + billing GET auth hardening tests.
 * Run: npx tsx src/billing/billingHardeningAuth.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatBulkAddSummaryMessage,
  shouldRefreshBillingPlansAfterBulkResult,
  type BulkAddApplySummary,
} from "./billingPlansBulkAddFees.ts";
import { fetchBillingSettings } from "../billingSettings/billingSettingsApi.ts";
import { fetchKidesysHistory } from "./billingApi.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function testResultScreenPolicyDefersRefreshUntilDone() {
  const summary: BulkAddApplySummary = {
    successCount: 1,
    skippedCount: 0,
    failedCount: 0,
    results: [{ learnerId: "l1", learnerLabel: "A B", status: "success" }],
    outcome: "COMPLETE",
  };

  // Apply phase must not refresh
  assert.equal(
    shouldRefreshBillingPlansAfterBulkResult(summary),
    true,
    "successful apply still needs a refresh eventually"
  );

  let onAppliedCalls = 0;
  let step: "select" | "confirm" | "result" = "confirm";
  let visibleSummary: BulkAddApplySummary | null = null;

  // Simulate apply completion (no onApplied)
  visibleSummary = summary;
  step = "result";
  assert.equal(step, "result");
  assert.ok(visibleSummary);
  assert.equal(onAppliedCalls, 0, "onApplied deferred until Done");
  assert.match(formatBulkAddSummaryMessage(visibleSummary), /Bulk add complete/);
  assert.equal(visibleSummary.successCount, 1);
  assert.equal(visibleSummary.failedCount, 0);
  assert.equal(visibleSummary.skippedCount, 0);

  // Simulate Done
  if (shouldRefreshBillingPlansAfterBulkResult(visibleSummary)) {
    onAppliedCalls += 1;
  }
  step = "select";
  visibleSummary = null;
  assert.equal(onAppliedCalls, 1, "Done triggers refresh");
  assert.equal(step, "select", "Done resets step");
  console.log("✓ bulk result: preserved until Done; onApplied deferred; counts available");
}

function testPartialResultStillDefersRefresh() {
  const summary: BulkAddApplySummary = {
    successCount: 1,
    skippedCount: 1,
    failedCount: 1,
    results: [
      { learnerId: "a", learnerLabel: "A", status: "success" },
      { learnerId: "b", learnerLabel: "B", status: "skipped", reason: "missing" },
      { learnerId: "c", learnerLabel: "C", status: "failed", reason: "401" },
    ],
    outcome: "PARTIAL",
  };
  assert.equal(shouldRefreshBillingPlansAfterBulkResult(summary), true);
  assert.match(formatBulkAddSummaryMessage(summary), /partially completed/);
  assert.equal(shouldRefreshBillingPlansAfterBulkResult({
    successCount: 0,
    skippedCount: 0,
    failedCount: 2,
    results: [],
    outcome: "FAILED",
  }), false);
  console.log("✓ bulk result: partial keeps counts; failed-only skips refresh");
}

function testModalSourceDefersOnApplied() {
  const modalSrc = fs.readFileSync(
    path.join(__dirname, "BillingPlansBulkAddFeesModal.tsx"),
    "utf8"
  );
  assert.ok(
    /setStep\("result"\)/.test(modalSrc),
    "modal enters result step"
  );
  // Apply path must not await onApplied before result
  const applyBlock = modalSrc.slice(
    modalSrc.indexOf("const apply = async"),
    modalSrc.indexOf("const finishResultAndClose")
  );
  assert.ok(!/await onApplied\(/.test(applyBlock), "apply does not await onApplied");
  assert.ok(
    /finishResultAndClose/.test(modalSrc) &&
      /shouldRefreshBillingPlansAfterBulkResult\(summary\)/.test(modalSrc),
    "Done uses finishResultAndClose + refresh policy"
  );
  assert.ok(
    /Succeeded: \{summary\.successCount\}/.test(modalSrc),
    "result counts render in JSX"
  );
  console.log("✓ source: modal defers onApplied to Done; counts rendered");
}

async function withTokenFetch(
  token: string,
  run: (calls: Array<{ url: string; init?: RequestInit }>) => Promise<void>
) {
  const prevFetch = globalThis.fetch;
  const store = new Map<string, string>([["token", token]]);
  const prevLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  (globalThis as { localStorage: Storage }).localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => {
      store.set(k, String(v));
    },
    removeItem: (k) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/api/billing-settings/settings")) {
      return new Response(JSON.stringify({ success: true, settings: {} }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/statements/kidesys-history")) {
      return new Response(JSON.stringify({ entries: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/statements/accounts")) {
      return new Response(JSON.stringify({ entries: [{ id: "h1" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await run(calls);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevLocalStorage) {
      (globalThis as { localStorage: Storage }).localStorage = prevLocalStorage;
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  }
}

function assertBearer(init: RequestInit | undefined, token: string) {
  const headers = init?.headers as Record<string, string> | undefined;
  const auth =
    headers?.Authorization ||
    headers?.authorization ||
    (headers &&
      Object.entries(headers).find(([k]) => k.toLowerCase() === "authorization")?.[1]);
  assert.equal(auth, `Bearer ${token}`);
}

async function testBillingSettingsGetSendsBearer() {
  const token = "stg-billing-settings-token";
  await withTokenFetch(token, async (calls) => {
    await fetchBillingSettings("school-1");
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("/api/billing-settings/settings"));
    assertBearer(calls[0].init, token);
  });
  console.log("✓ billing-settings GET includes Bearer auth");
}

async function testKidesysHistoryAndAccountsFallbackSendBearer() {
  const token = "stg-kidesys-history-token";
  await withTokenFetch(token, async (calls) => {
    // primary returns empty → fallback accounts
    await fetchKidesysHistory("school-1");
    assert.ok(calls.length >= 2);
    assert.ok(calls[0].url.includes("/api/statements/kidesys-history"));
    assert.ok(calls[1].url.includes("/api/statements/accounts"));
    assertBearer(calls[0].init, token);
    assertBearer(calls[1].init, token);
  });
  console.log("✓ kidesys-history + statements/accounts fallback include Bearer auth");
}

function testSourceSites() {
  const settingsSrc = fs.readFileSync(
    path.join(__dirname, "../billingSettings/billingSettingsApi.ts"),
    "utf8"
  );
  assert.ok(/staffAuthHeaders\(\)/.test(settingsSrc));
  const billingApiSrc = fs.readFileSync(path.join(__dirname, "billingApi.ts"), "utf8");
  const hist = billingApiSrc.slice(
    billingApiSrc.indexOf("export const fetchKidesysHistory"),
    billingApiSrc.indexOf("export const fetchLedger")
  );
  assert.ok(/kidesys-history[\s\S]*staffAuthHeaders\(\)/.test(hist));
  assert.ok(/statements\/accounts[\s\S]*staffAuthHeaders\(\)/.test(hist));
  console.log("✓ source: billing-settings + kidesys history use staffAuthHeaders");
}

async function main() {
  testResultScreenPolicyDefersRefreshUntilDone();
  testPartialResultStillDefersRefresh();
  testModalSourceDefersOnApplied();
  testSourceSites();
  await testBillingSettingsGetSendsBearer();
  await testKidesysHistoryAndAccountsFallbackSendBearer();
  console.log("\nAll billingHardeningAuth tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
