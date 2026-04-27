import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "./api";
import { getParentPortalSession } from "./parentPortalSession";

const TOPICS = ["Homework", "Behaviour", "Absence", "Academic Concern", "General"] as const;

export default function ParentPortalMessages() {
  const navigate = useNavigate();
  const session = useMemo(() => getParentPortalSession(), []);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("");
  const [schoolId, setSchoolId] = useState<string>("");
  const [learners, setLearners] = useState<any[]>([]);
  const [threads, setThreads] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [selectedThread, setSelectedThread] = useState<any>(null);

  const [showNew, setShowNew] = useState(false);
  const [newLearnerId, setNewLearnerId] = useState("");
  const [newTopic, setNewTopic] = useState<(typeof TOPICS)[number]>("General");
  const [newMessage, setNewMessage] = useState("");

  const [replyText, setReplyText] = useState("");

  useEffect(() => {
    if (!session) {
      navigate("/parent/login", { replace: true });
      return;
    }
    const sessionLocal = session;
    (async () => {
      setLoading(true);
      setStatus("");
      try {
        const dash: any = await apiFetch(`/api/parent-portal/dashboard/${sessionLocal.parentId}`);
        const sid = String(dash?.parent?.schoolId || session.schoolId || "");
        setSchoolId(sid);
        const ls: any[] = Array.isArray(dash?.learners) ? dash.learners : [];
        setLearners(ls);
        setNewLearnerId((prev) => prev || (ls[0]?.id ? String(ls[0].id) : ""));

        const res: any = await apiFetch(
          `/api/parent-portal/messages/threads?parentId=${encodeURIComponent(sessionLocal.parentId)}`
        );
        const ts = Array.isArray(res?.threads) ? res.threads : [];
        setThreads(ts);
        setSelectedId((prev) => prev || (ts[0]?.id ? String(ts[0].id) : ""));
      } catch (e: any) {
        setStatus(e?.message || "Failed to load messages");
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate, session]);

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

  if (!session) return null;

  async function refreshThreads() {
    if (!session) return;
    const res: any = await apiFetch(
      `/api/parent-portal/messages/threads?parentId=${encodeURIComponent(session.parentId)}`
    );
    const ts = Array.isArray(res?.threads) ? res.threads : [];
    setThreads(ts);
    if (!selectedId && ts[0]?.id) setSelectedId(String(ts[0].id));
  }

  async function createThread(e: React.FormEvent) {
    e.preventDefault();
    setStatus("");
    try {
      if (!schoolId) throw new Error("Missing schoolId");
      if (!newLearnerId) throw new Error("Please select a learner");
      if (!newMessage.trim()) throw new Error("Message is required");
      if (!session) throw new Error("Please log in again.");

      const res: any = await apiFetch("/api/parent-portal/messages/thread", {
        method: "POST",
        body: JSON.stringify({
          schoolId,
          learnerId: newLearnerId,
          parentId: session.parentId,
          topic: newTopic,
          message: newMessage,
        }),
      });

      const thread = res?.thread;
      setShowNew(false);
      setNewMessage("");
      await refreshThreads();
      if (thread?.id) setSelectedId(String(thread.id));
    } catch (e: any) {
      setStatus(e?.message || "Failed to create thread");
    }
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    setStatus("");
    try {
      if (!selectedThread?.id) throw new Error("No thread selected");
      if (!replyText.trim()) throw new Error("Reply message is required");
      if (!session) throw new Error("Please log in again.");

      await apiFetch("/api/parent-portal/messages/reply", {
        method: "POST",
        body: JSON.stringify({
          threadId: selectedThread.id,
          senderId: session.parentId,
          senderRole: "PARENT",
          message: replyText,
        }),
      });
      setReplyText("");
      const res: any = await apiFetch(`/api/parent-portal/messages/thread/${encodeURIComponent(selectedThread.id)}`);
      setSelectedThread(res?.thread || null);
      await refreshThreads();
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
      await refreshThreads();
    } catch (e: any) {
      setStatus(e?.message || "Failed to close thread");
    }
  }

  return (
    <div style={{ maxWidth: 1200, margin: "28px auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Parent Portal - Messages</h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            onClick={() => setShowNew(true)}
            style={{ padding: "10px 14px", borderRadius: 10, background: "#111", color: "#d4af37", fontWeight: 900, border: "1px solid rgba(212,175,55,0.35)" }}
          >
            New Message
          </button>
          <Link to="/parent/dashboard" style={{ color: "#b48a00", fontWeight: 900 }}>
            Back to dashboard
          </Link>
        </div>
      </div>

      {status ? <div style={{ marginBottom: 10, color: "#b91c1c", fontWeight: 800 }}>{status}</div> : null}

      {loading ? (
        <div style={{ padding: 16 }}>Loading...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 12 }}>
          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)", overflow: "hidden" }}>
            <div style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)", fontWeight: 900 }}>Inbox</div>
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
                      {t.learner ? `${t.learner.firstName} ${t.learner.lastName}` : "Learner"} • {t.status}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div style={{ padding: 12, color: "#475569" }}>No conversations yet.</div>
            )}
          </div>

          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)", overflow: "hidden" }}>
            <div style={{ padding: 12, borderBottom: "1px solid rgba(15,23,42,0.08)", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 900 }}>
                {selectedThread ? `${selectedThread.topic} • ${selectedThread.status}` : "Select a conversation"}
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
                        alignSelf: r.senderRole === "PARENT" ? "end" : "start",
                        maxWidth: "80%",
                        background: r.senderRole === "PARENT" ? "#111" : "rgba(15,23,42,0.06)",
                        color: r.senderRole === "PARENT" ? "#f8fafc" : "#0f172a",
                        border: r.senderRole === "PARENT" ? "1px solid rgba(212,175,55,0.25)" : "1px solid rgba(15,23,42,0.10)",
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
                      Send
                    </button>
                  </form>
                ) : (
                  <div style={{ padding: 12, borderTop: "1px solid rgba(15,23,42,0.08)", color: "#475569", fontWeight: 700 }}>
                    This thread is closed.
                  </div>
                )}
              </>
            ) : (
              <div style={{ padding: 12, color: "#475569" }}>Choose a conversation from the left.</div>
            )}
          </div>
        </div>
      )}

      {showNew ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "grid", placeItems: "center", padding: 16 }}>
          <div style={{ width: "min(720px, 100%)", background: "#111", color: "#f8fafc", borderRadius: 16, border: "1px solid rgba(212,175,55,0.25)" }}>
            <div style={{ padding: 14, borderBottom: "1px solid rgba(212,175,55,0.20)", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontWeight: 900, color: "#d4af37" }}>New Message</div>
              <button
                type="button"
                onClick={() => setShowNew(false)}
                style={{ marginLeft: "auto", padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(212,175,55,0.25)", background: "transparent", color: "#f8fafc" }}
              >
                Cancel
              </button>
            </div>
            <form onSubmit={createThread} style={{ padding: 14, display: "grid", gap: 10 }}>
              <label>
                <div style={{ fontWeight: 900, color: "#d4af37" }}>Learner</div>
                <select
                  value={newLearnerId}
                  onChange={(e) => setNewLearnerId(e.target.value)}
                  style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid rgba(212,175,55,0.35)", background: "#0b0b0b", color: "#f8fafc" }}
                >
                  {learners.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.firstName} {l.lastName} {l.grade ? `(${l.grade}${l.className ? ` • ${l.className}` : ""})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <div style={{ fontWeight: 900, color: "#d4af37" }}>Topic</div>
                <select
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value as any)}
                  style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid rgba(212,175,55,0.35)", background: "#0b0b0b", color: "#f8fafc" }}
                >
                  {TOPICS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <div style={{ fontWeight: 900, color: "#d4af37" }}>Message</div>
                <textarea
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  rows={6}
                  style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid rgba(212,175,55,0.35)", background: "#0b0b0b", color: "#f8fafc" }}
                />
              </label>
              <button type="submit" style={{ padding: "12px 14px", borderRadius: 12, background: "#d4af37", border: "1px solid rgba(212,175,55,0.55)", fontWeight: 900 }}>
                Send
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

