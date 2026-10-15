import React, { useMemo, useState } from "react";
import {
  clearAllLearnerIds,
  clearFilteredLearnerIds,
  filterLearnersForBulkAdd,
  selectAllFilteredLearnerIds,
  uniqueClassrooms,
  type BulkAddLearner,
} from "./billingPlansBulkAddFees";
import {
  addOnceOffFeeToLearners,
  removeOnceOffFeeFromAllLearners,
  summariseOnceOffFees,
  validateOnceOffFee,
  type InvoiceRunExtraFee,
} from "./invoiceRunList";

export type OnceOffFeeLearner = {
  id: string;
  name: string;
  surname: string;
  classroom: string;
  accountNo: string;
};

type Props = {
  open: boolean;
  learners: OnceOffFeeLearner[];
  extraFeesByLearnerId: Record<string, InvoiceRunExtraFee[]> | undefined;
  onApply: (next: Record<string, InvoiceRunExtraFee[]>) => void;
  onClose: () => void;
};

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
  width: 900,
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

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #e2e8f0",
  boxSizing: "border-box",
};

export default function InvoiceRunOnceOffFeeModal({
  open,
  learners,
  extraFeesByLearnerId,
  onApply,
  onClose,
}: Props) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [search, setSearch] = useState("");
  const [classroomFilter, setClassroomFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const asBulkLearners: BulkAddLearner[] = useMemo(
    () =>
      learners.map((l) => ({
        id: l.id,
        name: l.name,
        surname: l.surname,
        classroom: l.classroom,
        billingPlan: [],
      })),
    [learners]
  );
  const accountById = useMemo(() => new Map(learners.map((l) => [l.id, l.accountNo])), [learners]);
  const classrooms = useMemo(() => uniqueClassrooms(asBulkLearners), [asBulkLearners]);
  const filtered = useMemo(
    () => filterLearnersForBulkAdd(asBulkLearners, search, classroomFilter),
    [asBulkLearners, search, classroomFilter]
  );
  const existing = useMemo(() => summariseOnceOffFees(extraFeesByLearnerId), [extraFeesByLearnerId]);

  if (!open) return null;

  const resetAndClose = () => {
    setDescription("");
    setAmount("");
    setSearch("");
    setClassroomFilter("all");
    setSelectedIds(new Set());
    setError("");
    setNotice("");
    onClose();
  };

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const apply = () => {
    const validation = validateOnceOffFee(description, amount);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    if (!selectedIds.size) {
      setError("Select at least one learner.");
      return;
    }
    const result = addOnceOffFeeToLearners(extraFeesByLearnerId, Array.from(selectedIds), validation.fee);
    onApply(result.extraFeesByLearnerId);
    setError("");
    setSelectedIds(new Set());
    setNotice(
      `${validation.fee.feeDescription} (${money(validation.fee.amount)}) added to ${result.added.length} learner(s) for this run only.` +
        (result.skippedDuplicate.length
          ? ` ${result.skippedDuplicate.length} already had this fee and were skipped.`
          : "")
    );
  };

  const remove = (fee: InvoiceRunExtraFee) => {
    const result = removeOnceOffFeeFromAllLearners(extraFeesByLearnerId, fee);
    onApply(result.extraFeesByLearnerId);
    setNotice(`${fee.feeDescription} removed from ${result.removedFrom} learner(s).`);
  };

  return (
    <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Add once-off fee to selected learners">
      <div style={panelStyle}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0", background: "#0f172a", color: "#f8fafc" }}>
          <div style={{ fontSize: 20, fontWeight: 900 }}>Add Once-off Fee To Selected Learners</div>
          <div style={{ marginTop: 4, color: "#cbd5e1", fontSize: 13 }}>
            Charged on this invoice run only. Billing plans are not changed, so the fee will not repeat next month.
          </div>
        </div>

        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10, marginBottom: 12 }}>
            <input
              placeholder="Fee description (e.g. JAMF Fee)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={inputStyle}
            />
            <input
              placeholder="Amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div style={{ fontWeight: 800, marginBottom: 8 }}>
            Learners on this run ({selectedIds.size} selected)
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <input
              type="search"
              placeholder="Search name / surname"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...inputStyle, flex: 1, minWidth: 160 }}
            />
            <select
              value={classroomFilter}
              onChange={(e) => setClassroomFilter(e.target.value)}
              style={{ ...inputStyle, minWidth: 140 }}
            >
              <option value="all">All classrooms</option>
              {classrooms.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button type="button" style={btnLight} onClick={() => setSelectedIds(selectAllFilteredLearnerIds(filtered, selectedIds))}>
              Select All (filtered)
            </button>
            <button type="button" style={btnLight} onClick={() => setSelectedIds(clearFilteredLearnerIds(filtered, selectedIds))}>
              Clear filtered
            </button>
            <button type="button" style={btnLight} onClick={() => setSelectedIds(clearAllLearnerIds())}>
              Clear Selection
            </button>
          </div>
          <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, maxHeight: 300, overflow: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 16, color: "#64748b" }}>No learners match the current filter.</div>
            ) : (
              filtered.map((learner) => (
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
                  <input type="checkbox" checked={selectedIds.has(learner.id)} onChange={() => toggle(learner.id)} />
                  <span style={{ fontWeight: 700 }}>
                    {learner.name} {learner.surname}
                  </span>
                  <span style={{ color: "#64748b", fontSize: 12 }}>
                    {accountById.get(learner.id) || ""} {learner.classroom ? `· ${learner.classroom}` : ""}
                  </span>
                </label>
              ))
            )}
          </div>

          {existing.length ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Once-off fees on this run</div>
              {existing.map((row) => (
                <div
                  key={`${row.fee.feeDescription}-${row.fee.amount}`}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #f1f5f9" }}
                >
                  <span>
                    <strong>{row.fee.feeDescription}</strong> — {money(row.fee.amount)} × {row.learnerCount} learner(s)
                  </span>
                  <button type="button" style={btnLight} onClick={() => remove(row.fee)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {error ? (
            <p style={{ marginTop: 12, color: "#b91c1c", fontWeight: 800 }} role="alert">
              {error}
            </p>
          ) : null}
          {notice ? <p style={{ marginTop: 12, color: "#166534", fontWeight: 800 }}>{notice}</p> : null}
        </div>

        <div style={{ padding: "12px 16px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", gap: 8 }}>
          <button type="button" style={btnLight} onClick={resetAndClose}>
            Done
          </button>
          <button type="button" style={btnGold} onClick={apply}>
            Add Fee To Selected Learners
          </button>
        </div>
      </div>
    </div>
  );
}
