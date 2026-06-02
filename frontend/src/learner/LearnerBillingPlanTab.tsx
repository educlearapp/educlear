import React, { useCallback, useEffect, useMemo, useState } from "react";
import { API_URL } from "../api";
import { notifyLearnersRefresh } from "../billing/billingLedger";

const GOLD = "#d4af37";

type BillingPlanFee = {
  id: string;
  description: string;
  type: string;
  amount: number;
  dueDate: string;
};

type Props = {
  learner: any;
  onLearnerUpdated: (learner: any) => void;
  setLearners: React.Dispatch<React.SetStateAction<any[]>>;
};

const btnGold: React.CSSProperties = {
  background: GOLD,
  color: "#020617",
  border: `1px solid ${GOLD}`,
  borderRadius: "9px",
  padding: "8px 13px",
  fontWeight: 800,
  cursor: "pointer",
};

const btnLight: React.CSSProperties = {
  background: "#ffffff",
  color: "#0f172a",
  border: "1px solid #cbd5e1",
  borderRadius: "9px",
  padding: "8px 13px",
  fontWeight: 700,
  cursor: "pointer",
};

const btnDanger: React.CSSProperties = {
  ...btnLight,
  color: "#b91c1c",
  border: "1px solid rgba(185,28,28,0.24)",
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "12px",
  borderBottom: "1px solid #e5e7eb",
  fontWeight: 900,
  color: "#334155",
  fontSize: "13px",
};

const td: React.CSSProperties = {
  padding: "12px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: "13px",
};

function normalizeFee(fee: any, index: number): BillingPlanFee {
  return {
    id: String(
      fee?.id ||
        fee?.feeId ||
        fee?.description ||
        fee?.feeDescription ||
        fee?.name ||
        `fee-${index}`
    ),
    description: String(
      fee?.description || fee?.feeDescription || fee?.name || fee?.title || "Fee"
    ),
    type: String(fee?.type || fee?.feeType || fee?.category || "Fee"),
    amount: Number(fee?.amount ?? fee?.price ?? fee?.value ?? 0),
    dueDate: fee?.dueDate || "",
  };
}

function money(value: number) {
  return `R ${Number(value || 0).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function parseFeesApiList(data: unknown): any[] {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data)) return data;
  const payload = data as Record<string, unknown>;
  if (Array.isArray(payload.fees)) return payload.fees;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

function extractSavedBillingPlan(data: unknown, fallback: BillingPlanFee[]): BillingPlanFee[] {
  const payload = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const fromRoot = payload.billingPlan;
  const learner = payload.learner;
  const fromLearner =
    learner && typeof learner === "object"
      ? (learner as Record<string, unknown>).billingPlan
      : undefined;
  const saved = Array.isArray(fromRoot)
    ? fromRoot
    : Array.isArray(fromLearner)
      ? fromLearner
      : fallback;
  return saved.map(normalizeFee);
}

function getPlanFromLearner(learner: any): BillingPlanFee[] {
  if (!Array.isArray(learner?.billingPlan)) return [];
  return learner.billingPlan.map(normalizeFee);
}

export default function LearnerBillingPlanTab({ learner, onLearnerUpdated, setLearners }: Props) {
  const learnerKey = String(learner?.id || learner?.learnerId || "").trim();
  const learnerName = `${String(learner?.firstName || learner?.name || "").trim()} ${String(
    learner?.lastName || learner?.surname || ""
  ).trim()}`.trim();

  const [plan, setPlan] = useState<BillingPlanFee[]>(() => getPlanFromLearner(learner));
  const [showFeePicker, setShowFeePicker] = useState(false);
  const [allFees, setAllFees] = useState<BillingPlanFee[]>([]);
  const [feeSearch, setFeeSearch] = useState("");
  const [selectedFeeIds, setSelectedFeeIds] = useState<Set<string>>(() => new Set());
  const [feesLoading, setFeesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");

  useEffect(() => {
    setPlan(getPlanFromLearner(learner));
    setSaveError("");
    setSaveNotice("");
  }, [learnerKey, learner?.billingPlan]);

  const planTotal = useMemo(
    () => plan.reduce((sum, fee) => sum + Number(fee.amount || 0), 0),
    [plan]
  );

  const mergeLearnerIntoList = useCallback(
    (updated: any) => {
      if (!learnerKey) return;
      setLearners((prev) =>
        prev.map((row) =>
          String(row?.id || row?.learnerId || "") === learnerKey ? { ...row, ...updated } : row
        )
      );
      onLearnerUpdated(updated);
    },
    [learnerKey, onLearnerUpdated, setLearners]
  );

  const savePlan = useCallback(
    async (nextPlan: BillingPlanFee[]) => {
      const normalizedPlan = nextPlan.map(normalizeFee);
      setPlan(normalizedPlan);
      setSaveError("");
      setSaveNotice("");

      if (!learnerKey) {
        mergeLearnerIntoList({ ...learner, billingPlan: normalizedPlan });
        return { ok: true as const };
      }

      setSaving(true);
      try {
        const response = await fetch(`${API_URL}/api/learners/${encodeURIComponent(learnerKey)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...learner, billingPlan: normalizedPlan }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          const message = String(
            (data as { error?: string })?.error || `Save failed (${response.status})`
          );
          setSaveError(message);
          return { ok: false as const, error: message };
        }

        const savedPlan = extractSavedBillingPlan(data, normalizedPlan);
        const mergedLearner = {
          ...learner,
          ...(data as { learner?: any })?.learner,
          billingPlan: savedPlan,
        };
        setPlan(savedPlan);
        mergeLearnerIntoList(mergedLearner);
        notifyLearnersRefresh();
        setSaveNotice("Billing plan saved.");
        return { ok: true as const };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to save billing plan";
        setSaveError(message);
        return { ok: false as const, error: message };
      } finally {
        setSaving(false);
      }
    },
    [learner, learnerKey, mergeLearnerIntoList]
  );

  const loadFeesThenOpen = async () => {
    setFeesLoading(true);
    setFeeSearch("");
    setSelectedFeeIds(new Set());
    setAllFees([]);

    const schoolId =
      String(learner?.schoolId || "").trim() ||
      localStorage.getItem("schoolId") ||
      localStorage.getItem("selectedSchoolId") ||
      "";

    let loadedFees: BillingPlanFee[] = [];
    if (schoolId) {
      try {
        const apiPageSize = 100;
        let page = 1;
        while (true) {
          const url = `${API_URL}/api/fees?schoolId=${encodeURIComponent(
            schoolId
          )}&page=${page}&pageSize=${apiPageSize}`;
          const response = await fetch(url);
          if (!response.ok) break;
          const data = await response.json();
          const list = parseFeesApiList(data);
          if (list.length > 0) {
            loadedFees = loadedFees.concat(list.map(normalizeFee));
          }
          const reportedTotal = Number((data as { total?: unknown })?.total);
          const responsePageSize = Number((data as { pageSize?: unknown })?.pageSize);
          const effectivePageSize =
            Number.isFinite(responsePageSize) && responsePageSize > 0
              ? responsePageSize
              : apiPageSize;
          if (list.length === 0) break;
          if (Number.isFinite(reportedTotal) && reportedTotal > 0 && loadedFees.length >= reportedTotal) {
            break;
          }
          if (!Number.isFinite(reportedTotal) && list.length < effectivePageSize) break;
          page += 1;
        }
      } catch {
        // fee list optional
      }
    }

    setAllFees(loadedFees);
    setFeesLoading(false);
    setShowFeePicker(true);
  };

  const filteredFees = useMemo(() => {
    const q = feeSearch.trim().toLowerCase();
    if (!q) return allFees;
    return allFees.filter(
      (fee) =>
        fee.description.toLowerCase().includes(q) || fee.type.toLowerCase().includes(q)
    );
  }, [allFees, feeSearch]);

  const toggleFeeSelected = (feeId: string, checked: boolean) => {
    setSelectedFeeIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(feeId);
      else next.delete(feeId);
      return next;
    });
  };

  const handleAddSelectedFees = async () => {
    const selectedFees = filteredFees.filter((fee) => selectedFeeIds.has(fee.id));
    if (selectedFees.length === 0) {
      setSaveError("Select at least one fee to add.");
      return;
    }
    const existingIds = new Set(plan.map((fee) => fee.id));
    const toAdd = selectedFees
      .filter((fee) => !existingIds.has(fee.id))
      .map((fee) => ({ ...fee, dueDate: "" }));
    if (toAdd.length === 0) {
      setSaveError("Selected fees are already on this billing plan.");
      return;
    }
    setShowFeePicker(false);
    await savePlan([...plan, ...toAdd]);
  };

  return (
    <div style={{ padding: "22px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "14px",
          gap: "12px",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontWeight: 900, color: "#0f172a", fontSize: "16px" }}>{learnerName}</div>
          <div style={{ color: "#64748b", fontSize: "13px", marginTop: "4px" }}>
            Manage recurring fee lines for this learner.
          </div>
        </div>
        <div style={{ fontWeight: 900, color: "#0f172a", fontSize: "15px" }}>
          Total: {money(planTotal)}
        </div>
      </div>

      {saveError ? (
        <div
          style={{
            marginBottom: "12px",
            padding: "10px 12px",
            borderRadius: "10px",
            background: "#fef2f2",
            color: "#b91c1c",
            fontWeight: 700,
            fontSize: "13px",
          }}
        >
          {saveError}
        </div>
      ) : null}

      {saveNotice ? (
        <div
          style={{
            marginBottom: "12px",
            padding: "10px 12px",
            borderRadius: "10px",
            background: "#ecfdf5",
            color: "#047857",
            fontWeight: 700,
            fontSize: "13px",
          }}
        >
          {saveNotice}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
        <button
          type="button"
          style={{ ...btnGold, opacity: saving ? 0.7 : 1 }}
          onClick={() => void loadFeesThenOpen()}
          disabled={saving || feesLoading}
        >
          {feesLoading ? "Loading fees..." : "+ Add Fee"}
        </button>
        <button
          type="button"
          style={{ ...btnDanger, opacity: saving || plan.length === 0 ? 0.6 : 1 }}
          onClick={() => void savePlan([])}
          disabled={saving || plan.length === 0}
        >
          Remove All
        </button>
        {saving ? (
          <span style={{ alignSelf: "center", color: "#64748b", fontWeight: 700, fontSize: "13px" }}>
            Saving...
          </span>
        ) : null}
      </div>

      <div
        style={{
          background: "#fff",
          borderRadius: "12px",
          border: "1px solid #e2e8f0",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            background: "#020617",
            color: GOLD,
            padding: "12px 16px",
            fontWeight: 900,
          }}
        >
          Billing Plan
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Description</th>
              <th style={th}>Type</th>
              <th style={th}>Amount</th>
              <th style={th}>Due Date</th>
              <th style={th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {plan.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ ...td, textAlign: "center", padding: "24px", color: "#64748b" }}>
                  No fees added yet. Click &quot;+ Add Fee&quot; to build this learner&apos;s billing plan.
                </td>
              </tr>
            ) : (
              plan.map((fee, index) => (
                <tr key={`${fee.id}-${index}`}>
                  <td style={td}>{fee.description}</td>
                  <td style={td}>{fee.type}</td>
                  <td style={td}>{money(fee.amount)}</td>
                  <td style={td}>
                    <input
                      type="date"
                      value={fee.dueDate || ""}
                      onChange={(event) => {
                        const updatedPlan = plan.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, dueDate: event.target.value } : item
                        );
                        void savePlan(updatedPlan);
                      }}
                      style={{
                        padding: "7px 8px",
                        borderRadius: "8px",
                        border: "1px solid #cbd5e1",
                      }}
                      disabled={saving}
                    />
                  </td>
                  <td style={td}>
                    <button
                      type="button"
                      style={{ ...btnDanger, padding: "6px 10px", fontSize: "12px" }}
                      onClick={() => void savePlan(plan.filter((_, itemIndex) => itemIndex !== index))}
                      disabled={saving}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showFeePicker ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.55)",
            display: "grid",
            placeItems: "center",
            zIndex: 1200,
            padding: "16px",
          }}
          onClick={() => setShowFeePicker(false)}
        >
          <div
            style={{
              width: "min(760px, 100%)",
              maxHeight: "85vh",
              background: "#fff",
              borderRadius: "16px",
              overflow: "hidden",
              border: "1px solid #e2e8f0",
              display: "flex",
              flexDirection: "column",
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div
              style={{
                background: "#020617",
                color: GOLD,
                padding: "12px 16px",
                fontWeight: 900,
              }}
            >
              Select Fees
            </div>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid #e2e8f0" }}>
              <input
                type="text"
                placeholder="Search fees..."
                value={feeSearch}
                onChange={(event) => setFeeSearch(event.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: "10px",
                  border: "1px solid #cbd5e1",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ overflow: "auto", flex: 1 }}>
              {filteredFees.length === 0 ? (
                <div style={{ padding: "24px", textAlign: "center", color: "#64748b" }}>
                  {allFees.length === 0
                    ? "No fee structures found for this school."
                    : "No fees match your search."}
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: 48 }} />
                      <th style={th}>Description</th>
                      <th style={th}>Type</th>
                      <th style={th}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFees.map((fee) => (
                      <tr key={fee.id}>
                        <td style={td}>
                          <input
                            type="checkbox"
                            checked={selectedFeeIds.has(fee.id)}
                            onChange={(event) => toggleFeeSelected(fee.id, event.target.checked)}
                          />
                        </td>
                        <td style={td}>{fee.description}</td>
                        <td style={td}>{fee.type}</td>
                        <td style={td}>{money(fee.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div
              style={{
                padding: "13px 16px",
                borderTop: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                gap: "8px",
              }}
            >
              <button type="button" style={btnLight} onClick={() => setShowFeePicker(false)}>
                Cancel
              </button>
              <button
                type="button"
                style={btnGold}
                onClick={() => void handleAddSelectedFees()}
                disabled={saving}
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
