import React, { useEffect, useMemo, useState } from "react";
import BillingSummaryCards from "./BillingSummaryCards";
import {
  accountsFromStatementRows,
  type PaymentAccountContext,
} from "./paymentCreateShared";

type PaymentsProps = {
  statementRows: any[];
  learners?: any[];
  selectedAccount?: PaymentAccountContext | null;
  onSelectAccount?: (account: PaymentAccountContext) => void;
  onOpenPaymentCreate?: (account: PaymentAccountContext) => void;
  setActivePage: React.Dispatch<React.SetStateAction<any>>;
};

const PAGE_SIZE = 10;

export default function Payments({
  statementRows,
  learners = [],
  onOpenPaymentCreate,
  setActivePage,
}: PaymentsProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [search]);

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

  const paymentAccounts = useMemo(
    () => accountsFromStatementRows(statementRows, learners),
    [statementRows, learners]
  );

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return paymentAccounts;
    return paymentAccounts.filter((account: any) =>
      [
        account.accountNo,
        account.name,
        account.surname,
        account.status,
        account.lastInvoice,
        account.lastPayment,
        String(account.balance),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [paymentAccounts, search]);

  const totalPages = Math.max(1, Math.ceil(filteredAccounts.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedAccounts = filteredAccounts.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );
  const firstItem =
    filteredAccounts.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const lastItem = Math.min(safePage * PAGE_SIZE, filteredAccounts.length);

  const openPaymentCreate = (account: PaymentAccountContext) => {
    if (onOpenPaymentCreate) {
      onOpenPaymentCreate(account);
      return;
    }
    setActivePage("paymentCreate");
  };


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

      <BillingSummaryCards rows={statementRows} />

      <div style={{ marginBottom: 14 }}>
        <button type="button" style={payBtn} onClick={() => setActivePage("statements")}>
          ☰ View Statements
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
          </div>
          <input
            placeholder="Search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...selectStyle, width: 260 }}
          />
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
            {pagedAccounts.map((account: any, index: number) => (
              <tr
                key={`${account.accountNo || account.learnerId || "row"}-${index}`}
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

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 16,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <span style={{ color: "#64748b", fontWeight: 800 }}>
            {firstItem} - {lastItem} / {filteredAccounts.length}
          </span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              style={payBtn}
              disabled={safePage <= 1}
              onClick={() => setPage(1)}
            >
              «
            </button>
            <button
              type="button"
              style={payBtn}
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ‹
            </button>
            <span style={{ padding: "0 8px", fontWeight: 900, color: "#0f172a" }}>
              Page {safePage} / {totalPages}
            </span>
            <button
              type="button"
              style={payBtn}
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              ›
            </button>
            <button
              type="button"
              style={payBtn}
              disabled={safePage >= totalPages}
              onClick={() => setPage(totalPages)}
            >
              »
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}