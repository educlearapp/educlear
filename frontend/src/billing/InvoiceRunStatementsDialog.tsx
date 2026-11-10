import React, { useMemo, useState } from "react";
import {
  INVOICE_RUN_STATEMENT_DEFAULT_PERIOD,
  INVOICE_RUN_STATEMENT_PERIOD_CHOICES,
  buildInvoiceRunStatementConfirmation,
  describeInvoiceRunStatementPeriodSupport,
  invoiceRunStatementClosingBalanceLimitationNote,
  resolveInvoiceRunStatementWindow,
  type InvoiceRunStatementPeriodChoice,
} from "./invoiceRunStatementPeriod";

const GOLD = "#d4af37";
const INK = "#111827";

export type InvoiceRunStatementsDialogProps = {
  open: boolean;
  busy?: boolean;
  runDescription: string;
  invoiceDate: string;
  invoiceCount: number;
  uniqueFamilyAccountCount: number;
  initialPeriod?: string;
  /** When true, primary action is email rather than combined PDF. */
  mode?: "pdf" | "email";
  onClose: () => void;
  onConfirm: (enginePeriod: string) => void | Promise<void>;
};

export default function InvoiceRunStatementsDialog({
  open,
  busy = false,
  runDescription,
  invoiceDate,
  invoiceCount,
  uniqueFamilyAccountCount,
  initialPeriod = INVOICE_RUN_STATEMENT_DEFAULT_PERIOD,
  mode = "pdf",
  onClose,
  onConfirm,
}: InvoiceRunStatementsDialogProps) {
  const [choice, setChoice] = useState<InvoiceRunStatementPeriodChoice>(
    (initialPeriod as InvoiceRunStatementPeriodChoice) || INVOICE_RUN_STATEMENT_DEFAULT_PERIOD
  );

  const windowInfo = useMemo(() => resolveInvoiceRunStatementWindow(choice), [choice]);
  const support = useMemo(() => describeInvoiceRunStatementPeriodSupport(choice), [choice]);
  const confirmation = useMemo(
    () =>
      buildInvoiceRunStatementConfirmation({
        familyAccountCount: uniqueFamilyAccountCount,
        choice,
      }),
    [uniqueFamilyAccountCount, choice]
  );

  if (!open) return null;

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
  const btn: React.CSSProperties = {
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
  const goldBtn: React.CSSProperties = {
    ...btn,
    background: busy || !confirmation.ok ? "#e5e7eb" : `linear-gradient(135deg, #f7d56a, ${GOLD})`,
    border: "1px solid #b89329",
    opacity: busy || !confirmation.ok ? 0.72 : 1,
  };

  const actionLabel =
    mode === "email"
      ? `Email Statements (${uniqueFamilyAccountCount})`
      : `Generate Combined PDF (${uniqueFamilyAccountCount})`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="invoice-run-statements-dialog-title"
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
          width: "min(560px, 100%)",
          background: "#fff",
          borderRadius: 14,
          border: `2px solid ${GOLD}`,
          boxShadow: "0 24px 60px rgba(15,23,42,0.28)",
          maxHeight: "90vh",
          overflow: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          id="invoice-run-statements-dialog-title"
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
          <span>{mode === "email" ? "Email Statements" : "Print Statements"}</span>
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
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ padding: 22, display: "grid", gap: 16 }}>
          <section>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b", marginBottom: 8 }}>
              SELECTED INVOICE RUN
            </div>
            <div style={{ fontWeight: 800, color: INK }}>{runDescription || "Invoice run"}</div>
            <div style={{ fontSize: 13, color: "#475569", marginTop: 6, lineHeight: 1.5 }}>
              Invoice date: {invoiceDate || "—"}
              <br />
              Invoice lines: {Number(invoiceCount || 0)}
              <br />
              Unique family accounts: {Number(uniqueFamilyAccountCount || 0)}
            </div>
          </section>

          <section>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b", marginBottom: 8 }}>
              STATEMENT PERIOD
            </div>
            <label style={{ display: "grid", gap: 8, fontSize: 12, fontWeight: 800, color: "#64748b" }}>
              Period
              <select
                style={fieldStyle}
                value={choice}
                disabled={busy}
                onChange={(e) => setChoice(e.target.value as InvoiceRunStatementPeriodChoice)}
              >
                {INVOICE_RUN_STATEMENT_PERIOD_CHOICES.map((option) => {
                  const optionSupport = describeInvoiceRunStatementPeriodSupport(option);
                  return (
                    <option key={option} value={option}>
                      {option}
                      {optionSupport.supported ? "" : " (not supported by statement engine)"}
                    </option>
                  );
                })}
              </select>
            </label>
            <div style={{ marginTop: 10, fontSize: 13, color: "#475569", fontWeight: 600 }}>
              {windowInfo.supported ? (
                <>
                  Statement window: {windowInfo.label}
                  <br />
                  Statement end date: {windowInfo.endDate}
                </>
              ) : (
                <span style={{ color: "#991b1b" }}>{support.reason}</span>
              )}
            </div>
          </section>

          <section>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b", marginBottom: 8 }}>
              OUTPUT
            </div>
            <div style={{ fontSize: 13, color: "#334155", fontWeight: 600, lineHeight: 1.5 }}>
              {mode === "email"
                ? "Email Statements to Parents (existing email pathway; no SMS attachments)."
                : "Generate Combined PDF — one statement per unique family account, new page each."}
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: "#92400e", lineHeight: 1.5 }}>
              {invoiceRunStatementClosingBalanceLimitationNote()}
            </div>
          </section>

          <section
            style={{
              padding: 12,
              borderRadius: 10,
              background: confirmation.ok ? "rgba(212,175,55,0.12)" : "rgba(248,113,113,0.12)",
              border: `1px solid ${confirmation.ok ? "rgba(184,147,41,0.45)" : "rgba(185,28,28,0.35)"}`,
              fontSize: 13,
              fontWeight: 700,
              color: confirmation.ok ? "#78350f" : "#991b1b",
              lineHeight: 1.5,
            }}
          >
            {confirmation.message}
          </section>
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
          <button type="button" style={btn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            style={goldBtn}
            disabled={busy || !confirmation.ok || !support.enginePeriod}
            aria-busy={busy}
            onClick={() => {
              if (!confirmation.ok || !support.enginePeriod) return;
              if (!window.confirm(confirmation.message)) return;
              void onConfirm(support.enginePeriod);
            }}
          >
            {busy ? "Generating…" : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
