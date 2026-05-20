import { useEffect, useState } from "react";
import { API_URL, apiFetch } from "../api";

const gold = "#d4af37";
const dark = "#0f172a";

type ThreadRow = {
  id: string;
  learner: { firstName: string; lastName: string; grade: string; className: string | null };
  parent: { firstName: string; surname: string };
  lastMessage: { body: string; sender: string; createdAt: string } | null;
  unreadCount: number;
  teacherName: string;
};

type Message = {
  id: string;
  sender: string;
  senderName?: string;
  body: string;
  createdAt: string;
  attachments?: { name: string; url: string }[];
};

export default function TeacherInbox() {
  const schoolId = localStorage.getItem("schoolId") || "";
  const teacherEmail = localStorage.getItem("userEmail") || "";
  const teacherName = localStorage.getItem("userName") || "Teacher";
  const isAdmin = localStorage.getItem("userRole") === "SCHOOL_ADMIN" || localStorage.getItem("isOwner") === "true";

  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminView, setAdminView] = useState(isAdmin);

  async function loadThreads() {
    if (!schoolId) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        schoolId,
        ...(adminView ? { adminView: "true" } : { teacherEmail }),
      });
      const data = await apiFetch(`/api/teacher-inbox/threads?${qs}`);
      setThreads(data.threads || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load inbox");
    } finally {
      setLoading(false);
    }
  }

  async function openThread(id: string) {
    setSelectedId(id);
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        schoolId,
        ...(adminView ? { adminView: "true" } : { teacherEmail }),
      });
      const data = await apiFetch(`/api/teacher-inbox/threads/${id}?${qs}`);
      setMessages(data.thread?.messages || []);
      await apiFetch(`/api/teacher-inbox/threads/${id}/read`, {
        method: "PATCH",
        body: JSON.stringify({ schoolId, teacherEmail, adminView }),
      });
      void loadThreads();
    } catch (e: any) {
      setError(e?.message || "Failed to open thread");
    } finally {
      setLoading(false);
    }
  }

  async function sendReply() {
    if (!selectedId || !reply.trim()) return;
    setLoading(true);
    try {
      const form = new FormData();
      form.append("schoolId", schoolId);
      form.append("teacherEmail", teacherEmail);
      form.append("teacherName", teacherName);
      form.append("body", reply.trim());
      if (adminView) form.append("adminView", "true");
      if (files) {
        Array.from(files).forEach((f) => form.append("files", f));
      }
      const res = await fetch(`${API_URL}/api/teacher-inbox/threads/${selectedId}/reply`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Send failed");
      setReply("");
      setFiles(null);
      await openThread(selectedId);
    } catch (e: any) {
      setError(e?.message || "Reply failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadThreads();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId, adminView]);

  return (
    <div style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ margin: 0, color: dark }}>Teacher Inbox</h1>
        {isAdmin && (
          <label style={{ fontWeight: 700, fontSize: 14 }}>
            <input type="checkbox" checked={adminView} onChange={(e) => setAdminView(e.target.checked)} /> View all threads (admin)
          </label>
        )}
      </div>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(260px, 1fr) 2fr", gap: 16 }}>
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff", maxHeight: 520, overflowY: "auto" }}>
          {threads.length === 0 && <p style={{ padding: 16, color: "#64748b" }}>No parent messages yet.</p>}
          {threads.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => void openThread(t.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: 12,
                border: "none",
                borderBottom: "1px solid #f1f5f9",
                background: selectedId === t.id ? "rgba(212,175,55,0.15)" : "#fff",
                cursor: "pointer",
              }}
            >
              <strong>{t.learner.firstName} {t.learner.lastName}</strong>
              <div style={{ fontSize: 12, color: "#64748b" }}>Parent: {t.parent.firstName} {t.parent.surname}</div>
              {t.unreadCount > 0 && (
                <span style={{ fontSize: 11, background: gold, color: dark, padding: "2px 6px", borderRadius: 8, fontWeight: 800 }}>
                  {t.unreadCount} unread
                </span>
              )}
            </button>
          ))}
        </div>
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff", padding: 16, minHeight: 400 }}>
          {!selectedId ? (
            <p style={{ color: "#64748b" }}>Select a conversation.</p>
          ) : (
            <>
              <div style={{ maxHeight: 300, overflowY: "auto", marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {messages.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: m.sender === "PARENT" ? "flex-start" : "flex-end",
                      maxWidth: "80%",
                      background: m.sender === "PARENT" ? "#f1f5f9" : "rgba(212,175,55,0.2)",
                      padding: 10,
                      borderRadius: 10,
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700 }}>{m.senderName || m.sender}</div>
                    <div>{m.body}</div>
                    {Array.isArray(m.attachments) && m.attachments.map((a, i) => (
                      <a key={i} href={a.url} target="_blank" rel="noreferrer" style={{ display: "block", fontSize: 12, color: "#b45309" }}>{a.name}</a>
                    ))}
                  </div>
                ))}
              </div>
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={3} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #e2e8f0" }} placeholder="Reply to parent…" />
              <input type="file" accept=".pdf,image/*" multiple onChange={(e) => setFiles(e.target.files)} style={{ marginTop: 8, fontSize: 13 }} />
              <button
                type="button"
                onClick={() => void sendReply()}
                disabled={loading}
                style={{ marginTop: 8, background: gold, color: dark, border: "none", borderRadius: 10, padding: "10px 18px", fontWeight: 800, cursor: "pointer" }}
              >
                Send reply
              </button>
            </>
          )}
        </div>
      </div>
      {loading && <p style={{ color: "#64748b", marginTop: 8 }}>Loading…</p>}
    </div>
  );
}
