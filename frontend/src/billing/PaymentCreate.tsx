import React, { useCallback, useEffect, useMemo, useState } from "react";
import { postBillingPaymentJournal } from "../accounting/accountingJournalEngine";
import {
  BILLING_UPDATED_EVENT,
  calculateAccountBalance,
  computeOpenInvoiceLines,
  formatMoney,
  getAccountLedger,
  normaliseBillingAmount,
  notifyBillingUpdated,
  type OpenInvoiceLine,
} from "./billingLedger";
import { createPayment, fetchOpenInvoices, syncBillingLedgerFromApi } from "./billingApi";



type PaymentCreateProps = {



  statementRows: any[];



  setActivePage: React.Dispatch<React.SetStateAction<any>>;



};



const money = (value: any) => formatMoney(value);



export default function PaymentCreate({



  statementRows,



  setActivePage,



}: PaymentCreateProps) {
  const schoolId = localStorage.getItem("schoolId") || "";

  const selected = useMemo(() => {



    try {



      const raw = localStorage.getItem("selectedPaymentAccount");



      return raw ? JSON.parse(raw) : null;



    } catch {



      return null;



    }



  }, []);

  const learnerId = String(selected?.learnerId || selected?.id || "").trim();
  const accountNo = String(selected?.accountNo || "").trim();
  const paymentKey = `paymentDraft:${accountNo || learnerId || "none"}`;

  const [payment, setPayment] = useState<any>(() => {



    try {



      return JSON.parse(localStorage.getItem(paymentKey) || "{}");



    } catch {



      return {};



    }



  });

  const [ledgerTick, setLedgerTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [apiOpenInvoices, setApiOpenInvoices] = useState<OpenInvoiceLine[]>([]);
  const [apiBalance, setApiBalance] = useState<number | null>(null);

  const refreshLedger = useCallback(async () => {
    if (!schoolId) {
      setLoading(false);
      setLoadError("School not loaded. Sign in again and retry.");
      return;
    }
    setLoading(true);
    setLoadError("");
    try {
      await syncBillingLedgerFromApi(schoolId);
      if (learnerId || accountNo) {
        const { openInvoices, balance } = await fetchOpenInvoices(
          schoolId,
          learnerId,
          accountNo
        );
        setApiOpenInvoices(
          openInvoices.map((row: any) => ({
            id: String(row.id || ""),
            audit: String(row.audit || row.id || ""),
            type: String(row.type || "Invoice"),
            date: String(row.date || "").slice(0, 10),
            reference: String(row.reference || ""),
            description: String(row.description || ""),
            unpaid: Number(row.unpaid || 0),
            amount: Number(row.amount || row.unpaid || 0),
          }))
        );
        setApiBalance(balance);
      } else {
        setApiOpenInvoices([]);
        setApiBalance(null);
      }
      setLedgerTick((v) => v + 1);
    } catch (error) {
      console.error(error);
      setLoadError("Could not load billing ledger. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [schoolId, learnerId, accountNo]);

  useEffect(() => {
    refreshLedger();
  }, [refreshLedger]);

  useEffect(() => {
    const onBillingUpdated = () => {
      refreshLedger();
    };
    window.addEventListener(BILLING_UPDATED_EVENT, onBillingUpdated);
    return () => window.removeEventListener(BILLING_UPDATED_EVENT, onBillingUpdated);
  }, [refreshLedger]);

  const accountLedger = useMemo(() => {
    void ledgerTick;
    return getAccountLedger(schoolId, learnerId, accountNo);
  }, [schoolId, learnerId, accountNo, ledgerTick]);

  const openingBalance = useMemo(() => {
    if (apiBalance !== null) return Math.max(apiBalance, 0);
    return Math.max(calculateAccountBalance(accountLedger, learnerId, accountNo), 0);
  }, [apiBalance, accountLedger, learnerId, accountNo]);

  const invoiceRows = useMemo(() => {
    if (apiOpenInvoices.length) return apiOpenInvoices;
    void ledgerTick;
    return computeOpenInvoiceLines(
      getAccountLedger(schoolId, learnerId, accountNo),
      learnerId,
      accountNo
    );
  }, [apiOpenInvoices, schoolId, learnerId, accountNo, ledgerTick]);

  const savedPayments = useMemo(() => {
    return accountLedger
      .filter((e) => e.type === "payment")
      .sort(
        (a, b) =>
          new Date(b.date || b.createdAt).getTime() -
          new Date(a.date || a.createdAt).getTime()
      )
      .map((row) => ({
        id: row.id,
        date: row.date,
        type: row.method || "EFT",
        reference: row.reference || "",
        description: row.description,
        amount: row.amount,
        allocated: row.amount,
        unallocated: 0,
      }));
  }, [accountLedger]);

  const amount = Number(payment.amount || 0);



  const totalUnpaid = invoiceRows.reduce(



    (sum, row) => sum + Number(row.unpaid || 0),
  
  
  
    0
  
  
  
  );
  
  
  
  const allocated = Math.min(
  
  
  
    Number(payment.allocated || 0),
  
  
  
    amount,
  
  
  
    totalUnpaid
  
  
  
  );
  
  
  
  const getRowAllocated = (rowIndex: number) => {
  
  
  
    let remaining = allocated;
  
  
  
    for (let i = 0; i < invoiceRows.length; i++) {
  
  
  
      const rowUnpaid = Number(invoiceRows[i].unpaid || 0);
  
  
  
      const rowAllocated = Math.min(remaining, rowUnpaid);
  
  
  
      if (i === rowIndex) return rowAllocated;
  
  
  
      remaining -= rowAllocated;
  
  
  
    }
  
  
  
    return 0;
  
  
  
  };



  const unallocated = Math.max(amount - allocated, 0);



  const updatePayment = (next: any) => {



    const updated = { ...payment, ...next };



    setPayment(updated);



    localStorage.setItem(paymentKey, JSON.stringify(updated));



  };



  const autoAllocate = () => {



    const totalUnpaid = invoiceRows.reduce(



      (sum, row) => sum + Number(row.unpaid || 0),



      0



    );



    updatePayment({



      allocated: Math.min(Number(payment.amount || 0), totalUnpaid),



    });



  };



  const savePayment = async () => {
    if (!amount || amount <= 0) {
      alert("Enter a payment amount first.");
      return;
    }
    if (!schoolId) {
      alert("School not loaded. Sign in again and retry.");
      return;
    }
    if (!learnerId && !accountNo) {
      alert("Account not selected. Go back and choose an account.");
      return;
    }
    if (!invoiceRows.length) {
      alert(
        "No open invoices exist for this account. Post an invoice in Billing before recording a payment."
      );
      return;
    }

    const paymentDate = payment.date || new Date().toISOString().slice(0, 10);
    const paymentPayload = {
      schoolId,
      learnerId,
      accountNo,
      amount: normaliseBillingAmount(amount),
      date: paymentDate,
      reference: String(payment.reference || payment.type || "EFT").trim(),
      description: payment.description || "Payment",
      method: payment.type || "EFT",
    };

    setSaving(true);
    try {
      const result = await createPayment(paymentPayload);
      const savedReference = String((result as any)?.payment?.reference || paymentPayload.reference);
      await syncBillingLedgerFromApi(schoolId);
      notifyBillingUpdated();

      const sourceId = String((result as any)?.payment?.id || `pay-${Date.now()}`);
      postBillingPaymentJournal({
        schoolId,
        sourceId,
        amount: normaliseBillingAmount(amount),
        date: paymentDate,
        accountNo,
        reference: savedReference,
        createdBy: "Billing",
      });

      localStorage.setItem(
        "selectedPaymentAccount",
        JSON.stringify({
          ...selected,
          learnerId,
          accountNo,
          lastPayment: `${money(amount)} on ${paymentDate}`,
        })
      );
      localStorage.setItem(paymentKey, JSON.stringify({}));
      setPayment({});
      await refreshLedger();
      alert("Payment saved.");
    } catch (error) {
      console.error(error);
      alert("Payment could not be saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };



  const payBtn: React.CSSProperties = {



    border: "1px solid #d4af37",



    background: "#ffffff",



    color: "#111827",



    borderRadius: "10px",



    padding: "8px 13px",



    fontWeight: 800,



    cursor: "pointer",



  };



  const payGoldBtn: React.CSSProperties = {



    ...payBtn,



    background: "#d4af37",



    boxShadow: "0 8px 18px rgba(212,175,55,0.22)",



  };



  const payInput: React.CSSProperties = {



    width: "100%",



    minHeight: 34,



    border: "1px solid #d8dde6",



    background: "#f8fafc",



    borderRadius: 8,



    padding: "7px 10px",



    fontWeight: 700,



  };



  const payCell: React.CSSProperties = {



    padding: "9px 10px",



    borderTop: "1px solid #e5e7eb",



    fontWeight: 700,



    fontSize: 13,



  };



  if (!selected) {



    return (



      <div style={{ padding: 24 }}>



        <h1>Create Payment</h1>



        <p>Select an account first.</p>



        <button style={payBtn} onClick={() => setActivePage("payments")}>



          Back



        </button>



      </div>



    );



  }



  return (



    <div style={{ padding: 22, background: "#f6f4ef", minHeight: "100vh" }}>



      <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900, color: "#111827" }}>



        Create Payment



        <span style={{ color: "#64748b", fontSize: 18, fontWeight: 600 }}>



          {" "}» Allocate payment to account



        </span>



      </h1>

      {loading ? (
        <p style={{ marginTop: 14, color: "#64748b", fontWeight: 700 }}>Loading open invoices…</p>
      ) : null}

      {!loading && loadError ? (
        <p style={{ marginTop: 14, color: "#b91c1c", fontWeight: 800 }}>{loadError}</p>
      ) : null}

      {!loading && !loadError && !invoiceRows.length ? (
        <p style={{ marginTop: 14, color: "#b45309", fontWeight: 800 }}>
          No open invoices exist for this account. Post an invoice before recording a payment.
        </p>
      ) : null}

      <div style={{ display: "flex", gap: 8, margin: "14px 0" }}>



        <button type="button" style={payBtn} onClick={() => setActivePage("payments")}>



          ↩ Back



        </button>



        <button
          type="button"
          style={payGoldBtn}
          onClick={savePayment}
          disabled={saving || loading || !invoiceRows.length}
        >



          {saving ? "Saving…" : "💾 Save"}



        </button>



      </div>



      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: 16 }}>



        <section style={{ background: "#fff", border: "1px solid #d6c17a", borderRadius: 14, overflow: "hidden" }}>



          <div style={{ background: "#111827", color: "#d4af37", padding: "11px 15px", fontSize: 18, fontWeight: 900 }}>



            Payment



          </div>



          <div style={{ padding: 16, display: "grid", gap: 9 }}>



            {[



              ["* Account", <input style={payInput} value={selected.accountNo || ""} readOnly />],



              [



                "* Date",



                <input



                  type="date"



                  style={payInput}



                  value={payment.date || new Date().toISOString().slice(0, 10)}



                  onChange={(e) => updatePayment({ date: e.target.value })}



                />,



              ],



              [



                "* Type",



                <select



                  style={payInput}



                  value={payment.type || "EFT"}



                  onChange={(e) => updatePayment({ type: e.target.value })}



                >



                  <option>Cash</option>



                  <option>EFT</option>



                  <option>Card</option>



                  <option>Debit Order</option>



                </select>,



              ],



              [



                "Description",



                <input



                  style={payInput}



                  placeholder="Description"



                  value={payment.description || ""}



                  onChange={(e) => updatePayment({ description: e.target.value })}



                />,



              ],



              [



                "* Amount",



                <input



                  type="number"



                  style={payInput}



                  value={payment.amount || ""}



                  onChange={(e) => updatePayment({ amount: Number(e.target.value || 0) })}



                />,



              ],



              [



                "Message",



                <textarea



                  style={{ ...payInput, minHeight: 70 }}



                  placeholder="Message"



                  value={payment.message || ""}



                  onChange={(e) => updatePayment({ message: e.target.value })}



                />,



              ],



              ["Amount Allocated", <input style={payInput} value={allocated.toFixed(2)} readOnly />],



              ["Amount Unallocated", <input style={payInput} value={unallocated.toFixed(2)} readOnly />],



            ].map(([label, input]: any) => (



              <div key={label} style={{ display: "grid", gridTemplateColumns: "145px 1fr", gap: 10, alignItems: "center" }}>



                <div style={{ textAlign: "right", fontWeight: 800, fontSize: 13 }}>{label}</div>



                {input}



              </div>



            ))}



          </div>



        </section>



        <section style={{ background: "#fff", border: "1px solid #d6c17a", borderRadius: 14, overflow: "hidden" }}>



          <div style={{ background: "#111827", color: "#d4af37", padding: "11px 15px", fontSize: 18, fontWeight: 900 }}>



            Account



          </div>



          <div style={{ padding: 16, fontWeight: 800, lineHeight: 1.8 }}>



            <div>{selected.accountNo}</div>



            <div>{selected.name} {selected.surname}</div>



            <div>{selected.parentName || "Parent details to connect"}</div>



            <div>{money(openingBalance)}</div>



            <div style={{ color: "#64748b" }}>No notes captured.</div>



          </div>



        </section>



      </div>



      <section style={{ marginTop: 16, background: "#fff", border: "1px solid #d6c17a", borderRadius: 14, overflow: "hidden" }}>



        <div style={{ background: "#111827", color: "#d4af37", padding: "11px 15px", fontSize: 18, fontWeight: 900 }}>



          Payment Details



        </div>



        <div style={{ display: "flex", gap: 8, padding: 12, flexWrap: "wrap" }}>



          <button type="button" style={payGoldBtn} onClick={autoAllocate} disabled={!invoiceRows.length}>✓ Auto Allocate</button>



          <button style={payBtn} onClick={() => updatePayment({ allocated: 0 })}>✖ Unallocate All</button>



          <button type="button" style={payBtn} onClick={autoAllocate} disabled={!invoiceRows.length}>✓ Allocate</button>



          <button style={payBtn} onClick={() => updatePayment({ allocated: 0 })}>✖ Unallocate</button>



        </div>



        <table style={{ width: "100%", borderCollapse: "collapse" }}>



          <thead>



            <tr style={{ background: "#f8fafc" }}>



              {["Audit No", "Type", "Date", "Reference", "Description", "Unpaid Amount", "Allocated"].map((h) => (



                <th key={h} style={{ padding: 10, textAlign: "left", fontWeight: 900, fontSize: 13 }}>{h}</th>



              ))}



            </tr>



          </thead>



          <tbody>



            {invoiceRows.length === 0 ? (



              <tr>



                <td colSpan={7} style={{ ...payCell, textAlign: "center", color: "#64748b" }}>



                  No outstanding invoices found for this account.



                </td>



              </tr>



            ) : (



              invoiceRows.map((row, index) => (



                <tr key={row.id || row.audit} style={{ background: index % 2 === 0 ? "#fffdf7" : "#fff" }}>



                  <td style={payCell}>{row.audit}</td>



                  <td style={payCell}>{row.type}</td>



                  <td style={payCell}>{row.date}</td>



                  <td style={payCell}>{row.reference}</td>



                  <td style={payCell}>{row.description}</td>



                  <td style={payCell}>{money(row.unpaid)}</td>



                  <td style={payCell}>{money(getRowAllocated(index))}</td>



                </tr>



              ))



            )}



          </tbody>



        </table>



      </section>



      <section style={{ marginTop: 16, background: "#fff", border: "1px solid #d6c17a", borderRadius: 14, overflow: "hidden" }}>



        <div style={{ background: "#111827", color: "#d4af37", padding: "11px 15px", fontSize: 18, fontWeight: 900 }}>



          Saved Payments



        </div>



        <table style={{ width: "100%", borderCollapse: "collapse" }}>



          <thead>



            <tr style={{ background: "#f8fafc" }}>



              {["Date", "Type", "Reference", "Description", "Amount", "Allocated", "Unallocated"].map((h) => (



                <th key={h} style={{ padding: 10, textAlign: "left", fontWeight: 900, fontSize: 13 }}>{h}</th>



              ))}



            </tr>



          </thead>



          <tbody>



            {savedPayments.length === 0 ? (



              <tr>



                <td colSpan={7} style={{ ...payCell, textAlign: "center", color: "#64748b" }}>



                  No payments recorded yet.



                </td>



              </tr>



            ) : (



              savedPayments.map((row) => (



                <tr key={row.id}>



                  <td style={payCell}>{row.date}</td>



                  <td style={payCell}>{row.type}</td>



                  <td style={payCell}>{row.reference}</td>



                  <td style={payCell}>{row.description}</td>



                  <td style={payCell}>{money(row.amount)}</td>



                  <td style={payCell}>{money(row.allocated)}</td>



                  <td style={payCell}>{money(row.unallocated)}</td>



                </tr>



              ))



            )}



          </tbody>



        </table>



      </section>



    </div>



  );



}