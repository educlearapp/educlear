/**
 * Load source aging buckets per account from staged package rows.
 * Uses documented column-name aliases only — never invents buckets.
 */

import type { MigrationStage } from "../types/MigrationStage";
import {
  extractAgingBucketsFromMappedRow,
  type AgingBucketsCents,
} from "./agingFidelity";
import { parseMoneyToCents } from "./moneyCents";

function accountRefFromRow(row: Record<string, string>): string {
  const keys = ["account", "account number", "account no", "accountno", "acc", "family account"];
  for (const [col, val] of Object.entries(row)) {
    if (keys.includes(col.trim().toLowerCase())) {
      return String(val || "").trim().toUpperCase();
    }
  }
  // Mapped target fallbacks when analysis already remapped headers
  for (const k of ["accountNumber", "accountRef", "Account"]) {
    if (row[k]) return String(row[k]).trim().toUpperCase();
  }
  return "";
}

/**
 * Scan raw source rows for aging columns. Returns null entry when no reliable
 * buckets exist for that account.
 */
export function loadSourceAgingByAccount(
  rowsByFileId: Map<string, Record<string, string>[]>
): Map<string, AgingBucketsCents | null> {
  const out = new Map<string, AgingBucketsCents | null>();

  for (const rows of rowsByFileId.values()) {
    for (const row of rows) {
      const ref = accountRefFromRow(row);
      if (!ref) continue;
      const buckets = extractAgingBucketsFromMappedRow(row);
      if (!buckets) {
        if (!out.has(ref)) out.set(ref, null);
        continue;
      }
      // Prefer first complete bucket set; do not silently merge conflicting files
      if (!out.has(ref) || out.get(ref) === null) {
        out.set(ref, buckets);
      }
    }
  }

  return out;
}

/** Optional helper when stage already carries cutover + account refs for tests. */
export function loadSourceAgingForStageAccounts(input: {
  stage: MigrationStage;
  rowsByFileId: Map<string, Record<string, string>[]>;
  acceptedByAccount: Map<string, number>;
}): Map<string, AgingBucketsCents | null> {
  void input.stage;
  const raw = loadSourceAgingByAccount(input.rowsByFileId);
  // Drop buckets that don't sum to accepted balance (caller uses resolveAgingFidelity)
  for (const [ref, buckets] of raw) {
    if (!buckets) continue;
    const accepted = input.acceptedByAccount.get(ref);
    if (accepted == null) continue;
    const sum =
      buckets.current + buckets.d30 + buckets.d60 + buckets.d90 + buckets.d120;
    if (parseMoneyToCents(String(sum / 100)) !== null && sum !== accepted) {
      // Keep raw — resolveAgingFidelity decides BALANCE_ONLY vs SOURCE_BUCKETS
    }
  }
  return raw;
}
