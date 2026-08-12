/**
 * EduClear migrated finance totals from the authoritative ledger entries
 * for accounts in the migration source set.
 *
 * For disposable / newly migrated schools without age-analysis baseline,
 * ledger calculateBalanceFromEntries is the statement authority.
 */

import {
  calculateBalanceFromEntries,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../../../utils/billingLedgerStore";
import { UMIG_OPENING_BALANCE_SOURCE } from "./FinanceClassification";
import type { FinanceTotalsCents } from "./MigrationFinanceReconciliation";
import { randToCents } from "./moneyCents";

export function buildEduClearFinancePositions(input: {
  schoolId: string;
  accountRefs: string[];
}): {
  totals: FinanceTotalsCents;
  byAccount: Map<string, number>;
} {
  const ledger = readSchoolLedger(input.schoolId);
  const wanted = new Set(input.accountRefs.map((a) => a.trim()).filter(Boolean));
  const byAccount = new Map<string, number>();

  let debitCents = 0;
  let creditCents = 0;
  let transactionCount = 0;
  let openingBalanceCount = 0;

  const entriesByAccount = new Map<string, BillingLedgerEntry[]>();
  for (const entry of ledger) {
    const ref = String(entry.accountNo || "").trim();
    if (!ref || (wanted.size && !wanted.has(ref))) continue;
    const list = entriesByAccount.get(ref) || [];
    list.push(entry);
    entriesByAccount.set(ref, list);
  }

  for (const [ref, entries] of entriesByAccount) {
    const balance = calculateBalanceFromEntries(entries);
    const cents = randToCents(balance);
    byAccount.set(ref, cents);

    for (const e of entries) {
      const amt = randToCents(Math.abs(Number(e.amount) || 0));
      if (e.source === UMIG_OPENING_BALANCE_SOURCE) {
        openingBalanceCount += 1;
      } else {
        transactionCount += 1;
      }
      if (e.type === "invoice" || e.type === "penalty") debitCents += amt;
      else if (e.type === "payment" || e.type === "credit") creditCents += amt;
    }
  }

  // Include wanted accounts with zero activity
  for (const ref of wanted) {
    if (!byAccount.has(ref)) byAccount.set(ref, 0);
  }

  const netCents = [...byAccount.values()].reduce((s, v) => s + v, 0);

  return {
    totals: {
      debitCents,
      creditCents,
      netCents,
      accountCount: byAccount.size,
      transactionCount,
      openingBalanceCount,
    },
    byAccount,
  };
}
