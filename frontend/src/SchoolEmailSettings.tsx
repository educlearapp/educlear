import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api";
import { useSchoolId } from "./useSchoolId";

type ProviderKey = "GMAIL" | "OUTLOOK" | "MICROSOFT_365" | "CUSTOM";

type SettingsPayload = {
  provider: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  replyTo: string;
};

type SettingsApi = {
  ok: boolean;
  settings: null | {
    provider: string | null;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUser: string;
    smtpPass: string; // masked ("********") when present
    smtpFrom: string | null;
    replyTo: string | null;
  };
};

const providerOptions: { key: ProviderKey; label: string }[] = [
  { key: "GMAIL", label: "Gmail" },
  { key: "OUTLOOK", label: "Outlook / Hotmail" },
  { key: "MICROSOFT_365", label: "Microsoft 365" },
  { key: "CUSTOM", label: "Custom SMTP" },
];

function presetForProvider(key: ProviderKey): { host: string; port: number; secure: boolean } | null {
  switch (key) {
    case "GMAIL":
      return { host: "smtp.gmail.com", port: 587, secure: false };
    case "OUTLOOK":
      return { host: "smtp-mail.outlook.com", port: 587, secure: false };
    case "MICROSOFT_365":
      return { host: "smtp.office365.com", port: 587, secure: false };
    default:
      return null;
  }
}

function asProviderKey(v: string): ProviderKey {
  const s = String(v || "").trim().toUpperCase();
  if (s === "GMAIL") return "GMAIL";
  if (s === "OUTLOOK" || s === "OUTLOOK_HOTMAIL" || s === "OUTLOOK/HOTMAIL") return "OUTLOOK";
  if (s === "MICROSOFT_365" || s === "M365" || s === "OFFICE365" || s === "OFFICE_365") return "MICROSOFT_365";
  return "CUSTOM";
}

export default function SchoolEmailSettings() {
  const schoolId = useSchoolId();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const [provider, setProvider] = useState<ProviderKey>("CUSTOM");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [testEmailTo, setTestEmailTo] = useState("");

  const hasMaskedPass = smtpPass === "********";

  const canSave = useMemo(() => {
    if (!schoolId) return false;
    if (!smtpHost.trim()) return false;
    const portNum = Number(smtpPort);
    if (!Number.isFinite(portNum) || portNum <= 0 || portNum > 65535) return false;
    if (!smtpUser.trim()) return false;
    return true;
  }, [schoolId, smtpHost, smtpPort, smtpUser]);

  useEffect(() => {
    let cancelled = false;
    if (!schoolId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setStatus(null);

    (async () => {
      try {
        const data = (await apiFetch(`/api/school-email-settings/${encodeURIComponent(schoolId)}`)) as SettingsApi;
        if (cancelled) return;

        const s = data?.settings;
        if (!s) {
          setProvider("CUSTOM");
          setSmtpHost("");
          setSmtpPort("587");
          setSmtpSecure(false);
          setSmtpUser("");
          setSmtpPass("");
          setSmtpFrom("");
          setReplyTo("");
          return;
        }

        setProvider(asProviderKey(String(s.provider || "")));
        setSmtpHost(String(s.smtpHost || ""));
        setSmtpPort(String(s.smtpPort || 587));
        setSmtpSecure(Boolean(s.smtpSecure));
        setSmtpUser(String(s.smtpUser || ""));
        setSmtpPass(String(s.smtpPass || ""));
        setSmtpFrom(String(s.smtpFrom || ""));
        setReplyTo(String(s.replyTo || ""));
      } catch (e: any) {
        if (!cancelled) setStatus({ kind: "error", message: e?.message || "Failed to load settings." });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  function applyProviderPreset(next: ProviderKey) {
    setProvider(next);
    const preset = presetForProvider(next);
    if (preset) {
      setSmtpHost(preset.host);
      setSmtpPort(String(preset.port));
      setSmtpSecure(preset.secure);
    }
  }

  async function saveSettings() {
    if (!schoolId) {
      setStatus({ kind: "error", message: "No school selected." });
      return;
    }
    if (!canSave) {
      setStatus({ kind: "error", message: "Please complete the required fields (Host, Port, Username/Email)." });
      return;
    }

    const portNum = Number(smtpPort);
    const payload: SettingsPayload = {
      provider: provider === "CUSTOM" ? "CUSTOM" : provider,
      smtpHost: smtpHost.trim(),
      smtpPort: Number.isFinite(portNum) ? portNum : 587,
      smtpSecure: Boolean(smtpSecure),
      smtpUser: smtpUser.trim(),
      // If already configured, the API accepts "********" to keep existing password.
      // Only update when the user types a new password.
      smtpPass: hasMaskedPass ? "********" : smtpPass,
      smtpFrom: smtpFrom.trim(),
      replyTo: replyTo.trim(),
    };

    setSaving(true);
    setStatus(null);
    try {
      const data = (await apiFetch(`/api/school-email-settings/${encodeURIComponent(schoolId)}`, {
        method: "POST",
        body: JSON.stringify(payload),
      })) as any;

      const masked = data?.settings?.smtpPass;
      if (typeof masked === "string") setSmtpPass(masked);

      setStatus({ kind: "success", message: "Settings saved." });
    } catch (e: any) {
      setStatus({ kind: "error", message: e?.message || "Failed to save settings." });
    } finally {
      setSaving(false);
    }
  }

  async function sendTestEmail() {
    if (!schoolId) {
      setStatus({ kind: "error", message: "No school selected." });
      return;
    }
    const to = testEmailTo.trim();
    if (!to) {
      setStatus({ kind: "error", message: "Please enter a Test Email To address." });
      return;
    }

    setTesting(true);
    setStatus(null);
    try {
      const resp = (await apiFetch(`/api/school-email-settings/${encodeURIComponent(schoolId)}/test`, {
        method: "POST",
        body: JSON.stringify({ toEmail: to }),
      })) as any;
      setStatus({ kind: "success", message: resp?.message || `Test email sent to ${to}` });
    } catch (e: any) {
      setStatus({ kind: "error", message: e?.message || "Failed to send test email." });
    } finally {
      setTesting(false);
    }
  }

  const labelStyle: React.CSSProperties = { fontWeight: 900, fontSize: 13, color: "#0f172a" };
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(15, 23, 42, 0.14)",
    background: "#fff",
    outline: "none",
    fontWeight: 700,
    boxSizing: "border-box",
  };
  const rowStyle: React.CSSProperties = { display: "grid", gap: 8 };
  const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 };
  const btnPrimary: React.CSSProperties = {
    padding: "11px 14px",
    borderRadius: 12,
    border: "1px solid #d4af37",
    background: "#d4af37",
    color: "#111827",
    fontWeight: 950,
    cursor: "pointer",
  };
  const btnGhost: React.CSSProperties = {
    padding: "11px 14px",
    borderRadius: 12,
    border: "1px solid rgba(15, 23, 42, 0.16)",
    background: "transparent",
    color: "#0f172a",
    fontWeight: 950,
    cursor: "pointer",
  };

  return (
    <div style={{ padding: 0 }}>
      <h1 className="page-title">School Email Settings</h1>

      <div style={{ marginTop: 6, color: "#475569", lineHeight: 1.55 }}>
        Configure outgoing email (SMTP) for this school. These settings are used for billing documents, statements/invoices,
        and payslips.
      </div>

      {status && (
        <div
          style={{
            marginTop: 14,
            padding: "12px 14px",
            borderRadius: 12,
            border: `1px solid ${status.kind === "success" ? "rgba(16, 185, 129, 0.35)" : "rgba(239, 68, 68, 0.35)"}`,
            background: status.kind === "success" ? "rgba(16, 185, 129, 0.08)" : "rgba(239, 68, 68, 0.08)",
            color: "#0f172a",
            fontWeight: 850,
          }}
        >
          {status.message}
        </div>
      )}

      <div
        style={{
          marginTop: 16,
          maxWidth: 920,
          border: "1px solid rgba(15, 23, 42, 0.10)",
          borderRadius: 16,
          padding: 16,
          background: "#fff",
        }}
      >
        {loading ? (
          <div style={{ color: "#475569", fontWeight: 900 }}>Loading settings...</div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={rowStyle}>
              <div style={labelStyle}>Provider</div>
              <select
                value={provider}
                onChange={(e) => applyProviderPreset(e.target.value as ProviderKey)}
                style={inputStyle}
              >
                {providerOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={grid2}>
              <div style={rowStyle}>
                <div style={labelStyle}>SMTP Host</div>
                <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" style={inputStyle} />
              </div>
              <div style={rowStyle}>
                <div style={labelStyle}>SMTP Port</div>
                <input
                  value={smtpPort}
                  onChange={(e) => setSmtpPort(e.target.value)}
                  placeholder="587"
                  inputMode="numeric"
                  style={inputStyle}
                />
              </div>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 900, color: "#0f172a" }}>
              <input type="checkbox" checked={smtpSecure} onChange={(e) => setSmtpSecure(e.target.checked)} />
              Secure (SSL/TLS)
            </label>

            <div style={grid2}>
              <div style={rowStyle}>
                <div style={labelStyle}>SMTP Username / Email</div>
                <input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="you@school.com" style={inputStyle} />
              </div>
              <div style={rowStyle}>
                <div style={labelStyle}>SMTP Password / App Password</div>
                <input
                  type="password"
                  value={smtpPass}
                  onChange={(e) => setSmtpPass(e.target.value)}
                  placeholder={smtpPass ? "" : "Enter password"}
                  style={inputStyle}
                />
                <div style={{ color: "#64748b", fontSize: 12.5, lineHeight: 1.35 }}>
                  Passwords are never shown. If a password already exists, it will display as ********. Type a new password to update it.
                </div>
              </div>
            </div>

            <div style={grid2}>
              <div style={rowStyle}>
                <div style={labelStyle}>From Email</div>
                <input value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} placeholder="billing@school.com" style={inputStyle} />
              </div>
              <div style={rowStyle}>
                <div style={labelStyle}>Reply-To Email</div>
                <input value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="accounts@school.com" style={inputStyle} />
              </div>
            </div>

            <div style={{ borderTop: "1px solid rgba(15, 23, 42, 0.08)", paddingTop: 14, marginTop: 2 }}>
              <div style={{ fontWeight: 950, color: "#0f172a", marginBottom: 10 }}>Test Email</div>

              <div style={grid2}>
                <div style={rowStyle}>
                  <div style={labelStyle}>Test Email To</div>
                  <input
                    value={testEmailTo}
                    onChange={(e) => setTestEmailTo(e.target.value)}
                    placeholder="someone@example.com"
                    style={inputStyle}
                  />
                </div>
                <div />
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" onClick={saveSettings} disabled={!canSave || saving} style={{ ...btnPrimary, opacity: !canSave || saving ? 0.6 : 1 }}>
                {saving ? "Saving..." : "Save Settings"}
              </button>
              <button type="button" onClick={sendTestEmail} disabled={testing} style={{ ...btnGhost, opacity: testing ? 0.6 : 1 }}>
                {testing ? "Sending..." : "Send Test Email"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

