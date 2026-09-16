/**
 * Invoice / invoice-run POST auth headers.
 * Run: npx tsx src/billing/billingInvoiceAuth.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createInvoice,
  createInvoicesBatch,
  previewInvoiceRun,
  executeInvoiceRun,
} from "./billingApi.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const billingApiSrc = fs.readFileSync(path.join(__dirname, "billingApi.ts"), "utf8");

function extractFn(src: string, name: string): string {
  const start =
    src.indexOf(`export const ${name}`) >= 0
      ? src.indexOf(`export const ${name}`)
      : src.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `${name} export present`);
  const nextExport = src.indexOf("\nexport ", start + 10);
  return nextExport >= 0 ? src.slice(start, nextExport) : src.slice(start);
}

function testSourceCreatesSendStaffAuth() {
  const createInvoiceSrc = extractFn(billingApiSrc, "createInvoice");
  assert.ok(
    /staffAuthHeaders\(\)/.test(createInvoiceSrc),
    "createInvoice passes staffAuthHeaders"
  );

  const createBatchSrc = extractFn(billingApiSrc, "createInvoicesBatch");
  assert.ok(
    /staffAuthHeaders\(\)/.test(createBatchSrc),
    "createInvoicesBatch passes staffAuthHeaders"
  );

  assert.ok(
    /async function postInvoiceRunEndpoint[\s\S]*staffAuthHeaders\(\)/.test(billingApiSrc),
    "postInvoiceRunEndpoint includes staffAuthHeaders"
  );
  console.log("✓ source: invoice create/batch and invoice-run POSTs send staffAuthHeaders");
}

async function withAuthFetch(
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
    return new Response(JSON.stringify({ success: true, createdCount: 1, invoices: [{}] }), {
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
  assert.equal(auth, `Bearer ${token}`, "Authorization Bearer header present");
}

async function testCreateInvoiceSendsBearer() {
  const token = "test-invoice-auth-token";
  await withAuthFetch(token, async (calls) => {
    await createInvoice({ schoolId: "sch-1", amount: 10 });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("/api/invoices"));
    assert.equal(calls[0].init?.method, "POST");
    assertBearer(calls[0].init, token);
  });
  console.log("✓ runtime: createInvoice POST includes Bearer auth");
}

async function testCreateInvoicesBatchSendsBearer() {
  const token = "test-invoice-batch-auth-token";
  await withAuthFetch(token, async (calls) => {
    await createInvoicesBatch({
      schoolId: "sch-1",
      invoices: [{ accountNo: "A1", amount: 10 }],
    });
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.includes("/api/invoices/batch"));
    assert.equal(calls[0].init?.method, "POST");
    assertBearer(calls[0].init, token);
  });
  console.log("✓ runtime: createInvoicesBatch POST includes Bearer auth");
}

async function testInvoiceRunPostsSendBearer() {
  const token = "test-invoice-run-auth-token";
  await withAuthFetch(token, async (calls) => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await previewInvoiceRun({
      schoolId: "sch-1",
      runId: "run-1",
      invoicePeriod: "2026-09",
      invoiceDate: "2026-09-01",
    });
    await executeInvoiceRun({
      schoolId: "sch-1",
      runId: "run-1",
      invoicePeriod: "2026-09",
      invoiceDate: "2026-09-01",
    });

    assert.equal(calls.length, 2);
    assert.ok(calls[0].url.includes("/api/invoice-runs/preview"));
    assert.ok(calls[1].url.includes("/api/invoice-runs/execute"));
    assertBearer(calls[0].init, token);
    assertBearer(calls[1].init, token);
  });
  console.log("✓ runtime: invoice-run preview/execute POSTs include Bearer auth");
}

async function main() {
  testSourceCreatesSendStaffAuth();
  await testCreateInvoiceSendsBearer();
  await testCreateInvoicesBatchSendsBearer();
  await testInvoiceRunPostsSendBearer();
  console.log("\nAll billingInvoiceAuth tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
