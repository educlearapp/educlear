import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { API_URL, apiFetch } from "../api";
import {
  clearParentSession,
  getParentSession,
  getParentToken,
  parentApiFetch,
  setParentSession,
} from "./parentApi";

type Learner = {
  id: string;
  firstName: string;
  lastName: string;
  grade: string;
  className: string | null;
  admissionNo: string | null;
};

type LinkRow = {
  linkId: string;
  relation: string | null;
  learner: Learner;
};

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  learnerId?: string | null;
  learner?: { firstName: string; lastName: string } | null;
  metadata?: Record<string, unknown>;
};

type ThreadMessage = {
  id: string;
  sender: string;
  senderName?: string;
  body: string;
  createdAt: string;
  attachments?: unknown;
};

const gold = "#d4af37";
const dark = "#0f172a";

const card: CSSProperties = {
  background: "#ffffff",
  border: "1px solid rgba(212,175,55,0.35)",
  borderRadius: 14,
  padding: 16,
};

const btnGold: CSSProperties = {
  background: gold,
  color: dark,
  border: "none",
  borderRadius: 10,
  padding: "10px 16px",
  fontWeight: 800,
  cursor: "pointer",
};

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export default function ParentPortalApp() {
  const [schools, setSchools] = useState<{ id: string; name: string }[]>([]);
  const [schoolId, setSchoolId] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [cellNo, setCellNo] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"login" | "dashboard" | "notifications" | "messages" | "billing" | "pwa">(
    getParentToken() ? "dashboard" : "login"
  );
  const [session, setSession] = useState(getParentSession());
  const [selectedLearnerId, setSelectedLearnerId] = useState("");
  const [dashboard, setDashboard] = useState<any>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [teacherInfo, setTeacherInfo] = useState<{ name: string; email: string } | null>(null);
  const [messageDraft, setMessageDraft] = useState("");
  const [paymentInstructions, setPaymentInstructions] = useState("");

  const learners: LinkRow[] = useMemo(() => {
    const rows = (session?.learners || dashboard?.learners || []) as LinkRow[];
    return rows.map((r: any) => ({
      linkId: r.linkId || r.id,
      relation: r.relation,
      learner: r.learner || r,
    }));
  }, [session, dashboard]);

  const activeLearner = useMemo(() => {
    const id = selectedLearnerId || dashboard?.activeLearner?.id;
    return learners.find((l) => l.learner.id === id)?.learner || dashboard?.activeLearner || null;
  }, [learners, selectedLearnerId, dashboard]);

  useEffect(() => {
    void apiFetch("/api/schools/")
      .then((data: any) => {
        const list = Array.isArray(data) ? data : Array.isArray(data?.schools) ? data.schools : [];
        setSchools(list.map((s: any) => ({ id: s.id, name: s.name })));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!getParentToken()) return;
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLearnerId]);

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const qs = selectedLearnerId ? `?learnerId=${encodeURIComponent(selectedLearnerId)}` : "";
      const data = await parentApiFetch(`/api/parent-portal/dashboard${qs}`);
      setDashboard(data);
      if (!selectedLearnerId && data?.autoSelectLearner?.id) {
        setSelectedLearnerId(data.autoSelectLearner.id);
      }
      const me = await parentApiFetch("/api/parent-portal/me");
      setSession({ parent: me.parent, learners: me.learners });
    } catch (e: any) {
      setError(e?.message || "Failed to load dashboard");
      if (String(e?.message || "").includes("401")) {
        clearParentSession();
        setView("login");
      }
    } finally {
      setLoading(false);
    }
  }

  async function requestOtp() {
    if (!schoolId || !idNumber) {
      setError("Select your school and enter your ID number.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch("/api/parent-portal/auth/request-otp", {
        method: "POST",
        body: JSON.stringify({ schoolId, idNumber, cellNo }),
      });
      setOtpSent(true);
      if (data?.devOtp) setOtpCode(String(data.devOtp));
    } catch (e: any) {
      setError(e?.message || "OTP request failed");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch("/api/parent-portal/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ schoolId, idNumber, cellNo, code: otpCode }),
      });
      setParentSession(data.token, { parent: data.parent, learners: data.learners });
      setSession({ parent: data.parent, learners: data.learners });
      setView("dashboard");
      await loadDashboard();
    } catch (e: any) {
      setError(e?.message || "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  async function loadNotifications() {
    const data = await parentApiFetch("/api/parent-portal/notifications");
    setNotifications(data.notifications || []);
    setView("notifications");
  }

  async function openMessages() {
    if (!activeLearner) {
      setError("Select a learner first.");
      return;
    }
    setLoading(true);
    try {
      const qs = new URLSearchParams({ learnerId: activeLearner.id });
      const data = await parentApiFetch(`/api/parent-portal/thread?${qs}`);
      setTeacherInfo(data.teacher || null);
      setThreadMessages(data?.thread?.messages || []);
      setView("messages");
    } catch (e: any) {
      setError(e?.message || "Failed to load messages");
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage() {
    if (!activeLearner || !messageDraft.trim()) return;
    setLoading(true);
    try {
      await parentApiFetch("/api/parent-portal/send-message", {
        method: "POST",
        body: JSON.stringify({ learnerId: activeLearner.id, body: messageDraft.trim() }),
      });
      setMessageDraft("");
      const qs = new URLSearchParams({ learnerId: activeLearner.id });
      const data = await parentApiFetch(`/api/parent-portal/thread?${qs}`);
      setThreadMessages(data?.thread?.messages || []);
    } catch (e: any) {
      setError(e?.message || "Send failed");
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    clearParentSession();
    setView("login");
    setDashboard(null);
    setSession(null);
  }

  if (view === "login") {
    return (
      <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "Arial, sans-serif" }}>
        <header style={{ background: dark, color: "#fff", padding: "18px 20px", borderBottom: `3px solid ${gold}` }}>
          <strong style={{ color: gold, fontSize: 20 }}>EduClear Parent Portal</strong>
        </header>
        <main style={{ maxWidth: 480, margin: "32px auto", padding: 16 }}>
          <div style={card}>
            <h2 style={{ margin: "0 0 12px", color: dark }}>Sign in</h2>
            <p style={{ color: "#64748b", fontSize: 14 }}>Use your ID number and OTP verification. No payment features — view invoices and statements only.</p>
            <label style={{ display: "block", marginTop: 12, fontWeight: 700 }}>School</label>
            <select value={schoolId} onChange={(e) => setSchoolId(e.target.value)} style={{ width: "100%", padding: 10, marginTop: 4 }}>
              <option value="">Select school</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <label style={{ display: "block", marginTop: 12, fontWeight: 700 }}>ID number</label>
            <input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} style={{ width: "100%", padding: 10, marginTop: 4 }} />
            <label style={{ display: "block", marginTop: 12, fontWeight: 700 }}>Mobile (optional)</label>
            <input value={cellNo} onChange={(e) => setCellNo(e.target.value)} style={{ width: "100%", padding: 10, marginTop: 4 }} />
            {error && <p style={{ color: "#b91c1c", marginTop: 12 }}>{error}</p>}
            {!otpSent ? (
              <button type="button" style={{ ...btnGold, marginTop: 16, width: "100%" }} onClick={() => void requestOtp()} disabled={loading}>
                {loading ? "Sending…" : "Send OTP"}
              </button>
            ) : (
              <>
                <label style={{ display: "block", marginTop: 12, fontWeight: 700 }}>OTP code</label>
                <input value={otpCode} onChange={(e) => setOtpCode(e.target.value)} style={{ width: "100%", padding: 10, marginTop: 4 }} />
                <button type="button" style={{ ...btnGold, marginTop: 16, width: "100%" }} onClick={() => void verifyOtp()} disabled={loading}>
                  {loading ? "Verifying…" : "Verify & enter"}
                </button>
              </>
            )}
            {isMobile() && (
              <button type="button" style={{ marginTop: 12, width: "100%", padding: 10, background: "transparent", border: `1px solid ${gold}`, borderRadius: 10, fontWeight: 700 }} onClick={() => setView("pwa")}>
                Install app instructions
              </button>
            )}
          </div>
        </main>
      </div>
    );
  }

  if (view === "pwa") {
    return (
      <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 20 }}>
        <div style={card}>
          <h2 style={{ color: dark }}>Add EduClear to your home screen</h2>
          <p><strong>iPhone (Safari):</strong> Tap Share → Add to Home Screen.</p>
          <p><strong>Android (Chrome):</strong> Menu (⋮) → Install app / Add to Home screen.</p>
          <p>Open: <a href="/parent">{window.location.origin}/parent</a></p>
          <button type="button" style={btnGold} onClick={() => setView(getParentToken() ? "dashboard" : "login")}>Back</button>
        </div>
      </div>
    );
  }

  const schoolName = session?.parent?.school?.name || dashboard?.activeLearner?.school?.name || "Your school";

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "Arial, sans-serif" }}>
      <header style={{ background: dark, color: "#fff", padding: "14px 16px", borderBottom: `3px solid ${gold}`, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <strong style={{ color: gold }}>EduClear Parent Portal</strong>
          <div style={{ fontSize: 12, opacity: 0.85 }}>{schoolName}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" style={{ ...btnGold, fontSize: 12 }} onClick={() => void loadNotifications()}>Notifications</button>
          <button type="button" style={{ background: "transparent", color: gold, border: `1px solid ${gold}`, borderRadius: 10, padding: "8px 12px", fontWeight: 700, cursor: "pointer" }} onClick={logout}>Logout</button>
        </div>
      </header>

      <main style={{ maxWidth: 720, margin: "0 auto", padding: 16 }}>
        {error && <div style={{ ...card, borderColor: "#fecaca", color: "#b91c1c", marginBottom: 12 }}>{error}</div>}

        {view === "dashboard" && (
          <>
            {learners.length > 1 && (
              <div style={{ ...card, marginBottom: 14 }}>
                <h3 style={{ margin: "0 0 10px", color: dark }}>Your learners</h3>
                <div style={{ display: "grid", gap: 10 }}>
                  {learners.map((row) => (
                    <button
                      key={row.learner.id}
                      type="button"
                      onClick={() => setSelectedLearnerId(row.learner.id)}
                      style={{
                        textAlign: "left",
                        padding: 12,
                        borderRadius: 10,
                        border: selectedLearnerId === row.learner.id ? `2px solid ${gold}` : "1px solid #e2e8f0",
                        background: selectedLearnerId === row.learner.id ? "rgba(212,175,55,0.12)" : "#fff",
                        cursor: "pointer",
                      }}
                    >
                      <strong>{row.learner.firstName} {row.learner.lastName}</strong>
                      <div style={{ fontSize: 13, color: "#64748b" }}>{row.learner.grade} · {row.learner.className || "—"}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {activeLearner && (
              <div style={{ ...card, marginBottom: 14 }}>
                <h3 style={{ margin: 0, color: dark }}>{activeLearner.firstName} {activeLearner.lastName}</h3>
                <p style={{ color: "#64748b", margin: "6px 0 14px" }}>{activeLearner.grade} · Class {activeLearner.className || "—"}</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
                  <DashTile label="Invoice" value={dashboard?.latestInvoiceNotification ? "Ready" : "—"} onClick={() => setView("billing")} />
                  <DashTile label="Messages" value={String(dashboard?.unreadTeacherMessages || 0)} onClick={() => void openMessages()} />
                  <DashTile label="Incidents" value={String(dashboard?.incidents?.length || 0)} />
                  <DashTile label="Homework" value={String(dashboard?.homework?.length || 0)} />
                </div>
                <button type="button" style={{ ...btnGold, marginTop: 14, width: "100%" }} onClick={() => void openMessages()}>
                  Message class teacher
                </button>
                <p style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>Teacher is assigned automatically from your child&apos;s classroom — you cannot choose a different teacher.</p>
              </div>
            )}

            {dashboard?.notices?.length > 0 && (
              <Section title="Notices">
                {dashboard.notices.map((n: any) => (
                  <div key={n.id} style={{ padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
                    <strong>{n.title}</strong>
                    <div style={{ fontSize: 13, color: "#64748b" }}>{String(n.body || "").slice(0, 120)}</div>
                  </div>
                ))}
              </Section>
            )}

            {dashboard?.homework?.length > 0 && (
              <Section title="Homework">
                {dashboard.homework.map((h: any) => (
                  <div key={h.id} style={{ padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
                    <strong>{h.title}</strong>
                    {h.dueDate && <div style={{ fontSize: 12, color: "#b45309" }}>Due {new Date(h.dueDate).toLocaleDateString()}</div>}
                  </div>
                ))}
              </Section>
            )}

            {dashboard?.incidents?.length > 0 && (
              <Section title="Incidents">
                {dashboard.incidents.map((inc: any) => (
                  <div key={inc.id} style={{ padding: "8px 0", borderBottom: "1px solid #f1f5f9" }}>
                    <strong>{inc.subject}</strong>
                    <div style={{ fontSize: 13 }}>{String(inc.summary || "").slice(0, 160)}</div>
                  </div>
                ))}
              </Section>
            )}
          </>
        )}

        {view === "notifications" && (
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, color: dark }}>Notifications</h3>
              <button type="button" style={{ background: "none", border: "none", color: gold, fontWeight: 800, cursor: "pointer" }} onClick={() => setView("dashboard")}>Back</button>
            </div>
            {notifications.length === 0 && <p style={{ color: "#64748b" }}>No notifications yet.</p>}
            {notifications.map((n) => (
              <div key={n.id} style={{ padding: "12px 0", borderBottom: "1px solid #f1f5f9", opacity: n.isRead ? 0.75 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>{n.title}</strong>
                  <span style={{ fontSize: 11, color: "#94a3b8" }}>{new Date(n.createdAt).toLocaleDateString()}</span>
                </div>
                <div style={{ fontSize: 13, color: "#64748b" }}>{n.type.replace(/_/g, " ")}</div>
                <p style={{ margin: "6px 0 0", fontSize: 14 }}>{n.message}</p>
              </div>
            ))}
          </div>
        )}

        {view === "messages" && (
          <div style={card}>
            <button type="button" style={{ background: "none", border: "none", color: gold, fontWeight: 800, cursor: "pointer" }} onClick={() => setView("dashboard")}>← Back</button>
            <h3 style={{ color: dark }}>Class teacher: {teacherInfo?.name || "Assigned teacher"}</h3>
            <div style={{ maxHeight: 360, overflowY: "auto", margin: "12px 0", display: "flex", flexDirection: "column", gap: 8 }}>
              {threadMessages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    alignSelf: m.sender === "PARENT" ? "flex-end" : "flex-start",
                    maxWidth: "85%",
                    background: m.sender === "PARENT" ? "rgba(212,175,55,0.2)" : "#f1f5f9",
                    padding: 10,
                    borderRadius: 10,
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700 }}>{m.senderName || m.sender}</div>
                  <div>{m.body}</div>
                </div>
              ))}
            </div>
            <textarea value={messageDraft} onChange={(e) => setMessageDraft(e.target.value)} rows={3} style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #e2e8f0" }} />
            <button type="button" style={{ ...btnGold, marginTop: 8, width: "100%" }} onClick={() => void sendMessage()} disabled={loading}>Send</button>
          </div>
        )}

        {view === "billing" && (
          <div style={card}>
            <button type="button" style={{ background: "none", border: "none", color: gold, fontWeight: 800, cursor: "pointer" }} onClick={() => setView("dashboard")}>← Back</button>
            <h3 style={{ color: dark }}>Invoices & statements</h3>
            <p style={{ color: "#64748b", fontSize: 14 }}>View and download only. Online payments are not available in the parent portal.</p>
            {dashboard?.latestInvoiceNotification && (
              <div style={{ background: "rgba(212,175,55,0.1)", padding: 12, borderRadius: 10, marginBottom: 12 }}>
                {dashboard.latestInvoiceNotification.message}
              </div>
            )}
            <a href={`${API_URL}/api/statements/accounts?schoolId=${encodeURIComponent(session?.parent?.school?.id || schoolId)}`} target="_blank" rel="noreferrer" style={{ ...btnGold, display: "inline-block", textDecoration: "none", marginRight: 8 }}>
              View statement data
            </a>
            {paymentInstructions && (
              <div style={{ marginTop: 14, fontSize: 14 }}>
                <strong>Payment instructions</strong>
                <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{paymentInstructions}</pre>
              </div>
            )}
          </div>
        )}

        {loading && <p style={{ textAlign: "center", color: "#64748b" }}>Loading…</p>}
      </main>
    </div>
  );
}

function DashTile({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: 12,
        borderRadius: 10,
        border: "1px solid #e2e8f0",
        background: "#fff",
        cursor: onClick ? "pointer" : "default",
        textAlign: "left",
      }}
    >
      <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 900, color: dark }}>{value}</div>
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ ...card, marginBottom: 14 }}>
      <h3 style={{ margin: "0 0 8px", color: dark }}>{title}</h3>
      {children}
    </div>
  );
}
