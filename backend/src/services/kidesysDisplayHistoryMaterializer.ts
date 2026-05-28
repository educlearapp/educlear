import {
  buildHistoryEntriesFromTransactions,
  mapParsedTransactionToHistoryEntry,
} from "./daSilvaMigration/daSilvaTransactionHistory";
import type { ParsedTransaction } from "./daSilvaMigration/parsers";
import {
  KIDESYS_DISPLAY_HISTORY_SOURCE,
  type KidesysHistoryEntry,
  readSchoolKidesysHistory,
  writeSchoolKidesysHistory,
} from "../utils/kidesysTransactionHistoryStore";
import { readSchoolLedger, type BillingLedgerEntry } from "../utils/billingLedgerStore";
import { isKidESysSourceAccountRef } from "./daSilvaMigration/ageAnalysisParser";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function parseTransactionNo(reference: string, id: string): string {
  const ref = String(reference || "").trim();
  const m = ref.match(/(\d+)/);
  if (m?.[1]) return m[1];
  const fromId = String(id || "").replace(/^kidesys-(invoice|payment|journal)-/, "");
  return fromId || ref || id;
}

/** Build display-only history rows from imported Kid-e-Sys ledger entries (invoice/payment). */
export function buildHistoryEntriesFromLedger(
  schoolId: string,
  ledger: BillingLedgerEntry[],
  importedAt = new Date().toISOString()
): KidesysHistoryEntry[] {
  const seen = new Set<string>();
  const entries: KidesysHistoryEntry[] = [];

  for (const row of ledger) {
    if (row.type !== "invoice" && row.type !== "payment") continue;
    const accountNo = String(row.accountNo || "").trim().toUpperCase();
    if (!accountNo || !isKidESysSourceAccountRef(accountNo)) continue;
    const source = String(row.source || "");
    if (!source.includes("kideesys") && !String(row.id || "").startsWith("kidesys-")) continue;

    const transactionNo = parseTransactionNo(String(row.reference || ""), String(row.id || ""));
    const amount = round2(Math.abs(Number(row.amount) || 0));
    const txn: ParsedTransaction = {
      kind: row.type,
      transactionNo,
      accountNo,
      date: String(row.date || "").slice(0, 10),
      amount,
      signedAmount: row.type === "payment" ? -amount : amount,
      reference: String(row.reference || `${row.type} ${transactionNo}`).trim(),
      notes: String(row.description || "").trim(),
      fullName: "",
      sourceFileRow: 0,
      direction: row.type === "payment" ? "credit" : "debit",
    };
    const entry = mapParsedTransactionToHistoryEntry(schoolId, txn, importedAt);
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }

  return entries;
}

export type MaterializeKidesysDisplayHistoryResult = {
  schoolId: string;
  previousCount: number;
  mergedCount: number;
  written: boolean;
};

/**
 * Ensure kidesys-transaction-history.json has display rows for last invoice/payment.
 * Merges parsed transaction file rows with ledger-derived rows (idempotent by entry id).
 */
export function materializeKidesysDisplayHistory(opts: {
  schoolId: string;
  transactions?: ParsedTransaction[];
  dryRun?: boolean;
}): MaterializeKidesysDisplayHistoryResult {
  const schoolId = String(opts.schoolId || "").trim();
  const importedAt = new Date().toISOString();
  const previous = readSchoolKidesysHistory(schoolId);
  const byId = new Map<string, KidesysHistoryEntry>();
  for (const row of previous) byId.set(row.id, row);

  if (opts.transactions?.length) {
    for (const entry of buildHistoryEntriesFromTransactions(schoolId, opts.transactions, importedAt)) {
      byId.set(entry.id, entry);
    }
  }

  const ledger = readSchoolLedger(schoolId);
  for (const entry of buildHistoryEntriesFromLedger(schoolId, ledger, importedAt)) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }

  const merged = Array.from(byId.values()).filter(
    (e) => String(e.source || "") === KIDESYS_DISPLAY_HISTORY_SOURCE
  );

  const written = !opts.dryRun && merged.length > 0;
  if (written) writeSchoolKidesysHistory(schoolId, merged);

  return {
    schoolId,
    previousCount: previous.length,
    mergedCount: merged.length,
    written,
  };
}
