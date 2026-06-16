import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BILLING_UPDATED_EVENT,
  computeOpenInvoiceLines,
  formatMoney,
  getAccountLedger,
  normaliseBillingAmount,
  notifyBillingUpdated,
  type OpenInvoiceLine,
} from "./billingLedger";
import { formatLedgerTypeLabel, isKidesysOpeningBalanceEntry } from "./billingDisplayRules";
import BillingEnvDebug from "./BillingEnvDebug";
import {
  applyPaymentSaveResponse,
  createPayment,
  fetchOpenInvoices,
  logBillingSaveTiming,
  mapPostOpenInvoiceRows,
  syncBillingLedgerFromApi,
} from "./billingApi";
import {
  normalizeKidESysAccountRef,
  resolveKidESysAccountRefFromLearner,
} from "./billingAccountRef";
import { resolvePaymentLearnerId } from "./paymentLearnerResolver";
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
  parents?: any[];
  statementRows?: any[];
  selectedAccount: PaymentAccountContext | null;
  paymentForm: PaymentFormState;
  onPaymentFormChange: (next: PaymentFormState) => void;
  onBack: () => void;
  onSaved: () => void | Promise<void>;
};

function findLearnerRecord(learnerId: string, accountNo: string, learners: any[]): any | null {
  const list = Array.isArray(learners) ? learners : [];
  const key = String(learnerId || "").trim();
  if (key) {
    const match = list.find((l) => String(l?.id || l?.learnerId || "").trim() === key);
    if (match) return match;
  }
  const acct = normalizeKidESysAccountRef(accountNo);
  if (acct) {
    const match = list.find(
      (l) => resolveKidESysAccountRefFromLearner(l) === acct
    );
    if (match) return match;
  }
  return null;
}

function resolveParentNames(
  selectedAccount: PaymentAccountContext,
  learners: any[],
  parents: any[],
  statementRows: any[] = []
): string[] {
  const fromAccount = String(selectedAccount?.parentName || "").trim();
  const names = new Set<string>();
  if (fromAccount) names.add(fromAccount);

  const learnerId = String(selectedAccount?.learnerId || "").trim();
  const accountNo = String(selectedAccount?.accountNo || "").trim();
  const familyAccountId = String(selectedAccount?.familyAccountId || "").trim();
  const accountRef = normalizeKidESysAccountRef(accountNo);

  const pushParent = (p: any) => {
    if (!p) return;
    const full =
      `${p.firstName || p.name || ""} ${p.surname || p.lastName || ""}`.trim() ||
      String(p.fullName || p.name || "").trim();
    if (full) names.add(full);
  };

  const collectFromLearner = (learner: any) => {
    if (!learner) return;
    for (const p of Array.isArray(learner?.parents) ? learner.parents : []) pushParent(p);
    for (const link of Array.isArray(learner?.parentLinks) ? learner.parentLinks : []) {
      pushParent(link?.parent || link);
    }
    for (const link of Array.isArray(learner?.links) ? learner.links : []) {
      pushParent(link?.parent || link);
    }
    for (const p of Array.isArray(learner?.familyAccount?.parents)
      ? learner.familyAccount.parents
      : []) {
      pushParent(p);
    }
    pushParent(learner?.parent);
    pushParent(learner?.primaryParent);
    pushParent(learner?.guardian);
    const legacy = String(learner?.parentName || learner?.guardianName || "").trim();
    if (legacy) names.add(legacy);
  };

  const learner = findLearnerRecord(learnerId, accountNo, learners);
  collectFromLearner(learner);

  for (const l of learners) {
    const fid = String(l?.familyAccountId || l?.familyAccount?.id || "").trim();
    const ref = resolveKidESysAccountRefFromLearner(l);
    const sameFamily = Boolean(familyAccountId && fid === familyAccountId);
    const sameAccount = Boolean(accountRef && ref === accountRef);
    if (!sameFamily && !sameAccount) continue;
    collectFromLearner(l);
  }

  for (const row of statementRows) {
    const rowAcct = normalizeKidESysAccountRef(String(row?.accountNo || ""));
    const rowFamily = String(row?.familyAccountId || "").trim();
    const matchesFamily = Boolean(familyAccountId && rowFamily === familyAccountId);
    const matchesAcct = Boolean(accountRef && rowAcct === accountRef);
    if (!matchesFamily && !matchesAcct) continue;
    const rowParent = String(row?.parentName || "").trim();
    if (rowParent) names.add(rowParent);
  }

  if (names.size === 0 && learner) {
    const lid = String(learner?.id || learner?.learnerId || "").trim();
    for (const p of parents) {
      const linked = [
        p.learnerId,
        p.childId,
        p.studentId,
        ...(Array.isArray(p.learnerIds) ? p.learnerIds : []),
        ...(Array.isArray(p.children) ? p.children.map((c: any) => c?.id || c?.learnerId) : []),
      ]
        .map((v) => String(v || "").trim())
        .filter(Boolean);
      if (lid && linked.includes(lid)) pushParent(p);
    }
  }

  return names.size ? [...names] : ["Not linked"];
}

function resolveAccountChildren(
  selectedAccount: PaymentAccountContext,
  learners: any[],
  statementRows: any[]
): { id: string; label: string }[] {
  const accountNo = String(selectedAccount?.accountNo || "").trim();
  const familyAccountId = String(selectedAccount?.familyAccountId || "").trim();
  const seen = new Set<string>();
  const children: { id: string; label: string }[] = [];

  const addLearner = (l: any) => {
    const id = String(l?.id || l?.learnerId || "").trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    const name = `${l?.firstName || l?.name || ""} ${l?.lastName || l?.surname || ""}`.trim() || "Learner";
    const grade = l?.grade ? ` · Grade ${l.grade}` : "";
    children.push({ id, label: `${name}${grade}` });
  };

  if (familyAccountId) {
    for (const l of learners) {
      const fid = String(l?.familyAccountId || l?.familyAccount?.id || "").trim();
      if (fid === familyAccountId) addLearner(l);
    }
  } else if (accountNo) {
    const ref = normalizeKidESysAccountRef(accountNo);
    if (ref) {
      for (const l of learners) {
        if (resolveKidESysAccountRefFromLearner(l) === ref) addLearner(l);
      }
    }
  }

  for (const row of statementRows) {
    const rowAcct = String(row?.accountNo || "").trim();
    const rowFamily = String(row?.familyAccountId || "").trim();
    const matchesFamily = Boolean(familyAccountId && rowFamily === familyAccountId);
    const matchesAcct = Boolean(accountNo && rowAcct === accountNo);
    if (!matchesFamily && !matchesAcct) continue;
    const match = learners.find(
      (l) => String(l?.id || l?.learnerId || "") === String(row?.learnerId || row?.id || "")
    );
    addLearner(match || row);
  }

  const anchor = findLearnerRecord(selectedAccount.learnerId, accountNo, learners);
  if (anchor) addLearner(anchor);

  if (!children.length) {
    children.push({
      id: selectedAccount.learnerId,
      label: `${selectedAccount.name} ${selectedAccount.surname}`.trim(),
    });
  }

  return children;
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
  parents = [],
  statementRows = [],
  selectedAccount: selectedAccountProp,
  paymentForm,
  onPaymentFormChange: _onPaymentFormChange,
  onBack,
  onSaved,
}: PaymentCreateCleanProps) {
  const [resolvedAccount, setResolvedAccount] = useState<PaymentAccountContext | null>(
    selectedAccountProp
  );

  useEffect(() => {
    if (selectedAccountProp) {
      setResolvedAccount(selectedAccountProp);
      return;
    }
    setResolvedAccount(null);
  }, [selectedAccountProp]);

  const selectedAccount = resolvedAccount;

  const [draft, setDraft] = useState<PaymentFormState>({
    accountNo: paymentForm.accountNo || selectedAccount?.accountNo || "",
    learnerId: paymentForm.learnerId || selectedAccount?.learnerId || "",
    date: paymentForm.date || new Date().toISOString().slice(0, 10),
    type: paymentForm.type || "EFT",
    description: paymentForm.description || "Payment",
    amount: paymentForm.amount || "",
    message: paymentForm.message || "",
  });

  const [rowAllocations, setRowAllocations] = useState<Record<string, number>>({});
  const [selectedDetailId, setSelectedDetailId] = useState<string | null>(null);
  const [apiOpenInvoices, setApiOpenInvoices] = useState<OpenInvoiceLine[]>([]);
  const [apiBalance, setApiBalance] = useState<number | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState("");

  const updateDraft = (patch: Partial<PaymentFormState>) => {
    setDraft((prev: PaymentFormState) => ({ ...prev, ...patch }));
  };

  const [ledgerTick, setLedgerTick] = useState(0);
  const [savedAccountNote, setSavedAccountNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveJustSucceeded, setSaveJustSucceeded] = useState(false);
  const [saveError, setSaveError] = useState("");
  const paymentIdempotencyKeyRef = useRef<string | null>(null);
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

  const refreshLedger = useCallback(async (opts?: { silent?: boolean }) => {
    if (!schoolId) return;
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setLoadingDetails(true);
      setDetailsError("");
    }
    try {
      await syncBillingLedgerFromApi(schoolId);
      if (accountNo) {
        // Open invoices + balance must resolve by Kid-e-Sys accountRef (FamilyAccount.accountRef) only.
        const { openInvoices, balance } = await fetchOpenInvoices(schoolId, "", accountNo);
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
      }
      setLedgerTick((v) => v + 1);
    } catch (error) {
      console.error(error);
      if (!silent) {
        setDetailsError("Could not load open invoices for this account.");
      }
    } finally {
      if (!silent) setLoadingDetails(false);
    }
  }, [schoolId, accountNo]);

  const runBackgroundBillingSync = useCallback(
    async (
      paymentId: string,
      allocationPayload: {
        schoolId: string;
        learnerId: string;
        accountNo: string;
        paymentAmount: number;
        lines: AllocationLine[];
        allocatedBy: string;
      } | null
    ) => {
      if (!schoolId || !paymentId || !allocationPayload) return;
      try {
        await savePaymentAllocations(paymentId, allocationPayload);
      } catch (error) {
        console.error(error);
        setSaveError(
          error instanceof Error
            ? error.message
            : "Payment saved, but allocation failed. Refresh billing and verify."
        );
      }
    },
    [schoolId]
  );

  useEffect(() => {
    if (!saveJustSucceeded) return;
    const timer = window.setTimeout(() => setSaveJustSucceeded(false), 2000);
    return () => window.clearTimeout(timer);
  }, [saveJustSucceeded]);

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

  const accountBalance = useMemo(() => {
    if (apiBalance !== null && Number.isFinite(apiBalance)) return apiBalance;
    const fromStatement = Number(selectedAccount?.balance);
    if (Number.isFinite(fromStatement)) return fromStatement;
    return 0;
  }, [apiBalance, selectedAccount?.balance]);

  const invoiceRows = useMemo(() => {
    if (apiOpenInvoices.length) return apiOpenInvoices;
    void ledgerTick;
    const lines = computeOpenInvoiceLines(accountLedger, "", accountNo);
    return lines.map((row) => {
      const entry = accountLedger.find((e) => e.id === row.id);
      const isOb = entry ? isKidesysOpeningBalanceEntry(entry) : false;
      return {
        ...row,
        type: isOb ? formatLedgerTypeLabel(entry!) : row.type,
      };
    });
  }, [apiOpenInvoices, accountLedger, learnerId, accountNo, ledgerTick]);

  const paymentAmount = parseAmountInput(draft.amount);
  const amountAllocated = roundMoney(
    Object.values(rowAllocations).reduce((sum, v) => sum + Number(v || 0), 0)
  );
  const amountUnallocated = roundMoney(Math.max(0, paymentAmount - amountAllocated));

  const accountChildren = useMemo(() => {
    if (!selectedAccount) return [];
    return resolveAccountChildren(selectedAccount, learners, statementRows);
  }, [selectedAccount, learners, statementRows]);

  const parentNames = useMemo(() => {
    if (!selectedAccount) return [];
    return resolveParentNames(selectedAccount, learners, parents, statementRows);
  }, [selectedAccount, learners, parents, statementRows]);

  useEffect(() => {
    setRowAllocations({});
    setSelectedDetailId(null);
    setSavedAccountNote("");
  }, [selectedAccount?.learnerId, selectedAccount?.accountNo, schoolId]);

  useEffect(() => {
    if (!selectedAccount) return;
    setDraft((prev) => ({
      ...prev,
      accountNo: selectedAccount.accountNo || prev.accountNo,
      learnerId: selectedAccount.learnerId || prev.learnerId,
    }));
  }, [selectedAccount?.accountNo, selectedAccount?.learnerId]);

  const handleDraftAutoAllocate = useCallback(() => {
    setTxnActionErr("");
    setTxnActionMsg("");
    if (!paymentAmount) {
      setTxnActionErr("Enter a payment amount first.");
      return;
    }
    let remaining = paymentAmount;
    const next: Record<string, number> = {};
    for (const row of invoiceRows) {
      if (remaining <= 0.001) break;
      const rowId = String(row.id || "").trim();
      if (!rowId) continue;
      const unpaid = Number(row.unpaid || 0);
      const alloc = roundMoney(Math.min(unpaid, remaining));
      if (alloc > 0.001) {
        next[rowId] = alloc;
        remaining = roundMoney(remaining - alloc);
      }
    }
    setRowAllocations(next);
    const allocatedTotal = roundMoney(
      Object.values(next).reduce((sum, value) => sum + Number(value || 0), 0)
    );
    setTxnActionMsg(
      allocatedTotal > 0.001
        ? `Allocated ${formatMoney(allocatedTotal)} across ${Object.keys(next).length} row(s).`
        : "No unpaid rows to allocate."
    );
  }, [paymentAmount, invoiceRows]);

  const handleDraftAllocate = useCallback(() => {
    setTxnActionErr("");
    setTxnActionMsg("");
    if (!paymentAmount) {
      setTxnActionErr("Enter a payment amount first.");
      return;
    }
    if (!selectedDetailId) {
      setTxnActionErr("Select a payment detail row first.");
      return;
    }
    const row = invoiceRows.find((r) => r.id === selectedDetailId);
    if (!row) {
      setTxnActionErr("Selected row not found.");
      return;
    }
    if (amountUnallocated <= 0.001) {
      setTxnActionErr("No unallocated amount remaining.");
      return;
    }
    const current = Number(rowAllocations[row.id] || 0);
    const roomOnRow = roundMoney(Math.max(0, Number(row.unpaid || 0) - current));
    const add = roundMoney(Math.min(roomOnRow, amountUnallocated));
    if (add <= 0.001) {
      setTxnActionErr("This row is already fully allocated.");
      return;
    }
    setRowAllocations((prev) => ({ ...prev, [row.id]: roundMoney(current + add) }));
    setTxnActionMsg(`Allocated ${formatMoney(add)} to selected row.`);
  }, [paymentAmount, selectedDetailId, invoiceRows, rowAllocations, amountUnallocated]);

  const handleDraftUnallocate = useCallback(() => {
    setTxnActionErr("");
    setTxnActionMsg("");
    if (!selectedDetailId) {
      setTxnActionErr("Select a payment detail row first.");
      return;
    }
    setRowAllocations((prev) => {
      const next = { ...prev };
      delete next[selectedDetailId];
      return next;
    });
    setTxnActionMsg("Allocation removed from selected row.");
  }, [selectedDetailId]);

  const handleDraftUnallocateAll = useCallback(() => {
    setTxnActionErr("");
    setTxnActionMsg("");
    setRowAllocations({});
    setTxnActionMsg("All draft allocations cleared.");
  }, []);

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
        description: String(row.description || "Payment").trim() || "Payment",
        amount: normaliseBillingAmount(row.amount),
        source: row.source,
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

  const accountNotesDisplay = useMemo(() => {
    const draftMsg = draft.message.trim();
    if (draftMsg) return draftMsg;
    const saved = savedAccountNote.trim();
    if (saved) return saved;
    const latest = savedPayments[0];
    const latestDesc = String(latest?.description || "").trim();
    if (latestDesc && latestDesc !== "Payment") return latestDesc;
    const selectedDesc = String(selectedPayment?.description || "").trim();
    if (selectedDesc && selectedDesc !== "Payment") return selectedDesc;
    return "";
  }, [draft.message, savedAccountNote, savedPayments, selectedPayment]);

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
    const saveStarted = performance.now();
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
    if (!accountNo) {
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

    const resolvedAccountNo =
      normalizeKidESysAccountRef(accountNo) ||
      normalizeKidESysAccountRef(selectedAccount?.accountNo) ||
      resolveKidESysAccountRefFromLearner(
        learners.find((l) => String(l?.id || l?.learnerId || "").trim() === learnerId)
      );

    if (!resolvedAccountNo || resolvedAccountNo === "-") {
      setSaveError("Account number is missing for this learner.");
      return;
    }

    if (saving) return;

    setSaving(true);
    setSaveJustSucceeded(false);
    setSaveError("");
    try {
      const paymentAmount = normaliseBillingAmount(amount);
      const paymentNote =
        draft.message.trim() || draft.description.trim() || "Payment";
      if (!paymentIdempotencyKeyRef.current) {
        paymentIdempotencyKeyRef.current =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      }
      const idempotencyKey = paymentIdempotencyKeyRef.current;
      const postStarted = performance.now();
      const result = (await createPayment({
        schoolId,
        idempotencyKey,
        // Billing identity is accountRef only (FamilyAccount.accountRef / Kid-e-Sys accountRef).
        learnerId: "",
        accountNo: resolvedAccountNo,
        amount: paymentAmount,
        date: paymentDate,
        reference: paymentType,
        description: paymentNote,
        message: draft.message.trim(),
        note: draft.message.trim(),
        notes: draft.message.trim(),
        method: paymentType,
      })) as {
        success?: boolean;
        error?: string;
        payment?: Record<string, unknown>;
        balance?: number;
        openInvoices?: unknown[];
        account?: { balance?: number };
        duplicate?: boolean;
      };
      logBillingSaveTiming("payment POST", performance.now() - postStarted);

      if (result?.success === false) {
        throw new Error(String(result.error || "Payment was not saved on the server."));
      }

      const paymentRow = result?.payment;
      const paymentId = String(paymentRow?.id || "").trim();
      if (!paymentId || !paymentRow) {
        throw new Error("Payment was not saved. No payment record returned from the server.");
      }

      const patchStarted = performance.now();
      applyPaymentSaveResponse(schoolId, result as Record<string, unknown>);

      const openFromPost = Array.isArray(result.openInvoices) ? result.openInvoices : [];
      if (openFromPost.length) {
        setApiOpenInvoices(mapPostOpenInvoiceRows(openFromPost));
      }
      const balanceFromPost =
        typeof result.balance === "number" && Number.isFinite(result.balance)
          ? result.balance
          : typeof result.account?.balance === "number" && Number.isFinite(result.account.balance)
            ? result.account.balance
            : null;
      if (balanceFromPost !== null) {
        setApiBalance(balanceFromPost);
      }
      logBillingSaveTiming("payment post-response patch", performance.now() - patchStarted);

      const allocationLines: AllocationLine[] = Object.entries(rowAllocations)
        .filter(([, amt]) => Number(amt || 0) > 0.001)
        .map(([invoiceId, allocatedAmount]) => ({
          invoiceId,
          allocatedAmount: roundMoney(Number(allocatedAmount)),
        }));
      const unallocatedCredit = amountUnallocated;

      paymentIdempotencyKeyRef.current = null;
      setLedgerTick((v) => v + 1);
      setRowAllocations({});
      setSelectedDetailId(null);
      setSavedAccountNote(paymentNote);
      if (paymentId) setSelectedPaymentId(paymentId);
      setDraft((prev: PaymentFormState) => ({
        ...prev,
        amount: "",
        description: "Payment",
        message: "",
      }));

      setSaving(false);
      setSaveJustSucceeded(true);
      logBillingSaveTiming("payment save total", performance.now() - saveStarted);

      const allocationPayload =
        paymentId && allocationLines.length
          ? {
              schoolId,
              learnerId,
              accountNo: resolvedAccountNo,
              paymentAmount,
              lines: allocationLines,
              allocatedBy: localStorage.getItem("userEmail") || "Billing",
            }
          : paymentId && unallocatedCredit > 0.001
            ? {
                schoolId,
                learnerId,
                accountNo: resolvedAccountNo,
                paymentAmount,
                lines: [
                  {
                    feeCategory: "account_credit" as const,
                    allocatedAmount: unallocatedCredit,
                  },
                ],
                allocatedBy: localStorage.getItem("userEmail") || "Billing",
              }
            : null;

      void onSaved();
      window.setTimeout(() => {
        void runBackgroundBillingSync(paymentId, allocationPayload);
      }, 500);
    } catch (error) {
      console.error(error);
      setSaveError(
        error instanceof Error
          ? error.message
          : "Payment could not be saved. Check your connection and try again."
      );
      setSaving(false);
    }
  }, [
    saving,
    draft,
    selectedAccount,
    schoolId,
    accountNo,
    learners,
    rowAllocations,
    amountUnallocated,
    onSaved,
    runBackgroundBillingSync,
    learnerId,
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
      <BillingEnvDebug schoolId={schoolId} />
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
          {saving ? "Saving…" : saveJustSucceeded ? "Saved ✓" : "Save Payment"}
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
                [
                  "Amount Allocated",
                  <input
                    key="allocated"
                    type="text"
                    readOnly
                    style={payInput}
                    value={amountAllocated.toFixed(2)}
                  />,
                ],
                [
                  "Amount Unallocated",
                  <input
                    key="unallocated"
                    type="text"
                    readOnly
                    style={payInput}
                    value={amountUnallocated.toFixed(2)}
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
          <div style={{ padding: 16, fontWeight: 800, lineHeight: 1.75, fontSize: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b", letterSpacing: 0.3 }}>
              Account No
            </div>
            <div>{selectedAccount.accountNo}</div>
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: 900, color: "#64748b" }}>
              Children
            </div>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {accountChildren.map((child) => (
                <li key={child.id}>{child.label}</li>
              ))}
            </ul>
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: 900, color: "#64748b" }}>
              Parents
            </div>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {parentNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: 900, color: "#64748b" }}>
              Balance
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 900,
                color: accountBalance > 0 ? "#b91c1c" : "#166534",
              }}
            >
              {formatMoney(accountBalance)}
            </div>
            <div style={{ marginTop: 10, fontSize: 12, fontWeight: 900, color: "#64748b" }}>
              Notes
            </div>
            <div style={{ color: "#64748b", fontWeight: 600, fontSize: 13 }}>
              {accountNotesDisplay || "No notes captured."}
            </div>
            <div style={{ marginTop: 8, color: "#64748b", fontSize: 12 }}>
              Last payment: {lastPaymentLabel}
            </div>
          </div>
        </section>
      </div>

      {loadingDetails ? (
        <p style={{ marginTop: 12, color: "#64748b", fontWeight: 700 }}>Loading payment details…</p>
      ) : null}
      {detailsError ? (
        <p style={{ marginTop: 12, color: "#b45309", fontWeight: 800 }}>{detailsError}</p>
      ) : null}

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
          Payment Details
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
            style={paySmallGoldBtn}
            onClick={handleDraftAutoAllocate}
            disabled={!invoiceRows.length}
          >
            Auto Allocate
          </button>
          <button
            type="button"
            style={{
              ...paySmallBtn,
              opacity: !selectedDetailId ? 0.55 : 1,
              cursor: !selectedDetailId ? "not-allowed" : "pointer",
            }}
            onClick={handleDraftAllocate}
            disabled={!selectedDetailId}
          >
            Allocate
          </button>
          <button
            type="button"
            style={{
              ...paySmallBtn,
              opacity: !selectedDetailId ? 0.55 : 1,
              cursor: !selectedDetailId ? "not-allowed" : "pointer",
            }}
            onClick={handleDraftUnallocate}
            disabled={!selectedDetailId}
          >
            Unallocate
          </button>
          <button type="button" style={paySmallBtn} onClick={handleDraftUnallocateAll}>
            Unallocate All
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
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {[
                  "Audit No",
                  "Type",
                  "Date",
                  "Reference",
                  "Description",
                  "Unpaid Amount",
                  "Allocated",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: 10,
                      textAlign: "left",
                      fontWeight: 900,
                      fontSize: 12,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoiceRows.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...payCell, textAlign: "center", color: "#64748b" }}>
                    No outstanding invoices or opening balance rows for this account.
                  </td>
                </tr>
              ) : (
                invoiceRows.map((row, index) => {
                  const isSelected = row.id === selectedDetailId;
                  const allocated = Number(rowAllocations[row.id] || 0);
                  return (
                    <tr
                      key={row.id || row.audit}
                      onClick={() => {
                        setSelectedDetailId(row.id);
                        setTxnActionErr("");
                      }}
                      style={{
                        cursor: "pointer",
                        background: isSelected
                          ? "rgba(212, 175, 55, 0.14)"
                          : index % 2 === 0
                            ? "#fffdf7"
                            : "#fff",
                      }}
                    >
                      <td style={payCell}>{row.audit}</td>
                      <td style={payCell}>{row.type}</td>
                      <td style={payCell}>{row.date}</td>
                      <td style={payCell}>{row.reference}</td>
                      <td style={payCell}>{row.description}</td>
                      <td style={payCell}>{formatMoney(row.unpaid)}</td>
                      <td style={payCell}>{allocated > 0 ? formatMoney(allocated) : "-"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
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
