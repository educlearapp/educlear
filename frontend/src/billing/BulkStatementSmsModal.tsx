import React, { useEffect, useMemo, useState } from "react";
import { formatMoney } from "./billingLedger";
import {
  BULK_STATEMENT_SMS_DEFAULT_TEMPLATE,
  collectBulkSmsPreviewRecipients,
  estimateBulkTemplateSegments,
  fetchBulkStatementSmsPreview,
  formatBulkSmsFailureSummary,
  formatBulkSmsPreviewRecipientLine,
  sendBulkStatementSmsRequest,
  STATEMENT_SMS_MAX_CHARS,
  type BulkStatementSmsPreview,
  type BulkStatementSmsRecipientStrategy,
  type BulkStatementSmsSendResponse,
} from "./statementBulkSmsApi";

const GOLD = "#d4af37";
const INK = "#111827";

type Props = {
  schoolId: string;
  familyAccountIds: string[];
  selectedCount: number;
  selectedTotalOutstanding: number;
  onClose: () => void;
  onSent?: () => void;
};

type Step = 1 | 2 | 3 | 4 | 5;

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
  width: "min(720px, 100%)",
  maxHeight: "92vh",
  overflow: "auto",
  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
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

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  fontWeight: 600,
  boxSizing: "border-box",
};

function disabledBtn(base: React.CSSProperties, locked: boolean): React.CSSProperties {
  return {
    ...base,
    opacity: locked ? 0.55 : 1,
    cursor: locked ? "not-allowed" : "pointer",
  };
}

export default function BulkStatementSmsModal({
  schoolId,
  familyAccountIds,
  selectedCount,
  selectedTotalOutstanding,
  onClose,
  onSent,
}: Props) {
  const [step, setStep] = useState<Step>(1);
  const [strategy, setStrategy] = useState<BulkStatementSmsRecipientStrategy>("recommended");
  const [messageTemplate, setMessageTemplate] = useState(BULK_STATEMENT_SMS_DEFAULT_TEMPLATE);
  const [preview, setPreview] = useState<BulkStatementSmsPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<BulkStatementSmsSendResponse | null>(null);
  const [sendError, setSendError] = useState("");

  const templateSegments = useMemo(
    () => estimateBulkTemplateSegments(messageTemplate),
    [messageTemplate]
  );

  useEffect(() => {
    if (step !== 4) return;
    let cancelled = false;
    async function load() {
      setPreviewLoading(true);
      setPreviewError("");
      try {
        const data = await fetchBulkStatementSmsPreview({
          schoolId,
          familyAccountIds,
          recipientStrategy: strategy,
          messageTemplate,
        });
        if (!cancelled) setPreview(data);
      } catch (err) {
        if (!cancelled) {
          setPreview(null);
          setPreviewError(err instanceof Error ? err.message : "Preview failed.");
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [step, schoolId, familyAccountIds, strategy, messageTemplate]);

  const skippedAccounts = (preview?.accounts || []).filter((a) => a.status === "skipped");
  const previewRecipients = collectBulkSmsPreviewRecipients(preview);
  const canAdvanceFromMessage =
    Boolean(messageTemplate.trim()) && messageTemplate.trim().length <= STATEMENT_SMS_MAX_CHARS;

  async function handleSend() {
    if (sending || !preview?.canSend) return;
    setSending(true);
    setSendError("");
    try {
      const result = await sendBulkStatementSmsRequest({
        schoolId,
        familyAccountIds,
        recipientStrategy: strategy,
        messageTemplate,
      });
      setSendResult(result);
      setStep(5);
      onSent?.();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Bulk SMS send failed.");
    } finally {
      setSending(false);
    }
  }

  function copyFailureSummary() {
    if (!sendResult) return;
    const text = formatBulkSmsFailureSummary(sendResult);
    void navigator.clipboard?.writeText(text);
  }

  return (
    <div style={overlay} role="dialog" aria-modal="true" aria-label="Bulk Statement SMS">
      <div style={panel}>
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontWeight: 900, fontSize: 18, color: INK }}>Bulk Statement SMS</div>
            <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>
              Step {step} of 5 · Outstanding accounts only
            </div>
          </div>
          <button
            type="button"
            style={disabledBtn(ghostBtn, sending)}
            disabled={sending}
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div style={{ padding: 20 }}>
          {step === 1 ? (
            <div>
              <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 8 }}>Selection summary</div>
              <div style={{ fontSize: 14, color: "#334155", lineHeight: 1.6 }}>
                <div>
                  Selected accounts: <strong>{selectedCount}</strong>
                </div>
                <div>
                  Family accounts for SMS: <strong>{familyAccountIds.length}</strong>
                </div>
                <div>
                  Total outstanding (UI): <strong>{formatMoney(selectedTotalOutstanding)}</strong>
                </div>
                <div style={{ marginTop: 10, color: "#64748b", fontSize: 13 }}>
                  Server will re-check each balance and only send for accounts that still have an
                  outstanding balance greater than R0.00.
                </div>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div>
              <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 8 }}>Recipient strategy</div>
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 12 }}>
                <input
                  type="radio"
                  name="bulkSmsStrategy"
                  checked={strategy === "recommended"}
                  onChange={() => setStrategy("recommended")}
                />
                <span>
                  <strong>Recommended parent only</strong>
                  <div style={{ fontSize: 13, color: "#64748b" }}>
                    One ranked billing SMS contact per account (default).
                  </div>
                </span>
              </label>
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <input
                  type="radio"
                  name="bulkSmsStrategy"
                  checked={strategy === "all_eligible"}
                  onChange={() => setStrategy("all_eligible")}
                />
                <span>
                  <strong>All eligible billing parents</strong>
                  <div style={{ fontSize: 13, color: "#64748b" }}>
                    Every eligible parent with SMS consent. Duplicate numbers still send once.
                  </div>
                </span>
              </label>
            </div>
          ) : null}

          {step === 3 ? (
            <div>
              <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 8 }}>Message template</div>
              <div style={{ fontSize: 13, color: "#64748b", marginBottom: 8 }}>
                Placeholders: {"{{schoolName}}"}, {"{{accountNo}}"}, {"{{amount}}"} — rendered per
                account on the server.
              </div>
              <textarea
                style={{ ...fieldStyle, minHeight: 120, fontFamily: "inherit", resize: "vertical" }}
                value={messageTemplate}
                maxLength={STATEMENT_SMS_MAX_CHARS}
                onChange={(e) => setMessageTemplate(e.target.value.slice(0, STATEMENT_SMS_MAX_CHARS))}
              />
              <div style={{ marginTop: 8, fontSize: 12, color: "#64748b", fontWeight: 700 }}>
                {messageTemplate.trim().length}/{STATEMENT_SMS_MAX_CHARS} characters · ~
                {templateSegments} SMS segment
                {templateSegments === 1 ? "" : "s"} (before per-account substitution)
              </div>
              <button
                type="button"
                style={{ ...ghostBtn, marginTop: 10 }}
                onClick={() => setMessageTemplate(BULK_STATEMENT_SMS_DEFAULT_TEMPLATE)}
              >
                Reset to default
              </button>
            </div>
          ) : null}

          {step === 4 ? (
            <div>
              <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 8 }}>Final preview</div>
              {previewLoading ? (
                <div style={{ color: "#64748b", fontWeight: 700 }}>Building preview…</div>
              ) : previewError ? (
                <div style={{ color: "#991b1b", fontWeight: 700 }}>{previewError}</div>
              ) : preview ? (
                <div style={{ fontSize: 14, color: "#334155", lineHeight: 1.65 }}>
                  {preview.outboundDisabled ? (
                    <div
                      style={{
                        marginBottom: 12,
                        padding: 12,
                        borderRadius: 10,
                        background: "#fef2f2",
                        border: "1px solid #fecaca",
                        color: "#991b1b",
                        fontWeight: 800,
                      }}
                    >
                      Outbound SMS is disabled for this environment.
                    </div>
                  ) : null}
                  {!preview.smsReady ? (
                    <div
                      style={{
                        marginBottom: 12,
                        padding: 12,
                        borderRadius: 10,
                        background: "#fff7ed",
                        border: "1px solid #fed7aa",
                        color: "#9a3412",
                        fontWeight: 800,
                      }}
                    >
                      WinSMS is not configured or not connected for this school.
                    </div>
                  ) : null}
                  <div>Selected accounts: {preview.requestedAccountCount}</div>
                  <div>Eligible accounts: {preview.eligibleAccountCount}</div>
                  <div>Skipped accounts: {preview.skippedAccountCount}</div>
                  <div>Eligible destinations: {preview.destinationCount}</div>
                  <div>Duplicate numbers removed: {preview.duplicateNumbersRemoved}</div>
                  <div>Total outstanding: {formatMoney(preview.totalOutstanding)}</div>
                  <div>Estimated SMS segments: {preview.estimatedSegments}</div>
                  <div>
                    Strategy:{" "}
                    {preview.recipientStrategy === "all_eligible"
                      ? "All eligible parents"
                      : "Recommended parent"}
                  </div>
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>
                      Recipients who will receive this SMS
                    </div>
                    {previewRecipients.length ? (
                      <ul
                        style={{
                          margin: 0,
                          padding: "10px 12px 10px 28px",
                          borderRadius: 10,
                          background: "#f8fafc",
                          border: "1px solid #e2e8f0",
                          listStyleType: "disc",
                        }}
                      >
                        {previewRecipients.map((row, idx) => (
                          <li
                            key={`${row.accountNo}-${row.mobileMasked}-${idx}`}
                            style={{ fontSize: 13, marginBottom: 4, fontWeight: 700 }}
                          >
                            {formatBulkSmsPreviewRecipientLine(row)}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div style={{ fontSize: 13, color: "#9a3412", fontWeight: 700 }}>
                        No eligible recipients for the current selection.
                      </div>
                    )}
                  </div>
                  {preview.sampleMessages.length ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontWeight: 800, marginBottom: 6 }}>Sample messages</div>
                      {preview.sampleMessages.map((msg, idx) => (
                        <div
                          key={`${idx}-${msg.slice(0, 24)}`}
                          style={{
                            padding: 10,
                            borderRadius: 10,
                            background: "#f8fafc",
                            border: "1px solid #e2e8f0",
                            marginBottom: 8,
                            fontSize: 13,
                          }}
                        >
                          {msg}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {skippedAccounts.length ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontWeight: 800, marginBottom: 6, color: "#9a3412" }}>
                        Accounts with no eligible SMS parent / skipped
                      </div>
                      {skippedAccounts.map((row) => (
                        <div key={row.familyAccountId} style={{ fontSize: 13, marginBottom: 4 }}>
                          {row.accountNo || row.familyAccountId}: {row.skipMessage || row.skipReason}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {sendError ? (
                <div style={{ marginTop: 10, color: "#991b1b", fontWeight: 700 }}>{sendError}</div>
              ) : null}
            </div>
          ) : null}

          {step === 5 && sendResult ? (
            <div>
              <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 8 }}>Send result</div>
              <div style={{ fontSize: 14, lineHeight: 1.65, color: "#334155" }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>
                  {sendResult.summary || (sendResult.success ? "Completed" : "Failed")}
                </div>
                <div>Successful destinations: {sendResult.successfulDestinations ?? 0}</div>
                <div>Failed destinations: {sendResult.failedDestinations ?? 0}</div>
                <div>Skipped accounts: {sendResult.skippedAccountCount ?? 0}</div>
                {(sendResult.failedDestinations || 0) > 0 ||
                (sendResult.skippedAccountCount || 0) > 0 ? (
                  <button type="button" style={{ ...ghostBtn, marginTop: 12 }} onClick={copyFailureSummary}>
                    Copy failure summary
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div
          style={{
            padding: "14px 20px",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div>
            {step > 1 && step < 5 ? (
              <button
                type="button"
                style={disabledBtn(ghostBtn, sending)}
                disabled={sending}
                onClick={() => setStep((s) => (s > 1 ? ((s - 1) as Step) : s))}
              >
                Back
              </button>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {step < 4 ? (
              <button
                type="button"
                style={disabledBtn(goldBtn, step === 3 && !canAdvanceFromMessage)}
                disabled={step === 3 && !canAdvanceFromMessage}
                onClick={() => {
                  if (step === 1 && !familyAccountIds.length) return;
                  setStep((s) => ((s + 1) as Step));
                }}
              >
                Continue
              </button>
            ) : null}
            {step === 4 ? (
              <button
                type="button"
                style={disabledBtn(
                  goldBtn,
                  sending || previewLoading || !preview?.canSend || Boolean(previewError)
                )}
                disabled={sending || previewLoading || !preview?.canSend || Boolean(previewError)}
                onClick={handleSend}
              >
                {sending ? "Sending…" : "Send SMS"}
              </button>
            ) : null}
            {step === 5 ? (
              <button type="button" style={goldBtn} onClick={onClose}>
                Done
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
