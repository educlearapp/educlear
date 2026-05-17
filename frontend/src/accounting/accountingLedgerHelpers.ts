import type { ChartAccount, AccountType } from "./AccountingChartOfAccounts";
import {
  journalOrigin,
  journalSourceModule,
  loadJournalStore,
  roundMoney,
  type Journal,
  type JournalLine,
  type JournalSourceModule,
  type JournalStore,
} from "./accountingJournalStorage";
import { loadApprovedExpenses, type AccountingApprovedExpense } from "./accountingExpenseStorage";
import { readSchoolLedger, type BillingLedgerEntry } from "../billing/billingLedger";
import { dateInReportingRange, parseAccountingDate } from "./accountingSettingsStorage";

export type LedgerDisplaySource =
  | "Billing"
  | "Expenses"
  | "Banking"
  | "Journals"
  | "Assets"
  | "Payroll"
  | "Suppliers";

export type GeneralLedgerRow = {
  id: string;
  date: string;
  accountCode: string;
  accountName: string;
  accountType: AccountType | "";
  description: string;
  reference: string;
  source: LedgerDisplaySource;
  debit: number;
  credit: number;
  runningBalance: number;
  journalNo: string;
  status: "Posted";
  origin: "MANUAL" | "AUTO";
  journalId: string;
  lineId: string;
  sourceId: string;
  timestamp: string;
  lineMemo: string;
  groupType: AccountType | "";
};

export type GeneralLedgerSummary = {
  totalDebits: number;
  totalCredits: number;
  netMovement: number;
  transactionCount: number;
  activeAccounts: number;
  lastPostingDate: string;
};

export type AccountPeriodSummary = {
  openingBalance: number;
  periodDebits: number;
  periodCredits: number;
  closingBalance: number;
};

export type GeneralLedgerFilters = {
  schoolId: string;
  startDate: string;
  endDate: string;
  accountCode: string;
  search: string;
  groupByType: boolean;
};

const ACCOUNT_TYPE_ORDER: AccountType[] = ["Assets", "Liabilities", "Equity", "Income", "Expenses"];

export function formatLedgerMoney(value: number) {
  return roundMoney(value).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function buildCoaMap(accounts: ChartAccount[]) {
  const map = new Map<string, ChartAccount>();
  for (const account of accounts) {
    map.set(String(account.code || "").trim(), account);
  }
  return map;
}

function inferAssetsSource(journal: Journal): boolean {
  const blob = `${journal.description} ${journal.notes} ${journal.reference}`.toLowerCase();
  return blob.includes("depreciation") || blob.includes("fixed asset") || blob.includes("asset disposal");
}

export function resolveDisplaySource(journal: Journal): LedgerDisplaySource {
  const module = journalSourceModule(journal);
  if (module === "Billing") return "Billing";
  if (module === "Expenses") return "Expenses";
  if (module === "Banking") return "Banking";
  if (module === "Payroll") return "Payroll";
  if (module === "Suppliers") return "Suppliers";
  if (inferAssetsSource(journal)) return "Assets";
  return "Journals";
}

function sortKeyDate(dateRaw: string) {
  return parseAccountingDate(dateRaw)?.iso || dateRaw || "";
}

export function flattenPostedJournalLines(
  store: JournalStore,
  coaMap: Map<string, ChartAccount>
): Omit<GeneralLedgerRow, "runningBalance">[] {
  const rows: Omit<GeneralLedgerRow, "runningBalance">[] = [];

  for (const journal of store.journals) {
    if (journal.status !== "Posted") continue;

    const source = resolveDisplaySource(journal);
    const origin = journalOrigin(journal);
    const timestamp = String(journal.postedAt || journal.updatedAt || journal.createdAt || "");

    journal.lines.forEach((line: JournalLine, lineIndex: number) => {
      const accountCode = String(line.accountCode || "").trim();
      const coa = coaMap.get(accountCode);
      rows.push({
        id: `${journal.id}-${line.id || lineIndex}`,
        date: journal.date,
        accountCode,
        accountName: String(line.accountName || coa?.name || "").trim() || "—",
        accountType: coa?.type || "",
        description: journal.description || line.memo || "—",
        reference: journal.reference || "—",
        source,
        debit: roundMoney(line.debit),
        credit: roundMoney(line.credit),
        journalNo: journal.journalNo,
        status: "Posted",
        origin,
        journalId: journal.id,
        lineId: line.id,
        sourceId: String(journal.sourceId || journal.id),
        timestamp,
        lineMemo: line.memo || "",
        groupType: coa?.type || "",
      });
    });
  }

  return rows.sort((a, b) => {
    const dateCmp = sortKeyDate(a.date).localeCompare(sortKeyDate(b.date));
    if (dateCmp !== 0) return dateCmp;
    const acctCmp = a.accountCode.localeCompare(b.accountCode);
    if (acctCmp !== 0) return acctCmp;
    return a.journalNo.localeCompare(b.journalNo);
  });
}

export function applyRunningBalances(
  rows: Omit<GeneralLedgerRow, "runningBalance">[]
): GeneralLedgerRow[] {
  const balanceByAccount = new Map<string, number>();
  return rows.map((row) => {
    const code = row.accountCode || "—";
    const prev = balanceByAccount.get(code) ?? 0;
    const next = roundMoney(prev + row.debit - row.credit);
    balanceByAccount.set(code, next);
    return { ...row, runningBalance: next };
  });
}

export function filterLedgerRows(
  rows: GeneralLedgerRow[],
  filters: GeneralLedgerFilters
): GeneralLedgerRow[] {
  const search = String(filters.search || "").trim().toLowerCase();
  const accountCode = String(filters.accountCode || "").trim();

  return rows.filter((row) => {
    if (!dateInReportingRange(row.date, filters.startDate, filters.endDate)) return false;
    if (accountCode && row.accountCode !== accountCode) return false;
    if (!search) return true;
    const haystack = [
      row.accountCode,
      row.accountName,
      row.description,
      row.reference,
      row.journalNo,
      row.source,
      row.lineMemo,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(search);
  });
}

export function summarizeLedger(rows: GeneralLedgerRow[]): GeneralLedgerSummary {
  let totalDebits = 0;
  let totalCredits = 0;
  const accounts = new Set<string>();
  let lastPostingDate = "";

  for (const row of rows) {
    totalDebits += row.debit;
    totalCredits += row.credit;
    if (row.accountCode) accounts.add(row.accountCode);
    const ts = row.timestamp || row.date;
    if (ts && (!lastPostingDate || ts > lastPostingDate)) lastPostingDate = ts;
  }

  totalDebits = roundMoney(totalDebits);
  totalCredits = roundMoney(totalCredits);

  return {
    totalDebits,
    totalCredits,
    netMovement: roundMoney(totalDebits - totalCredits),
    transactionCount: rows.length,
    activeAccounts: accounts.size,
    lastPostingDate: lastPostingDate ? lastPostingDate.slice(0, 10) : "—",
  };
}

export function computeAccountPeriodSummary(
  allRows: GeneralLedgerRow[],
  accountCode: string,
  startDate: string,
  endDate: string
): AccountPeriodSummary {
  const code = String(accountCode || "").trim();
  let openingBalance = 0;
  let periodDebits = 0;
  let periodCredits = 0;

  for (const row of allRows) {
    if (row.accountCode !== code) continue;
    if (dateInReportingRange(row.date, startDate, endDate)) {
      periodDebits += row.debit;
      periodCredits += row.credit;
    } else if (sortKeyDate(row.date) < startDate) {
      openingBalance += row.debit - row.credit;
    }
  }

  openingBalance = roundMoney(openingBalance);
  periodDebits = roundMoney(periodDebits);
  periodCredits = roundMoney(periodCredits);
  const closingBalance = roundMoney(openingBalance + periodDebits - periodCredits);

  return { openingBalance, periodDebits, periodCredits, closingBalance };
}

export type GroupedLedgerSection = {
  type: AccountType;
  rows: GeneralLedgerRow[];
};

export function groupRowsByAccountType(rows: GeneralLedgerRow[]): GroupedLedgerSection[] {
  const buckets = new Map<AccountType, GeneralLedgerRow[]>();
  for (const row of rows) {
    const type = (row.groupType || row.accountType || "Expenses") as AccountType;
    if (!buckets.has(type)) buckets.set(type, []);
    buckets.get(type)!.push(row);
  }
  return ACCOUNT_TYPE_ORDER.filter((t) => buckets.has(t)).map((type) => ({
    type,
    rows: buckets.get(type) || [],
  }));
}

export function paginateRows<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    rows: items.slice(start, start + pageSize),
    totalPages,
    page: safePage,
    total: items.length,
  };
}

export function loadPostedGeneralLedger(
  schoolId: string,
  coaAccounts: ChartAccount[]
): GeneralLedgerRow[] {
  const store = loadJournalStore(schoolId);
  const coaMap = buildCoaMap(coaAccounts);
  const flat = flattenPostedJournalLines(store, coaMap);
  return applyRunningBalances(flat);
}

export function findJournalInStore(schoolId: string, journalId: string): Journal | undefined {
  return loadJournalStore(schoolId).journals.find((j) => j.id === journalId);
}

export function findBillingEntry(schoolId: string, sourceId: string): BillingLedgerEntry | undefined {
  return readSchoolLedger(schoolId).find((e) => e.id === sourceId);
}

export function findApprovedExpense(
  schoolId: string,
  sourceId: string
): AccountingApprovedExpense | undefined {
  return loadApprovedExpenses(schoolId).find((e) => e.id === sourceId);
}

export function sourceModuleForRow(row: GeneralLedgerRow): JournalSourceModule | "Assets" {
  if (row.source === "Assets") return "Manual";
  if (row.source === "Journals") return "Manual";
  return row.source as JournalSourceModule;
}
