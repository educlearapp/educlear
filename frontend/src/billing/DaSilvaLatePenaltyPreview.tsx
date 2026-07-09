import React, { useMemo, useState } from "react";
import {
  previewDaSilvaLatePenalties,
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
  | "alreadyApplied";

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

function schoolDisplayName(): string {
  return (
    String(localStorage.getItem("schoolName") || "").trim() || "Da Silva Academy"
  );
}

function matchesFilter(row: DaSilvaLatePenaltyPreviewRow, filter: FilterKey): boolean {
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
    default:
      return true;
  }
}

function formatMonthsBehind(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return value.toFixed(2);
}

export default function DaSilvaLatePenaltyPreview({ schoolId, onClose }: Props) {
  const daSilvaAllowed = isDaSilvaAcademySchool(schoolId);
  const defaultMonth = new Date().toISOString().slice(0, 7);
  const [penaltyMonth, setPenaltyMonth] = useState(defaultMonth);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<DaSilvaLatePenaltyPreviewResult | null>(null);
  const [activeFilters, setActiveFilters] = useState<Set<FilterKey>>(new Set());

  const toggleFilter = (key: FilterKey) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
    if (!activeFilters.size) return rows;
    return rows.filter((row) =>
      Array.from(activeFilters).some((filter) => matchesFilter(row, filter))
    );
  }, [rows, activeFilters]);

  const totalEligibleOutstanding = useMemo(
    () =>
      rows
        .filter((row) => row.eligible)
        .reduce((sum, row) => sum + Number(row.outstandingBalance || 0), 0),
    [rows]
  );

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
            padding: "12px 16px",
            borderRadius: 10,
            border: "2px solid #b91c1c",
            background: "#fef2f2",
            color: "#991b1b",
            fontWeight: 900,
            fontSize: 14,
            textAlign: "center",
            letterSpacing: 0.3,
          }}
        >
          PREVIEW ONLY — NO PENALTIES WILL BE POSTED
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
                    label: "Total outstanding (eligible)",
                    value: formatMoney(totalEligibleOutstanding),
                  },
                  {
                    label: "Total penalties previewed",
                    value: formatMoney(preview.summary.totalPenaltyAmount),
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
                  {activeFilters.size ? (
                    <button
                      type="button"
                      onClick={() => setActiveFilters(new Set())}
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
                        <th key={h} style={th}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.length ? (
                      filteredRows.map((row) => (
                        <tr key={row.idempotencyKey || row.accountRef}>
                          <td style={{ ...td, fontWeight: 900 }}>{row.accountRef}</td>
                          <td style={td}>
                            <div style={{ fontWeight: 800 }}>{row.accountHolder}</div>
                            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                              {(row.learnerNames || []).join(", ") || "—"}
                            </div>
                          </td>
                          <td style={td}>{row.linkedLearnerCount ?? 0}</td>
                          <td style={td}>{formatMoney(row.outstandingBalance)}</td>
                          <td style={td}>{formatMoney(row.monthlyFeeThreshold)}</td>
                          <td style={td}>{formatMonthsBehind(row.monthsBehind)}</td>
                          <td style={{ ...td, fontWeight: 900, color: row.eligible ? INK : "#94a3b8" }}>
                            {formatMoney(row.penaltyAmount)}
                          </td>
                          <td style={td}>
                            <span
                              style={{
                                display: "inline-block",
                                padding: "4px 8px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 900,
                                background: row.eligible ? "rgba(22,163,74,0.12)" : "rgba(100,116,139,0.12)",
                                color: row.eligible ? "#166534" : "#475569",
                              }}
                            >
                              {row.eligible ? "Eligible" : "Not eligible"}
                            </span>
                          </td>
                          <td style={{ ...td, maxWidth: 280 }}>{row.eligibilityReason}</td>
                          <td style={td}>{row.alreadyApplied ? "Yes" : "No"}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={10} style={{ ...td, textAlign: "center", color: "#64748b" }}>
                          No accounts match the selected filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {preview.previewOnly && preview.applyBlocked ? (
                <p style={{ marginTop: 14, fontSize: 12, fontWeight: 700, color: "#64748b" }}>
                  Preview-only mode — apply is blocked by the server. No ledger entries will be created.
                </p>
              ) : null}
            </>
          ) : (
            <p style={{ margin: 0, color: "#64748b", fontWeight: 600 }}>
              Select a penalty month and click Preview to load account calculations.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
