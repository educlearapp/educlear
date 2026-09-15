/**
 * Statements/invoices/ledger billing GET auth headers.
 * Run: npx tsx src/billing/billingStatementsAuth.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clearBillingDisplayCacheForSchoolSwitch,
  fetchStatementsWithStatus,
  getBillingStatementSyncState,
  syncStatementSummariesFromApi,
} from "./billingApi.ts";
import { readStatementApiAccounts } from "./kidesysTransactionHistory.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const billingApiSrc = fs.readFileSync(path.join(__dirname, "billingApi.ts"), "utf8");

function extractFn(src: string, name: string): string {
  const start = src.indexOf(`export const ${name}`) >= 0
    ? src.indexOf(`export const ${name}`)
    : src.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} export present`);
  const nextExport = src.indexOf("\nexport ", start + 10);
  return nextExport >= 0 ? src.slice(start, nextExport) : src.slice(start);
}

function testSourceCallSitesSendStaffAuth() {
  const statementsWithStatus = extractFn(billingApiSrc, "fetchStatementsWithStatus");
  assert.ok(
    /getJson\(\s*url\s*,\s*staffAuthHeaders\(\)\s*\)/.test(statementsWithStatus),
    "fetchStatementsWithStatus passes staffAuthHeaders to getJson"
  );

  const fetchStatements = extractFn(billingApiSrc, "fetchStatements");
  assert.ok(
    /\/api\/statements\?schoolId=/.test(fetchStatements),
    "fetchStatements hits /api/statements"
  );
  assert.ok(
    /staffAuthHeaders\(\)/.test(fetchStatements),
    "fetchStatements passes staffAuthHeaders"
  );

  const fetchInvoices = extractFn(billingApiSrc, "fetchInvoices");
  assert.ok(
    /\/api\/invoices\?schoolId=/.test(fetchInvoices),
    "fetchInvoices hits /api/invoices"
  );
  assert.ok(
    /staffAuthHeaders\(\)/.test(fetchInvoices),
    "fetchInvoices passes staffAuthHeaders"
  );

  assert.ok(
    /getJson\(\s*ledgerUrl\s*,\s*staffAuthHeaders\(\)\s*\)/.test(billingApiSrc),
    "ledger GET passes staffAuthHeaders to getJson"
  );
  console.log("✓ source: statements/invoices/ledger GETs send staffAuthHeaders");
}

async function testStatementsSyncSendsAuthorizationAndCachesRows() {
  const schoolId = "cmu-test-statements-auth";
  const token = "staging-test-token";
  const prevFetch = globalThis.fetch;
  const store = new Map<string, string>();
  const prevLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;

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

  store.set("token", token);
  clearBillingDisplayCacheForSchoolSwitch(schoolId);

  let sawAuth = false;
  let sawStatementsUrl = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers || {});
    if (url.includes("/api/statements?")) {
      sawStatementsUrl = true;
      sawAuth = headers.get("Authorization") === `Bearer ${token}`;
      return new Response(
        JSON.stringify({
          success: true,
          statements: [
            {
              accountNo: "SYN001",
              balance: 1250,
              status: "Recently Owing",
            },
          ],
          accounts: [
            {
              accountNo: "SYN001",
              balance: 1250,
              status: "Recently Owing",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ success: false, error: "unexpected url" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const status = await fetchStatementsWithStatus(schoolId);
    assert.equal(status.ok, true);
    assert.equal(status.rows.length, 1);
    assert.equal(status.rows[0].accountNo, "SYN001");
    assert.ok(sawStatementsUrl, "statements GET was called");
    assert.ok(sawAuth, "Authorization Bearer token sent on statements GET");

    const sync = await syncStatementSummariesFromApi(schoolId);
    assert.equal(sync.ok, true);
    assert.equal(sync.count, 1);
    assert.equal(readStatementApiAccounts(schoolId).length, 1);
    const syncState = getBillingStatementSyncState(schoolId);
    assert.equal(syncState.syncFailed, false);
    assert.equal(syncState.confirmedEmpty, false);
    console.log("✓ runtime: authenticated statements sync caches rows (not empty/401 path)");
  } finally {
    globalThis.fetch = prevFetch;
    if (prevLocalStorage) {
      (globalThis as { localStorage: Storage }).localStorage = prevLocalStorage;
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
    clearBillingDisplayCacheForSchoolSwitch(schoolId);
  }
}

async function testUnauthenticatedStatementsDoesNotTreat401AsConfirmedEmpty() {
  const schoolId = "cmu-test-statements-401";
  const prevFetch = globalThis.fetch;
  const store = new Map<string, string>();
  const prevLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;

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
  // No token — staffAuthHeaders() returns {}
  clearBillingDisplayCacheForSchoolSwitch(schoolId);

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        success: false,
        error: "Authentication required",
        code: "AUTH_REQUIRED",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    )) as typeof fetch;

  try {
    const sync = await syncStatementSummariesFromApi(schoolId);
    assert.equal(sync.ok, false);
    assert.equal(readStatementApiAccounts(schoolId).length, 0);
    const syncState = getBillingStatementSyncState(schoolId);
    assert.equal(syncState.syncFailed, true);
    assert.equal(syncState.confirmedEmpty, false);
    console.log("✓ runtime: 401 is syncFailed, not confirmedEmpty wipe");
  } finally {
    globalThis.fetch = prevFetch;
    if (prevLocalStorage) {
      (globalThis as { localStorage: Storage }).localStorage = prevLocalStorage;
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
    clearBillingDisplayCacheForSchoolSwitch(schoolId);
  }
}

async function main() {
  testSourceCallSitesSendStaffAuth();
  await testStatementsSyncSendsAuthorizationAndCachesRows();
  await testUnauthenticatedStatementsDoesNotTreat401AsConfirmedEmpty();
  console.log("\nbillingStatementsAuth.test.ts: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
