import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "./billingLedger";
import {
  clearPaymentAllocations,
  fetchAllocationTargets,
  receiptPdfUrl,
  savePaymentAllocations,
  suggestPaymentAllocations,
  type AllocationLine,
  type AllocationTargets,
  type FeeCategoryKey,
} from "./paymentAllocationApi";

const GOLD = "#d4af37";
const INK = "#111827";
const PANEL = "#0f172a";

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirmed?: () => void;
  schoolId: string;
  paymentId: string;
  learnerId: string;
  accountNo: string;
  paymentAmount: number;
  payerLabel?: string;
  paymentDate?: string;
};

type DraftLine = {
  key: string;
  invoiceId?: string;
  feeCategory?: FeeCategoryKey;
  label: string;
  cap: number;
  allocatedAmount: number;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const TARGET_REFRESH_DEBOUNCE_MS = 400;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export default function PaymentAllocationModal({
  open,
  onClose,
  onConfirmed,
  schoolId,
  paymentId,
  learnerId,
  accountNo,
  paymentAmount,
  payerLabel,
  paymentDate,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [targets, setTargets] = useState<AllocationTargets | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const debouncedPaymentAmount = useDebouncedValue(paymentAmount, TARGET_REFRESH_DEBOUNCE_MS);
  const loadGenerationRef = useRef(0);

  const load = useCallback(async () => {
    if (!open || !schoolId || !paymentId) return;
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setError("");
    try {
      const res = await fetchAllocationTargets({
        schoolId,
        learnerId,
        accountNo,
        paymentAmount: debouncedPaymentAmount,
        paymentId,
      });
      if (generation !== loadGenerationRef.current) return;
      setTargets(res.targets);

      if (res.existingAllocations?.length) {
        setLines(
          res.existingAllocations.map((row, i) => ({
            key: `existing-${i}`,
            invoiceId: row.invoiceId || undefined,
            feeCategory: row.feeCategory || undefined,
            label: row.feeCategoryLabel,
            cap: row.allocatedAmount,
            allocatedAmount: row.allocatedAmount,
          }))
        );
      } else {
        const suggested = await suggestPaymentAllocations({
          schoolId,
          learnerId,
          accountNo,
          paymentAmount: debouncedPaymentAmount,
        });
        if (generation !== loadGenerationRef.current) return;
        setLines(buildDraftFromSuggestions(suggested.targets, suggested.suggestions));
      }
    } catch (e: unknown) {
      if (generation !== loadGenerationRef.current) return;
      setError(e instanceof Error ? e.message : "Could not load allocation targets");
    } finally {
      if (generation === loadGenerationRef.current) {
        setLoading(false);
      }
    }
  }, [open, schoolId, paymentId, learnerId, accountNo, debouncedPaymentAmount]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const allocatedTotal = useMemo(
    () => round2(lines.reduce((s, l) => s + Number(l.allocatedAmount || 0), 0)),
    [lines]
  );

  const remaining = useMemo(
    () => round2(Math.max(0, paymentAmount - allocatedTotal)),
    [paymentAmount, allocatedTotal]
  );

  const overAllocated = allocatedTotal > paymentAmount + 0.001;

  const updateLine = (key: string, value: number) => {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, allocatedAmount: Math.max(0, value) } : l))
    );
  };

  const handleAutoAllocate = async () => {
    setError("");
    try {
      const res = await suggestPaymentAllocations({
        schoolId,
        learnerId,
        accountNo,
        paymentAmount,
      });
      setLines(buildDraftFromSuggestions(res.targets, res.suggestions));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Auto allocate failed");
    }
  };

  const handleClear = async () => {
    setError("");
    try {
      await clearPaymentAllocations(schoolId, paymentId);
      setLines([]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Clear failed");
    }
  };

  const handleConfirm = async () => {
    if (overAllocated) {
      setError("Total allocation exceeds payment amount");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload: AllocationLine[] = lines
        .filter((l) => l.allocatedAmount > 0.001)
        .map((l) => ({
          invoiceId: l.invoiceId,
          feeCategory: l.feeCategory,
          allocatedAmount: l.allocatedAmount,
        }));
      if (remaining > 0.001) {
        payload.push({ feeCategory: "account_credit", allocatedAmount: remaining });
      }
      await savePaymentAllocations(paymentId, {
        schoolId,
        learnerId,
        accountNo,
        paymentAmount,
        lines: payload,
        allocatedBy: localStorage.getItem("userEmail") || "Billing",
      });
      onConfirmed?.();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not save allocations");
    } finally {
      setSaving(false);
    }
  };

  const handlePrintReceipt = () => {
    const url = receiptPdfUrl(schoolId, paymentId);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 12000,
        background: "rgba(15,23,42,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(920px, 100%)",
          maxHeight: "min(92vh, 900px)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          borderRadius: 16,
          border: `2px solid ${GOLD}`,
          background: PANEL,
          color: "#f8fafc",
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
        }}
      >
        <header
          style={{
            padding: "16px 20px",
            borderBottom: `1px solid ${GOLD}`,
            background: INK,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: GOLD }}>
                Split Payment Allocation
              </h2>
              <p style={{ margin: "6px 0 0", color: "#94a3b8", fontSize: 13, fontWeight: 600 }}>
                {payerLabel || accountNo} · {paymentDate || "—"}
              </p>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 700 }}>Payment amount</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: GOLD }}>{formatMoney(paymentAmount)}</div>
              <div
                style={{
                  marginTop: 6,
                  fontSize: 13,
                  fontWeight: 800,
                  color: overAllocated ? "#f87171" : remaining < 0.01 ? "#4ade80" : "#fbbf24",
                }}
              >
                Remaining: {formatMoney(remaining)}
              </div>
            </div>
          </div>
        </header>

        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {loading ? (
            <p style={{ color: "#94a3b8", fontWeight: 700 }}>Loading outstanding balances…</p>
          ) : null}
          {error ? (
            <p style={{ color: "#f87171", fontWeight: 800, marginBottom: 12 }}>{error}</p>
          ) : null}

          {!loading && targets ? (
            <>
              {targets.accountCredit > 0 ? (
                <p style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12 }}>
                  Account credit available: {formatMoney(targets.accountCredit)}
                </p>
              ) : null}

              <section style={{ marginBottom: 18 }}>
                <h3 style={{ margin: "0 0 10px", fontSize: 14, color: GOLD, fontWeight: 900 }}>
                  Invoices
                </h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: INK, color: GOLD }}>
                        {["Reference", "Description", "Due", "Outstanding", "Allocate"].map((h) => (
                          <th key={h} style={{ padding: "8px 10px", textAlign: "left" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lines
                        .filter((l) => l.invoiceId)
                        .map((line) => (
                          <tr key={line.key} style={{ borderTop: "1px solid #334155" }}>
                            <td style={{ padding: "8px 10px" }}>{line.label.split(" · ")[0]}</td>
                            <td style={{ padding: "8px 10px", color: "#cbd5e1" }}>
                              {line.label.includes(" · ") ? line.label.split(" · ").slice(1).join(" · ") : line.label}
                            </td>
                            <td style={{ padding: "8px 10px" }}>—</td>
                            <td style={{ padding: "8px 10px" }}>{formatMoney(line.cap)}</td>
                            <td style={{ padding: "8px 10px", minWidth: 110 }}>
                              <input
                                type="number"
                                min={0}
                                max={line.cap}
                                step={0.01}
                                value={line.allocatedAmount || ""}
                                onChange={(e) => updateLine(line.key, Number(e.target.value))}
                                style={inputStyle}
                              />
                            </td>
                          </tr>
                        ))}
                      {!lines.some((l) => l.invoiceId) ? (
                        <tr>
                          <td colSpan={5} style={{ padding: 12, color: "#64748b" }}>
                            No open invoices — allocate to fee categories below.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h3 style={{ margin: "0 0 10px", fontSize: 14, color: GOLD, fontWeight: 900 }}>
                  Fee categories
                </h3>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                    gap: 10,
                  }}
                >
                  {lines
                    .filter((l) => l.feeCategory && l.feeCategory !== "account_credit")
                    .map((line) => (
                      <label
                        key={line.key}
                        style={{
                          display: "block",
                          padding: 12,
                          borderRadius: 10,
                          border: "1px solid #334155",
                          background: "#1e293b",
                        }}
                      >
                        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>{line.label}</div>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>
                          Outstanding {formatMoney(line.cap)}
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={line.cap}
                          step={0.01}
                          value={line.allocatedAmount || ""}
                          onChange={(e) => updateLine(line.key, Number(e.target.value))}
                          style={inputStyle}
                        />
                      </label>
                    ))}
                </div>
              </section>
            </>
          ) : null}
        </div>

        <footer
          style={{
            padding: "14px 16px",
            borderTop: `1px solid ${GOLD}`,
            background: INK,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <button type="button" style={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" style={btnGhost} onClick={() => void handleClear()} disabled={saving}>
            Clear allocations
          </button>
          <button type="button" style={btnGhost} onClick={() => void handleAutoAllocate()} disabled={saving || loading}>
            Auto allocate
          </button>
          <button type="button" style={btnGhost} onClick={handlePrintReceipt} disabled={!paymentId}>
            PDF / Print
          </button>
          <button
            type="button"
            style={btnGold}
            onClick={() => void handleConfirm()}
            disabled={saving || loading || overAllocated}
          >
            {saving ? "Saving…" : "Confirm allocation"}
          </button>
        </footer>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 36,
  borderRadius: 8,
  border: "1px solid #475569",
  background: "#0f172a",
  color: "#f8fafc",
  padding: "6px 10px",
  fontWeight: 700,
};

const btnGhost: React.CSSProperties = {
  border: "1px solid #475569",
  background: "transparent",
  color: "#e2e8f0",
  borderRadius: 10,
  padding: "8px 14px",
  fontWeight: 800,
  cursor: "pointer",
};

const btnGold: React.CSSProperties = {
  border: `1px solid ${GOLD}`,
  background: GOLD,
  color: INK,
  borderRadius: 10,
  padding: "8px 16px",
  fontWeight: 900,
  cursor: "pointer",
  boxShadow: "0 8px 18px rgba(212,175,55,0.25)",
};

function buildDraftFromSuggestions(
  targets: AllocationTargets,
  suggestions: AllocationLine[]
): DraftLine[] {
  const drafts: DraftLine[] = [];
  let i = 0;

  for (const inv of targets.invoices) {
    const sug = suggestions.find((s) => s.invoiceId === inv.id);
    drafts.push({
      key: `inv-${inv.id}`,
      invoiceId: inv.id,
      label: `${inv.reference || inv.id} · ${inv.description}`,
      cap: inv.unpaid,
      allocatedAmount: sug?.allocatedAmount || 0,
    });
    i += 1;
  }

  for (const cat of targets.categories) {
    const sug = suggestions.find((s) => s.feeCategory === cat.feeCategory);
    drafts.push({
      key: `cat-${cat.feeCategory}`,
      feeCategory: cat.feeCategory,
      label: cat.label,
      cap: cat.outstanding,
      allocatedAmount: sug?.allocatedAmount || 0,
    });
    i += 1;
  }

  return drafts;
}
