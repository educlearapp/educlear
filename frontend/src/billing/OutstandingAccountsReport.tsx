import React, { useEffect, useMemo, useState } from "react";
import { API_URL } from "../api";
import { staffAuthHeaders } from "../auth/staffAuthHeaders";
import { formatMoney } from "./billingLedger";
import BulkStatementSmsModal from "./BulkStatementSmsModal";
import {
  outstandingSelectionKey,
  summarizeSelectedOutstanding,
} from "./statementBulkSmsApi";
import {
  filterOutstandingAccounts,
  OUTSTANDING_BALANCE_RANGES,
  OUTSTANDING_DAYS_OVERDUE_OPTIONS,
  summarizeFilteredOutstanding,
  type OutstandingBalanceRangeKey,
  type OutstandingDaysOverdueKey,
} from "./outstandingAccountsFilters";
import {
  ALL_CLASSES_VALUE,
  buildClassSelectOptions,
  buildOutstandingClassView,
  reconcileClassView,
  rowClassLabels,
  type OutstandingClassGroup,
} from "./outstandingFeesByClass";
import { downloadOutstandingFeesExcel } from "./buildOutstandingFeesExcel";
import { downloadOutstandingFeesPdf } from "./buildOutstandingFeesPdf";

const GOLD = "#d4af37";

export type OutstandingAccountApiRow = {
  familyAccountId: string | null;
  accountRef: string;
  accountNumber: string;
  learnerNames: string[];
  memberLearnerIds: string[];
  grades: string[];
  classes: string[];
  /** Canonical current class labels of ACTIVE member learners (grouping only). */
  classLabels?: string[];
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
  schoolName?: string;
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

const goldButton = (enabled: boolean): React.CSSProperties => ({
  border: "1px solid #b89329",
  background: enabled ? "linear-gradient(135deg, #f7d56a, #d4af37)" : "#e2e8f0",
  borderRadius: 10,
  padding: "8px 14px",
  fontWeight: 900,
  cursor: enabled ? "pointer" : "not-allowed",
  fontSize: 13,
  color: "#111827",
  opacity: enabled ? 1 : 0.55,
});

const classSection: React.CSSProperties = {
  marginBottom: 18,
};

const classSectionHeader: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "baseline",
  gap: 12,
  padding: "10px 14px",
  borderRadius: "14px 14px 0 0",
  background: "#111827",
  color: "#ffffff",
  borderBottom: `3px solid ${GOLD}`,
};

const totalRowTd: React.CSSProperties = {
  ...td,
  fontWeight: 900,
  background: "#fdf6e3",
  borderBottom: "none",
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

function countLabel(accounts: number, learners: number): string {
  return `${accounts} account${accounts === 1 ? "" : "s"} · ${learners} learner${learners === 1 ? "" : "s"}`;
}

const TABLE_COLUMN_COUNT = 12;

export default function OutstandingAccountsReport({ schoolId, schoolName }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<OutstandingAccountApiRow[]>([]);
  const [serverSummary, setServerSummary] = useState<Summary | null>(null);
  const [serverClassOptions, setServerClassOptions] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkSmsOpen, setBulkSmsOpen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [grade, setGrade] = useState("all");
  const [className, setClassName] = useState(ALL_CLASSES_VALUE);
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
        setServerClassOptions(Array.isArray(data.classOptions) ? data.classOptions : []);
        setSelected({});
      } catch (err) {
        if (!cancelled) {
          setAccounts([]);
          setServerSummary(null);
          setServerClassOptions([]);
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

  const classOptions = useMemo(
    () => buildClassSelectOptions(serverClassOptions, accounts),
    [serverClassOptions, accounts]
  );

  /** Search/grade/balance/overdue filters; class is applied by grouping below. */
  const filtered = useMemo(
    () =>
      filterOutstandingAccounts(accounts, {
        search,
        grade,
        className: "all",
        balanceRange,
        daysOverdue,
      }),
    [accounts, search, grade, balanceRange, daysOverdue]
  );

  const classView = useMemo(() => buildOutstandingClassView(filtered, className), [filtered, className]);

  const groupedRows = useMemo(() => classView.groups.flatMap((g) => g.rows), [classView]);

  /** Every row rendered on screen (grouped rows plus shared rows in single-class view). */
  const visibleRows = useMemo(
    () => [...groupedRows, ...classView.sharedRows],
    [groupedRows, classView]
  );

  const nonClassFiltersActive = Boolean(
    search.trim() || grade !== "all" || balanceRange !== "all" || daysOverdue !== "all"
  );

  const summary = useMemo(() => {
    const filtersActive = nonClassFiltersActive || className !== ALL_CLASSES_VALUE;
    if (!filtersActive && serverSummary) return serverSummary;
    return summarizeFilteredOutstanding(groupedRows);
  }, [groupedRows, nonClassFiltersActive, className, serverSummary]);

  /** All Classes grouping must equal the ungrouped total (and the server total when unfiltered). */
  const reconciliation = useMemo(() => {
    const allView = buildOutstandingClassView(filtered, ALL_CLASSES_VALUE);
    const expected =
      !nonClassFiltersActive && serverSummary ? serverSummary : summarizeFilteredOutstanding(filtered);
    return reconcileClassView(allView, expected);
  }, [filtered, nonClassFiltersActive, serverSummary]);

  const allFilteredSelected =
    visibleRows.length > 0 &&
    visibleRows.every((row) => selected[outstandingSelectionKey(row)]);

  function toggleAllFiltered() {
    if (allFilteredSelected) {
      const next = { ...selected };
      for (const row of visibleRows) delete next[outstandingSelectionKey(row)];
      setSelected(next);
      return;
    }
    const next = { ...selected };
    for (const row of visibleRows) next[outstandingSelectionKey(row)] = true;
    setSelected(next);
  }

  function clearSelection() {
    setSelected({});
  }

  function resetFilters() {
    setSearch("");
    setGrade("all");
    setClassName(ALL_CLASSES_VALUE);
    setBalanceRange("all");
    setDaysOverdue("all");
  }

  const selectionSummary = useMemo(
    () => summarizeSelectedOutstanding(visibleRows, selected, outstandingSelectionKey),
    [visibleRows, selected]
  );
  const selectedCount = selectionSummary.count;
  const selectedTotal = selectionSummary.total;
  const selectedFamilyAccountIds = selectionSummary.familyAccountIds;

  /** Keys selected but currently hidden by filters — excluded from Bulk SMS until visible again. */
  const hiddenSelectedCount = useMemo(() => {
    const visible = new Set(visibleRows.map((row) => outstandingSelectionKey(row)));
    let n = 0;
    for (const [key, on] of Object.entries(selected)) {
      if (on && !visible.has(key)) n += 1;
    }
    return n;
  }, [visibleRows, selected]);

  function describeActiveFilters(): string {
    const parts: string[] = [];
    if (search.trim()) parts.push(`Search "${search.trim()}"`);
    if (grade !== "all") parts.push(`Grade ${grade}`);
    if (balanceRange !== "all") {
      parts.push(`Balance ${OUTSTANDING_BALANCE_RANGES.find((o) => o.key === balanceRange)?.label || balanceRange}`);
    }
    if (daysOverdue !== "all") {
      parts.push(
        `Days overdue ${OUTSTANDING_DAYS_OVERDUE_OPTIONS.find((o) => o.key === daysOverdue)?.label || daysOverdue}`
      );
    }
    return parts.join("; ");
  }

  const canExport = !loading && !error && reconciliation.ok;

  function handleExport(kind: "excel" | "pdf") {
    if (!canExport) return;
    setExportError(null);
    try {
      const meta = {
        schoolName: String(schoolName || "").trim() || "School",
        generatedAt: new Date(),
        filtersNote: describeActiveFilters() || undefined,
      };
      if (kind === "excel") downloadOutstandingFeesExcel(classView, meta);
      else downloadOutstandingFeesPdf(classView, meta);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    }
  }

  function renderAccountRow(row: OutstandingAccountApiRow) {
    const key = outstandingSelectionKey(row);
    return (
      <tr key={key}>
        <td style={td}>
          <input
            type="checkbox"
            checked={Boolean(selected[key])}
            onChange={() =>
              setSelected((prev) => ({
                ...prev,
                [key]: !prev[key],
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
        <td style={td}>{joinLabels(rowClassLabels(row))}</td>
        <td style={{ ...td, fontWeight: 900, color: "#b91c1c", whiteSpace: "nowrap" }}>
          {formatMoney(row.outstandingBalance)}
        </td>
        <td style={td}>{dash(row.parentGuardianName)}</td>
        <td style={{ ...td, whiteSpace: "nowrap" }}>{dash(row.primaryCellphone)}</td>
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
    );
  }

  function renderTableHead() {
    return (
      <thead>
        <tr>
          <th style={th} aria-label="Select" />
          <th style={th}>Learner / Family</th>
          <th style={th}>Account No.</th>
          <th style={th}>Grade</th>
          <th style={th}>Class</th>
          <th style={th}>Outstanding</th>
          <th style={th}>Parent / Guardian</th>
          <th style={th}>Phone</th>
          <th style={th}>Alternate Contact</th>
          <th style={th}>Email</th>
          <th style={th}>Last Payment</th>
          <th style={th}>Days Overdue</th>
        </tr>
      </thead>
    );
  }

  function renderClassSection(group: OutstandingClassGroup<OutstandingAccountApiRow>) {
    return (
      <div key={group.value} style={classSection}>
        <div style={classSectionHeader}>
          <span style={{ fontSize: 17, fontWeight: 900 }}>{group.label}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#cbd5e1" }}>
            {countLabel(group.outstandingAccountCount, group.learnersAffected)}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 14, fontWeight: 900, color: GOLD }}>
            Class Total: {formatMoney(group.totalOutstanding)}
          </span>
        </div>
        {group.kind === "multiple" ? (
          <div style={{ fontSize: 12, color: "#64748b", padding: "8px 14px", background: "#f8fafc" }}>
            Family accounts with learners in more than one class. Each balance is counted once, here.
          </div>
        ) : null}
        <div style={{ ...tableWrap, borderRadius: "0 0 14px 14px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
            {renderTableHead()}
            <tbody>
              {group.rows.length === 0 ? (
                <tr>
                  <td style={{ ...td, color: "#64748b", fontWeight: 700 }} colSpan={TABLE_COLUMN_COUNT}>
                    No outstanding accounts in this class
                  </td>
                </tr>
              ) : (
                group.rows.map((row) => renderAccountRow(row))
              )}
              <tr>
                <td style={totalRowTd} colSpan={5}>
                  Class Total — {group.label}
                </td>
                <td style={{ ...totalRowTd, color: "#b91c1c", whiteSpace: "nowrap" }}>
                  {formatMoney(group.totalOutstanding)}
                </td>
                <td style={totalRowTd} colSpan={TABLE_COLUMN_COUNT - 6}>
                  {countLabel(group.outstandingAccountCount, group.learnersAffected)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div style={pageWrap}>
      <h1 style={heading}>Outstanding Fees</h1>
      <div style={subtitle}>
        Family accounts with an outstanding balance greater than R0.00, organised by class. Select accounts to send bulk
        statement SMS.
      </div>

      <div style={filterRow}>
        <label style={{ fontSize: 13, fontWeight: 900, color: "#0f172a" }} htmlFor="outstanding-class-select">
          Class:
        </label>
        <select
          id="outstanding-class-select"
          style={{ ...selectStyle, minWidth: 200, fontWeight: 700 }}
          value={className}
          onChange={(e) => setClassName(e.target.value)}
        >
          {classOptions.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <button type="button" disabled={!canExport} onClick={() => handleExport("excel")} style={goldButton(canExport)}>
          Export Excel
        </button>
        <button type="button" disabled={!canExport} onClick={() => handleExport("pdf")} style={goldButton(canExport)}>
          Export PDF
        </button>
      </div>

      {exportError ? (
        <div style={{ marginBottom: 12, color: "#991b1b", fontWeight: 700, fontSize: 13 }}>{exportError}</div>
      ) : null}

      <div style={summaryWrap}>
        <div style={summaryCard}>
          <div style={{ ...summaryValue, color: "#b91c1c" }}>
            {formatMoney(summary.totalOutstanding)}
          </div>
          <div style={summaryLabel}>
            {classView.isAllClasses ? "Total Outstanding" : `Class Outstanding Total · ${classView.selectionLabel}`}
          </div>
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

      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 10, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 700, color: "#0f172a" }}>
          <input
            type="checkbox"
            checked={allFilteredSelected}
            onChange={toggleAllFiltered}
            disabled={visibleRows.length === 0}
            aria-label="Select all visible accounts"
          />
          Select all visible
        </label>
        <span>
          Showing {groupedRows.length} of {accounts.length} outstanding account
          {accounts.length === 1 ? "" : "s"}
          {classView.sharedRows.length ? ` (+${classView.sharedRows.length} shared)` : ""}
          {selectedCount
            ? ` · ${selectedCount} selected · ${formatMoney(selectedTotal)}`
            : ""}
          {hiddenSelectedCount
            ? ` · ${hiddenSelectedCount} selected hidden by filters (excluded from Bulk SMS)`
            : ""}
        </span>
        <span style={{ flex: 1 }} />
        {selectedCount ? (
          <button
            type="button"
            onClick={clearSelection}
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
            Clear selection
          </button>
        ) : null}
        <button
          type="button"
          disabled={!selectedFamilyAccountIds.length}
          onClick={() => setBulkSmsOpen(true)}
          style={goldButton(selectedFamilyAccountIds.length > 0)}
        >
          Bulk SMS
        </button>
      </div>

      {!loading && !error && !reconciliation.ok ? (
        <div
          style={{
            padding: 14,
            marginBottom: 12,
            borderRadius: 12,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            fontWeight: 700,
          }}
        >
          Class totals do not reconcile ({formatMoney(reconciliation.groupsTotal)} vs{" "}
          {formatMoney(reconciliation.expectedTotal)}). Exports are disabled — please refresh or contact support.
        </div>
      ) : null}

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
      ) : classView.isAllClasses && groupedRows.length === 0 ? (
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
        <div>
          {classView.groups.map((group) => renderClassSection(group))}

          {!classView.isAllClasses && classView.sharedRows.length ? (
            <div style={classSection}>
              <div style={{ ...classSectionHeader, background: "#334155" }}>
                <span style={{ fontSize: 15, fontWeight: 900 }}>Also linked to this class</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#cbd5e1" }}>
                  {countLabel(classView.sharedTotals.outstandingAccountCount, classView.sharedTotals.learnersAffected)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#64748b", padding: "8px 14px", background: "#f8fafc" }}>
                Shared family accounts with learners in more than one class. Their balances are counted once under
                “Multiple classes” and are not included in the Class Total above.
              </div>
              <div style={{ ...tableWrap, borderRadius: "0 0 14px 14px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
                  {renderTableHead()}
                  <tbody>{classView.sharedRows.map((row) => renderAccountRow(row))}</tbody>
                </table>
              </div>
            </div>
          ) : null}

          {classView.isAllClasses ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "baseline",
                gap: 12,
                padding: "14px 16px",
                borderRadius: 14,
                background: "#111827",
                color: "#ffffff",
                borderTop: `3px solid ${GOLD}`,
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 900, letterSpacing: "0.04em" }}>GRAND TOTAL</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "#cbd5e1" }}>
                {countLabel(classView.totals.outstandingAccountCount, classView.totals.learnersAffected)}
              </span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 18, fontWeight: 900, color: GOLD }}>
                {formatMoney(classView.totals.totalOutstanding)}
              </span>
            </div>
          ) : null}
        </div>
      )}

      {bulkSmsOpen ? (
        <BulkStatementSmsModal
          schoolId={schoolId}
          familyAccountIds={selectedFamilyAccountIds}
          selectedCount={selectedCount}
          selectedTotalOutstanding={selectedTotal}
          onClose={() => setBulkSmsOpen(false)}
        />
      ) : null}
    </div>
  );
}
