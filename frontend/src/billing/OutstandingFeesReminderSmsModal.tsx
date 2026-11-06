import React, { useEffect, useMemo, useState } from "react";
import {
  fetchOutstandingFeesReminderPreview,
  NEW_CAMPAIGN_AUTHORIZATION_TEXT,
  OUTSTANDING_FEES_REMINDER_DEFAULT_TEMPLATE,
  OUTSTANDING_FEES_REMINDER_TEMPLATE_MAX_CHARS,
  sendOutstandingFeesReminderRequest,
  type OutstandingFeesReminderPreview,
  type OutstandingFeesReminderSendResult,
} from "./outstandingFeesReminderSmsApi";

type Props = {
  schoolId: string;
  familyAccountIds: string[];
  selectedCount: number;
  onClose: () => void;
};

export default function OutstandingFeesReminderSmsModal({
  schoolId,
  familyAccountIds,
  selectedCount,
  onClose,
}: Props) {
  const sendInstanceId = useMemo(() => crypto.randomUUID(), []);
  const accountKey = familyAccountIds.join("\n");
  const [messageTemplate, setMessageTemplate] = useState(OUTSTANDING_FEES_REMINDER_DEFAULT_TEMPLATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<OutstandingFeesReminderPreview | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<OutstandingFeesReminderSendResult | null>(null);
  const trimmedTemplate = messageTemplate.trim();
  const templateError = reminderTemplateError(trimmedTemplate);

  useEffect(() => {
    if (templateError) {
      setLoading(false);
      setPreview(null);
      setError(templateError);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      fetchOutstandingFeesReminderPreview({ schoolId, familyAccountIds, messageTemplate: trimmedTemplate })
        .then((data) => {
          if (!cancelled) setPreview(data);
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setPreview(null);
            setError(err instanceof Error ? err.message : "Could not preview the reminder.");
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [schoolId, accountKey, trimmedTemplate, familyAccountIds, templateError]);

  async function confirmSend() {
    if (!preview || sending) return;
    setSending(true);
    setError("");
    try {
      const response = await sendOutstandingFeesReminderRequest({
        schoolId,
        familyAccountIds,
        sendInstanceId,
        messageTemplate: trimmedTemplate,
        authorizationText: preview.requiresNewCampaignAuthorization ? NEW_CAMPAIGN_AUTHORIZATION_TEXT : undefined,
      });
      setResult(response);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Reminder was not sent.");
    } finally {
      setSending(false);
    }
  }

  const canSend =
    Boolean(preview && preview.uniquePhones > 0 && preview.template === trimmedTemplate) &&
    !templateError &&
    !loading &&
    (!preview?.requiresNewCampaignAuthorization || authorized) &&
    !sending &&
    !result;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="outstanding-fees-reminder-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 80,
        padding: 16,
      }}
    >
      <div
        style={{
          width: "min(860px, 100%)",
          maxHeight: "90vh",
          overflow: "auto",
          background: "#fff",
          borderRadius: 16,
          borderTop: "4px solid #d4af37",
          padding: 20,
          color: "#0f172a",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <h2 id="outstanding-fees-reminder-title" style={{ margin: 0, fontSize: 20 }}>
            Outstanding fees reminder SMS
          </h2>
          <button type="button" onClick={onClose} style={{ fontWeight: 800 }}>
            Close
          </button>
        </div>
        <p style={{ color: "#475569", fontSize: 14 }}>
          Short payment reminder for {selectedCount} selected account{selectedCount === 1 ? "" : "s"}. This wording is
          only for the outstanding fees reminder. Statement SMS keeps its own message.
        </p>
        <label style={{ display: "block", fontWeight: 800, marginBottom: 6 }} htmlFor="outstanding-fees-reminder-template">
          Reminder message
        </label>
        <textarea
          id="outstanding-fees-reminder-template"
          value={messageTemplate}
          maxLength={OUTSTANDING_FEES_REMINDER_TEMPLATE_MAX_CHARS}
          onChange={(event) => setMessageTemplate(event.target.value.slice(0, OUTSTANDING_FEES_REMINDER_TEMPLATE_MAX_CHARS))}
          style={{ width: "100%", minHeight: 90, borderRadius: 10, border: "1px solid #cbd5e1", padding: 10, font: "inherit" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, margin: "8px 0 12px", fontSize: 12, color: "#64748b" }}>
          <span>
            Placeholders: {"{{schoolName}}"}, {"{{accountNo}}"}, {"{{amount}}"}. {trimmedTemplate.length}/
            {OUTSTANDING_FEES_REMINDER_TEMPLATE_MAX_CHARS} characters.
          </span>
          <button type="button" onClick={() => setMessageTemplate(OUTSTANDING_FEES_REMINDER_DEFAULT_TEMPLATE)} style={{ fontWeight: 800 }}>
            Reset to default
          </button>
        </div>
        {loading ? <p>Checking accounts, wording and SMS credits…</p> : null}
        {error ? (
          <p style={{ color: "#991b1b", fontWeight: 700 }} role="alert">
            {error}
          </p>
        ) : null}
        {preview ? (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 12 }}>
              <Summary label="Selected accounts" value={String(preview.selectedAccountCount)} />
              <Summary label="Unique valid numbers" value={String(preview.uniquePhones)} />
              <Summary label="Total credits" value={String(preview.totalCredits)} />
              <Summary label="Skipped" value={String(preview.skipped.length)} />
            </div>
            {preview.historicalStatementNote ? (
              <p style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 10, padding: 12 }}>
                {preview.historicalStatementNote} Confirming below starts a new reminder campaign. It does not bypass
                the statement hold.
              </p>
            ) : null}
            <div style={{ maxHeight: 280, overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 10 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#0f172a", color: "#fff" }}>
                    <th style={th}>Account</th>
                    <th style={th}>Number</th>
                    <th style={th}>Message</th>
                    <th style={th}>Encoding</th>
                    <th style={th}>Credits</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.messages.map((row) => (
                    <tr key={`${row.familyAccountId}-${row.mobileMasked}`}>
                      <td style={td}>
                        {row.accountNo}
                        <div style={{ color: "#64748b" }}>{row.displayName}</div>
                      </td>
                      <td style={td}>{row.mobileMasked}</td>
                      <td style={td}>{row.message}</td>
                      <td style={td}>
                        {row.encoding === "gsm" ? "GSM-7" : "UCS-2"} · {row.segments} segment
                        {row.segments === 1 ? "" : "s"}
                      </td>
                      <td style={td}>{row.credits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.skipped.length ? (
              <div style={{ marginTop: 12 }}>
                <strong>Skipped</strong>
                <ul>
                  {preview.skipped.map((row, index) => (
                    <li key={`${row.familyAccountId}-${row.reason}-${index}`}>
                      {row.accountNo || row.familyAccountId}: {row.detail}
                      {row.mobileMasked ? ` (${row.mobileMasked})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {preview.requiresNewCampaignAuthorization ? (
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontWeight: 700 }}>
                <input
                  type="checkbox"
                  checked={authorized}
                  onChange={(event) => setAuthorized(event.target.checked)}
                />
                <span>{NEW_CAMPAIGN_AUTHORIZATION_TEXT}</span>
              </label>
            ) : null}
            <p style={{ fontSize: 13, color: "#475569" }}>
              WinSMS acceptance is not handset delivery. Sending again with this same confirmation will not resend
              accepted numbers, and unconfirmed numbers are not retried automatically.
            </p>
            <button
              type="button"
              disabled={!canSend}
              onClick={confirmSend}
              style={{
                border: "1px solid #b89329",
                background: canSend ? "linear-gradient(135deg, #f7d56a, #d4af37)" : "#e2e8f0",
                borderRadius: 10,
                padding: "10px 16px",
                fontWeight: 900,
                cursor: canSend ? "pointer" : "not-allowed",
              }}
            >
              {sending ? "Sending…" : "Send payment reminder"}
            </button>
          </>
        ) : null}
        {result ? (
          <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: "#f8fafc" }}>
            <strong>{result.summary || "Reminder recorded."}</strong>
            <div>
              Accepted {result.accepted ?? 0} · Rejected {result.failed ?? 0} · Not confirmed {result.pending ?? 0}.
              Handset delivery is not shown because WinSMS acceptance is not delivery.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function reminderTemplateError(template: string): string {
  if (!template) return "Enter a reminder message before sending.";
  if (template.length > OUTSTANDING_FEES_REMINDER_TEMPLATE_MAX_CHARS) {
    return `Reminder wording is limited to ${OUTSTANDING_FEES_REMINDER_TEMPLATE_MAX_CHARS} characters.`;
  }
  const found = new Set<string>();
  const token = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(template))) found.add(match[1]);
  const allowed = new Set(["schoolName", "accountNo", "amount"]);
  for (const name of found) {
    if (!allowed.has(name)) return `Unknown placeholder {{${name}}}. Use schoolName, accountNo and amount.`;
  }
  for (const name of ["schoolName", "accountNo", "amount"]) {
    if (!found.has(name)) return `The reminder must include {{${name}}}.`;
  }
  return "";
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 12px", minWidth: 140 }}>
      <div style={{ fontSize: 18, fontWeight: 900 }}>{value}</div>
      <div style={{ fontSize: 12, color: "#64748b" }}>{label}</div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: 8 };
const td: React.CSSProperties = { padding: 8, borderTop: "1px solid #e2e8f0", verticalAlign: "top" };
