import React, { useEffect, useMemo, useState } from "react";
import { API_URL } from "../api";
import { staffAuthHeaders } from "../auth/staffAuthHeaders";
import { formatMoney } from "./billingLedger";
import {
  filterOutstandingAccounts,
  OUTSTANDING_BALANCE_RANGES,
  OUTSTANDING_DAYS_OVERDUE_OPTIONS,
  summarizeFilteredOutstanding,
  type OutstandingBalanceRangeKey,
  type OutstandingDaysOverdueKey,
} from "./outstandingAccountsFilters";

const GOLD = "#d4af37";

export type OutstandingAccountApiRow = {
  familyAccountId: string | null;
  accountRef: string;
  accountNumber: string;
  learnerNames: string[];
  memberLearnerIds: string[];
  grades: string[];
  classes: string[];
  outstandingBalance: number;
  parentGuardianName: string | null;
  primaryCellphone: string | null;
  alternateContact: string | null;
  email: string | null;
  lastPaymentDate: string | null;
  lastPaymentAmount: number | null;
  daysOverdue: number | null;
  oldestDueDate: string | null;
};

type Summary = {
  totalOutstanding: number;
  outstandingAccountCount: number;
  learnersAffected: number;
};

type Props = {
  schoolId: string;
};

const pageWrap: React.CSSProperties = {
  padding: "8px 4px 24px",
};

const heading: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 900,
  color: "#0f172a",
  margin: "0 0 6px",
};

const subtitle: React.CSSProperties = {
  fontSize: 14,
  color: "#64748b",
  marginBottom: 18,
};

const summaryWrap: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(160px, 1fr))",
  gap: 12,
  marginBottom: 18,
};

const summaryCard: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid rgba(15,23,42,0.08)",
  borderTop: `3px solid ${GOLD}`,
  borderRadius: 14,
  padding: 16,
  boxShadow: "0 10px 26px rgba(15,23,42,0.06)",
};

const summaryValue: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 900,
  color: "#0f172a",
  marginBottom: 4,
};

const summaryLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const filterRow: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
  marginBottom: 14,
  alignItems: "center",
};

const inputStyle: React.CSSProperties = {
  border: "1px solid #cbd5e1",
  borderRadius: 10,
  padding: "8px 12px",
  fontSize: 13,
  minWidth: 160,
  background: "#fff",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  minWidth: 140,
};

const tableWrap: React.CSSProperties = {
  overflowX: "auto",
  border: "1px solid rgba(15,23,42,0.08)",
  borderRadius: 14,
  background: "#fff",
  boxShadow: "0 10px 26px rgba(15,23,42,0.04)",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  fontSize: 11,
  fontWeight: 900,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  borderBottom: "1px solid #e2e8f0",
  whiteSpace: "nowrap",
  background: "#f8fafc",
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 13,
  color: "#0f172a",
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "top",
};

function dash(value: string | null | undefined): string {
  const s = String(value || "").trim();
  return s || "—";
}

function formatLastPayment(date: string | null, amount: number | null): string {
  const d = String(date || "").trim();
  const hasAmount = amount != null && Number.isFinite(Number(amount)) && Number(amount) !== 0;
  if (!d && !hasAmount) return "—";
  if (d && hasAmount) return `${d} · ${formatMoney(Number(amount))}`;
  if (d) return d;
  return formatMoney(Number(amount));
}

function joinLabels(values: string[]): string {
  const cleaned = (values || []).map((v) => String(v || "").trim()).filter(Boolean);
  return cleaned.length ? cleaned.join(" · ") : "—";
}

export default function OutstandingAccountsReport({ schoolId }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<OutstandingAccountApiRow[]>([]);
  const [serverSummary, setServerSummary] = useState<Summary | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const [search, setSearch] = useState("");
  const [grade, setGrade] = useState("all");
  const [className, setClassName] = useState("all");
  const [balanceRange, setBalanceRange] = useState<OutstandingBalanceRangeKey>("all");
  const [daysOverdue, setDaysOverdue] = useState<OutstandingDaysOverdueKey>("all");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const sid = String(schoolId || "").trim();
      if (!sid) {
        setError("Missing school");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const url = `${API_URL}/api/outstanding-accounts?schoolId=${encodeURIComponent(sid)}`;
        const res = await fetch(url, {
          headers: {
            "Content-Type": "application/json",
            ...staffAuthHeaders(),
          },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.success) {
          throw new Error(String(data?.error || data?.message || `Failed to load (${res.status})`));
        }
        if (cancelled) return;
        setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
        setServerSummary(data.summary || null);
        setSelected({});
      } catch (err) {
        if (!cancelled) {
          setAccounts([]);
          setServerSummary(null);
          setError(err instanceof Error ? err.message : "Failed to load outstanding accounts");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  const gradeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of accounts) for (const g of row.grades || []) if (g) set.add(g);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [accounts]);

  const classOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of accounts) for (const c of row.classes || []) if (c) set.add(c);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [accounts]);

  const filtered = useMemo(
    () =>
      filterOutstandingAccounts(accounts, {
        search,
        grade,
        className,
        balanceRange,
        daysOverdue,
      }),
    [accounts, search, grade, className, balanceRange, daysOverdue]
  );

  const summary = useMemo(() => {
    const filtersActive =
      search.trim() ||
      (grade !== "all") ||
      (className !== "all") ||
      balanceRange !== "all" ||
      daysOverdue !== "all";
    if (!filtersActive && serverSummary) return serverSummary;
    return summarizeFilteredOutstanding(filtered);
  }, [filtered, search, grade, className, balanceRange, daysOverdue, serverSummary]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((row) => selected[row.accountRef]);

  function toggleAllFiltered() {
    if (allFilteredSelected) {
      const next = { ...selected };
      for (const row of filtered) delete next[row.accountRef];
      setSelected(next);
      return;
    }
    const next = { ...selected };
    for (const row of filtered) next[row.accountRef] = true;
    setSelected(next);
  }

  function resetFilters() {
    setSearch("");
    setGrade("all");
    setClassName("all");
    setBalanceRange("all");
    setDaysOverdue("all");
  }

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <div style={pageWrap}>
      <h1 style={heading}>Outstanding Accounts</h1>
      <div style={subtitle}>
        Family accounts with an outstanding balance greater than R0.00. Read-only — no messages or
        payments from this screen yet.
      </div>

      <div style={summaryWrap}>
        <div style={summaryCard}>
          <div style={{ ...summaryValue, color: "#b91c1c" }}>
            {formatMoney(summary.totalOutstanding)}
          </div>
          <div style={summaryLabel}>Total Outstanding</div>
        </div>
        <div style={summaryCard}>
          <div style={summaryValue}>{summary.outstandingAccountCount}</div>
          <div style={summaryLabel}>Outstanding Accounts</div>
        </div>
        <div style={summaryCard}>
          <div style={summaryValue}>{summary.learnersAffected}</div>
          <div style={summaryLabel}>Learners Affected</div>
        </div>
      </div>

      <div style={filterRow}>
        <input
          style={{ ...inputStyle, flex: "1 1 220px" }}
          placeholder="Search learner, parent, account, cellphone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select style={selectStyle} value={grade} onChange={(e) => setGrade(e.target.value)}>
          <option value="all">All grades</option>
          {gradeOptions.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select style={selectStyle} value={className} onChange={(e) => setClassName(e.target.value)}>
          <option value="all">All classes</option>
          {classOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          style={selectStyle}
          value={balanceRange}
          onChange={(e) => setBalanceRange(e.target.value as OutstandingBalanceRangeKey)}
        >
          {OUTSTANDING_BALANCE_RANGES.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          style={selectStyle}
          value={daysOverdue}
          onChange={(e) => setDaysOverdue(e.target.value as OutstandingDaysOverdueKey)}
        >
          {OUTSTANDING_DAYS_OVERDUE_OPTIONS.map((opt) => (
            <option key={opt.key} value={opt.key}>
              Days overdue: {opt.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={resetFilters}
          style={{
            border: "1px solid #cbd5e1",
            background: "#fff",
            borderRadius: 10,
            padding: "8px 14px",
            fontWeight: 700,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Reset filters
        </button>
      </div>

      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10 }}>
        Showing {filtered.length} of {accounts.length} outstanding account
        {accounts.length === 1 ? "" : "s"}
        {selectedCount ? ` · ${selectedCount} selected` : ""}
      </div>

      {loading ? (
        <div style={{ padding: 28, color: "#64748b", fontWeight: 700 }}>Loading outstanding accounts…</div>
      ) : error ? (
        <div
          style={{
            padding: 18,
            borderRadius: 12,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      ) : filtered.length === 0 ? (
        <div
          style={{
            padding: 28,
            borderRadius: 12,
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            color: "#64748b",
            fontWeight: 700,
            textAlign: "center",
          }}
        >
          No outstanding accounts
        </div>
      ) : (
        <div style={tableWrap}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
            <thead>
              <tr>
                <th style={th}>
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={toggleAllFiltered}
                    aria-label="Select all visible accounts"
                  />
                </th>
                <th style={th}>Learner / Family</th>
                <th style={th}>Account No.</th>
                <th style={th}>Grade</th>
                <th style={th}>Class</th>
                <th style={th}>Outstanding</th>
                <th style={th}>Parent / Guardian</th>
                <th style={th}>Cellphone</th>
                <th style={th}>Alternate Contact</th>
                <th style={th}>Email</th>
                <th style={th}>Last Payment</th>
                <th style={th}>Days Overdue</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.accountRef}>
                  <td style={td}>
                    <input
                      type="checkbox"
                      checked={Boolean(selected[row.accountRef])}
                      onChange={() =>
                        setSelected((prev) => ({
                          ...prev,
                          [row.accountRef]: !prev[row.accountRef],
                        }))
                      }
                      aria-label={`Select ${row.accountNumber}`}
                    />
                  </td>
                  <td style={{ ...td, fontWeight: 700, maxWidth: 220 }}>
                    {joinLabels(row.learnerNames)}
                  </td>
                  <td style={{ ...td, fontWeight: 800 }}>{row.accountNumber}</td>
                  <td style={td}>{joinLabels(row.grades)}</td>
                  <td style={td}>{joinLabels(row.classes)}</td>
                  <td style={{ ...td, fontWeight: 900, color: "#b91c1c", whiteSpace: "nowrap" }}>
                    {formatMoney(row.outstandingBalance)}
                  </td>
                  <td style={td}>{dash(row.parentGuardianName)}</td>
                  <td style={td}>{dash(row.primaryCellphone)}</td>
                  <td style={td}>{dash(row.alternateContact)}</td>
                  <td style={td}>{dash(row.email)}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {formatLastPayment(row.lastPaymentDate, row.lastPaymentAmount)}
                  </td>
                  <td style={td}>
                    {row.daysOverdue != null && Number.isFinite(row.daysOverdue)
                      ? String(row.daysOverdue)
                      : "Unknown"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
