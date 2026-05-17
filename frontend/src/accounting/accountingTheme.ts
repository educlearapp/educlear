import type React from "react";

export const ACCOUNTING_GOLD = "#d4af37";
export const ACCOUNTING_INK = "#111827";

export const accountingPageWrap: React.CSSProperties = {
  padding: "28px 32px 40px",
  maxWidth: 1200,
};

export const accountingTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 32,
  fontWeight: 900,
  color: ACCOUNTING_INK,
  letterSpacing: "-0.02em",
};

export const accountingSubtitle: React.CSSProperties = {
  margin: "8px 0 0",
  color: "#64748b",
  fontSize: 15,
  fontWeight: 600,
  lineHeight: 1.5,
};

export const accountingCard: React.CSSProperties = {
  border: `2px solid ${ACCOUNTING_GOLD}`,
  borderRadius: 14,
  padding: "20px 22px",
  background: "linear-gradient(180deg, #fff 0%, #faf8f0 100%)",
  boxShadow: "0 8px 24px rgba(17,24,39,0.06)",
};

export const accountingCardLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

export const accountingCardValue: React.CSSProperties = {
  marginTop: 8,
  fontSize: 28,
  fontWeight: 900,
  color: ACCOUNTING_INK,
};
