/**
 * Boot-gate helper for educlear-registration FamilyAccounts with zero current learners.
 *
 * Empty financial shells (no snapshot balance, no live ledger, no allocations, no deposits)
 * must not take production offline. Unexplained money still fails closed.
 *
 * This module is read-only. It never writes JSON or database rows.
 */

export const MONEY_EPS = 0.005;

export function absMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

export function isRetiredOrMergedSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return false;
  const merged = String(
    snapshot.mergedIntoAccountRef || snapshot.canonicalAccountRef || ""
  ).trim();
  const retiredAt = String(snapshot.retiredAt || "").trim();
  const reason = String(snapshot.retiredReason || "").trim().toLowerCase();
  return Boolean(merged) || Boolean(retiredAt) || reason === "merged" || reason === "retired";
}

export function isLiveLedgerRow(row) {
  if (!row || typeof row !== "object") return false;
  if (row.undoneAt || row.reversedAt || row.reversesEntryId || row.voidedAt) return false;
  return absMoney(row.amount) > MONEY_EPS;
}

export function snapshotHasBalance(snapshot) {
  if (absMoney(snapshot?.balance) > MONEY_EPS) return true;
  const buckets = snapshot?.buckets && typeof snapshot.buckets === "object" ? snapshot.buckets : {};
  for (const key of ["current", "d30", "d60", "d90", "d120"]) {
    if (absMoney(buckets[key]) > MONEY_EPS) return true;
  }
  return false;
}

export function rowsForAccount(rows, accountRef, fieldNames) {
  const ref = String(accountRef || "").trim().toUpperCase();
  if (!ref || !Array.isArray(rows)) return [];
  const fields = fieldNames || ["accountNo", "accountRef"];
  return rows.filter((row) =>
    fields.some((field) => String(row?.[field] || "").trim().toUpperCase() === ref)
  );
}

export function flattenPaymentAllocationRows(schoolBucket) {
  if (!schoolBucket || typeof schoolBucket !== "object" || Array.isArray(schoolBucket)) return [];
  const out = [];
  for (const value of Object.values(schoolBucket)) {
    if (Array.isArray(value)) out.push(...value);
  }
  return out;
}

function livePaymentAllocations(rows) {
  return (rows || []).filter(
    (row) => absMoney(row.allocatedAmount ?? row.amount) > MONEY_EPS
  );
}

function liveDeposits(rows) {
  return (rows || []).filter((row) => {
    if (absMoney(row.remainingBalance ?? row.remainingBalance) <= MONEY_EPS) return false;
    const status = String(row.status || "ACTIVE").toUpperCase();
    return status !== "VOID" && status !== "REFUNDED";
  });
}

export function inspectFinancialPosition({
  snapshot,
  ledgerEntries = [],
  paymentAllocations = [],
  deposits = [],
} = {}) {
  if (snapshotHasBalance(snapshot)) {
    return { hasMoney: true, reason: "age-snapshot-balance" };
  }
  const liveLedger = (ledgerEntries || []).filter(isLiveLedgerRow);
  if (liveLedger.length) {
    const types = [...new Set(liveLedger.map((row) => String(row.type || "unknown")))].sort();
    return { hasMoney: true, reason: `live-ledger:${types.join(",")}` };
  }
  if (livePaymentAllocations(paymentAllocations).length) {
    return { hasMoney: true, reason: "live-payment-allocations" };
  }
  if (liveDeposits(deposits).length) {
    return { hasMoney: true, reason: "live-deposits" };
  }
  return { hasMoney: false, reason: "zero-balance-empty-shell" };
}

/**
 * @returns {{ action: "pass" | "warn" | "fail", reason: string }}
 */
export function classifyRegistrationFamilyAccountBoot({
  learnerCount,
  snapshot,
  ledgerEntries = [],
  paymentAllocations = [],
  deposits = [],
} = {}) {
  if (Number(learnerCount) > 0) {
    return { action: "pass", reason: "has-learners" };
  }

  const financial = inspectFinancialPosition({
    snapshot,
    ledgerEntries,
    paymentAllocations,
    deposits,
  });
  const retired = isRetiredOrMergedSnapshot(snapshot);

  if (!financial.hasMoney) {
    return {
      action: "warn",
      reason: retired ? "retired-or-merged-empty-shell" : "zero-balance-empty-shell",
    };
  }

  return { action: "fail", reason: financial.reason };
}
