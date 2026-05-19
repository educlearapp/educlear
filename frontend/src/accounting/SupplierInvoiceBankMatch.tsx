import React, { useEffect, useState } from "react";
import { formatMoney } from "../billing/billingLedger";
import { ACCOUNTING_GOLD, ACCOUNTING_INK } from "./accountingTheme";
import {
  acceptBankSupplierMatch,
  fetchBankMatchSuggestions,
  fetchOpenSupplierInvoices,
  mergeJournalsIntoLocalStore,
} from "./accountingSuppliersApi";

type Props = {
  schoolId: string;
  bankTransactionId: string;
  date: string;
  description: string;
  amount: number;
  reference?: string;
  suggestedInvoiceId?: string;
  onClose: () => void;
  onMatched: () => void;
};

const goldBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid #b89329",
  background: "linear-gradient(135deg, #f7d56a, #d4af37)",
  color: ACCOUNTING_INK,
  fontWeight: 900,
  cursor: "pointer",
  fontSize: 12,
};

export default function SupplierInvoiceBankMatch({
  schoolId,
  bankTransactionId,
  date,
  description,
  amount,
  reference,
  suggestedInvoiceId,
  onClose,
  onMatched,
}: Props) {
  const [selectedId, setSelectedId] = useState(suggestedInvoiceId || "");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<
    Array<{
      invoiceId: string;
      invoiceNumber: string;
      supplierName: string;
      score: number;
      reason: string;
    }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchBankMatchSuggestions(
          schoolId,
          description,
          reference || "",
          amount
        );
        if (!cancelled) {
          setSuggestions(res.suggestions || []);
          if (res.best?.invoiceId) setSelectedId(res.best.invoiceId);
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolId, description, reference, amount]);

  const [openList, setOpenList] = useState<
    Array<{ id: string; invoiceNumber: string; supplierName: string; outstandingAmount: number }>
  >([]);

  useEffect(() => {
    fetchOpenSupplierInvoices(schoolId)
      .then((res) =>
        setOpenList(
          res.invoices.map((inv) => ({
            id: inv.id,
            invoiceNumber: inv.invoiceNumber,
            supplierName: inv.supplierName,
            outstandingAmount: inv.outstandingAmount,
          }))
        )
      )
      .catch(() => setOpenList([]));
  }, [schoolId]);

  const handleMatch = async () => {
    if (!selectedId) {
      setMessage("Select an invoice to match.");
      return;
    }
    setLoading(true);
    try {
      const res = await acceptBankSupplierMatch({
        schoolId,
        invoiceId: selectedId,
        bankTransactionId,
        amount,
        paymentDate: date,
        reference: reference || description,
      });
      if (res.journal) mergeJournalsIntoLocalStore(schoolId, [res.journal]);
      setMessage("Bank line matched to supplier invoice.");
      onMatched();
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : "Match failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        zIndex: 7000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          border: `2px solid ${ACCOUNTING_GOLD}`,
          borderRadius: 14,
          padding: 24,
          width: "min(520px, 100%)",
          maxHeight: "85vh",
          overflow: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0, color: ACCOUNTING_INK }}>Match supplier invoice</h3>
        <p style={{ fontSize: 13, color: "#64748b" }}>
          {description} · {formatMoney(amount)}
        </p>

        {suggestions.length > 0 ? (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 12, marginBottom: 6 }}>Suggested matches</div>
            {suggestions.map((s) => (
              <label
                key={s.invoiceId}
                style={{
                  display: "block",
                  padding: 8,
                  marginBottom: 6,
                  border: selectedId === s.invoiceId ? `2px solid ${ACCOUNTING_GOLD}` : "1px solid #e2e8f0",
                  borderRadius: 8,
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="inv"
                  checked={selectedId === s.invoiceId}
                  onChange={() => setSelectedId(s.invoiceId)}
                />{" "}
                {s.invoiceNumber || s.invoiceId} — {s.supplierName} (score {s.score}) — {s.reason}
              </label>
            ))}
          </div>
        ) : null}

        <label style={{ display: "block", fontWeight: 700, fontSize: 12 }}>
          Open invoices
          <select
            style={{ width: "100%", marginTop: 6, padding: 10, borderRadius: 8 }}
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            <option value="">Select invoice…</option>
            {openList.map((inv) => (
              <option key={inv.id} value={inv.id}>
                {inv.invoiceNumber} — {inv.supplierName} (outstanding {formatMoney(inv.outstandingAmount)})
              </option>
            ))}
          </select>
        </label>

        {message ? <p style={{ color: "#b45309", fontWeight: 700 }}>{message}</p> : null}

        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
          <button type="button" style={{ padding: "8px 14px", borderRadius: 8 }} onClick={onClose}>
            Cancel
          </button>
          <button type="button" style={goldBtn} disabled={loading} onClick={() => void handleMatch()}>
            Accept supplier match
          </button>
        </div>
      </div>
    </div>
  );
}
