/**
 * Aging-bucket fidelity for migration baselines.
 * If reliable source buckets exist and sum to accepted balance → preserve.
 * Otherwise mark BALANCE_ONLY — never invent aging history.
 */

import { parseMoneyToCents, centsEqual } from "./moneyCents";

export type AgingFidelityMode = "SOURCE_BUCKETS" | "BALANCE_ONLY";

export type AgingBucketsCents = {
  current: number;
  d30: number;
  d60: number;
  d90: number;
  d120: number;
};

export type AgingFidelityResult = {
  mode: AgingFidelityMode;
  bucketsCents: AgingBucketsCents;
  bucketsRand: {
    current: number;
    d30: number;
    d60: number;
    d90: number;
    d120: number;
  };
  acceptedBalanceCents: number;
  operatorMessage: string;
};

const ZERO: AgingBucketsCents = { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 };

function toRand(cents: number): number {
  return cents / 100;
}

/**
 * Map common source aging column aliases into EduClear buckets.
 */
export function extractAgingBucketsFromMappedRow(
  row: Record<string, string>
): AgingBucketsCents | null {
  const get = (...keys: string[]): number | null => {
    for (const k of keys) {
      const found = Object.entries(row).find(
        ([col]) => col.trim().toLowerCase() === k.toLowerCase()
      );
      if (!found) continue;
      const cents = parseMoneyToCents(found[1]);
      if (cents === null) continue;
      return cents;
    }
    return null;
  };

  const current = get("current", "current balance", "0-30", "0 – 30", "curr");
  const d30 = get("30", "30 days", "d30", "31-60", "30-60");
  const d60 = get("60", "60 days", "d60", "61-90", "60-90");
  const d90 = get("90", "90 days", "d90", "91-120", "90-120");
  const d120 = get("120", "120+", "120 days", "d120", "120 plus", "over 120");

  const values = [current, d30, d60, d90, d120];
  if (values.every((v) => v === null)) return null;

  return {
    current: current ?? 0,
    d30: d30 ?? 0,
    d60: d60 ?? 0,
    d90: d90 ?? 0,
    d120: d120 ?? 0,
  };
}

export function resolveAgingFidelity(input: {
  acceptedBalanceCents: number;
  sourceBuckets: AgingBucketsCents | null;
}): AgingFidelityResult {
  const accepted = input.acceptedBalanceCents;

  if (input.sourceBuckets) {
    const sum =
      input.sourceBuckets.current +
      input.sourceBuckets.d30 +
      input.sourceBuckets.d60 +
      input.sourceBuckets.d90 +
      input.sourceBuckets.d120;
    if (centsEqual(sum, accepted)) {
      return {
        mode: "SOURCE_BUCKETS",
        bucketsCents: { ...input.sourceBuckets },
        bucketsRand: {
          current: toRand(input.sourceBuckets.current),
          d30: toRand(input.sourceBuckets.d30),
          d60: toRand(input.sourceBuckets.d60),
          d90: toRand(input.sourceBuckets.d90),
          d120: toRand(input.sourceBuckets.d120),
        },
        acceptedBalanceCents: accepted,
        operatorMessage: "Aging buckets imported from source and match the accepted balance.",
      };
    }
  }

  // BALANCE_ONLY — do not invent aging; put full accepted balance in current for display.
  return {
    mode: "BALANCE_ONLY",
    bucketsCents: { ...ZERO, current: accepted },
    bucketsRand: {
      current: toRand(accepted),
      d30: 0,
      d60: 0,
      d90: 0,
      d120: 0,
    },
    acceptedBalanceCents: accepted,
    operatorMessage:
      "Balance imported successfully; source did not provide reliable aging buckets.",
  };
}
