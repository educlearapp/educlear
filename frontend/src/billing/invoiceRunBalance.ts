import {
  calculateAccountBalance,
  getAccountLedger,
  isSchoolLedgerFreshFromApi,
  type BillingLedgerEntry,
} from "./billingLedger";
import { readStatementApiAccounts } from "./kidesysTransactionHistory";

export type InvoiceRunBalanceResult =
  | { ready: true; balance: number; source: "ledger" | "statements" }
  | { ready: false; pending: true }
  | { ready: false; pending: false };

export const INVOICE_RUN_BALANCE_LOADING_LABEL = "Loading…";
export const INVOICE_RUN_BALANCE_UNAVAILABLE_LABEL = "—";

function normaliseAccountRef(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

const statementBalanceIndexBySchool: Record<
  string,
  { rows: unknown[]; index: Map<string, number> }
> = {};

function statementBalanceByAccount(schoolId: string): Map<string, number> | null {
  const sid = String(schoolId || "").trim();
  const rows = readStatementApiAccounts(sid);
  if (!rows.length) return null;
  const cached = statementBalanceIndexBySchool[sid];
  if (cached && cached.rows === rows) return cached.index;
  const index = new Map<string, number>();
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    const ref = normaliseAccountRef(record.accountNo);
    if (!ref) continue;
    const balance = Number(record.balance);
    if (!Number.isFinite(balance)) continue;
    index.set(ref, balance);
  }
  statementBalanceIndexBySchool[sid] = { rows, index };
  return index;
}

export function lookupStatementAccountBalance(
  schoolId: string,
  accountNo: string
): { loaded: boolean; balance: number | null } {
  const index = statementBalanceByAccount(schoolId);
  if (!index) return { loaded: false, balance: null };

  const ref = normaliseAccountRef(accountNo);
  if (!ref) return { loaded: true, balance: null };
  if (!index.has(ref)) return { loaded: true, balance: null };
  return { loaded: true, balance: index.get(ref) ?? null };
}

export function resolveInvoiceRunWizardBalance(
  schoolId: string,
  _learnerId: string,
  accountNo: string
): InvoiceRunBalanceResult {
  const sid = String(schoolId || "").trim();
  if (!sid) return { ready: false, pending: true };

  const statement = lookupStatementAccountBalance(sid, accountNo);
  if (!statement.loaded) return { ready: false, pending: true };
  if (statement.balance === null) return { ready: false, pending: false };

  return {
    ready: true,
    balance: statement.balance,
    source: "statements",
  };
}

export function resolveInvoiceRunBalance(
  schoolId: string,
  learnerId: string,
  accountNo: string
): InvoiceRunBalanceResult {
  const sid = String(schoolId || "").trim();
  if (!sid) return { ready: false, pending: true };

  if (isSchoolLedgerFreshFromApi(sid)) {
    const ledger = getAccountLedger(sid, learnerId, accountNo);
    return {
      ready: true,
      balance: calculateAccountBalance(ledger, learnerId, accountNo),
      source: "ledger",
    };
  }

  const statement = lookupStatementAccountBalance(sid, accountNo);
  if (!statement.loaded) return { ready: false, pending: true };
  if (statement.balance === null) return { ready: false, pending: false };

  return {
    ready: true,
    balance: statement.balance,
    source: "statements",
  };
}

export function invoiceRunBalanceToAmount(result: InvoiceRunBalanceResult): number | null {
  return result.ready ? result.balance : null;
}

export function formatInvoiceRunBalanceResult(
  result: InvoiceRunBalanceResult,
  formatMoney: (amount: number) => string = defaultFormatMoney
): string {
  if (result.ready) return formatMoney(result.balance);
  if (result.pending) return INVOICE_RUN_BALANCE_LOADING_LABEL;
  return INVOICE_RUN_BALANCE_UNAVAILABLE_LABEL;
}

export function formatInvoiceRunBalanceAmount(
  value: number | null | undefined,
  formatMoney: (amount: number) => string = defaultFormatMoney
): string {
  if (value === null || value === undefined) return INVOICE_RUN_BALANCE_LOADING_LABEL;
  return formatMoney(value);
}

export function sumInvoiceRunBalanceAndAmount(
  balance: number | null | undefined,
  invoiceAmount: number
): number | null {
  if (balance === null || balance === undefined) return null;
  return Number(balance) + Number(invoiceAmount || 0);
}

export function invoiceRunBalanceStatusLabel(balance: number | null | undefined): string {
  if (balance === null || balance === undefined) return INVOICE_RUN_BALANCE_UNAVAILABLE_LABEL;
  if (balance < 0) return "Over Paid";
  if (balance > 5000) return "Bad Debt";
  return "Recently Owing";
}

export function invoiceRunBalanceStatusColor(balance: number | null | undefined): string {
  if (balance === null || balance === undefined) return "#64748b";
  if (balance < 0) return "#15803d";
  if (balance > 5000) return "#b91c1c";
  return "#ca8a04";
}

function defaultFormatMoney(amount: number): string {
  return `R ${Number(amount || 0).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** @internal Test hook */
export function __invoiceRunBalanceTestDeps(entries: BillingLedgerEntry[]) {
  return { entries };
}
