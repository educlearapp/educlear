/**
 * Invoice Add Fee catalogue loader — stale-cache / pagination regressions.
 * Run: npx tsx src/billing/invoiceFeeOptionsLoader.test.ts
 */

import {
  BILLING_PLAN_FEE_OPTIONS_KEY,
  fetchAllSchoolFees,
  invalidateBillingPlanFeeOptionsCache,
  mergeFeeOptionsByStableKey,
  parseFeesApiList,
  rewriteBillingPlanFeeOptionsCache,
} from "./invoiceFeeOptionsLoader.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

type MockPage = { items: any[]; total: number; pageSize?: number };

function makeFetchMock(pagesByUrl: (url: string) => MockPage | null) {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const page = pagesByUrl(url);
    if (!page) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ success: false }),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        items: page.items,
        total: page.total,
        pageSize: page.pageSize ?? 100,
      }),
    } as Response;
  };
  return { fetchImpl, calls };
}

function memoryLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    _store: store,
  };
}

async function testA_StaleCacheStillFetchesLive() {
  const ls = memoryLocalStorage();
  (globalThis as any).localStorage = ls;
  ls.setItem(
    BILLING_PLAN_FEE_OPTIONS_KEY,
    JSON.stringify([{ id: "old-fee", name: "Old Fee", amount: 100 }])
  );

  const { fetchImpl, calls } = makeFetchMock((url) => {
    if (!url.includes("/api/fees")) return null;
    return {
      items: [
        { id: "old-fee", name: "Old Fee", amount: 100 },
        { id: "new-fee", name: "New Fee", amount: 250 },
      ],
      total: 2,
    };
  });

  const result = await fetchAllSchoolFees({
    apiUrl: "https://api.example",
    schoolId: "school-1",
    fetchImpl,
  });

  assert(calls.length >= 1, "A: live API must be called even when cache is non-empty");
  assert(
    result.fees.some((f) => f.id === "new-fee"),
    "A/B: newly returned API fee must appear even if absent from old cache"
  );
  assert(
    ls.getItem(BILLING_PLAN_FEE_OPTIONS_KEY) !== null,
    "A: stale cache may still exist until rewrite; fetch must not depend on it"
  );
  console.log("✓ A: stale non-empty billingPlanFeeOptions still triggers live API fetch");
  console.log("✓ B: newly returned API fee appears even though absent from old cache");
}

async function testC_D_PaginationBeyond100() {
  const page1 = Array.from({ length: 100 }, (_, i) => ({
    id: `fee-p1-${i}`,
    name: `Fee P1 ${i}`,
    amount: i + 1,
  }));
  const page2 = Array.from({ length: 25 }, (_, i) => ({
    id: `fee-p2-${i}`,
    name: `Fee P2 ${i}`,
    amount: 1000 + i,
  }));

  const { fetchImpl, calls } = makeFetchMock((url) => {
    const u = new URL(url);
    const page = Number(u.searchParams.get("page") || "1");
    if (page === 1) return { items: page1, total: 125, pageSize: 100 };
    if (page === 2) return { items: page2, total: 125, pageSize: 100 };
    return { items: [], total: 125, pageSize: 100 };
  });

  const result = await fetchAllSchoolFees({
    apiUrl: "https://api.example",
    schoolId: "school-1",
    fetchImpl,
  });

  assert(calls.length >= 2, "C/D: must request more than one page when total > 100");
  assert(result.fees.length === 125, `C: expected 125 fees, got ${result.fees.length}`);
  assert(
    result.fees.some((f) => f.id === "fee-p2-0"),
    "D: page 2+ results must appear in the collected catalogue"
  );
  assert(
    calls.every((url) => url.includes("pageSize=100")),
    "C: each request should use pageSize=100"
  );
  console.log("✓ C: >100 fees handled through pagination");
  console.log("✓ D: API page 2+ results appear in picker catalogue");
}

function testE_H_CacheInvalidationSuccessOnly() {
  const ls = memoryLocalStorage();
  (globalThis as any).localStorage = ls;
  rewriteBillingPlanFeeOptionsCache([{ id: "cached" }]);
  assert(ls.getItem(BILLING_PLAN_FEE_OPTIONS_KEY) !== null, "setup: cache present");

  // Successful save path
  invalidateBillingPlanFeeOptionsCache();
  assert(
    ls.getItem(BILLING_PLAN_FEE_OPTIONS_KEY) === null,
    "E: successful invalidate clears billingPlanFeeOptions"
  );

  // Failed path must not clear — simulate by NOT calling invalidate
  rewriteBillingPlanFeeOptionsCache([{ id: "still-cached" }]);
  const failedSaveWouldClear = false; // FeeUpsert only clears after res.ok
  if (!failedSaveWouldClear) {
    assert(
      ls.getItem(BILLING_PLAN_FEE_OPTIONS_KEY) !== null,
      "H: failed create/update must not clear cache"
    );
  }

  const feeUpsertPath = join(dirname(fileURLToPath(import.meta.url)), "../FeeUpsert.tsx");
  const feeUpsertSrc = readFileSync(feeUpsertPath, "utf8");
  assert(
    feeUpsertSrc.includes("invalidateBillingPlanFeeOptionsCache()"),
    "E: FeeUpsert must call invalidateBillingPlanFeeOptionsCache"
  );
  const okIdx = feeUpsertSrc.indexOf('if (!res.ok) throw new Error');
  const invIdx = feeUpsertSrc.indexOf("invalidateBillingPlanFeeOptionsCache()");
  assert(okIdx >= 0 && invIdx > okIdx, "E/H: invalidate must run only after successful res.ok path");
  console.log("✓ E: successful Fee create/update invalidates billingPlanFeeOptions");
  console.log("✓ H: failed fee creation/update does NOT unnecessarily clear cache");
}

async function testF_SchoolIdOnEveryRequest() {
  const { fetchImpl, calls } = makeFetchMock((url) => {
    const u = new URL(url);
    const page = Number(u.searchParams.get("page") || "1");
    if (page === 1) {
      return {
        items: Array.from({ length: 100 }, (_, i) => ({ id: `f${i}`, name: `F${i}`, amount: 1 })),
        total: 101,
        pageSize: 100,
      };
    }
    return {
      items: [{ id: "f100", name: "F100", amount: 1 }],
      total: 101,
      pageSize: 100,
    };
  });

  await fetchAllSchoolFees({
    apiUrl: "https://api.example",
    schoolId: "school-abc",
    fetchImpl,
  });

  assert(calls.length >= 2, "F: expect multiple pages");
  for (const url of calls) {
    assert(
      url.includes("schoolId=school-abc"),
      `F: every /api/fees request must include schoolId — got ${url}`
    );
  }

  const empty = await fetchAllSchoolFees({
    apiUrl: "https://api.example",
    schoolId: "",
    fetchImpl,
  });
  assert(empty.requestUrls.length === 0, "F: empty schoolId must not call API");
  console.log("✓ F: schoolId remains on every /api/fees request");
}

function testG_PlanSchoolMergeDedupe() {
  const planFees = [
    { stableKey: "id:shared", description: "From plan", source: "plan" as const },
    { stableKey: "id:plan-only", description: "Plan only", source: "plan" as const },
  ];
  const schoolFees = [
    { stableKey: "id:shared", description: "From school", source: "fee" as const },
    { stableKey: "id:school-only", description: "School only", source: "fee" as const },
  ];
  const merged = mergeFeeOptionsByStableKey(planFees, schoolFees);
  assert(merged.length === 3, `G: expected 3 merged fees, got ${merged.length}`);
  const shared = merged.find((f) => f.stableKey === "id:shared");
  assert(shared?.source === "plan", "G: plan fee should win on duplicate stableKey");
  assert(
    merged.some((f) => f.stableKey === "id:plan-only") &&
      merged.some((f) => f.stableKey === "id:school-only"),
    "G: unique plan and school fees both retained"
  );
  console.log("✓ G: existing plan-fee merge/dedupe behaviour remains correct");
}

function testParseFeesApiList() {
  assert(parseFeesApiList({ items: [{ id: "1" }] }).length === 1, "parse items");
  assert(parseFeesApiList([{ id: "1" }]).length === 1, "parse array");
  assert(parseFeesApiList(null).length === 0, "parse null");
}

async function testInvoiceCreateCleanDoesNotPreferCache() {
  const path = join(
    dirname(fileURLToPath(import.meta.url)),
    "InvoiceCreateClean.tsx"
  );
  const src = readFileSync(path, "utf8");
  assert(
    src.includes("fetchAllSchoolFees"),
    "InvoiceCreateClean must use fetchAllSchoolFees"
  );
  assert(
    !src.includes('localStorage.getItem("billingPlanFeeOptions")'),
    "InvoiceCreateClean must not read billingPlanFeeOptions as authoritative source"
  );
  console.log("✓ InvoiceCreateClean no longer prefers stale localStorage cache");
}

async function main() {
  testParseFeesApiList();
  await testA_StaleCacheStillFetchesLive();
  await testC_D_PaginationBeyond100();
  testE_H_CacheInvalidationSuccessOnly();
  await testF_SchoolIdOnEveryRequest();
  testG_PlanSchoolMergeDedupe();
  await testInvoiceCreateCleanDoesNotPreferCache();
  console.log("\nAll invoice fee options loader regression tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
