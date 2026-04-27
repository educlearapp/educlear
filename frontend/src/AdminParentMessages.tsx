import * as React from "react";
import { useEffect, useState } from "react";
import { apiFetch } from "./api";

export default function AdminParentMessages(props: { schoolId: string }) {
  const { schoolId } = props;
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("");
  const [threads, setThreads] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [selectedThread, setSelectedThread] = useState<any>(null);
  const [replyText, setReplyText] = useState("");

  async function refresh() {
    if (!schoolId) return;
    const res: any = await apiFetch(`/api/parent-portal/messages/threads?schoolId=${encodeURIComponent(schoolId)}`);
    const ts = Array.isArray(res?.threads) ? res.threads : [];
    setThreads(ts);
    if (!selectedId && ts[0]?.id) setSelectedId(String(ts[0].id));
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      setStatus("");
      try {
        if (!schoolId) throw new Error("Missing schoolId");
        await refresh();
      } catch (e: any) {
        setStatus(e?.message || "Failed to load threads");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedThread(null);
      return;
    }
    (async () => {
      try {
        const res: any = await apiFetch(`/api/parent-portal/messages/thread/${encodeURIComponent(selectedId)}`);
        setSelectedThread(res?.thread || null);
      } catch (e: any) {
        setStatus(e?.message || "Failed to load thread");
      }
    })();
  }, [selectedId]);

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    setStatus("");
    try {
      if (!selectedThread?.id) throw new Error("No thread selected");
      if (!replyText.trim()) throw new Error("Reply message is required");

      await apiFetch("/api/parent-portal/messages/reply", {
        method: "POST",
        body: JSON.stringify({
          threadId: selectedThread.id,
          senderId: "ADMIN_UI",
          senderRole: "TEACHER",
          message: replyText,
        }),
      });
      setReplyText("");
      const res: any = await apiFetch(`/api/parent-portal/messages/thread/${encodeURIComponent(selectedThread.id)}`);
      setSelectedThread(res?.thread || null);
      await refresh();
    } catch (e: any) {
      setStatus(e?.message || "Failed to send reply");
    }
  }

  async function closeThread() {
    setStatus("");
    try {
      if (!selectedThread?.id) throw new Error("No thread selected");
      await apiFetch(`/api/parent-portal/messages/thread/${encodeURIComponent(selectedThread.id)}/close`, { method: "PATCH" });
      const res: any = await apiFetch(`/api/parent-portal/messages/thread/${encodeURIComponent(selectedThread.id)}`);
      setSelectedThread(res?.thread || null);
      await refresh();
    } catch (e: any) {
      setStatus(e?.message || "Failed to close thread");
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <h1 className="page-title" style={{ margin: 0 }}>
          Parent Portal
        </h1>
        <button
          type="button"
          onClick={() => {
            setStatus("");
            setLoading(true);
            refresh()
              .catch((e: any) => setStatus(e?.message || "Failed to refresh"))
              .finally(() => setLoading(false));
          }}
          style={{ marginLeft: "auto", padding: "10px 14px", borderRadius: 10, background: "#111", color: "#d4af37", fontWeight: 900, border: "1px solid rgba(212,175,55,0.35)" }}
        >
          Refresh
        </button>
      </div>

      {status ? <div style={{ marginBottom: 10, color: "#b91c1c", fontWeight: 800 }}>{status}</div> : null}

      {loading ? (
        <div style={{ padding: 16 }}>Loading...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 12 }}>
          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)", overflow: "hidden" }}>
            <div style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)", fontWeight: 900 }}>
              Threads ({threads.length})
            </div>
            {threads.length ? (
              <div style={{ maxHeight: 650, overflow: "auto" }}>
                {threads.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedId(String(t.id))}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: 12,
                      border: "none",
                      borderBottom: "1px solid rgba(15,23,42,0.06)",
                      background: selectedId === String(t.id) ? "rgba(180,138,0,0.10)" : "#fff",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontWeight: 900 }}>{t.topic}</div>
                    <div style={{ color: "#475569", fontWeight: 700, fontSize: 13 }}>
                      {t.parent ? `${t.parent.firstName} ${t.parent.surname}` : "Parent"} •{" "}
                      {t.learner ? `${t.learner.firstName} ${t.learner.lastName}` : "Learner"} • {t.status}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ padding: 12, color: "#475569" }}>No threads yet.</div>
            )}
          </div>

          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)", overflow: "hidden" }}>
            <div style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 900 }}>
                {selectedThread ? `${selectedThread.topic} • ${selectedThread.status}` : "Select a thread"}
              </div>
              <div style={{ marginLeft: "auto" }}>
                {selectedThread?.status === "OPEN" ? (
                  <button type="button" onClick={closeThread} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ddd", background: "transparent" }}>
                    Close thread
                  </button>
                ) : null}
              </div>
            </div>

            {selectedThread ? (
              <>
                <div style={{ padding: 12, maxHeight: 520, overflow: "auto", display: "grid", gap: 10 }}>
                  {(selectedThread.replies || []).map((r: any) => (
                    <div
                      key={r.id}
                      style={{
                        alignSelf: r.senderRole === "PARENT" ? "start" : "end",
                        maxWidth: "80%",
                        background: r.senderRole === "PARENT" ? "rgba(15,23,42,0.06)" : "#111",
                        color: r.senderRole === "PARENT" ? "#0f172a" : "#f8fafc",
                        border: r.senderRole === "PARENT" ? "1px solid rgba(15,23,42,0.10)" : "1px solid rgba(212,175,55,0.25)",
                        borderRadius: 14,
                        padding: 10,
                      }}
                    >
                      <div style={{ fontWeight: 900, fontSize: 12, opacity: 0.85 }}>
                        {r.senderRole} • {new Date(r.createdAt).toLocaleString()}
                      </div>
                      <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{r.message}</div>
                    </div>
                  ))}
                </div>
                {selectedThread.status === "OPEN" ? (
                  <form onSubmit={sendReply} style={{ padding: 12, borderTop: "1px solid rgba(15,23,42,0.08)", display: "flex", gap: 10 }}>
                    <input
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Type your reply..."
                      style={{ flex: 1, padding: 12, borderRadius: 12, border: "1px solid rgba(15,23,42,0.18)" }}
                    />
                    <button type="submit" style={{ padding: "12px 14px", borderRadius: 12, background: "#d4af37", border: "1px solid rgba(212,175,55,0.55)", fontWeight: 900 }}>
                      Reply
                    </button>
                  </form>
                ) : (
                  <div style={{ padding: 12, borderTop: "1px solid rgba(15,23,42,0.08)", color: "#475569", fontWeight: 700 }}>
                    This thread is closed.
                  </div>
                )}
              </>
            ) : (
              <div style={{ padding: 12, color: "#475569" }}>Choose a thread from the left.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

