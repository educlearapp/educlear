import { useCallback, useMemo, useState } from "react";
import DepositsStubModal from "../billingDeposits/components/DepositsStubModal";
import { useSchoolId } from "../useSchoolId";
import "./BillingDepositsPage.css";

type DepositModal = "receive" | "return" | null;

const PAGE_SIZE = 10;

export default function BillingDepositsPage() {
  const schoolId = useSchoolId();
  const [groupFilter, setGroupFilter] = useState("");
  const [classroomFilter, setClassroomFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<DepositModal>(null);

  const records: never[] = useMemo(() => [], []);

  const filteredCount = useMemo(() => {
    void groupFilter;
    void classroomFilter;
    void search;
    return records.length;
  }, [groupFilter, classroomFilter, search, records.length]);

  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE) || 1);
  const safePage = Math.min(page, totalPages);

  const handleReceive = useCallback(() => setModal("receive"), []);
  const handleReturn = useCallback(() => setModal("return"), []);

  const closeModal = useCallback(() => setModal(null), []);

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
          <p className="billing-deposits-subtitle">Receive and return deposits</p>
        </div>
        <div className="billing-deposits-header-actions">
          <button type="button" className="billing-deposits-btn billing-deposits-btn--gold" onClick={handleReceive}>
            Receive
          </button>
          <button type="button" className="billing-deposits-btn billing-deposits-btn--outline" onClick={handleReturn}>
            Return
          </button>
        </div>
      </header>

      <section className="billing-deposits-filters" aria-label="Deposit filters">
        <div className="billing-deposits-filter">
          <label className="billing-deposits-filter-label" htmlFor={`${schoolId}-deposit-group`}>
            Group
          </label>
          <select
            id={`${schoolId}-deposit-group`}
            className="billing-deposits-select"
            value={groupFilter}
            onChange={(e) => {
              setGroupFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Groups</option>
          </select>
        </div>

        <div className="billing-deposits-filter">
          <label className="billing-deposits-filter-label" htmlFor={`${schoolId}-deposit-classroom`}>
            Classroom
          </label>
          <select
            id={`${schoolId}-deposit-classroom`}
            className="billing-deposits-select"
            value={classroomFilter}
            onChange={(e) => {
              setClassroomFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All Classrooms</option>
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
            placeholder="Search by name or account…"
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </section>

      <section className="billing-deposits-table-card" aria-label="Deposits list">
        <div className="billing-deposits-table-wrap">
          <table className="billing-deposits-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Surname</th>
                <th scope="col">Classroom</th>
                <th scope="col" className="billing-deposits-th--amount">
                  Deposit Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredCount === 0 ? (
                <tr>
                  <td colSpan={4} className="billing-deposits-empty">
                    No deposit records to display.
                  </td>
                </tr>
              ) : null}
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
          <span className="billing-deposits-record-count">Showing {filteredCount} records</span>
        </footer>
      </section>

      {modal === "receive" ? (
        <DepositsStubModal title="Coming Soon" message="Receive deposit coming soon." onClose={closeModal} />
      ) : null}
      {modal === "return" ? (
        <DepositsStubModal title="Coming Soon" message="Return deposit coming soon." onClose={closeModal} />
      ) : null}
    </div>
  );
}
