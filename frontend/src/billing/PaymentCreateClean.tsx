import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  appendPaymentTransaction,
  BILLING_UPDATED_EVENT,
  calculateAccountBalance,
  formatMoney,
  getAccountLedger,
  normaliseBillingAmount,
  notifyBillingUpdated,
} from "./billingLedger";
import { createPayment, syncBillingLedgerFromApi } from "./billingApi";
import { getLearnerAccountNo } from "../learner/learnerIdentity";
import {
  fetchSchoolEmailSettings,
  isSchoolEmailReadyForUi,
  normalizeSchoolEmailSettings,
  type SchoolEmailSettings,
} from "../communication/schoolEmailApi";
import PaymentAllocationModal from "./PaymentAllocationModal";
import {
  fetchAllocationTargets,
  receiptPdfUrl,
  savePaymentAllocations,
  suggestPaymentAllocations,
  type AllocationLine,
  type PaymentAllocationRow,
} from "./paymentAllocationApi";
import {
  dateInputValue,
  normalizeIsoDate,
  normalizePaymentType,
  parseAmountInput,
  PAYMENT_TYPES,
  type PaymentAccountContext,
  type PaymentFormState,
  type PaymentType,
} from "./paymentCreateShared";

const REVERSE_PAYMENT_API_CONNECTED = false;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildLinesFromSuggestions(
  suggestions: AllocationLine[],
  paymentAmount: number
): AllocationLine[] {
  const lines = suggestions.filter((s) => Number(s.allocatedAmount || 0) > 0.001);
  const allocatedTotal = roundMoney(
    lines.reduce((sum, line) => sum + Number(line.allocatedAmount || 0), 0)
  );
  const remaining = roundMoney(Math.max(0, paymentAmount - allocatedTotal));
  if (remaining > 0.001) {
    lines.push({ feeCategory: "account_credit", allocatedAmount: remaining });
  }
  return lines;
}

export type PaymentCreateCleanProps = {
  schoolId: string;
  learners?: any[];
  selectedAccount: PaymentAccountContext | null;
  paymentForm: PaymentFormState;
  onPaymentFormChange: (next: PaymentFormState) => void;
  onBack: () => void;
  onSaved: () => void | Promise<void>;
};

/** Real learner UUID for ledger rows — never use selectedAccount.id when it is only an account ref. */
export function resolvePaymentLearnerId(
  selectedAccount: PaymentAccountContext | null,
  learners: any[],
  accountNo: string
): string {
  const acct = String(accountNo || selectedAccount?.accountNo || "").trim();
  const candidate = String(selectedAccount?.learnerId || "").trim();
  const list = Array.isArray(learners) ? learners : [];

  if (candidate) {
    const match = list.find(
      (l) => String(l?.id || l?.learnerId || "").trim() === candidate
    );
    if (match) return String(match.id || match.learnerId || "").trim();
  }

  if (acct) {
    const byAccount = list.find((l) => getLearnerAccountNo(l) === acct);
    if (byAccount) return String(byAccount.id || byAccount.learnerId || "").trim();
  }

  return candidate;
}

const payBtn: React.CSSProperties = {
  border: "1px solid #d4af37",
  background: "#ffffff",
  color: "#111827",
  borderRadius: 10,
  padding: "8px 13px",
  fontWeight: 800,
  fontSize: 14,
  cursor: "pointer",
};

const payGoldBtn: React.CSSProperties = {
  ...payBtn,
  background: "#d4af37",
  boxShadow: "0 8px 18px rgba(212, 175, 55, 0.22)",
};

const paySmallBtn: React.CSSProperties = {
  ...payBtn,
  padding: "5px 10px",
  fontSize: 12,
  borderRadius: 8,
};

const paySmallGoldBtn: React.CSSProperties = {
  ...payGoldBtn,
  padding: "5px 10px",
  fontSize: 12,
  borderRadius: 8,
  boxShadow: "0 4px 10px rgba(212, 175, 55, 0.18)",
};

const PAY_FIELD_COLOR = "#111827";

const payInput: React.CSSProperties = {
  width: "100%",
  minHeight: 34,
  border: "1px solid #d8dde6",
  background: "#f8fafc",
  color: PAY_FIELD_COLOR,
  borderRadius: 8,
  padding: "7px 10px",
  fontWeight: 700,
  boxSizing: "border-box",
  WebkitTextFillColor: PAY_FIELD_COLOR,
  caretColor: PAY_FIELD_COLOR,
};

const payCell: React.CSSProperties = {
  padding: "9px 10px",
  borderTop: "1px solid #e5e7eb",
  fontWeight: 700,
  fontSize: 13,
};

export default function PaymentCreateClean({
  schoolId,
  learners = [],
  selectedAccount,
  paymentForm,
  onPaymentFormChange: _onPaymentFormChange,
  onBack,
  onSaved,
}: PaymentCreateCleanProps) {
  const [draft, setDraft] = useState<PaymentFormState>({
    accountNo: paymentForm.accountNo || selectedAccount?.accountNo || "",
    learnerId: paymentForm.learnerId || selectedAccount?.learnerId || "",
    date: paymentForm.date || new Date().toISOString().slice(0, 10),
    type: paymentForm.type || "EFT",
    description: paymentForm.description || "Payment",
    amount: paymentForm.amount || "",
    message: paymentForm.message || "",
  });

  const updateDraft = (patch: Partial<PaymentFormState>) => {
    setDraft((prev: PaymentFormState) => ({ ...prev, ...patch }));
  };

  const [ledgerTick, setLedgerTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [allocationModal, setAllocationModal] = useState<{
    paymentId: string;
    amount: number;
    date: string;
  } | null>(null);
  const [txnActionBusy, setTxnActionBusy] = useState(false);
  const [txnActionMsg, setTxnActionMsg] = useState("");
  const [txnActionErr, setTxnActionErr] = useState("");
  const [emailReadiness, setEmailReadiness] = useState<SchoolEmailSettings | null>(null);

  const accountNo = String(draft.accountNo || selectedAccount?.accountNo || "").trim();

  const learnerId = useMemo(
    () => resolvePaymentLearnerId(selectedAccount, learners, accountNo),
    [selectedAccount, learners, accountNo]
  );

  const refreshLedger = useCallback(async () => {
    if (!schoolId) return;
    try {
      await syncBillingLedgerFromApi(schoolId);
      setLedgerTick((v) => v + 1);
    } catch (error) {
      console.error(error);
    }
  }, [schoolId]);

  useEffect(() => {
    void refreshLedger();
  }, [refreshLedger]);

  useEffect(() => {
    const onBillingUpdated = () => {
      setLedgerTick((v) => v + 1);
    };
    window.addEventListener(BILLING_UPDATED_EVENT, onBillingUpdated);
    return () => window.removeEventListener(BILLING_UPDATED_EVENT, onBillingUpdated);
  }, []);

  const accountLedger = useMemo(() => {
    void ledgerTick;
    return getAccountLedger(schoolId, learnerId, accountNo);
  }, [schoolId, learnerId, accountNo, ledgerTick]);

  const openingBalance = useMemo(
    () => Math.max(calculateAccountBalance(accountLedger, learnerId, accountNo), 0),
    [accountLedger, learnerId, accountNo]
  );

  const savedPayments = useMemo(() => {
    return accountLedger
      .filter((e) => e.type === "payment")
      .sort(
        (a, b) =>
          new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
      )
      .map((row) => ({
        id: row.id,
        date: String(row.date || "").slice(0, 10),
        type: row.method || row.reference || "EFT",
        description: row.description || "Payment",
        amount: normaliseBillingAmount(row.amount),
      }));
  }, [accountLedger]);

  useEffect(() => {
    if (!savedPayments.length) {
      setSelectedPaymentId(null);
      return;
    }
    if (!selectedPaymentId || !savedPayments.some((p) => p.id === selectedPaymentId)) {
      setSelectedPaymentId(savedPayments[0].id);
    }
  }, [savedPayments, selectedPaymentId]);

  useEffect(() => {
    if (!schoolId) {
      setEmailReadiness(null);
      return;
    }
    let cancelled = false;
    void fetchSchoolEmailSettings(schoolId)
      .then((res) => {
        if (!cancelled) {
          setEmailReadiness(normalizeSchoolEmailSettings(res.settings));
        }
      })
      .catch(() => {
        if (!cancelled) setEmailReadiness(null);
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  const selectedPayment = useMemo(
    () => savedPayments.find((p) => p.id === selectedPaymentId) || null,
    [savedPayments, selectedPaymentId]
  );

  const payerLabel = useMemo(() => {
    const name = `${selectedAccount?.name || ""} ${selectedAccount?.surname || ""}`.trim();
    return name || selectedAccount?.accountNo || "Account";
  }, [selectedAccount]);

  const afterAllocationSaved = useCallback(async () => {
    await refreshLedger();
    notifyBillingUpdated();
    setTxnActionErr("");
    setTxnActionMsg("Payment allocation saved.");
  }, [refreshLedger]);

  const resolveAutoAllocatePayment = useCallback(async () => {
    if (!schoolId || !learnerId || !accountNo) return null;
    for (const payment of savedPayments) {
      try {
        const res = await fetchAllocationTargets({
          schoolId,
          learnerId,
          accountNo,
          paymentAmount: payment.amount,
          paymentId: payment.id,
        });
        const allocatedTotal = roundMoney(
          (res.existingAllocations || []).reduce(
            (sum: number, row: PaymentAllocationRow) =>
              sum + Number(row.allocatedAmount || 0),
            0
          )
        );
        if (allocatedTotal >= payment.amount - 0.001) continue;
        const hasTargets =
          (res.targets?.invoices?.length || 0) > 0 ||
          (res.targets?.categories?.length || 0) > 0;
        if (!hasTargets) continue;
        return payment;
      } catch {
        continue;
      }
    }
    return null;
  }, [schoolId, learnerId, accountNo, savedPayments]);

  const handleAutoAllocate = useCallback(async () => {
    setTxnActionErr("");
    setTxnActionMsg("");
    if (!schoolId || !learnerId || !accountNo) {
      setTxnActionErr("Account not ready for allocation.");
      return;
    }
    if (!savedPayments.length) {
      setTxnActionErr("No payments to allocate. Save a payment first.");
      return;
    }
    setTxnActionBusy(true);
    try {
      const payment = await resolveAutoAllocatePayment();
      if (!payment) {
        setTxnActionErr("No unallocated payment with outstanding invoices found for this account.");
        return;
      }
      const { suggestions } = await suggestPaymentAllocations({
        schoolId,
        learnerId,
        accountNo,
        paymentAmount: payment.amount,
      });
      const lines = buildLinesFromSuggestions(suggestions, payment.amount);
      if (!lines.some((line) => Number(line.allocatedAmount || 0) > 0.001)) {
        setTxnActionErr("Nothing to allocate — no outstanding invoices for this payment.");
        return;
      }
      await savePaymentAllocations(payment.id, {
        schoolId,
        learnerId,
        accountNo,
        paymentAmount: payment.amount,
        lines,
        allocatedBy: localStorage.getItem("userEmail") || "Billing",
      });
      setSelectedPaymentId(payment.id);
      await afterAllocationSaved();
    } catch (error) {
      setTxnActionErr(
        error instanceof Error ? error.message : "Auto allocate failed. Try again."
      );
    } finally {
      setTxnActionBusy(false);
    }
  }, [
    schoolId,
    learnerId,
    accountNo,
    savedPayments.length,
    resolveAutoAllocatePayment,
    afterAllocationSaved,
  ]);

  const openAllocateModal = useCallback(() => {
    setTxnActionErr("");
    setTxnActionMsg("");
    if (!selectedPayment) {
      setTxnActionErr("Select a payment row first, or save a payment.");
      return;
    }
    setAllocationModal({
      paymentId: selectedPayment.id,
      amount: selectedPayment.amount,
      date: selectedPayment.date,
    });
  }, [selectedPayment]);

  const handlePrintReceipt = useCallback(() => {
    setTxnActionErr("");
    setTxnActionMsg("");
    if (!schoolId || !selectedPayment) {
      setTxnActionErr("Select a payment to print a receipt.");
      return;
    }
    const url = receiptPdfUrl(schoolId, selectedPayment.id);
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      setTxnActionErr("Pop-up blocked. Allow pop-ups to open the receipt PDF.");
    }
  }, [schoolId, selectedPayment]);

  const handleEmailReceipt = useCallback(() => {
    setTxnActionErr("");
    setTxnActionMsg("");
    if (!selectedPayment) {
      setTxnActionErr("Select a payment to email a receipt.");
      return;
    }
    if (!isSchoolEmailReadyForUi(emailReadiness)) {
      setTxnActionErr(
        "Email is not configured. Open Communication → Settings → Email (SMTP), save your provider settings, and send a test email."
      );
      return;
    }
    setTxnActionErr("Payment receipt email API not connected yet.");
  }, [selectedPayment, emailReadiness]);

  const handleReversePayment = useCallback(() => {
    setTxnActionErr("Reverse payment API not connected yet.");
  }, []);

  const lastPaymentLabel = useMemo(() => {
    const latest = savedPayments[0];
    if (!latest) return "No payments";
    return `${formatMoney(latest.amount)} on ${latest.date}`;
  }, [savedPayments]);

  const savePayment = useCallback(async () => {
    console.log("SAVE PAYMENT CLICKED", draft);
    setSaveError("");
    if (!selectedAccount) {
      setSaveError("Account not selected. Go back and choose an account.");
      return;
    }
    const amount = parseAmountInput(draft.amount);
    const paymentDate = normalizeIsoDate(draft.date);
    const paymentType = normalizePaymentType(draft.type);

    if (!schoolId) {
      setSaveError("School not loaded. Sign in again and retry.");
      return;
    }
    if (!learnerId && !accountNo) {
      setSaveError("Account not selected. Go back and choose an account.");
      return;
    }
    if (!paymentDate) {
      setSaveError("Payment date is required.");
      return;
    }
    if (!paymentType) {
      setSaveError("Payment type is required.");
      return;
    }
    if (!amount) {
      setSaveError("Enter a valid payment amount.");
      return;
    }

    const resolvedLearnerId = resolvePaymentLearnerId(selectedAccount, learners, accountNo);
    const resolvedAccountNo = accountNo || getLearnerAccountNo(
      learners.find((l) => String(l?.id || l?.learnerId || "").trim() === resolvedLearnerId)
    );

    if (!resolvedLearnerId) {
      setSaveError("Could not resolve learner for this account. Go back and re-select the account.");
      return;
    }
    if (!resolvedAccountNo || resolvedAccountNo === "-") {
      setSaveError("Account number is missing for this learner.");
      return;
    }

    setSaving(true);
    try {
      const paymentAmount = normaliseBillingAmount(amount);
      const result = (await createPayment({
        schoolId,
        learnerId: resolvedLearnerId,
        accountNo: resolvedAccountNo,
        amount: paymentAmount,
        date: paymentDate,
        reference: paymentType,
        description: draft.description.trim() || "Payment",
        method: paymentType,
      })) as { payment?: Record<string, unknown> };
      console.log("CREATE PAYMENT RESULT", result);

      appendPaymentTransaction({
        schoolId,
        learnerId: resolvedLearnerId,
        accountNo: resolvedAccountNo,
        amount: paymentAmount,
        date: paymentDate,
        reference: paymentType,
        description: draft.description.trim() || "Payment",
        method: paymentType,
      });

      await syncBillingLedgerFromApi(schoolId);
      notifyBillingUpdated();
      setLedgerTick((v) => v + 1);
      setDraft((prev: PaymentFormState) => ({
        ...prev,
        amount: "",
        description: "Payment",
        message: "",
      }));
      await onSaved();
    } catch (error) {
      console.error(error);
      setSaveError("Payment could not be saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }, [
    draft,
    selectedAccount,
    schoolId,
    learnerId,
    accountNo,
    learners,
    onSaved,
  ]);

  if (!selectedAccount) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900 }}>Create Payment</h1>
        <p style={{ marginTop: 12, fontWeight: 700, color: "#64748b" }}>
          Please select an account first.
        </p>
        <button type="button" style={{ ...payBtn, marginTop: 14 }} onClick={onBack}>
          Back
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 22,
        background: "#f6f4ef",
        minHeight: "100vh",
        boxSizing: "border-box",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900, color: "#111827" }}>
        Create Payment
      </h1>

      {saveError ? (
        <p style={{ marginTop: 14, color: "#b91c1c", fontWeight: 800 }} role="alert">
          {saveError}
        </p>
      ) : null}

      <div style={{ display: "flex", gap: 8, margin: "14px 0" }}>
        <button type="button" style={payBtn} onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          style={{
            ...payGoldBtn,
            opacity: saving ? 0.55 : 1,
            cursor: saving ? "not-allowed" : "pointer",
          }}
          onClick={savePayment}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save Payment"}
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 340px",
          gap: 16,
        }}
      >
        <section
          style={{
            background: "#fff",
            border: "1px solid #d6c17a",
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              background: "#111827",
              color: "#d4af37",
              padding: "11px 15px",
              fontSize: 18,
              fontWeight: 900,
            }}
          >
            Payment
          </div>
          <div style={{ padding: 16, display: "grid", gap: 9 }}>
            {(
              [
                [
                  "Account",
                  <input
                    key="account"
                    type="text"
                    readOnly
                    style={payInput}
                    value={draft.accountNo}
                  />,
                ],
                [
                  "Date",
                  <input
                    key="date"
                    type="date"
                    style={payInput}
                    value={dateInputValue(draft.date)}
                    onChange={(e) => updateDraft({ date: e.target.value })}
                  />,
                ],
                [
                  "Type",
                  <select
                    key="type"
                    style={payInput}
                    value={draft.type}
                    onChange={(e) => updateDraft({ type: e.target.value })}
                  >
                    {PAYMENT_TYPES.map((t: PaymentType) => (
                      <option key={t} value={t} style={{ color: PAY_FIELD_COLOR }}>
                        {t}
                      </option>
                    ))}
                  </select>,
                ],
                [
                  "Description",
                  <input
                    key="description"
                    type="text"
                    style={payInput}
                    value={draft.description}
                    onChange={(e) => updateDraft({ description: e.target.value })}
                  />,
                ],
                [
                  "Amount",
                  <input
                    key="amount"
                    type="text"
                    inputMode="decimal"
                    style={payInput}
                    value={draft.amount}
                    onChange={(e) => updateDraft({ amount: e.target.value })}
                  />,
                ],
                [
                  "Message",
                  <textarea
                    key="message"
                    style={{ ...payInput, minHeight: 70 }}
                    value={draft.message}
                    onChange={(e) => updateDraft({ message: e.target.value })}
                  />,
                ],
              ] as const
            ).map(([label, input]) => (
              <div
                key={label}
                style={{
                  display: "grid",
                  gridTemplateColumns: "145px 1fr",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <div style={{ textAlign: "right", fontWeight: 800, fontSize: 13 }}>{label}</div>
                {input}
              </div>
            ))}
          </div>
        </section>

        <section
          style={{
            background: "#fff",
            border: "1px solid #d6c17a",
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              background: "#111827",
              color: "#d4af37",
              padding: "11px 15px",
              fontSize: 18,
              fontWeight: 900,
            }}
          >
            Account
          </div>
          <div style={{ padding: 16, fontWeight: 800, lineHeight: 1.8 }}>
            <div>{selectedAccount.accountNo}</div>
            <div>
              {selectedAccount.name} {selectedAccount.surname}
            </div>
            <div>{selectedAccount.parentName || "Parent details to connect"}</div>
            <div>{formatMoney(openingBalance)}</div>
            <div style={{ color: "#64748b", fontSize: 13 }}>Last payment: {lastPaymentLabel}</div>
          </div>
        </section>
      </div>

      <section
        style={{
          marginTop: 16,
          background: "#fff",
          border: "1px solid #d6c17a",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            background: "#111827",
            color: "#d4af37",
            padding: "11px 15px",
            fontSize: 18,
            fontWeight: 900,
          }}
        >
          Transactions
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            padding: "10px 14px",
            borderBottom: "1px solid #e5e7eb",
            background: "#faf9f6",
          }}
        >
          <button
            type="button"
            style={{
              ...paySmallGoldBtn,
              opacity: txnActionBusy || !savedPayments.length ? 0.55 : 1,
              cursor: txnActionBusy || !savedPayments.length ? "not-allowed" : "pointer",
            }}
            onClick={() => void handleAutoAllocate()}
            disabled={txnActionBusy || !savedPayments.length}
            title={
              !savedPayments.length
                ? "Save a payment before allocating"
                : "Allocate newest unallocated payment to outstanding invoices (oldest first)"
            }
          >
            {txnActionBusy ? "Working…" : "Auto Allocate"}
          </button>
          <button
            type="button"
            style={{
              ...paySmallBtn,
              opacity: !selectedPayment ? 0.55 : 1,
              cursor: !selectedPayment ? "not-allowed" : "pointer",
            }}
            onClick={openAllocateModal}
            disabled={!selectedPayment}
            title={selectedPayment ? "Open manual allocation for selected payment" : "Select a payment row"}
          >
            Allocate
          </button>
          <button
            type="button"
            style={{
              ...paySmallBtn,
              opacity: 0.55,
              cursor: "not-allowed",
            }}
            onClick={handleReversePayment}
            disabled={!REVERSE_PAYMENT_API_CONNECTED}
            title="Reverse payment API not connected yet"
          >
            Reverse Payment
          </button>
          <button
            type="button"
            style={{
              ...paySmallGoldBtn,
              opacity: !selectedPayment ? 0.55 : 1,
              cursor: !selectedPayment ? "not-allowed" : "pointer",
            }}
            onClick={handlePrintReceipt}
            disabled={!selectedPayment}
            title={selectedPayment ? "Open receipt PDF" : "Select a payment row"}
          >
            Print Receipt
          </button>
          <button
            type="button"
            style={{
              ...paySmallBtn,
              opacity: !selectedPayment ? 0.55 : 1,
              cursor: !selectedPayment ? "not-allowed" : "pointer",
            }}
            onClick={handleEmailReceipt}
            disabled={!selectedPayment}
            title={
              !selectedPayment
                ? "Select a payment row"
                : isSchoolEmailReadyForUi(emailReadiness)
                  ? "Email receipt (API not connected yet)"
                  : "Configure SMTP under Communication → Email"
            }
          >
            Email Receipt
          </button>
        </div>
        {txnActionErr ? (
          <p
            style={{
              margin: 0,
              padding: "8px 14px",
              color: "#b91c1c",
              fontWeight: 800,
              fontSize: 13,
              borderBottom: "1px solid #fecaca",
              background: "#fef2f2",
            }}
            role="alert"
          >
            {txnActionErr}
          </p>
        ) : null}
        {txnActionMsg ? (
          <p
            style={{
              margin: 0,
              padding: "8px 14px",
              color: "#166534",
              fontWeight: 800,
              fontSize: 13,
              borderBottom: "1px solid #bbf7d0",
              background: "#f0fdf4",
            }}
          >
            {txnActionMsg}
          </p>
        ) : null}
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8fafc" }}>
              {["Date", "Type", "Description", "Amount"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: 10,
                    textAlign: "left",
                    fontWeight: 900,
                    fontSize: 13,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {savedPayments.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ ...payCell, textAlign: "center", color: "#64748b" }}>
                  No payments recorded yet.
                </td>
              </tr>
            ) : (
              savedPayments.map((row) => {
                const isSelected = row.id === selectedPaymentId;
                return (
                  <tr
                    key={row.id}
                    onClick={() => {
                      setSelectedPaymentId(row.id);
                      setTxnActionErr("");
                      setTxnActionMsg("");
                    }}
                    style={{
                      cursor: "pointer",
                      background: isSelected ? "rgba(212, 175, 55, 0.14)" : undefined,
                    }}
                  >
                    <td style={payCell}>{row.date}</td>
                    <td style={payCell}>{row.type}</td>
                    <td style={payCell}>{row.description}</td>
                    <td style={payCell}>{formatMoney(row.amount)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>

      {allocationModal && schoolId && learnerId && accountNo ? (
        <PaymentAllocationModal
          open
          schoolId={schoolId}
          paymentId={allocationModal.paymentId}
          learnerId={learnerId}
          accountNo={accountNo}
          paymentAmount={allocationModal.amount}
          paymentDate={allocationModal.date}
          payerLabel={payerLabel}
          onClose={() => setAllocationModal(null)}
          onConfirmed={async () => {
            setAllocationModal(null);
            await afterAllocationSaved();
          }}
        />
      ) : null}
    </div>
  );
}
