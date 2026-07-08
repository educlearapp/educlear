import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BillingEnvDebug from "./BillingEnvDebug";
import BillingSummaryCards from "./BillingSummaryCards";
import {
  accountsFromStatementRows,
  type PaymentAccountContext,
} from "./paymentCreateShared";
import { sendPaymentReceiptEmail } from "./paymentAllocationApi";

type BillingSearchFocusRequest = {
  page: "payments" | "statements" | "invoices";
  token: number;
};

function shouldFocusBillingSearch(
  focusRequest: BillingSearchFocusRequest | null | undefined,
  page: BillingSearchFocusRequest["page"]
): boolean {
  return Boolean(focusRequest && focusRequest.page === page && focusRequest.token > 0);
}

type PendingReceiptPrompt = {
  paymentId: string;
  receiptNumber: string;
};

type PaymentsProps = {
  schoolId?: string;
  statementRows: any[];
  learners?: any[];
  selectedAccount?: PaymentAccountContext | null;
  onSelectAccount?: (account: PaymentAccountContext) => void;
  onOpenPaymentCreate?: (account: PaymentAccountContext) => void;
  setActivePage: React.Dispatch<React.SetStateAction<any>>;
  showSummaryCards?: boolean;
  searchResetToken?: number;
  searchFocusRequest?: BillingSearchFocusRequest | null;
  pendingReceiptPrompt?: PendingReceiptPrompt | null;
  onDismissReceiptPrompt?: () => void;
};

const PAGE_SIZE = 10;

export default function Payments({
  schoolId = "",
  statementRows,
  learners = [],
  onOpenPaymentCreate,
  setActivePage,
  showSummaryCards = true,
  searchResetToken = 0,
  searchFocusRequest,
  pendingReceiptPrompt,
  onDismissReceiptPrompt,
}: PaymentsProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [receiptSendBusy, setReceiptSendBusy] = useState(false);
  const [receiptSendError, setReceiptSendError] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const focusSearchToken = shouldFocusBillingSearch(searchFocusRequest, "payments")
    ? searchFocusRequest?.token
    : undefined;

  useEffect(() => {
    if (pendingReceiptPrompt || !focusSearchToken) return;
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingReceiptPrompt, focusSearchToken]);

  useEffect(() => {
    if (!searchResetToken) return;
    setSearch("");
    setPage(1);
  }, [searchResetToken]);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const sendSavedReceiptEmail = useCallback(async () => {
    if (!pendingReceiptPrompt || !schoolId) return;
    setReceiptSendBusy(true);
    setReceiptSendError("");
    try {
      await sendPaymentReceiptEmail(schoolId, pendingReceiptPrompt.paymentId);
      onDismissReceiptPrompt?.();
    } catch (error) {
      setReceiptSendError(
        error instanceof Error ? error.message : "Receipt email could not be sent."
      );
    } finally {
      setReceiptSendBusy(false);
    }
  }, [pendingReceiptPrompt, schoolId, onDismissReceiptPrompt]);

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
      <BillingEnvDebug />
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 34, fontWeight: 900, color: "#0f172a" }}>
          New Payment
        </h1>
        <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>
          Create a new payment
        </p>
      </div>

      {showSummaryCards ? <BillingSummaryCards rows={statementRows} /> : null}

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
            ref={searchInputRef}
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

      {pendingReceiptPrompt ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 10000,
            background: "rgba(17,24,39,0.48)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              width: 420,
              maxWidth: "100%",
              background: "#fff",
              border: "2px solid #d4af37",
              borderRadius: 14,
              boxShadow: "0 24px 70px rgba(0,0,0,0.28)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                background: "#111827",
                color: "#d4af37",
                padding: "14px 18px",
                fontWeight: 900,
                fontSize: 20,
              }}
            >
              Receipt Saved
            </div>
            <div style={{ padding: 18, color: "#111827", fontWeight: 700, lineHeight: 1.65 }}>
              <p style={{ margin: 0 }}>
                Receipt {pendingReceiptPrompt.receiptNumber} has been saved.
              </p>
              <p style={{ margin: "12px 0 0" }}>
                Would you like to send this receipt now?
              </p>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10,
                padding: "0 18px 18px",
              }}
            >
              <button
                type="button"
                style={{
                  ...payBtn,
                  opacity: receiptSendBusy ? 0.6 : 1,
                  cursor: receiptSendBusy ? "not-allowed" : "pointer",
                }}
                disabled={receiptSendBusy}
                onClick={() => {
                  setReceiptSendError("");
                  onDismissReceiptPrompt?.();
                }}
              >
                No
              </button>
              <button
                type="button"
                style={{
                  ...payGoldBtn,
                  opacity: receiptSendBusy ? 0.6 : 1,
                  cursor: receiptSendBusy ? "not-allowed" : "pointer",
                }}
                disabled={receiptSendBusy}
                onClick={() => void sendSavedReceiptEmail()}
              >
                {receiptSendBusy ? "Sending..." : "Yes"}
              </button>
            </div>
            {receiptSendError ? (
              <p
                style={{
                  margin: "0 18px 18px",
                  padding: "9px 10px",
                  borderRadius: 8,
                  background: "#fef2f2",
                  color: "#b91c1c",
                  fontWeight: 800,
                  fontSize: 13,
                }}
                role="alert"
              >
                {receiptSendError}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}