import React, { useMemo, useState } from "react";
import {
  applyDaSilvaLatePenalties,
  previewDaSilvaLatePenalties,
  syncBillingLedgerFromApi,
  type DaSilvaLatePenaltyApplyResult,
  type DaSilvaLatePenaltyPreviewRow,
  type DaSilvaLatePenaltyPreviewResult,
} from "./billingApi";
import { formatMoney } from "./billingLedger";
import { isDaSilvaAcademySchool } from "./billingSummaryDisplayOverride";

type Props = {
  schoolId: string;
  onClose: () => void;
};

type FilterKey =
  | "eligible"
  | "notEligible"
  | "sibling"
  | "largeDebtor"
  | "alreadyApplied"
  | "moreThan1Month"
  | "moreThan2Months"
  | "moreThan3Months";

const GOLD = "#d4af37";
const INK = "#111827";

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

const panel: React.CSSProperties = {
  background: "#fff",
  border: `2px solid ${GOLD}`,
  borderRadius: 14,
  width: "min(1280px, 100%)",
  maxHeight: "94vh",
  overflow: "auto",
  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 220,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  fontWeight: 600,
};

const goldBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "1px solid #b89329",
  background: "linear-gradient(135deg, #f7d56a, #d4af37)",
  color: INK,
  fontWeight: 900,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: `1px solid ${GOLD}`,
  background: "#fff",
  color: INK,
  fontWeight: 800,
  cursor: "pointer",
};

const dangerBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "1px solid #b91c1c",
  background: "linear-gradient(135deg, #fca5a5, #ef4444)",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

const modalOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.65)",
  zIndex: 6000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
};

const modalPanel: React.CSSProperties = {
  background: "#fff",
  border: `2px solid ${GOLD}`,
  borderRadius: 14,
  width: "min(520px, 100%)",
  padding: 24,
  boxShadow: "0 24px 60px rgba(0,0,0,0.3)",
};

const th: React.CSSProperties = {
  padding: 12,
  textAlign: "left",
  fontSize: 12,
  fontWeight: 900,
  color: "#334155",
  borderBottom: "1px solid #e5e7eb",
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: 12,
  fontSize: 13,
  fontWeight: 600,
  color: INK,
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "top",
};

const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: "eligible", label: "Eligible only" },
  { key: "notEligible", label: "Not eligible" },
  { key: "sibling", label: "Sibling accounts" },
  { key: "largeDebtor", label: "Large debtors > R20,000" },
  { key: "alreadyApplied", label: "Already applied" },
];

const MONTHS_BEHIND_FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: "moreThan1Month", label: "More than 1 month" },
  { key: "moreThan2Months", label: "More than 2 months" },
  { key: "moreThan3Months", label: "More than 3 months" },
];

const MONTHS_BEHIND_FILTER_KEYS = new Set<FilterKey>(
  MONTHS_BEHIND_FILTER_OPTIONS.map((opt) => opt.key)
);

function schoolDisplayName(): string {
  return (
    String(localStorage.getItem("schoolName") || "").trim() || "Da Silva Academy"
  );
}

function normalizeMonthsBehind(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function matchesFilter(row: DaSilvaLatePenaltyPreviewRow, filter: FilterKey): boolean {
  const monthsBehind = normalizeMonthsBehind(row.monthsBehind);
  switch (filter) {
    case "eligible":
      return row.eligible;
    case "notEligible":
      return !row.eligible;
    case "sibling":
      return (row.linkedLearnerCount || 0) > 1;
    case "largeDebtor":
      return row.outstandingBalance > 20000;
    case "alreadyApplied":
      return row.alreadyApplied;
    case "moreThan1Month":
      return monthsBehind !== null && monthsBehind > 1;
    case "moreThan2Months":
      return monthsBehind !== null && monthsBehind > 2;
    case "moreThan3Months":
      return monthsBehind !== null && monthsBehind > 3;
    default:
      return true;
  }
}

function outstandingCellStyle(balance: number): React.CSSProperties {
  if (balance > 0) {
    return {
      fontWeight: 900,
      color: "#92400e",
      background: "rgba(212,175,55,0.1)",
    };
  }
  return { fontWeight: 600, color: "#64748b" };
}

function statusBadge(row: DaSilvaLatePenaltyPreviewRow): { label: string; bg: string; color: string } {
  if (row.alreadyApplied) {
    return {
      label: "Already applied",
      bg: "rgba(212,175,55,0.22)",
      color: "#92400e",
    };
  }
  if (row.eligible) {
    return {
      label: "Eligible",
      bg: "rgba(22,163,74,0.14)",
      color: "#166534",
    };
  }
  return {
    label: "Not eligible",
    bg: "rgba(100,116,139,0.14)",
    color: "#475569",
  };
}

function formatMonthsBehind(value: number | null | undefined): string {
  const n = normalizeMonthsBehind(value);
  if (n === null) return "—";
  return n.toFixed(2);
}

function isRowSelectable(row: DaSilvaLatePenaltyPreviewRow): boolean {
  return row.eligible && !row.alreadyApplied;
}

function defaultEligibleSelection(rows: DaSilvaLatePenaltyPreviewRow[]): Set<string> {
  return new Set(rows.filter(isRowSelectable).map((row) => row.accountRef));
}

export default function DaSilvaLatePenaltyPreview({ schoolId, onClose }: Props) {
  const daSilvaAllowed = isDaSilvaAcademySchool(schoolId);
  const defaultMonth = new Date().toISOString().slice(0, 7);
  const [penaltyMonth, setPenaltyMonth] = useState(defaultMonth);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<DaSilvaLatePenaltyPreviewResult | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set());
  const [monthsBehindFilter, setMonthsBehindFilter] = useState<FilterKey | null>(null);
  const [selectedAccountRefs, setSelectedAccountRefs] = useState<Set<string>>(new Set());
  const [applyLoading, setApplyLoading] = useState(false);
  const [showConfirmApply, setShowConfirmApply] = useState(false);
  const [applyResult, setApplyResult] = useState<DaSilvaLatePenaltyApplyResult | null>(null);

  const toggleFilter = (key: FilterKey) => {
    if (MONTHS_BEHIND_FILTER_KEYS.has(key)) {
      setMonthsBehindFilter((prev) => (prev === key ? null : key));
      return;
    }
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clearFilters = () => {
    setActiveFilters(new Set());
    setMonthsBehindFilter(null);
  };

  const handlePreview = async () => {
    if (!daSilvaAllowed) return;
    if (!penaltyMonth) {
      setError("Select a penalty month.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await previewDaSilvaLatePenalties({
        schoolId,
        penaltyMonth,
      });
      setPreview(result);
      setSelectedAccountRefs(defaultEligibleSelection(result.rows || []));
      setApplyResult(null);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Preview failed.";
      setError(message);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  };

  const rows = preview?.rows || [];

  const filteredRows = useMemo(() => {
    const active: FilterKey[] = Array.from(activeFilters);
    if (monthsBehindFilter) active.push(monthsBehindFilter);
    if (!active.length) return rows;
    return rows.filter((row) => active.every((filter) => matchesFilter(row, filter)));
  }, [rows, activeFilters, monthsBehindFilter]);

  const hasActiveFilters = activeFilters.size > 0 || monthsBehindFilter !== null;

  const selectedStats = useMemo(() => {
    let count = 0;
    let total = 0;
    for (const row of rows) {
      if (!selectedAccountRefs.has(row.accountRef)) continue;
      count += 1;
      if (row.eligible) total += Number(row.penaltyAmount || 0);
    }
    return { count, total: Math.round(total * 100) / 100 };
  }, [rows, selectedAccountRefs]);

  const toggleRowSelection = (accountRef: string) => {
    setSelectedAccountRefs((prev) => {
      const next = new Set(prev);
      if (next.has(accountRef)) next.delete(accountRef);
      else next.add(accountRef);
      return next;
    });
  };

  const selectAllEligible = () => {
    setSelectedAccountRefs(defaultEligibleSelection(rows));
  };

  const clearSelection = () => {
    setSelectedAccountRefs(new Set());
  };

  const handleConfirmApply = async () => {
    if (!preview || !selectedStats.count) return;
    setApplyLoading(true);
    setError("");
    try {
      const result = await applyDaSilvaLatePenalties({
        schoolId,
        penaltyMonth: preview.penaltyMonth,
        selectedAccountRefs: Array.from(selectedAccountRefs),
      });
      setApplyResult(result);
      setShowConfirmApply(false);
      await syncBillingLedgerFromApi(schoolId).catch(() => {});
      const refreshed = await previewDaSilvaLatePenalties({ schoolId, penaltyMonth: preview.penaltyMonth });
      setPreview(refreshed);
      setSelectedAccountRefs(defaultEligibleSelection(refreshed.rows || []));
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Apply failed.";
      setError(message);
      setShowConfirmApply(false);
    } finally {
      setApplyLoading(false);
    }
  };

  const totalEligibleOutstanding = useMemo(
    () =>
      rows
        .filter((row) => row.eligible)
        .reduce((sum, row) => sum + Number(row.outstandingBalance || 0), 0),
    [rows]
  );

  const averagePenalty = useMemo(() => {
    const eligibleCount = preview?.summary?.eligibleCount ?? 0;
    const totalPenalty = Number(preview?.summary?.totalPenaltyAmount ?? 0);
    if (eligibleCount <= 0) return 0;
    return Math.round((totalPenalty / eligibleCount) * 100) / 100;
  }, [preview]);

  if (!daSilvaAllowed) {
    return (
      <div style={overlay}>
        <div style={{ ...panel, maxWidth: 520 }}>
          <div
            style={{
              padding: "20px 24px",
              borderBottom: `1px solid ${GOLD}`,
              background: INK,
              color: GOLD,
              fontWeight: 900,
              fontSize: 18,
            }}
          >
            Late Penalty Review
          </div>
          <div style={{ padding: 24 }}>
            <p style={{ margin: 0, fontWeight: 700, color: INK }}>
              This preview is only available for Da Silva Academy. MBB and other schools cannot
              access this screen.
            </p>
            <div style={{ marginTop: 20 }}>
              <button type="button" style={ghostBtn} onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlay}>
      <div style={panel}>
        <div
          style={{
            padding: "20px 24px",
            borderBottom: `1px solid ${GOLD}`,
            background: INK,
            color: GOLD,
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 20 }}>Da Silva Late Penalty Review</div>
          <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, opacity: 0.9 }}>
            10% of outstanding when balance exceeds combined monthly fees
          </div>
        </div>

        <div
          style={{
            margin: "16px 24px 0",
            padding: "14px 18px",
            borderRadius: 10,
            border: "2px solid #b91c1c",
            background: "#fef2f2",
            color: "#991b1b",
            textAlign: "center",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 15, letterSpacing: 0.4, marginBottom: 6 }}>
            {preview ? "REVIEW BEFORE APPLYING" : "PREVIEW ONLY"}
          </div>
          <div style={{ fontWeight: 700, fontSize: 13, lineHeight: 1.5, color: "#7f1d1d" }}>
            {preview
              ? "Penalties are not posted until you confirm Apply Selected Penalties. Only checked accounts will be charged. Amounts are recalculated on the server at apply time."
              : "This is a simulation. No penalties have been added to any customer accounts. Review the calculations carefully before proceeding."}
          </div>
        </div>

        <div style={{ padding: "20px 24px" }}>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 16,
              alignItems: "flex-end",
              marginBottom: 20,
            }}
          >
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>Penalty month</span>
              <input
                type="month"
                value={penaltyMonth}
                onChange={(e) => setPenaltyMonth(e.target.value)}
                style={fieldStyle}
              />
            </label>
            <button
              type="button"
              style={{ ...goldBtn, opacity: loading ? 0.7 : 1 }}
              onClick={handlePreview}
              disabled={loading}
            >
              {loading ? "Loading preview…" : "Preview"}
            </button>
            <button type="button" style={ghostBtn} onClick={onClose}>
              Close
            </button>
          </div>

          {error ? (
            <div
              style={{
                marginBottom: 16,
                padding: "12px 14px",
                borderRadius: 10,
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#991b1b",
                fontWeight: 700,
              }}
            >
              {error}
            </div>
          ) : null}

          {preview ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 12,
                  marginBottom: 20,
                }}
              >
                {[
                  { label: "School", value: schoolDisplayName() },
                  { label: "Penalty month", value: preview.penaltyMonth },
                  { label: "Accounts evaluated", value: String(preview.summary.totalAccounts) },
                  { label: "Eligible accounts", value: String(preview.summary.eligibleCount) },
                  { label: "Not eligible accounts", value: String(preview.summary.notEligibleCount) },
                  {
                    label: "Outstanding balance of eligible accounts",
                    value: formatMoney(totalEligibleOutstanding),
                  },
                  {
                    label: "Total penalties previewed",
                    value: formatMoney(preview.summary.totalPenaltyAmount),
                  },
                  {
                    label: "Average penalty",
                    value: formatMoney(averagePenalty),
                  },
                ].map((card) => (
                  <div
                    key={card.label}
                    style={{
                      padding: "14px 16px",
                      borderRadius: 12,
                      border: `1px solid ${GOLD}`,
                      background: "rgba(212,175,55,0.08)",
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 800, color: "#64748b", marginBottom: 4 }}>
                      {card.label}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: INK }}>{card.value}</div>
                  </div>
                ))}
              </div>

              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b", marginBottom: 8 }}>
                  Filters
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {FILTER_OPTIONS.map((opt) => {
                    const active = activeFilters.has(opt.key);
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => toggleFilter(opt.key)}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 999,
                          border: `1px solid ${active ? GOLD : "#cbd5e1"}`,
                          background: active ? "rgba(212,175,55,0.2)" : "#fff",
                          color: INK,
                          fontWeight: 800,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                  {hasActiveFilters ? (
                    <button
                      type="button"
                      onClick={clearFilters}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 999,
                        border: "1px solid #cbd5e1",
                        background: "#f8fafc",
                        color: "#64748b",
                        fontWeight: 800,
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      Clear filters
                    </button>
                  ) : null}
                </div>
                <div style={{ fontSize: 12, fontWeight: 800, color: "#64748b", margin: "12px 0 8px" }}>
                  Months behind
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {MONTHS_BEHIND_FILTER_OPTIONS.map((opt) => {
                    const active = monthsBehindFilter === opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() => toggleFilter(opt.key)}
                        style={{
                          padding: "8px 12px",
                          borderRadius: 999,
                          border: `1px solid ${active ? GOLD : "#cbd5e1"}`,
                          background: active ? "rgba(212,175,55,0.2)" : "#fff",
                          color: INK,
                          fontWeight: 800,
                          fontSize: 12,
                          cursor: "pointer",
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                  {hasActiveFilters ? (
                    <button
                      type="button"
                      onClick={clearFilters}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 999,
                        border: "1px solid #cbd5e1",
                        background: "#f8fafc",
                        color: "#64748b",
                        fontWeight: 800,
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      Clear filters
                    </button>
                  ) : null}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: "#64748b" }}>
                  Showing {filteredRows.length} of {rows.length} accounts
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  alignItems: "center",
                  marginBottom: 14,
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: `1px solid ${GOLD}`,
                  background: "rgba(212,175,55,0.06)",
                }}
              >
                <div style={{ fontWeight: 900, color: INK }}>
                  Selected: {selectedStats.count} account{selectedStats.count === 1 ? "" : "s"} —{" "}
                  {formatMoney(selectedStats.total)}
                </div>
                <button type="button" style={ghostBtn} onClick={selectAllEligible}>
                  Select all eligible
                </button>
                <button type="button" style={ghostBtn} onClick={clearSelection}>
                  Clear selection
                </button>
                <button
                  type="button"
                  style={{
                    ...dangerBtn,
                    opacity: applyLoading || selectedStats.count === 0 ? 0.6 : 1,
                  }}
                  disabled={applyLoading || selectedStats.count === 0}
                  onClick={() => setShowConfirmApply(true)}
                >
                  Apply Selected Penalties
                </button>
              </div>

              <div
                style={{
                  border: `1px solid ${GOLD}`,
                  borderRadius: 12,
                  overflow: "auto",
                  maxHeight: "52vh",
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
                  <thead>
                    <tr style={{ background: "rgba(212,175,55,0.16)" }}>
                      {[
                        "",
                        "Account",
                        "Holder / learners",
                        "Linked",
                        "Outstanding",
                        "Monthly threshold",
                        "Months behind",
                        "Penalty",
                        "Status",
                        "Reason",
                        "Already applied",
                      ].map((h) => (
                        <th key={h || "select"} style={th}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length ? (
                      filteredRows.map((row) => (
                        <tr key={row.idempotencyKey || row.accountRef}>
                          <td style={td}>
                            <input
                              type="checkbox"
                              checked={selectedAccountRefs.has(row.accountRef)}
                              disabled={!isRowSelectable(row)}
                              onChange={() => toggleRowSelection(row.accountRef)}
                              aria-label={`Select ${row.accountRef}`}
                            />
                          </td>
                          <td style={{ ...td, fontWeight: 900 }}>{row.accountRef}</td>
                          <td style={td}>
                            <div style={{ fontWeight: 800 }}>{row.accountHolder}</div>
                            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                              {(row.learnerNames || []).join(", ") || "—"}
                            </div>
                          </td>
                          <td style={td}>{row.linkedLearnerCount ?? 0}</td>
                          <td style={{ ...td, ...outstandingCellStyle(row.outstandingBalance) }}>
                            {formatMoney(row.outstandingBalance)}
                          </td>
                          <td style={td}>{formatMoney(row.monthlyFeeThreshold)}</td>
                          <td style={td}>{formatMonthsBehind(row.monthsBehind)}</td>
                          <td style={{ ...td, fontWeight: 900, color: row.eligible ? INK : "#94a3b8" }}>
                            {formatMoney(row.penaltyAmount)}
                          </td>
                          <td style={td}>
                            {(() => {
                              const badge = statusBadge(row);
                              return (
                                <span
                                  style={{
                                    display: "inline-block",
                                    padding: "5px 10px",
                                    borderRadius: 999,
                                    fontSize: 11,
                                    fontWeight: 900,
                                    letterSpacing: 0.2,
                                    background: badge.bg,
                                    color: badge.color,
                                    border: `1px solid ${badge.color}22`,
                                  }}
                                >
                                  {badge.label}
                                </span>
                              );
                            })()}
                          </td>
                          <td style={{ ...td, maxWidth: 280 }}>{row.eligibilityReason}</td>
                          <td style={td}>{row.alreadyApplied ? "Yes" : "No"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={11} style={{ ...td, textAlign: "center", color: "#64748b" }}>
                          No accounts match the selected filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <p style={{ marginTop: 14, fontSize: 12, fontWeight: 700, color: "#64748b" }}>
                Manual apply only — one penalty per account per penalty month. Server recalculates
                eligibility and amounts at apply time.
              </p>
            </>
          ) : (
            <p style={{ margin: 0, color: "#64748b", fontWeight: 600 }}>
              Select a penalty month and click Preview to load account calculations.
            </p>
          )}
        </div>
      </div>

      {showConfirmApply && preview ? (
        <div style={modalOverlay}>
          <div style={modalPanel}>
            <div style={{ fontWeight: 900, fontSize: 18, color: "#991b1b", marginBottom: 12 }}>
              Confirm penalty apply
            </div>
            <p style={{ margin: "0 0 12px", fontWeight: 700, color: INK, lineHeight: 1.5 }}>
              This will write penalty charges to customer accounts. Only selected accounts will be
              charged. Amounts are recalculated on the server immediately before posting.
            </p>
            <ul style={{ margin: "0 0 16px", paddingLeft: 20, fontWeight: 700, color: INK }}>
              <li>Penalty month: {preview.penaltyMonth}</li>
              <li>Selected accounts: {selectedStats.count}</li>
              <li>Total penalties to post: {formatMoney(selectedStats.total)}</li>
            </ul>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                style={ghostBtn}
                onClick={() => setShowConfirmApply(false)}
                disabled={applyLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                style={{ ...dangerBtn, opacity: applyLoading ? 0.7 : 1 }}
                onClick={handleConfirmApply}
                disabled={applyLoading}
              >
                {applyLoading ? "Applying…" : "Confirm apply"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {applyResult ? (
        <div style={modalOverlay}>
          <div style={{ ...modalPanel, width: "min(640px, 100%)" }}>
            <div style={{ fontWeight: 900, fontSize: 18, color: INK, marginBottom: 12 }}>
              Apply complete
            </div>
            <p style={{ margin: "0 0 12px", fontWeight: 700, color: INK }}>
              Penalty month {applyResult.penaltyMonth}: posted {applyResult.postedCount}, skipped{" "}
              {applyResult.skippedCount}, errors {applyResult.errorCount}. Total posted:{" "}
              {formatMoney(applyResult.totalPostedAmount)}.
            </p>
            <div
              style={{
                maxHeight: 240,
                overflow: "auto",
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                marginBottom: 16,
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Account", "Status", "Reason", "Amount"].map((h) => (
                      <th key={h} style={{ ...th, padding: 8 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {applyResult.rows.map((row) => (
                    <tr key={`${row.accountRef}-${row.status}-${row.reason}`}>
                      <td style={{ ...td, padding: 8 }}>{row.accountRef}</td>
                      <td style={{ ...td, padding: 8 }}>{row.status}</td>
                      <td style={{ ...td, padding: 8 }}>{row.reason}</td>
                      <td style={{ ...td, padding: 8 }}>
                        {row.penaltyAmount != null ? formatMoney(row.penaltyAmount) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" style={goldBtn} onClick={() => setApplyResult(null)}>
                Close report
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
