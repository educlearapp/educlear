import React, { useState } from "react";
import {
  appendPenaltyTransaction,
  formatMoney,
  normaliseBillingAmount,
  notifyBillingUpdated,
} from "./billingLedger";
import { applyLatePenalties, previewLatePenalties, syncBillingLedgerFromApi } from "./billingApi";

type PreviewRow = {
  learnerId: string;
  accountNo: string;
  learnerName: string;
  balance: number;
  overdueAmount: number;
  excludedNotYetDue: number;
  penaltyAmount: number;
  apply: boolean;
  duplicate?: boolean;
};

type Props = {
  schoolId: string;
  learners: any[];
  statementRows: any[];
  onClose: () => void;
  onApplied: () => void;
};

const GOLD = "#d4af37";
const INK = "#111827";

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.55)",
  zIndex: 5000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
};

const panel: React.CSSProperties = {
  background: "#fff",
  border: `2px solid ${GOLD}`,
  borderRadius: 14,
  width: "min(1100px, 100%)",
  maxHeight: "92vh",
  overflow: "auto",
  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  fontWeight: 600,
};

const goldBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "1px solid #b89329",
  background: "linear-gradient(135deg, #f7d56a, #d4af37)",
  color: INK,
  fontWeight: 900,
  cursor: "pointer",
};

export default function LatePenaltyFine({ schoolId, learners, onClose, onApplied }: Props) {
  const today = new Date().toISOString().slice(0, 10);
  const [penaltyAmount, setPenaltyAmount] = useState(300);
  const [description, setDescription] = useState("Late payment penalty");
  const [penaltyDate, setPenaltyDate] = useState(today);
  const [dueDateCutoff, setDueDateCutoff] = useState(today);
  const [applyToAll, setApplyToAll] = useState(true);
  const [excludeNotYetDue, setExcludeNotYetDue] = useState(true);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const handlePreview = async () => {
    setLoading(true);
    try {
      const res = await previewLatePenalties({
        schoolId,
        penaltyAmount,
        description,
        penaltyDate,
        dueDateCutoff,
        excludeNotYetDue,
        applyTo: applyToAll ? "all" : "selected",
      });
      const rows = Array.isArray(res?.rows) ? res.rows : [];
      setPreviewRows(
        rows.map((r: any) => ({
          learnerId: String(r.learnerId),
          accountNo: String(r.accountNo),
          learnerName: String(r.learnerName || ""),
          balance: normaliseBillingAmount(r.balance),
          overdueAmount: normaliseBillingAmount(r.overdueAmount),
          excludedNotYetDue: normaliseBillingAmount(r.excludedNotYetDue),
          penaltyAmount: normaliseBillingAmount(r.penaltyAmount ?? penaltyAmount),
          apply: r.duplicate ? false : r.apply !== false,
          duplicate: Boolean(r.duplicate),
        }))
      );
      setShowPreview(true);
    } catch (e: any) {
      alert(e?.message || "Preview failed.");
    } finally {
      setLoading(false);
    }
  };

  const toggleApply = (accountNo: string) => {
    setPreviewRows((rows) =>
      rows.map((r) => (r.accountNo === accountNo ? { ...r, apply: !r.apply } : r))
    );
  };

  const handleApply = async () => {
    const selected = previewRows.filter((r) => r.apply && !r.duplicate);
    if (!selected.length) {
      alert("Select at least one account to apply the penalty.");
      return;
    }
    setApplying(true);
    try {
      await applyLatePenalties({
        schoolId,
        penaltyAmount,
        description,
        penaltyDate,
        dueDate: dueDateCutoff,
        reference: `PEN-${penaltyDate}`,
        accounts: selected.map((r) => ({
          learnerId: r.learnerId,
          accountNo: r.accountNo,
          apply: true,
        })),
      });

      for (const row of selected) {
        appendPenaltyTransaction({
          schoolId,
          learnerId: row.learnerId,
          accountNo: row.accountNo,
          amount: row.penaltyAmount,
          date: penaltyDate,
          dueDate: dueDateCutoff,
          description,
          reference: `PEN-${penaltyDate}`,
        });
      }

      await syncBillingLedgerFromApi(schoolId).catch(() => {});
      notifyBillingUpdated();
      alert(`Late penalty applied to ${selected.length} account(s).`);
      onApplied();
    } catch (e: any) {
      alert(e?.message || "Failed to apply penalty.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div style={overlay}>
      <div style={panel}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${GOLD}`, background: INK, color: GOLD }}>
          <div style={{ fontWeight: 900, fontSize: 20 }}>Late Penalty Fine</div>
        </div>

        <div style={{ padding: 24, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
          <label>
            Penalty amount (R)
            <input
              type="number"
              min={0}
              style={fieldStyle}
              value={penaltyAmount}
              onChange={(e) => setPenaltyAmount(normaliseBillingAmount(e.target.value))}
            />
          </label>
          <label>
            Penalty date
            <input type="date" style={fieldStyle} value={penaltyDate} onChange={(e) => setPenaltyDate(e.target.value)} />
          </label>
          <label style={{ gridColumn: "span 2" }}>
            Description
            <input style={fieldStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label>
            Due date cutoff
            <input
              type="date"
              style={fieldStyle}
              value={dueDateCutoff}
              onChange={(e) => setDueDateCutoff(e.target.value)}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 8, justifyContent: "flex-end" }}>
            Apply to
            <div style={{ display: "flex", gap: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="radio" checked={applyToAll} onChange={() => setApplyToAll(true)} />
                All overdue accounts
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="radio" checked={!applyToAll} onChange={() => setApplyToAll(false)} />
                Selected accounts only
              </label>
            </div>
          </label>
          <label style={{ gridColumn: "span 2", display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={excludeNotYetDue}
              onChange={(e) => setExcludeNotYetDue(e.target.checked)}
            />
            Exclude fees not yet due
          </label>
        </div>

        <div style={{ padding: "0 24px 16px", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" style={goldBtn} onClick={handlePreview} disabled={loading}>
            {loading ? "Loading…" : "Preview Affected Accounts"}
          </button>
          <button type="button" style={goldBtn} onClick={onClose}>
            Cancel
          </button>
        </div>

        {showPreview && (
          <div style={{ padding: "0 24px 24px" }}>
            <div style={{ overflowX: "auto", border: `1px solid ${GOLD}`, borderRadius: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                <thead>
                  <tr style={{ background: "rgba(212,175,55,0.16)" }}>
                    {[
                      "Account No",
                      "Learner",
                      "Balance",
                      "Overdue Amount",
                      "Excluded Not-Yet-Due",
                      "Penalty Amount",
                      "Apply",
                    ].map((h) => (
                      <th key={h} style={{ padding: 12, textAlign: "left", fontSize: 12, fontWeight: 900 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
                        No overdue accounts match your criteria.
                      </td>
                    </tr>
                  ) : (
                    previewRows.map((row) => (
                      <tr key={row.accountNo}>
                        <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9", fontWeight: 800 }}>
                          {row.accountNo}
                        </td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{row.learnerName}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{formatMoney(row.balance)}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>
                          {formatMoney(row.overdueAmount)}
                        </td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>
                          {formatMoney(row.excludedNotYetDue)}
                        </td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>
                          {formatMoney(row.penaltyAmount)}
                        </td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>
                          <input
                            type="checkbox"
                            checked={row.apply}
                            disabled={row.duplicate}
                            onChange={() => toggleApply(row.accountNo)}
                          />
                          {row.duplicate ? " (exists)" : ""}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" style={goldBtn} onClick={handleApply} disabled={applying || !previewRows.length}>
                {applying ? "Applying…" : "Apply Penalty"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
