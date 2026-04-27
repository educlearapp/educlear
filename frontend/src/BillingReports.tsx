import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSchoolId } from "./useSchoolId";

type ReportKey =
  | "Account List (Account Status)"
  | "Account List (Account Status) (Contact)"
  | "Account List (Age Analysis)"
  | "Billing Plan Summary By Child"
  | "Billing Plan Summary By Fee"
  | "Deposit List"
  | "Deposit Transaction List"
  | "Payment Receive List"
  | "Payments By Type"
  | "Sibling Accounts"
  | "Transaction List";

const REPORTS: ReportKey[] = [
  "Account List (Account Status)",
  "Account List (Account Status) (Contact)",
  "Account List (Age Analysis)",
  "Billing Plan Summary By Child",
  "Billing Plan Summary By Fee",
  "Deposit List",
  "Deposit Transaction List",
  "Payment Receive List",
  "Payments By Type",
  "Sibling Accounts",
  "Transaction List",
];

function isAccountListReport(name: string) {
  return name.startsWith("Account List");
}

function getSchoolNameFromStorage() {
  return (localStorage.getItem("schoolName") || "").trim();
}

function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 15, 15, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        zIndex: 50,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(720px, 100%)",
          background: "#ffffff",
          borderRadius: 16,
          border: "1px solid #ece7dc",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "16px 18px",
            borderBottom: "1px solid #eee7db",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 800 }}>{title}</div>
          <button className="btn-gold-light" onClick={onClose}>
            Close
          </button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  );
}

export default function BillingReports() {
  const navigate = useNavigate();
  const schoolId = useSchoolId();
  const schoolName = useMemo(() => getSchoolNameFromStorage(), []);

  const [selectedReport, setSelectedReport] = useState<ReportKey | null>(null);
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [showActionsModal, setShowActionsModal] = useState(false);

  const [groupBy, setGroupBy] = useState<"None" | "Classroom" | "Account Status" | "Days Outstanding">("None");
  const [sortBy, setSortBy] = useState<"Name" | "Account No" | "Balance">("Name");
  const [show, setShow] = useState<"All Balances" | "Credits Only" | "Debits Only">("All Balances");
  const [includeInactiveWithBalances, setIncludeInactiveWithBalances] = useState(false);

  const canPrint = Boolean(selectedReport);

  const reportQuery = useMemo(() => {
    if (!selectedReport) return "";
    const params = new URLSearchParams();
    params.set("report", selectedReport);
    if (schoolId) params.set("schoolId", schoolId);
    const name = getSchoolNameFromStorage();
    if (name) params.set("schoolName", name);

    if (isAccountListReport(selectedReport)) {
      params.set("groupBy", groupBy);
      params.set("sortBy", sortBy);
      params.set("show", show);
      params.set("includeInactiveWithBalances", includeInactiveWithBalances ? "1" : "0");
    }
    return params.toString();
  }, [selectedReport, schoolId, groupBy, sortBy, show, includeInactiveWithBalances]);

  return (
    <div className="dashboard-page">
      <div className="dashboard-header" style={{ alignItems: "baseline" }}>
        <div style={{ display: "grid", gap: 8 }}>
          <h1 className="page-title">Billing Reports » View, print or export billing reports</h1>
          <p className="dashboard-subtitle" style={{ margin: 0 }}>
            Select a report, then click Print.
          </p>
        </div>
      </div>

      <div className="dashboard-card" style={{ padding: 0 }}>
        <div
          style={{
            padding: 18,
            borderBottom: "1px solid #ece7dc",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 800 }}>Billing Reports</div>
          <button
            className="btn-gold-dark"
            disabled={!canPrint}
            onClick={() => setShowSetupModal(true)}
            title={canPrint ? "Print" : "Select a report first"}
          >
            Print
          </button>
        </div>

        <div style={{ padding: 18 }}>
          {!schoolId ? (
            <div style={{ padding: 12, border: "1px solid #f0b4b4", background: "#fff5f5", borderRadius: 12 }}>
              No school selected. Please select a school to view billing reports.
            </div>
          ) : (
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                    <th style={{ padding: 12, width: 34 }} />
                    <th style={{ padding: 12 }}>Report Name</th>
                  </tr>
                </thead>
                <tbody>
                  {REPORTS.map((r) => {
                    const isSelected = r === selectedReport;
                    return (
                      <tr
                        key={r}
                        onClick={() => setSelectedReport(r)}
                        style={{
                          cursor: "pointer",
                          background: isSelected ? "#fff8e1" : "white",
                          borderTop: "1px solid #e5e7eb",
                        }}
                      >
                        <td style={{ padding: 12 }}>
                          <input type="radio" checked={isSelected} onChange={() => setSelectedReport(r)} />
                        </td>
                        <td style={{ padding: 12, fontWeight: 700, color: "#1d2736" }}>{r}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 12, fontSize: 13, color: "#5b6575" }}>
            School: <span style={{ fontWeight: 800, color: "#1d2736" }}>{schoolName || "—"}</span>
          </div>
        </div>
      </div>

      <Modal
        open={showSetupModal}
        title={selectedReport || "Billing Report"}
        onClose={() => setShowSetupModal(false)}
      >
        {selectedReport && isAccountListReport(selectedReport) ? (
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>Group By</div>
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as any)}>
                <option value="None">None</option>
                <option value="Classroom">Classroom</option>
                <option value="Account Status">Account Status</option>
                <option value="Days Outstanding">Days Outstanding</option>
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>Sort By</div>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}>
                <option value="Name">Name</option>
                <option value="Account No">Account No</option>
                <option value="Balance">Balance</option>
              </select>
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 800 }}>Show</div>
              <select value={show} onChange={(e) => setShow(e.target.value as any)}>
                <option value="All Balances">All Balances</option>
                <option value="Credits Only">Credits Only</option>
                <option value="Debits Only">Debits Only</option>
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
              <input
                type="checkbox"
                checked={includeInactiveWithBalances}
                onChange={(e) => setIncludeInactiveWithBalances(e.target.checked)}
              />
              <div style={{ fontWeight: 700 }}>Include Inactive Accounts With Balances</div>
            </label>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8, flexWrap: "wrap" }}>
              <button
                className="btn-gold-light"
                onClick={() => {
                  setShowSetupModal(false);
                }}
              >
                Cancel
              </button>
              <button
                className="btn-gold-dark"
                onClick={() => {
                  setShowSetupModal(false);
                  setShowActionsModal(true);
                }}
              >
                Continue
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ color: "#5b6575" }}>
              This report is ready to generate. Click Continue to choose View / Download / Export.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8, flexWrap: "wrap" }}>
              <button className="btn-gold-light" onClick={() => setShowSetupModal(false)}>
                Cancel
              </button>
              <button
                className="btn-gold-dark"
                onClick={() => {
                  setShowSetupModal(false);
                  setShowActionsModal(true);
                }}
              >
                Continue
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={showActionsModal} title="Report Actions" onClose={() => setShowActionsModal(false)}>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ color: "#5b6575" }}>
            Report: <span style={{ fontWeight: 800, color: "#1d2736" }}>{selectedReport || "—"}</span>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              className="btn-gold-dark"
              disabled={!selectedReport}
              onClick={() => {
                if (!selectedReport) return;
                navigate(`/dashboard/billing/reports/preview?${reportQuery}`);
              }}
            >
              View
            </button>
            <button
              className="btn-gold-dark"
              disabled={!selectedReport}
              onClick={() => {
                if (!selectedReport) return;
                const html = `<!doctype html><html><head><meta charset="utf-8"><title>${selectedReport}</title></head><body><h2>${schoolName ||
                  ""}</h2><h1>${selectedReport}</h1><p>No records found for this school yet.</p></body></html>`;
                const blob = new Blob([html], { type: "text/html;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${selectedReport}.html`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download
            </button>
            <button
              className="btn-gold-dark"
              disabled={!selectedReport}
              onClick={() => {
                if (!selectedReport) return;
                const csv = `School,Report\n"${(schoolName || "").replaceAll('"', '""')}","${selectedReport.replaceAll('"', '""')}"\n`;
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${selectedReport}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Export
            </button>
            <button className="btn-gold-light" onClick={() => setShowActionsModal(false)}>
              Close
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

