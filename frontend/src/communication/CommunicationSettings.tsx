import React, { useCallback, useEffect, useState } from "react";
import {
  fetchCommunicationSettings,
  formatComposeSenderLabel,
  notifyCommunicationSettingsUpdated,
  resolveSchoolSenderEmail,
  saveCommunicationSettings,
  testSmsCredentials,
  type CommunicationSettings as Settings,
  type SchoolSenderContext,
} from "./communicationApi";
import { fieldStyle, ghostBtn, goldBtn, pageWrap } from "./communicationStyles";

type Props = {
  schoolId: string;
  schoolName?: string;
  schoolEmail?: string;
  onBack?: () => void;
};

type Tab = "general" | "documents" | "sms";

const PLACEHOLDERS = "[contact_name], [document_type], [document_no], [school_name], [signature]";

export default function CommunicationSettings({ schoolId, schoolName = "", schoolEmail = "", onBack }: Props) {
  const [tab, setTab] = useState<Tab>("general");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [resolvedSchoolName, setResolvedSchoolName] = useState(schoolName);
  const [resolvedSchoolEmail, setResolvedSchoolEmail] = useState(schoolEmail);
  const [winSmsPasswordInput, setWinSmsPasswordInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetchCommunicationSettings(schoolId);
      setSettings(res.settings);
      setResolvedSchoolName(String(res.schoolName || schoolName || "").trim());
      setResolvedSchoolEmail(String(res.schoolEmail || schoolEmail || "").trim());
      setWinSmsPasswordInput("");
    } catch (e: any) {
      setError(e?.message || "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, [schoolId, schoolName, schoolEmail]);

  useEffect(() => {
    load();
  }, [load]);

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
      if (winSmsPasswordInput && winSmsPasswordInput !== "********") {
        payload.winSmsPassword = winSmsPasswordInput;
      }
      const res = await saveCommunicationSettings(schoolId, payload);
      setSettings(res.settings);
      const nextSchool: SchoolSenderContext = {
        schoolName: String(res.schoolName || resolvedSchoolName || schoolName || "School").trim() || "School",
        schoolEmail: String(res.schoolEmail || resolvedSchoolEmail || schoolEmail || "").trim(),
      };
      setResolvedSchoolName(nextSchool.schoolName || "");
      setResolvedSchoolEmail(nextSchool.schoolEmail || "");
      notifyCommunicationSettingsUpdated(schoolId, res.settings, nextSchool);
      setWinSmsPasswordInput("");
      setMessage("Settings saved. Compose sender updated.");
    } catch (e: any) {
      setError(e?.message || "Failed to save settings");
    } finally {
      setLoading(false);
    }
  };

  const handleTestSms = async () => {
    if (!schoolId) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const res = await testSmsCredentials(schoolId, settings?.winSmsUsername);
      setMessage(res.message || "Credentials validated (simulated).");
    } catch (e: any) {
      setError(e?.message || "Test failed");
    } finally {
      setLoading(false);
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
  const senderPreview = formatComposeSenderLabel(settings, schoolCtx);
  const replyToEmail = resolveSchoolSenderEmail(settings, schoolCtx);

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
        {tabBtn("sms", "SMS")}
      </div>

      {message ? (
        <div style={{ marginBottom: 12, padding: 12, borderRadius: 10, background: "#ecfdf5", color: "#15803d", fontWeight: 700 }}>{message}</div>
      ) : null}
      {error ? (
        <div style={{ marginBottom: 12, padding: 12, borderRadius: 10, background: "#fef2f2", color: "#b91c1c", fontWeight: 700 }}>{error}</div>
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
            When enabled, outbound mail uses the EduClear relay (no-reply@educlear.co.za) instead of your school billing or administration email.
          </p>

          <label>
            Administration Email
            <input
              style={fieldStyle}
              value={settings.administrationEmail}
              onChange={(e) => patch({ administrationEmail: e.target.value })}
            />
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

      {tab === "sms" ? (
        <div style={{ display: "grid", gap: 16, maxWidth: 480 }}>
          <label>
            SMS Provider
            <select
              style={fieldStyle}
              value={settings.smsProvider}
              onChange={(e) => patch({ smsProvider: e.target.value as Settings["smsProvider"] })}
            >
              <option value="WinSMS">WinSMS</option>
              <option value="SMSPortal">SMSPortal</option>
              <option value="Other">Other</option>
            </select>
          </label>
          <label>
            WinSMS Username
            <input
              style={fieldStyle}
              value={settings.winSmsUsername}
              onChange={(e) => patch({ winSmsUsername: e.target.value })}
            />
          </label>
          <label>
            WinSMS Password
            <input
              type="password"
              style={fieldStyle}
              placeholder={settings.winSmsPasswordSet ? "******** (unchanged)" : "Enter password"}
              value={winSmsPasswordInput}
              onChange={(e) => setWinSmsPasswordInput(e.target.value)}
            />
          </label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" style={ghostBtn} onClick={handleTestSms} disabled={loading}>
              Test Credentials
            </button>
            <button type="button" style={goldBtn} onClick={handleSave} disabled={loading}>
              Save
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
