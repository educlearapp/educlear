import { useEffect, useMemo, useState } from "react";
import { API_URL } from "./api";
import { useSchoolId } from "./useSchoolId";

export type FeeListItem = {
  id: string;
  name: string;
  amount: number;
  frequency: string;
  category?: string | null;
  notes?: string | null;
  usedBillingPlansCount?: number;
};

function formatMoneyZAR(value: number) {
  const n = Number(value || 0);
  return `R ${n.toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatFeeCategory(value?: string | null) {
  if (!value) return "General";
  if (value === "SCHOOL_CHARGE") return "School Charge";
  if (value === "EXTRAMURAL_CHARGE") return "Extramural Charge";
  return value;
}

function formatFeeType(value?: string | null) {
  const v = String(value || "");
  if (!v) return "-";
  switch (v) {
    case "MONTHLY":
      return "Monthly Fee";
    case "MONTHLY_EXCL_DEC":
      return "Monthly Fee (Excl. Dec)";
    case "MONTHLY_EXCL_NOV_DEC":
      return "Monthly Fee (Excl. Nov and Dec)";
    case "ONCE_OFF":
      return "Once Off";
    case "ANNUALLY":
    case "YEARLY":
      return "Annually";
    case "TERMLY":
      return "Termly";
    case "DAILY":
      return "Daily";
    default:
      return v;
  }
}

export default function Fees(props: {
  onAdd: () => void;
  onManage: (feeId: string) => void;
}) {
  const schoolId = useSchoolId();

  const [items, setItems] = useState<FeeListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFeeId, setSelectedFeeId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    let cancelled = false;
    if (!schoolId) {
      setItems([]);
      setTotal(0);
      setError("No school selected.");
      return;
    }

    setLoading(true);
    setError(null);

    const base = String(API_URL || "").trim();
    const url = new URL(
      "/api/fees",
      base.startsWith("http://") || base.startsWith("https://") ? base : window.location.origin
    );
    url.searchParams.set("schoolId", schoolId);
    url.searchParams.set("page", String(page));
    url.searchParams.set("pageSize", String(pageSize));
    if (q.trim()) url.searchParams.set("q", q.trim());

    (async () => {
      try {
        const res = await fetch(url.toString());
        const data = await res.json();
        if (!res.ok) throw new Error(data?.message || "Failed to fetch fees");
        if (cancelled) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
        setTotal(Number(data?.total || 0));
        if (selectedFeeId && !data.items?.some((x: FeeListItem) => x?.id === selectedFeeId)) {
          setSelectedFeeId(null);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setItems([]);
          setTotal(0);
          setError(e instanceof Error ? e.message : "Failed to fetch fees");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [schoolId, page, pageSize, q, selectedFeeId]);

  const rows = useMemo(() => {
    return items.map((f) => {
      const usedCount = Number(f.usedBillingPlansCount || 0);
      const isUsed = usedCount > 0;
      const feeStatus = isUsed ? "Used" : "Not used";
      const category = formatFeeCategory(f.category);
      const type = formatFeeType(f.frequency);
      return { ...f, feeStatus, isUsed, usedCount, category, type };
    });
  }, [items]);

  const btnGold: React.CSSProperties = {
    background: "#d4af37",
    color: "#020617",
    border: "1px solid #d4af37",
    borderRadius: "9px",
    padding: "8px 13px",
    fontWeight: 800,
    cursor: "pointer",
    fontSize: "13px",
  };

  const btnLight: React.CSSProperties = {
    background: "#ffffff",
    color: "#0f172a",
    border: "1px solid #cbd5e1",
    borderRadius: "9px",
    padding: "8px 13px",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: "13px",
  };

  const th: React.CSSProperties = {
    textAlign: "left",
    padding: "10px 12px",
    fontSize: "11px",
    color: "#64748b",
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    borderBottom: "1px solid #e2e8f0",
  };

  const td: React.CSSProperties = {
    padding: "10px 12px",
    fontSize: "13px",
    color: "#0f172a",
    borderBottom: "1px solid #f1f5f9",
    verticalAlign: "middle",
  };

  const pagerBtn = (disabled: boolean): React.CSSProperties => ({
    ...btnLight,
    minWidth: "72px",
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  });

  const canManage = Boolean(selectedFeeId);

  return (
    <div style={{ padding: "20px", background: "#f8fafc", minHeight: "100%" }}>
      <div style={{ maxWidth: "1500px", margin: "0 auto" }}>
        <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 900, color: "#0f172a" }}>Fees</h1>
        <p style={{ margin: "4px 0 14px", color: "#64748b", fontSize: "14px" }}>
          Add and manage fee items for billing plans
        </p>

        <div
          style={{
            background: "#fff",
            padding: "12px",
            borderRadius: "16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            marginBottom: "14px",
            border: "1px solid rgba(212,175,55,0.18)",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button type="button" style={btnGold} onClick={props.onAdd}>
              + Add
            </button>
            <button
              type="button"
              style={pagerBtn(!canManage)}
              onClick={() => {
                if (!selectedFeeId) return;
                props.onManage(selectedFeeId);
              }}
              disabled={!canManage}
              title={!canManage ? "Select a fee first" : "Manage selected fee"}
            >
              Manage
            </button>
          </div>

          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            placeholder="Search fees…"
            style={{
              width: "260px",
              padding: "9px 13px",
              borderRadius: "10px",
              border: "1px solid #cbd5e1",
              outline: "none",
              fontSize: "13px",
            }}
          />
        </div>

        {error ? (
          <div
            style={{
              padding: "12px 14px",
              borderRadius: "12px",
              background: "#fff7ed",
              border: "1px solid rgba(234, 88, 12, 0.2)",
              color: "#9a3412",
              fontWeight: 600,
              marginBottom: "12px",
              fontSize: "13px",
            }}
          >
            {error}
          </div>
        ) : null}

        <div
          style={{
            background: "#fff",
            borderRadius: "18px",
            overflow: "hidden",
            border: "1px solid rgba(15,23,42,0.08)",
          }}
        >
          <div
            style={{
              background: "#020617",
              color: "#d4af37",
              padding: "11px 18px",
              fontWeight: 900,
              fontSize: "16px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>Fees</span>
            <span style={{ fontSize: "12px", fontWeight: 700, color: "rgba(212,175,55,0.85)" }}>
              {total} total
            </span>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Description</th>
                <th style={th}>Category</th>
                <th style={th}>Type</th>
                <th style={{ ...th, textAlign: "right" }}>Amount</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} style={{ ...td, textAlign: "center" }}>
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ ...td, textAlign: "center", color: "#64748b" }}>
                    No fees found
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const selected = row.id === selectedFeeId;
                  return (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedFeeId(row.id)}
                      style={{
                        cursor: "pointer",
                        background: selected ? "rgba(212,175,55,0.08)" : "#fff",
                      }}
                    >
                      <td style={{ ...td, fontWeight: 700 }}>{row.name}</td>
                      <td style={td}>{row.category}</td>
                      <td style={td}>{row.type}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 800 }}>
                        {formatMoneyZAR(row.amount)}
                      </td>
                      <td style={td}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "3px 10px",
                            borderRadius: "999px",
                            fontSize: "11px",
                            fontWeight: 800,
                            letterSpacing: "0.04em",
                            textTransform: "uppercase",
                            background: row.isUsed ? "rgba(212,175,55,0.18)" : "#f1f5f9",
                            color: row.isUsed ? "#92400e" : "#64748b",
                            border: row.isUsed
                              ? "1px solid rgba(212,175,55,0.35)"
                              : "1px solid #e2e8f0",
                          }}
                        >
                          {row.feeStatus}
                        </span>
                        {row.isUsed && row.usedCount > 0 ? (
                          <span style={{ marginLeft: 8, fontSize: "11px", color: "#64748b" }}>
                            ({row.usedCount} plans)
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "12px",
              padding: "12px 16px",
              borderTop: "1px solid #f1f5f9",
              flexWrap: "wrap",
            }}
          >
            <div style={{ color: "#64748b", fontWeight: 600, fontSize: "12px" }}>
              Page {page} of {totalPages} · {total} fees
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                style={pagerBtn(page <= 1)}
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                style={pagerBtn(page >= totalPages)}
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
