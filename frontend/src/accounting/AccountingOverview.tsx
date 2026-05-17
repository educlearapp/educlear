import React from "react";
import {
  ACCOUNTING_GOLD,
  ACCOUNTING_INK,
  accountingCard,
  accountingCardLabel,
  accountingCardValue,
  accountingPageWrap,
  accountingSubtitle,
  accountingTitle,
} from "./accountingTheme";

const CARDS = [
  { label: "Cash Position", value: "—", hint: "Bank balances after import" },
  { label: "Income This Month", value: "—", hint: "Linked from Billing receipts" },
  { label: "Expenses This Month", value: "—", hint: "Posted and candidate expenses" },
  { label: "Net Position", value: "—", hint: "Income minus expenses" },
  { label: "Unreconciled Transactions", value: "—", hint: "Bank lines not matched" },
  { label: "Expense Candidates", value: "—", hint: "Money out awaiting classification" },
];

export default function AccountingOverview() {
  return (
    <div style={accountingPageWrap}>
      <div style={{ borderBottom: `2px solid ${ACCOUNTING_GOLD}`, paddingBottom: 18, marginBottom: 28 }}>
        <h1 style={accountingTitle}>Accounting Overview</h1>
        <p style={accountingSubtitle}>
          School finance at a glance. Cash, income, expenses, and reconciliation — connected to Billing for
          money in and Accounting for money out.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 18,
        }}
      >
        {CARDS.map((card) => (
          <div key={card.label} style={accountingCard}>
            <div style={accountingCardLabel}>{card.label}</div>
            <div style={accountingCardValue}>{card.value}</div>
            <div style={{ marginTop: 10, fontSize: 13, color: "#64748b", fontWeight: 600 }}>{card.hint}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 28,
          padding: 20,
          borderRadius: 12,
          background: ACCOUNTING_INK,
          color: ACCOUNTING_GOLD,
          fontWeight: 700,
          fontSize: 14,
        }}
      >
        Use Banking for bank statement import and reconciliation. Payroll, expenses, and journals will roll up here
        as modules are enabled.
      </div>
    </div>
  );
}
