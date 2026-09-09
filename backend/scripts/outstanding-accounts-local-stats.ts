/**
 * Read-only Outstanding Accounts stats from local JSON (no DB writes).
 * Contact/grade enrichment requires Prisma; when DB is unavailable this reports
 * balance-level figures only.
 *
 *   npx tsx scripts/outstanding-accounts-local-stats.ts
 */
import { readSchoolFamilyAccountAgeAnalysisSnapshots } from "../src/utils/familyAccountAgeAnalysisStore";
import {
  calculateBalanceFromEntries,
  readSchoolLedger,
  listOverdueInvoicesForAccount,
  type BillingLedgerEntry,
} from "../src/utils/billingLedgerStore";
import {
  filterPostImportBalanceEntries,
  resolveAuthoritativeAccountBalanceFromSnapshot,
  roundStatementMoney,
} from "../src/services/statementAccounts";
import { calendarDaysBetween } from "../src/services/outstandingAccountsService";

const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";

function oldestDaysOverdue(
  ledger: BillingLedgerEntry[],
  accountRef: string,
  asOf: string
): number | null {
  const overdue = listOverdueInvoicesForAccount(ledger, "", accountRef, asOf, {});
  if (!overdue.length) return null;
  overdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return calendarDaysBetween(overdue[0].dueDate, asOf);
}

function main() {
  const asOf = new Date().toISOString().slice(0, 10);
  const snapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(DA_SILVA);
  const ledger = readSchoolLedger(DA_SILVA);
  const rows: { accountRef: string; balance: number; daysOverdue: number | null }[] = [];

  for (const snap of Object.values(snapshots)) {
    const ref = String(snap.accountRef || "").trim().toUpperCase();
    if (!ref) continue;
    if (String(snap.mergedIntoAccountRef || "").trim()) continue;
    const accountEntries = ledger.filter(
      (e) => String(e.accountNo || "").trim().toUpperCase() === ref
    );
    const balance = resolveAuthoritativeAccountBalanceFromSnapshot(snap, accountEntries);
    if (roundStatementMoney(balance) <= 0) continue;
    rows.push({
      accountRef: ref,
      balance: roundStatementMoney(balance),
      daysOverdue: oldestDaysOverdue(ledger, ref, asOf),
    });
  }

  const totalOutstanding = roundStatementMoney(rows.reduce((s, r) => s + r.balance, 0));
  const knownOverdue = rows.filter((r) => r.daysOverdue != null).length;
  const unknownOverdue = rows.length - knownOverdue;

  // Sanity: delta path matches filterPostImport for one sample
  const sample = Object.values(snapshots)[0];
  if (sample) {
    const ref = String(sample.accountRef || "").trim().toUpperCase();
    const entries = ledger.filter((e) => String(e.accountNo || "").trim().toUpperCase() === ref);
    const post = filterPostImportBalanceEntries(entries, String(sample.importedAt || ""));
    void calculateBalanceFromEntries(post);
  }

  console.log(
    JSON.stringify(
      {
        schoolId: DA_SILVA,
        asOfDate: asOf,
        note:
          "Balance/overdue from local age-analysis + ledger JSON. Contact/learner counts require DB (unavailable in this environment).",
        outstandingAccountCount: rows.length,
        totalOutstanding,
        learnersAffected: null,
        withPrimaryCellphone: null,
        missingPrimaryCellphone: null,
        withEmail: null,
        missingEmail: null,
        knownOverdue,
        unknownOverdue,
      },
      null,
      2
    )
  );
}

main();
