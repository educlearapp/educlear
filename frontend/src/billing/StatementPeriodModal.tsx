import React from "react";
import {
  DEFAULT_STATEMENT_PERIOD,
  STATEMENT_PERIOD_OPTIONS,
  formatStatementPeriodHeaderLabel,
  normalizeStatementPeriod,
} from "./statementPeriod";

const GOLD = "#d4af37";
const INK = "#111827";

export const STATEMENT_EXPORT_PERIOD_STORAGE_KEY = "educlear:lastStatementExportPeriod";

export function readRememberedStatementExportPeriod(): string {
  try {
    const stored = localStorage.getItem(STATEMENT_EXPORT_PERIOD_STORAGE_KEY);
    if (stored) return normalizeStatementPeriod(stored);
  } catch {
    /* ignore */
  }
  return DEFAULT_STATEMENT_PERIOD;
}

export function persistStatementExportPeriod(period: string): void {
  try {
    localStorage.setItem(STATEMENT_EXPORT_PERIOD_STORAGE_KEY, normalizeStatementPeriod(period));
  } catch {
    /* ignore */
  }
}

type Props = {
  title: string;
  actionLabel: string;
  period: string;
  busy?: boolean;
  onPeriodChange: (period: string) => void;
  onConfirm: () => void;
  onClose?: () => void;
};

export default function StatementPeriodModal({
  title,
  actionLabel,
  period,
  busy = false,
  onPeriodChange,
  onConfirm,
  onClose,
}: Props) {
  const modalBtn: React.CSSProperties = {
    border: `1px solid ${GOLD}`,
    background: "#fff",
    color: INK,
    borderRadius: 8,
    padding: "8px 14px",
    fontWeight: 800,
    fontSize: 13,
    cursor: busy ? "not-allowed" : "pointer",
    minWidth: 110,
  };

  const modalGoldBtn: React.CSSProperties = {
    ...modalBtn,
    background: busy ? "#e5e7eb" : `linear-gradient(135deg, #f7d56a, ${GOLD})`,
    border: "1px solid #b89329",
    opacity: busy ? 0.72 : 1,
  };

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    fontWeight: 700,
    fontSize: 14,
    background: "#fff",
    color: INK,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="statement-period-modal-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1200,
        padding: 24,
      }}
      onClick={busy ? undefined : onClose}
    >
      <div
        style={{
          width: "min(480px, 100%)",
          background: "#fff",
          borderRadius: 14,
          border: `2px solid ${GOLD}`,
          boxShadow: "0 24px 60px rgba(15,23,42,0.28)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          id="statement-period-modal-title"
          style={{
            background: INK,
            color: GOLD,
            padding: "16px 20px",
            fontWeight: 900,
            fontSize: 18,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{title}</span>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Close"
              style={{
                border: `1px solid ${GOLD}`,
                background: "transparent",
                color: GOLD,
                borderRadius: 8,
                padding: "4px 10px",
                fontWeight: 800,
                cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.5 : 1,
              }}
            >
              ✕
            </button>
          ) : null}
        </div>
        <div style={{ padding: 22 }}>
          <p style={{ margin: "0 0 14px", lineHeight: 1.6, color: "#334155", fontWeight: 600 }}>
            Choose the statement period. Transactions are filtered by transaction date on the server.
          </p>
          <label style={{ display: "grid", gap: 8, fontSize: 12, fontWeight: 800, color: "#64748b" }}>
            Statement period
            <select
              style={fieldStyle}
              value={period}
              disabled={busy}
              onChange={(e) => onPeriodChange(e.target.value)}
            >
              {STATEMENT_PERIOD_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <p style={{ margin: "12px 0 0", fontSize: 13, color: "#64748b", fontWeight: 600 }}>
            {formatStatementPeriodHeaderLabel(period)}
          </p>
        </div>
        <div
          style={{
            padding: "14px 22px 22px",
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            flexWrap: "wrap",
          }}
        >
          {onClose ? (
            <button type="button" style={modalBtn} onClick={onClose} disabled={busy}>
              Cancel
            </button>
          ) : null}
          <button type="button" style={modalGoldBtn} onClick={onConfirm} disabled={busy} aria-busy={busy}>
            {busy ? "Generating…" : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
