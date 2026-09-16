/**
 * Phase 1 urgent auth repair — SMS / Email / Invoice Runs GET / registrations stats.
 * Also asserts frozen working billing/SMS paths were not rewired.
 * Run: npx tsx src/billing/phase1AuthRepair.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchSmsList, fetchCommunicationSettings } from "../communication/communicationApi.ts";
import {
  checkSchoolSmsCreditBalance,
  fetchSchoolSmsSettings,
} from "../communication/schoolSmsApi.ts";
import { fetchSchoolEmailSettings } from "../communication/schoolEmailApi.ts";
import { fetchEmails } from "../communication/communicationApi.ts";
import { fetchInvoiceRuns } from "./billingApi.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = "phase1-auth-repair-token";

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
    return new Response(
      JSON.stringify({
        success: true,
        sms: [],
        emails: [],
        smsCredits: 0,
        winSmsCredits: 0,
        emailBalance: 0,
        settings: {
          schoolId: "s1",
          provider: "WinSMS",
          apiKeySet: false,
          configured: false,
          connectionStatus: "not_configured",
          creditBalance: null,
          creditBalanceCheckedAt: null,
          connectionTestedAt: null,
          lastConnectionError: null,
          ready: false,
          sendViaEduClearDomain: true,
        },
        creditBalance: 0,
        runs: [],
        invoicePeriodCounts: {},
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as typeof fetch;

  try {
    await run(calls);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevWindow) g.window = prevWindow;
    else delete g.window;
    if (prevLocalStorage) {
      (globalThis as { localStorage?: Storage }).localStorage = prevLocalStorage;
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  }
}

function assertBearer(calls: Array<{ url: string; init?: RequestInit }>, urlPart: string, label: string) {
  const hit = calls.find((c) => c.url.includes(urlPart));
  assert.ok(hit, `${label}: request not made (${urlPart})`);
  assert.equal(authHeader(hit!.init), `Bearer ${TOKEN}`, `${label}: Bearer missing`);
}

async function testSmsEmailInvoiceStatsBearer() {
  await withTokenFetch(async (calls) => {
    await fetchSmsList("s1");
    await fetchCommunicationSettings("s1");
    await checkSchoolSmsCreditBalance("s1");
    await fetchSchoolSmsSettings("s1");
    await fetchEmails("s1");
    await fetchSchoolEmailSettings("s1");
    await fetchInvoiceRuns("s1");

    assertBearer(calls, "/api/communication/sms?", "SMS history");
    assertBearer(calls, "/api/communication/settings?", "SMS/Email communication settings");
    assertBearer(calls, "/api/school-sms-settings/balance?", "SMS balance");
    assertBearer(calls, "/api/school-sms-settings/?", "SMS settings");
    assertBearer(calls, "/api/communication/emails?", "Email history");
    assertBearer(calls, "/api/school-email-settings/?", "Email settings");
    assertBearer(calls, "/api/invoice-runs?", "Invoice Runs GET");
  });
  console.log("✓ runtime: SMS/Email/InvoiceRuns GET include Bearer");
}

function testSourceAuthWiring() {
  const comm = fs.readFileSync(
    path.join(__dirname, "../communication/communicationApi.ts"),
    "utf8"
  );
  const sms = fs.readFileSync(path.join(__dirname, "../communication/schoolSmsApi.ts"), "utf8");
  const email = fs.readFileSync(
    path.join(__dirname, "../communication/schoolEmailApi.ts"),
    "utf8"
  );
  const billing = fs.readFileSync(path.join(__dirname, "billingApi.ts"), "utf8");
  const dash = fs.readFileSync(path.join(__dirname, "../SchoolDashboard.tsx"), "utf8");
  const statementSms = fs.readFileSync(path.join(__dirname, "statementSmsApi.ts"), "utf8");
  const bulkSms = fs.readFileSync(path.join(__dirname, "statementBulkSmsApi.ts"), "utf8");

  assert.ok(/staffAuthHeaders\(\)/.test(comm), "communicationApi uses staffAuthHeaders");
  assert.ok(
    /headers:\s*\{[\s\S]*Content-Type[\s\S]*staffAuthHeaders\(\)[\s\S]*\.\.\.\(options\.headers/.test(
      comm
    ),
    "communicationApi merges Content-Type + staffAuth + options.headers"
  );
  assert.ok(/staffAuthHeaders\(\)/.test(sms), "schoolSmsApi uses staffAuthHeaders");
  assert.ok(/staffAuthHeaders\(\)/.test(email), "schoolEmailApi uses staffAuthHeaders");

  const fetchRuns = billing.slice(
    billing.indexOf("export async function fetchInvoiceRuns"),
    billing.indexOf("async function postInvoiceRunEndpoint")
  );
  assert.ok(
    /getJson\(\s*url\s*,\s*staffAuthHeaders\(\)\s*\)/.test(fetchRuns),
    "fetchInvoiceRuns passes staffAuthHeaders"
  );
  assert.ok(
    /async function postInvoiceRunEndpoint[\s\S]*staffAuthHeaders\(\)/.test(billing),
    "invoice-run POST auth unchanged"
  );

  assert.ok(
    /registrations\/stats[\s\S]{0,120}staffAuthHeaders\(\)/.test(dash),
    "registrations/stats uses staffAuthHeaders"
  );

  // Frozen: statement SMS must remain on its own authenticated API, not communication helper
  assert.ok(
    /staffAuthHeaders\(\)/.test(statementSms),
    "statementSmsApi still uses staffAuthHeaders"
  );
  assert.ok(
    !/from ["'].*communicationApi/.test(statementSms),
    "statementSmsApi not rewired to communicationApi"
  );
  assert.ok(
    /staffAuthHeaders\(\)/.test(bulkSms),
    "statementBulkSmsApi still uses staffAuthHeaders"
  );
  assert.ok(
    !/from ["'].*communicationApi/.test(bulkSms),
    "statementBulkSmsApi not rewired to communicationApi"
  );

  // Untouched Phase-2 items still omit auth in this commit (document, do not "fix")
  assert.ok(
    /headers:\s*\{\s*"Content-Type":\s*"application\/json"\s*\}/.test(
      billing.slice(
        billing.indexOf("export const undoBillingTransaction"),
        billing.indexOf("export const undoBillingTransaction") + 800
      )
    ),
    "undo billing still untouched in Phase 1"
  );

  console.log("✓ source: Phase 1 auth wiring; statement SMS path frozen; Phase 2 left alone");
}

async function main() {
  testSourceAuthWiring();
  await testSmsEmailInvoiceStatsBearer();
  console.log("\nAll phase1AuthRepair tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
