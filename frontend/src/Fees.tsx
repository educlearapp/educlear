import { useEffect, useMemo, useState } from "react";
import { API_URL } from "./api";

export type FeeListItem = {
  id: string;
  name: string;
  amount: number;
  frequency: string;
  grade?: string | null;
  usedBillingPlansCount?: number;
};

function formatMoneyZAR(value: number) {
  const n = Number(value || 0);
  return `R ${n.toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function Fees(props: {
  onAdd: () => void;
  onManage: (feeId: string) => void;
}) {
  const schoolId = localStorage.getItem("schoolId") || "";

  const [items, setItems] = useState<FeeListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
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

    const url = new URL(`${API_URL}/api/fees`);
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
        if (selectedFeeId && !data.items?.some((x: any) => x?.id === selectedFeeId)) {
          setSelectedFeeId(null);
        }
      } catch (e: any) {
        if (!cancelled) {
          setItems([]);
          setTotal(0);
          setError(e?.message || "Failed to fetch fees");
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
      const feeStatus = usedCount > 0 ? `Used (${usedCount} billing plans)` : "Not used";
      const category = f.grade ? `Grade ${f.grade}` : "General";
      const type = String(f.frequency || "-");
      return { ...f, feeStatus, category, type };
    });
  }, [items]);

  const pageWrap = {
    padding: "32px",
    background: "linear-gradient(180deg, #f8fafc 0%, #f3f4f6 45%, #eef2f7 100%)",
    minHeight: "100%",
    borderRadius: "28px",
    border: "1px solid rgba(15, 23, 42, 0.06)",
    boxShadow: "0 24px 60px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.8)",
  } as const;

  const titleStyle = {
    margin: 0,
    fontSize: "38px",
    fontWeight: 800,
    letterSpacing: "-0.03em",
    color: "#0f172a",
  } as const;

  const subtitleStyle = {
    margin: "10px 0 0 0",
    fontSize: "15px",
    color: "#475569",
    fontWeight: 500,
  } as const;

  const summaryWrap = {
    display: "grid",
    gridTemplateColumns: "repeat(1, minmax(220px, 280px))",
    gap: "12px",
    marginBottom: "18px",
  } as const;

  const summaryCard = {
    background: "#ffffff",
    border: "1px solid rgba(15, 23, 42, 0.08)",
    borderRadius: "16px",
    padding: "16px 18px",
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.06)",
  } as const;

  const summaryValue = {
    fontSize: "18px",
    fontWeight: 800,
    color: "#0f172a",
    marginBottom: "6px",
  } as const;

  const summaryLabel = {
    fontSize: "12px",
    fontWeight: 700,
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
  } as const;

  const tableCard = {
    background: "#ffffff",
    borderRadius: "18px",
    padding: "16px",
    border: "1px solid rgba(15, 23, 42, 0.06)",
    boxShadow: "0 20px 50px rgba(15, 23, 42, 0.08)",
    overflow: "hidden",
  } as const;

  const th = {
    textAlign: "left" as const,
    padding: "12px 16px",
    fontSize: "12px",
    color: "#64748b",
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
  } as const;

  const td = {
    padding: "18px 16px",
    color: "#0f172a",
    background: "#ffffff",
    verticalAlign: "middle" as const,
  } as const;

  const actionBtn = {
    padding: "10px 16px",
    borderRadius: "12px",
    border: "1px solid rgba(15, 23, 42, 0.08)",
    background: "#ffffff",
    fontWeight: 700,
    fontSize: "13px",
    color: "#0f172a",
    boxShadow: "0 4px 12px rgba(15, 23, 42, 0.05)",
    cursor: "pointer",
  } as const;

  const primaryBtn = {
    padding: "10px 18px",
    borderRadius: "12px",
    border: "none",
    background: "linear-gradient(135deg, #d4af37, #f5d06f)",
    color: "#0f172a",
    fontWeight: 800,
    fontSize: "13px",
    boxShadow: "0 6px 18px rgba(212, 175, 55, 0.35)",
    cursor: "pointer",
  } as const;

  const pagerBtn = (disabled: boolean) =>
    ({
      ...actionBtn,
      opacity: disabled ? 0.55 : 1,
      cursor: disabled ? "not-allowed" : "pointer",
    }) as const;

  const canManage = Boolean(selectedFeeId);

  return (
    <div style={pageWrap}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={titleStyle}>Fees</h1>
        <p style={subtitleStyle}>Add and manage fees</p>
      </div>

      <div style={summaryWrap}>
        <div style={summaryCard}>
          <div style={summaryValue}>{total}</div>
          <div style={summaryLabel}>Total Fees</div>
        </div>
      </div>

      <div style={tableCard}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            marginBottom: "14px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" style={primaryBtn} onClick={props.onAdd}>
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
              aria-disabled={!canManage}
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
            placeholder="Search"
            style={{
              padding: "10px 14px",
              borderRadius: "12px",
              border: "1px solid rgba(15, 23, 42, 0.08)",
              background: "#ffffff",
              fontSize: "13px",
              width: "260px",
              boxShadow: "0 4px 12px rgba(15, 23, 42, 0.05)",
            }}
          />
        </div>

        {error ? (
          <div
            style={{
              padding: "14px 16px",
              borderRadius: "14px",
              background: "#fff7ed",
              border: "1px solid rgba(234, 88, 12, 0.18)",
              color: "#9a3412",
              fontWeight: 650,
              marginBottom: "12px",
            }}
          >
            {error}
          </div>
        ) : null}

        <table
          style={{
            width: "100%",
            borderCollapse: "separate",
            borderSpacing: "0 10px",
            fontSize: "14px",
          }}
        >
          <thead>
            <tr>
              <th style={th}>Description</th>
              <th style={th}>Category</th>
              <th style={th}>Type</th>
              <th style={{ ...th, textAlign: "right" }}>Amount</th>
              <th style={th}>Fee Status</th>
            </tr>
          </thead>

          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} style={{ ...td, textAlign: "center", borderRadius: "12px" }}>
                  Loading…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ ...td, textAlign: "center", borderRadius: "12px" }}>
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
                      background: selected ? "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)" : "#ffffff",
                      boxShadow: selected
                        ? "0 12px 30px rgba(15, 23, 42, 0.12)"
                        : "0 8px 24px rgba(15, 23, 42, 0.08)",
                      borderRadius: "12px",
                      overflow: "hidden",
                      cursor: "pointer",
                      outline: selected ? "2px solid rgba(212, 175, 55, 0.55)" : "none",
                      outlineOffset: "2px",
                    }}
                  >
                    <td style={{ ...td, fontWeight: 750 }}>{row.name}</td>
                    <td style={td}>{row.category}</td>
                    <td style={td}>{row.type}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 800 }}>{formatMoneyZAR(row.amount)}</td>
                    <td style={td}>
                      <span
                        style={{
                          fontWeight: 800,
                          color: row.feeStatus === "Not used" ? "#64748b" : "#0f172a",
                        }}
                      >
                        {row.feeStatus}
                      </span>
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
            marginTop: "14px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ color: "#475569", fontWeight: 650, fontSize: "13px" }}>
            Page {page} of {totalPages} • {total} total
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
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
  );
}

