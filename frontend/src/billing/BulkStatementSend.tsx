import React, { useMemo, useState } from "react";
import { API_URL } from "../api";
import { getLearnerAccountNo } from "../learner/learnerIdentity";
import { normaliseBillingAmount } from "./billingLedger";
import { sendBillingStatements } from "./billingApi";

type Props = {
  schoolId: string;
  learners: any[];
  statementRows: any[];
  onClose: () => void;
};

type ContactRow = {
  id: string;
  contactName: string;
  relationship: string;
  email: string;
  attachment: string;
  status: string;
  accountNo: string;
  learnerId: string;
  learnerName: string;
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
  width: "min(960px, 100%)",
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

function periodStart(period: string): Date | null {
  const now = new Date();
  if (period === "Last 30 Days") {
    const d = new Date(now);
    d.setDate(d.getDate() - 30);
    return d;
  }
  if (period === "Last 3 Months") {
    const d = new Date(now);
    d.setMonth(d.getMonth() - 3);
    return d;
  }
  if (period === "This Year") {
    return new Date(now.getFullYear(), 0, 1);
  }
  return null;
}

function matchesStatus(status: string, filter: string) {
  if (filter === "All") return true;
  if (filter === "Inactive") return status === "Inactive";
  if (filter === "Paid Up") return status === "Up To Date";
  return status === filter;
}

export default function BulkStatementSend({ schoolId, learners, statementRows, onClose }: Props) {
  const [step, setStep] = useState<"wizard" | "email">("wizard");
  const [accountStatus, setAccountStatus] = useState("All");
  const [groupBy, setGroupBy] = useState("Grade");
  const [sortBy, setSortBy] = useState("Name");
  const [statementPeriod, setStatementPeriod] = useState("Last 30 Days");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [hideCorrections, setHideCorrections] = useState(false);
  const [includeInactiveWithBalances, setIncludeInactiveWithBalances] = useState(false);
  const [message, setMessage] = useState("Please find your statement of account attached.");

  const [fromEmail, setFromEmail] = useState("billing@school.co.za");
  const [description, setDescription] = useState("Bulk statement send");
  const [subject, setSubject] = useState("Statement of Account");
  const [emailMessage, setEmailMessage] = useState("Please find your statement of account attached.");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [sending, setSending] = useState(false);

  const learnerById = useMemo(() => {
    const map = new Map<string, any>();
    for (const l of learners || []) map.set(String(l.id), l);
    return map;
  }, [learners]);

  const filteredRows = useMemo(() => {
    const start = statementPeriod === "Custom" && customFrom ? new Date(customFrom) : periodStart(statementPeriod);
    const end = statementPeriod === "Custom" && customTo ? new Date(customTo) : new Date();

    return (statementRows || []).filter((row) => {
      const status = String(row.status || "Up To Date");
      if (!matchesStatus(status, accountStatus)) {
        if (!(includeInactiveWithBalances && status === "Inactive" && normaliseBillingAmount(row.balance) !== 0)) {
          return false;
        }
      }
      if (hideCorrections && String(row.lastInvoice || "").toLowerCase().includes("correction")) {
        return false;
      }
      if (start && row.lastInvoiceDate) {
        const d = new Date(row.lastInvoiceDate);
        if (d < start || d > end) return false;
      }
      return true;
    });
  }, [
    statementRows,
    accountStatus,
    hideCorrections,
    includeInactiveWithBalances,
    statementPeriod,
    customFrom,
    customTo,
  ]);

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows];
    rows.sort((a, b) => {
      if (sortBy === "Surname") return String(a.surname).localeCompare(String(b.surname));
      if (sortBy === "Account No") return String(a.accountNo).localeCompare(String(b.accountNo));
      if (sortBy === "Balance") return normaliseBillingAmount(b.balance) - normaliseBillingAmount(a.balance);
      return String(a.name).localeCompare(String(b.name));
    });
    return rows;
  }, [filteredRows, sortBy]);

  const buildContacts = () => {
    const list: ContactRow[] = [];
    for (const row of sortedRows) {
      const learner = learnerById.get(String(row.learnerId || row.id));
      const accountNo = getLearnerAccountNo(learner || row);
      if (!accountNo || accountNo === "-") continue;

      const parents = Array.isArray(learner?.parents) ? learner.parents : [];
      const targets = parents.length
        ? parents
        : [{ firstName: row.name, surname: row.surname, relationship: "Parent", email: learner?.parentEmail || "" }];

      for (const parent of targets) {
        const email = String(parent.email || "").trim();
        if (!email) continue;
        const contactName = `${parent.firstName || parent.name || ""} ${parent.surname || parent.lastName || ""}`.trim();
        const attachment = `statement-${accountNo}-${statementPeriod.replace(/\s+/g, "-").toLowerCase()}.pdf`;
        list.push({
          id: `${row.learnerId}-${email}`,
          contactName: contactName || "Parent Contact",
          relationship: String(parent.relationship || parent.relation || "Parent"),
          email,
          attachment,
          status: "Ready",
          accountNo,
          learnerId: String(row.learnerId || row.id),
          learnerName: `${row.name} ${row.surname}`.trim(),
        });
      }
    }
    const unique = new Map<string, ContactRow>();
    for (const c of list) unique.set(c.id, c);
    return Array.from(unique.values());
  };

  const handleContinue = () => {
    const built = buildContacts();
    setContacts(built);
    setAttachments([...new Set(built.map((c) => c.attachment))]);
    setEmailMessage(message);
    setSubject(`Statement of Account — ${statementPeriod}`);
    setStep("email");
  };

  const handleSend = async () => {
    setSending(true);
    try {
      const payload = {
        schoolId,
        from: fromEmail,
        description,
        subject,
        message: emailMessage,
        contacts: contacts.map((c) => ({
          contactName: c.contactName,
          email: c.email,
          accountNo: c.accountNo,
          learnerId: c.learnerId,
          attachment: c.attachment,
        })),
      };
      const res = await sendBillingStatements(payload);
      const results = Array.isArray(res?.results) ? res.results : [];
      setContacts((prev) =>
        prev.map((c) => {
          const match = results.find((r: any) => r.email === c.email && r.accountNo === c.accountNo);
          return { ...c, status: match?.status || "Sent" };
        })
      );
    } catch {
      setContacts((prev) => prev.map((c) => ({ ...c, status: "Failed" })));
    } finally {
      setSending(false);
    }
  };

  const handlePreview = () => {
    if (!contacts.length) {
      alert("No contacts to preview.");
      return;
    }
    const sample = contacts[0];
    window.open(
      `data:text/html,${encodeURIComponent(
        `<h1>Statement Preview</h1><p>${sample.learnerName}</p><p>Account: ${sample.accountNo}</p><p>Balance from ledger.</p>`
      )}`,
      "_blank"
    );
  };

  if (step === "email") {
    return (
      <div style={overlay}>
        <div style={{ ...panel, width: "min(1100px, 100%)" }}>
          <div style={{ padding: "20px 24px", borderBottom: `1px solid ${GOLD}`, background: INK, color: GOLD }}>
            <div style={{ fontWeight: 900, fontSize: 20 }}>Send Statements — Email</div>
          </div>
          <div style={{ padding: 24, display: "grid", gap: 14 }}>
            <label>
              From
              <input style={fieldStyle} value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} />
            </label>
            <label>
              Description
              <input style={fieldStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <label>
              Subject
              <input style={fieldStyle} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <label>
              Message
              <textarea
                style={{ ...fieldStyle, minHeight: 100 }}
                value={emailMessage}
                onChange={(e) => setEmailMessage(e.target.value)}
              />
            </label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" style={goldBtn} onClick={() => setAttachments((a) => [...a, `extra-${Date.now()}.pdf`])}>
                Add Attachment
              </button>
              <button
                type="button"
                style={goldBtn}
                onClick={() => setAttachments((a) => a.slice(0, -1))}
                disabled={!attachments.length}
              >
                Remove
              </button>
              <button type="button" style={goldBtn} onClick={handlePreview}>
                Preview
              </button>
              <button type="button" style={goldBtn} onClick={handleSend} disabled={sending}>
                {sending ? "Sending…" : "Send"}
              </button>
              <button type="button" style={goldBtn} onClick={() => setStep("wizard")}>
                Back
              </button>
              <button type="button" style={goldBtn} onClick={onClose}>
                Close
              </button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead>
                  <tr style={{ background: "rgba(212,175,55,0.16)" }}>
                    {["Contact Name", "Relationship", "Email", "Attachment(s)", "Status"].map((h) => (
                      <th key={h} style={{ padding: 12, textAlign: "left", fontSize: 12, fontWeight: 900 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contacts.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: 20, textAlign: "center", color: "#64748b" }}>
                        No contacts with email addresses found for the selected filters.
                      </td>
                    </tr>
                  ) : (
                    contacts.map((c) => (
                      <tr key={c.id}>
                        <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{c.contactName}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{c.relationship}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{c.email}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{c.attachment}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9", fontWeight: 800 }}>{c.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ color: "#64748b", fontSize: 13 }}>
              {contacts.length} contact(s) · Group by: {groupBy} · {sortedRows.length} account(s) · API: {API_URL}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlay}>
      <div style={panel}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${GOLD}`, background: INK, color: GOLD }}>
          <div style={{ fontWeight: 900, fontSize: 20 }}>Bulk Send Statements</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
            {sortedRows.length} account(s) match your filters
          </div>
        </div>
        <div style={{ padding: 24, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 }}>
          <label>
            Account Status
            <select style={fieldStyle} value={accountStatus} onChange={(e) => setAccountStatus(e.target.value)}>
              {["All", "Paid Up", "Recently Owing", "Bad Debt", "Over Paid", "Inactive"].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <label>
            Group By
            <select style={fieldStyle} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              {["Classroom", "Grade", "Account Status"].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <label>
            Sort By
            <select style={fieldStyle} value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              {["Name", "Surname", "Account No", "Balance"].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <label>
            Statement Period
            <select style={fieldStyle} value={statementPeriod} onChange={(e) => setStatementPeriod(e.target.value)}>
              {["Last 30 Days", "Last 3 Months", "This Year", "Custom"].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          {statementPeriod === "Custom" && (
            <>
              <label>
                From
                <input type="date" style={fieldStyle} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </label>
              <label>
                To
                <input type="date" style={fieldStyle} value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </label>
            </>
          )}
          <label style={{ display: "flex", alignItems: "center", gap: 8, gridColumn: "span 2" }}>
            <input type="checkbox" checked={hideCorrections} onChange={(e) => setHideCorrections(e.target.checked)} />
            Hide Corrections
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, gridColumn: "span 2" }}>
            <input
              type="checkbox"
              checked={includeInactiveWithBalances}
              onChange={(e) => setIncludeInactiveWithBalances(e.target.checked)}
            />
            Include Inactive Accounts With Balances
          </label>
          <label style={{ gridColumn: "span 2" }}>
            Message
            <textarea style={{ ...fieldStyle, minHeight: 90 }} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
        </div>
        <div style={{ padding: "0 24px 24px", display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" style={goldBtn} onClick={onClose}>
            Cancel
          </button>
          <button type="button" style={goldBtn} onClick={handleContinue}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
