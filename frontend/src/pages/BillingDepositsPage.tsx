import { useCallback, useEffect, useMemo, useState } from "react";
import AddDepositModal from "../billingDeposits/components/AddDepositModal";
import ManageDepositModal from "../billingDeposits/components/ManageDepositModal";
import { useDeposits } from "../billingDeposits/hooks/useDeposits";
import type { DepositRecord } from "../billingDeposits/types/deposit";
import { formatMoney } from "../billing/billingLedger";
import { useSchoolId } from "../useSchoolId";
import "./BillingDepositsPage.css";

const PAGE_SIZE = 10;

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "ACTIVE", label: "Active" },
  { value: "PARTIALLY_ALLOCATED", label: "Partially Allocated" },
  { value: "FULLY_ALLOCATED", label: "Fully Allocated" },
  { value: "REFUNDED", label: "Refunded" },
  { value: "VOID", label: "Void" },
];

export default function BillingDepositsPage() {
  const schoolId = useSchoolId();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { deposits, loading, error, loadDeposits, saveDeposit, loadDepositDetail, allocateDeposit } =
    useDeposits(schoolId || "");

  useEffect(() => {
    if (!schoolId) return;
    const timer = window.setTimeout(() => {
      void loadDeposits({ search: search.trim(), status: statusFilter });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [schoolId, search, statusFilter, loadDeposits]);

  const filteredCount = deposits.length;
  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return deposits.slice(start, start + PAGE_SIZE);
  }, [deposits, safePage]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const handleSaveDeposit = useCallback(
    async (payload: Record<string, unknown>) => {
      setSaving(true);
      try {
        await saveDeposit(payload);
      } finally {
        setSaving(false);
      }
    },
    [saveDeposit]
  );

  const handleAllocate = useCallback(
    async (depositId: string, allocations: { ledgerInvoiceId: string; amount: number }[]) => {
      setSaving(true);
      try {
        await allocateDeposit(depositId, allocations);
      } finally {
        setSaving(false);
      }
    },
    [allocateDeposit]
  );

  if (!schoolId) {
    return (
      <div className="billing-deposits-page">
        <h1 className="page-title">Deposits</h1>
        <p className="billing-deposits-subtitle">Loading school context…</p>
      </div>
    );
  }

  return (
    <div className="billing-deposits-page">
      <header className="billing-deposits-header">
        <div className="billing-deposits-header-main">
          <h1 className="page-title">Deposits</h1>
          <p className="billing-deposits-subtitle">Receive deposits and allocate them to invoices</p>
        </div>
        <div className="billing-deposits-header-actions">
          <button
            type="button"
            className="billing-deposits-btn billing-deposits-btn--gold"
            onClick={() => setShowAdd(true)}
          >
            Add Deposit
          </button>
        </div>
      </header>

      <section className="billing-deposits-filters" aria-label="Deposit filters">
        <div className="billing-deposits-filter">
          <label className="billing-deposits-filter-label" htmlFor={`${schoolId}-deposit-status`}>
            Filter
          </label>
          <select
            id={`${schoolId}-deposit-status`}
            className="billing-deposits-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value || "all"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="billing-deposits-filter billing-deposits-filter--search">
          <label className="billing-deposits-filter-label" htmlFor={`${schoolId}-deposit-search`}>
            Search
          </label>
          <input
            id={`${schoolId}-deposit-search`}
            type="search"
            className="billing-deposits-input"
            value={search}
            placeholder="Deposit number, account, learner…"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </section>

      {error ? <p className="billing-deposits-page-error">{error}</p> : null}
      {loading ? <p className="billing-deposits-page-loading">Loading deposits…</p> : null}

      <section className="billing-deposits-table-card" aria-label="Deposits list">
        <div className="billing-deposits-table-wrap">
          <table className="billing-deposits-table">
            <thead>
              <tr>
                <th scope="col">Deposit Number</th>
                <th scope="col">Account</th>
                <th scope="col">Learner</th>
                <th scope="col" className="billing-deposits-th--amount">
                  Amount
                </th>
                <th scope="col" className="billing-deposits-th--amount">
                  Remaining Balance
                </th>
                <th scope="col">Status</th>
                <th scope="col">Date</th>
                <th scope="col" className="billing-deposits-th--actions">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {!loading && pageRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="billing-deposits-empty">
                    No deposits found. Use Add Deposit to record one.
                  </td>
                </tr>
              ) : (
                pageRows.map((row: DepositRecord) => (
                  <tr key={row.id}>
                    <td>{row.depositNumber}</td>
                    <td>{row.account}</td>
                    <td>{row.learnerName}</td>
                    <td className="billing-deposits-td--amount">{formatMoney(row.amount)}</td>
                    <td className="billing-deposits-td--amount">{formatMoney(row.remainingBalance)}</td>
                    <td>
                      <span
                        className={`billing-deposits-status billing-deposits-status--${row.status.toLowerCase()}`}
                      >
                        {row.statusLabel}
                      </span>
                    </td>
                    <td>{row.date}</td>
                    <td className="billing-deposits-td--actions">
                      <button
                        type="button"
                        className="billing-deposits-manage-btn"
                        onClick={() => setManageId(row.id)}
                      >
                        Manage
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <footer className="billing-deposits-pagination" aria-label="Deposits pagination">
          <button
            type="button"
            className="billing-deposits-page-btn"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <span className="billing-deposits-page-info">
            Page {safePage} of {totalPages}
          </span>
          <button
            type="button"
            className="billing-deposits-page-btn"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
          <span className="billing-deposits-record-count">
            Showing {pageRows.length} of {filteredCount} records
          </span>
        </footer>
      </section>

      {showAdd ? (
        <AddDepositModal
          schoolId={schoolId}
          saving={saving}
          onClose={() => setShowAdd(false)}
          onSave={handleSaveDeposit}
        />
      ) : null}

      {manageId ? (
        <ManageDepositModal
          schoolId={schoolId}
          depositId={manageId}
          saving={saving}
          onClose={() => setManageId(null)}
          onLoad={loadDepositDetail}
          onAllocate={handleAllocate}
        />
      ) : null}
    </div>
  );
}
