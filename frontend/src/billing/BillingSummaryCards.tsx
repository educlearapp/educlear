import React from "react";
import { calculateBillingSummary } from "./billingCalculations";
import { formatMoney } from "./billingLedger";

const GOLD = "#d4af37";

const summaryWrap: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(5, minmax(150px, 1fr))",
  gap: "12px",
  marginBottom: "18px",
};

const summaryCard: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid rgba(15,23,42,0.08)",
  borderTop: `3px solid ${GOLD}`,
  borderRadius: "14px",
  padding: "16px",
  boxShadow: "0 10px 26px rgba(15,23,42,0.06)",
  minHeight: "78px",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
};

const summaryValue: React.CSSProperties = {
  fontSize: "18px",
  fontWeight: 900,
  color: "#0f172a",
  marginBottom: "4px",
};

const summaryLabel: React.CSSProperties = {
  fontSize: "11px",
  fontWeight: 900,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

type Props = {
  rows: any[];
  style?: React.CSSProperties;
};

export default function BillingSummaryCards({ rows, style }: Props) {
  const { accountsCount, totalOutstanding, recentlyOwing, badDebt, overPaid } =
    calculateBillingSummary(rows);

  return (
    <div style={{ ...summaryWrap, ...style }}>
      <div style={summaryCard}>
        <div style={summaryValue}>{accountsCount}</div>
        <div style={summaryLabel}>Accounts</div>
      </div>
      <div style={summaryCard}>
        <div style={summaryValue}>{formatMoney(totalOutstanding)}</div>
        <div style={summaryLabel}>Total Outstanding</div>
      </div>
      <div style={summaryCard}>
        <div style={summaryValue}>{formatMoney(recentlyOwing)}</div>
        <div style={summaryLabel}>Recently Owing</div>
      </div>
      <div style={summaryCard}>
        <div style={{ ...summaryValue, color: "#b91c1c" }}>{formatMoney(badDebt)}</div>
        <div style={summaryLabel}>Bad Debt</div>
      </div>
      <div style={summaryCard}>
        <div style={{ ...summaryValue, color: "#15803d" }}>{formatMoney(overPaid)}</div>
        <div style={summaryLabel}>Over Paid</div>
      </div>
    </div>
  );
}
