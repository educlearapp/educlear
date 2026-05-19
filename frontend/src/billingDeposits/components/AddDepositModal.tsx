import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { fetchLearnersForDeposits } from "../api/depositsApi";
import type { DepositAccountOption, DepositLearnerOption } from "../types/deposit";

type Props = {
  schoolId: string;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function AddDepositModal({ schoolId, saving, onClose, onSave }: Props) {
  const [familyAccountId, setFamilyAccountId] = useState("");
  const [learnerId, setLearnerId] = useState("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [depositDate, setDepositDate] = useState(todayIso);
  const [formError, setFormError] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [learners, setLearners] = useState<DepositLearnerOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingOptions(true);
      try {
        const rows = await fetchLearnersForDeposits(schoolId);
        if (cancelled) return;
        const mapped: DepositLearnerOption[] = rows
          .map((row: Record<string, unknown>) => {
            const id = String(row.id || "").trim();
            if (!id) return null;
            const family = row.familyAccount as Record<string, unknown> | null | undefined;
            const rowFamilyAccountId = String(row.familyAccountId || family?.id || "").trim() || null;
            const accountNo = String(family?.accountRef || "").trim();
            const firstName = String(row.firstName || "").trim();
            const lastName = String(row.lastName || "").trim();
            const label = `${firstName} ${lastName}`.trim() || id;
            return { id, familyAccountId: rowFamilyAccountId, accountNo, label };
          })
          .filter(Boolean) as DepositLearnerOption[];
        setLearners(mapped);
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    })();
    return () => { cancelled = true; };
  }, [schoolId]);

  const accounts = useMemo<DepositAccountOption[]>(() => {
    const map = new Map<string, DepositAccountOption>();
    for (const learner of learners) {
      if (!learner.familyAccountId || !learner.accountNo) continue;
      if (!map.has(learner.familyAccountId)) {
        map.set(learner.familyAccountId, {
          familyAccountId: learner.familyAccountId,
          accountNo: learner.accountNo,
          label: learner.accountNo,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [learners]);

  const filteredLearners = useMemo(() => {
    if (!familyAccountId) return learners;
    return learners.filter((l) => l.familyAccountId === familyAccountId);
  }, [familyAccountId, learners]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      setFormError("");
      const parsedAmount = Number(amount);
      if (!familyAccountId) { setFormError("Select an account."); return; }
      if (!learnerId) { setFormError("Select a learner."); return; }
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        setFormError("Enter a valid amount greater than zero.");
        return;
      }
      if (!depositDate) { setFormError("Select a deposit date."); return; }
      try {
        await onSave({
          familyAccountId,
          learnerId,
          amount: parsedAmount,
          reference: reference.trim(),
          notes: notes.trim(),
          depositDate,
        });
        onClose();
      } catch (err) {
        setFormError(err instanceof Error ? err.message : "Failed to save deposit");
      }
    },
    [amount, depositDate, familyAccountId, learnerId, notes, onClose, onSave, reference]
  );

  return (
    <div className="billing-deposits-modal-overlay" role="presentation" onClick={handleBackdropClick}>
      <div
        className="billing-deposits-modal billing-deposits-modal--form"
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-deposits-add-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="billing-deposits-modal-accent" aria-hidden="true" />
        <h2 id="billing-deposits-add-title" className="billing-deposits-modal-title">Add Deposit</h2>
        <form className="billing-deposits-form" onSubmit={handleSubmit}>
          <label className="billing-deposits-field">
            <span className="billing-deposits-field-label">Select Account</span>
            <select className="billing-deposits-select billing-deposits-select--dark" value={familyAccountId} disabled={loadingOptions || saving} onChange={(e) => { setFamilyAccountId(e.target.value); setLearnerId(""); }} required>
              <option value="">Choose account…</option>
              {accounts.map((account) => (<option key={account.familyAccountId} value={account.familyAccountId}>{account.label}</option>))}
            </select>
          </label>
          <label className="billing-deposits-field">
            <span className="billing-deposits-field-label">Select Learner</span>
            <select className="billing-deposits-select billing-deposits-select--dark" value={learnerId} disabled={!familyAccountId || loadingOptions || saving} onChange={(e) => setLearnerId(e.target.value)} required>
              <option value="">Choose learner…</option>
              {filteredLearners.map((learner) => (<option key={learner.id} value={learner.id}>{learner.label}</option>))}
            </select>
          </label>
          <label className="billing-deposits-field">
            <span className="billing-deposits-field-label">Amount</span>
            <input type="number" min="0.01" step="0.01" className="billing-deposits-input billing-deposits-input--dark" value={amount} disabled={saving} onChange={(e) => setAmount(e.target.value)} required />
          </label>
          <label className="billing-deposits-field">
            <span className="billing-deposits-field-label">Reference</span>
            <input type="text" className="billing-deposits-input billing-deposits-input--dark" value={reference} disabled={saving} onChange={(e) => setReference(e.target.value)} />
          </label>
          <label className="billing-deposits-field">
            <span className="billing-deposits-field-label">Notes</span>
            <textarea className="billing-deposits-textarea billing-deposits-input--dark" rows={3} value={notes} disabled={saving} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <label className="billing-deposits-field">
            <span className="billing-deposits-field-label">Deposit Date</span>
            <input type="date" className="billing-deposits-input billing-deposits-input--dark" value={depositDate} disabled={saving} onChange={(e) => setDepositDate(e.target.value)} required />
          </label>
          {formError ? <p className="billing-deposits-form-error">{formError}</p> : null}
          <div className="billing-deposits-modal-actions billing-deposits-modal-actions--split">
            <button type="button" className="billing-deposits-btn billing-deposits-btn--outline billing-deposits-btn--on-dark" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="billing-deposits-btn billing-deposits-btn--gold" disabled={saving}>{saving ? "Saving…" : "Save Deposit"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
