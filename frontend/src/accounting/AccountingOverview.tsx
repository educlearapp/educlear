import React, { useCallback, useEffect, useMemo, useState } from "react";
import { fetchBankImports, type BankImportRecord } from "../banking/bankingApi";
import {
  BILLING_UPDATED_EVENT,
  formatMoney,
  normaliseBillingAmount,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../billing/billingLedger";
import {
  ACCOUNTING_ASSETS_UPDATED_EVENT,
  calculateBookValueTotals,
  loadAssets,
} from "./accountingAssetStorage";
import {
  ACCOUNTING_EXPENSES_UPDATED_EVENT,
  filterApprovedExpensesForMonth,
  loadApprovedExpenses,
  loadExpenseCandidates,
  migrateLegacyExpenseStores,
  reviewQueueFromCandidates,
  sumApprovedExpensesByCategory,
  totalApprovedSpendForMonth,
} from "./accountingExpenseStorage";
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

type Props = {
  schoolId: string;
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

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

const fieldStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${ACCOUNTING_GOLD}`,
  fontWeight: 700,
  color: ACCOUNTING_INK,
  background: "#fff",
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

function sumPaymentsForMonth(ledger: BillingLedgerEntry[], year: number, monthIndex: number) {
  return ledger
    .filter((e) => e.type === "payment" && entryInPeriod(e.date, year, monthIndex))
    .reduce((sum, e) => sum + normaliseBillingAmount(e.amount), 0);
}

function paymentsForMonth(ledger: BillingLedgerEntry[], year: number, monthIndex: number) {
  return ledger.filter((e) => e.type === "payment" && entryInPeriod(e.date, year, monthIndex));
}

function countUnreconciledBankLines(imports: BankImportRecord[]) {
  let count = 0;
  for (const imp of imports) {
    for (const txn of imp.transactions || []) {
      const status = txn.reviewStatus;
      if (status !== "accepted" && status !== "ignored" && status !== "posted") {
        count += 1;
      }
    }
  }
  return count;
}

function formatPeriodLabel(year: number, monthIndex: number) {
  return `${MONTH_NAMES[monthIndex] || ""} ${year}`;
}

export default function AccountingOverview({ schoolId }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [monthIndex, setMonthIndex] = useState(now.getMonth());
  const [refreshKey, setRefreshKey] = useState(0);
  const [bankImports, setBankImports] = useState<BankImportRecord[]>([]);

  const bumpRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!schoolId) return;
    migrateLegacyExpenseStores(schoolId);
  }, [schoolId, refreshKey]);

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
    window.addEventListener(ACCOUNTING_EXPENSES_UPDATED_EVENT, onExpenses);
    window.addEventListener(BILLING_UPDATED_EVENT, onBilling);
    window.addEventListener(ACCOUNTING_ASSETS_UPDATED_EVENT, onAssets);
    return () => {
      window.removeEventListener(ACCOUNTING_EXPENSES_UPDATED_EVENT, onExpenses);
      window.removeEventListener(BILLING_UPDATED_EVENT, onBilling);
      window.removeEventListener(ACCOUNTING_ASSETS_UPDATED_EVENT, onAssets);
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

  const metrics = useMemo(() => {
    const sid = String(schoolId || "").trim();
    if (!sid) {
      return {
        income: 0,
        expenses: 0,
        net: 0,
        cashEstimate: 0,
        unreconciled: 0,
        expenseCandidates: 0,
        approvedCount: 0,
        paymentCount: 0,
        categoryRows: [] as { category: string; amount: number; pct: number }[],
        recentActivity: [] as { date: string; type: string; description: string; amount: number; sortKey: number }[],
        biggestCategory: "—",
        expensesExceedIncome: false,
        assetNetBookValue: 0,
        assetActiveCount: 0,
      };
    }

    const assets = loadAssets(sid);
    const assetBook = calculateBookValueTotals(assets);

    const ledger = readSchoolLedger(sid);
    const income = sumPaymentsForMonth(ledger, year, monthIndex);
    const approvedAll = loadApprovedExpenses(sid);
    const approvedMonth = filterApprovedExpensesForMonth(approvedAll, year, monthIndex);
    const expenses = totalApprovedSpendForMonth(approvedAll, year, monthIndex);
    const net = income - expenses;
    const spend = sumApprovedExpensesByCategory(approvedAll, year, monthIndex);
    const candidates = reviewQueueFromCandidates(loadExpenseCandidates(sid));
    const unreconciled = countUnreconciledBankLines(bankImports);

    const categoryRows = Array.from(spend.totals.entries())
      .map(([key, amount]) => ({
        category: spend.labels.get(key) || key,
        amount,
        pct: expenses > 0 ? (amount / expenses) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    const biggestCategory =
      categoryRows.length > 0 ? `${categoryRows[0].category} (${formatMoney(categoryRows[0].amount)})` : "—";

    const activity: {
      date: string;
      type: string;
      description: string;
      amount: number;
      sortKey: number;
    }[] = [];

    for (const row of approvedMonth) {
      const amount = normaliseBillingAmount(row.amount);
      if (amount <= 0) continue;
      const sortKey = new Date(row.date || row.approvedAt).getTime() || 0;
      activity.push({
        date: row.date,
        type: "Expense",
        description: `${row.supplier || "Supplier"} — ${row.category || "Other"}`,
        amount: -amount,
        sortKey,
      });
    }

    for (const pay of paymentsForMonth(ledger, year, monthIndex)) {
      const amount = normaliseBillingAmount(pay.amount);
      if (amount <= 0) continue;
      const sortKey = new Date(pay.date || pay.createdAt).getTime() || 0;
      activity.push({
        date: pay.date,
        type: "Income",
        description: String(pay.description || pay.reference || "Fee payment").trim() || "Fee payment",
        amount,
        sortKey,
      });
    }

    activity.sort((a, b) => b.sortKey - a.sortKey);

    return {
      income,
      expenses,
      net,
      cashEstimate: net,
      unreconciled,
      expenseCandidates: candidates.length,
      approvedCount: approvedMonth.length,
      paymentCount: paymentsForMonth(ledger, year, monthIndex).length,
      categoryRows,
      recentActivity: activity.slice(0, 12),
      biggestCategory,
      expensesExceedIncome: expenses > income && (expenses > 0 || income > 0),
      assetNetBookValue: assetBook.netBookValue,
      assetActiveCount: assets.filter((a) => a.status !== "Disposed").length,
    };
  }, [schoolId, year, monthIndex, refreshKey, bankImports]);

  const periodLabel = formatPeriodLabel(year, monthIndex);
  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return [current - 2, current - 1, current, current + 1];
  }, []);

  const cards = [
    {
      label: "Cash Position",
      value: formatMoney(metrics.cashEstimate),
      hint: "Estimated monthly cash movement (income − expenses)",
    },
    {
      label: "Income This Month",
      value: formatMoney(metrics.income),
      hint: "Fee payments received in billing ledger",
    },
    {
      label: "Expenses This Month",
      value: formatMoney(metrics.expenses),
      hint: "Approved accounting expenses",
    },
    {
      label: "Net Position",
      value: formatMoney(metrics.net),
      hint: "Income minus approved expenses",
    },
    {
      label: "Unreconciled Transactions",
      value: String(metrics.unreconciled),
      hint: "Bank lines not accepted, ignored, or posted",
    },
    {
      label: "Expense Candidates",
      value: String(metrics.expenseCandidates),
      hint: "Pending review from bank imports",
    },
    {
      label: "Asset Value (net book)",
      value: formatMoney(metrics.assetNetBookValue),
      hint: "Active fixed assets from Accounting Assets",
    },
  ];

  return (
    <div style={accountingPageWrap}>
      <div style={{ borderBottom: `2px solid ${ACCOUNTING_GOLD}`, paddingBottom: 18, marginBottom: 24 }}>
        <h1 style={accountingTitle}>Accounting Overview</h1>
        <p style={accountingSubtitle}>
          School finance at a glance for {periodLabel}. Income from Billing payments; expenses from approved
          Accounting records.
        </p>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          alignItems: "flex-end",
          marginBottom: 24,
        }}
      >
        <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b" }}>
          Year
          <select style={fieldStyle} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b" }}>
          Month
          <select
            style={fieldStyle}
            value={monthIndex}
            onChange={(e) => setMonthIndex(Number(e.target.value))}
          >
            {MONTH_NAMES.map((name, idx) => (
              <option key={name} value={idx}>
                {name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 18,
          marginBottom: 28,
        }}
      >
        {cards.map((card) => (
          <div key={card.label} style={accountingCard}>
            <div style={accountingCardLabel}>{card.label}</div>
            <div style={accountingCardValue}>{card.value}</div>
            <div style={{ marginTop: 10, fontSize: 13, color: "#64748b", fontWeight: 600 }}>{card.hint}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginBottom: 28,
          padding: 20,
          borderRadius: 12,
          border: `1px solid ${ACCOUNTING_GOLD}`,
          background: "linear-gradient(180deg, #fff 0%, #faf8f0 100%)",
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 16, color: ACCOUNTING_INK, marginBottom: 14 }}>
          Quick insights — {periodLabel}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 12,
            fontSize: 14,
            fontWeight: 600,
            color: ACCOUNTING_INK,
          }}
        >
          <div>Fee income received: {formatMoney(metrics.income)}</div>
          <div>Approved expenses: {formatMoney(metrics.expenses)} ({metrics.approvedCount} items)</div>
          <div>Pending expense candidates: {metrics.expenseCandidates}</div>
          <div>Estimated net movement: {formatMoney(metrics.net)}</div>
          <div>Biggest expense category: {metrics.biggestCategory}</div>
          <div>
            Fixed assets: {formatMoney(metrics.assetNetBookValue)} net book ({metrics.assetActiveCount} active)
          </div>
        </div>
        <p style={{ margin: "14px 0 0", fontSize: 12, color: "#64748b", fontWeight: 600 }}>
          Asset depreciation feeds Financial Statements automatically. Disposed assets remain available for audit
          history.
        </p>
        {metrics.expensesExceedIncome ? (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 10,
              background: "#fef2f2",
              color: "#b91c1c",
              fontWeight: 800,
              fontSize: 13,
            }}
          >
            Warning: approved expenses exceed fee income for {periodLabel}.
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 20,
        }}
      >
        <div>
          <div style={{ fontWeight: 900, fontSize: 15, color: ACCOUNTING_INK, marginBottom: 10 }}>
            Top Expense Categories
          </div>
          <div style={{ overflowX: "auto", borderRadius: 12, border: `1px solid ${ACCOUNTING_GOLD}` }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 280, background: "#fff" }}>
              <thead>
                <tr>
                  {["Category", "Amount", "% of Expenses"].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metrics.categoryRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ ...td, textAlign: "center", color: "#64748b" }}>
                      No approved expenses for {periodLabel}.
                    </td>
                  </tr>
                ) : (
                  metrics.categoryRows.slice(0, 8).map((row) => (
                    <tr key={row.category}>
                      <td style={td}>{row.category}</td>
                      <td style={td}>{formatMoney(row.amount)}</td>
                      <td style={td}>{row.pct.toFixed(1)}%</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div style={{ fontWeight: 900, fontSize: 15, color: ACCOUNTING_INK, marginBottom: 10 }}>
            Recent Activity
          </div>
          <div style={{ overflowX: "auto", borderRadius: 12, border: `1px solid ${ACCOUNTING_GOLD}` }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 400, background: "#fff" }}>
              <thead>
                <tr>
                  {["Date", "Type", "Description", "Amount"].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metrics.recentActivity.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ ...td, textAlign: "center", color: "#64748b" }}>
                      No payments or approved expenses for {periodLabel}.
                    </td>
                  </tr>
                ) : (
                  metrics.recentActivity.map((row, i) => (
                    <tr key={`${row.date}-${row.type}-${i}`}>
                      <td style={td}>{row.date || "—"}</td>
                      <td style={td}>{row.type}</td>
                      <td style={td}>{row.description}</td>
                      <td
                        style={{
                          ...td,
                          fontWeight: 800,
                          color: row.amount >= 0 ? "#15803d" : "#b91c1c",
                        }}
                      >
                        {row.amount >= 0 ? formatMoney(row.amount) : `−${formatMoney(Math.abs(row.amount))}`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 28,
          padding: 20,
          borderRadius: 12,
          background: ACCOUNTING_INK,
          color: ACCOUNTING_GOLD,
          fontWeight: 700,
          fontSize: 14,
        }}
      >
        Cash position is estimated from billing payments minus approved expenses until live bank balances are
        connected. Use Banking for statement import; approved bank expenses flow into Expenses automatically.
      </div>
    </div>
  );
}
