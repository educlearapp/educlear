import React, { useCallback, useEffect, useMemo, useState } from "react";
import { API_URL } from "../api";
import {
  BILLING_UPDATED_EVENT,
  calculateAccountBalance,
  formatMoney,
  getAccountLedger,
} from "./billingLedger";
import { createInvoicesBatch, applyInvoiceSaveResponse, logBillingSaveTiming, assertInvoiceBatchSaveSucceeded } from "./billingApi";
import {
  computeInvoiceDueDate,
  loadBillingSettingsForSchool,
  resolveInvoiceMessage,
} from "./billingSettingsEngine";
import type { BillingSettingsState } from "../billingSettings/types/billingSettings";
import {
  dateInputValue,
  normalizeIsoDate,
  type PaymentAccountContext,
} from "./paymentCreateShared";
import { normalizeKidESysAccountRef, resolveKidESysAccountRefFromLearner } from "./billingAccountRef";
import {
  learnerMatchesBillingAccountRef,
  resolveManualInvoiceLearnerId,
  resolvePaymentLearnerId,
} from "./paymentLearnerResolver";

export type InvoiceDetailLine = {
  id: string;
  description: string;
  type: string;
  dueDate: string;
  amount: string;
  feeId?: string;
};

export type InvoiceCreateCleanProps = {
  schoolId: string;
  learners?: any[];
  selectedAccount: PaymentAccountContext | null;
  defaultDueDate?: string;
  defaultMessage?: string;
  onBack: () => void;
  onSaved: () => void | Promise<void>;
};

type FeeOption = {
  stableKey: string;
  feeId?: string;
  description: string;
  type: string;
  amount: number;
  dueDate: string;
  source: "fee" | "plan";
};

const INV_FIELD_COLOR = "#111827";

const invBtn: React.CSSProperties = {
  border: "1px solid #d4af37",
  background: "#ffffff",
  color: "#111827",
  borderRadius: 10,
  padding: "8px 13px",
  fontWeight: 800,
  fontSize: 14,
  cursor: "pointer",
};

const invGoldBtn: React.CSSProperties = {
  ...invBtn,
  background: "#d4af37",
  boxShadow: "0 8px 18px rgba(212, 175, 55, 0.22)",
};

const invSmallBtn: React.CSSProperties = {
  ...invBtn,
  padding: "5px 10px",
  fontSize: 12,
  borderRadius: 8,
};

const invInput: React.CSSProperties = {
  width: "100%",
  minHeight: 34,
  border: "1px solid #d8dde6",
  background: "#f8fafc",
  color: INV_FIELD_COLOR,
  borderRadius: 8,
  padding: "7px 10px",
  fontWeight: 700,
  boxSizing: "border-box",
  WebkitTextFillColor: INV_FIELD_COLOR,
  caretColor: INV_FIELD_COLOR,
};

const invDueInput: React.CSSProperties = {
  ...invInput,
  minHeight: 30,
  padding: "5px 8px",
  fontSize: 12,
  width: 132,
  maxWidth: "100%",
};

const invCell: React.CSSProperties = {
  padding: "5px 8px",
  borderTop: "1px solid #e5e7eb",
  verticalAlign: "middle",
};

const INVOICE_LINE_TYPES = ["Fee", "Manual", "Monthly Fee", "Once Off", "School Charge"] as const;

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA");
}

function newLineId(): string {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseLineAmount(raw: string): number {
  const n = Number(String(raw || "").replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeFeeText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function rawFeeId(fee: any): string {
  return String(fee?.id || fee?.feeId || "").trim();
}

/** Stable dedupe key: real fee id when present, else name + amount + dueDate + type. */
function feeStableKey(fee: any): string {
  const id = rawFeeId(fee);
  if (id) return `id:${id}`;
  const name = normalizeFeeText(fee?.description || fee?.name || fee?.title || "");
  const amount = roundMoney(Number(fee?.amount || fee?.price || fee?.value || 0));
  const due = dateInputValue(fee?.dueDate) || "";
  const type = normalizeFeeText(
    fee?.type || fee?.feeType || fee?.category || fee?.frequency || ""
  );
  return `sig:${name}|${amount.toFixed(2)}|${due}|${type}`;
}

function normalizeFeeOption(fee: any, _index: number, source: "fee" | "plan"): FeeOption {
  const realId = rawFeeId(fee);
  return {
    stableKey: feeStableKey(fee),
    feeId: realId || undefined,
    description: String(fee?.description || fee?.name || fee?.title || "Fee"),
    type: String(fee?.type || fee?.feeType || fee?.category || fee?.frequency || "Fee"),
    amount: Number(fee?.amount || fee?.price || fee?.value || 0),
    dueDate: dateInputValue(fee?.dueDate) || "",
    source,
  };
}

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

/** Same parent resolution pattern as learner profile / statements / invoice runs. */
function resolveParentDisplayName(
  selectedAccount: PaymentAccountContext,
  learners: any[]
): string {
  const fromAccount = String(selectedAccount?.parentName || "").trim();
  if (fromAccount) return fromAccount;

  const learnerId = String(selectedAccount?.learnerId || "").trim();
  const accountNo = String(selectedAccount?.accountNo || "").trim();
  const learner = findLearnerRecord(learnerId, accountNo, learners);
  if (!learner) return "Not linked";

  const parents = Array.isArray(learner?.parents) ? learner.parents : [];
  const links = Array.isArray(learner?.links) ? learner.links : [];
  const fromLink = links.find((l: any) => l?.parent)?.parent;
  const parentLinks = Array.isArray(learner?.parentLinks)
    ? learner.parentLinks.map((link: any) => link?.parent || link).filter(Boolean)
    : [];
  const embedded = [
    ...parents,
    ...parentLinks,
    fromLink,
    learner?.parent,
    learner?.primaryParent,
    learner?.guardian,
  ].filter(Boolean);

  const primary =
    embedded.find((p: any) => p?.isPrimary) ||
    embedded[0];
  if (primary) {
    const full =
      `${primary.firstName || primary.name || ""} ${primary.surname || primary.lastName || ""}`.trim() ||
      String(primary.fullName || primary.name || "").trim();
    if (full) return full;
  }

  const legacy = String(learner?.parentName || learner?.guardianName || "").trim();
  return legacy || "Not linked";
}


function getLearnerBillingPlan(learnerId: string, learners: any[]): any[] {
  const learner = learners.find(
    (row) => String(row?.id || row?.learnerId || "") === String(learnerId || "")
  );
  try {
    const savedPlans = JSON.parse(localStorage.getItem("educlearBillingPlans") || "{}");
    const key = String(learner?.id || learner?.learnerId || learnerId);
    if (Array.isArray(savedPlans?.[key])) return savedPlans[key];
  } catch {
    // ignore bad localStorage
  }
  return Array.isArray(learner?.billingPlan) ? learner.billingPlan : [];
}

function lineDueDate(
  invoiceDate: string,
  settings: BillingSettingsState,
  explicitDue?: string
): string {
  return computeInvoiceDueDate(
    invoiceDate,
    settings,
    dateInputValue(explicitDue) || undefined
  );
}

function feeToLine(
  fee: FeeOption,
  invoiceDate: string,
  settings: BillingSettingsState
): InvoiceDetailLine {
  const amount = roundMoney(fee.amount);
  return {
    id: newLineId(),
    feeId: fee.feeId,
    description: fee.description,
    type: fee.type,
    dueDate: lineDueDate(invoiceDate, settings, fee.dueDate),
    amount: amount > 0 ? amount.toFixed(2) : "",
  };
}

function newManualLine(
  invoiceDate: string,
  settings: BillingSettingsState,
  defaultDueDate?: string
): InvoiceDetailLine {
  return {
    id: newLineId(),
    description: "",
    type: "Manual",
    dueDate: lineDueDate(invoiceDate, settings, defaultDueDate),
    amount: "",
  };
}

export default function InvoiceCreateClean({
  schoolId,
  learners = [],
  selectedAccount,
  defaultDueDate = "",
  defaultMessage = "",
  onBack,
  onSaved,
}: InvoiceCreateCleanProps) {
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [message, setMessage] = useState(defaultMessage);
  const [lines, setLines] = useState<InvoiceDetailLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [ledgerTick, setLedgerTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveJustSucceeded, setSaveJustSucceeded] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [billingSettings, setBillingSettings] = useState<BillingSettingsState | null>(null);
  const [showFeePicker, setShowFeePicker] = useState(false);
  const [feeOptions, setFeeOptions] = useState<FeeOption[]>([]);
  const [feeSearch, setFeeSearch] = useState("");
  const [pickerSelected, setPickerSelected] = useState<Record<string, boolean>>({});
  const [loadingFees, setLoadingFees] = useState(false);

  const accountNo = String(selectedAccount?.accountNo || "").trim();

  const learnerId = useMemo(
    () => resolvePaymentLearnerId(selectedAccount, learners, accountNo),
    [selectedAccount, learners, accountNo]
  );

  const refreshLedger = useCallback(async () => {
    if (!schoolId) return;
    setLedgerTick((v) => v + 1);
  }, [schoolId]);

  useEffect(() => {
    void refreshLedger();
  }, [refreshLedger]);

  useEffect(() => {
    if (!saveJustSucceeded) return;
    const timer = window.setTimeout(() => setSaveJustSucceeded(false), 2000);
    return () => window.clearTimeout(timer);
  }, [saveJustSucceeded]);

  useEffect(() => {
    const onBillingUpdated = () => setLedgerTick((v) => v + 1);
    window.addEventListener(BILLING_UPDATED_EVENT, onBillingUpdated);
    return () => window.removeEventListener(BILLING_UPDATED_EVENT, onBillingUpdated);
  }, []);

  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    void loadBillingSettingsForSchool(schoolId).then((settings) => {
      if (cancelled) return;
      setBillingSettings(settings);
      setMessage((prev) => {
        const trimmed = String(prev || "").trim();
        if (trimmed) return prev;
        return resolveInvoiceMessage(settings) || defaultMessage || "";
      });
    });
    return () => {
      cancelled = true;
    };
  }, [schoolId, defaultMessage]);

  useEffect(() => {
    setLines([]);
    setSelectedLineId(null);
    setSaveError("");
  }, [learnerId, accountNo]);

  const accountLedger = useMemo(() => {
    void ledgerTick;
    return getAccountLedger(schoolId, learnerId, accountNo);
  }, [schoolId, learnerId, accountNo, ledgerTick]);

  const currentBalance = useMemo(
    () => Math.max(calculateAccountBalance(accountLedger, learnerId, accountNo), 0),
    [accountLedger, learnerId, accountNo]
  );

  const lastInvoiceLabel = useMemo(() => {
    if (selectedAccount?.lastInvoice) return String(selectedAccount.lastInvoice);
    const invoices = accountLedger
      .filter((e) => e.type === "invoice")
      .sort(
        (a, b) =>
          new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
      );
    const latest = invoices[0];
    if (!latest) return "No invoices";
    return `${formatMoney(latest.amount)} on ${String(latest.date || "").slice(0, 10)}`;
  }, [accountLedger, selectedAccount?.lastInvoice]);

  const lastPaymentLabel = useMemo(() => {
    if (selectedAccount?.lastPayment) return String(selectedAccount.lastPayment);
    const payments = accountLedger
      .filter((e) => e.type === "payment")
      .sort(
        (a, b) =>
          new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
      );
    const latest = payments[0];
    if (!latest) return "No payments";
    return `${formatMoney(latest.amount)} on ${String(latest.date || "").slice(0, 10)}`;
  }, [accountLedger, selectedAccount?.lastPayment]);

  const lineTotal = useMemo(
    () => roundMoney(lines.reduce((sum, line) => sum + parseLineAmount(line.amount), 0)),
    [lines]
  );

  const selectedIndex = useMemo(
    () => lines.findIndex((line) => line.id === selectedLineId),
    [lines, selectedLineId]
  );

  const parentDisplayName = useMemo(
    () =>
      selectedAccount
        ? resolveParentDisplayName(selectedAccount, learners)
        : "Not linked",
    [selectedAccount, learners]
  );

  const filteredFeeOptions = useMemo(() => {
    const q = feeSearch.trim().toLowerCase();
    if (!q) return feeOptions;
    return feeOptions.filter(
      (fee) =>
        fee.description.toLowerCase().includes(q) ||
        fee.type.toLowerCase().includes(q) ||
        fee.source.toLowerCase().includes(q)
    );
  }, [feeOptions, feeSearch]);

  const updateLine = (id: string, patch: Partial<InvoiceDetailLine>) => {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  };

  const loadFeeOptions = useCallback(async () => {
    if (!schoolId) return;
    setLoadingFees(true);
    try {
      let schoolFees: FeeOption[] = [];
      try {
        const saved = localStorage.getItem("billingPlanFeeOptions");
        const parsed = saved ? JSON.parse(saved) : [];
        if (Array.isArray(parsed) && parsed.length) {
          schoolFees = parsed.map((fee: any, index: number) =>
            normalizeFeeOption(fee, index, "fee")
          );
        }
      } catch {
        // continue to API
      }

      if (!schoolFees.length) {
        const response = await fetch(
          `${API_URL}/api/fees?schoolId=${encodeURIComponent(schoolId)}`
        );
        if (response.ok) {
          const data = await response.json();
          const list = Array.isArray(data)
            ? data
            : Array.isArray(data?.fees)
              ? data.fees
              : Array.isArray(data?.data)
                ? data.data
                : Array.isArray(data?.items)
                  ? data.items
                  : [];
          schoolFees = list.map((fee: any, index: number) =>
            normalizeFeeOption(fee, index, "fee")
          );
          if (schoolFees.length) {
            localStorage.setItem("billingPlanFeeOptions", JSON.stringify(list));
          }
        }
      }

      const planFees = getLearnerBillingPlan(learnerId, learners).map((fee: any, index: number) =>
        normalizeFeeOption(fee, index, "plan")
      );

      const merged = new Map<string, FeeOption>();
      for (const fee of [...planFees, ...schoolFees]) {
        if (!merged.has(fee.stableKey)) merged.set(fee.stableKey, fee);
      }
      setFeeOptions(Array.from(merged.values()));
    } catch (error) {
      console.error(error);
      setFeeOptions([]);
    } finally {
      setLoadingFees(false);
    }
  }, [schoolId, learnerId, learners]);

  const openFeePicker = () => {
    setSaveError("");
    setPickerSelected({});
    setFeeSearch("");
    setShowFeePicker(true);
    void loadFeeOptions();
  };

  const appendSelectedFees = () => {
    const settings = billingSettings;
    if (!settings) {
      setSaveError("Billing settings still loading. Try again in a moment.");
      return;
    }
    const selected = feeOptions.filter((fee) => pickerSelected[fee.stableKey]);
    if (!selected.length) {
      setSaveError("Select at least one fee to add.");
      return;
    }
    const existingFeeIds = new Set(
      lines.map((line) => String(line.feeId || "").trim()).filter(Boolean)
    );
    const invDate = normalizeIsoDate(invoiceDate);
    const toAdd = selected.filter((fee) => !fee.feeId || !existingFeeIds.has(fee.feeId));
    if (!toAdd.length) {
      setSaveError("Selected catalog fees are already on this invoice.");
      return;
    }
    const nextLines = toAdd.map((fee) => feeToLine(fee, invDate, settings));
    setLines((prev) => [...prev, ...nextLines]);
    setSelectedLineId(nextLines[nextLines.length - 1]?.id || null);
    setShowFeePicker(false);
    setSaveError("");
  };

  const addManualLine = () => {
    const settings = billingSettings;
    if (!settings) {
      setSaveError("Billing settings still loading. Try again in a moment.");
      return;
    }
    const next = newManualLine(normalizeIsoDate(invoiceDate), settings, defaultDueDate);
    setLines((prev) => [...prev, next]);
    setSelectedLineId(next.id);
    setSaveError("");
  };

  const resetForm = () => {
    setInvoiceDate(todayIso());
    setMessage(defaultMessage || "");
    setLines([]);
    setSelectedLineId(null);
    setSaveError("");
    setShowFeePicker(false);
    setPickerSelected({});
    if (schoolId) {
      void loadBillingSettingsForSchool(schoolId).then((settings) => {
        setBillingSettings(settings);
        setMessage(resolveInvoiceMessage(settings) || defaultMessage || "");
      });
    }
  };

  const deleteSelectedLine = () => {
    if (selectedIndex < 0) {
      setSaveError("Select a detail row to delete.");
      return;
    }
    setSaveError("");
    setLines((prev) => {
      const next = prev.filter((_, idx) => idx !== selectedIndex);
      const fallback = next[Math.min(selectedIndex, Math.max(0, next.length - 1))];
      setSelectedLineId(fallback?.id || null);
      return next;
    });
  };

  const moveSelected = (direction: "up" | "down") => {
    if (selectedIndex < 0) {
      setSaveError("Select a detail row to move.");
      return;
    }
    setSaveError("");
    const target = direction === "up" ? selectedIndex - 1 : selectedIndex + 1;
    if (target < 0 || target >= lines.length) return;
    setLines((prev) => {
      const next = [...prev];
      [next[selectedIndex], next[target]] = [next[target], next[selectedIndex]];
      return next;
    });
  };

  const saveInvoice = useCallback(async () => {
    setSaveError("");
    if (!selectedAccount) {
      setSaveError("Account not selected. Go back and choose an account.");
      return;
    }
    if (!schoolId) {
      setSaveError("School not loaded. Sign in again and retry.");
      return;
    }
    if (!accountNo || accountNo === "-") {
      setSaveError("Account number is missing for this learner.");
      return;
    }

    const resolvedLearnerId = resolveManualInvoiceLearnerId(selectedAccount, learners, accountNo);
    const staleCandidate = String(selectedAccount?.learnerId || "").trim();
    const selectionResolvedId = resolvePaymentLearnerId(selectedAccount, learners, accountNo);
    if (
      staleCandidate &&
      selectionResolvedId &&
      staleCandidate !== selectionResolvedId
    ) {
      setSaveError(
        "Account selection is out of date. Go back, re-select the account, and try again."
      );
      return;
    }
    if (resolvedLearnerId) {
      const learner = (learners || []).find(
        (l) => String(l?.id || l?.learnerId || "").trim() === resolvedLearnerId
      );
      if (learner && !learnerMatchesBillingAccountRef(learner, accountNo)) {
        setSaveError(
          "Selected learner does not belong to this billing account. Re-select the account."
        );
        return;
      }
    }

    // Billing identity is accountRef only (FamilyAccount.accountRef / Kid-e-Sys accountRef).
    // learnerId remains optional for write paths.
    const invDate = normalizeIsoDate(invoiceDate);
    if (!invDate) {
      setSaveError("Invoice date is required.");
      return;
    }

    const validLines = lines
      .map((line) => ({
        description: String(line.description || "").trim(),
        type: String(line.type || "").trim() || "Fee",
        dueDate: normalizeIsoDate(line.dueDate),
        amount: parseLineAmount(line.amount),
      }))
      .filter((line) => line.description && line.amount > 0 && line.dueDate);

    if (!validLines.length) {
      setSaveError(
        "Add at least one invoice line with description, due date, and amount greater than zero."
      );
      return;
    }

    const amount = roundMoney(validLines.reduce((sum, line) => sum + line.amount, 0));
    if (amount <= 0) {
      setSaveError("Invoice total must be greater than zero.");
      return;
    }

    setSaving(true);
    setSaveJustSucceeded(false);
    const saveStarted = performance.now();
    try {
      const settings = billingSettings || (await loadBillingSettingsForSchool(schoolId));
      const baseRef = `INV-${accountNo}-${Date.now()}`;
      const invoicePayloads = validLines.map((line, i) => {
        const computedDue = computeInvoiceDueDate(invDate, settings, line.dueDate);
        const reference =
          validLines.length > 1 ? `${baseRef}-L${i + 1}` : baseRef;
        return {
          schoolId,
          learnerId: resolvedLearnerId,
          accountNo,
          amount: line.amount,
          date: invDate,
          dueDate: computedDue,
          reference,
          description: line.description,
          lineKey: `L${i + 1}`,
          id: `invoice-manual-${accountNo}-${resolvedLearnerId}-${invDate}-${line.amount.toFixed(2)}-${i}-${reference}`,
        };
      });

      const postStarted = performance.now();
      const result = await createInvoicesBatch({
        schoolId,
        invoices: invoicePayloads,
      });
      logBillingSaveTiming("invoice POST", performance.now() - postStarted);

      assertInvoiceBatchSaveSucceeded(result);

      const patchStarted = performance.now();
      applyInvoiceSaveResponse(schoolId, result as Record<string, unknown>);
      setLedgerTick((v) => v + 1);
      logBillingSaveTiming("invoice post-response patch", performance.now() - patchStarted);

      setSaving(false);
      setSaveJustSucceeded(true);
      logBillingSaveTiming("invoice save total", performance.now() - saveStarted);
      onSaved();
    } catch (error) {
      console.error(error);
      setSaveError(
        error instanceof Error
          ? error.message
          : "Invoice could not be saved. Check your connection and try again."
      );
      setSaving(false);
    }
  }, [
    selectedAccount,
    schoolId,
    accountNo,
    learners,
    invoiceDate,
    lines,
    message,
    billingSettings,
    onSaved,
  ]);

  if (!selectedAccount) {
    return (
      <div style={{ padding: 24 }}>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 900 }}>Create Invoice</h1>
        <p style={{ marginTop: 12, fontWeight: 700, color: "#64748b" }}>
          Please select an account first.
        </p>
        <button type="button" style={{ ...invBtn, marginTop: 14 }} onClick={onBack}>
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
        Create Invoice
      </h1>

      {saveError ? (
        <p style={{ marginTop: 14, color: "#b91c1c", fontWeight: 800 }} role="alert">
          {saveError}
        </p>
      ) : null}
      <div style={{ display: "flex", gap: 8, margin: "14px 0", flexWrap: "wrap" }}>
        <button type="button" style={invBtn} onClick={onBack}>
          Back
        </button>
        <button
          type="button"
          style={{
            ...invGoldBtn,
            opacity: saving ? 0.55 : 1,
            cursor: saving ? "not-allowed" : "pointer",
          }}
          onClick={() => void saveInvoice()}
          disabled={saving}
        >
          {saving ? "Saving…" : saveJustSucceeded ? "Saved ✓" : "Save Invoice"}
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 340px",
          gap: 16,
          alignItems: "start",
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
            Invoice
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
                    style={invInput}
                    value={accountNo}
                  />,
                ],
                [
                  "Invoice Date",
                  <input
                    key="date"
                    type="date"
                    style={invInput}
                    value={dateInputValue(invoiceDate)}
                    onChange={(e) => setInvoiceDate(e.target.value)}
                  />,
                ],
                [
                  "Total",
                  <input
                    key="total"
                    type="text"
                    readOnly
                    style={{ ...invInput, textAlign: "right" }}
                    value={formatMoney(lineTotal)}
                  />,
                ],
                [
                  "Message",
                  <textarea
                    key="message"
                    style={{ ...invInput, minHeight: 70 }}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
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

          <div style={{ borderTop: "1px solid #d6c17a" }}>
            <div
              style={{
                background: "#111827",
                color: "#d4af37",
                padding: "11px 15px",
                fontSize: 18,
                fontWeight: 900,
              }}
            >
              Invoice Details
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
              <button type="button" style={invSmallBtn} onClick={openFeePicker}>
                Add
              </button>
              <button type="button" style={invSmallBtn} onClick={addManualLine}>
                Manual Line
              </button>
              <button type="button" style={invSmallBtn} onClick={resetForm}>
                New
              </button>
              <button type="button" style={invSmallBtn} onClick={deleteSelectedLine}>
                Delete
              </button>
              <button type="button" style={invSmallBtn} onClick={() => moveSelected("up")}>
                Move Up
              </button>
              <button type="button" style={invSmallBtn} onClick={() => moveSelected("down")}>
                Move Down
              </button>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "36%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "140px" }} />
                <col style={{ width: "120px" }} />
              </colgroup>
              <thead>
                <tr style={{ background: "#f8fafc" }}>
                  {[
                    { label: "Description", align: "left" as const },
                    { label: "Type", align: "left" as const },
                    { label: "Due Date", align: "left" as const },
                    { label: "Amount", align: "right" as const },
                  ].map((h) => (
                    <th
                      key={h.label}
                      style={{
                        padding: "7px 8px",
                        textAlign: h.align,
                        fontWeight: 900,
                        fontSize: 12,
                      }}
                    >
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.length ? (
                  lines.map((line) => {
                    const isSelected = line.id === selectedLineId;
                    return (
                      <tr
                        key={line.id}
                        onClick={() => {
                          setSelectedLineId(line.id);
                          setSaveError("");
                        }}
                        style={{
                          cursor: "pointer",
                          background: isSelected ? "rgba(212, 175, 55, 0.14)" : undefined,
                        }}
                      >
                        <td style={invCell}>
                          <input
                            type="text"
                            style={{ ...invInput, minHeight: 30, padding: "5px 8px", fontSize: 13 }}
                            value={line.description}
                            onChange={(e) =>
                              updateLine(line.id, { description: e.target.value })
                            }
                            onClick={(e) => e.stopPropagation()}
                            placeholder="Description"
                          />
                        </td>
                        <td style={invCell}>
                          <select
                            style={{ ...invInput, minHeight: 30, padding: "5px 8px", fontSize: 13 }}
                            value={line.type}
                            onChange={(e) => updateLine(line.id, { type: e.target.value })}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {INVOICE_LINE_TYPES.map((t) => (
                              <option key={t} value={t} style={{ color: INV_FIELD_COLOR }}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={invCell}>
                          <input
                            type="date"
                            style={invDueInput}
                            value={dateInputValue(line.dueDate)}
                            onChange={(e) => updateLine(line.id, { dueDate: e.target.value })}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td style={{ ...invCell, textAlign: "right" }}>
                          <input
                            type="text"
                            inputMode="decimal"
                            style={{
                              ...invInput,
                              minHeight: 30,
                              padding: "5px 8px",
                              fontSize: 13,
                              textAlign: "right",
                            }}
                            value={line.amount}
                            onChange={(e) => updateLine(line.id, { amount: e.target.value })}
                            onClick={(e) => e.stopPropagation()}
                            placeholder="0.00"
                          />
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td
                      colSpan={4}
                      style={{
                        ...invCell,
                        padding: "14px 12px",
                        color: "#64748b",
                        fontWeight: 700,
                        fontSize: 13,
                      }}
                    >
                      No lines yet. Click Add to select fees, or Manual Line to type a row.
                    </td>
                  </tr>
                )}
                <tr style={{ fontWeight: 900, background: "#faf9f6" }}>
                  <td colSpan={3} style={{ ...invCell, paddingLeft: 12 }}>
                    Total
                  </td>
                  <td style={{ ...invCell, textAlign: "right", paddingRight: 12 }}>
                    {formatMoney(lineTotal)}
                  </td>
                </tr>
              </tbody>
            </table>
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
          <div style={{ padding: 16, fontWeight: 800, lineHeight: 1.8, fontSize: 14 }}>
            <div>
              <span style={{ color: "#64748b" }}>Account No: </span>
              {accountNo || "-"}
            </div>
            <div>
              <span style={{ color: "#64748b" }}>Learner: </span>
              {selectedAccount.name} {selectedAccount.surname}
            </div>
            <div>
              <span style={{ color: "#64748b" }}>Parent: </span>
              {parentDisplayName}
            </div>
            <div>
              <span style={{ color: "#64748b" }}>Balance: </span>
              <span style={{ color: currentBalance > 0 ? "#b91c1c" : "#166534" }}>
                {formatMoney(currentBalance)}
              </span>
            </div>
            <div>
              <span style={{ color: "#64748b" }}>Last invoice: </span>
              {lastInvoiceLabel}
            </div>
            <div>
              <span style={{ color: "#64748b" }}>Last payment: </span>
              {lastPaymentLabel}
            </div>
          </div>
        </section>
      </div>

      {showFeePicker ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(17,24,39,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
          onClick={() => setShowFeePicker(false)}
        >
          <div
            style={{
              width: 820,
              maxWidth: "100%",
              maxHeight: "82vh",
              overflow: "hidden",
              background: "#fff",
              border: "2px solid #d4af37",
              borderRadius: 14,
              boxShadow: "0 25px 70px rgba(0,0,0,0.25)",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                background: "#111827",
                color: "#d4af37",
                padding: "14px 18px",
                fontSize: 20,
                fontWeight: 900,
              }}
            >
              Add fees to invoice
            </div>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #e5e7eb" }}>
              <input
                type="search"
                placeholder="Search fees…"
                value={feeSearch}
                onChange={(e) => setFeeSearch(e.target.value)}
                style={{
                  width: "100%",
                  maxWidth: 280,
                  marginLeft: "auto",
                  display: "block",
                  padding: "8px 10px",
                  border: "1px solid #d4af37",
                  borderRadius: 8,
                  fontWeight: 700,
                }}
              />
            </div>
            <div style={{ overflowY: "auto", flex: 1, padding: "12px 16px" }}>
              {loadingFees ? (
                <p style={{ color: "#64748b", fontWeight: 700 }}>Loading fees…</p>
              ) : filteredFeeOptions.length === 0 ? (
                <p style={{ color: "#64748b", fontWeight: 700 }}>
                  No fees found. Add fees under Fees, or set up this learner&apos;s billing plan.
                </p>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {filteredFeeOptions.map((fee) => {
                    const checked = Boolean(pickerSelected[fee.stableKey]);
                    return (
                      <label
                        key={fee.stableKey}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "36px 1fr 110px 90px",
                          gap: 10,
                          alignItems: "center",
                          padding: "10px 12px",
                          border: checked
                            ? "2px solid #d4af37"
                            : "1px solid #e2e8f0",
                          borderRadius: 10,
                          cursor: "pointer",
                          background: checked ? "rgba(212,175,55,0.08)" : "#fff",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setPickerSelected((prev) => ({
                              ...prev,
                              [fee.stableKey]: e.target.checked,
                            }))
                          }
                          style={{ width: 16, height: 16 }}
                        />
                        <div>
                          <div style={{ fontWeight: 800, color: "#0f172a" }}>{fee.description}</div>
                          <div style={{ color: "#64748b", fontSize: 11, marginTop: 2 }}>
                            {fee.type}
                            {fee.source === "plan" ? " · Billing plan" : ""}
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: "#64748b" }}>
                          {fee.dueDate ? dateInputValue(fee.dueDate) : "Default due"}
                        </div>
                        <div style={{ fontWeight: 900, textAlign: "right" }}>
                          {formatMoney(fee.amount)}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "12px 16px",
                borderTop: "1px solid #e5e7eb",
                gap: 10,
              }}
            >
              <button type="button" style={invBtn} onClick={() => setShowFeePicker(false)}>
                Cancel
              </button>
              <button
                type="button"
                style={invGoldBtn}
                onClick={appendSelectedFees}
                disabled={loadingFees}
              >
                Add Selected
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
