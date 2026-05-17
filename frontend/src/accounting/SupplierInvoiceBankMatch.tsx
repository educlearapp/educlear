import React, { useMemo, useState } from "react";
import { formatMoney } from "../billing/billingLedger";
import { ACCOUNTING_GOLD, ACCOUNTING_INK } from "./accountingTheme";
import {
  createSupplierInvoiceFromBankLine,
  listOpenSupplierInvoicesForPayment,
  matchBankTransactionToSupplierInvoice,
  suggestSupplierInvoicesForBankLine,
} from "./supplierInvoiceHelpers";
import { loadSuppliersForMatching } from "../banking/bankingReconciliationUtils";

type Props = {
  schoolId: string;
  bankTransactionId: string;
  date: string;
  description: string;
  amount: number;
  reference?: string;
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
  onClose,
  onMatched,
}: Props) {
  const [selectedId, setSelectedId] = useState("");
  const [message, setMessage] = useState("");
  const [createMode, setCreateMode] = useState(false);
  const [supplierName, setSupplierName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState(reference || "");

  const suggestions = useMemo(
    () =>
      suggestSupplierInvoicesForBankLine({
        schoolId,
        description,
        amount,
        date,
        reference,
      }),
    [schoolId, description, amount, date, reference]
  );

  const openInvoices = useMemo(() => listOpenSupplierInvoicesForPayment(schoolId), [schoolId]);

  const handleMatch = () => {
    if (!selectedId) {
      setMessage("Select an invoice to match.");
      return;
    }
    try {
      matchBankTransactionToSupplierInvoice({
        schoolId,
        invoiceId: selectedId,
        bankTransactionId,
        paymentDate: date,
        amount,
        reference: reference || description,
      });
      setMessage("Bank line matched to supplier invoice.");
      onMatched();
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : "Match failed.");
    }
  };

  const handleCreateAndPay = () => {
    const suppliers = loadSuppliersForMatching(schoolId);
    const match = suppliers.find((s) => s.name.toLowerCase() === supplierName.trim().toLowerCase());
    try {
      createSupplierInvoiceFromBankLine({
        schoolId,
        supplierId: match?.id || "",
        supplierName: supplierName.trim() || description.slice(0, 40),
        category: match?.category || "Other",
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate: date,
        dueDate: date,
        amount,
        vatAmount: 0,
        totalAmount: amount,
        description: description.trim(),
        notes: "Created from bank statement line",
        captureMethod: "Banking Match",
        paymentDate: date,
        paymentReference: reference || description,
        bankTransactionId,
        confirmCombined: true,
      });
      setMessage("Supplier invoice created, approved, and paid from bank line.");
      onMatched();
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : "Create failed.");
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        zIndex: 6000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          background: "#fff",
          border: `2px solid ${ACCOUNTING_GOLD}`,
          borderRadius: 14,
          width: "min(720px, 100%)",
          maxHeight: "90vh",
          overflow: "auto",
          padding: 22,
        }}
      >
        <h3 style={{ marginTop: 0, color: ACCOUNTING_INK }}>Match to Supplier Invoice</h3>
        <p style={{ color: "#64748b", fontWeight: 600 }}>
          {formatMoney(amount)} out · {date} · {description}
        </p>

        {message ? (
          <div style={{ marginBottom: 12, padding: 10, borderRadius: 8, background: "#f8fafc", fontWeight: 700 }}>
            {message}
          </div>
        ) : null}

        {!createMode ? (
          <>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Suggested matches</div>
            {suggestions.length === 0 ? (
              <p style={{ color: "#64748b" }}>No strong matches. Select from open invoices or create new.</p>
            ) : (
              <ul style={{ paddingLeft: 18 }}>
                {suggestions.slice(0, 5).map((s) => (
                  <li key={s.invoice.id} style={{ marginBottom: 8 }}>
                    <label style={{ cursor: "pointer", fontWeight: 700 }}>
                      <input
                        type="radio"
                        name="match"
                        checked={selectedId === s.invoice.id}
                        onChange={() => setSelectedId(s.invoice.id)}
                      />{" "}
                      {s.invoice.supplierName} · {s.invoice.invoiceNumber || s.invoice.id} ·{" "}
                      {formatMoney(s.invoice.balance)} — {s.reason}
                    </label>
                  </li>
                ))}
              </ul>
            )}

            <div style={{ fontWeight: 800, margin: "16px 0 8px" }}>All open invoices</div>
            <select
              style={{ width: "100%", padding: 10, borderRadius: 8, fontWeight: 600 }}
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              <option value="">Select invoice…</option>
              {openInvoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.supplierName} · {inv.invoiceNumber || inv.id} · {formatMoney(inv.balance)} due{" "}
                  {inv.dueDate}
                </option>
              ))}
            </select>

            <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
              <button type="button" style={goldBtn} onClick={handleMatch}>
                Match &amp; record payment
              </button>
              <button type="button" style={goldBtn} onClick={() => setCreateMode(true)}>
                Create invoice from bank line
              </button>
              <button type="button" style={goldBtn} onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ color: "#b45309", fontWeight: 700 }}>
              Creates invoice, approves liability, and records payment in one step (with confirmation).
            </p>
            <label style={{ display: "block", marginBottom: 10 }}>
              Supplier name
              <input
                style={{ width: "100%", padding: 10, marginTop: 4 }}
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
              />
            </label>
            <label style={{ display: "block", marginBottom: 10 }}>
              Invoice number
              <input
                style={{ width: "100%", padding: 10, marginTop: 4 }}
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
              />
            </label>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button type="button" style={goldBtn} onClick={handleCreateAndPay}>
                Confirm create &amp; pay
              </button>
              <button type="button" style={goldBtn} onClick={() => setCreateMode(false)}>
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
