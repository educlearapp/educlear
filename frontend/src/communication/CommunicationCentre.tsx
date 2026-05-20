import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchEngineCampaigns,
  fetchEngineMessages,
  fetchEngineStats,
  processEngineQueue,
  retryEngineMessage,
  type EngineMessage,
} from "./communicationEngineApi";
import { fieldStyle, ghostBtn, goldBtn, pageWrap, summaryCard, td, th } from "./communicationStyles";

type Props = {
  schoolId: string;
  schoolName?: string;
};

type Tab = "queued" | "sent" | "failed" | "campaigns";

export default function CommunicationCentre({ schoolId, schoolName = "" }: Props) {
  const [tab, setTab] = useState<Tab>("queued");
  const [channelFilter, setChannelFilter] = useState<string>("");
  const [items, setItems] = useState<EngineMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const statusForTab = useMemo(() => {
    if (tab === "queued") return "queued";
    if (tab === "sent") return "sent";
    if (tab === "failed") return "failed";
    return "";
  }, [tab]);

  const loadMessages = useCallback(async () => {
    if (!schoolId || tab === "campaigns") return;
    setLoading(true);
    setError("");
    try {
      const res = await fetchEngineMessages(schoolId, {
        status: statusForTab || undefined,
        channel: channelFilter || undefined,
        limit: 80,
      });
      setItems(res.items || []);
      setTotal(res.total || 0);
    } catch (e: any) {
      setError(e?.message || "Failed to load queue");
    } finally {
      setLoading(false);
    }
  }, [schoolId, statusForTab, channelFilter, tab]);

  const loadStats = useCallback(async () => {
    if (!schoolId) return;
    try {
      const res = await fetchEngineStats(schoolId);
      setStats(res.byStatus || null);
    } catch {
      setStats(null);
    }
  }, [schoolId]);

  const loadCampaigns = useCallback(async () => {
    if (!schoolId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetchEngineCampaigns(schoolId);
      setCampaigns(res.campaigns || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (tab === "campaigns") {
      loadCampaigns();
    } else {
      loadMessages();
    }
  }, [tab, loadMessages, loadCampaigns]);

  const handleProcessQueue = async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const res = await processEngineQueue();
      setMessage(`Processed ${res.processed} message(s).`);
      await loadStats();
      await loadMessages();
    } catch (e: any) {
      setError(e?.message || "Process failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRetry = async (id: string) => {
    setLoading(true);
    setError("");
    try {
      await retryEngineMessage(id);
      setMessage("Message re-queued.");
      await loadMessages();
      await loadStats();
    } catch (e: any) {
      setError(e?.message || "Retry failed");
    } finally {
      setLoading(false);
    }
  };

  const title = schoolName ? `${schoolName} - Communication Centre` : "Communication Centre";

  return (
    <div style={pageWrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, color: "#0f172a", fontWeight: 900 }}>{title}</h1>
          <p style={{ margin: "8px 0 0", color: "#64748b", fontWeight: 600, maxWidth: 720 }}>
            Central queue for SMS, email, WhatsApp, push (future), and in-app audit. Automated sends use templates;
            providers are simulated until integrated.
          </p>
        </div>
        <button type="button" style={goldBtn} onClick={handleProcessQueue} disabled={loading}>
          Process queue
        </button>
      </div>

      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginTop: 18 }}>
          {Object.entries(stats).map(([k, v]) => (
            <div key={k} style={summaryCard}>
              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 800, textTransform: "uppercase" }}>{k}</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: "#0f172a", marginTop: 6 }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 20, alignItems: "center" }}>
        {(["queued", "sent", "failed", "campaigns"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            style={tab === t ? goldBtn : ghostBtn}
            onClick={() => setTab(t)}
          >
            {t === "campaigns" ? "Campaigns" : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
        {tab !== "campaigns" && (
          <select
            style={{ ...fieldStyle, maxWidth: 220 }}
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
          >
            <option value="">All channels</option>
            <option value="sms">SMS</option>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="push">Push</option>
            <option value="in_app">In-app</option>
          </select>
        )}
      </div>

      {error ? (
        <p style={{ color: "#b91c1c", fontWeight: 800, marginTop: 14 }}>{error}</p>
      ) : null}
      {message ? (
        <p style={{ color: "#15803d", fontWeight: 800, marginTop: 14 }}>{message}</p>
      ) : null}

      {tab === "campaigns" ? (
        <div style={{ marginTop: 16, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 12 }}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Category</th>
                <th style={th}>Messages</th>
                <th style={th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <td style={td}>{c.name}</td>
                  <td style={td}>{c.category}</td>
                  <td style={td}>{c._count?.messages ?? 0}</td>
                  <td style={td}>{c.createdAt ? new Date(c.createdAt).toLocaleString() : ""}</td>
                </tr>
              ))}
              {!campaigns.length && (
                <tr>
                  <td style={td} colSpan={4}>
                    No campaigns yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ marginTop: 16, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", background: "#fff", borderRadius: 12 }}>
            <thead>
              <tr>
                <th style={th}>When</th>
                <th style={th}>Channel</th>
                <th style={th}>Category</th>
                <th style={th}>Recipient</th>
                <th style={th}>Subject</th>
                <th style={th}>Status</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id}>
                  <td style={td}>{m.queuedAt ? new Date(m.queuedAt).toLocaleString() : ""}</td>
                  <td style={td}>{m.channel}</td>
                  <td style={td}>{m.category}</td>
                  <td style={td}>{m.recipient || "-"}</td>
                  <td style={td}>{m.subject || "-"}</td>
                  <td style={td}>{m.status}</td>
                  <td style={td}>
                    {m.status === "failed" && m.channel !== "in_app" ? (
                      <button type="button" style={ghostBtn} onClick={() => handleRetry(m.id)} disabled={loading}>
                        Retry
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td style={td} colSpan={7}>
                    No messages in this view.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p style={{ marginTop: 10, color: "#64748b", fontWeight: 600 }}>Total: {total}</p>
        </div>
      )}
    </div>
  );
}
