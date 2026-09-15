/**
 * Invoice Add Fee catalogue loader.
 * Always fetches live school fees (paginated). Does not trust stale
 * localStorage.billingPlanFeeOptions as the source of truth.
 */

export const BILLING_PLAN_FEE_OPTIONS_KEY = "billingPlanFeeOptions";

const DEFAULT_PAGE_SIZE = 100;

export function invalidateBillingPlanFeeOptionsCache(): void {
  try {
    localStorage.removeItem(BILLING_PLAN_FEE_OPTIONS_KEY);
  } catch {
    // ignore storage errors
  }
}

export function rewriteBillingPlanFeeOptionsCache(fees: unknown[]): void {
  try {
    localStorage.setItem(BILLING_PLAN_FEE_OPTIONS_KEY, JSON.stringify(fees));
  } catch {
    // ignore storage errors
  }
}

export function parseFeesApiList(data: unknown): any[] {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data)) return data;
  const payload = data as Record<string, unknown>;
  if (Array.isArray(payload.fees)) return payload.fees;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

export type FetchAllSchoolFeesResult = {
  fees: any[];
  requestUrls: string[];
};

/**
 * Live paginated GET /api/fees for one school.
 * Never reads billingPlanFeeOptions.
 */
export async function fetchAllSchoolFees(options: {
  apiUrl: string;
  schoolId: string;
  pageSize?: number;
  fetchImpl?: typeof fetch;
}): Promise<FetchAllSchoolFeesResult> {
  const schoolId = String(options.schoolId || "").trim();
  if (!schoolId) {
    return { fees: [], requestUrls: [] };
  }

  const apiPageSize = Math.min(
    100,
    Math.max(1, Number(options.pageSize || DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE)
  );
  const fetchFn = options.fetchImpl || fetch;
  const base = String(options.apiUrl || "").replace(/\/$/, "");

  const loadedFees: any[] = [];
  const requestUrls: string[] = [];
  let page = 1;
  let totalFromApi = 0;

  while (true) {
    const url = `${base}/api/fees?schoolId=${encodeURIComponent(schoolId)}&page=${page}&pageSize=${apiPageSize}`;
    requestUrls.push(url);

    const response = await fetchFn(url);
    if (!response.ok) break;

    const data = await response.json();
    const list = parseFeesApiList(data);
    const reportedTotal = Number((data as { total?: unknown })?.total);
    if (Number.isFinite(reportedTotal) && reportedTotal > 0) {
      totalFromApi = reportedTotal;
    }

    if (list.length > 0) {
      loadedFees.push(...list);
    }

    if (list.length === 0) break;
    if (totalFromApi > 0 && loadedFees.length >= totalFromApi) break;

    const responsePageSize = Number((data as { pageSize?: unknown })?.pageSize);
    const effectivePageSize =
      Number.isFinite(responsePageSize) && responsePageSize > 0
        ? responsePageSize
        : apiPageSize;
    if (totalFromApi <= 0 && list.length < effectivePageSize) break;
    page += 1;
  }

  return { fees: loadedFees, requestUrls };
}

/**
 * Merge learner plan fees + school catalogue fees; first wins by stableKey
 * (plan fees precede school fees, matching InvoiceCreateClean).
 */
export function mergeFeeOptionsByStableKey<T extends { stableKey: string }>(
  planFees: T[],
  schoolFees: T[]
): T[] {
  const merged = new Map<string, T>();
  for (const fee of [...planFees, ...schoolFees]) {
    if (!merged.has(fee.stableKey)) merged.set(fee.stableKey, fee);
  }
  return Array.from(merged.values());
}
