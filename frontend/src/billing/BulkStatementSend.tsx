import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  buildStatementCoverEmailHtml,
  loadStatementSchoolBranding,
  type StatementSchoolBranding,
} from "./statementDocument";
import {
  createBulkStatementEmailJob,
  fetchBulkStatementEmailJob,
  listBulkStatementEmailJobs,
  retryFailedBulkStatementEmailJob,
  type BulkStatementEmailJob,
} from "./bulkStatementEmailJobsApi";
import {
  BULK_STATEMENT_PERIODS,
  applyRecipientSelected,
  buildBulkStatementRecipients,
  confirmBulkSendDetails,
  confirmBulkSendMessage,
  countAdditionalEligibleRecipients,
  countCanonicalEligibleRecipients,
  countSelectedFailedRecipients,
  countSelectedPendingRecipients,
  countSelectedRecipients,
  countSkippedRecipients,
  deselectAllRecipients,
  filterRowsForBulkStatementSend,
  isBulkSendButtonEnabled,
  isRecipientSelectable,
  resolveBulkStatementPeriod,
  selectAllEligibleRecipients,
  sortBulkStatementRows,
  type BulkRecipient,
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

function jobToRecipients(job: BulkStatementEmailJob | null): BulkRecipient[] {
  if (!job?.recipients?.length) return [];
  return job.recipients.map((r) => ({
    id: String(r.id),
    accountNo: String(r.accountNo || ""),
    email: String(r.email || ""),
    contactName: String(r.contactName || ""),
    relationship: String(r.relationship || ""),
    learnerId: String(r.learnerId || ""),
    learnerName: String(r.learnerName || ""),
    status: (r.status as BulkRecipient["status"]) || "PENDING",
    selected: r.status === "FAILED",
    skipReason: r.status === "SKIPPED" ? String(r.failureReason || "Skipped") : undefined,
    errorReason: r.status === "FAILED" ? String(r.failureReason || "Failed") : undefined,
  }));
}

function isJobActive(status: string | undefined): boolean {
  const s = String(status || "");
  return s === "PENDING" || s === "RUNNING";
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
  const [submitting, setSubmitting] = useState(false);
  const [schoolBranding, setSchoolBranding] = useState<StatementSchoolBranding>({ name: "School" });
  const [activeJob, setActiveJob] = useState<BulkStatementEmailJob | null>(null);
  const [jobError, setJobError] = useState("");
  const [recentJobs, setRecentJobs] = useState<BulkStatementEmailJob[]>([]);
  const pollRef = useRef<number | null>(null);

  const filteredRows = useMemo(() => {
    const matched = filterRowsForBulkStatementSend(statementRows || [], {
      accountStatus,
      hideCorrections,
      includeInactiveWithBalances,
    });
    return sortBulkStatementRows(matched, sortBy);
  }, [statementRows, accountStatus, hideCorrections, includeInactiveWithBalances, sortBy]);

  const skippedCount = countSkippedRecipients(recipients);
  const canonicalEligibleCount = countCanonicalEligibleRecipients(recipients);
  const additionalEligibleCount = countAdditionalEligibleRecipients(recipients);
  const selectedCount = countSelectedRecipients(recipients);
  const selectedPendingCount = countSelectedPendingRecipients(recipients);
  const selectedFailedCount = countSelectedFailedRecipients(recipients);
  const sendEnabled = !activeJob && isBulkSendButtonEnabled(recipients);
  const jobLocked = Boolean(activeJob && isJobActive(activeJob.status));
  const locked = submitting || jobLocked;
  const periodForSend = resolveBulkStatementPeriod(statementPeriod);

  const stopPolling = () => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const applyJob = (job: BulkStatementEmailJob) => {
    setActiveJob(job);
    const mapped = jobToRecipients(job);
    if (mapped.length) setRecipients(mapped);
  };

  const refreshJob = async (jobId: string) => {
    const job = await fetchBulkStatementEmailJob(jobId, schoolId);
    applyJob(job);
    if (!isJobActive(job.status)) stopPolling();
    return job;
  };

  const startPolling = (jobId: string) => {
    stopPolling();
    pollRef.current = window.setInterval(() => {
      void refreshJob(jobId).catch((error) => {
        setJobError(error instanceof Error ? error.message : "Failed to refresh job");
      });
    }, 2500);
  };

  useEffect(() => () => stopPolling(), []);

  useEffect(() => {
    if (step !== "email") return;
    void (async () => {
      try {
        const jobs = await listBulkStatementEmailJobs(schoolId, 8);
        setRecentJobs(jobs);
        const running = jobs.find((j) => isJobActive(j.status));
        if (running) {
          const full = await fetchBulkStatementEmailJob(running.id, schoolId);
          applyJob(full);
          startPolling(full.id);
        }
      } catch {
        // Recent job recovery is best-effort; selection still works offline to create a new job later.
      }
    })();
  }, [step, schoolId]);

  const handleContinue = async () => {
    let branding: StatementSchoolBranding = { name: "School" };
    try {
      branding = await loadStatementSchoolBranding(schoolId);
    } catch {
      branding = { name: "School" };
    }
    setSchoolBranding(branding);
    const built = buildBulkStatementRecipients({
      rows: filteredRows,
      learners,
      schoolEmail: branding.email || "",
    });
    setRecipients(built);
    setEmailMessage(message);
    setSubject(`Statement of Account — ${periodForSend}`);
    setConfirmOpen(false);
    setRetryConfirmOpen(false);
    setActiveJob(null);
    setJobError("");
    setStep("email");
  };

  const createJobFromSelection = async () => {
    if (submitting || activeJob) return;
    setSubmitting(true);
    setConfirmOpen(false);
    setJobError("");
    try {
      const html = buildStatementCoverEmailHtml({
        school: schoolBranding,
        messagePlain: emailMessage || "",
      });
      const payloadRecipients = recipients
        .filter((r) => (r.selected && r.status === "PENDING") || r.status === "SKIPPED")
        .map((r) => ({
          accountNo: r.accountNo,
          learnerId: r.learnerId,
          learnerName: r.learnerName,
          contactName: r.contactName,
          relationship: r.relationship,
          email: r.email,
          skipped: r.status === "SKIPPED",
          skipReason: r.skipReason,
        }));
      const selectedOnly = payloadRecipients.filter((r) => !r.skipped);
      if (!selectedOnly.length) {
        throw new Error("Select at least one eligible recipient");
      }
      const job = await createBulkStatementEmailJob({
        schoolId,
        subject: subject.trim() || `Statement of Account — ${periodForSend}`,
        html,
        messagePlain: emailMessage || "",
        statementPeriod: periodForSend,
        filterSnapshot: {
          accountStatus,
          hideCorrections,
          includeInactiveWithBalances,
          groupBy,
          sortBy,
        },
        recipients: payloadRecipients,
      });
      applyJob(job);
      startPolling(job.id);
      const jobs = await listBulkStatementEmailJobs(schoolId, 8).catch(() => []);
      setRecentJobs(jobs);
    } catch (error) {
      setJobError(error instanceof Error ? error.message : "Failed to start bulk send job");
    } finally {
      setSubmitting(false);
    }
  };

  const retryFailedJob = async () => {
    if (!activeJob || submitting) return;
    setSubmitting(true);
    setRetryConfirmOpen(false);
    setJobError("");
    try {
      const selectedFailedIds = recipients
        .filter((r) => r.selected && r.status === "FAILED")
        .map((r) => r.id);
      const job = await retryFailedBulkStatementEmailJob({
        jobId: activeJob.id,
        schoolId,
        recipientIds: selectedFailedIds.length ? selectedFailedIds : undefined,
      });
      applyJob(job);
      startPolling(job.id);
    } catch (error) {
      setJobError(error instanceof Error ? error.message : "Failed to retry failed recipients");
    } finally {
      setSubmitting(false);
    }
  };

  const confirmPanel = (kind: "pending" | "failed_only") => {
    const n = kind === "failed_only" ? selectedFailedCount : selectedPendingCount;
    const accountsForConfirm = (() => {
      const accounts = new Set<string>();
      for (const row of recipients) {
        if (!row.selected) continue;
        if (kind === "failed_only" && row.status !== "FAILED") continue;
        if (kind === "pending" && row.status !== "PENDING") continue;
        const accountNo = String(row.accountNo || "").trim().toUpperCase();
        if (accountNo) accounts.add(accountNo);
      }
      return accounts.size;
    })();
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
            <div style={{ color: "#475569", fontWeight: 700 }}>
              {confirmBulkSendDetails({
                accounts: accountsForConfirm,
                emailRecipients: n,
                skipped: skippedCount,
              })}
            </div>
            <div style={{ color: "#475569", fontWeight: 600 }}>Account status: {accountStatus}</div>
            <div style={{ color: "#475569", fontWeight: 600 }}>Statement period: {periodForSend}</div>
            <div style={{ color: "#64748b", fontWeight: 600, fontSize: 13 }}>
              Select All selects all eligible email recipients (canonical and additional contacts with
              a valid external email). Skipped, school/internal, and blocked contacts stay unselected.
            </div>
            <div style={{ color: "#0f766e", fontWeight: 700, fontSize: 13 }}>
              Sending continues on the server if you close this window or log out.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
              <button type="button" style={disabledBtn(ghostBtn, locked)} onClick={onCancel} disabled={locked}>
                Cancel
              </button>
              <button
                type="button"
                style={disabledBtn(goldBtn, locked || n <= 0)}
                disabled={locked || n <= 0}
                onClick={() => (kind === "failed_only" ? void retryFailedJob() : void createJobFromSelection())}
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
    const failedRows = recipients.filter((r) => r.status === "FAILED");
    return (
      <div style={overlay}>
        {(confirmOpen || retryConfirmOpen) && confirmPanel(retryConfirmOpen ? "failed_only" : "pending")}
        <div style={{ ...panel, width: "min(1100px, 100%)" }}>
          <div style={{ padding: "20px 24px", borderBottom: `1px solid ${GOLD}`, background: INK, color: GOLD }}>
            <div style={{ fontWeight: 900, fontSize: 20 }}>Send Statements — Email</div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
              {activeJob
                ? `Job ${activeJob.status} · Pending: ${activeJob.pendingCount} · Sending: ${activeJob.sendingCount} · Sent: ${activeJob.sentCount} · Failed: ${activeJob.failedCount} · Skipped: ${activeJob.skippedCount}`
                : `Accounts: ${canonicalEligibleCount} · Additional contacts: ${additionalEligibleCount} · Selected: ${selectedCount} · Skipped: ${skippedCount}`}
            </div>
          </div>
          <div style={{ padding: 24, display: "grid", gap: 14 }}>
            <div style={{ color: "#64748b", fontWeight: 700 }}>
              Mail is sent through EduClear using the same statement PDF as Statement Manage.
            </div>
            <div style={{ color: "#0f766e", fontWeight: 700, fontSize: 13 }}>
              Server-owned send: progress is saved. You can close this page or log out; reopen Bulk Statement Email
              to continue watching this job.
            </div>
            {jobError ? (
              <div style={{ border: "1px solid #fecaca", background: "#fef2f2", borderRadius: 10, padding: 12, color: "#991b1b", fontWeight: 700 }}>
                {jobError}
              </div>
            ) : null}
            {recentJobs.length && !activeJob ? (
              <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12 }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>Recent jobs</div>
                {recentJobs.slice(0, 5).map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    style={{ ...ghostBtn, display: "block", width: "100%", textAlign: "left", marginBottom: 6 }}
                    onClick={() => {
                      void refreshJob(job.id).then((full) => {
                        if (isJobActive(full.status)) startPolling(full.id);
                      });
                    }}
                  >
                    {job.status} · Sent {job.sentCount} · Failed {job.failedCount} · {new Date(job.createdAt).toLocaleString()}
                  </button>
                ))}
              </div>
            ) : null}
            <label>
              Subject
              <input
                style={fieldStyle}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={locked || Boolean(activeJob)}
              />
            </label>
            <label>
              Message
              <textarea
                style={{ ...fieldStyle, minHeight: 100 }}
                value={emailMessage}
                onChange={(e) => setEmailMessage(e.target.value)}
                disabled={locked || Boolean(activeJob)}
              />
            </label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                style={disabledBtn(ghostBtn, locked || Boolean(activeJob))}
                onClick={() => {
                  if (locked || activeJob) return;
                  setRecipients((prev) => selectAllEligibleRecipients(prev));
                }}
                disabled={locked || Boolean(activeJob)}
              >
                Select All
              </button>
              <button
                type="button"
                style={disabledBtn(ghostBtn, locked || Boolean(activeJob))}
                onClick={() => {
                  if (locked || activeJob) return;
                  setRecipients((prev) => deselectAllRecipients(prev));
                }}
                disabled={locked || Boolean(activeJob)}
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
                {submitting ? "Starting…" : "Send"}
              </button>
              <button
                type="button"
                style={disabledBtn(goldBtn, locked || !activeJob || (activeJob.failedCount || 0) <= 0)}
                onClick={() => {
                  if (!activeJob || (activeJob.failedCount || 0) <= 0) return;
                  setConfirmOpen(false);
                  setRetryConfirmOpen(true);
                }}
                disabled={locked || !activeJob || (activeJob.failedCount || 0) <= 0}
              >
                Retry failed
              </button>
              <button
                type="button"
                style={disabledBtn(goldBtn, locked)}
                onClick={() => {
                  stopPolling();
                  setActiveJob(null);
                  setStep("wizard");
                }}
                disabled={locked && submitting}
              >
                Back
              </button>
              <button type="button" style={goldBtn} onClick={onClose}>
                Close
              </button>
            </div>
            {activeJob ? (
              <div style={{ fontWeight: 800, color: INK }}>
                {activeJob.status} · Pending: {activeJob.pendingCount} · Sending: {activeJob.sendingCount} · Sent:{" "}
                {activeJob.sentCount} · Failed: {activeJob.failedCount} · Skipped: {activeJob.skippedCount}
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
                      const selectable = !activeJob && isRecipientSelectable(c);
                      const boxDisabled = locked || !selectable;
                      return (
                        <tr key={c.id}>
                          <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>
                            <input
                              type="checkbox"
                              checked={Boolean(c.selected) && (selectable || c.status === "FAILED")}
                              disabled={boxDisabled && c.status !== "FAILED"}
                              onChange={(e) => {
                                if (activeJob && c.status !== "FAILED") return;
                                setRecipients((prev) => applyRecipientSelected(prev, c.id, e.target.checked));
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
