import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchBankImports, type BankImportRecord } from "../banking/bankingApi";
import {
  computeBankingStats,
  loadSuppliersForMatching,
} from "../banking/bankingReconciliationUtils";
import {
  BILLING_UPDATED_EVENT,
  formatMoney,
  getBillingRows,
  normaliseBillingAmount,
  readSchoolLedger,
  type BillingAccountRow,
  type BillingLedgerEntry,
} from "../billing/billingLedger";
import { fetchLegalDocumentHistory } from "../billing/billingApi";
import {
  ACCOUNTING_EXPENSES_UPDATED_EVENT,
  filterApprovedExpensesForMonth,
  loadApprovedExpenses,
  loadExpenseCandidates,
  migrateLegacyExpenseStores,
  normalizeExpenseCategory,
  reviewQueueFromCandidates,
  sumApprovedExpensesByCategory,
  totalApprovedSpendForMonth,
  type AccountingApprovedExpense,
} from "./accountingExpenseStorage";
import {
  ACCOUNTING_ASSETS_UPDATED_EVENT,
  annualDepreciationFromRuns,
  buildAssetCategorySummary,
  calculateAssetTotals,
  calculateBookValueTotals,
  calculateDepreciationTotals,
  largestAssetCategory,
  listDisposedAssets,
  loadAssets,
} from "./accountingAssetStorage";
import {
  buildCreditorInvoiceLines,
  calculateCreditorAgeing,
  calculateCreditorTotals,
  calculateUpcomingSupplierPayments,
  CREDITORS_UPDATED_EVENT,
  loadCreditorInvoices,
  loadCreditorPaymentPlans,
  listTopCreditors,
} from "./accountingCreditorsHelpers";
import { loadJournalStore } from "./accountingJournalStorage";
import {
  ACCOUNTING_PAYROLL_UPDATED_EVENT,
  buildPayslipRegister,
  expectedSalaryPaymentsForPeriod,
  payrollJournalsForRuns,
  payrollLiabilitiesFromPostedRuns,
  payrollRunsForReportingPeriod,
  payrollTotalsForReportingPeriod,
} from "./accountingPayrollIntegration";
import {
  ACCOUNTING_SETTINGS_UPDATED_EVENT,
  dateInReportingRange,
  getDefaultReportingBasis,
  loadAccountingSettings,
  MONTH_NAMES,
  REPORTING_BASIS_OPTIONS,
  reportingBasisYearLabel,
  resolveReportingPeriod,
  type ReportingBasis,
} from "./accountingSettingsStorage";
import {
  ACCOUNTING_GOLD,
  ACCOUNTING_INK,
  accountingCard,
  accountingCardLabel,
  accountingCardValue,
  accountingPageWrap,
  accountingSubtitle,
  accountingTitle,
} from "./accountingTheme";
import {
  exportPayloadCsv,
  exportPayloadPdf,
  formatExportMoney,
  payloadFromHtmlBody,
  payloadFromTable,
  resolveExportBranding,
} from "./accountingExportEngine";

type Props = {
  schoolId: string;
  learners?: any[];
  schoolName?: string;
};

type ReportType =
  | "management"
  | "budget-actual"
  | "cashflow"
  | "expense-analysis"
  | "debtors"
  | "supplier-spend"
  | "bank-recon"
  | "asset-summary"
  | "audit-pack";

const REPORT_OPTIONS: { id: ReportType; label: string }[] = [
  { id: "management", label: "Management Accounts" },
  { id: "budget-actual", label: "Budget vs Actual" },
  { id: "cashflow", label: "Cash Flow Forecast" },
  { id: "expense-analysis", label: "Expense Analysis" },
  { id: "debtors", label: "Debtors Summary" },
  { id: "supplier-spend", label: "Supplier Spend" },
  { id: "bank-recon", label: "Bank Reconciliation Summary" },
  { id: "asset-summary", label: "Asset Register Summary" },
  { id: "audit-pack", label: "Audit Pack Export" },
];

const PAGE_SIZE = 10;

/** Planning figures aligned with Accounting Budget sample categories (read-only for reports). */
const DEFAULT_EXPENSE_BUDGET_MONTHLY: Record<string, number> = {
  salaries: 185000,
  "rent / bond": 42000,
  electricity: 12000,
  utilities: 18500,
  transport: 12000,
  maintenance: 9500,
  stationery: 6500,
  "food / tuckshop": 14000,
  insurance: 8800,
  marketing: 4500,
  other: 6000,
};

const goldBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "1px solid #b89329",
  background: "linear-gradient(135deg, #f7d56a, #d4af37)",
  color: ACCOUNTING_INK,
  fontWeight: 900,
  cursor: "pointer",
  fontSize: 14,
};

const outlineBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: `2px solid ${ACCOUNTING_GOLD}`,
  background: "#fff",
  color: ACCOUNTING_INK,
  fontWeight: 800,
  cursor: "pointer",
  fontSize: 14,
};

const fieldStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${ACCOUNTING_GOLD}`,
  fontWeight: 700,
  color: ACCOUNTING_INK,
  background: "#fff",
  minWidth: 140,
};

const th: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 900,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: ACCOUNTING_GOLD,
  background: ACCOUNTING_INK,
  borderBottom: `2px solid ${ACCOUNTING_GOLD}`,
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: 13,
  fontWeight: 600,
  color: ACCOUNTING_INK,
};

const sectionCard: React.CSSProperties = {
  marginBottom: 20,
  padding: 20,
  borderRadius: 12,
  border: `1px solid ${ACCOUNTING_GOLD}`,
  background: "linear-gradient(180deg, #fff 0%, #faf8f0 100%)",
};

function parseYearMonth(dateRaw: string): { year: number; monthIndex: number } | null {
  const raw = String(dateRaw || "").trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})/);
  if (iso) {
    const year = Number(iso[1]);
    const monthIndex = Number(iso[2]) - 1;
    if (year >= 1970 && monthIndex >= 0 && monthIndex <= 11) return { year, monthIndex };
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getFullYear(), monthIndex: d.getMonth() };
}

function entryInPeriod(dateRaw: string, year: number, monthIndex: number) {
  const parsed = parseYearMonth(dateRaw);
  return parsed?.year === year && parsed?.monthIndex === monthIndex;
}

function entryInYearToDate(dateRaw: string, year: number, monthIndex: number) {
  const parsed = parseYearMonth(dateRaw);
  if (!parsed || parsed.year !== year) return false;
  return parsed.monthIndex <= monthIndex;
}

function sumPaymentsForMonth(ledger: BillingLedgerEntry[], year: number, monthIndex: number) {
  return ledger
    .filter((e) => e.type === "payment" && entryInPeriod(e.date, year, monthIndex))
    .reduce((sum, e) => sum + normaliseBillingAmount(e.amount), 0);
}

function sumPaymentsInRange(ledger: BillingLedgerEntry[], startDate: string, endDate: string) {
  return ledger
    .filter((e) => e.type === "payment" && dateInReportingRange(e.date, startDate, endDate))
    .reduce((sum, e) => sum + normaliseBillingAmount(e.amount), 0);
}

function sumPaymentsYtd(ledger: BillingLedgerEntry[], year: number, monthIndex: number) {
  return ledger
    .filter((e) => e.type === "payment" && entryInYearToDate(e.date, year, monthIndex))
    .reduce((sum, e) => sum + normaliseBillingAmount(e.amount), 0);
}

function totalApprovedSpendInRange(
  rows: AccountingApprovedExpense[],
  startDate: string,
  endDate: string
) {
  return rows
    .filter((row) => dateInReportingRange(row.date, startDate, endDate))
    .reduce((sum, row) => {
      const amount = Number(row.amount);
      return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
    }, 0);
}

function filterApprovedInRange(
  rows: AccountingApprovedExpense[],
  startDate: string,
  endDate: string
) {
  return rows.filter((row) => dateInReportingRange(row.date, startDate, endDate));
}

function sumApprovedByCategoryInRange(
  rows: AccountingApprovedExpense[],
  startDate: string,
  endDate: string
) {
  const totals = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const row of filterApprovedInRange(rows, startDate, endDate)) {
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const key = normalizeExpenseCategory(row.category);
    if (!key) continue;
    totals.set(key, (totals.get(key) || 0) + amount);
    if (!labels.has(key)) labels.set(key, String(row.category || "").trim() || key);
  }
  return { totals, labels };
}

function filterApprovedYtd(rows: AccountingApprovedExpense[], year: number, monthIndex: number) {
  return rows.filter((row) => {
    const parsed = parseYearMonth(row.date);
    return parsed?.year === year && parsed.monthIndex <= monthIndex;
  });
}

function totalApprovedYtd(rows: AccountingApprovedExpense[], year: number, monthIndex: number) {
  return filterApprovedYtd(rows, year, monthIndex).reduce((sum, row) => {
    const amount = Number(row.amount);
    return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
  }, 0);
}

function formatPeriodLabel(year: number, monthIndex: number) {
  return `${MONTH_NAMES[monthIndex] || ""} ${year}`;
}

function countMonthsInRange(startDate: string, endDate: string) {
  const start = startDate.match(/^(\d{4})-(\d{2})/);
  const end = endDate.match(/^(\d{4})-(\d{2})/);
  if (!start || !end) return 1;
  const sy = Number(start[1]);
  const sm = Number(start[2]);
  const ey = Number(end[1]);
  const em = Number(end[2]);
  return Math.max(1, (ey - sy) * 12 + (em - sm) + 1);
}

function varianceStatus(variancePct: number) {
  if (variancePct > 10) return "Over budget";
  if (variancePct < -10) return "Under budget";
  return "On track";
}

function paginate<T>(rows: T[], page: number) {
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  return { page: safePage, totalPages, rows: rows.slice(start, start + PAGE_SIZE), total: rows.length };
}

function PaginationBar({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  if (total <= PAGE_SIZE) return null;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 12,
        fontSize: 13,
        fontWeight: 700,
        color: "#64748b",
      }}
    >
      <span>
        Showing page {page} of {totalPages} ({total} rows)
      </span>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={outlineBtn} disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </button>
        <button
          type="button"
          style={outlineBtn}
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function ReportTable({
  columns,
  rows,
  page,
  onPage,
  emptyMessage,
}: {
  columns: string[];
  rows: (string | number)[][];
  page: number;
  onPage: (p: number) => void;
  emptyMessage?: string;
}) {
  const paged = paginate(rows, page);
  if (!rows.length) {
    return <div style={{ padding: 16, color: "#64748b", fontWeight: 600 }}>{emptyMessage || "No data for this period."}</div>;
  }
  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} style={th}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.rows.map((row, i) => (
              <tr key={`${i}-${String(row[0])}`}>
                {row.map((cell, j) => (
                  <td key={j} style={td}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PaginationBar page={paged.page} totalPages={paged.totalPages} total={paged.total} onPage={onPage} />
    </>
  );
}

export default function AccountingReports({ schoolId, learners = [], schoolName = "School" }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [monthIndex, setMonthIndex] = useState(now.getMonth());
  const [reportingBasis, setReportingBasis] = useState<ReportingBasis>(() =>
    schoolId ? getDefaultReportingBasis(schoolId) : "doe"
  );
  const [reportType, setReportType] = useState<ReportType>("management");
  const [generated, setGenerated] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [bankImports, setBankImports] = useState<BankImportRecord[]>([]);
  const [legalHistoryCount, setLegalHistoryCount] = useState(0);
  const [placeholderBanner, setPlaceholderBanner] = useState("");
  const [tablePage, setTablePage] = useState(1);
  const reportRef = useRef<HTMLDivElement>(null);

  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!schoolId) return;
    migrateLegacyExpenseStores(schoolId);
    const settings = loadAccountingSettings(schoolId);
    setReportingBasis(settings.reports.defaultReportBasis);
  }, [schoolId, refreshKey]);

  useEffect(() => {
    const onSettings = (e: Event) => {
      const detail = (e as CustomEvent<{ schoolId?: string }>).detail;
      if (!detail?.schoolId || detail.schoolId === schoolId) {
        setReportingBasis(getDefaultReportingBasis(schoolId));
      }
    };
    window.addEventListener(ACCOUNTING_SETTINGS_UPDATED_EVENT, onSettings);
    return () => window.removeEventListener(ACCOUNTING_SETTINGS_UPDATED_EVENT, onSettings);
  }, [schoolId]);

  useEffect(() => {
    const onExpenses = (e: Event) => {
      const detail = (e as CustomEvent<{ schoolId?: string }>).detail;
      if (!detail?.schoolId || detail.schoolId === schoolId) bumpRefresh();
    };
    const onBilling = () => bumpRefresh();
    const onAssets = (e: Event) => {
      const detail = (e as CustomEvent<{ schoolId?: string }>).detail;
      if (!detail?.schoolId || detail.schoolId === schoolId) bumpRefresh();
    };
    const onCreditors = (e: Event) => {
      const detail = (e as CustomEvent<{ schoolId?: string }>).detail;
      if (!detail?.schoolId || detail.schoolId === schoolId) bumpRefresh();
    };
    const onPayroll = (e: Event) => {
      const detail = (e as CustomEvent<{ schoolId?: string }>).detail;
      if (!detail?.schoolId || detail.schoolId === schoolId) bumpRefresh();
    };
    window.addEventListener(ACCOUNTING_EXPENSES_UPDATED_EVENT, onExpenses);
    window.addEventListener(BILLING_UPDATED_EVENT, onBilling);
    window.addEventListener(ACCOUNTING_ASSETS_UPDATED_EVENT, onAssets);
    window.addEventListener(CREDITORS_UPDATED_EVENT, onCreditors);
    window.addEventListener(ACCOUNTING_PAYROLL_UPDATED_EVENT, onPayroll);
    return () => {
      window.removeEventListener(ACCOUNTING_EXPENSES_UPDATED_EVENT, onExpenses);
      window.removeEventListener(BILLING_UPDATED_EVENT, onBilling);
      window.removeEventListener(ACCOUNTING_ASSETS_UPDATED_EVENT, onAssets);
      window.removeEventListener(CREDITORS_UPDATED_EVENT, onCreditors);
      window.removeEventListener(ACCOUNTING_PAYROLL_UPDATED_EVENT, onPayroll);
    };
  }, [schoolId, bumpRefresh]);

  useEffect(() => {
    if (!schoolId) {
      setBankImports([]);
      return;
    }
    let cancelled = false;
    fetchBankImports(schoolId)
      .then((res) => {
        if (!cancelled && res?.success) setBankImports(Array.isArray(res.imports) ? res.imports : []);
      })
      .catch(() => {
        if (!cancelled) setBankImports([]);
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId, refreshKey]);

  useEffect(() => {
    if (!schoolId) {
      setLegalHistoryCount(0);
      return;
    }
    fetchLegalDocumentHistory(schoolId)
      .then((res) => {
        const rows = Array.isArray(res?.history) ? res.history : [];
        setLegalHistoryCount(rows.length);
      })
      .catch(() => setLegalHistoryCount(0));
  }, [schoolId, refreshKey]);

  useEffect(() => {
    setTablePage(1);
  }, [reportType, year, monthIndex, reportingBasis, generated]);

  const period = useMemo(
    () => resolveReportingPeriod(reportingBasis, year, monthIndex),
    [reportingBasis, year, monthIndex]
  );
  const periodLabel = period.label;

  const data = useMemo(() => {
    void refreshKey;
    const sid = String(schoolId || "").trim();
    const statementRows: BillingAccountRow[] = sid ? getBillingRows(learners, sid) : [];
    const ledger = sid ? readSchoolLedger(sid) : [];
    const approvedAll = sid ? loadApprovedExpenses(sid) : [];
    const approvedMonth =
      reportingBasis === "month"
        ? sid
          ? filterApprovedExpensesForMonth(approvedAll, year, monthIndex)
          : []
        : sid
          ? filterApprovedInRange(approvedAll, period.startDate, period.endDate)
          : [];
    const spendByCategory =
      reportingBasis === "month"
        ? sid
          ? sumApprovedExpensesByCategory(approvedAll, year, monthIndex)
          : { totals: new Map(), labels: new Map() }
        : sid
          ? sumApprovedByCategoryInRange(approvedAll, period.startDate, period.endDate)
          : { totals: new Map(), labels: new Map() };
    const candidates = sid ? reviewQueueFromCandidates(loadExpenseCandidates(sid)) : [];
    const suppliers = sid ? loadSuppliersForMatching(sid) : [];
    const journalStore = sid ? loadJournalStore(sid) : { journals: [], audit: [] };
    const assets = sid ? loadAssets(sid) : [];
    const assetTotals = calculateAssetTotals(assets);
    const bookTotals = calculateBookValueTotals(assets);
    const depTotals = calculateDepreciationTotals(assets, period.depreciationYear);
    const assetCategorySummary = buildAssetCategorySummary(assets);
    const disposedAssets = listDisposedAssets(assets);
    const topAssetCategory = largestAssetCategory(assets);
    const annualDepreciation = annualDepreciationFromRuns(assets);

    const income =
      reportingBasis === "month"
        ? sumPaymentsForMonth(ledger, year, monthIndex)
        : sumPaymentsInRange(ledger, period.startDate, period.endDate);
    const expenses =
      reportingBasis === "month"
        ? totalApprovedSpendForMonth(approvedAll, year, monthIndex)
        : totalApprovedSpendInRange(approvedAll, period.startDate, period.endDate);
    const net = income - expenses;

    const outstandingDebtors = statementRows
      .filter((r) => normaliseBillingAmount(r.balance) > 0)
      .reduce((s, r) => s + normaliseBillingAmount(r.balance), 0);

    const recentlyOwing = statementRows.filter((r) => r.status === "Recently Owing");
    const badDebt = statementRows.filter((r) => r.status === "Bad Debt");
    const overpaid = statementRows.filter((r) => normaliseBillingAmount(r.balance) < 0);

    const topDebtors = [...statementRows]
      .filter((r) => normaliseBillingAmount(r.balance) > 0)
      .sort((a, b) => normaliseBillingAmount(b.balance) - normaliseBillingAmount(a.balance))
      .slice(0, 10);

    const categoryRows = Array.from(spendByCategory.totals.entries())
      .map(([key, amount]) => ({
        category: spendByCategory.labels.get(key) || key,
        amount,
        pct: expenses > 0 ? (amount / expenses) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    const budgetMonthFactor =
      reportingBasis === "month" ? 1 : countMonthsInRange(period.startDate, period.endDate);

    const budgetRows = Array.from(
      new Set([
        ...Object.keys(DEFAULT_EXPENSE_BUDGET_MONTHLY),
        ...Array.from(spendByCategory.totals.keys()),
      ])
    ).map((key) => {
      const budgeted = (DEFAULT_EXPENSE_BUDGET_MONTHLY[key] || 0) * budgetMonthFactor;
      const actual = spendByCategory.totals.get(key) || 0;
      const label = spendByCategory.labels.get(key) || key.replace(/\b\w/g, (ch: string) => ch.toUpperCase());
      const variance = actual - budgeted;
      const variancePct = budgeted > 0 ? (variance / budgeted) * 100 : 0;
      return {
        category: label,
        budgeted,
        actual,
        variance,
        variancePct,
        status: varianceStatus(variancePct),
      };
    });

    const totalBudgeted = budgetRows.reduce((s, r) => s + r.budgeted, 0);
    const totalActualBudget = budgetRows.reduce((s, r) => s + r.actual, 0);
    const budgetVariance = totalBudgeted - totalActualBudget;

    const expectedCollectionsPlaceholder = outstandingDebtors * 0.65;
    const forecastedCash = net + expectedCollectionsPlaceholder;
    const cashWarning = forecastedCash < 0;

    const supplierMap = new Map<
      string,
      { supplier: string; category: string; month: number; ytd: number; lastDate: string }
    >();
    for (const row of approvedAll) {
      const supplier = String(row.supplier || "Unknown").trim() || "Unknown";
      const key = normalizeExpenseCategory(supplier);
      const amount = normaliseBillingAmount(row.amount);
      if (amount <= 0) continue;
      if (!dateInReportingRange(row.date, period.startDate, period.endDate)) continue;
      const parsed = parseYearMonth(row.date);
      const existing = supplierMap.get(key) || {
        supplier,
        category: String(row.category || "Other"),
        month: 0,
        ytd: 0,
        lastDate: "",
      };
      existing.ytd += amount;
      if (reportingBasis === "month" && parsed?.monthIndex === monthIndex) {
        existing.month += amount;
      } else if (reportingBasis !== "month") {
        existing.month += amount;
      }
      if (!existing.lastDate || row.date > existing.lastDate) existing.lastDate = row.date;
      supplierMap.set(key, existing);
    }

    const creditorAsAt = period.endDate;
    const creditorTotals = sid
      ? calculateCreditorTotals(sid, creditorAsAt)
      : {
          supplierPayables: 0,
          overdueSupplierPayables: 0,
          paymentPlanCommitments: 0,
          openInvoiceCount: 0,
          overdueInvoiceCount: 0,
          supplierCount: 0,
        };
    const upcomingCreditors = sid
      ? calculateUpcomingSupplierPayments(sid, {
          startDate: period.startDate,
          endDate: period.endDate,
          year: period.year,
          monthIndex: period.monthIndex,
        })
      : {
          scheduledInvoicePayments: 0,
          paymentPlanInstallments: 0,
          totalUpcoming: 0,
        };
    const creditorAgeing = sid ? calculateCreditorAgeing(sid, creditorAsAt) : [];
    const creditorInvoiceLines = sid
      ? buildCreditorInvoiceLines(
          loadCreditorInvoices(sid),
          loadCreditorPaymentPlans(sid),
          creditorAsAt
        )
      : [];
    const topCreditors = sid ? listTopCreditors(sid, creditorAsAt, 10) : [];

    for (const row of creditorAgeing) {
      const key = normalizeExpenseCategory(row.supplierName);
      if (!supplierMap.has(key)) {
        supplierMap.set(key, {
          supplier: row.supplierName,
          category: row.category || "Other",
          month: 0,
          ytd: 0,
          lastDate: row.nextDueDate || "",
        });
      }
    }

    const creditorBySupplier = new Map(
      creditorAgeing.map((row) => [normalizeExpenseCategory(row.supplierName), row])
    );

    const supplierRows = Array.from(supplierMap.values())
      .map((s) => {
        const creditor = creditorBySupplier.get(normalizeExpenseCategory(s.supplier));
        const supplierLines = creditorInvoiceLines.filter(
          (line) =>
            normalizeExpenseCategory(line.supplierName) === normalizeExpenseCategory(s.supplier)
        );
        const overdueInvoices = supplierLines.filter(
          (line) => line.outstanding > 0 && line.displayStatus === "Overdue"
        ).length;
        return {
          ...s,
          outstanding: creditor?.outstandingBalance || 0,
          openInvoices: creditor?.openInvoiceCount || 0,
          overdueInvoices,
          paymentPlan: creditor?.hasActivePlan ? "Active plan" : "—",
          creditorStatus: creditor?.displayStatus || (s.month > 0 || s.ytd > 0 ? "Spend only" : "—"),
          status: suppliers.some(
            (sup) => normalizeExpenseCategory(sup.name) === normalizeExpenseCategory(s.supplier)
          )
            ? "Active"
            : creditor?.outstandingBalance
              ? "Creditor"
              : "Recorded",
        };
      })
      .sort((a, b) => b.outstanding - a.outstanding || b.month - a.month);

    const activeImport = bankImports.length ? bankImports[0] : null;
    const bankStats = computeBankingStats(bankImports, activeImport);
    const importSummaries = bankImports.map((imp) => {
      const txns = imp.transactions || [];
      let matchedPayments = 0;
      let expenseMatched = 0;
      let unmatched = 0;
      let duplicates = 0;
      let readyToPost = 0;
      for (const t of txns) {
        if (t.isDuplicate) duplicates += 1;
        if (t.direction === "in" && t.matchConfidence !== "none" && t.matchConfidence !== "low") {
          matchedPayments += 1;
        }
        if (t.direction === "out" && t.expenseCategory && t.expenseCategory !== "Other") {
          expenseMatched += 1;
        }
        if (t.reviewStatus === "unmatched" || (t.matchConfidence === "none" && t.reviewStatus === "pending")) {
          unmatched += 1;
        }
        if (
          t.direction === "in" &&
          t.reviewStatus === "accepted" &&
          t.matchConfidence !== "none" &&
          t.matchConfidence !== "low"
        ) {
          readyToPost += 1;
        }
      }
      return {
        fileName: imp.fileName,
        importedAt: imp.importedAt,
        txCount: txns.length,
        matchedPayments,
        expenseMatched,
        unmatched,
        duplicates,
        readyToPost,
      };
    });

    const overBudgetCategories = budgetRows.filter((r) => r.budgeted > 0 && r.actual > r.budgeted);

    const payrollPosted = sid
      ? payrollTotalsForReportingPeriod(sid, period.startDate, period.endDate, "Posted")
      : {
          totalPayrollCost: 0,
          grossPay: 0,
          netPay: 0,
          paye: 0,
          uifEmployee: 0,
          uifEmployer: 0,
          pension: 0,
          medicalAid: 0,
          employeeCount: 0,
          runCount: 0,
        };
    const payrollLiabilities = sid
      ? payrollLiabilitiesFromPostedRuns(sid, period.endDate)
      : { total: 0, paye: 0, uif: 0, pension: 0, medicalAid: 0 };
    const payrollPctOfIncome =
      income > 0 ? (payrollPosted.totalPayrollCost / income) * 100 : 0;
    const expectedSalaryPayments = sid
      ? expectedSalaryPaymentsForPeriod(sid, period.startDate, period.endDate)
      : 0;
    const payrollRunsInPeriod = sid
      ? payrollRunsForReportingPeriod(sid, period.startDate, period.endDate)
      : [];
    const payslipRegister = buildPayslipRegister(payrollRunsInPeriod);
    const payrollJournals = sid ? payrollJournalsForRuns(sid, payrollRunsInPeriod) : [];

    const warnings: string[] = [];
    if (expenses > income && (expenses > 0 || income > 0)) {
      warnings.push("Approved expenses exceed fee income for the selected month.");
    }
    if (outstandingDebtors > 50000) {
      warnings.push("Outstanding debtor balance is elevated — review Billing Documents legal recovery.");
    }
    if (candidates.length > 0) {
      warnings.push(`${candidates.length} bank expense candidate(s) awaiting review.`);
    }
    if (bankStats.unmatched > 0) {
      warnings.push(`${bankStats.unmatched} unmatched bank line(s) on the latest import.`);
    }
    if (cashWarning) {
      warnings.push("Projected month-end cash position is negative.");
    }
    if (creditorTotals.overdueSupplierPayables > 0) {
      warnings.push(
        `${formatMoney(creditorTotals.overdueSupplierPayables)} overdue supplier payables — review Creditors Ageing.`
      );
    }

    return {
      statementRows,
      ledger,
      income,
      expenses,
      net,
      outstandingDebtors,
      recentlyOwing,
      badDebt,
      overpaid,
      topDebtors,
      categoryRows,
      budgetRows,
      budgetVariance,
      forecastedCash,
      cashWarning,
      expectedCollectionsPlaceholder,
      supplierRows,
      bankStats,
      importSummaries,
      expenseCandidates: candidates.length,
      overBudgetCategories,
      warnings,
      journalCount: journalStore.journals.length,
      postedJournals: journalStore.journals.filter((j) => j.status === "Posted").length,
      paymentsYtd:
        reportingBasis === "month"
          ? sumPaymentsYtd(ledger, year, monthIndex)
          : sumPaymentsInRange(ledger, period.startDate, period.endDate),
      expensesYtd:
        reportingBasis === "month"
          ? totalApprovedYtd(approvedAll, year, monthIndex)
          : totalApprovedSpendInRange(approvedAll, period.startDate, period.endDate),
      assetTotals,
      bookTotals,
      depTotals,
      assetCategorySummary,
      disposedAssets,
      topAssetCategory,
      annualDepreciation,
      creditorTotals,
      upcomingCreditors,
      creditorAgeing,
      topCreditors,
      payrollPosted,
      payrollLiabilities,
      payrollPctOfIncome,
      expectedSalaryPayments,
      payslipRegister,
      payrollJournals,
      payrollRunsInPeriod,
    };
  }, [schoolId, learners, year, monthIndex, reportingBasis, period, refreshKey, bankImports]);

  const summaryCards = [
    { label: "Total Income", value: formatMoney(data.income) },
    { label: "Total Expenses", value: formatMoney(data.expenses) },
    { label: "Net Position", value: formatMoney(data.net) },
    { label: "Outstanding Debtors", value: formatMoney(data.outstandingDebtors) },
    { label: "Budget Variance", value: formatMoney(data.budgetVariance) },
    { label: "Forecasted Cash Position", value: formatMoney(data.forecastedCash) },
  ];

  const handleGenerate = () => {
    setGenerated(true);
    setPlaceholderBanner("");
    bumpRefresh();
  };

  const handlePrint = () => {
    const el = reportRef.current;
    if (!el) return;
    const w = window.open("", "_blank");
    if (!w) {
      setPlaceholderBanner("Pop-up blocked. Allow pop-ups to print the report.");
      return;
    }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Reports — ${periodLabel}</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;color:#111827;margin:24px;line-height:1.45}
h1{font-size:22px;margin:0 0 6px}
h2{font-size:16px;margin:24px 0 10px;color:#111827;border-bottom:2px solid #d4af37;padding-bottom:6px}
.sub{color:#64748b;font-size:13px;margin-bottom:20px}
table{width:100%;border-collapse:collapse;margin:12px 0 20px;font-size:12px}
th,td{padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:left}
th{background:#111827;color:#d4af37;font-size:11px;text-transform:uppercase}
.warn{background:#fffbeb;border:1px solid #d4af37;padding:10px;border-radius:8px;margin:10px 0}
.card{display:inline-block;min-width:140px;margin:0 12px 12px 0;padding:12px;border:1px solid #d4af37;border-radius:8px}
.card label{font-size:10px;text-transform:uppercase;color:#64748b;font-weight:700}
.card strong{display:block;margin-top:4px;font-size:18px}
</style></head><body>
<h1>Reports — ${schoolName}</h1>
<p class="sub">${REPORT_OPTIONS.find((r) => r.id === reportType)?.label || reportType} · ${periodLabel}</p>
${el.innerHTML}
</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  };

  const handleExportPdf = () => {
    if (!generated || !reportRef.current) {
      setPlaceholderBanner("Generate the report before exporting.");
      return;
    }
    const title = REPORT_OPTIONS.find((r) => r.id === reportType)?.label || "Report";
    const payload = payloadFromHtmlBody(
      resolveExportBranding(schoolName),
      title,
      periodLabel,
      new Date().toLocaleString("en-ZA"),
      reportRef.current.innerHTML
    );
    if (!exportPayloadPdf(payload)) {
      setPlaceholderBanner("Pop-up blocked. Allow pop-ups to export PDF.");
    } else {
      setPlaceholderBanner("");
    }
  };

  const handleExportExcel = () => {
    if (!generated) {
      setPlaceholderBanner("Generate the report before exporting.");
      return;
    }
    const at = new Date().toLocaleString("en-ZA");
    const title = REPORT_OPTIONS.find((r) => r.id === reportType)?.label || "Report";
    const branding = resolveExportBranding(schoolName);
    let table = { columns: ["Metric", "Value"], rows: [] as string[][] };

    if (reportType === "budget-actual") {
      table = {
        columns: ["Category", "Budgeted", "Actual", "Variance", "Status"],
        rows: data.budgetRows.map((r) => [
          r.category,
          formatExportMoney(r.budgeted),
          formatExportMoney(r.actual),
          formatExportMoney(r.variance),
          r.status,
        ]),
      };
    } else if (reportType === "debtors") {
      table = {
        columns: ["Learner", "Account", "Balance", "Status"],
        rows: data.topDebtors.map((r) => [
          `${r.name} ${r.surname}`,
          r.accountNo,
          formatExportMoney(r.balance),
          r.status,
        ]),
      };
    } else if (reportType === "audit-pack") {
      exportPayloadCsv(
        payloadFromTable(branding, title, periodLabel, at, {
          columns: ["Checklist item", "Status"],
          rows: [
            ["Income & expenses", formatExportMoney(data.income)],
            ["Outstanding debtors", formatExportMoney(data.outstandingDebtors)],
            ["Journals on file", String(data.journalCount)],
            ["Active assets", String(data.assetTotals.activeCount)],
            ["Creditor payables", formatExportMoney(data.creditorTotals.supplierPayables)],
          ],
        })
      );
      setPlaceholderBanner("");
      return;
    } else {
      table = {
        columns: ["Metric", "Value"],
        rows: [
          ["Income", formatExportMoney(data.income)],
          ["Expenses", formatExportMoney(data.expenses)],
          ["Net position", formatExportMoney(data.net)],
          ["Outstanding debtors", formatExportMoney(data.outstandingDebtors)],
          ["Forecasted cash", formatExportMoney(data.forecastedCash)],
        ],
      };
    }

    exportPayloadCsv(payloadFromTable(branding, title, periodLabel, at, table));
    setPlaceholderBanner("");
  };

  const renderReportBody = () => {
    if (!generated) {
      return (
        <div style={{ ...sectionCard, textAlign: "center", color: "#64748b", fontWeight: 600 }}>
          Select year, month, and report type, then click <strong>Generate</strong> to build the report.
        </div>
      );
    }

    switch (reportType) {
      case "management":
        return (
          <>
            <div style={sectionCard}>
              <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900 }}>Income &amp; expenses</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
                <div>
                  <strong>Income summary</strong>
                  <div>{formatMoney(data.income)} fee payments ({periodLabel})</div>
                </div>
                <div>
                  <strong>Expenses summary</strong>
                  <div>{formatMoney(data.expenses)} approved expenses</div>
                </div>
                <div>
                  <strong>Net surplus / deficit</strong>
                  <div style={{ color: data.net >= 0 ? "#15803d" : "#b91c1c", fontWeight: 900 }}>
                    {formatMoney(data.net)}
                  </div>
                </div>
              </div>
            </div>
            <div style={sectionCard}>
              <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900 }}>Top expense categories</h2>
              <ReportTable
                columns={["Category", "Amount", "% of spend"]}
                rows={data.categoryRows.slice(0, 10).map((r) => [
                  r.category,
                  formatMoney(r.amount),
                  `${r.pct.toFixed(1)}%`,
                ])}
                page={tablePage}
                onPage={setTablePage}
                emptyMessage="No approved expenses for this month."
              />
            </div>
            <div style={sectionCard}>
              <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900 }}>Supplier liabilities (creditors)</h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                  gap: 10,
                  fontWeight: 600,
                }}
              >
                <div>Supplier payables: {formatMoney(data.creditorTotals.supplierPayables)}</div>
                <div>Overdue: {formatMoney(data.creditorTotals.overdueSupplierPayables)}</div>
                <div>Open invoices: {data.creditorTotals.openInvoiceCount}</div>
                <div>Overdue invoices: {data.creditorTotals.overdueInvoiceCount}</div>
                <div>Payment plan commitments: {formatMoney(data.creditorTotals.paymentPlanCommitments)}</div>
                <div>Upcoming payments: {formatMoney(data.upcomingCreditors.totalUpcoming)}</div>
              </div>
              <p style={{ margin: "12px 0 0", fontSize: 12, color: "#64748b", fontWeight: 600 }}>
                From Creditors Ageing supplier invoices — not double-counted with approved expenses.
              </p>
            </div>
            <div style={sectionCard}>
              <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900 }}>Outstanding fees / debtors</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
                <div>Total outstanding: {formatMoney(data.outstandingDebtors)}</div>
                <div>Recently owing: {data.recentlyOwing.length} accounts</div>
                <div>Bad debt: {data.badDebt.length} accounts</div>
                <div>Overpaid: {data.overpaid.length} accounts</div>
              </div>
            </div>
            <div style={sectionCard}>
              <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900 }}>Fixed assets</h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                  gap: 10,
                  fontWeight: 600,
                }}
              >
                <div>Total asset value: {formatMoney(data.assetTotals.purchaseCostActive)}</div>
                <div>Net book value: {formatMoney(data.bookTotals.netBookValue)}</div>
                <div>Annual depreciation: {formatMoney(data.annualDepreciation)}</div>
                <div>Largest category: {data.topAssetCategory}</div>
                <div>Active assets: {data.assetTotals.activeCount}</div>
                <div>Disposed (history): {data.disposedAssets.length}</div>
              </div>
              <p style={{ margin: "12px 0 0", fontSize: 12, color: "#64748b", fontWeight: 600 }}>
                Asset depreciation feeds Financial Statements automatically. Disposed assets remain in the register
                for audit history.
              </p>
            </div>
            <div style={sectionCard}>
              <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900 }}>Payroll</h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                  gap: 10,
                  fontWeight: 600,
                }}
              >
                <div>Payroll cost: {formatMoney(data.payrollPosted.totalPayrollCost)}</div>
                <div>Payroll % of income: {data.payrollPctOfIncome.toFixed(1)}%</div>
                <div>Employees (posted runs): {data.payrollPosted.employeeCount}</div>
                <div>Payroll liabilities: {formatMoney(data.payrollLiabilities.total)}</div>
                <div>PAYE: {formatMoney(data.payrollPosted.paye)}</div>
                <div>
                  UIF (EE+ER):{" "}
                  {formatMoney(data.payrollPosted.uifEmployee + data.payrollPosted.uifEmployer)}
                </div>
              </div>
              <p style={{ margin: "12px 0 0", fontSize: 12, color: "#64748b", fontWeight: 600 }}>
                From Payroll runs posted to Accounting. Post each run from Payroll → Accounting panel after processing.
              </p>
            </div>
            <div style={sectionCard}>
              <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900 }}>Cash movement estimate</h2>
              <p style={{ margin: 0, fontWeight: 600 }}>
                Month net cash movement: {formatMoney(data.net)} · Forecast with expected collections:{" "}
                {formatMoney(data.forecastedCash)}
              </p>
            </div>
            {data.warnings.length ? (
              <div style={{ ...sectionCard, borderColor: "#b45309", background: "#fffbeb" }}>
                <h2 style={{ margin: "0 0 10px", fontSize: 17, fontWeight: 900 }}>Key finance warnings</h2>
                <ul style={{ margin: 0, paddingLeft: 20, fontWeight: 600 }}>
                  {data.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        );

      case "budget-actual":
        return (
          <div style={sectionCard}>
            <h2 style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 900 }}>Budget vs actual</h2>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "#64748b", fontWeight: 600 }}>
              Budget figures use Accounting planning categories; actuals from approved expenses.
            </p>
            <ReportTable
              columns={["Category", "Budgeted", "Actual", "Variance", "Variance %", "Status"]}
              rows={data.budgetRows.map((r) => [
                r.category,
                formatMoney(r.budgeted),
                formatMoney(r.actual),
                formatMoney(r.variance),
                `${r.variancePct.toFixed(1)}%`,
                r.status,
              ])}
              page={tablePage}
              onPage={setTablePage}
            />
          </div>
        );

      case "cashflow":
        return (
          <div style={sectionCard}>
            <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900 }}>Cash flow forecast — {periodLabel}</h2>
            <div style={{ display: "grid", gap: 10, fontWeight: 600 }}>
              <div>Current month income: {formatMoney(data.income)}</div>
              <div>Current month expenses: {formatMoney(data.expenses)}</div>
              <div>Net cash movement: {formatMoney(data.net)}</div>
              <div>Scheduled supplier payments: {formatMoney(data.upcomingCreditors.scheduledInvoicePayments)}</div>
              <div>Upcoming creditor payments (estimate): {formatMoney(data.upcomingCreditors.totalUpcoming)}</div>
              <div>Expected salary payments: {formatMoney(data.expectedSalaryPayments)}</div>
              <div>
                Expected collections (placeholder): {formatMoney(data.expectedCollectionsPlaceholder)} — 65% of
                outstanding debtors
              </div>
              <div style={{ fontWeight: 900, fontSize: 16 }}>
                Forecasted month-end cash position: {formatMoney(data.forecastedCash)}
              </div>
              {data.cashWarning ? (
                <div
                  style={{
                    marginTop: 8,
                    padding: 12,
                    borderRadius: 10,
                    background: "#fef2f2",
                    color: "#b91c1c",
                    fontWeight: 800,
                  }}
                >
                  Warning: projected cash position is negative for this period.
                </div>
              ) : null}
            </div>
          </div>
        );

      case "expense-analysis":
        return (
          <>
            <div style={sectionCard}>
              <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900 }}>Expenses by category</h2>
              <ReportTable
                columns={["Category", "Month spend", "% of total"]}
                rows={data.categoryRows.map((r) => [r.category, formatMoney(r.amount), `${r.pct.toFixed(1)}%`])}
                page={tablePage}
                onPage={setTablePage}
              />
            </div>
            <div style={sectionCard}>
              <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900 }}>Month-to-date &amp; over budget</h2>
              <p style={{ margin: "0 0 8px", fontWeight: 600 }}>
                Month-to-date approved spend: {formatMoney(data.expenses)} · YTD: {formatMoney(data.expensesYtd)}
              </p>
              <p style={{ margin: 0, fontWeight: 600 }}>
                Over-budget categories: {data.overBudgetCategories.length || "None"}
                {data.overBudgetCategories.length
                  ? ` — ${data.overBudgetCategories.map((c) => c.category).join(", ")}`
                  : ""}
              </p>
              <p style={{ margin: "12px 0 0", fontSize: 13, color: "#64748b" }}>
                Expense trend chart — placeholder for future analytics.
              </p>
            </div>
          </>
        );

      case "debtors":
        return (
          <>
            <div style={sectionCard}>
              <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900 }}>Debtors summary</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10, fontWeight: 600 }}>
                <div>Total outstanding: {formatMoney(data.outstandingDebtors)}</div>
                <div>Recently owing: {data.recentlyOwing.length}</div>
                <div>Bad debt: {data.badDebt.length}</div>
                <div>Overpaid: {data.overpaid.length}</div>
              </div>
              <p style={{ marginTop: 14, fontSize: 13, color: "#64748b", fontWeight: 600 }}>
                Legal recovery: use <strong>Billing → Billing Documents</strong> (Section 41, Letter of Demand, Final
                Demand) for overdue accounts aligned with Statements.
              </p>
            </div>
            <div style={sectionCard}>
              <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900 }}>Top 10 debtor accounts</h2>
              <ReportTable
                columns={["Learner", "Account", "Balance", "Status"]}
                rows={data.topDebtors.map((r) => [
                  `${r.name} ${r.surname}`.trim(),
                  r.accountNo || "-",
                  formatMoney(r.balance),
                  r.status,
                ])}
                page={tablePage}
                onPage={setTablePage}
                emptyMessage="No outstanding debtor balances."
              />
            </div>
          </>
        );

      case "supplier-spend":
        return (
          <div style={sectionCard}>
            <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900 }}>Supplier spend</h2>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "#64748b", fontWeight: 600 }}>
              Approved expense spend plus Creditors Ageing outstanding balances (not double-counted).
            </p>
            <ReportTable
              columns={[
                "Supplier",
                "Category",
                "This month",
                "YTD spend",
                "Outstanding",
                "Open inv.",
                "Overdue",
                "Payment plan",
                "Status",
              ]}
              rows={data.supplierRows.map((r) => [
                r.supplier,
                r.category,
                formatMoney(r.month),
                formatMoney(r.ytd),
                formatMoney(r.outstanding || 0),
                String(r.openInvoices || 0),
                String(r.overdueInvoices || 0),
                r.paymentPlan || "—",
                r.status,
              ])}
              page={tablePage}
              onPage={setTablePage}
              emptyMessage="No supplier spend or creditor balances for this period."
            />
          </div>
        );

      case "bank-recon":
        return (
          <>
            <div style={sectionCard}>
              <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900 }}>Bank reconciliation summary</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, fontWeight: 700 }}>
                <div>Imports: {data.bankStats.imports}</div>
                <div>Matched payments: {data.bankStats.matchedPayments}</div>
                <div>Expense candidates: {data.expenseCandidates}</div>
                <div>Unmatched: {data.bankStats.unmatched}</div>
                <div>Duplicates: {data.bankStats.duplicateLines}</div>
                <div>Ready to post: {data.bankStats.readyToPost}</div>
              </div>
            </div>
            {data.importSummaries.length ? (
              <div style={sectionCard}>
                <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900 }}>Imports</h2>
                <ReportTable
                  columns={["File", "Imported", "Lines", "Payments", "Expenses", "Unmatched", "Duplicates", "Ready"]}
                  rows={data.importSummaries.map((r) => [
                    r.fileName,
                    r.importedAt?.slice(0, 10) || "—",
                    String(r.txCount),
                    String(r.matchedPayments),
                    String(r.expenseMatched),
                    String(r.unmatched),
                    String(r.duplicates),
                    String(r.readyToPost),
                  ])}
                  page={tablePage}
                  onPage={setTablePage}
                />
              </div>
            ) : (
              <div style={sectionCard}>
                <p style={{ margin: 0, color: "#64748b", fontWeight: 600 }}>No bank imports found for this school.</p>
              </div>
            )}
          </>
        );

      case "asset-summary":
        return (
          <>
            <div style={sectionCard}>
              <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900 }}>Asset register summary</h2>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                  gap: 10,
                  fontWeight: 600,
                  marginBottom: 14,
                }}
              >
                <div>Active assets: {data.assetTotals.activeCount}</div>
                <div>Total purchase cost (active): {formatMoney(data.assetTotals.purchaseCostActive)}</div>
                <div>Net book value: {formatMoney(data.bookTotals.netBookValue)}</div>
                <div>Depreciation expense ({year}): {formatMoney(data.depTotals.expenseForYear)}</div>
              </div>
              <ReportTable
                columns={[
                  "Category",
                  "Asset count",
                  "Purchase cost",
                  "Accumulated depreciation",
                  "Net book value",
                ]}
                rows={data.assetCategorySummary.map((r) => [
                  r.category,
                  String(r.assetCount),
                  formatMoney(r.purchaseCost),
                  formatMoney(r.accumulatedDepreciation),
                  formatMoney(r.netBookValue),
                ])}
                page={tablePage}
                onPage={setTablePage}
                emptyMessage="No active fixed assets on the register."
              />
            </div>
            <div style={sectionCard}>
              <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900 }}>Asset disposal history</h2>
              <ReportTable
                columns={["Asset", "Category", "Disposal date", "Proceeds", "Reason"]}
                rows={data.disposedAssets.map((a) => [
                  a.name,
                  a.category,
                  a.disposalDate || "—",
                  formatMoney(a.disposalAmount),
                  a.disposalReason || "—",
                ])}
                page={tablePage}
                onPage={setTablePage}
                emptyMessage="No disposed assets recorded."
              />
              <p style={{ margin: "12px 0 0", fontSize: 12, color: "#64748b", fontWeight: 600 }}>
                Disposed assets remain in reports for audit history and are excluded from active asset totals.
              </p>
            </div>
          </>
        );

      case "audit-pack":
        return (
          <div style={sectionCard}>
            <h2 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 900 }}>Audit pack export</h2>
            <p style={{ margin: "0 0 16px", fontSize: 14, color: "#64748b", fontWeight: 600 }}>
              Prepare a consolidated pack for auditors. Export is a placeholder; checklist reflects data available in
              EduClear for {periodLabel}.
            </p>
            <ul style={{ margin: "0 0 20px", paddingLeft: 20, fontWeight: 600, lineHeight: 1.8 }}>
              {[
                `Income Statement — use Financial Statements (${data.income > 0 ? "data available" : "limited data"})`,
                "Balance Sheet — Financial Statements module (includes fixed assets)",
                "Trial Balance — Financial Statements module",
                `General Ledger — ${data.journalCount} journal(s) on file`,
                `Journals — ${data.postedJournals} posted`,
                `Debtors Ageing — ${formatMoney(data.outstandingDebtors)} outstanding`,
                `Creditors Ageing — ${formatMoney(data.creditorTotals.supplierPayables)} payables (${data.creditorTotals.openInvoiceCount} open invoice(s))`,
                `Supplier Invoice Listing — ${data.creditorTotals.openInvoiceCount} open, ${data.creditorTotals.overdueInvoiceCount} overdue`,
                `Supplier Payment Plans — ${data.creditorTotals.paymentPlanCommitments > 0 ? `${formatMoney(data.creditorTotals.paymentPlanCommitments)} commitments` : "none active"}`,
                `Supplier Spend — ${data.supplierRows.length} supplier(s) with spend or balances`,
                `Bank Reconciliation — ${data.bankStats.imports} import(s)`,
                `Budget vs Actual — ${data.budgetRows.length} categories`,
                `Legal Recovery History — ${legalHistoryCount} record(s)`,
                `Asset Register — ${data.assetTotals.activeCount} active asset(s), ${formatMoney(data.bookTotals.netBookValue)} net book value`,
                `Depreciation Schedule — ${formatMoney(data.depTotals.expenseForYear)} expense for ${year}`,
                `Asset Disposal History — ${data.disposedAssets.length} disposed asset(s)`,
                `Payroll Summary — ${formatMoney(data.payrollPosted.totalPayrollCost)} (${data.payrollPosted.runCount} posted run(s))`,
                `PAYE / UIF Summary — PAYE ${formatMoney(data.payrollPosted.paye)}, UIF ${formatMoney(data.payrollPosted.uifEmployee + data.payrollPosted.uifEmployer)}`,
                `Payslip Register — ${data.payslipRegister.length} line(s)`,
                `Payroll Journals — ${data.payrollJournals.length} AUTO journal(s)`,
              ].map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div
              style={{
                padding: 14,
                borderRadius: 10,
                background: "#fffbeb",
                border: `1px solid ${ACCOUNTING_GOLD}`,
                marginBottom: 16,
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              Audit pack ZIP/PDF export will be available in a future release. Use individual reports and Print in the
              meantime.
            </div>
            <button
              type="button"
              style={goldBtn}
              onClick={() =>
                setPlaceholderBanner(
                  "Prepare Audit Pack — coming soon. Run each report above and print or save individually."
                )
              }
            >
              Prepare Audit Pack
            </button>
          </div>
        );

      default:
        return null;
    }
  };

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return [current - 2, current - 1, current, current + 1];
  }, []);

  return (
    <div style={accountingPageWrap}>
      <div style={{ borderBottom: `2px solid ${ACCOUNTING_GOLD}`, paddingBottom: 18, marginBottom: 24 }}>
        <h1 style={accountingTitle}>Reports</h1>
        <p style={accountingSubtitle}>Management, audit, and forecasting reports for school finance.</p>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          alignItems: "flex-end",
          marginBottom: 20,
        }}
      >
        <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b" }}>
          Reporting basis
          <select
            style={{ ...fieldStyle, minWidth: 240 }}
            value={reportingBasis}
            onChange={(e) => setReportingBasis(e.target.value as ReportingBasis)}
          >
            {REPORTING_BASIS_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b" }}>
          {reportingBasisYearLabel(reportingBasis)}
          <select style={fieldStyle} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {reportingBasis === "sars" ? `Feb ${y}` : y}
              </option>
            ))}
          </select>
        </label>
        {reportingBasis === "month" ? (
          <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b" }}>
            Month
            <select style={fieldStyle} value={monthIndex} onChange={(e) => setMonthIndex(Number(e.target.value))}>
              {MONTH_NAMES.map((name, idx) => (
                <option key={name} value={idx}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div style={{ fontWeight: 800, fontSize: 13, color: ACCOUNTING_INK, paddingBottom: 10 }}>
          Period: {periodLabel}
        </div>
        <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b" }}>
          Report type
          <select style={{ ...fieldStyle, minWidth: 220 }} value={reportType} onChange={(e) => setReportType(e.target.value as ReportType)}>
            {REPORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" style={goldBtn} onClick={handleGenerate}>
          Generate
        </button>
        <button type="button" style={outlineBtn} onClick={handlePrint} disabled={!generated}>
          Print
        </button>
        <button type="button" style={outlineBtn} onClick={handleExportPdf} disabled={!generated}>
          Export PDF
        </button>
        <button type="button" style={outlineBtn} onClick={handleExportExcel} disabled={!generated}>
          Export Excel
        </button>
      </div>

      {placeholderBanner ? (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 10,
            background: "#fffbeb",
            border: `1px solid ${ACCOUNTING_GOLD}`,
            fontWeight: 600,
            color: "#92400e",
          }}
        >
          {placeholderBanner}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
          gap: 16,
          marginBottom: 28,
        }}
      >
        {summaryCards.map((card) => (
          <div key={card.label} style={accountingCard}>
            <div style={accountingCardLabel}>{card.label}</div>
            <div style={accountingCardValue}>{card.value}</div>
          </div>
        ))}
      </div>

      <div ref={reportRef} style={{ maxHeight: "none", overflow: "visible" }}>
        {renderReportBody()}
      </div>
    </div>
  );
}
