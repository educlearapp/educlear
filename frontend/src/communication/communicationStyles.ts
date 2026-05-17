import type React from "react";

export const GOLD = "#d4af37";
export const INK = "#111827";

export const pageWrap: React.CSSProperties = {
  padding: 26,
  background: "#f8fafc",
  minHeight: "100%",
  borderRadius: 20,
  border: "1px solid rgba(15,23,42,0.08)",
};

export const summaryCard: React.CSSProperties = {
  background: "#fff",
  borderRadius: 18,
  padding: "22px 20px",
  border: "1px solid rgba(212,175,55,0.35)",
  boxShadow: "0 10px 25px rgba(15,23,42,0.05)",
};

export const goldBtn: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "1px solid #b89329",
  background: "linear-gradient(135deg, #f7d56a, #d4af37)",
  color: INK,
  fontWeight: 900,
  cursor: "pointer",
};

export const ghostBtn: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: `1px solid ${GOLD}`,
  background: "#fff",
  color: INK,
  fontWeight: 800,
  cursor: "pointer",
};

export const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  fontWeight: 600,
  boxSizing: "border-box",
};

export const th: React.CSSProperties = {
  padding: 12,
  borderBottom: "1px solid #e5e7eb",
  textAlign: "left",
  fontSize: 13,
  color: "#334155",
  background: "rgba(212,175,55,0.16)",
  fontWeight: 900,
};

export const td: React.CSSProperties = {
  padding: 12,
  borderBottom: "1px solid #e5e7eb",
  fontSize: 13,
  color: "#0f172a",
  fontWeight: 700,
};

export const modalOverlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.55)",
  zIndex: 6000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
};

export const modalPanel: React.CSSProperties = {
  background: "#fff",
  border: `2px solid ${GOLD}`,
  borderRadius: 14,
  width: "min(720px, 100%)",
  maxHeight: "90vh",
  overflow: "auto",
  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
};
