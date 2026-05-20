import { useCallback, useEffect, useState } from "react";
import { staffApiFetch, staffFormPost } from "../staffApi";

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

type MeResponse = {
  success?: boolean;
  user?: { id?: string; email?: string | null; fullName?: string | null; role?: string | null };
  school?: { id?: string; name?: string | null };
  assignedClassNames?: string[];
};

type Props = {
  /** When true, styles for the black/gold Teacher App shell (no outer white cards). */
  embedded?: boolean;
};

function looksLikeHtmlOrPlaintextRouteError(message: string): boolean {
  const t = message.trim();
  if (t.startsWith("<!DOCTYPE") || t.startsWith("<!doctype")) return true;
  if (t.includes("<html") || t.includes("<HTML")) return true;
  if (/Cannot\s+GET\s+\//i.test(t)) return true;
  return false;
}

export default function TeacherInbox({ embedded }: Props) {
  const [schoolId, setSchoolId] = useState(() => localStorage.getItem("schoolId") || "");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
  const [profileRetryNonce, setProfileRetryNonce] = useState(0);
  const [sessionReady, setSessionReady] = useState(false);

  const role = me?.user?.role ?? localStorage.getItem("userRole") ?? "";
  const isOwner = localStorage.getItem("isOwner") === "true";
  const canUseAdminView = role === "SCHOOL_ADMIN" || isOwner;

  const teacherEmail = (me?.user?.email || "").trim();
  const teacherName = me?.user?.fullName?.trim() || localStorage.getItem("userName") || "Teacher";
  const assignedClassNames = me?.assignedClassNames ?? [];

  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminView, setAdminView] = useState(
    () => localStorage.getItem("userRole") === "SCHOOL_ADMIN" || localStorage.getItem("isOwner") === "true"
  );

  const panelBg = embedded ? "rgba(15,15,15,0.95)" : "#fff";
  const panelBorder = embedded ? "1px solid rgba(212,175,55,0.35)" : "1px solid #e2e8f0";
  const textMuted = embedded ? "#94a3b8" : "#64748b";
  const headingColor = embedded ? gold : dark;

  useEffect(() => {
    void (async () => {
      setProfileLoadFailed(false);
      setSessionReady(false);
      try {
        const data = (await staffApiFetch("/api/teacher-app/me")) as MeResponse;
        setMe(data);
        if (data.school?.id) setSchoolId(String(data.school.id));
        const r = data.user?.role ?? "";
        if (r && r !== "SCHOOL_ADMIN" && !isOwner) {
          setAdminView(false);
        }
        setProfileLoadFailed(false);
      } catch {
        setMe(null);
        setProfileLoadFailed(true);
      } finally {
        setSessionReady(true);
      }
    })();
  }, [isOwner, profileRetryNonce]);

  const loadThreads = useCallback(async () => {
    if (!schoolId || !sessionReady || profileLoadFailed) return;
    if (!adminView && assignedClassNames.length === 0) {
      setThreads([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        schoolId,
        ...(adminView ? { adminView: "true" } : {}),
      });
      const data = await staffApiFetch(`/api/teacher-inbox/threads?${qs}`);
      setThreads((data as { threads?: ThreadRow[] }).threads || []);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load inbox";
      setError(looksLikeHtmlOrPlaintextRouteError(msg) ? "Unable to load conversations." : msg);
    } finally {
      setLoading(false);
    }
  }, [schoolId, adminView, sessionReady, profileLoadFailed, assignedClassNames.length]);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  async function openThread(id: string) {
    if (!schoolId || profileLoadFailed) return;
    setSelectedId(id);
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        schoolId,
        ...(adminView ? { adminView: "true" } : {}),
      });
      const data = await staffApiFetch(`/api/teacher-inbox/threads/${id}?${qs}`);
      setMessages((data as { thread?: { messages?: Message[] } }).thread?.messages || []);
      await staffApiFetch(`/api/teacher-inbox/threads/${id}/read`, {
        method: "PATCH",
        body: JSON.stringify({ schoolId, adminView }),
      });
      void loadThreads();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to open thread";
      setError(looksLikeHtmlOrPlaintextRouteError(msg) ? "Unable to open this conversation." : msg);
    } finally {
      setLoading(false);
    }
  }

  async function sendReply() {
    if (!selectedId || !reply.trim() || !schoolId || profileLoadFailed) return;
    setLoading(true);
    try {
      const form = new FormData();
      form.append("schoolId", schoolId);
      form.append("teacherName", teacherName);
      form.append("body", reply.trim());
      if (adminView) form.append("adminView", "true");
      if (files) {
        Array.from(files).forEach((f) => form.append("files", f));
      }
      await staffFormPost(`/api/teacher-inbox/threads/${selectedId}/reply`, form);
      setReply("");
      setFiles(null);
      await openThread(selectedId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Reply failed";
      setError(looksLikeHtmlOrPlaintextRouteError(msg) ? "Unable to send reply." : msg);
    } finally {
      setLoading(false);
    }
  }

  const showNoClassesPanel =
    sessionReady && !profileLoadFailed && !adminView && assignedClassNames.length === 0;
  const showEmptyInbox =
    threads.length === 0 &&
    !loading &&
    sessionReady &&
    !profileLoadFailed &&
    !showNoClassesPanel &&
    (adminView || assignedClassNames.length > 0);

  return (
    <div
      className={
        embedded
          ? `teacher-inbox teacher-inbox--embedded${selectedId ? " teacher-inbox--detail-open" : ""}`
          : undefined
      }
      style={{ padding: embedded ? 0 : 16, maxWidth: 1100, margin: embedded ? 0 : "0 auto" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <h1 style={{ margin: 0, color: headingColor }} className={embedded ? "teacher-page-heading" : undefined}>
          Teacher Inbox
        </h1>
        {canUseAdminView && (
          <label style={{ fontWeight: 700, fontSize: 14, color: embedded ? textMuted : dark }}>
            <input type="checkbox" checked={adminView} onChange={(e) => setAdminView(e.target.checked)} /> View all
            threads (admin)
          </label>
        )}
      </div>
      {profileLoadFailed && (
        <div
          style={{
            marginBottom: 12,
            padding: 12,
            borderRadius: 10,
            border: panelBorder,
            background: embedded ? "rgba(127,29,29,0.25)" : "#fef2f2",
            color: embedded ? "#fecaca" : "#991b1b",
          }}
        >
          <p style={{ margin: "0 0 10px", fontWeight: 700 }}>Unable to load teacher profile.</p>
          <button
            type="button"
            onClick={() => setProfileRetryNonce((n) => n + 1)}
            style={{
              background: gold,
              color: dark,
              border: "none",
              borderRadius: 10,
              padding: "10px 18px",
              fontWeight: 800,
              cursor: "pointer",
              minHeight: 44,
            }}
          >
            Retry
          </button>
        </div>
      )}
      {error && (
        <p style={{ color: "#fecaca" }}>
          {looksLikeHtmlOrPlaintextRouteError(error) ? "Something went wrong. Please try again." : error}
        </p>
      )}
      {sessionReady && !profileLoadFailed && teacherEmail && (
        <p style={{ margin: "0 0 12px", fontSize: 13, color: textMuted }}>
          Signed in as <strong style={{ color: embedded ? "#f8fafc" : dark }}>{teacherName}</strong> ({teacherEmail}) ·{" "}
          {role || "STAFF"}
        </p>
      )}
      <div
        className={embedded ? "teacher-inbox-grid" : undefined}
        style={
          embedded
            ? undefined
            : {
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
                gap: 16,
              }
        }
      >
        <div
          className={embedded ? "teacher-inbox-panel teacher-inbox-threads-panel" : undefined}
          style={
            embedded
              ? undefined
              : {
                  border: panelBorder,
                  borderRadius: 12,
                  background: panelBg,
                  maxHeight: 520,
                  overflowY: "auto",
                }
          }
        >
          <div className={embedded ? "teacher-inbox-threads" : undefined}>
          {showNoClassesPanel && (
            <p style={{ padding: 16, color: textMuted, lineHeight: 1.5 }}>
              No classrooms are currently assigned to your account.
            </p>
          )}
          {showEmptyInbox && (
            <p style={{ padding: 16, color: textMuted, lineHeight: 1.5 }}>No parent conversations yet.</p>
          )}
          {!showNoClassesPanel &&
            threads.map((t) => (
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
                  borderBottom: embedded ? "1px solid rgba(212,175,55,0.15)" : "1px solid #f1f5f9",
                  background: selectedId === t.id ? "rgba(212,175,55,0.15)" : "transparent",
                  cursor: "pointer",
                  color: embedded ? "#f8fafc" : "#0f172a",
                  minHeight: 48,
                }}
              >
                <strong>
                  {t.learner.firstName} {t.learner.lastName}
                </strong>
                <div style={{ fontSize: 12, color: textMuted }}>
                  Parent: {t.parent.firstName} {t.parent.surname}
                </div>
                {t.unreadCount > 0 && (
                  <span
                    style={{
                      fontSize: 11,
                      background: gold,
                      color: dark,
                      padding: "2px 6px",
                      borderRadius: 8,
                      fontWeight: 800,
                    }}
                  >
                    {t.unreadCount} unread
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        <div
          className={embedded ? "teacher-inbox-panel teacher-inbox-detail" : undefined}
          style={
            embedded
              ? undefined
              : {
                  border: panelBorder,
                  borderRadius: 12,
                  background: panelBg,
                  padding: 16,
                  minHeight: 400,
                }
          }
        >
          {embedded && selectedId && (
            <button
              type="button"
              className="teacher-touch-btn teacher-inbox-back"
              onClick={() => setSelectedId(null)}
              aria-label="Back to conversations"
            >
              ← Conversations
            </button>
          )}
          {!selectedId ? (
            <p style={{ color: textMuted }}>Select a conversation.</p>
          ) : (
            <>
              <div
                style={{
                  maxHeight: 300,
                  overflowY: "auto",
                  marginBottom: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {messages.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: m.sender === "PARENT" ? "flex-start" : "flex-end",
                      maxWidth: "min(100%, 420px)",
                      background:
                        m.sender === "PARENT"
                          ? embedded
                            ? "rgba(148,163,184,0.12)"
                            : "#f1f5f9"
                          : "rgba(212,175,55,0.2)",
                      padding: 10,
                      borderRadius: 10,
                      color: embedded ? "#f8fafc" : "#0f172a",
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700 }}>{m.senderName || m.sender}</div>
                    <div>{m.body}</div>
                    {Array.isArray(m.attachments) &&
                      m.attachments.map((a, i) => (
                        <a key={i} href={a.url} target="_blank" rel="noreferrer" style={{ display: "block", fontSize: 12, color: gold }}>
                          {a.name}
                        </a>
                      ))}
                  </div>
                ))}
              </div>
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                rows={3}
                className={embedded ? "teacher-inbox-reply-input" : undefined}
                style={{
                  width: "100%",
                  padding: 10,
                  borderRadius: 10,
                  border: panelBorder,
                  background: embedded ? "#080808" : "#fff",
                  color: embedded ? "#f8fafc" : "#0f172a",
                  boxSizing: "border-box",
                }}
                placeholder="Reply to parent…"
              />
              <div className={embedded ? "teacher-inbox-reply-actions" : undefined}>
                <input
                  type="file"
                  accept=".pdf,image/*"
                  multiple
                  onChange={(e) => setFiles(e.target.files)}
                  style={{ fontSize: 13, width: embedded ? "100%" : undefined }}
                />
                <button
                  type="button"
                  onClick={() => void sendReply()}
                  disabled={loading}
                  className={embedded ? "teacher-touch-btn primary" : undefined}
                  style={
                    embedded
                      ? undefined
                      : {
                          marginTop: 8,
                          background: gold,
                          color: dark,
                          border: "none",
                          borderRadius: 10,
                          padding: "12px 22px",
                          fontWeight: 800,
                          cursor: "pointer",
                          minHeight: 48,
                        }
                  }
                >
                  Send reply
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {loading && <p style={{ color: textMuted, marginTop: 8 }}>Loading…</p>}
    </div>
  );
}
