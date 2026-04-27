import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "./api";
import { getParentPortalSession } from "./parentPortalSession";

export default function ParentPortalStatements() {
  const navigate = useNavigate();
  const session = useMemo(() => getParentPortalSession(), []);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("");
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!session) {
      navigate("/parent/login", { replace: true });
      return;
    }
    (async () => {
      setLoading(true);
      setStatus("");
      try {
        const res = await apiFetch(`/api/parent-portal/statements/${encodeURIComponent(session.parentId)}`);
        setData(res);
      } catch (e: any) {
        setStatus(e?.message || "Failed to load statements");
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate, session]);

  if (!session) return null;

  const invoices: any[] = Array.isArray(data?.invoices) ? data.invoices : [];
  const payments: any[] = Array.isArray(data?.payments) ? data.payments : [];
  const totalOutstanding = Number(data?.summary?.totalOutstandingBalance ?? data?.summary?.outstandingBalance ?? 0);
  const overdueBalance = Number(data?.summary?.overdueBalance || 0);
  const nextDueDate = data?.summary?.nextDueDate || null;
  const lines: any[] = Array.isArray(data?.statementLines) ? data.statementLines : [];

  function moneyCents(cents: number) {
    return `R ${(Number(cents || 0) / 100).toFixed(2)}`;
  }

  return (
    <div style={{ maxWidth: 1000, margin: "28px auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Statements</h2>
        <div style={{ marginLeft: "auto" }}>
          <Link to="/parent/dashboard" style={{ color: "#b48a00", fontWeight: 900 }}>
            Back to dashboard
          </Link>
        </div>
      </div>

      <div style={{ background: "#111", color: "#f8fafc", borderRadius: 16, padding: 14, border: "1px solid rgba(212,175,55,0.25)" }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ color: "#d4af37", fontWeight: 900 }}>Total outstanding balance</div>
              <div style={{ fontSize: 28, fontWeight: 900, marginTop: 6 }}>R {totalOutstanding.toFixed(2)}</div>
            </div>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ color: "#fca5a5", fontWeight: 900 }}>Overdue balance</div>
              <div style={{ fontSize: 28, fontWeight: 900, marginTop: 6 }}>R {overdueBalance.toFixed(2)}</div>
              <div style={{ marginTop: 6, color: "#cbd5e1" }}>
                Next due: {nextDueDate ? new Date(nextDueDate).toLocaleDateString() : "—"}
              </div>
            </div>
          </div>
          <div style={{ color: "#cbd5e1" }}>This page shows invoices and payments linked to your verified Parent profile.</div>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 16 }}>Loading...</div>
      ) : status ? (
        <div style={{ padding: 16, color: "#b91c1c", fontWeight: 800 }}>{status}</div>
      ) : (
        <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)", overflow: "hidden" }}>
            <div style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)", fontWeight: 900 }}>
              Statement ({lines.length})
            </div>
            {lines.length ? (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)" }}>Invoice date</th>
                    <th style={{ textAlign: "left", padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)" }}>Due date</th>
                    <th style={{ textAlign: "left", padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)" }}>Description</th>
                    <th style={{ textAlign: "right", padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)" }}>Amount</th>
                    <th style={{ textAlign: "right", padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)" }}>Paid</th>
                    <th style={{ textAlign: "right", padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)" }}>Balance</th>
                    <th style={{ textAlign: "left", padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => (
                    <tr key={`${l.invoiceId}-${idx}`}>
                      <td style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.06)" }}>
                        {l.invoiceDate ? new Date(l.invoiceDate).toLocaleDateString() : ""}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.06)" }}>
                        {l.dueDate ? new Date(l.dueDate).toLocaleDateString() : ""}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.06)" }}>{String(l.description || "")}</td>
                      <td style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.06)", textAlign: "right", fontWeight: 900 }}>
                        {moneyCents(Number(l.amountCents || 0))}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.06)", textAlign: "right", fontWeight: 900 }}>
                        {moneyCents(Number(l.paidCents || 0))}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.06)", textAlign: "right", fontWeight: 900 }}>
                        {moneyCents(Number(l.balanceCents || 0))}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.06)", fontWeight: 900 }}>
                        {String(l.status || "")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: 12, color: "#475569" }}>No statement lines found.</div>
            )}
          </div>

          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)", overflow: "hidden" }}>
            <div style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)", fontWeight: 900 }}>
              Invoices ({invoices.length})
            </div>
            {invoices.length ? (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)" }}>Invoice</th>
                    <th style={{ textAlign: "left", padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)" }}>Date</th>
                    <th style={{ textAlign: "left", padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)" }}>Due</th>
                    <th style={{ textAlign: "right", padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.06)" }}>{inv.id}</td>
                      <td style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.06)" }}>
                        {inv.createdAt ? new Date(inv.createdAt).toLocaleDateString() : ""}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.06)" }}>
                        {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : ""}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.06)", textAlign: "right", fontWeight: 900 }}>
                        R {(Number(inv.amountCents || 0) / 100).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: 12, color: "#475569" }}>No invoices found.</div>
            )}
          </div>

          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)", overflow: "hidden" }}>
            <div style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)", fontWeight: 900 }}>
              Payments ({payments.length})
            </div>
            {payments.length ? (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)" }}>Payment</th>
                    <th style={{ textAlign: "left", padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)" }}>Date</th>
                    <th style={{ textAlign: "left", padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)" }}>Method</th>
                    <th style={{ textAlign: "right", padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.06)" }}>{p.id}</td>
                      <td style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.06)" }}>
                        {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : ""}
                      </td>
                      <td style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.06)" }}>{String(p.method || "")}</td>
                      <td style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.06)", textAlign: "right", fontWeight: 900 }}>
                        R {Number(p.amount || 0).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: 12, color: "#475569" }}>No payments found.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

