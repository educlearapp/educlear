import React, { useMemo, useRef, useState } from "react";
import {
  buildStatementCoverEmailHtml,
  loadStatementSchoolBranding,
  sendStatementEmail,
  type StatementSchoolBranding,
} from "./statementDocument";
import { buildStatementPdfFilename } from "./statementPeriod";
import {
  BULK_STATEMENT_PERIODS,
  applyRecipientSelected,
  buildBulkStatementRecipients,
  confirmBulkSendMessage,
  countEligibleRecipients,
  countSelectedFailedRecipients,
  countSelectedPendingRecipients,
  countSelectedRecipients,
  countSkippedRecipients,
  deselectAllRecipients,
  failedRecipientAccounts,
  filterRowsForBulkStatementSend,
  isBulkSendButtonEnabled,
  isBulkSendLocked,
  isRecipientSelectable,
  resolveBulkStatementPeriod,
  runBulkStatementSend,
  selectAllEligibleRecipients,
  sortBulkStatementRows,
  summarizeBulkSend,
  toBulkSendFailure,
  type BulkRecipient,
  type BulkSendLock,
  type BulkSendOneResult,
} from "./bulkStatementSendLogic";

type Props = {
  schoolId: string;
  learners: any[];
  statementRows: any[];
  onClose: () => void;
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

const ghostBtn: React.CSSProperties = {
  ...goldBtn,
  background: "#fff",
  color: INK,
};

function disabledBtn(base: React.CSSProperties, locked: boolean): React.CSSProperties {
  return {
    ...base,
    opacity: locked ? 0.55 : 1,
    cursor: locked ? "not-allowed" : "pointer",
  };
}

export default function BulkStatementSend({ schoolId, learners, statementRows, onClose }: Props) {
  const [step, setStep] = useState<"wizard" | "email">("wizard");
  const [accountStatus, setAccountStatus] = useState("All");
  const [groupBy, setGroupBy] = useState("Grade");
  const [sortBy, setSortBy] = useState("Name");
  const [statementPeriod, setStatementPeriod] = useState("All Time");
  const [hideCorrections, setHideCorrections] = useState(false);
  const [includeInactiveWithBalances, setIncludeInactiveWithBalances] = useState(false);
  const [message, setMessage] = useState("Please find your statement of account attached.");
  const [subject, setSubject] = useState("Statement of Account");
  const [emailMessage, setEmailMessage] = useState("Please find your statement of account attached.");
  const [recipients, setRecipients] = useState<BulkRecipient[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [retryConfirmOpen, setRetryConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [schoolBranding, setSchoolBranding] = useState<StatementSchoolBranding>({ name: "School" });
  const lockRef = useRef<BulkSendLock>({ inFlight: false });

  const filteredRows = useMemo(() => {
    const matched = filterRowsForBulkStatementSend(statementRows || [], {
      accountStatus,
      hideCorrections,
      includeInactiveWithBalances,
    });
    return sortBulkStatementRows(matched, sortBy);
  }, [statementRows, accountStatus, hideCorrections, includeInactiveWithBalances, sortBy]);

  const summary = summarizeBulkSend(recipients);
  const skippedCount = countSkippedRecipients(recipients);
  const eligibleCount = countEligibleRecipients(recipients);
  const selectedCount = countSelectedRecipients(recipients);
  const selectedPendingCount = countSelectedPendingRecipients(recipients);
  const selectedFailedCount = countSelectedFailedRecipients(recipients);
  const sendEnabled = isBulkSendButtonEnabled(recipients);
  const locked = sending || isBulkSendLocked(lockRef.current);
  const periodForSend = resolveBulkStatementPeriod(statementPeriod);

  const handleContinue = async () => {
    const built = buildBulkStatementRecipients({
      rows: filteredRows,
      learners,
    });
    setRecipients(built);
    setEmailMessage(message);
    setSubject(`Statement of Account — ${periodForSend}`);
    setConfirmOpen(false);
    setRetryConfirmOpen(false);
    setProgress({ current: 0, total: 0 });
    try {
      const branding = await loadStatementSchoolBranding(schoolId);
      setSchoolBranding(branding);
    } catch {
      setSchoolBranding({ name: "School" });
    }
    setStep("email");
  };

  const sendOneRecipient = async (recipient: BulkRecipient): Promise<BulkSendOneResult> => {
    const html = buildStatementCoverEmailHtml({
      school: schoolBranding,
      messagePlain: emailMessage || "",
    });
    try {
      await sendStatementEmail({
        schoolId,
        to: recipient.email,
        subject: subject.trim() || `Statement of Account — ${periodForSend}`,
        html,
        learnerId: recipient.learnerId,
        accountNo: recipient.accountNo,
        period: periodForSend,
        filename: buildStatementPdfFilename(recipient.accountNo, periodForSend),
      });
      return { ok: true };
    } catch (error) {
      return toBulkSendFailure(error);
    }
  };

  const runSend = async (mode: "pending" | "failed_only") => {
    if (lockRef.current.inFlight || sending) return;
    setSending(true);
    setConfirmOpen(false);
    setRetryConfirmOpen(false);
    try {
      const next = await runBulkStatementSend({
        lock: lockRef.current,
        recipients,
        mode,
        sendOne: sendOneRecipient,
        onProgress: (rows, current, total) => {
          setRecipients(rows);
          setProgress({ current, total });
        },
      });
      setRecipients(next);
    } finally {
      setSending(false);
    }
  };

  const confirmPanel = (kind: "pending" | "failed_only") => {
    const n = kind === "failed_only" ? selectedFailedCount : selectedPendingCount;
    const onCancel = () => {
      if (locked) return;
      setConfirmOpen(false);
      setRetryConfirmOpen(false);
    };
    return (
      <div style={{ ...overlay, zIndex: 5100 }}>
        <div style={{ ...panel, width: "min(560px, 100%)" }}>
          <div style={{ padding: "18px 22px", borderBottom: `1px solid ${GOLD}`, background: INK, color: GOLD }}>
            <div style={{ fontWeight: 900, fontSize: 18 }}>Confirm statement send</div>
          </div>
          <div style={{ padding: 22, display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{confirmBulkSendMessage(n)}</div>
            <div style={{ color: "#475569", fontWeight: 600 }}>Account status: {accountStatus}</div>
            <div style={{ color: "#475569", fontWeight: 600 }}>Statement period: {periodForSend}</div>
            <div style={{ color: "#475569", fontWeight: 600 }}>Selected: {n}</div>
            <div style={{ color: "#475569", fontWeight: 600 }}>Skipped: {skippedCount}</div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
              <button type="button" style={disabledBtn(ghostBtn, locked)} onClick={onCancel} disabled={locked}>
                Cancel
              </button>
              <button
                type="button"
                style={disabledBtn(goldBtn, locked || n <= 0)}
                disabled={locked || n <= 0}
                onClick={() => runSend(kind)}
              >
                Confirm Send
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (step === "email") {
    const failedRows = failedRecipientAccounts(recipients);
    return (
      <div style={overlay}>
        {(confirmOpen || retryConfirmOpen) && confirmPanel(retryConfirmOpen ? "failed_only" : "pending")}
        <div style={{ ...panel, width: "min(1100px, 100%)" }}>
          <div style={{ padding: "20px 24px", borderBottom: `1px solid ${GOLD}`, background: INK, color: GOLD }}>
            <div style={{ fontWeight: 900, fontSize: 20 }}>Send Statements — Email</div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
              {sending
                ? `Sending ${progress.current} of ${progress.total}${
                    recipients.some((row) => row.status === "SENDING")
                      ? ` · ${recipients.filter((row) => row.status === "SENDING").length} in flight`
                      : ""
                  }`
                : `Eligible: ${eligibleCount} · Selected: ${selectedCount} · Skipped: ${skippedCount}`}
            </div>
          </div>
          <div style={{ padding: 24, display: "grid", gap: 14 }}>
            <div style={{ color: "#64748b", fontWeight: 700 }}>
              Mail is sent through EduClear using the same statement PDF as Statement Manage.
            </div>
            <label>
              Subject
              <input
                style={fieldStyle}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={locked}
              />
            </label>
            <label>
              Message
              <textarea
                style={{ ...fieldStyle, minHeight: 100 }}
                value={emailMessage}
                onChange={(e) => setEmailMessage(e.target.value)}
                disabled={locked}
              />
            </label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                style={disabledBtn(ghostBtn, locked)}
                onClick={() => {
                  if (locked) return;
                  setRecipients((prev) => selectAllEligibleRecipients(prev, lockRef.current));
                }}
                disabled={locked}
              >
                Select All
              </button>
              <button
                type="button"
                style={disabledBtn(ghostBtn, locked)}
                onClick={() => {
                  if (locked) return;
                  setRecipients((prev) => deselectAllRecipients(prev, lockRef.current));
                }}
                disabled={locked}
              >
                Deselect All
              </button>
              <button
                type="button"
                style={disabledBtn(goldBtn, locked || !sendEnabled)}
                onClick={() => {
                  if (locked || !sendEnabled) return;
                  setRetryConfirmOpen(false);
                  setConfirmOpen(true);
                }}
                disabled={locked || !sendEnabled}
              >
                {sending ? `Sending ${progress.current} of ${progress.total}` : "Send"}
              </button>
              <button
                type="button"
                style={disabledBtn(goldBtn, locked || selectedFailedCount <= 0)}
                onClick={() => {
                  if (locked || selectedFailedCount <= 0) return;
                  setConfirmOpen(false);
                  setRetryConfirmOpen(true);
                }}
                disabled={locked || selectedFailedCount <= 0}
              >
                Retry failed
              </button>
              <button
                type="button"
                style={disabledBtn(goldBtn, locked)}
                onClick={() => setStep("wizard")}
                disabled={locked}
              >
                Back
              </button>
              <button type="button" style={disabledBtn(goldBtn, locked)} onClick={onClose} disabled={locked}>
                Close
              </button>
            </div>
            {summary.outcome ? (
              <div style={{ fontWeight: 800, color: INK }}>
                {summary.outcome} · Attempted: {summary.attempted} · Sent: {summary.sent} · Failed: {summary.failed} ·
                Skipped: {summary.skipped}
              </div>
            ) : null}
            {failedRows.length ? (
              <div style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 10, padding: 12 }}>
                <div style={{ fontWeight: 800, color: "#991b1b", marginBottom: 6 }}>Failed recipients</div>
                {failedRows.map((row) => (
                  <div key={`${row.accountNo}-${row.email}`} style={{ color: "#7f1d1d", fontWeight: 600, fontSize: 13 }}>
                    {row.accountNo || "—"} · {row.errorReason}
                  </div>
                ))}
              </div>
            ) : null}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead>
                  <tr style={{ background: "rgba(212,175,55,0.16)" }}>
                    {["Select", "Contact Name", "Relationship", "Email", "Account", "Status"].map((h) => (
                      <th key={h} style={{ padding: 12, textAlign: "left", fontSize: 12, fontWeight: 900 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recipients.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 20, textAlign: "center", color: "#64748b" }}>
                        No accounts matched the selected filters.
                      </td>
                    </tr>
                  ) : (
                    recipients.map((c) => {
                      const selectable = isRecipientSelectable(c);
                      const boxDisabled = locked || !selectable;
                      return (
                      <tr key={c.id}>
                        <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>
                          <input
                            type="checkbox"
                            checked={Boolean(c.selected) && selectable}
                            disabled={boxDisabled}
                            onChange={(e) => {
                              if (locked) return;
                              setRecipients((prev) =>
                                applyRecipientSelected(prev, c.id, e.target.checked, lockRef.current)
                              );
                            }}
                            aria-label={`Select ${c.accountNo || c.contactName}`}
                          />
                        </td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{c.contactName}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{c.relationship}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{c.email || "—"}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{c.accountNo || "—"}</td>
                        <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9", fontWeight: 800 }}>
                          {c.status}
                          {c.skipReason ? ` · ${c.skipReason}` : ""}
                          {c.errorReason ? ` · ${c.errorReason}` : ""}
                        </td>
                      </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ color: "#64748b", fontSize: 13 }}>
              Group by: {groupBy} · Period: {periodForSend}
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
            {filteredRows.length} account(s) match your filters
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
              {BULK_STATEMENT_PERIODS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
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
