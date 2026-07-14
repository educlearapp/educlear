#!/usr/bin/env node
/**
 * Invoice Run UI browser performance measurement — local Da Silva data, read-only.
 * Usage:
 *   node frontend/scripts/invoice-run-ui-performance-browser.mjs
 *   FRONTEND_URL=http://localhost:4173 node frontend/scripts/invoice-run-ui-performance-browser.mjs
 *
 * Blocks execute/undo writes. Captures API traffic, duplicates, and user-visible timings.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const API = String(process.env.API_URL || "http://localhost:3000").trim();
const FRONTEND = String(process.env.FRONTEND_URL || "http://localhost:5173").trim();
const API_HOSTS = [...new Set([API, API.replace("localhost", "127.0.0.1"), API.replace("127.0.0.1", "localhost")])];
const MODE = String(process.env.PERF_MODE || "dev").trim();
const PHASE = String(process.env.PERF_PHASE || "before").trim();
const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";
const LEDGER = join(repoRoot, "backend/data/billing-ledger.json");
const OUT_DIR = join(repoRoot, "backend/storage/invoice-run-ui-performance");

const BLOCKED_WRITE_RE =
  /\/api\/(invoice-runs\/execute|invoice-runs\/[^/]+\/undo|payments\b|billing-transactions\/)/i;

function ledgerHash() {
  return createHash("sha256").update(readFileSync(LEDGER)).digest("hex");
}

function classifyUrl(url) {
  const u = String(url || "");
  if (u.includes("/api/invoices/ledger")) return "ledger";
  if (u.includes("/api/statements")) return "statements";
  if (u.includes("/api/invoice-runs/preview")) return "preview";
  if (u.includes("/api/invoice-runs?")) return "invoice-runs-list";
  if (u.includes("/api/invoices?") || u.includes("/api/invoices&")) return "invoices";
  if (u.includes("/api/payments")) return "payments";
  if (u.includes("/api/billing-settings")) return "billing-settings";
  if (u.includes("/api/learners")) return "learners";
  if (u.includes("/api/billing-plans")) return "billing-plans";
  return "other";
}

async function waitForStepTitle(page, title, timeoutMs = 20000) {
  const t0 = performance.now();
  await page.getByText(title, { exact: true }).first().waitFor({ state: "visible", timeout: timeoutMs });
  return performance.now() - t0;
}

async function waitForInvoiceRunsList(page, timeoutMs = 20000) {
  const t0 = performance.now();
  await page.getByRole("button", { name: "+ Add", exact: true }).waitFor({ state: "visible", timeout: timeoutMs });
  return performance.now() - t0;
}

async function clickNext(page) {
  const btn = page.getByRole("button", { name: "Next ➜" });
  await btn.waitFor({ state: "visible", timeout: 30000 });
  await page.waitForFunction(
    () => {
      const el = [...document.querySelectorAll("button")].find((b) =>
        (b.textContent || "").includes("Next")
      );
      return el && !el.disabled;
    },
    { timeout: 120000 }
  );
  await btn.click({ timeout: 15000 });
}

async function clickPrevious(page) {
  await page.getByRole("button", { name: "← Previous" }).click({ timeout: 15000 });
}

async function openInvoiceRunsFresh(page) {
  await page.goto(`${FRONTEND}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const billingMenu = page.locator(".menu-item").filter({ hasText: /^Billing$/ });
  if (await billingMenu.isVisible().catch(() => false)) {
    await billingMenu.click();
    await page.waitForTimeout(200);
  }
  await page.getByText("Invoice Runs", { exact: true }).click({ timeout: 30000 });
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const ledgerBefore = ledgerHash();

  const apiLog = [];
  const seenKeys = new Map();
  const timings = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const BILLING_API_RE =
    /\/api\/(invoices|payments|statements|invoice-runs|billing-settings|billing-plans|learners)/i;

  for (const apiHost of API_HOSTS) {
    await page.route(`${apiHost}/**`, billingRouteHandler);
  }

  async function billingRouteHandler(route) {
    const req = route.request();
    const method = req.method().toUpperCase();
    const url = req.url();
    if (!BILLING_API_RE.test(url)) {
      return route.continue();
    }
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      if (BLOCKED_WRITE_RE.test(url) || (method === "POST" && url.includes("/api/invoice-runs/execute"))) {
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ success: false, error: "Blocked by performance script (read-only)" }),
        });
      }
    }
    const started = performance.now();
    let response;
    try {
      response = await route.fetch();
    } catch (err) {
      return route.abort(String(err));
    }
    const ended = performance.now();
    let bytes = 0;
    try {
      const body = await response.body();
      bytes = body.length;
    } catch {
      bytes = Number(response.headers()["content-length"] || 0);
    }
    const kind = classifyUrl(url);
    const key = `${method}:${kind}`;
    const prior = seenKeys.get(key) || 0;
    seenKeys.set(key, prior + 1);
    apiLog.push({
      method,
      kind,
      url,
      ms: +(ended - started).toFixed(1),
      bytes,
      status: response.status(),
      duplicate: prior > 0,
      atMs: +ended.toFixed(1),
    });
    return route.fulfill({ response });
  }

  await page.addInitScript((sid) => {
    localStorage.setItem("token", "local-invoice-run-ui-perf");
    localStorage.setItem("schoolId", sid);
    localStorage.setItem("userEmail", "dasilvaacademy@gmail.com");
    localStorage.setItem("userAppRole", "Owner");
    sessionStorage.setItem(
      "educlearSchoolSubscriptionStatus",
      JSON.stringify({
        schoolId: sid,
        status: { dashboardUnlocked: true, isActive: true, subscription: { status: "ACTIVE" } },
        savedAt: Date.now(),
      })
    );
  }, DA_SILVA);

  const record = async (action, run) => {
    const sliceStart = apiLog.length;
    const wallStart = performance.now();
    const detail = await run();
    const wallMs = +(performance.now() - wallStart).toFixed(1);
    const slice = apiLog.slice(sliceStart);
    const entry = {
      action,
      userVisibleMs: wallMs,
      stepWaitMs: detail?.stepWaitMs != null ? +detail.stepWaitMs.toFixed(1) : undefined,
      previewReadyMs:
        detail?.previewReadyMs != null ? +detail.previewReadyMs.toFixed(1) : undefined,
      requests: slice.map((r) => ({
        kind: r.kind,
        method: r.method,
        ms: r.ms,
        bytes: r.bytes,
        duplicate: r.duplicate,
        status: r.status,
      })),
      ledgerFetches: slice.filter((r) => r.kind === "ledger").length,
      statementsFetches: slice.filter((r) => r.kind === "statements").length,
      previewFetches: slice.filter((r) => r.kind === "preview").length,
      invoicesFetches: slice.filter((r) => r.kind === "invoices").length,
      paymentsFetches: slice.filter((r) => r.kind === "payments").length,
      duplicateKinds: [...new Set(slice.filter((r) => r.duplicate).map((r) => r.kind))],
      falseR0Balances: detail?.falseR0Balances || false,
    };
    timings.push(entry);
    console.log(
      `${action}: ${wallMs}ms | ledger=${entry.ledgerFetches} stmt=${entry.statementsFetches} preview=${entry.previewFetches} inv=${entry.invoicesFetches} pay=${entry.paymentsFetches} dup=${entry.duplicateKinds.join(",") || "none"}`
    );
    return entry;
  };

  // 1. Open Invoice Runs from sidebar (fresh navigation)
  await record("1-open-invoice-runs", async () => {
    const stepWaitMs = await (async () => {
      await openInvoiceRunsFresh(page);
      return waitForInvoiceRunsList(page);
    })();
    return { stepWaitMs };
  });

  // 2. Open wizard (+ Add)
  await record("2-open-wizard-add", async () => {
    const t0 = performance.now();
    await page.getByRole("button", { name: "+ Add", exact: true }).click({ timeout: 15000 });
    const stepWaitMs = await waitForStepTitle(page, "Start");
    return { stepWaitMs: performance.now() - t0 };
  });

  // 3. Step 1 → Step 2 (Start → Settings)
  await record("3-start-to-settings", async () => {
    const t0 = performance.now();
    await clickNext(page);
    const stepWaitMs = await waitForStepTitle(page, "Settings");
    return { stepWaitMs: performance.now() - t0 };
  });

  // 4. Step 2 → Step 3 (Settings → Children)
  await record("4-settings-to-children", async () => {
    const t0 = performance.now();
    await clickNext(page);
    const stepWaitMs = await waitForStepTitle(page, "Children");
    const body = await page.locator("body").innerText();
    const falseR0Balances = /\bR\s*0\.00\b/.test(body) && /Pending|Loading/i.test(body) === false;
    return { stepWaitMs: performance.now() - t0, falseR0Balances };
  });

  // 5. Children → Fees
  await record("5-children-to-fees", async () => {
    const t0 = performance.now();
    await clickNext(page);
    const stepWaitMs = await waitForStepTitle(page, "Fees");
    return { stepWaitMs: performance.now() - t0 };
  });

  // 6. Fees → Preview
  await record("6-fees-to-preview", async () => {
    const t0 = performance.now();
    await clickNext(page);
    const stepWaitMs = await waitForStepTitle(page, "Preview");
    const stepOpenMs = performance.now() - t0;
    const previewWaitStart = performance.now();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const previewDone = apiLog.some((r) => r.kind === "preview" && r.status === 200);
      if (previewDone) break;
      await page.waitForTimeout(100);
    }
    const previewReadyMs = performance.now() - previewWaitStart;
    return { stepWaitMs: stepOpenMs, previewReadyMs: +previewReadyMs.toFixed(1) };
  });

  // 7. Preview → Create
  await record("7-preview-to-create", async () => {
    const t0 = performance.now();
    await clickNext(page);
    const stepWaitMs = await waitForStepTitle(page, "Create Invoices");
    return { stepWaitMs: performance.now() - t0 };
  });

  // 8. Backwards: Create → Preview
  await record("8-back-create-to-preview", async () => {
    const t0 = performance.now();
    await clickPrevious(page);
    const stepWaitMs = await waitForStepTitle(page, "Preview");
    return { stepWaitMs: performance.now() - t0 };
  });

  // 9. Back: Preview → Fees
  await record("9-back-preview-to-fees", async () => {
    const t0 = performance.now();
    await clickPrevious(page);
    const stepWaitMs = await waitForStepTitle(page, "Fees");
    return { stepWaitMs: performance.now() - t0 };
  });

  // 10. Back: Fees → Children
  await record("10-back-fees-to-children", async () => {
    const t0 = performance.now();
    await clickPrevious(page);
    const stepWaitMs = await waitForStepTitle(page, "Children");
    return { stepWaitMs: performance.now() - t0 };
  });

  // 11. Back: Children → Settings
  await record("11-back-children-to-settings", async () => {
    const t0 = performance.now();
    await clickPrevious(page);
    const stepWaitMs = await waitForStepTitle(page, "Settings");
    return { stepWaitMs: performance.now() - t0 };
  });

  // 12. Back: Settings → Start
  await record("12-back-settings-to-start", async () => {
    const t0 = performance.now();
    await clickPrevious(page);
    const stepWaitMs = await waitForStepTitle(page, "Start", 30000);
    return { stepWaitMs: performance.now() - t0 };
  });

  // 13. Revisit Settings (already loaded)
  await record("13-revisit-settings", async () => {
    const t0 = performance.now();
    await clickNext(page);
    const stepWaitMs = await waitForStepTitle(page, "Settings");
    return { stepWaitMs: performance.now() - t0 };
  });

  // 14. Revisit Children
  await record("14-revisit-children", async () => {
    const t0 = performance.now();
    await clickNext(page);
    const stepWaitMs = await waitForStepTitle(page, "Children");
    return { stepWaitMs: performance.now() - t0 };
  });

  // 15. Revisit Preview (forward through fees)
  await record("15-revisit-preview", async () => {
    const t0 = performance.now();
    await clickNext(page);
    await waitForStepTitle(page, "Fees");
    await clickNext(page);
    const stepWaitMs = await waitForStepTitle(page, "Preview");
    return { stepWaitMs: performance.now() - t0 };
  });

  const ledgerAfter = ledgerHash();
  await browser.close();

  const payload = {
    generatedAt: new Date().toISOString(),
    phase: PHASE,
    mode: MODE,
    frontendUrl: FRONTEND,
    apiUrl: API,
    schoolId: DA_SILVA,
    ledgerHashBefore: ledgerBefore,
    ledgerHashAfter: ledgerAfter,
    ledgerUnchanged: ledgerBefore === ledgerAfter,
    timings,
    apiLog,
    summary: {
      maxUserVisibleMs: Math.max(...timings.map((t) => t.userVisibleMs)),
      totalLedgerFetches: apiLog.filter((r) => r.kind === "ledger").length,
      totalPreviewFetches: apiLog.filter((r) => r.kind === "preview").length,
      totalStatementsFetches: apiLog.filter((r) => r.kind === "statements").length,
      duplicateRequestKinds: [...new Set(apiLog.filter((r) => r.duplicate).map((r) => r.kind))],
      under2s: timings.filter((t) => t.userVisibleMs < 2000).length,
      over2s: timings.filter((t) => t.userVisibleMs >= 2000).map((t) => t.action),
      revisitUnder500ms: timings
        .filter((t) => t.action.startsWith("13-") || t.action.startsWith("14-") || t.action.startsWith("15-"))
        .every((t) => t.userVisibleMs < 500),
    },
  };

  const outFile = join(OUT_DIR, `${PHASE}-${MODE}-2026-07-14.json`);
  writeFileSync(outFile, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${outFile}`);
  console.log(`Ledger unchanged: ${payload.ledgerUnchanged}`);
  console.log(`Total ledger fetches: ${payload.summary.totalLedgerFetches}`);
  console.log(`Over 2s: ${payload.summary.over2s.join(", ") || "none"}`);
  console.log(`Under 2s count: ${payload.summary.under2s}/${timings.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
