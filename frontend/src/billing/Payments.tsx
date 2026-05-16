import React from "react";
import { formatMoney } from "./billingLedger";

type PaymentsProps = {
  statementRows: any[];
  setActivePage: React.Dispatch<React.SetStateAction<any>>;
};

export default function Payments({ statementRows, setActivePage }: PaymentsProps) {
  const payBtn: React.CSSProperties = {
    border: "1px solid #b89329",
    background: "#ffffff",
    color: "#111827",
    borderRadius: 10,
    padding: "10px 16px",
    fontWeight: 900,
    cursor: "pointer",
  };

  const payGoldBtn: React.CSSProperties = {
    ...payBtn,
    background: "linear-gradient(135deg, #f7d56a, #d4af37)",
    boxShadow: "0 10px 24px rgba(212, 175, 55, 0.25)",
  };

  const selectStyle: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    background: "#fff",
    color: "#111827",
    fontWeight: 700,
  };

  const summaryCard: React.CSSProperties = {
    background: "#fff",
    borderRadius: 18,
    padding: "22px 20px",
    border: "1px solid rgba(212,175,55,0.35)",
    boxShadow: "0 10px 25px rgba(15,23,42,0.05)",
  };

  const th: React.CSSProperties = {
    padding: "12px",
    borderBottom: "1px solid #e5e7eb",
    textAlign: "left",
    fontSize: 13,
    color: "#334155",
    background: "rgba(212,175,55,0.16)",
    fontWeight: 900,
  };

  const td: React.CSSProperties = {
    padding: "12px",
    borderBottom: "1px solid #e5e7eb",
    fontSize: 13,
    color: "#0f172a",
    fontWeight: 700,
  };

  const paymentAccounts = statementRows.map((row: any, index: number) => ({
    id: row.id || row.learnerId || row.accountNo || `account-${index}`,
    learnerId: row.learnerId || row.id || row.accountNo || `account-${index}`,
    accountNo: row.accountNo || "-",
    name: row.name || "",
    surname: row.surname || "",
    balance: Number(row.balance || 0),
    lastInvoice: row.lastInvoice || "No invoices",
    lastPayment: row.lastPayment || "No payments",
    status: row.status || "Up To Date",
  }));

  const openPaymentCreate = (account: any) => {
    localStorage.setItem(
      "selectedPaymentAccount",
      JSON.stringify({
        ...account,
        learnerId: account.learnerId || account.id || account.accountNo,
        id: account.id || account.learnerId || account.accountNo,
      })
    );
    setActivePage("paymentCreate");
  };

  const totalOutstanding = paymentAccounts.reduce(
    (sum: number, row: any) => sum + Math.max(Number(row.balance || 0), 0),
    0
  );

  const overPaid = paymentAccounts.reduce(
    (sum: number, row: any) => sum + Math.min(Number(row.balance || 0), 0),
    0
  );

  return (
    <div
      style={{
        padding: 26,
        background: "#f8fafc",
        minHeight: "100%",
        borderRadius: 20,
        border: "1px solid rgba(15,23,42,0.08)",
      }}
    >
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 34, fontWeight: 900, color: "#0f172a" }}>
          New Payment
        </h1>
        <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>
          Create a new payment
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, minmax(140px, 1fr))",
          gap: 16,
          marginBottom: 22,
        }}
      >
        <div style={summaryCard}>
          <div style={{ fontSize: 24, fontWeight: 950 }}>{paymentAccounts.length}</div>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>ACCOUNTS</div>
        </div>
        <div style={summaryCard}>
          <div style={{ fontSize: 24, fontWeight: 950 }}>{formatMoney(totalOutstanding)}</div>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>TOTAL OUTSTANDING</div>
        </div>
        <div style={summaryCard}>
          <div style={{ fontSize: 24, fontWeight: 950 }}>R 0.00</div>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>RECENTLY OWING</div>
        </div>
        <div style={summaryCard}>
          <div style={{ fontSize: 24, fontWeight: 950, color: "#b91c1c" }}>R 0.00</div>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>BAD DEBT</div>
        </div>
        <div style={summaryCard}>
          <div style={{ fontSize: 24, fontWeight: 950, color: "#15803d" }}>
            {formatMoney(Math.abs(overPaid))}
          </div>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>OVER PAID</div>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <button type="button" style={payBtn} onClick={() => setActivePage("payments")}>
          ☰ Switch To Manage Payments
        </button>
      </div>

      <div
        style={{
          background: "#fff",
          borderRadius: 20,
          padding: 18,
          border: "1px solid #e5e7eb",
          boxShadow: "0 10px 25px rgba(15,23,42,0.05)",
        }}
      >
        <div
          style={{
            background: "#111827",
            color: "#d4af37",
            margin: "-18px -18px 14px",
            padding: "12px 18px",
            borderRadius: "20px 20px 0 0",
            fontSize: 18,
            fontWeight: 900,
          }}
        >
          Children
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            marginBottom: 14,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              style={payGoldBtn}
              onClick={() => {
                if (!paymentAccounts.length) return alert("No account available.");
                openPaymentCreate(paymentAccounts[0]);
              }}
            >
              + Add
            </button>
            <button
              type="button"
              style={payBtn}
              onClick={() => alert("Add Multiple will be connected to batch payment allocation.")}
            >
              + Add Multiple
            </button>
          </div>
          <input placeholder="Search" style={{ ...selectStyle, width: 260 }} />
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Account No", "Name", "Surname", "Balance", "Last Invoice", "Last Payment", "Account Status"].map(
                (h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {paymentAccounts.map((account: any, index: number) => (
              <tr
                key={account.accountNo || index}
                style={{
                  background: index % 2 === 0 ? "#fffdf7" : "#fff",
                  cursor: "pointer",
                }}
                onClick={() => openPaymentCreate(account)}
              >
                <td style={td}>{account.accountNo}</td>
                <td style={td}>{account.name}</td>
                <td style={td}>{account.surname}</td>
                <td style={td}>R {Number(account.balance || 0).toFixed(2)}</td>
                <td style={td}>{account.lastInvoice}</td>
                <td style={td}>{account.lastPayment}</td>
                <td
                  style={{
                    ...td,
                    color:
                      account.status === "Bad Debt"
                        ? "#b91c1c"
                        : account.status === "Recently Owing"
                          ? "#b45309"
                          : "#166534",
                  }}
                >
                  {account.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}