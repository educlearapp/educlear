import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMoney } from "../../billing/billingLedger";
import type { DepositRecord, OpenInvoice } from "../types/deposit";

type Props = {
  schoolId: string;
  depositId: string;
  saving: boolean;
  onClose: () => void;
  onLoad: (depositId: string) => Promise<{ deposit: DepositRecord; openInvoices: OpenInvoice[] }>;
  onAllocate: (
    depositId: string,
    allocations: { ledgerInvoiceId: string; amount: number }[]
  ) => Promise<void>;
};

type AllocateDraft = Record<string, string>;

export default function ManageDepositModal({
  schoolId,
  depositId,
  saving,
  onClose,
  onLoad,
  onAllocate,
}: Props) {
  const [deposit, setDeposit] = useState<DepositRecord | null>(null);
  const [openInvoices, setOpenInvoices] = useState<OpenInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [allocateDraft, setAllocateDraft] = useState<AllocateDraft>({});
  const [activeTab, setActiveTab] = useState<"allocate" | "history" | "transactions">("allocate");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await onLoad(depositId);
      setDeposit(result.deposit);
      setOpenInvoices(result.openInvoices);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load deposit");
    } finally {
      setLoading(false);
    }
  }, [depositId, onLoad]);

  useEffect(() => {
    void load();
  }, [load]);

  const allocations = useMemo(() => deposit?.allocations || [], [deposit]);
  const history = useMemo(() => deposit?.history || [], [deposit]);

  const pendingAllocations = useMemo(() => {
    return openInvoices
      .map((inv) => {
        const amount = Number(allocateDraft[inv.ledgerInvoiceId] || 0);
        if (!Number.isFinite(amount) || amount <= 0) return null;
        return { ledgerInvoiceId: inv.ledgerInvoiceId, amount };
      })
      .filter(Boolean) as { ledgerInvoiceId: string; amount: number }[];
  }, [allocateDraft, openInvoices]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const handleAllocate = async () => {
    if (!pendingAllocations.length) {
      setError("Enter allocation amounts for at least one invoice.");
      return;
    }
    setError("");
    try {
      await onAllocate(depositId, pendingAllocations);
      setAllocateDraft({});
      await load();
      setActiveTab("transactions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to allocate deposit");
    }
  };

  const canAllocate = (deposit?.remainingBalance || 0) > 0 && deposit?.status !== "VOID" && deposit?.status !== "REFUNDED";

  return (
    <div className="billing-deposits-modal-overlay" role="presentation" onClick={handleBackdropClick}>
      <div
        className="billing-deposits-modal billing-deposits-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-deposits-manage-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="billing-deposits-modal-accent" aria-hidden="true" />
        <div className="billing-deposits-manage-header">
          <div>
            <h2 id="billing-deposits-manage-title" className="billing-deposits-modal-title">
              Manage Deposit
            </h2>
            {deposit ? (
              <p className="billing-deposits-manage-sub">
                {deposit.depositNumber} · {deposit.learnerName} · {deposit.account}
              </p>
            ) : null}
          </div>
          <button type="button" className="billing-deposits-btn billing-deposits-btn--outline billing-deposits-btn--on-dark" onClick={onClose}>
            Close
          </button>
        </div>

        {loading ? <p className="billing-deposits-manage-loading">Loading deposit…</p> : null}
        {error ? <p className="billing-deposits-form-error">{error}</p> : null}

        {deposit && !loading ? (
          <>
            <div className="billing-deposits-manage-summary">
              <div>
                <span className="billing-deposits-summary-label">Amount</span>
                <strong>{formatMoney(deposit.amount)}</strong>
              </div>
              <div>
                <span className="billing-deposits-summary-label">Remaining Balance</span>
                <strong>{formatMoney(deposit.remainingBalance)}</strong>
              </div>
              <div>
                <span className="billing-deposits-summary-label">Status</span>
                <span className={`billing-deposits-status billing-deposits-status--${deposit.status.toLowerCase()}`}>
                  {deposit.statusLabel}
                </span>
              </div>
            </div>

            <div className="billing-deposits-tabs" role="tablist">
              <button type="button" role="tab" className={activeTab === "allocate" ? "active" : ""} onClick={() => setActiveTab("allocate")} disabled={!canAllocate}>
                Allocate to Invoices
              </button>
              <button type="button" role="tab" className={activeTab === "history" ? "active" : ""} onClick={() => setActiveTab("history")}>
                Deposit History
              </button>
              <button type="button" role="tab" className={activeTab === "transactions" ? "active" : ""} onClick={() => setActiveTab("transactions")}>
                Linked Transactions
              </button>
            </div>

            {activeTab === "allocate" ? (
              <div className="billing-deposits-manage-panel" role="tabpanel">
                {!canAllocate ? (
                  <p className="billing-deposits-manage-note">This deposit has no remaining balance to allocate.</p>
                ) : openInvoices.length === 0 ? (
                  <p className="billing-deposits-manage-note">No open invoices found for this learner.</p>
                ) : (
                  <div className="billing-deposits-allocate-table-wrap">
                    <table className="billing-deposits-allocate-table">
                      <thead>
                        <tr>
                          <th>Invoice</th>
                          <th>Date</th>
                          <th>Amount</th>
                          <th>Allocate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {openInvoices.map((inv) => (
                          <tr key={inv.ledgerInvoiceId}>
                            <td>{inv.invoiceReference || inv.ledgerInvoiceId}</td>
                            <td>{inv.invoiceDate}</td>
                            <td>{formatMoney(inv.amount)}</td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="billing-deposits-input billing-deposits-input--dark billing-deposits-input--compact"
                                value={allocateDraft[inv.ledgerInvoiceId] || ""}
                                disabled={saving}
                                onChange={(e) =>
                                  setAllocateDraft((prev) => ({
                                    ...prev,
                                    [inv.ledgerInvoiceId]: e.target.value,
                                  }))
                                }
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {canAllocate && openInvoices.length > 0 ? (
                  <div className="billing-deposits-modal-actions">
                    <button type="button" className="billing-deposits-btn billing-deposits-btn--gold" disabled={saving} onClick={() => void handleAllocate()}>
                      {saving ? "Saving…" : "Apply Allocation"}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeTab === "history" ? (
              <div className="billing-deposits-manage-panel" role="tabpanel">
                {history.length === 0 ? (
                  <p className="billing-deposits-manage-note">No history entries yet.</p>
                ) : (
                  <ul className="billing-deposits-history-list">
                    {history.map((entry) => (
                      <li key={entry.id}>
                        <div>
                          <strong>{entry.action}</strong>
                          <span>{new Date(entry.createdAt).toLocaleString()}</span>
                        </div>
                        <p>{entry.description}</p>
                        {entry.amount != null ? <span>{formatMoney(entry.amount)}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            {activeTab === "transactions" ? (
              <div className="billing-deposits-manage-panel" role="tabpanel">
                {allocations.length === 0 ? (
                  <p className="billing-deposits-manage-note">No linked transactions yet.</p>
                ) : (
                  <div className="billing-deposits-allocate-table-wrap">
                    <table className="billing-deposits-allocate-table">
                      <thead>
                        <tr>
                          <th>Invoice</th>
                          <th>Date</th>
                          <th>Amount</th>
                          <th>Allocated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allocations.map((row) => (
                          <tr key={row.id}>
                            <td>{row.invoiceReference || row.ledgerInvoiceId}</td>
                            <td>{row.invoiceDate || "—"}</td>
                            <td>—</td>
                            <td>{formatMoney(row.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
