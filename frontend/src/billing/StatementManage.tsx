import React, { useMemo, useState } from "react";
import {
  BILLING_UPDATED_EVENT,
  calculateAccountBalance,
  formatMoney,
  getAccountLedger,
  normaliseBillingAmount,
} from "./billingLedger";

type Props = {
  selected: any;
  setActivePage: React.Dispatch<React.SetStateAction<any>>;
};

const GOLD = "#d4af37";
const INK = "#111827";

export default function StatementManage({ selected, setActivePage }: Props) {
  const schoolId = localStorage.getItem("schoolId") || "";
  const learnerId = String(selected?.learnerId || selected?.id || "").trim();
  const accountNo = String(selected?.accountNo || "").trim();

  const [period, setPeriod] = useState("All Time");
  const [, setTick] = useState(0);

  React.useEffect(() => {
    const refresh = () => setTick((v) => v + 1);
    window.addEventListener(BILLING_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(BILLING_UPDATED_EVENT, refresh);
  }, []);

  const ledger = useMemo(
    () => getAccountLedger(schoolId, learnerId, accountNo),
    [schoolId, learnerId, accountNo, period]
  );

  const balance = calculateAccountBalance(ledger, learnerId, accountNo);

  const transactions = useMemo(() => {
    const sorted = [...ledger].sort(
      (a, b) =>
        new Date(a.date || a.createdAt).getTime() - new Date(b.date || b.createdAt).getTime()
    );
    let running = 0;
    return sorted.map((entry, index) => {
      const amount = normaliseBillingAmount(entry.amount);
      const isDebit = entry.type === "invoice" || entry.type === "penalty";
      const signed = isDebit ? amount : -amount;
      running += signed;
      const typeLabel =
        entry.type === "invoice"
          ? "Invoice"
          : entry.type === "penalty"
            ? "Penalty"
            : entry.type === "credit"
              ? "Credit"
              : "Payment";
      return {
        auditNo: index + 1,
        date: entry.date || "-",
        type: typeLabel,
        reference: entry.reference || "-",
        description: entry.description || "-",
        amountIn: isDebit ? amount : 0,
        amountOut: !isDebit ? amount : 0,
        balance: running,
      };
    });
  }, [ledger]);

  const buttonStyle: React.CSSProperties = {
    border: `1px solid ${GOLD}`,
    background: "#fff",
    color: INK,
    borderRadius: 12,
    padding: "10px 16px",
    fontWeight: 800,
    cursor: "pointer",
  };

  const periods = [
    "Last 10 Transactions",
    "This Year",
    "Last 3 Months",
    "Last 6 Months",
    "Last 9 Months",
    "Last 12 Months",
    "Last 18 Months",
    "Last 24 Months",
    "All Time",
  ];

  return (
    <div style={{ padding: "32px 36px", background: "#f6f4ef", minHeight: "100vh" }}>
      <h1 style={{ margin: 0, fontSize: 34, fontWeight: 900, color: INK }}>
        Statement
        <span style={{ color: "#6b7280", fontSize: 22, fontWeight: 500 }}> » Manage a statement of account</span>
      </h1>
      <div style={{ display: "flex", gap: 10, margin: "24px 0", flexWrap: "wrap" }}>
        <button type="button" style={buttonStyle} onClick={() => setActivePage("statements")}>↩ Back</button>
        <button type="button" style={buttonStyle} onClick={() => setActivePage("payments")}>+ Payment</button>
        <select style={{ ...buttonStyle, minWidth: 200 }} value={period} onChange={(e) => setPeriod(e.target.value)}>
          {periods.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 24, alignItems: "start" }}>
        <section style={{ background: "#fff", border: `1px solid ${GOLD}`, borderRadius: 8, overflow: "hidden" }}>
          <div style={{ background: INK, color: GOLD, padding: "14px 18px", fontWeight: 900 }}>Account</div>
          <div style={{ padding: 22, display: "grid", gap: 12 }}>
            {[["Account No", accountNo || "-"], ["Balance", formatMoney(balance)], ["Last Invoice", selected?.lastInvoice || "No invoices"], ["Last Payment", selected?.lastPayment || "No payments"]].map(([label, value]) => (
              <div key={label} style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 12, alignItems: "center" }}>
                <div style={{ textAlign: "right", fontWeight: 800, color: "#64748b" }}>{label}</div>
                <div style={{ border: "1px solid #e5e7eb", background: "#f8fafc", padding: "10px 12px", borderRadius: 8, fontWeight: 700 }}>{value}</div>
              </div>
            ))}
          </div>
        </section>
        <section style={{ background: "#fff", border: `1px solid ${GOLD}`, borderRadius: 8, padding: 20 }}>
          <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 10 }}>Summary</div>
          <div style={{ fontWeight: 700, lineHeight: 1.8 }}>
            <div>{selected?.name} {selected?.surname}</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: balance > 0 ? "#b91c1c" : "#166534" }}>{formatMoney(balance)}</div>
            <div style={{ color: "#64748b" }}>{selected?.status || "Up To Date"}</div>
          </div>
        </section>
      </div>
      <section style={{ marginTop: 24, background: "#fff", border: `1px solid ${GOLD}`, borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", background: INK, color: GOLD, fontWeight: 900, fontSize: 18 }}>Transactions</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["Audit No", "Date", "Type", "Reference", "Description", "Amount In", "Amount Out", "Balance"].map((h) => (
                  <th key={h} style={{ padding: 12, borderBottom: "1px solid #e5e7eb", textAlign: h.includes("Amount") || h === "Balance" ? "right" : "left", fontSize: 12, fontWeight: 900, color: "#64748b" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transactions.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 28, textAlign: "center", color: "#64748b", fontWeight: 700 }}>No transactions recorded for this account yet.</td></tr>
              ) : (
                transactions.map((row) => (
                  <tr key={`${row.auditNo}-${row.reference}`}>
                    <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{row.auditNo}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{row.date}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{row.type}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{row.reference}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{row.description}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9", textAlign: "right" }}>{row.amountIn ? formatMoney(row.amountIn) : "-"}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9", textAlign: "right" }}>{row.amountOut ? formatMoney(row.amountOut) : "-"}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9", textAlign: "right", fontWeight: 800 }}>{formatMoney(row.balance)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
