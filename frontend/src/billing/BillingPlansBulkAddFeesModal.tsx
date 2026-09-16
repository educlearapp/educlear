import React, { useMemo, useState } from "react";
import {
  applyBulkAddFees,
  clearAllLearnerIds,
  clearFilteredLearnerIds,
  filterLearnersForBulkAdd,
  formatBulkAddSummaryMessage,
  selectAllFilteredLearnerIds,
  uniqueClassrooms,
  type BulkAddApplySummary,
  type BulkAddFee,
  type BulkAddLearner,
  type SavePlanFn,
  validateBulkAddSelection,
} from "./billingPlansBulkAddFees";

const money = (value: number) =>
  `R ${Number(value || 0).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.48)",
  zIndex: 9999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const panelStyle: React.CSSProperties = {
  width: 980,
  maxWidth: "96vw",
  maxHeight: "92vh",
  background: "#fff",
  borderRadius: 16,
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  border: "1px solid rgba(212,175,55,0.28)",
};

const btnGold: React.CSSProperties = {
  background: "linear-gradient(135deg,#d4af37,#b8860b)",
  color: "#111",
  border: "none",
  borderRadius: 10,
  padding: "10px 16px",
  fontWeight: 800,
  cursor: "pointer",
};

const btnLight: React.CSSProperties = {
  background: "#f8fafc",
  color: "#0f172a",
  border: "1px solid #e2e8f0",
  borderRadius: 10,
  padding: "10px 16px",
  fontWeight: 700,
  cursor: "pointer",
};

const btnDanger: React.CSSProperties = {
  background: "#fff1f2",
  color: "#9f1239",
  border: "1px solid #fecdd3",
  borderRadius: 10,
  padding: "10px 16px",
  fontWeight: 700,
  cursor: "pointer",
};

type Step = "select" | "confirm" | "result";

type Props = {
  open: boolean;
  onClose: () => void;
  learners: BulkAddLearner[];
  rawLearnersById: Map<string, any>;
  fees: BulkAddFee[];
  feesLoading?: boolean;
  savePlan: SavePlanFn;
  onApplied: () => Promise<void> | void;
};

export default function BillingPlansBulkAddFeesModal({
  open,
  onClose,
  learners,
  rawLearnersById,
  fees,
  feesLoading,
  savePlan,
  onApplied,
}: Props) {
  const [step, setStep] = useState<Step>("select");
  const [learnerSearch, setLearnerSearch] = useState("");
  const [classroomFilter, setClassroomFilter] = useState("all");
  const [feeSearch, setFeeSearch] = useState("");
  const [selectedLearnerIds, setSelectedLearnerIds] = useState<Set<string>>(
    () => new Set()
  );
  const [selectedFeeIds, setSelectedFeeIds] = useState<Set<string>>(
    () => new Set()
  );
  const [validationError, setValidationError] = useState("");
  const [applying, setApplying] = useState(false);
  const [summary, setSummary] = useState<BulkAddApplySummary | null>(null);

  const classrooms = useMemo(() => uniqueClassrooms(learners), [learners]);

  const filteredLearners = useMemo(
    () => filterLearnersForBulkAdd(learners, learnerSearch, classroomFilter),
    [learners, learnerSearch, classroomFilter]
  );

  const filteredFees = useMemo(() => {
    const q = feeSearch.trim().toLowerCase();
    if (!q) return fees;
    return fees.filter(
      (fee) =>
        fee.description.toLowerCase().includes(q) ||
        fee.type.toLowerCase().includes(q) ||
        String(fee.amount).includes(q)
    );
  }, [fees, feeSearch]);

  const selectedFees = useMemo(
    () => fees.filter((fee) => selectedFeeIds.has(fee.id)),
    [fees, selectedFeeIds]
  );

  const selectedLearners = useMemo(
    () => learners.filter((l) => selectedLearnerIds.has(l.id)),
    [learners, selectedLearnerIds]
  );

  if (!open) return null;

  const toggleLearner = (id: string) => {
    setSelectedLearnerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFee = (id: string) => {
    setSelectedFeeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const goConfirm = () => {
    const validation = validateBulkAddSelection(
      Array.from(selectedLearnerIds),
      selectedFees
    );
    if (!validation.ok) {
      setValidationError(validation.error);
      return;
    }
    setValidationError("");
    setStep("confirm");
  };

  const apply = async () => {
    const validation = validateBulkAddSelection(
      Array.from(selectedLearnerIds),
      selectedFees
    );
    if (!validation.ok) {
      setValidationError(validation.error);
      setStep("select");
      return;
    }

    setApplying(true);
    setValidationError("");
    try {
      const learnersById = new Map(
        learners.map((l) => [
          l.id,
          { ...l, raw: rawLearnersById.get(l.id) },
        ])
      );
      const result = await applyBulkAddFees({
        selectedLearnerIds: Array.from(selectedLearnerIds),
        learnersById,
        selectedFees,
        savePlan,
      });
      setSummary(result);
      setStep("result");
      if (result.successCount > 0) {
        await onApplied();
      }
    } finally {
      setApplying(false);
    }
  };

  const closeAndReset = () => {
    setStep("select");
    setLearnerSearch("");
    setClassroomFilter("all");
    setFeeSearch("");
    setSelectedLearnerIds(new Set());
    setSelectedFeeIds(new Set());
    setValidationError("");
    setSummary(null);
    setApplying(false);
    onClose();
  };

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Add fees to multiple learners">
      <div style={panelStyle}>
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid #e2e8f0",
            background: "#0f172a",
            color: "#f8fafc",
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 900 }}>Add Fees To Multiple</div>
          <div style={{ marginTop: 4, color: "#cbd5e1", fontSize: 13 }}>
            Select learners and fees, then confirm before applying to billing plans.
          </div>
        </div>

        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          {step === "select" ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 16,
                }}
              >
                <div>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>
                    Learners ({selectedLearnerIds.size} selected)
                  </div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    <input
                      type="search"
                      placeholder="Search name / surname"
                      value={learnerSearch}
                      onChange={(e) => setLearnerSearch(e.target.value)}
                      style={{
                        flex: 1,
                        minWidth: 160,
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid #e2e8f0",
                      }}
                    />
                    <select
                      value={classroomFilter}
                      onChange={(e) => setClassroomFilter(e.target.value)}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid #e2e8f0",
                        minWidth: 140,
                      }}
                    >
                      <option value="all">All classrooms</option>
                      {classrooms.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <button
                      type="button"
                      style={btnLight}
                      onClick={() =>
                        setSelectedLearnerIds(
                          selectAllFilteredLearnerIds(filteredLearners, selectedLearnerIds)
                        )
                      }
                    >
                      Select All (filtered)
                    </button>
                    <button
                      type="button"
                      style={btnLight}
                      onClick={() =>
                        setSelectedLearnerIds(
                          clearFilteredLearnerIds(filteredLearners, selectedLearnerIds)
                        )
                      }
                    >
                      Clear filtered
                    </button>
                    <button
                      type="button"
                      style={btnLight}
                      onClick={() => setSelectedLearnerIds(clearAllLearnerIds())}
                    >
                      Clear Selection
                    </button>
                  </div>
                  <div
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 12,
                      maxHeight: 360,
                      overflow: "auto",
                    }}
                  >
                    {filteredLearners.length === 0 ? (
                      <div style={{ padding: 16, color: "#64748b" }}>
                        No learners match the current filter.
                      </div>
                    ) : (
                      filteredLearners.map((learner) => {
                        const checked = selectedLearnerIds.has(learner.id);
                        return (
                          <label
                            key={learner.id}
                            style={{
                              display: "flex",
                              gap: 10,
                              alignItems: "center",
                              padding: "8px 12px",
                              borderBottom: "1px solid #f1f5f9",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleLearner(learner.id)}
                            />
                            <span style={{ fontWeight: 700 }}>
                              {learner.name} {learner.surname}
                            </span>
                            <span style={{ color: "#64748b", fontSize: 12 }}>
                              {learner.classroom}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
                    Showing {filteredLearners.length} of {learners.length} learners.
                    Select All only affects the filtered list.
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 800, marginBottom: 8 }}>
                    Fees ({selectedFeeIds.size} selected)
                  </div>
                  <input
                    type="search"
                    placeholder="Search fees"
                    value={feeSearch}
                    onChange={(e) => setFeeSearch(e.target.value)}
                    style={{
                      width: "100%",
                      marginBottom: 8,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                      boxSizing: "border-box",
                    }}
                  />
                  <div
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: 12,
                      maxHeight: 420,
                      overflow: "auto",
                    }}
                  >
                    {feesLoading ? (
                      <div style={{ padding: 16, color: "#64748b" }}>Loading fees…</div>
                    ) : filteredFees.length === 0 ? (
                      <div style={{ padding: 16, color: "#64748b" }}>No fees found.</div>
                    ) : (
                      filteredFees.map((fee) => {
                        const checked = selectedFeeIds.has(fee.id);
                        return (
                          <label
                            key={fee.id}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "24px 1fr auto",
                              gap: 8,
                              alignItems: "center",
                              padding: "8px 12px",
                              borderBottom: "1px solid #f1f5f9",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleFee(fee.id)}
                            />
                            <span>
                              <div style={{ fontWeight: 700 }}>{fee.description}</div>
                              <div style={{ fontSize: 12, color: "#64748b" }}>{fee.type}</div>
                            </span>
                            <span style={{ fontWeight: 800 }}>{money(fee.amount)}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {validationError ? (
                <p style={{ marginTop: 12, color: "#b91c1c", fontWeight: 800 }} role="alert">
                  {validationError}
                </p>
              ) : null}
            </>
          ) : null}

          {step === "confirm" ? (
            <div>
              <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>
                Confirm bulk add
              </div>
              <p style={{ marginTop: 0, color: "#334155" }}>
                You are about to add <strong>{selectedFees.length}</strong> fee(s) to{" "}
                <strong>{selectedLearners.length}</strong> learner billing plan(s).
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>
                    Selected learners ({selectedLearners.length})
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 220, overflow: "auto" }}>
                    {selectedLearners.map((l) => (
                      <li key={l.id}>
                        {l.name} {l.surname}
                        {l.classroom ? ` — ${l.classroom}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div style={{ fontWeight: 800, marginBottom: 6 }}>
                    Selected fees ({selectedFees.length})
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 220, overflow: "auto" }}>
                    {selectedFees.map((fee) => (
                      <li key={fee.id}>
                        {fee.description} ({fee.type}) — {money(fee.amount)}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <p style={{ marginTop: 14, color: "#64748b", fontSize: 13 }}>
                Intended action: append these fees to each selected learner&apos;s existing
                billing plan (same behaviour as single-learner Add Fee). Duplicate fee lines
                are not blocked by the current single-add flow.
              </p>
            </div>
          ) : null}

          {step === "result" && summary ? (
            <div>
              <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 8 }}>
                {summary.outcome === "COMPLETE"
                  ? "Bulk add complete"
                  : summary.outcome === "PARTIAL"
                    ? "Bulk add partially completed"
                    : "Bulk add finished with errors"}
              </div>
              <p style={{ fontWeight: 800 }}>{formatBulkAddSummaryMessage(summary)}</p>
              <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
                <span>Succeeded: {summary.successCount}</span>
                <span>Skipped: {summary.skippedCount}</span>
                <span>Failed: {summary.failedCount}</span>
              </div>
              {(summary.failedCount > 0 || summary.skippedCount > 0) && (
                <div
                  style={{
                    border: "1px solid #fecdd3",
                    background: "#fff1f2",
                    borderRadius: 12,
                    maxHeight: 280,
                    overflow: "auto",
                    padding: 12,
                  }}
                >
                  {summary.results
                    .filter((r) => r.status !== "success")
                    .map((r) => (
                      <div key={r.learnerId} style={{ marginBottom: 8 }}>
                        <strong>{r.learnerLabel}</strong>: {r.status}
                        {r.reason ? ` — ${r.reason}` : ""}
                      </div>
                    ))}
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {step === "select" ? (
            <>
              <button type="button" style={btnLight} onClick={closeAndReset}>
                Cancel
              </button>
              <button type="button" style={btnGold} onClick={goConfirm}>
                Review &amp; Confirm
              </button>
            </>
          ) : null}
          {step === "confirm" ? (
            <>
              <button
                type="button"
                style={btnLight}
                onClick={() => setStep("select")}
                disabled={applying}
              >
                Back
              </button>
              <button
                type="button"
                style={btnDanger}
                onClick={apply}
                disabled={applying}
              >
                {applying ? "Applying…" : "Confirm & Apply Fees"}
              </button>
            </>
          ) : null}
          {step === "result" ? (
            <>
              <span />
              <button type="button" style={btnGold} onClick={closeAndReset}>
                Done
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
