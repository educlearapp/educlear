import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ACCOUNTING_EXPENSES_UPDATED_EVENT,
  actualSpendForBudgetCategory,
  loadApprovedExpenses,
  normalizeExpenseCategory,
  sumApprovedExpensesByCategory,
  type ApprovedSpendByCategory,
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

const INCOME_CATEGORIES = [
  "School Fees",
  "Registration Fees",
  "Aftercare",
  "Transport Fees",
  "Tuckshop Income",
  "Fundraising",
  "Other Income",
] as const;

const EXPENSE_CATEGORIES = [
  "Salaries",
  "Rent / Bond",
  "Electricity",
  "Utilities",
  "Transport",
  "Maintenance",
  "Stationery",
  "Food / Tuckshop",
  "Insurance",
  "Marketing",
  "Other",
] as const;

type BudgetSection = "Income" | "Expense";
type IncomeCategory = (typeof INCOME_CATEGORIES)[number];
type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
type BudgetCategory = IncomeCategory | ExpenseCategory;

type BudgetPage = {
  id: string;
  label: string;
  section?: BudgetSection;
  category?: BudgetCategory;
};

const BUDGET_PAGES: BudgetPage[] = [
  { id: "overview", label: "Overview" },
  { id: "income", label: "Income", section: "Income" },
  { id: "salaries", label: "Salaries", section: "Expense", category: "Salaries" },
  { id: "rent", label: "Rent / Bond", section: "Expense", category: "Rent / Bond" },
  { id: "electricity", label: "Electricity", section: "Expense", category: "Electricity" },
  { id: "utilities", label: "Utilities", section: "Expense", category: "Utilities" },
  { id: "transport", label: "Transport", section: "Expense", category: "Transport" },
  { id: "maintenance", label: "Maintenance", section: "Expense", category: "Maintenance" },
  { id: "stationery", label: "Stationery", section: "Expense", category: "Stationery" },
  { id: "food", label: "Food / Tuckshop", section: "Expense", category: "Food / Tuckshop" },
  { id: "insurance", label: "Insurance", section: "Expense", category: "Insurance" },
  { id: "marketing", label: "Marketing", section: "Expense", category: "Marketing" },
  { id: "other", label: "Other", section: "Expense", category: "Other" },
];

type BudgetRow = {
  id: string;
  section: BudgetSection;
  category: BudgetCategory;
  monthlyBudget: number;
  annualBudget: number;
  actual: number;
  notes: string;
};

const PIE_COLORS = [
  "#d4af37",
  "#b89329",
  "#9a7b1f",
  "#7c6318",
  "#5e4b12",
  "#c9a227",
  "#e8c547",
  "#a67c00",
  "#8b6914",
  "#6b5210",
];

const MONTHS = [
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
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  fontWeight: 600,
  marginTop: 6,
};

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.55)",
  zIndex: 5000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
};

const modalPanel: React.CSSProperties = {
  background: "#fff",
  border: `2px solid ${ACCOUNTING_GOLD}`,
  borderRadius: 14,
  width: "min(480px, 100%)",
  maxHeight: "90vh",
  overflow: "auto",
  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
};

function formatMoney(value: number) {
  const n = Number.isFinite(value) ? value : 0;
  return `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPct(value: number) {
  if (!Number.isFinite(value)) return "0%";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function statusForRow(budgeted: number, actual: number): "green" | "amber" | "red" {
  if (budgeted <= 0) return actual > 0 ? "red" : "green";
  const ratio = actual / budgeted;
  if (ratio > 1) return "red";
  if (ratio >= 0.85) return "amber";
  return "green";
}

const STATUS_STYLE: Record<"green" | "amber" | "red", React.CSSProperties> = {
  green: { background: "#dcfce7", color: "#166534", border: "1px solid #86efac" },
  amber: { background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d" },
  red: { background: "#fee2e2", color: "#b91c1c", border: "1px solid #fca5a5" },
};

const STATUS_LABEL: Record<"green" | "amber" | "red", string> = {
  green: "On track",
  amber: "Near limit",
  red: "Over budget",
};

function categoriesForSection(section: BudgetSection): readonly BudgetCategory[] {
  return section === "Income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

function buildSampleRows(): BudgetRow[] {
  const incomeSamples: Array<{ category: IncomeCategory; monthly: number; actual: number; notes: string }> = [
    { category: "School Fees", monthly: 320000, actual: 298500, notes: "Tuition billed" },
    { category: "Registration Fees", monthly: 18000, actual: 16200, notes: "New enrolments" },
    { category: "Aftercare", monthly: 22000, actual: 20500, notes: "Aftercare programme" },
    { category: "Transport Fees", monthly: 45000, actual: 43100, notes: "Bus fees" },
    { category: "Tuckshop Income", monthly: 12000, actual: 11400, notes: "Tuckshop sales" },
    { category: "Fundraising", monthly: 8000, actual: 5200, notes: "Spring gala" },
    { category: "Other Income", monthly: 5000, actual: 3800, notes: "Miscellaneous income" },
  ];

  const expenseSamples: Array<{ category: ExpenseCategory; monthly: number; notes: string }> = [
    { category: "Salaries", monthly: 185000, notes: "Teaching and admin payroll" },
    { category: "Rent / Bond", monthly: 42000, notes: "Campus lease" },
    { category: "Electricity", monthly: 12000, notes: "Electricity — main campus" },
    { category: "Utilities", monthly: 18500, notes: "Water, refuse, and shared utilities" },
    { category: "Transport", monthly: 12000, notes: "Bus contract and fuel" },
    { category: "Maintenance", monthly: 9500, notes: "Repairs and upkeep" },
    { category: "Stationery", monthly: 6500, notes: "Classroom supplies" },
    { category: "Food / Tuckshop", monthly: 14000, notes: "Tuckshop stock" },
    { category: "Insurance", monthly: 8800, notes: "Monthly premium" },
    { category: "Marketing", monthly: 4500, notes: "Open day campaign" },
    { category: "Other", monthly: 6000, notes: "Miscellaneous" },
  ];

  const incomeRows = incomeSamples.map((s, i) => ({
    id: `income-${i + 1}`,
    section: "Income" as const,
    category: s.category,
    monthlyBudget: s.monthly,
    annualBudget: s.monthly * 12,
    actual: s.actual,
    notes: s.notes,
  }));

  const expenseRows = expenseSamples.map((s, i) => ({
    id: `expense-${i + 1}`,
    section: "Expense" as const,
    category: s.category,
    monthlyBudget: s.monthly,
    annualBudget: s.monthly * 12,
    actual: 0,
    notes: s.notes,
  }));

  return [...incomeRows, ...expenseRows];
}

function applyApprovedActualsToRows(
  budgetRows: BudgetRow[],
  spend: ApprovedSpendByCategory
): BudgetRow[] {
  const expenseNormKeys = new Set(
    budgetRows.filter((r) => r.section === "Expense").map((r) => normalizeExpenseCategory(r.category))
  );

  const withActual = budgetRows.map((row) => {
    if (row.section === "Income") return row;
    return {
      ...row,
      actual: actualSpendForBudgetCategory(spend, row.category),
    };
  });

  for (const [normKey, amount] of spend.totals.entries()) {
    if (!normKey || amount <= 0) continue;
    if (expenseNormKeys.has(normKey)) continue;
    const label = spend.labels.get(normKey) || normKey;
    withActual.push({
      id: `expense-approved-${normKey.replace(/\s+/g, "-")}`,
      section: "Expense",
      category: label as BudgetCategory,
      monthlyBudget: 0,
      annualBudget: 0,
      actual: amount,
      notes: "From approved Accounting Expenses",
    });
  }

  return withActual;
}

function rowsForPage(rows: BudgetRow[], page: BudgetPage): BudgetRow[] {
  if (page.id === "overview") return [];
  if (page.id === "income") return rows.filter((r) => r.section === "Income");
  if (page.section === "Expense" && page.category) {
    return rows.filter((r) => r.section === "Expense" && r.category === page.category);
  }
  return [];
}

function BudgetPieChart({ rows }: { rows: BudgetRow[] }) {
  const slices = useMemo(() => {
    const total = rows.reduce((s, r) => s + r.monthlyBudget, 0) || 1;
    let angle = -90;
    return rows.map((row, i) => {
      const pct = row.monthlyBudget / total;
      const sweep = pct * 360;
      const start = angle;
      angle += sweep;
      const end = angle;
      const r = 88;
      const cx = 110;
      const cy = 110;
      const toRad = (deg: number) => (deg * Math.PI) / 180;
      const x1 = cx + r * Math.cos(toRad(start));
      const y1 = cy + r * Math.sin(toRad(start));
      const x2 = cx + r * Math.cos(toRad(end));
      const y2 = cy + r * Math.sin(toRad(end));
      const large = sweep > 180 ? 1 : 0;
      const path =
        pct >= 0.999
          ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`
          : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
      return { path, color: PIE_COLORS[i % PIE_COLORS.length], category: row.category, pct };
    });
  }, [rows]);

  if (!rows.length) {
    return (
      <div style={{ color: "#64748b", fontWeight: 600, fontSize: 14 }}>No expense budget lines to chart.</div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
      <svg width={220} height={220} viewBox="0 0 220 220" aria-label="Budget allocation by category">
        {slices.map((s) => (
          <path key={s.category} d={s.path} fill={s.color} stroke="#fff" strokeWidth={2} />
        ))}
        <circle cx={110} cy={110} r={42} fill="#fff" stroke={ACCOUNTING_GOLD} strokeWidth={2} />
        <text x={110} y={106} textAnchor="middle" fontSize={11} fontWeight={800} fill={ACCOUNTING_INK}>
          Expenses
        </text>
        <text x={110} y={122} textAnchor="middle" fontSize={10} fontWeight={700} fill="#64748b">
          by category
        </text>
      </svg>
      <div style={{ flex: 1, minWidth: 200, display: "grid", gap: 8, maxHeight: 200, overflowY: "auto" }}>
        {slices.map((s) => (
          <div key={s.category} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 700 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span style={{ flex: 1, color: ACCOUNTING_INK }}>{s.category}</span>
            <span style={{ color: "#64748b" }}>{(s.pct * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BudgetVsActualTable({
  rows,
  onEdit,
  emptyMessage,
}: {
  rows: BudgetRow[];
  onEdit: (row: BudgetRow) => void;
  emptyMessage: string;
}) {
  if (!rows.length) {
    return (
      <div
        style={{
          padding: 28,
          textAlign: "center",
          color: "#64748b",
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
      <thead>
        <tr style={{ background: "rgba(212,175,55,0.16)" }}>
          {["Category", "Budgeted", "Actual", "Remaining", "Variance %", "Status", "Actions"].map((h) => (
            <th
              key={h}
              style={{
                padding: 10,
                textAlign: "left",
                fontSize: 12,
                fontWeight: 900,
                color: ACCOUNTING_INK,
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const remaining = row.monthlyBudget - row.actual;
          const variancePct =
            row.monthlyBudget > 0 ? ((row.actual - row.monthlyBudget) / row.monthlyBudget) * 100 : 0;
          const status = statusForRow(row.monthlyBudget, row.actual);
          return (
            <tr key={row.id}>
              <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9", fontWeight: 800 }}>{row.category}</td>
              <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{formatMoney(row.monthlyBudget)}</td>
              <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{formatMoney(row.actual)}</td>
              <td
                style={{
                  padding: 10,
                  borderBottom: "1px solid #f1f5f9",
                  color: remaining < 0 ? "#b91c1c" : ACCOUNTING_INK,
                  fontWeight: 700,
                }}
              >
                {formatMoney(remaining)}
              </td>
              <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{formatPct(variancePct)}</td>
              <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>
                <span
                  style={{
                    ...STATUS_STYLE[status],
                    padding: "4px 10px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {STATUS_LABEL[status]}
                </span>
              </td>
              <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>
                <button
                  type="button"
                  style={{ ...outlineBtn, padding: "6px 12px", fontSize: 12 }}
                  onClick={() => onEdit(row)}
                >
                  Edit
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function OverviewPanel({
  expenseRows,
  incomeRows,
}: {
  expenseRows: BudgetRow[];
  incomeRows: BudgetRow[];
}) {
  const totalBudget = expenseRows.reduce((s, r) => s + r.monthlyBudget, 0);
  const totalActual = expenseRows.reduce((s, r) => s + r.actual, 0);
  const remaining = totalBudget - totalActual;
  const overBudgetCount = expenseRows.filter((r) => r.actual > r.monthlyBudget).length;
  const incomeActual = incomeRows.reduce((s, r) => s + r.actual, 0);
  const incomeBudget = incomeRows.reduce((s, r) => s + r.monthlyBudget, 0);

  const top5 = useMemo(
    () =>
      [...expenseRows]
        .sort((a, b) => b.actual - a.actual)
        .slice(0, 5)
        .map((r) => ({
          category: r.category,
          actual: r.actual,
          budget: r.monthlyBudget,
          status: statusForRow(r.monthlyBudget, r.actual),
        })),
    [expenseRows]
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 12,
        }}
      >
        {[
          { label: "Total Budget", value: formatMoney(totalBudget) },
          { label: "Total Actual", value: formatMoney(totalActual) },
          { label: "Remaining", value: formatMoney(remaining) },
          { label: "Over Budget Count", value: String(overBudgetCount) },
          { label: "Income Budget", value: formatMoney(incomeBudget) },
          { label: "Income Actual", value: formatMoney(incomeActual) },
        ].map((card) => (
          <div
            key={card.label}
            style={{
              padding: "14px 16px",
              borderRadius: 12,
              border: `1px solid ${ACCOUNTING_GOLD}`,
              background: "linear-gradient(180deg, #fff 0%, #faf8f0 100%)",
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase" }}>
              {card.label}
            </div>
            <div style={{ marginTop: 6, fontSize: 22, fontWeight: 900, color: ACCOUNTING_INK }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          border: `1px solid ${ACCOUNTING_GOLD}`,
          borderRadius: 12,
          padding: 16,
          background: "#fff",
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 15, color: ACCOUNTING_INK, marginBottom: 12 }}>
          Top 5 categories by spend
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {top5.map((item, i) => (
            <div
              key={item.category}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 10,
                background: "rgba(212,175,55,0.08)",
              }}
            >
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: ACCOUNTING_INK,
                  color: ACCOUNTING_GOLD,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 900,
                  fontSize: 13,
                }}
              >
                {i + 1}
              </span>
              <span style={{ flex: 1, fontWeight: 800, color: ACCOUNTING_INK }}>{item.category}</span>
              <span style={{ fontWeight: 700, color: "#64748b" }}>{formatMoney(item.actual)}</span>
              <span
                style={{
                  ...STATUS_STYLE[item.status],
                  padding: "4px 10px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 800,
                }}
              >
                {STATUS_LABEL[item.status]}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type ModalForm = {
  section: BudgetSection;
  category: BudgetCategory;
  monthlyBudget: string;
  annualBudget: string;
  notes: string;
};

const emptyForm = (): ModalForm => ({
  section: "Expense",
  category: "Other",
  monthlyBudget: "",
  annualBudget: "",
  notes: "",
});

type BudgetProps = {
  schoolId?: string;
};

export default function AccountingBudget({ schoolId = "" }: BudgetProps) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [monthIndex, setMonthIndex] = useState(now.getMonth());
  const [budgetRows, setBudgetRows] = useState<BudgetRow[]>(buildSampleRows);
  const [expensesRefreshKey, setExpensesRefreshKey] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ModalForm>(emptyForm);
  const [importNote, setImportNote] = useState("");

  const refreshApprovedSpend = useCallback(() => {
    setExpensesRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ schoolId?: string }>).detail;
      const eventSchool = String(detail?.schoolId || "").trim();
      const activeSchool = String(schoolId || "").trim();
      if (!activeSchool || !eventSchool || eventSchool === activeSchool) {
        refreshApprovedSpend();
      }
    };
    window.addEventListener(ACCOUNTING_EXPENSES_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(ACCOUNTING_EXPENSES_UPDATED_EVENT, onUpdated);
  }, [schoolId, refreshApprovedSpend]);

  const approvedSpend = useMemo(() => {
    void expensesRefreshKey;
    const approved = loadApprovedExpenses(schoolId);
    return sumApprovedExpensesByCategory(approved, year, monthIndex);
  }, [schoolId, year, monthIndex, expensesRefreshKey]);

  const rows = useMemo(
    () => applyApprovedActualsToRows(budgetRows, approvedSpend),
    [budgetRows, approvedSpend]
  );

  const currentPage = BUDGET_PAGES[pageIndex];
  const expenseRows = useMemo(() => rows.filter((r) => r.section === "Expense"), [rows]);
  const incomeRows = useMemo(() => rows.filter((r) => r.section === "Income"), [rows]);
  const pageRows = useMemo(() => rowsForPage(rows, currentPage), [rows, currentPage]);

  const summary = useMemo(() => {
    const totalBudget = expenseRows.reduce((s, r) => s + r.monthlyBudget, 0);
    const actualSpend = expenseRows.reduce((s, r) => s + r.actual, 0);
    const remaining = totalBudget - actualSpend;
    const variancePct = totalBudget > 0 ? ((actualSpend - totalBudget) / totalBudget) * 100 : 0;
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const isCurrentMonth = year === now.getFullYear() && monthIndex === now.getMonth();
    const dayOfMonth = isCurrentMonth ? now.getDate() : daysInMonth;
    const forecastedMonthEnd =
      isCurrentMonth && dayOfMonth > 0
        ? actualSpend * (daysInMonth / dayOfMonth)
        : actualSpend;
    const overBudgetItems = expenseRows.filter(
      (r) => r.monthlyBudget > 0 && r.actual > r.monthlyBudget
    ).length;
    return { totalBudget, actualSpend, remaining, variancePct, forecastedMonthEnd, overBudgetItems };
  }, [expenseRows, year, monthIndex, now]);

  const openAdd = () => {
    setEditingId(null);
    const defaultSection: BudgetSection =
      currentPage.section === "Income" ? "Income" : currentPage.section === "Expense" ? "Expense" : "Expense";
    const cats = categoriesForSection(defaultSection);
    const defaultCategory =
      currentPage.category && cats.includes(currentPage.category as BudgetCategory)
        ? (currentPage.category as BudgetCategory)
        : cats[0];
    setForm({
      section: defaultSection,
      category: defaultCategory,
      monthlyBudget: "",
      annualBudget: "",
      notes: "",
    });
    setModalOpen(true);
  };

  const openEdit = (row: BudgetRow) => {
    setEditingId(row.id);
    setForm({
      section: row.section,
      category: row.category,
      monthlyBudget: String(row.monthlyBudget),
      annualBudget: String(row.annualBudget),
      notes: row.notes,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    setForm(emptyForm());
  };

  const onSectionChange = (section: BudgetSection) => {
    const cats = categoriesForSection(section);
    setForm((f) => ({
      ...f,
      section,
      category: cats.includes(f.category as BudgetCategory) ? f.category : cats[0],
    }));
  };

  const onMonthlyChange = (value: string) => {
    const monthly = parseFloat(value) || 0;
    setForm((f) => ({
      ...f,
      monthlyBudget: value,
      annualBudget: monthly > 0 ? String(Math.round(monthly * 12)) : f.annualBudget,
    }));
  };

  const onAnnualChange = (value: string) => {
    const annual = parseFloat(value) || 0;
    setForm((f) => ({
      ...f,
      annualBudget: value,
      monthlyBudget: annual > 0 ? String(Math.round((annual / 12) * 100) / 100) : f.monthlyBudget,
    }));
  };

  const saveItem = () => {
    const monthly = parseFloat(form.monthlyBudget) || 0;
    const annual = parseFloat(form.annualBudget) || monthly * 12;
    if (!monthly && !annual) return;

    const payload: BudgetRow = {
      id: editingId || `budget-${Date.now()}`,
      section: form.section,
      category: form.category,
      monthlyBudget: monthly || annual / 12,
      annualBudget: annual || monthly * 12,
      actual: 0,
      notes: form.notes.trim(),
    };

    if (editingId) {
      setBudgetRows((prev) => prev.map((r) => (r.id === editingId ? payload : r)));
    } else {
      const exists = budgetRows.some((r) => r.section === payload.section && r.category === payload.category);
      if (exists) {
        setBudgetRows((prev) =>
          prev.map((r) =>
            r.section === payload.section && r.category === payload.category ? { ...payload, id: r.id } : r
          )
        );
      } else {
        setBudgetRows((prev) => [...prev, payload]);
      }
    }
    closeModal();
  };

  const importPreviousYear = () => {
    const prevYear = year - 1;
    setBudgetRows((prev) =>
      prev.map((r) => ({
        ...r,
        notes: r.notes || `Imported baseline from ${prevYear}`,
      }))
    );
    setImportNote(`Budget lines copied from ${prevYear} as a starting point. Adjust monthly amounts as needed.`);
  };

  const yearOptions = useMemo(() => {
    const y = now.getFullYear();
    return [y - 1, y, y + 1];
  }, [now]);

  const goPrev = () => setPageIndex((i) => Math.max(0, i - 1));
  const goNext = () => setPageIndex((i) => Math.min(BUDGET_PAGES.length - 1, i + 1));

  const formCategories = categoriesForSection(form.section);

  return (
    <div style={{ ...accountingPageWrap, maxWidth: 1200 }}>
      <div style={{ borderBottom: `2px solid ${ACCOUNTING_GOLD}`, paddingBottom: 18, marginBottom: 20 }}>
        <h1 style={accountingTitle}>Budget</h1>
        <p style={accountingSubtitle}>Plan, monitor, and forecast school finances.</p>
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
        <label style={{ fontWeight: 800, fontSize: 13, color: ACCOUNTING_INK }}>
          Year
          <select
            style={{ ...fieldStyle, minWidth: 100, display: "block" }}
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontWeight: 800, fontSize: 13, color: ACCOUNTING_INK }}>
          Month
          <select
            style={{ ...fieldStyle, minWidth: 160, display: "block" }}
            value={monthIndex}
            onChange={(e) => setMonthIndex(Number(e.target.value))}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <button type="button" style={goldBtn} onClick={openAdd}>
          Add Budget Item
        </button>
        <button type="button" style={outlineBtn} onClick={importPreviousYear}>
          Import From Previous Year
        </button>
      </div>

      {importNote ? (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 10,
            background: "#fffbeb",
            color: "#92400e",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {importNote}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {[
          { label: "Total Budget", value: formatMoney(summary.totalBudget) },
          { label: "Actual Spend", value: formatMoney(summary.actualSpend) },
          { label: "Remaining Budget", value: formatMoney(summary.remaining) },
          { label: "Variance", value: formatPct(summary.variancePct) },
          { label: "Forecasted Month End", value: formatMoney(summary.forecastedMonthEnd) },
          { label: "Over Budget Items", value: String(summary.overBudgetItems) },
        ].map((card) => (
          <div key={card.label} style={accountingCard}>
            <div style={accountingCardLabel}>{card.label}</div>
            <div style={accountingCardValue}>{card.value}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          ...accountingCard,
          marginBottom: 16,
          border: `2px solid ${ACCOUNTING_GOLD}`,
          padding: "16px 20px",
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 16, color: ACCOUNTING_INK, marginBottom: 12 }}>
          Expense allocation by category
        </div>
        <BudgetPieChart rows={expenseRows} />
      </div>

      <div
        style={{
          marginBottom: 14,
          padding: "10px 14px",
          borderRadius: 10,
          background: ACCOUNTING_INK,
          color: ACCOUNTING_GOLD,
          fontWeight: 700,
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        Actual spend is calculated automatically from approved Accounting Expenses for {MONTHS[monthIndex]}{" "}
        {year}. Forecast uses month-to-date approved spend
        {year === now.getFullYear() && monthIndex === now.getMonth()
          ? ` (day ${now.getDate()} of ${new Date(year, monthIndex + 1, 0).getDate()})`
          : ""}
        .
      </div>

      <div
        style={{
          border: `2px solid ${ACCOUNTING_GOLD}`,
          borderRadius: 14,
          background: "#fff",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: `1px solid ${ACCOUNTING_GOLD}`,
            background: "linear-gradient(180deg, #faf8f0 0%, #fff 100%)",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 17, color: ACCOUNTING_INK, marginBottom: 10 }}>
            Budget vs Actual — {currentPage.label}
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 10,
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                style={{ ...outlineBtn, padding: "8px 14px", fontSize: 13 }}
                onClick={goPrev}
                disabled={pageIndex === 0}
              >
                Previous
              </button>
              <span
                style={{
                  padding: "8px 14px",
                  borderRadius: 10,
                  background: ACCOUNTING_INK,
                  color: ACCOUNTING_GOLD,
                  fontWeight: 900,
                  fontSize: 13,
                  minWidth: 72,
                  textAlign: "center",
                }}
              >
                Page {pageIndex + 1} / {BUDGET_PAGES.length}
              </span>
              <button
                type="button"
                style={{ ...outlineBtn, padding: "8px 14px", fontSize: 13 }}
                onClick={goNext}
                disabled={pageIndex >= BUDGET_PAGES.length - 1}
              >
                Next
              </button>
            </div>
            <span
              style={{
                padding: "6px 14px",
                borderRadius: 999,
                border: `2px solid ${ACCOUNTING_GOLD}`,
                background: "#fff",
                fontWeight: 900,
                fontSize: 13,
                color: ACCOUNTING_INK,
              }}
            >
              {currentPage.label}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginTop: 12,
            }}
          >
            {BUDGET_PAGES.map((page, i) => (
              <button
                key={page.id}
                type="button"
                onClick={() => setPageIndex(i)}
                style={{
                  padding: "5px 10px",
                  borderRadius: 999,
                  border: `1px solid ${i === pageIndex ? ACCOUNTING_GOLD : "#cbd5e1"}`,
                  background: i === pageIndex ? ACCOUNTING_INK : "#fff",
                  color: i === pageIndex ? ACCOUNTING_GOLD : ACCOUNTING_INK,
                  fontWeight: 800,
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                {page.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: "12px 16px 16px", maxHeight: "min(420px, 42vh)", overflowY: "auto" }}>
          {currentPage.id === "overview" ? (
            <OverviewPanel expenseRows={expenseRows} incomeRows={incomeRows} />
          ) : (
            <BudgetVsActualTable
              rows={pageRows}
              onEdit={openEdit}
              emptyMessage={`No budget lines for ${currentPage.label}. Use Add Budget Item to create one.`}
            />
          )}
        </div>
      </div>

      {modalOpen ? (
        <div style={overlay} onClick={closeModal}>
          <div
            style={modalPanel}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="budget-modal-title"
          >
            <div
              style={{
                padding: "18px 22px",
                borderBottom: `1px solid ${ACCOUNTING_GOLD}`,
                background: ACCOUNTING_INK,
                color: ACCOUNTING_GOLD,
              }}
            >
              <div id="budget-modal-title" style={{ fontWeight: 900, fontSize: 18 }}>
                {editingId ? "Edit Budget Item" : "Add Budget Item"}
              </div>
            </div>
            <div style={{ padding: 22, display: "grid", gap: 14 }}>
              <label style={{ fontWeight: 800, fontSize: 13 }}>
                Section
                <select
                  style={fieldStyle}
                  value={form.section}
                  onChange={(e) => onSectionChange(e.target.value as BudgetSection)}
                >
                  <option value="Income">Income</option>
                  <option value="Expense">Expense</option>
                </select>
              </label>
              <label style={{ fontWeight: 800, fontSize: 13 }}>
                Category
                <select
                  style={fieldStyle}
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as BudgetCategory }))}
                >
                  {formCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ fontWeight: 800, fontSize: 13 }}>
                Monthly Budget (R)
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  style={fieldStyle}
                  value={form.monthlyBudget}
                  onChange={(e) => onMonthlyChange(e.target.value)}
                />
              </label>
              <label style={{ fontWeight: 800, fontSize: 13 }}>
                Annual Budget (R)
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  style={fieldStyle}
                  value={form.annualBudget}
                  onChange={(e) => onAnnualChange(e.target.value)}
                />
              </label>
              <label style={{ fontWeight: 800, fontSize: 13 }}>
                Notes
                <textarea
                  style={{ ...fieldStyle, minHeight: 80, resize: "vertical" }}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </label>
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                <button type="button" style={outlineBtn} onClick={closeModal}>
                  Cancel
                </button>
                <button type="button" style={goldBtn} onClick={saveItem}>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
