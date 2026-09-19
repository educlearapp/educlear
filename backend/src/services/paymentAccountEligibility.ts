/**
 * New-payment account eligibility.
 *
 * Statements / history may still list zero-linked family accounts.
 * Capture Payment selection (and GET /api/payments/accounts) must only offer
 * family accounts that currently have at least one linked learner.
 */

import { prisma } from "../prisma";

export type PaymentEligibilityAccountRow = {
  familyAccountId?: string | null;
  memberLearnerIds?: string[] | null;
  eduClearAccountNo?: string | null;
  accountNo?: string | null;
  sourceAccountRef?: string | null;
};

/** True when FamilyAccount.id is in the set of FAs that have ≥1 linked learner. */
export function isFamilyAccountIdEligibleForNewPayment(
  familyAccountId: unknown,
  linkedFamilyAccountIds: Set<string>
): boolean {
  const id = String(familyAccountId || "").trim();
  if (!id) return false;
  return linkedFamilyAccountIds.has(id);
}

/**
 * Filter statement-shaped account rows for Capture Payment pickers.
 * Does not mutate balances or statement history sources.
 */
export function filterAccountsEligibleForNewPayment<T extends PaymentEligibilityAccountRow>(
  accounts: T[],
  linkedFamilyAccountIds: Set<string>
): T[] {
  return (accounts || []).filter((row) =>
    isFamilyAccountIdEligibleForNewPayment(row?.familyAccountId, linkedFamilyAccountIds)
  );
}

/**
 * FamilyAccount ids in this school that currently have ≥1 linked learner row.
 * Read-only Prisma query — does not change ledger, links, or retirement state.
 */
export async function loadFamilyAccountIdsWithLinkedLearners(
  schoolId: string,
  familyAccountIds?: string[]
): Promise<Set<string>> {
  const sid = String(schoolId || "").trim();
  if (!sid) return new Set();

  const scoped = (familyAccountIds || [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);

  const rows = await prisma.learner.findMany({
    where: {
      schoolId: sid,
      familyAccountId: scoped.length
        ? { in: scoped }
        : { not: null },
    },
    select: { familyAccountId: true },
    distinct: ["familyAccountId"],
  });

  const out = new Set<string>();
  for (const row of rows) {
    const id = String(row.familyAccountId || "").trim();
    if (id) out.add(id);
  }
  return out;
}

/** Statement-shaped rows → payment-eligible subset (backend enforcement). */
export async function filterPaymentAccountsForSchool<T extends PaymentEligibilityAccountRow>(
  schoolId: string,
  accounts: T[]
): Promise<T[]> {
  const ids = (accounts || [])
    .map((a) => String(a?.familyAccountId || "").trim())
    .filter(Boolean);
  if (!ids.length) return [];
  const linked = await loadFamilyAccountIdsWithLinkedLearners(schoolId, ids);
  return filterAccountsEligibleForNewPayment(accounts, linked);
}
