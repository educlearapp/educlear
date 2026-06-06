import React, { useCallback, useEffect, useState } from "react";
import {
  fetchCommunicationSettings,
  formatComposeSenderLabel,
  notifyCommunicationSettingsUpdated,
  resolveSchoolReplyToEmail,
  saveCommunicationSettings,
  smtpSenderFromSettings,
  type CommunicationSettings as Settings,
  type SchoolSenderContext,
} from "./communicationApi";
import {
  checkSchoolSmsCreditBalance,
  fetchSchoolSmsSettings,
  notifySchoolSmsReadinessUpdated,
  saveSchoolSmsSettings,
  SchoolSmsRequestError,
  testSchoolSmsConnection,
  type SchoolSmsSettings,
} from "./schoolSmsApi";
import {
  applySchoolSenderDefaults,
  fetchEmailProviderPresets,
  fetchSchoolEmailSettings,
  isSchoolEmailReadyForUi,
  normalizeSchoolEmailSettings,
  notifySchoolEmailReadinessUpdated,
  PROVIDER_LABELS,
  saveSchoolEmailSettings,
  testSchoolEmailConnection,
  type EmailProviderType,
  type SchoolEmailSettings as SmtpSettings,
} from "./schoolEmailApi";
import { fieldStyle, ghostBtn, goldBtn, pageWrap } from "./communicationStyles";

type Tab = "general" | "documents" | "email" | "sms";

type Props = {
  schoolId: string;
  schoolName?: string;
  schoolEmail?: string;
  onBack?: () => void;
  initialTab?: Tab;
};

const PLACEHOLDERS = "[contact_name], [document_type], [document_no], [school_name], [signature]";

function EmailSetupStatusPanel({ smtp }: { smtp: SmtpSettings }) {
  const ready = isSchoolEmailReadyForUi(smtp);
  const statusChip = (label: string, ok: boolean) => (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 800,
        background: ok ? "#ecfdf5" : "#fffbeb",
        color: ok ? "#15803d" : "#92400e",
        border: `1px solid ${ok ? "#86efac" : "#fcd34d"}`,
      }}
    >
      {label}
    </span>
  );

  return (
    <div
      style={{
        padding: 14,
        borderRadius: 10,
        border: "1px solid #e5e7eb",
        background: ready ? "#f0fdf4" : "#fffbeb",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>EMAIL SETUP STATUS</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {statusChip(
          smtp.configured ? "Email configured" : "Email not configured",
          smtp.configured
        )}
        {statusChip(
          ready ? "Test email successful" : "Test email not sent",
          ready
        )}
      </div>
      {smtp.lastTestedAt ? (
        <p style={{ margin: 0, fontSize: 12, color: "#64748b", fontWeight: 600 }}>
          Last successful test: {new Date(smtp.lastTestedAt).toLocaleString()}
        </p>
      ) : null}
      {!ready ? (
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#92400e" }}>
          {smtp.configured
            ? "SMTP is saved — send a test email to confirm delivery before statements and billing emails."
            : "Email not configured — enter SMTP details below, save, then send a test email."}
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#15803d" }}>
          Email is ready. Statements, classroom reports, and parent emails can be sent from EduClear.
        </p>
      )}
    </div>
  );
}

function smsConnectionStatusLabel(status: SchoolSmsSettings["connectionStatus"]) {
  if (status === "connected") return "Connected";
  if (status === "failed") return "Failed";
  return "Not Configured";
}

function SmsSetupStatusPanel({
  sms,
  refreshing = false,
}: {
  sms: SchoolSmsSettings;
  refreshing?: boolean;
}) {
  const status = sms.connectionStatus;
  const connected = status === "connected";
  const failed = status === "failed";
  const notConfigured = status === "not_configured";

  const panelBackground = connected ? "#f0fdf4" : failed ? "#fef2f2" : "#fafafa";
  const statusChipStyle = connected
    ? { background: "#ecfdf5", color: "#15803d", border: "1px solid #86efac" }
    : failed
      ? { background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" }
      : { background: "#fffbeb", color: "#92400e", border: "1px solid #fcd34d" };

  return (
    <div
      style={{
        padding: 14,
        borderRadius: 10,
        border: "1px solid #e5e7eb",
        background: panelBackground,
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>WINSMS STATUS</div>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: "#64748b" }}>Connection Status:</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 800,
              ...statusChipStyle,
            }}
          >
            {smsConnectionStatusLabel(status)}
          </span>
          {refreshing ? (
            <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>Refreshing balance…</span>
          ) : null}
        </div>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
          Available Credits:{" "}
          {sms.creditBalance !== null ? sms.creditBalance.toLocaleString("en-ZA") : "—"}
        </p>
        <p style={{ margin: 0, fontSize: 12, color: "#64748b", fontWeight: 600 }}>
          Last Checked:{" "}
          {sms.creditBalanceCheckedAt
            ? new Date(sms.creditBalanceCheckedAt).toLocaleString()
            : "Not checked yet"}
        </p>
      </div>
      {sms.lastConnectionError ? (
        <p style={{ margin: 0, fontSize: 12, color: "#b91c1c", fontWeight: 700 }}>
          {sms.lastConnectionError}
        </p>
      ) : null}
      {connected ? (
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#15803d" }}>
          WinSMS is connected. Parent Portal messages and school SMS can be sent from EduClear.
        </p>
      ) : failed ? (
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#b91c1c" }}>
          WinSMS is temporarily unavailable. Your last known credit balance is shown above.
        </p>
      ) : notConfigured ? (
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#92400e" }}>
          WinSMS is not configured — enter your account details below and connect.
        </p>
      ) : sms.configured ? (
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#92400e" }}>
          Account details saved — use Test Connection to verify your WinSMS account.
        </p>
      ) : null}
    </div>
  );
}

export default function CommunicationSettings({
  schoolId,
  schoolName = "",
  schoolEmail = "",
  onBack,
  initialTab = "general",
}: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [resolvedSchoolName, setResolvedSchoolName] = useState(schoolName);
  const [resolvedSchoolEmail, setResolvedSchoolEmail] = useState(schoolEmail);
  const [winSmsKeyInput, setWinSmsKeyInput] = useState("");
  const [smsSettings, setSmsSettings] = useState<SchoolSmsSettings | null>(null);
  const [smsTestLoading, setSmsTestLoading] = useState(false);
  const [smsBalanceLoading, setSmsBalanceLoading] = useState(false);
  const [smsBalanceRefreshing, setSmsBalanceRefreshing] = useState(false);
  const [smtpSettings, setSmtpSettings] = useState<SmtpSettings | null>(null);
  const [smtpPassInput, setSmtpPassInput] = useState("");
  const [smtpPresets, setSmtpPresets] = useState<Record<EmailProviderType, { smtpHost: string; smtpPort: number; smtpSecure: boolean; hint?: string }> | null>(null);
  const [testEmailTo, setTestEmailTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [smtpTestLoading, setSmtpTestLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const applySmsSettings = useCallback(
    (next: SchoolSmsSettings) => {
      setSmsSettings(next);
      notifySchoolSmsReadinessUpdated(schoolId, next);
    },
    [schoolId]
  );

  const refreshSmsBalanceInBackground = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!schoolId) return;
      setSmsBalanceRefreshing(true);
      try {
        const res = await checkSchoolSmsCreditBalance(schoolId);
        applySmsSettings(res.settings);
      } catch (e: unknown) {
        if (e instanceof SchoolSmsRequestError) {
          applySmsSettings(e.settings);
        }
        if (!opts?.silent) {
          const message =
            e instanceof Error ? e.message : "Failed to check credit balance";
          setError(message);
        }
      } finally {
        setSmsBalanceRefreshing(false);
      }
    },
    [schoolId, applySmsSettings]
  );

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    setError("");
    try {
      const [res, smtpRes, smsRes, presetRes] = await Promise.all([
        fetchCommunicationSettings(schoolId),
        fetchSchoolEmailSettings(schoolId).catch(() => null),
        fetchSchoolSmsSettings(schoolId).catch(() => null),
        fetchEmailProviderPresets().catch(() => null),
      ]);
      setSettings(res.settings);
      const loadedSchoolName = String(res.schoolName || schoolName || "").trim();
      const loadedSchoolEmail = String(res.schoolEmail || schoolEmail || "").trim();
      setResolvedSchoolName(loadedSchoolName);
      setResolvedSchoolEmail(loadedSchoolEmail);
      setWinSmsKeyInput("");
      const loadedSmsSettings =
        smsRes?.settings || {
          schoolId,
          provider: "WinSMS",
          apiKeySet: false,
          configured: false,
          connectionStatus: "not_configured",
          creditBalance: null,
          creditBalanceCheckedAt: null,
          connectionTestedAt: null,
          lastConnectionError: null,
          ready: false,
        };
      setSmsSettings(loadedSmsSettings);
      if (smsRes?.settings) {
        notifySchoolSmsReadinessUpdated(schoolId, smsRes.settings);
      }
      if (loadedSmsSettings.configured) {
        void refreshSmsBalanceInBackground({ silent: true });
      }
      const smtpBase: SmtpSettings = smtpRes?.settings
        ? smtpRes.settings
        : {
            schoolId,
            provider: "gmail",
            smtpHost: "smtp.gmail.com",
            smtpPort: 587,
            smtpSecure: false,
            smtpUser: "",
            smtpPass: "",
            smtpPassSet: false,
            fromEmail: "",
            fromName: "",
            replyTo: "",
            configured: false,
            tested: false,
            testEmailPassed: false,
            lastTestedAt: null,
            ready: false,
          };
      const nextSmtp = normalizeSchoolEmailSettings(
        applySchoolSenderDefaults(smtpBase, loadedSchoolName, loadedSchoolEmail)
      );
      setSmtpSettings(nextSmtp);
      notifySchoolEmailReadinessUpdated(schoolId, nextSmtp);
      if (presetRes?.presets) setSmtpPresets(presetRes.presets);
      setSmtpPassInput("");
    } catch (e: any) {
      setError(e?.message || "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [schoolId, schoolName, schoolEmail, refreshSmsBalanceInBackground]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const patch = (partial: Partial<Settings>) => {
    setSettings((prev) => (prev ? { ...prev, ...partial } : prev));
  };

  const handleSave = async () => {
    if (!schoolId || !settings) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const payload: Partial<Settings> = { ...settings };
      const res = await saveCommunicationSettings(schoolId, payload);
      setSettings(res.settings);
      const nextSchool: SchoolSenderContext = {
        schoolName: String(res.schoolName || resolvedSchoolName || schoolName || "School").trim() || "School",
        schoolEmail: String(res.schoolEmail || resolvedSchoolEmail || schoolEmail || "").trim(),
      };
      setResolvedSchoolName(nextSchool.schoolName || "");
      setResolvedSchoolEmail(nextSchool.schoolEmail || "");
      notifyCommunicationSettingsUpdated(
        schoolId,
        res.settings,
        nextSchool,
        smtpSettings ? smtpSenderFromSettings(smtpSettings) : null
      );
      setMessage("Settings saved. Compose sender updated.");
    } catch (e: any) {
      setError(e?.message || "Failed to save settings");
    } finally {
      setLoading(false);
    }
  };

  const patchSmtp = (partial: Partial<SmtpSettings>) => {
    setSmtpSettings((prev) => (prev ? { ...prev, ...partial } : prev));
  };

  const applyProviderPreset = (provider: EmailProviderType) => {
    const preset = smtpPresets?.[provider];
    if (!preset) {
      patchSmtp({ provider });
      return;
    }
    patchSmtp({
      provider,
      smtpHost: provider === "custom" ? smtpSettings?.smtpHost || "" : preset.smtpHost,
      smtpPort: preset.smtpPort,
      smtpSecure: preset.smtpSecure,
    });
  };

  const buildSmtpSavePayload = (): Parameters<typeof saveSchoolEmailSettings>[0] | null => {
    if (!schoolId || !smtpSettings) return null;
    const payload: Parameters<typeof saveSchoolEmailSettings>[0] = {
      schoolId,
      provider: smtpSettings.provider,
      smtpHost: smtpSettings.smtpHost,
      smtpPort: smtpSettings.smtpPort,
      smtpSecure: smtpSettings.smtpSecure,
      smtpUser:
        smtpSettings.smtpUser.trim() ||
        smtpSettings.fromEmail.trim() ||
        (resolvedSchoolEmail || schoolEmail || "").trim(),
      fromEmail: smtpSettings.fromEmail,
      fromName: smtpSettings.fromName,
      replyTo: smtpSettings.replyTo,
    };
    if (smtpPassInput && smtpPassInput !== "********") {
      payload.smtpPass = smtpPassInput;
    }
    return payload;
  };

  const persistSmtpSettings = async (opts?: { quiet?: boolean }) => {
    const payload = buildSmtpSavePayload();
    if (!payload) throw new Error("Missing SMTP settings");
    const res = await saveSchoolEmailSettings(payload);
    const nextSmtp = normalizeSchoolEmailSettings(
      applySchoolSenderDefaults(
        res.settings,
        resolvedSchoolName || schoolName,
        resolvedSchoolEmail || schoolEmail
      )
    );
    setSmtpSettings(nextSmtp);
    notifySchoolEmailReadinessUpdated(schoolId, nextSmtp);
    setSmtpPassInput("");
    if (settings) {
      notifyCommunicationSettingsUpdated(
        schoolId,
        settings,
        {
          schoolName: resolvedSchoolName || schoolName || "School",
          schoolEmail: resolvedSchoolEmail || schoolEmail,
        },
        smtpSenderFromSettings(nextSmtp)
      );
    }
    if (!opts?.quiet) {
      setMessage("Email (SMTP) settings saved. Compose sender updated.");
    }
    return nextSmtp;
  };

  const handleSaveSmtp = async () => {
    if (!schoolId || !smtpSettings) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await persistSmtpSettings();
    } catch (e: any) {
      setError(e?.errors?.join?.(", ") || e?.message || "Failed to save email settings");
    } finally {
      setLoading(false);
    }
  };

  const applySmtpFromServer = (raw: SmtpSettings) => {
    const nextSmtp = normalizeSchoolEmailSettings(
      applySchoolSenderDefaults(raw, resolvedSchoolName || schoolName, resolvedSchoolEmail || schoolEmail)
    );
    setSmtpSettings(nextSmtp);
    notifySchoolEmailReadinessUpdated(schoolId, nextSmtp);
    return nextSmtp;
  };

  const handleTestEmail = async () => {
    if (!schoolId || !smtpSettings) return;
    setSmtpTestLoading(true);
    setError("");
    setMessage("");
    try {
      try {
        await persistSmtpSettings({ quiet: true });
      } catch (saveErr: unknown) {
        const saveMessage =
          saveErr instanceof Error
            ? saveErr.message
            : "Could not save SMTP settings before sending the test email.";
        throw new Error(`Save before test failed: ${saveMessage}`);
      }

      const res = await testSchoolEmailConnection(schoolId, testEmailTo.trim() || undefined);
      if (res.settings) {
        applySmtpFromServer(res.settings);
      } else if (res.lastTestedAt && smtpSettings) {
        applySmtpFromServer(
          normalizeSchoolEmailSettings({
            ...smtpSettings,
            tested: true,
            testEmailPassed: true,
            lastTestedAt: res.lastTestedAt,
            ready: true,
            configured: true,
          })
        );
      }

      setMessage(
        res.sentTo
          ? `Test email sent successfully to ${res.sentTo}.`
          : res.message || "Test email sent successfully."
      );
    } catch (e: unknown) {
      const err = e as { setupRequired?: boolean; message?: string };
      if (err?.setupRequired) {
        setError(
          "Email not configured: enter SMTP host, username, and app password, save, then send a test email."
        );
      } else {
        setError(err?.message || "Test email failed");
      }
    } finally {
      setSmtpTestLoading(false);
    }
  };

  const handleConnectWinSms = async () => {
    if (!schoolId || !settings) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const username = String(settings.winSmsUsername || "").trim();
      if (!username) {
        throw new Error("Enter your WinSMS username or email.");
      }

      await saveCommunicationSettings(schoolId, {
        winSmsUsername: username,
        smsProvider: "WinSMS",
      });

      const payload: { schoolId: string; provider?: string; apiKey?: string } = {
        schoolId,
        provider: "WinSMS",
      };
      if (winSmsKeyInput && winSmsKeyInput !== "********") {
        payload.apiKey = winSmsKeyInput;
      } else if (!smsSettings?.apiKeySet) {
        throw new Error("Enter your WinSMS account details to connect.");
      }
      const res = await saveSchoolSmsSettings(payload);
      applySmsSettings(res.settings);
      setWinSmsKeyInput("");
      setMessage("WinSMS account saved. Use Test Connection to verify.");
    } catch (e: any) {
      setError(e?.message || "Could not connect WinSMS account");
    } finally {
      setLoading(false);
    }
  };

  const handleTestSms = async () => {
    if (!schoolId) return;
    setSmsTestLoading(true);
    setError("");
    setMessage("");
    try {
      if (winSmsKeyInput && winSmsKeyInput !== "********") {
        await saveSchoolSmsSettings({
          schoolId,
          provider: "WinSMS",
          apiKey: winSmsKeyInput,
        });
      }

      const res = await testSchoolSmsConnection(
        schoolId,
        winSmsKeyInput && winSmsKeyInput !== "********" ? winSmsKeyInput : undefined
      );
      applySmsSettings(res.settings);
      setWinSmsKeyInput("");
      setMessage(
        res.message ||
          `Connected. Available Credits: ${Number(res.creditBalance || 0).toLocaleString("en-ZA")}`
      );
    } catch (e: unknown) {
      if (e instanceof SchoolSmsRequestError) {
        applySmsSettings(e.settings);
      }
      setError(e instanceof Error ? e.message : "Connection test failed");
    } finally {
      setSmsTestLoading(false);
    }
  };

  const handleCheckSmsBalance = async () => {
    if (!schoolId) return;
    setSmsBalanceLoading(true);
    setError("");
    setMessage("");
    try {
      const res = await checkSchoolSmsCreditBalance(schoolId);
      applySmsSettings(res.settings);
      setMessage(`Available Credits: ${Number(res.creditBalance || 0).toLocaleString("en-ZA")}`);
    } catch (e: unknown) {
      if (e instanceof SchoolSmsRequestError) {
        applySmsSettings(e.settings);
      }
      setError(e instanceof Error ? e.message : "Failed to check credit balance");
    } finally {
      setSmsBalanceLoading(false);
    }
  };

  if (!settings && loading) {
    return (
      <div style={pageWrap}>
        <p style={{ fontWeight: 700, color: "#64748b" }}>Loading communication settings…</p>
      </div>
    );
  }

  if (!settings) {
    return (
      <div style={pageWrap}>
        <p style={{ color: "#b91c1c", fontWeight: 700 }}>{error || "Could not load settings"}</p>
      </div>
    );
  }

  const schoolCtx: SchoolSenderContext = {
    schoolName: resolvedSchoolName || schoolName || "School",
    schoolEmail: resolvedSchoolEmail || schoolEmail,
  };
  const smtpCtx = smtpSettings ? smtpSenderFromSettings(smtpSettings) : null;
  const senderPreview = formatComposeSenderLabel(settings, schoolCtx, smtpCtx);
  const replyToEmail = resolveSchoolReplyToEmail(settings, schoolCtx, smtpCtx);
  const emailSetupIncomplete = Boolean(smtpSettings && !isSchoolEmailReadyForUi(smtpSettings));

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      key={id}
      onClick={() => setTab(id)}
      style={{
        padding: "10px 16px",
        borderRadius: 10,
        border: tab === id ? "1px solid #b89329" : "1px solid #e5e7eb",
        background: tab === id ? "linear-gradient(135deg, #f7d56a, #d4af37)" : "#fff",
        fontWeight: 900,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ ...pageWrap, border: "none", padding: 0, background: "transparent" }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        {tabBtn("general", "General")}
        {tabBtn("documents", "Documents")}
        {tabBtn("email", "Email (SMTP)")}
        {tabBtn("sms", "SMS")}
      </div>

      {message ? (
        <div style={{ marginBottom: 12, padding: 12, borderRadius: 10, background: "#ecfdf5", color: "#15803d", fontWeight: 700 }}>{message}</div>
      ) : null}
      {error ? (
        <div style={{ marginBottom: 12, padding: 12, borderRadius: 10, background: "#fef2f2", color: "#b91c1c", fontWeight: 700 }}>{error}</div>
      ) : null}

      {emailSetupIncomplete ? (
        <div
          style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: 10,
            background: "#fffbeb",
            border: "1px solid #fcd34d",
            color: "#92400e",
            fontWeight: 700,
            fontSize: 13,
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>Email setup incomplete — configure SMTP and pass a test email before sending statements.</span>
          <button type="button" style={ghostBtn} onClick={() => setTab("email")}>
            Open Email (SMTP)
          </button>
        </div>
      ) : null}

      {tab === "general" ? (
        <div style={{ display: "grid", gap: 16, maxWidth: 640 }}>
          <div
            style={{
              padding: 14,
              borderRadius: 10,
              border: "1px solid #e5e7eb",
              background: "#fafafa",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b", marginBottom: 6 }}>
              COMPOSE SENDER PREVIEW
            </div>
            <div style={{ fontWeight: 900, color: "#0f172a" }}>{senderPreview}</div>
            <div style={{ marginTop: 6, fontSize: 12, color: "#64748b" }}>
              Parents reply to <strong>{replyToEmail}</strong>
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700 }}>
            <input
              type="checkbox"
              checked={settings.sendViaEduClearDomain}
              onChange={(e) => patch({ sendViaEduClearDomain: e.target.checked })}
            />
            Send via EduClear Domain
          </label>
          <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
            When enabled, the From address uses the EduClear relay (billing@educlear.co.za). Parent replies still go to{" "}
            <strong>{replyToEmail}</strong>.
          </p>

          <label>
            Administration Email
            <input
              style={fieldStyle}
              value={settings.administrationEmail}
              onChange={(e) => patch({ administrationEmail: e.target.value })}
            />
            <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
              Used as the compose From address when SMTP is not configured and the school has no registered email on file.
            </span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700 }}>
            <input
              type="checkbox"
              checked={settings.administrationCcSelf}
              onChange={(e) => patch({ administrationCcSelf: e.target.checked })}
            />
            CC Myself
          </label>

          <label>
            Billing Email
            <input style={fieldStyle} value={settings.billingEmail} onChange={(e) => patch({ billingEmail: e.target.value })} />
            <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
              Used for billing CC notifications — not the compose From address when Send via EduClear Domain is enabled.
            </span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700 }}>
            <input type="checkbox" checked={settings.billingCcSelf} onChange={(e) => patch({ billingCcSelf: e.target.checked })} />
            CC Myself
          </label>

          <label>
            Signature
            <textarea
              style={{ ...fieldStyle, minHeight: 120 }}
              value={settings.signature}
              onChange={(e) => patch({ signature: e.target.value })}
            />
          </label>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {onBack ? (
              <button type="button" style={ghostBtn} onClick={onBack}>
                ← Back
              </button>
            ) : null}
            <button type="button" style={goldBtn} onClick={handleSave} disabled={loading}>
              Save
            </button>
          </div>
        </div>
      ) : null}

      {tab === "documents" ? (
        <div style={{ display: "grid", gap: 16, maxWidth: 720 }}>
          <p style={{ margin: 0, fontSize: 12, color: "#64748b", fontWeight: 700 }}>Placeholders: {PLACEHOLDERS}</p>
          <label>
            Standard Email Subject
            <input
              style={fieldStyle}
              value={settings.standardEmailSubject}
              onChange={(e) => patch({ standardEmailSubject: e.target.value })}
            />
          </label>
          <label>
            Standard Email Message
            <textarea
              style={{ ...fieldStyle, minHeight: 160 }}
              value={settings.standardEmailMessage}
              onChange={(e) => patch({ standardEmailMessage: e.target.value })}
            />
          </label>
          <label>
            Standard SMS Message
            <textarea
              style={{ ...fieldStyle, minHeight: 100 }}
              value={settings.standardSmsMessage}
              onChange={(e) => patch({ standardSmsMessage: e.target.value })}
            />
          </label>
          <button type="button" style={goldBtn} onClick={handleSave} disabled={loading}>
            Save
          </button>
        </div>
      ) : null}

      {tab === "email" ? (
        <div style={{ display: "grid", gap: 16, maxWidth: 640 }}>
          {!smtpSettings ? (
            <p style={{ color: "#64748b", fontWeight: 700 }}>Loading email settings…</p>
          ) : (
            <>
              <EmailSetupStatusPanel smtp={smtpSettings} />

              <label>
                Email Provider
                <select
                  style={fieldStyle}
                  value={smtpSettings.provider}
                  onChange={(e) => applyProviderPreset(e.target.value as EmailProviderType)}
                >
                  {(Object.keys(PROVIDER_LABELS) as EmailProviderType[]).map((key) => (
                    <option key={key} value={key}>
                      {PROVIDER_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>
              {smtpPresets?.[smtpSettings.provider]?.hint ? (
                <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>{smtpPresets[smtpSettings.provider].hint}</p>
              ) : null}

              <label>
                SMTP Host
                <input
                  style={fieldStyle}
                  value={smtpSettings.smtpHost}
                  disabled={smtpSettings.provider !== "custom"}
                  onChange={(e) => patchSmtp({ smtpHost: e.target.value })}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label>
                  Port
                  <input
                    type="number"
                    style={fieldStyle}
                    value={smtpSettings.smtpPort}
                    onChange={(e) => patchSmtp({ smtpPort: Number(e.target.value) || 587 })}
                  />
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, marginTop: 22 }}>
                  <input
                    type="checkbox"
                    checked={smtpSettings.smtpSecure}
                    onChange={(e) => patchSmtp({ smtpSecure: e.target.checked })}
                  />
                  SSL/TLS (port 465)
                </label>
              </div>
              <label>
                SMTP Username
                <input
                  style={fieldStyle}
                  placeholder={
                    smtpSettings.fromEmail ||
                    resolvedSchoolEmail ||
                    schoolEmail ||
                    "Usually your school email address"
                  }
                  value={smtpSettings.smtpUser}
                  onChange={(e) => patchSmtp({ smtpUser: e.target.value })}
                />
                <span style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
                  For Gmail, use the same address as From Email (e.g. your school inbox).
                </span>
              </label>
              <label>
                Password / App Password
                <input
                  type="password"
                  style={fieldStyle}
                  placeholder={smtpSettings.smtpPassSet ? "******** (unchanged)" : "Enter password"}
                  value={smtpPassInput}
                  onChange={(e) => setSmtpPassInput(e.target.value)}
                />
              </label>
              <label>
                From Email
                <input
                  style={fieldStyle}
                  value={smtpSettings.fromEmail}
                  onChange={(e) => patchSmtp({ fromEmail: e.target.value })}
                />
              </label>
              <label>
                From Name
                <input
                  style={fieldStyle}
                  value={smtpSettings.fromName}
                  onChange={(e) => patchSmtp({ fromName: e.target.value })}
                />
              </label>
              <label>
                Reply-To
                <input
                  style={fieldStyle}
                  value={smtpSettings.replyTo}
                  onChange={(e) => patchSmtp({ replyTo: e.target.value })}
                />
              </label>
              <label>
                Test recipient (optional)
                <input
                  style={fieldStyle}
                  placeholder="Defaults to From Email"
                  value={testEmailTo}
                  onChange={(e) => setTestEmailTo(e.target.value)}
                />
              </label>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  style={ghostBtn}
                  onClick={handleTestEmail}
                  disabled={loading || smtpTestLoading}
                >
                  {smtpTestLoading ? "Sending test…" : "Send Test Email"}
                </button>
                <button type="button" style={goldBtn} onClick={handleSaveSmtp} disabled={loading || smtpTestLoading}>
                  Save Email Settings
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {tab === "sms" ? (
        <div style={{ display: "grid", gap: 16, maxWidth: 560 }}>
          {!smsSettings ? (
            <p style={{ color: "#64748b", fontWeight: 700 }}>Loading SMS settings…</p>
          ) : (
            <>
              <SmsSetupStatusPanel
                sms={smsSettings}
                refreshing={smsBalanceRefreshing || smsBalanceLoading}
              />

              <div
                style={{
                  padding: 14,
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  background: "#fafafa",
                  display: "grid",
                  gap: 14,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 900, color: "#64748b" }}>WINSMS ACCOUNT</div>

                <label>
                  Username / Email
                  <input
                    style={fieldStyle}
                    placeholder="Your WinSMS login email"
                    value={settings.winSmsUsername}
                    onChange={(e) => patch({ winSmsUsername: e.target.value })}
                    autoComplete="username"
                  />
                </label>

                <label>
                  API Key
                  <input
                    type="password"
                    style={fieldStyle}
                    placeholder={smsSettings.apiKeySet ? "******** (unchanged)" : "From your WinSMS account"}
                    value={winSmsKeyInput}
                    onChange={(e) => setWinSmsKeyInput(e.target.value)}
                    autoComplete="off"
                  />
                </label>

                <p style={{ margin: 0, fontSize: 12, color: "#64748b", fontWeight: 600, lineHeight: 1.5 }}>
                  Register and purchase SMS credits directly from WinSMS. Once you have your WinSMS account,
                  enter your details above and click Connect.
                </p>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    style={goldBtn}
                    onClick={handleConnectWinSms}
                    disabled={loading || smsTestLoading || smsBalanceLoading}
                  >
                    Connect WinSMS
                  </button>
                  <button
                    type="button"
                    style={ghostBtn}
                    onClick={handleTestSms}
                    disabled={loading || smsTestLoading || smsBalanceLoading || !smsSettings.configured}
                  >
                    {smsTestLoading ? "Testing…" : "Test Connection"}
                  </button>
                  <button
                    type="button"
                    style={ghostBtn}
                    onClick={handleCheckSmsBalance}
                    disabled={loading || smsTestLoading || smsBalanceLoading || !smsSettings.configured}
                  >
                    {smsBalanceLoading ? "Refreshing…" : "Refresh Credit Balance"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
