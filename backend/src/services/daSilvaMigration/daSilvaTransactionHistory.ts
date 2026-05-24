import { prisma } from "../../prisma";
import { isMigratedOpeningBalanceOverviewLabel } from "../../utils/billingDisplayRules";
import {
  buildKidesysHistoryAccountIndex,
  KIDESYS_DISPLAY_HISTORY_SOURCE,
  type KidesysHistoryEntry,
  readSchoolKidesysHistory,
  writeSchoolKidesysHistory,
} from "../../utils/kidesysTransactionHistoryStore";
import {
  calculateBalanceFromEntries,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../../utils/billingLedgerStore";
import { buildAccountsFromLearners } from "../statementAccounts";
import { parseTransactionListFile, type ParsedTransaction } from "./parsers";

export const DA_SILVA_EXPECTED_HISTORY_ROW_COUNT = 40916;

export const DA_SILVA_PHASE5_BALANCE_GUARDS = {
  accounts: 344,
  netOutstanding: 1228655.42,
  overPaid: 490355.03,
} as const;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function historyEntryId(kind: string, transactionNo: string, accountNo: string): string {
  return `kidesys-hist-${kind}-${transactionNo}-${accountNo}`;
}

export function mapParsedTransactionToHistoryEntry(
  schoolId: string,
  txn: ParsedTransaction,
  importedAt: string
): KidesysHistoryEntry {
  const accountNo = String(txn.accountNo || "").trim();
  const journalReference = String(txn.notes || "").trim();
  const description = journalReference || txn.reference;
  return {
    id: historyEntryId(txn.kind, txn.transactionNo, accountNo),
    schoolId,
    accountNo,
    type: txn.kind,
    amount: round2(Math.abs(txn.amount)),
    date: txn.date,
    reference: txn.reference,
    transactionNo: txn.transactionNo,
    description,
    fullName: txn.fullName,
    source: KIDESYS_DISPLAY_HISTORY_SOURCE,
    importedAt,
    invoiceNumber: txn.kind === "invoice" ? txn.transactionNo : undefined,
    paymentNumber: txn.kind === "payment" ? txn.transactionNo : undefined,
    journalReference: journalReference || undefined,
    kidesysReference: txn.reference,
    direction: txn.direction,
    sourceFileRow: txn.sourceFileRow,
  };
}

export function buildHistoryEntriesFromTransactions(
  schoolId: string,
  transactions: ParsedTransaction[],
  importedAt = new Date().toISOString()
): KidesysHistoryEntry[] {
  const seen = new Set<string>();
  const entries: KidesysHistoryEntry[] = [];
  for (const txn of transactions) {
    const entry = mapParsedTransactionToHistoryEntry(schoolId, txn, importedAt);
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

export type DaSilvaTransactionHistoryValidation = {
  schoolId: string;
  dryRun: boolean;
  parsedRowCount: number;
  expectedRowCount: number;
  rowCountMatch: boolean;
  historyEntryCount: number;
  duplicateIds: number;
  distinctAccountsInHistory: number;
  familyAccountsInDb: number;
  unlinkedAccountNos: string[];
  unlinkedAccountCount: number;
  familyAccountsMissingHistory: string[];
  familyAccountsMissingHistoryCount: number;
  accounts: number;
  expectedAccounts: number;
  accountsMatch: boolean;
  netOutstanding: number;
  expectedNetOutstanding: number;
  netOutstandingMatch: boolean;
  overPaid: number;
  expectedOverPaid: number;
  overPaidMatch: boolean;
  ledgerEntryCount: number;
  ledgerEntryCountUnchanged: boolean;
  ledgerBalanceBefore: number;
  ledgerBalanceAfter: number;
  ledgerBalanceUnchanged: boolean;
  accountsWithHistoryLastInvoice: number;
  accountsWithHistoryLastPayment: number;
  accountsWithOpeningBalanceLabel: number;
  doubleCountingRisk: boolean;
  passed: boolean;
  errors: string[];
};

function schoolLedgerBalanceTotal(ledger: BillingLedgerEntry[]): number {
  const accounts = new Set<string>();
  for (const e of ledger) {
    const ref = String(e.accountNo || "").trim();
    if (ref) accounts.add(ref);
  }
  let total = 0;
  for (const accountNo of accounts) {
    const scoped = ledger.filter((e) => String(e.accountNo || "").trim() === accountNo);
    total += calculateBalanceFromEntries(scoped);
  }
  return round2(total);
}

/** Validate phase 5 import without mutating ledger balances. */
export async function validateDaSilvaTransactionHistoryImport(opts: {
  schoolId: string;
  transactionsPath: string;
  dryRun: boolean;
  proposedHistory?: KidesysHistoryEntry[];
}): Promise<DaSilvaTransactionHistoryValidation> {
  const errors: string[] = [];
  const schoolId = String(opts.schoolId || "").trim();
  const ledgerBefore = readSchoolLedger(schoolId);
  const ledgerBeforeCount = ledgerBefore.length;
  const ledgerBalanceBefore = schoolLedgerBalanceTotal(ledgerBefore);

  const parsed = parseTransactionListFile(opts.transactionsPath);
  const proposed =
    opts.proposedHistory ??
    buildHistoryEntriesFromTransactions(schoolId, parsed, new Date().toISOString());

  const idSet = new Set<string>();
  let duplicateIds = 0;
  for (const e of proposed) {
    if (idSet.has(e.id)) duplicateIds += 1;
    idSet.add(e.id);
  }

  const familyAccounts = await prisma.familyAccount.findMany({
    where: { schoolId },
    select: { accountRef: true },
  });
  const familyRefs = new Set(
    familyAccounts.map((a) => String(a.accountRef || "").trim()).filter(Boolean)
  );

  const historyAccounts = new Set(
    proposed.map((e) => String(e.accountNo || "").trim()).filter(Boolean)
  );
  const unlinkedAccountNos = [...historyAccounts].filter((a) => !familyRefs.has(a)).sort();
  const familyAccountsMissingHistory = [...familyRefs]
    .filter((ref) => !historyAccounts.has(ref))
    .sort();
  if (familyAccountsMissingHistory.length) {
    errors.push(
      `${familyAccountsMissingHistory.length} active family account(s) have no Kid-e-Sys history: ${familyAccountsMissingHistory.slice(0, 20).join(", ")}`
    );
  }

  const accountsAfter = await buildAccountsFromLearners(
    schoolId,
    ledgerBefore,
    proposed
  );

  const ledgerAfter = readSchoolLedger(schoolId);
  const ledgerBalanceAfter = schoolLedgerBalanceTotal(ledgerAfter);

  const netOutstanding = round2(
    accountsAfter.reduce((sum, row) => sum + Number(row.balance), 0)
  );
  const overPaid = round2(
    Math.abs(
      accountsAfter
        .filter((row) => Number(row.balance) < 0)
        .reduce((sum, row) => sum + Number(row.balance), 0)
    )
  );

  const historyIndex = buildKidesysHistoryAccountIndex(proposed);
  let accountsWithHistoryLastInvoice = 0;
  let accountsWithHistoryLastPayment = 0;
  for (const row of accountsAfter) {
    const summary = historyIndex.get(String(row.accountNo || "").trim());
    if (summary?.lastInvoice) accountsWithHistoryLastInvoice += 1;
    if (summary?.lastPayment) accountsWithHistoryLastPayment += 1;
  }

  const accountsWithOpeningBalanceLabel = accountsAfter.filter((a) =>
    isMigratedOpeningBalanceOverviewLabel(a.lastInvoiceLabel)
  ).length;

  const rowCountMatch = parsed.length === DA_SILVA_EXPECTED_HISTORY_ROW_COUNT;
  if (!rowCountMatch) {
    errors.push(
      `Expected ${DA_SILVA_EXPECTED_HISTORY_ROW_COUNT} parsed rows, got ${parsed.length}`
    );
  }
  if (proposed.length !== parsed.length) {
    errors.push(`Deduplicated history count ${proposed.length} ≠ parsed ${parsed.length}`);
  }
  if (duplicateIds > 0) {
    errors.push(`${duplicateIds} duplicate history id(s)`);
  }

  const accountsMatch = accountsAfter.length === DA_SILVA_PHASE5_BALANCE_GUARDS.accounts;
  if (!accountsMatch) {
    errors.push(
      `Expected ${DA_SILVA_PHASE5_BALANCE_GUARDS.accounts} statement rows, got ${accountsAfter.length}`
    );
  }

  const netOutstandingMatch =
    Math.abs(netOutstanding - DA_SILVA_PHASE5_BALANCE_GUARDS.netOutstanding) < 0.02;
  if (!netOutstandingMatch) {
    errors.push(
      `Net outstanding R${netOutstanding} ≠ expected R${DA_SILVA_PHASE5_BALANCE_GUARDS.netOutstanding}`
    );
  }

  const overPaidMatch =
    Math.abs(overPaid - DA_SILVA_PHASE5_BALANCE_GUARDS.overPaid) < 0.02;
  if (!overPaidMatch) {
    errors.push(
      `Overpaid R${overPaid} ≠ expected R${DA_SILVA_PHASE5_BALANCE_GUARDS.overPaid}`
    );
  }

  const ledgerEntryCountUnchanged = ledgerAfter.length === ledgerBeforeCount;
  if (!ledgerEntryCountUnchanged) {
    errors.push(`Ledger entry count changed ${ledgerBeforeCount} → ${ledgerAfter.length}`);
  }

  const ledgerBalanceUnchanged = Math.abs(ledgerBalanceAfter - ledgerBalanceBefore) < 0.02;
  if (!ledgerBalanceUnchanged) {
    errors.push(
      `Ledger balance total changed R${ledgerBalanceBefore} → R${ledgerBalanceAfter}`
    );
  }

  // History must not be written into billing ledger
  const historyInLedger = ledgerAfter.some(
    (e) => String(e.source || "") === KIDESYS_DISPLAY_HISTORY_SOURCE
  );
  const doubleCountingRisk = historyInLedger;
  if (doubleCountingRisk) {
    errors.push("Billing ledger contains kidesys_display_history rows (double-counting risk)");
  }

  const passed =
    errors.length === 0 &&
    rowCountMatch &&
    accountsMatch &&
    netOutstandingMatch &&
    overPaidMatch &&
    ledgerEntryCountUnchanged &&
    ledgerBalanceUnchanged &&
    !doubleCountingRisk;

  return {
    schoolId,
    dryRun: opts.dryRun,
    parsedRowCount: parsed.length,
    expectedRowCount: DA_SILVA_EXPECTED_HISTORY_ROW_COUNT,
    rowCountMatch,
    historyEntryCount: proposed.length,
    duplicateIds,
    distinctAccountsInHistory: historyAccounts.size,
    familyAccountsInDb: familyRefs.size,
    unlinkedAccountNos: unlinkedAccountNos.slice(0, 50),
    unlinkedAccountCount: unlinkedAccountNos.length,
    familyAccountsMissingHistory: familyAccountsMissingHistory.slice(0, 50),
    familyAccountsMissingHistoryCount: familyAccountsMissingHistory.length,
    accounts: accountsAfter.length,
    expectedAccounts: DA_SILVA_PHASE5_BALANCE_GUARDS.accounts,
    accountsMatch,
    netOutstanding,
    expectedNetOutstanding: DA_SILVA_PHASE5_BALANCE_GUARDS.netOutstanding,
    netOutstandingMatch,
    overPaid,
    expectedOverPaid: DA_SILVA_PHASE5_BALANCE_GUARDS.overPaid,
    overPaidMatch,
    ledgerEntryCount: ledgerAfter.length,
    ledgerEntryCountUnchanged,
    ledgerBalanceBefore,
    ledgerBalanceAfter,
    ledgerBalanceUnchanged,
    accountsWithHistoryLastInvoice,
    accountsWithHistoryLastPayment,
    accountsWithOpeningBalanceLabel,
    doubleCountingRisk,
    passed,
    errors,
  };
}

export async function importDaSilvaTransactionHistory(opts: {
  schoolId: string;
  transactionsPath: string;
  dryRun: boolean;
}): Promise<DaSilvaTransactionHistoryValidation> {
  const schoolId = String(opts.schoolId || "").trim();
  const parsed = parseTransactionListFile(opts.transactionsPath);
  const entries = buildHistoryEntriesFromTransactions(schoolId, parsed);

  const validation = await validateDaSilvaTransactionHistoryImport({
    schoolId,
    transactionsPath: opts.transactionsPath,
    dryRun: opts.dryRun,
    proposedHistory: entries,
  });

  if (!opts.dryRun && validation.passed) {
    writeSchoolKidesysHistory(schoolId, entries);
  }

  return validation;
}
