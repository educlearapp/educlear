import React, { useMemo, useState } from "react";
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

const CATEGORIES = [
  "Salaries",
  "Rent / Bond",
  "Utilities",
  "Transport",
  "Maintenance",
  "Stationery",
  "Food / Tuckshop",
  "Insurance",
  "Marketing",
  "Other",
] as const;

type BudgetCategory = (typeof CATEGORIES)[number];

type BudgetRow = {
  id: string;
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

function buildSampleRows(): BudgetRow[] {
  const samples: Array<{ category: BudgetCategory; monthly: number; actual: number; notes: string }> = [
    { category: "Salaries", monthly: 185000, actual: 172400, notes: "Teaching and admin payroll" },
    { category: "Rent / Bond", monthly: 42000, actual: 42000, notes: "Campus lease" },
    { category: "Utilities", monthly: 18500, actual: 16200, notes: "Electricity, water, refuse" },
    { category: "Transport", monthly: 12000, actual: 9800, notes: "Bus contract and fuel" },
    { category: "Maintenance", monthly: 9500, actual: 11200, notes: "Repairs — roof leak" },
    { category: "Stationery", monthly: 6500, actual: 5200, notes: "Classroom supplies" },
    { category: "Food / Tuckshop", monthly: 14000, actual: 13800, notes: "Tuckshop stock" },
    { category: "Insurance", monthly: 8800, actual: 8800, notes: "Monthly premium" },
    { category: "Marketing", monthly: 4500, actual: 2100, notes: "Open day campaign" },
    { category: "Other", monthly: 6000, actual: 4800, notes: "Miscellaneous" },
  ];
  return samples.map((s, i) => ({
    id: `budget-${i + 1}`,
    category: s.category,
    monthlyBudget: s.monthly,
    annualBudget: s.monthly * 12,
    actual: s.actual,
    notes: s.notes,
  }));
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

  return (
    <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
      <svg width={220} height={220} viewBox="0 0 220 220" aria-label="Budget allocation by category">
        {slices.map((s) => (
          <path key={s.category} d={s.path} fill={s.color} stroke="#fff" strokeWidth={2} />
        ))}
        <circle cx={110} cy={110} r={42} fill="#fff" stroke={ACCOUNTING_GOLD} strokeWidth={2} />
        <text x={110} y={106} textAnchor="middle" fontSize={11} fontWeight={800} fill={ACCOUNTING_INK}>
          Budget
        </text>
        <text x={110} y={122} textAnchor="middle" fontSize={10} fontWeight={700} fill="#64748b">
          by category
        </text>
      </svg>
      <div style={{ flex: 1, minWidth: 200, display: "grid", gap: 8 }}>
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

type ModalForm = {
  category: BudgetCategory;
  monthlyBudget: string;
  annualBudget: string;
  notes: string;
};

const emptyForm = (): ModalForm => ({
  category: "Other",
  monthlyBudget: "",
  annualBudget: "",
  notes: "",
});

export default function AccountingBudget() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [monthIndex, setMonthIndex] = useState(now.getMonth());
  const [rows, setRows] = useState<BudgetRow[]>(buildSampleRows);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ModalForm>(emptyForm);
  const [importNote, setImportNote] = useState("");

  const summary = useMemo(() => {
    const totalBudget = rows.reduce((s, r) => s + r.monthlyBudget, 0);
    const actualSpend = rows.reduce((s, r) => s + r.actual, 0);
    const remaining = totalBudget - actualSpend;
    const variancePct = totalBudget > 0 ? ((actualSpend - totalBudget) / totalBudget) * 100 : 0;
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const forecastedMonthEnd =
      dayOfMonth > 0 ? actualSpend * (daysInMonth / Math.max(dayOfMonth, 1)) : actualSpend;
    const overBudgetItems = rows.filter((r) => r.actual > r.monthlyBudget).length;
    return { totalBudget, actualSpend, remaining, variancePct, forecastedMonthEnd, overBudgetItems };
  }, [rows, year, monthIndex, now]);

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm());
    setModalOpen(true);
  };

  const openEdit = (row: BudgetRow) => {
    setEditingId(row.id);
    setForm({
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
      category: form.category,
      monthlyBudget: monthly || annual / 12,
      annualBudget: annual || monthly * 12,
      actual: editingId ? rows.find((r) => r.id === editingId)?.actual ?? 0 : 0,
      notes: form.notes.trim(),
    };

    if (editingId) {
      setRows((prev) => prev.map((r) => (r.id === editingId ? payload : r)));
    } else {
      const exists = rows.some((r) => r.category === payload.category);
      if (exists) {
        setRows((prev) => prev.map((r) => (r.category === payload.category ? { ...payload, id: r.id, actual: r.actual } : r)));
      } else {
        setRows((prev) => [...prev, payload]);
      }
    }
    closeModal();
  };

  const importPreviousYear = () => {
    const prevYear = year - 1;
    setRows((prev) =>
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

  return (
    <div style={accountingPageWrap}>
      <div style={{ borderBottom: `2px solid ${ACCOUNTING_GOLD}`, paddingBottom: 18, marginBottom: 24 }}>
        <h1 style={accountingTitle}>Budget</h1>
        <p style={accountingSubtitle}>Plan, monitor, and forecast school finances.</p>
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
            marginBottom: 20,
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
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 16,
          marginBottom: 24,
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
          marginBottom: 24,
          border: `2px solid ${ACCOUNTING_GOLD}`,
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 16, color: ACCOUNTING_INK, marginBottom: 16 }}>
          Budget allocation by category
        </div>
        <BudgetPieChart rows={rows} />
      </div>

      <div
        style={{
          marginBottom: 16,
          padding: 14,
          borderRadius: 10,
          background: ACCOUNTING_INK,
          color: ACCOUNTING_GOLD,
          fontWeight: 700,
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        Actual spend will update automatically from approved expenses. Forecast uses current month spend trend
        (day {now.getDate()} of {new Date(year, monthIndex + 1, 0).getDate()}).
      </div>

      <div style={{ fontWeight: 900, fontSize: 18, color: ACCOUNTING_INK, marginBottom: 12 }}>Budget vs Actual</div>

      <div style={{ overflowX: "auto", border: `1px solid ${ACCOUNTING_GOLD}`, borderRadius: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
          <thead>
            <tr style={{ background: "rgba(212,175,55,0.16)" }}>
              {["Category", "Budgeted", "Actual", "Remaining", "Variance %", "Status", "Actions"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: 12,
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
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9", fontWeight: 800 }}>{row.category}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{formatMoney(row.monthlyBudget)}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{formatMoney(row.actual)}</td>
                  <td
                    style={{
                      padding: 12,
                      borderBottom: "1px solid #f1f5f9",
                      color: remaining < 0 ? "#b91c1c" : ACCOUNTING_INK,
                      fontWeight: 700,
                    }}
                  >
                    {formatMoney(remaining)}
                  </td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{formatPct(variancePct)}</td>
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>
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
                  <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>
                    <button
                      type="button"
                      style={{
                        ...outlineBtn,
                        padding: "6px 12px",
                        fontSize: 12,
                      }}
                      onClick={() => openEdit(row)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
                Category
                <select
                  style={fieldStyle}
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as BudgetCategory }))}
                >
                  {CATEGORIES.map((c) => (
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
