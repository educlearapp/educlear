/**
 * Phase 2 auth-only stabilisation — statement email/PDF/transactions + communication engine.
 * Run: npx tsx src/billing/phase2AuthStabilisation.test.ts
 */
import assert from "node:assert/strict";
import {
  fetchSchoolStatementPdfBlob,
  sendStatementEmail,
} from "./statementDocument.ts";
import { fetchStatementAccountTransactions } from "./billingApi.ts";
import {
  fetchEngineMessages,
  retryEngineMessage,
} from "../communication/communicationEngineApi.ts";

const TOKEN = "phase2-auth-stabilisation-token";

function authHeader(init?: RequestInit): string {
  const h = init?.headers;
  if (!h) return "";
  if (h instanceof Headers) return String(h.get("Authorization") || "");
  if (Array.isArray(h)) {
    const hit = h.find(([k]) => k.toLowerCase() === "authorization");
    return hit ? String(hit[1]) : "";
  }
  const rec = h as Record<string, string>;
  return String(rec.Authorization || rec.authorization || "");
}

async function withTokenFetch(
  run: (calls: Array<{ url: string; init?: RequestInit }>) => Promise<void>
) {
  const prevFetch = globalThis.fetch;
  const store = new Map<string, string>([["token", TOKEN]]);
  const prevLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const g = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
  const prevWindow = g.window;
  if (!g.window) {
    g.window = {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    } as Window & typeof globalThis;
  }

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
    if (url.includes("/api/statements/pdf")) {
      return new Response("%PDF-1.4 phase2-auth-test", {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      });
    }
    return new Response(
      JSON.stringify({
        success: true,
        messageId: "msg-1",
        transactions: [],
        items: [],
        total: 0,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
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
    if (!prevWindow) delete g.window;
    else g.window = prevWindow;
  }
}

async function testSendStatementEmailBearer() {
  await withTokenFetch(async (calls) => {
    await sendStatementEmail({
      schoolId: "school-1",
      to: "parent@example.com",
      subject: "Statement",
      html: "<p>x</p>",
      learnerId: "learner-1",
      accountNo: "ACC001",
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/emails\/send-statement/);
    assert.equal(calls[0].init?.method, "POST");
    assert.equal(authHeader(calls[0].init), `Bearer ${TOKEN}`);
    const h = calls[0].init?.headers as Record<string, string>;
    assert.equal(h["Content-Type"], "application/json");
  });
  console.log("✓ sendStatementEmail sends Authorization Bearer");
}

async function testFetchSchoolStatementPdfBlobBearer() {
  await withTokenFetch(async (calls) => {
    const blob = await fetchSchoolStatementPdfBlob("school-1", "learner-1", "2026-10");
    assert.ok(blob instanceof Blob);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/statements\/pdf\?/);
    assert.equal(authHeader(calls[0].init), `Bearer ${TOKEN}`);
  });
  console.log("✓ fetchSchoolStatementPdfBlob sends Authorization Bearer");
}

async function testFetchStatementAccountTransactionsBearer() {
  await withTokenFetch(async (calls) => {
    await fetchStatementAccountTransactions("school-1", { accountNo: "ACC001" });
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/statements\/transactions\?/);
    assert.equal(authHeader(calls[0].init), `Bearer ${TOKEN}`);
  });
  console.log("✓ fetchStatementAccountTransactions sends Authorization Bearer");
}

async function testFetchEngineMessagesBearer() {
  await withTokenFetch(async (calls) => {
    await fetchEngineMessages("school-1");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/communication-engine\/messages\?/);
    assert.equal(authHeader(calls[0].init), `Bearer ${TOKEN}`);
    const h = calls[0].init?.headers as Record<string, string>;
    assert.equal(h["Content-Type"], "application/json");
  });
  console.log("✓ fetchEngineMessages sends Authorization Bearer");
}

async function testRetryEngineMessageBearer() {
  await withTokenFetch(async (calls) => {
    await retryEngineMessage("engine-msg-1");
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/communication-engine\/messages\/engine-msg-1\/retry/);
    assert.equal(calls[0].init?.method, "POST");
    assert.equal(authHeader(calls[0].init), `Bearer ${TOKEN}`);
    const h = calls[0].init?.headers as Record<string, string>;
    assert.equal(h["Content-Type"], "application/json");
  });
  console.log("✓ retryEngineMessage sends Authorization Bearer");
}

async function main() {
  await testSendStatementEmailBearer();
  await testFetchSchoolStatementPdfBlobBearer();
  await testFetchStatementAccountTransactionsBearer();
  await testFetchEngineMessagesBearer();
  await testRetryEngineMessageBearer();
  console.log("\nphase2AuthStabilisation: all tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
