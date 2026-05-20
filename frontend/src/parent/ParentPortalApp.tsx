import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { API_URL, apiFetch } from "../api";
import {
  clearParentSession,
  getParentSession,
  getParentToken,
  parentApiFetch,
  setParentSession,
} from "./parentApi";
import { useParentPortalPushPreparation } from "./useParentPortalPushPreparation";

const LAST_VISIT_KEY = "parentPortalLastVisitAt";

type Learner = {
  id: string;
  firstName: string;
  lastName: string;
  grade: string;
  className: string | null;
  admissionNo: string | null;
  familyAccountId?: string | null;
  familyAccount?: { id: string; accountRef: string; familyName?: string | null } | null;
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
  learner?: { firstName: string; lastName: string; grade?: string } | null;
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

type ParentBillingTransaction = {
  auditNo: number;
  id: string;
  date: string;
  type: string;
  learner: string;
  reference: string;
  description: string;
  amountIn: number;
  amountOut: number;
  balance: number;
};

type ParentBillingSnapshot = {
  balance: number;
  accountRef: string;
  isFamilyAccount: boolean;
  learners: { id: string; firstName: string; lastName: string; grade: string }[];
  transactions: ParentBillingTransaction[];
};

type Panel =
  | "dashboard"
  | "messages"
  | "homework"
  | "notices"
  | "documents"
  | "statements"
  | "incidents"
  | "settings"
  | "notifications"
  | "profile";

const gold = "#d4af37";
const dark = "#0a0e14";
const cardBg = "#111827";
const cardBorder = "rgba(212, 175, 55, 0.22)";
const text = "#e2e8f0";
const muted = "#94a3b8";

const shell: CSSProperties = {
  minHeight: "100vh",
  background: `linear-gradient(180deg, ${dark} 0%, #0d121c 40%, #0a0e14 100%)`,
  color: text,
  fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
  WebkitFontSmoothing: "antialiased",
};

const card: CSSProperties = {
  background: cardBg,
  border: `1px solid ${cardBorder}`,
  borderRadius: 12,
  padding: 12,
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
};

const btnGold: CSSProperties = {
  background: `linear-gradient(180deg, ${gold}, #b8922a)`,
  color: dark,
  border: "none",
  borderRadius: 10,
  padding: "10px 14px",
  fontWeight: 800,
  cursor: "pointer",
  fontSize: 14,
};

const btnGhost: CSSProperties = {
  background: "transparent",
  color: gold,
  border: `1px solid ${cardBorder}`,
  borderRadius: 10,
  padding: "8px 12px",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 13,
};

const navItems: { key: Panel; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "messages", label: "Messages" },
  { key: "homework", label: "Homework" },
  { key: "notices", label: "Notices" },
  { key: "documents", label: "Documents" },
  { key: "statements", label: "Statements" },
  { key: "incidents", label: "Incidents" },
  { key: "settings", label: "Settings" },
];

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function notificationCategoryLabel(type: string): string {
  switch (type) {
    case "INVOICE_READY":
      return "Invoice ready";
    case "STATEMENT_READY":
      return "Statement ready";
    case "TEACHER_MESSAGE":
      return "Teacher reply";
    case "INCIDENT":
      return "Incident";
    case "HOMEWORK":
      return "Homework uploaded";
    case "SCHOOL_NOTICE":
    case "ASSESSMENT":
    case "EXAM":
      return "Notice added";
    case "DOCUMENT":
      return "Document";
    case "ONBOARDING":
      return "Welcome";
    default:
      return type.replace(/_/g, " ").toLowerCase();
  }
}

function documentHref(url: string) {
  const u = String(url || "").trim();
  if (!u) return "#";
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return `${API_URL}${u.startsWith("/") ? "" : "/"}${u}`;
}

function formatMoney(value: unknown) {
  const n = Number(value);
  const amount = Number.isFinite(n) ? n : 0;
  return `R ${amount.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatShortDate(iso: string | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "—";
  }
}

function nextDueHomework(homework: any[]): { title: string; due: string } | null {
  const list = Array.isArray(homework) ? homework : [];
  const withDue = list
    .filter((h) => h?.dueDate)
    .map((h) => ({ h, t: new Date(h.dueDate).getTime() }))
    .filter((x) => !Number.isNaN(x.t));
  withDue.sort((a, b) => a.t - b.t);
  const first = withDue[0];
  if (!first) return list[0] ? { title: list[0].title, due: "No due date" } : null;
  return { title: first.h.title, due: `Due ${new Date(first.h.dueDate).toLocaleDateString()}` };
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
  const [shellView, setShellView] = useState<"login" | "pwa" | "app">(getParentToken() ? "app" : "login");
  const [panel, setPanel] = useState<Panel>("dashboard");
  const [session, setSession] = useState(getParentSession());
  const [selectedLearnerId, setSelectedLearnerId] = useState("");
  const [dashboard, setDashboard] = useState<any>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [teacherInfo, setTeacherInfo] = useState<{ name: string; email: string } | null>(null);
  const [messageDraft, setMessageDraft] = useState("");
  const [schoolBranding, setSchoolBranding] = useState<{ logoUrl?: string | null; name?: string }>({});
  const [profileLearnerId, setProfileLearnerId] = useState<string | null>(null);
  const [incidentDetail, setIncidentDetail] = useState<any>(null);
  const [incidentLoading, setIncidentLoading] = useState(false);
  const [lastVisitShown, setLastVisitShown] = useState<string | null>(null);
  const [familyBilling, setFamilyBilling] = useState<ParentBillingSnapshot | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);

  const learners: LinkRow[] = useMemo(() => {
    const rows = (session?.learners || dashboard?.learners || []) as any[];
    return rows.map((r: any) => ({
      linkId: r.linkId || r.id,
      relation: r.relation ?? null,
      learner: r.learner || r,
    }));
  }, [session, dashboard]);

  const findLearner = useCallback(
    (id: string): Learner | null => {
      if (!id) return null;
      const row = learners.find((l) => l.learner.id === id);
      if (row) return row.learner;
      const raw = (dashboard?.learners || []) as Learner[];
      return raw.find((l) => l.id === id) || null;
    },
    [learners, dashboard?.learners]
  );

  const activeLearner = useMemo(() => {
    const id = selectedLearnerId || dashboard?.activeLearner?.id;
    return findLearner(id || "") || dashboard?.activeLearner || null;
  }, [findLearner, selectedLearnerId, dashboard]);

  const familyBillingLearners = useMemo(() => {
    const anchorId = selectedLearnerId || activeLearner?.id || learners[0]?.learner?.id || "";
    const anchor = learners.find((row) => row.learner.id === anchorId)?.learner;
    if (!anchor) return [];

    const familyId = String(anchor.familyAccountId || anchor.familyAccount?.id || "").trim();
    const accountRef = String(anchor.familyAccount?.accountRef || "").trim();

    if (familyId) {
      return learners
        .filter((row) => String(row.learner.familyAccountId || row.learner.familyAccount?.id || "") === familyId)
        .map((row) => row.learner);
    }
    if (accountRef) {
      return learners
        .filter((row) => String(row.learner.familyAccount?.accountRef || "") === accountRef)
        .map((row) => row.learner);
    }
    return anchorId ? [anchor] : [];
  }, [learners, selectedLearnerId, activeLearner?.id]);

  const schoolName =
    schoolBranding?.name || session?.parent?.school?.name || dashboard?.activeLearner?.school?.name || "Your school";

  const parentDisplayName = session?.parent
    ? `${session.parent.firstName} ${session.parent.surname}`.trim()
    : "Parent";

  const unreadNotifCount = useMemo(() => {
    const list = (dashboard?.notifications || []) as Notification[];
    return list.filter((n) => !n.isRead).length;
  }, [dashboard?.notifications]);

  useEffect(() => {
    void apiFetch("/api/schools/")
      .then((data: any) => {
        const list = Array.isArray(data) ? data : Array.isArray(data?.schools) ? data.schools : [];
        setSchools(list.map((s: any) => ({ id: s.id, name: s.name })));
      })
      .catch(() => {});
  }, []);

  const sid = session?.parent?.school?.id || "";
  const parentId = session?.parent?.id || "";

  useParentPortalPushPreparation({
    enabled: import.meta.env.VITE_REGISTER_PARENT_PUSH_SW === "true",
    schoolId: sid,
    parentId,
  });

  useEffect(() => {
    if (!sid) return;
    void apiFetch(`/api/schools/${encodeURIComponent(sid)}`)
      .then((s: any) => {
        setSchoolBranding({ logoUrl: s?.logoUrl || null, name: s?.name || undefined });
      })
      .catch(() => {});
  }, [sid]);

  useEffect(() => {
    if (!getParentToken()) return;
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLearnerId]);

  useEffect(() => {
    if (shellView !== "app" || panel !== "notifications") return;
    void refreshNotificationsList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shellView, panel]);

  useEffect(() => {
    if (shellView !== "app" || panel !== "statements") return;
    const anchorId = selectedLearnerId || activeLearner?.id || learners[0]?.learner?.id || "";
    if (!anchorId) return;
    let cancelled = false;
    setBillingLoading(true);
    const qs = new URLSearchParams({ learnerId: anchorId });
    void parentApiFetch(`/api/parent-portal/billing?${qs}`)
      .then((data) => {
        if (cancelled) return;
        setFamilyBilling({
          balance: Number(data.balance) || 0,
          accountRef: String(data.accountRef || ""),
          isFamilyAccount: Boolean(data.isFamilyAccount),
          learners: Array.isArray(data.learners) ? data.learners : [],
          transactions: Array.isArray(data.transactions) ? data.transactions : [],
        });
      })
      .catch(() => {
        if (!cancelled) setFamilyBilling(null);
      })
      .finally(() => {
        if (!cancelled) setBillingLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shellView, panel, selectedLearnerId, activeLearner?.id, learners]);

  useEffect(() => {
    if (shellView !== "app" || panel !== "messages" || !activeLearner?.id) return;
    let cancelled = false;
    setLoading(true);
    const qs = new URLSearchParams({ learnerId: activeLearner.id });
    void parentApiFetch(`/api/parent-portal/thread?${qs}`)
      .then((data) => {
        if (cancelled) return;
        setTeacherInfo(data.teacher || null);
        setThreadMessages(data?.thread?.messages || []);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || "Failed to load messages");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shellView, panel, activeLearner?.id]);

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const qs = selectedLearnerId ? `?learnerId=${encodeURIComponent(selectedLearnerId)}` : "";
      const data = await parentApiFetch(`/api/parent-portal/dashboard${qs}`);
      setDashboard(data);
      if (!selectedLearnerId) {
        const pick = data?.autoSelectLearner?.id || (Array.isArray(data.learners) && data.learners[0]?.id);
        if (pick) setSelectedLearnerId(pick);
      }
      const me = await parentApiFetch("/api/parent-portal/me");
      setSession({ parent: me.parent, learners: me.learners });
      try {
        const prev = localStorage.getItem(LAST_VISIT_KEY);
        if (prev) {
          const t = Number(prev);
          if (Number.isFinite(t)) {
            setLastVisitShown(new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
          }
        } else {
          setLastVisitShown(null);
        }
        localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
      } catch {
        setLastVisitShown(null);
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load dashboard");
      if (String(e?.message || "").includes("401")) {
        clearParentSession();
        setShellView("login");
      }
    } finally {
      setLoading(false);
    }
  }

  async function refreshNotificationsList() {
    try {
      const data = await parentApiFetch("/api/parent-portal/notifications");
      setNotifications(data.notifications || []);
    } catch {
      /* ignore */
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
      setShellView("app");
      setPanel("dashboard");
      await loadDashboard();
    } catch (e: any) {
      setError(e?.message || "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  async function openNotificationsPanel() {
    setPanel("notifications");
    await refreshNotificationsList();
  }

  function openMessages(overrideLearnerId?: string) {
    const id =
      overrideLearnerId ||
      selectedLearnerId ||
      dashboard?.autoSelectLearner?.id ||
      (Array.isArray(dashboard?.learners) ? dashboard.learners[0]?.id : "") ||
      "";
    const learner = findLearner(id);
    if (!learner) {
      setError("Select a learner first.");
      return;
    }
    if (overrideLearnerId && overrideLearnerId !== selectedLearnerId) {
      setSelectedLearnerId(overrideLearnerId);
    }
    setError(null);
    setPanel("messages");
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

  async function markNotificationRead(id: string) {
    try {
      await parentApiFetch(`/api/parent-portal/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" });
      await refreshNotificationsList();
      await loadDashboard();
    } catch {
      /* ignore */
    }
  }

  async function openIncident(id: string) {
    setIncidentLoading(true);
    setError(null);
    try {
      const data = await parentApiFetch(`/api/parent-portal/incidents/${encodeURIComponent(id)}`);
      setIncidentDetail(data.incident || null);
    } catch (e: any) {
      setError(e?.message || "Could not load incident");
    } finally {
      setIncidentLoading(false);
    }
  }

  function logout() {
    clearParentSession();
    setShellView("login");
    setDashboard(null);
    setSession(null);
    setSelectedLearnerId("");
    setPanel("dashboard");
  }

  const latestStatement = useMemo(() => {
    const list = (dashboard?.notifications || []) as Notification[];
    return list.find((n) => n.type === "STATEMENT_READY") || null;
  }, [dashboard?.notifications]);

  const homeworkDuePreview = useMemo(() => nextDueHomework(dashboard?.homework || []), [dashboard?.homework]);

  const profileLearner = profileLearnerId ? findLearner(profileLearnerId) : null;

  if (shellView === "login") {
    return (
      <div style={{ ...shell, background: "#f1f5f9", color: dark }}>
        <header
          style={{
            background: dark,
            color: "#fff",
            padding: "12px 16px",
            borderBottom: `2px solid ${gold}`,
          }}
        >
          <strong style={{ color: gold, fontSize: 17 }}>EduClear Parent Portal</strong>
        </header>
        <main style={{ maxWidth: 440, margin: "16px auto", padding: "0 12px 24px" }}>
          <div style={{ ...card, background: "#fff", color: dark, padding: 14 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>Sign in</h2>
            <p style={{ color: "#64748b", fontSize: 13, margin: 0, lineHeight: 1.45 }}>
              Sign in with your ID number and OTP. View invoices, statements, notices, and message your child&apos;s class teacher.
            </p>
            <label style={{ display: "block", marginTop: 10, fontWeight: 700, fontSize: 13 }}>School</label>
            <select
              value={schoolId}
              onChange={(e) => setSchoolId(e.target.value)}
              style={{ width: "100%", padding: 10, marginTop: 4, borderRadius: 8, border: "1px solid #e2e8f0" }}
            >
              <option value="">Select school</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <label style={{ display: "block", marginTop: 10, fontWeight: 700, fontSize: 13 }}>ID number</label>
            <input
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
              style={{ width: "100%", padding: 10, marginTop: 4, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            <label style={{ display: "block", marginTop: 10, fontWeight: 700, fontSize: 13 }}>Mobile (optional)</label>
            <input
              value={cellNo}
              onChange={(e) => setCellNo(e.target.value)}
              style={{ width: "100%", padding: 10, marginTop: 4, borderRadius: 8, border: "1px solid #e2e8f0" }}
            />
            {error && <p style={{ color: "#b45309", marginTop: 10, fontSize: 13 }}>{error}</p>}
            {!otpSent ? (
              <button type="button" style={{ ...btnGold, marginTop: 12, width: "100%" }} onClick={() => void requestOtp()} disabled={loading}>
                {loading ? "Sending…" : "Send OTP"}
              </button>
            ) : (
              <>
                <label style={{ display: "block", marginTop: 10, fontWeight: 700, fontSize: 13 }}>OTP code</label>
                <input
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  style={{ width: "100%", padding: 10, marginTop: 4, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
                <button type="button" style={{ ...btnGold, marginTop: 12, width: "100%" }} onClick={() => void verifyOtp()} disabled={loading}>
                  {loading ? "Verifying…" : "Verify & enter"}
                </button>
              </>
            )}
            {isMobile() && (
              <button
                type="button"
                style={{ ...btnGhost, marginTop: 10, width: "100%", color: dark, borderColor: "#cbd5e1" }}
                onClick={() => setShellView("pwa")}
              >
                Install app instructions
              </button>
            )}
          </div>
        </main>
      </div>
    );
  }

  if (shellView === "pwa") {
    return (
      <div style={{ ...shell, padding: 16 }}>
        <div style={card}>
          <h2 style={{ marginTop: 0, color: gold, fontSize: 18 }}>Add EduClear to your home screen</h2>
          <p style={{ fontSize: 14, lineHeight: 1.5 }}>
            <strong>iPhone (Safari):</strong> Tap Share → Add to Home Screen.
          </p>
          <p style={{ fontSize: 14, lineHeight: 1.5 }}>
            <strong>Android (Chrome):</strong> Menu (⋮) → Install app / Add to Home screen.
          </p>
          <p style={{ fontSize: 14 }}>
            Open:{" "}
            <a href="/parent" style={{ color: gold }}>
              {window.location.origin}/parent
            </a>
          </p>
          <button type="button" style={btnGold} onClick={() => setShellView(getParentToken() ? "app" : "login")}>
            Back
          </button>
        </div>
      </div>
    );
  }

  const statementsUrl = `${API_URL}/api/statements/accounts?schoolId=${encodeURIComponent(session?.parent?.school?.id || schoolId)}`;

  return (
    <div style={shell}>
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "rgba(10,14,20,0.92)",
          backdropFilter: "blur(8px)",
          borderBottom: `1px solid ${cardBorder}`,
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: gold }}>EDUCLEAR</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            Parent Portal
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          <button
            type="button"
            aria-label="Notifications"
            onClick={() => void openNotificationsPanel()}
            style={{
              position: "relative",
              ...btnGhost,
              padding: "8px 10px",
              borderRadius: 999,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 900, color: gold, letterSpacing: 0.5 }}>Alerts</span>
            {unreadNotifCount > 0 ? (
              <span
                style={{
                  position: "absolute",
                  top: -4,
                  right: -4,
                  background: gold,
                  color: dark,
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 900,
                  minWidth: 18,
                  height: 18,
                  lineHeight: "18px",
                  textAlign: "center",
                  padding: "0 4px",
                }}
              >
                {unreadNotifCount > 9 ? "9+" : unreadNotifCount}
              </span>
            ) : null}
          </button>
          <button type="button" style={{ ...btnGhost, padding: "8px 10px" }} onClick={logout}>
            Logout
          </button>
        </div>
      </header>

      <nav
        style={{
          position: "sticky",
          top: 49,
          zIndex: 15,
          display: "flex",
          gap: 6,
          padding: "8px 10px",
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          borderBottom: `1px solid rgba(255,255,255,0.06)`,
          background: "rgba(10,14,20,0.88)",
        }}
        aria-label="Parent portal sections"
      >
        {navItems.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setProfileLearnerId(null);
              setIncidentDetail(null);
              setPanel(item.key);
            }}
            style={{
              flex: "0 0 auto",
              padding: "7px 12px",
              borderRadius: 999,
              border: panel === item.key ? `1px solid ${gold}` : `1px solid rgba(255,255,255,0.08)`,
              background: panel === item.key ? "rgba(212,175,55,0.12)" : "transparent",
              color: panel === item.key ? gold : muted,
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <main style={{ maxWidth: 720, margin: "0 auto", padding: "10px 10px 88px" }}>
        {error && (
          <div
            style={{
              ...card,
              borderColor: "rgba(251,191,36,0.45)",
              color: "#fde68a",
              marginBottom: 10,
              fontSize: 13,
              padding: 10,
            }}
          >
            {error}
          </div>
        )}

        {panel === "dashboard" && (
          <>
            <WelcomeStrip
              parentName={parentDisplayName}
              schoolName={schoolName}
              logoUrl={schoolBranding.logoUrl}
              learnerCount={learners.length}
              lastVisit={lastVisitShown}
              unreadCount={unreadNotifCount}
              onOpenNotifications={() => void openNotificationsPanel()}
            />

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 8,
                marginBottom: 10,
              }}
            >
              <SummaryCard
                title="Notifications"
                subtitle={unreadNotifCount ? `${unreadNotifCount} unread` : "Up to date"}
                onClick={() => void openNotificationsPanel()}
              />
              <SummaryCard
                title="Latest invoice"
                subtitle={dashboard?.latestInvoiceNotification?.title || "None yet"}
                onClick={() => setPanel("statements")}
              />
              <SummaryCard
                title="Latest statement"
                subtitle={latestStatement?.title || "None yet"}
                onClick={() => setPanel("statements")}
              />
              <SummaryCard
                title="Homework due"
                subtitle={homeworkDuePreview ? homeworkDuePreview.due : "None"}
                onClick={() => setPanel("homework")}
              />
              <SummaryCard
                title="Unread messages"
                subtitle={String(dashboard?.unreadTeacherMessages ?? 0)}
                onClick={() => void openMessages()}
              />
              <SummaryCard
                title="Incidents"
                subtitle={String(dashboard?.incidents?.length || 0)}
                onClick={() => setPanel("incidents")}
              />
              <SummaryCard
                title="Notices"
                subtitle={dashboard?.notices?.[0]?.title?.slice(0, 36) || "—"}
                onClick={() => setPanel("notices")}
              />
            </div>

            <div style={{ fontSize: 12, fontWeight: 800, color: gold, letterSpacing: 0.6, margin: "4px 2px 8px" }}>YOUR CHILDREN</div>
            {learners.map((row) => (
              <LearnerPremiumCard
                key={row.learner.id}
                row={row}
                selected={selectedLearnerId === row.learner.id}
                billingHint={billingHintForLearner(row.learner.id, dashboard?.notifications)}
                onSelect={() => setSelectedLearnerId(row.learner.id)}
                onProfile={() => {
                  setProfileLearnerId(row.learner.id);
                  setPanel("profile");
                }}
                onMessage={() => void openMessages(row.learner.id)}
                onHomework={() => {
                  setSelectedLearnerId(row.learner.id);
                  setPanel("homework");
                }}
                onNotices={() => {
                  setSelectedLearnerId(row.learner.id);
                  setPanel("notices");
                }}
              />
            ))}
          </>
        )}

        {panel === "notifications" && (
          <div style={card}>
            <PanelHeader title="Notifications" onBack={() => setPanel("dashboard")} />
            <p style={{ color: muted, fontSize: 12, marginTop: 0 }}>
              Invoice ready, teacher replies, incidents, homework, and notices appear here.
            </p>
            {notifications.length === 0 && <p style={{ color: muted, fontSize: 14 }}>No notifications yet.</p>}
            {notifications.map((n) => (
              <div
                key={n.id}
                style={{
                  padding: "10px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  opacity: n.isRead ? 0.72 : 1,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: gold }}>{notificationCategoryLabel(n.type)}</div>
                    <strong style={{ fontSize: 14 }}>{n.title}</strong>
                  </div>
                  <span style={{ fontSize: 10, color: muted, whiteSpace: "nowrap" }}>{new Date(n.createdAt).toLocaleDateString()}</span>
                </div>
                <p style={{ margin: "6px 0 0", fontSize: 13, color: muted, lineHeight: 1.45 }}>{n.message}</p>
                {!n.isRead ? (
                  <button type="button" style={{ ...btnGhost, marginTop: 8, fontSize: 12, padding: "6px 10px" }} onClick={() => void markNotificationRead(n.id)}>
                    Mark read
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {panel === "messages" && (
          <div style={card}>
            <PanelHeader title="Messages" onBack={() => setPanel("dashboard")} />
            <LearnerSwitchStrip learners={learners} selectedId={selectedLearnerId} onSelect={setSelectedLearnerId} />
            {activeLearner ? (
              <p style={{ margin: "0 0 8px", fontSize: 12, color: muted }}>
                {activeLearner.firstName} {activeLearner.lastName} · {activeLearner.grade}{" "}
                {activeLearner.className ? `· ${activeLearner.className}` : ""}
              </p>
            ) : null}
            <h3 style={{ margin: "0 0 8px", fontSize: 16, color: gold }}>Class teacher: {teacherInfo?.name || "Assigned teacher"}</h3>
            <div style={{ maxHeight: 340, overflowY: "auto", margin: "8px 0", display: "flex", flexDirection: "column", gap: 6 }}>
              {threadMessages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    alignSelf: m.sender === "PARENT" ? "flex-end" : "flex-start",
                    maxWidth: "88%",
                    background: m.sender === "PARENT" ? "rgba(212,175,55,0.18)" : "rgba(255,255,255,0.06)",
                    padding: "8px 10px",
                    borderRadius: 12,
                    border: `1px solid ${m.sender === "PARENT" ? "rgba(212,175,55,0.35)" : "rgba(255,255,255,0.08)"}`,
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 800, color: gold }}>{m.senderName || m.sender}</div>
                  <div style={{ fontSize: 14, lineHeight: 1.45 }}>{m.body}</div>
                </div>
              ))}
            </div>
            <textarea
              value={messageDraft}
              onChange={(e) => setMessageDraft(e.target.value)}
              rows={3}
              style={{
                width: "100%",
                padding: 10,
                borderRadius: 10,
                border: `1px solid ${cardBorder}`,
                background: "#0f172a",
                color: text,
                resize: "vertical",
              }}
            />
            <button type="button" style={{ ...btnGold, marginTop: 8, width: "100%" }} onClick={() => void sendMessage()} disabled={loading}>
              Send
            </button>
            <p style={{ fontSize: 11, color: muted, marginTop: 8, lineHeight: 1.45 }}>
              Messages go to your child&apos;s class teacher for this learner. Switch learner from the dashboard if you have more than one child.
            </p>
          </div>
        )}

        {panel === "homework" && (
          <div style={card}>
            <PanelHeader title="Homework" onBack={() => setPanel("dashboard")} />
            <LearnerSwitchStrip learners={learners} selectedId={selectedLearnerId} onSelect={setSelectedLearnerId} />
            {(!dashboard?.homework || dashboard.homework.length === 0) && <p style={{ color: muted }}>No homework posted yet.</p>}
            {(dashboard?.homework || []).map((h: any) => (
              <div key={h.id} style={{ padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <strong style={{ fontSize: 14 }}>{h.title}</strong>
                {h.dueDate ? (
                  <div style={{ fontSize: 12, color: gold, marginTop: 4 }}>Due {new Date(h.dueDate).toLocaleDateString()}</div>
                ) : (
                  <div style={{ fontSize: 12, color: muted, marginTop: 4 }}>No due date</div>
                )}
              </div>
            ))}
          </div>
        )}

        {panel === "notices" && (
          <div style={card}>
            <PanelHeader title="Notices" onBack={() => setPanel("dashboard")} />
            <LearnerSwitchStrip learners={learners} selectedId={selectedLearnerId} onSelect={setSelectedLearnerId} />
            {(!dashboard?.notices || dashboard.notices.length === 0) && <p style={{ color: muted }}>No notices yet.</p>}
            {(dashboard?.notices || []).map((n: any) => (
              <div key={n.id} style={{ padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <strong style={{ fontSize: 14 }}>{n.title}</strong>
                <div style={{ fontSize: 13, color: muted, marginTop: 4, lineHeight: 1.45 }}>{String(n.body || "").slice(0, 220)}</div>
              </div>
            ))}
          </div>
        )}

        {panel === "documents" && (
          <div style={card}>
            <PanelHeader title="Documents" onBack={() => setPanel("dashboard")} />
            <LearnerSwitchStrip learners={learners} selectedId={selectedLearnerId} onSelect={setSelectedLearnerId} />
            {(!dashboard?.documents || dashboard.documents.length === 0) && <p style={{ color: muted }}>No documents yet.</p>}
            {(dashboard?.documents || []).map((d: any) => (
              <div key={d.id} style={{ padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <a href={documentHref(d.fileUrl)} target="_blank" rel="noreferrer" style={{ color: gold, fontWeight: 800, textDecoration: "none" }}>
                  {d.title}
                </a>
                {d.description ? <div style={{ fontSize: 12, color: muted, marginTop: 4 }}>{d.description}</div> : null}
              </div>
            ))}
          </div>
        )}

        {panel === "statements" && (
          <div style={card}>
            <PanelHeader title="Statements & invoices" onBack={() => setPanel("dashboard")} />
            <p style={{ color: muted, fontSize: 13, lineHeight: 1.5, marginTop: 0 }}>
              View and download your school billing files. A credit or negative amount on a statement usually means your account is in credit — not
              necessarily an error.
            </p>
            {familyBillingLearners.length > 1 ? (
              <div
                style={{
                  background: "rgba(212,175,55,0.08)",
                  border: `1px solid ${cardBorder}`,
                  padding: 10,
                  borderRadius: 10,
                  marginBottom: 10,
                  fontSize: 13,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 800, color: gold, marginBottom: 6 }}>
                  Billing account{" "}
                  {familyBillingLearners[0]?.familyAccount?.accountRef || "shared"}
                </div>
                <div style={{ fontWeight: 800, marginBottom: 4 }}>Children on this account</div>
                <ul style={{ margin: 0, paddingLeft: 18, color: text }}>
                  {familyBillingLearners.map((child) => (
                    <li key={child.id}>
                      {child.firstName} {child.lastName}
                      {child.grade ? ` · Grade ${child.grade}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {dashboard?.latestInvoiceNotification && (
              <div
                style={{
                  background: "rgba(212,175,55,0.1)",
                  border: `1px solid ${cardBorder}`,
                  padding: 10,
                  borderRadius: 10,
                  marginBottom: 10,
                  fontSize: 13,
                  color: text,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 800, color: gold, marginBottom: 4 }}>Latest invoice notice</div>
                {dashboard.latestInvoiceNotification.message}
              </div>
            )}
            {latestStatement && (
              <div
                style={{
                  background: "rgba(148,163,184,0.08)",
                  border: `1px solid rgba(148,163,184,0.25)`,
                  padding: 10,
                  borderRadius: 10,
                  marginBottom: 10,
                  fontSize: 13,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 800, color: muted, marginBottom: 4 }}>Latest statement notice</div>
                <strong>{latestStatement.title}</strong>
                <div style={{ color: muted, marginTop: 4 }}>{latestStatement.message}</div>
              </div>
            )}
            {billingLoading ? (
              <p style={{ color: muted, fontSize: 13 }}>Loading billing…</p>
            ) : familyBilling ? (
              <div style={{ marginBottom: 12 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 8,
                    marginBottom: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: gold }}>Account balance</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: familyBilling.balance > 0 ? "#fca5a5" : "#86efac" }}>
                      {formatMoney(familyBilling.balance)}
                    </div>
                  </div>
                  {familyBilling.accountRef ? (
                    <div style={{ fontSize: 12, color: muted, fontWeight: 700 }}>Ref {familyBilling.accountRef}</div>
                  ) : null}
                </div>
                {familyBilling.transactions.length === 0 ? (
                  <p style={{ color: muted, fontSize: 13, margin: 0 }}>No transactions on this account yet.</p>
                ) : (
                  <div style={{ overflowX: "auto", border: `1px solid ${cardBorder}`, borderRadius: 10 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 520 }}>
                      <thead>
                        <tr style={{ background: "rgba(0,0,0,0.25)" }}>
                          {(familyBilling.isFamilyAccount
                            ? ["Date", "Type", "Learner", "Description", "In", "Out", "Balance"]
                            : ["Date", "Type", "Description", "In", "Out", "Balance"]
                          ).map((h) => (
                            <th
                              key={h}
                              style={{
                                padding: "8px 10px",
                                textAlign: h === "In" || h === "Out" || h === "Balance" ? "right" : "left",
                                color: muted,
                                fontWeight: 800,
                                borderBottom: `1px solid ${cardBorder}`,
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {familyBilling.transactions.map((row) => (
                          <tr key={row.id}>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                              {row.date || "—"}
                            </td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{row.type}</td>
                            {familyBilling.isFamilyAccount ? (
                              <td style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                                {row.learner || "—"}
                              </td>
                            ) : null}
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                              {row.description || row.reference || "—"}
                            </td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", textAlign: "right" }}>
                              {row.amountIn ? formatMoney(row.amountIn) : "—"}
                            </td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", textAlign: "right" }}>
                              {row.amountOut ? formatMoney(row.amountOut) : "—"}
                            </td>
                            <td style={{ padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", textAlign: "right", fontWeight: 800 }}>
                              {formatMoney(row.balance)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
            <a href={statementsUrl} target="_blank" rel="noreferrer" style={{ ...btnGhost, display: "block", textAlign: "center", textDecoration: "none", marginTop: 8 }}>
              Open raw statement data
            </a>
          </div>
        )}

        {panel === "incidents" && (
          <div style={card}>
            <PanelHeader title="Incidents" onBack={() => setPanel("dashboard")} />
            <LearnerSwitchStrip learners={learners} selectedId={selectedLearnerId} onSelect={setSelectedLearnerId} />
            {incidentLoading && <p style={{ color: muted, fontSize: 13 }}>Loading…</p>}
            {(!dashboard?.incidents || dashboard.incidents.length === 0) && !incidentLoading && (
              <p style={{ color: muted }}>No incidents to show.</p>
            )}
            {(dashboard?.incidents || []).map((inc: any) => (
              <button
                key={inc.id}
                type="button"
                onClick={() => void openIncident(inc.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 0",
                  border: "none",
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  background: "transparent",
                  color: text,
                  cursor: "pointer",
                }}
              >
                <strong style={{ fontSize: 14 }}>{inc.subject}</strong>
                <div style={{ fontSize: 12, color: muted, marginTop: 4 }}>{String(inc.summary || "").slice(0, 160)}</div>
              </button>
            ))}
            {incidentDetail && (
              <div style={{ marginTop: 12, padding: 10, borderRadius: 10, border: `1px solid ${cardBorder}`, background: "rgba(0,0,0,0.25)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <strong style={{ color: gold }}>{incidentDetail.subject}</strong>
                  <button type="button" style={{ ...btnGhost, fontSize: 11, padding: "4px 8px" }} onClick={() => setIncidentDetail(null)}>
                    Close
                  </button>
                </div>
                <div style={{ fontSize: 12, color: muted, marginTop: 4 }}>{formatShortDate(incidentDetail.incidentDate)}</div>
                <p style={{ fontSize: 14, lineHeight: 1.5, marginTop: 8 }}>{incidentDetail.summary}</p>
              </div>
            )}
          </div>
        )}

        {panel === "settings" && (
          <div style={card}>
            <PanelHeader title="Settings" onBack={() => setPanel("dashboard")} />
            <p style={{ color: muted, fontSize: 13 }}>Keep things simple: use the dashboard for day-to-day updates.</p>
            {isMobile() && (
              <button type="button" style={{ ...btnGold, width: "100%", marginTop: 8 }} onClick={() => setShellView("pwa")}>
                Install app instructions
              </button>
            )}
            <button type="button" style={{ ...btnGhost, width: "100%", marginTop: 8 }} onClick={logout}>
              Sign out
            </button>
          </div>
        )}

        {panel === "profile" && !profileLearner && (
          <div style={card}>
            <PanelHeader title="Learner profile" onBack={() => setPanel("dashboard")} />
            <p style={{ color: muted }}>Choose a learner from the dashboard.</p>
          </div>
        )}

        {panel === "profile" && profileLearner && (
          <div style={card}>
            <PanelHeader title="Learner profile" onBack={() => setPanel("dashboard")} />
            <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 4 }}>
              {profileLearner.firstName} {profileLearner.lastName}
            </div>
            <div style={{ fontSize: 13, color: muted, lineHeight: 1.6 }}>
              <div>
                <span style={{ color: gold, fontWeight: 800 }}>Grade / class:</span> {profileLearner.grade}
                {profileLearner.className ? ` · ${profileLearner.className}` : ""}
              </div>
              {profileLearner.admissionNo ? (
                <div>
                  <span style={{ color: gold, fontWeight: 800 }}>Admission no.:</span> {profileLearner.admissionNo}
                </div>
              ) : null}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
              <button type="button" style={{ ...btnGold, width: "100%" }} onClick={() => void openMessages(profileLearner.id)}>
                Message teacher
              </button>
              <button
                type="button"
                style={{ ...btnGhost, width: "100%" }}
                onClick={() => {
                  setSelectedLearnerId(profileLearner.id);
                  setPanel("homework");
                }}
              >
                Homework
              </button>
            </div>
          </div>
        )}

        {loading && (
          <p style={{ textAlign: "center", color: muted, fontSize: 13, marginTop: 8 }}>Loading…</p>
        )}
      </main>
    </div>
  );
}

function billingHintForLearner(learnerId: string, notifications: Notification[] | undefined): { label: string; tone: "gold" | "slate" } {
  const list = notifications || [];
  const forLearner = (n: Notification) => !n.learnerId || n.learnerId === learnerId;
  if (list.some((n) => forLearner(n) && n.type === "INVOICE_READY" && !n.isRead)) {
    return { label: "New invoice available", tone: "gold" };
  }
  if (list.some((n) => forLearner(n) && n.type === "STATEMENT_READY" && !n.isRead)) {
    return { label: "Statement ready to view", tone: "gold" };
  }
  if (list.some((n) => forLearner(n) && (n.type === "TEACHER_MESSAGE" || n.type === "HOMEWORK") && !n.isRead)) {
    return { label: "Updates waiting", tone: "slate" };
  }
  return { label: "Billing: no new alerts", tone: "slate" };
}

function WelcomeStrip({
  parentName,
  schoolName,
  logoUrl,
  learnerCount,
  lastVisit,
  unreadCount,
  onOpenNotifications,
}: {
  parentName: string;
  schoolName: string;
  logoUrl?: string | null;
  learnerCount: number;
  lastVisit: string | null;
  unreadCount: number;
  onOpenNotifications: () => void;
}) {
  return (
    <div
      style={{
        ...card,
        padding: 12,
        marginBottom: 10,
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 10,
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          border: `1px solid ${cardBorder}`,
          overflow: "hidden",
          background: "rgba(0,0,0,0.35)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {logoUrl ? (
          <img src={logoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span style={{ fontSize: 11, fontWeight: 900, color: gold }}>SCH</span>
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, color: muted, fontWeight: 700 }}>Welcome back</div>
        <div style={{ fontSize: 16, fontWeight: 900, lineHeight: 1.25, wordBreak: "break-word" }}>{parentName}</div>
        <div style={{ fontSize: 12, color: muted, marginTop: 2, fontWeight: 600 }}>{schoolName}</div>
        <div style={{ fontSize: 11, color: muted, marginTop: 4 }}>
          {learnerCount} learner{learnerCount === 1 ? "" : "s"}
          {lastVisit ? ` · Last visit: ${lastVisit}` : ""}
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenNotifications}
        style={{
          position: "relative",
          width: 40,
          height: 40,
          borderRadius: 999,
          border: `1px solid ${cardBorder}`,
          background: "rgba(212,175,55,0.08)",
          cursor: "pointer",
          flexShrink: 0,
        }}
        aria-label="Open notifications"
      >
        <span style={{ fontSize: 10, fontWeight: 900, color: gold }}>Alerts</span>
        {unreadCount > 0 ? (
          <span
            style={{
              position: "absolute",
              top: -2,
              right: -2,
              background: gold,
              color: dark,
              borderRadius: 999,
              fontSize: 10,
              fontWeight: 900,
              minWidth: 16,
              height: 16,
              lineHeight: "16px",
              textAlign: "center",
              padding: "0 4px",
            }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}

function SummaryCard({ title, subtitle, onClick }: { title: string; subtitle: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      style={{
        textAlign: "left",
        padding: "10px 10px",
        borderRadius: 12,
        border: `1px solid ${cardBorder}`,
        background: "linear-gradient(145deg, rgba(30,41,59,0.9), rgba(15,23,42,0.95))",
        cursor: onClick ? "pointer" : "default",
        color: text,
        minHeight: 72,
        boxShadow: "0 4px 14px rgba(0,0,0,0.28)",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 800, color: gold, letterSpacing: 0.3 }}>{title}</div>
      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4, color: muted, lineHeight: 1.35 }}>{subtitle}</div>
    </button>
  );
}

function LearnerPremiumCard({
  row,
  selected,
  billingHint,
  onSelect,
  onProfile,
  onMessage,
  onHomework,
  onNotices,
}: {
  row: LinkRow;
  selected: boolean;
  billingHint: { label: string; tone: "gold" | "slate" };
  onSelect: () => void;
  onProfile: () => void;
  onMessage: () => void;
  onHomework: () => void;
  onNotices: () => void;
}) {
  const { learner, relation } = row;
  const chipBg = billingHint.tone === "gold" ? "rgba(212,175,55,0.12)" : "rgba(148,163,184,0.12)";
  const chipBorder = billingHint.tone === "gold" ? "rgba(212,175,55,0.35)" : "rgba(148,163,184,0.35)";
  const chipColor = billingHint.tone === "gold" ? "#fde68a" : muted;

  return (
    <div
      style={{
        ...card,
        marginBottom: 8,
        padding: 12,
        outline: selected ? `2px solid ${gold}` : "none",
        outlineOffset: 0,
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 8,
          width: "100%",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: text,
          textAlign: "left",
        }}
      >
        <div>
          <div style={{ fontSize: 17, fontWeight: 900 }}>
            {learner.firstName} {learner.lastName}
          </div>
          <div style={{ fontSize: 12, color: muted, marginTop: 2, fontWeight: 600 }}>
            {learner.grade}
            {learner.className ? ` · ${learner.className}` : ""}
            {relation ? ` · ${relation}` : ""}
          </div>
        </div>
        {selected ? (
          <span style={{ fontSize: 10, fontWeight: 900, color: dark, background: gold, padding: "3px 8px", borderRadius: 999 }}>SELECTED</span>
        ) : (
          <span style={{ fontSize: 10, fontWeight: 800, color: muted }}>Tap to select</span>
        )}
      </button>
      <div
        style={{
          marginTop: 8,
          fontSize: 11,
          fontWeight: 700,
          display: "inline-block",
          padding: "4px 8px",
          borderRadius: 8,
          background: chipBg,
          border: `1px solid ${chipBorder}`,
          color: chipColor,
        }}
      >
        {billingHint.label}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, marginTop: 10 }}>
        <button type="button" style={{ ...btnGhost, width: "100%", fontSize: 12, padding: "8px 6px" }} onClick={onProfile}>
          View profile
        </button>
        <button type="button" style={{ ...btnGold, width: "100%", fontSize: 12, padding: "8px 6px" }} onClick={onMessage}>
          Message teacher
        </button>
        <button type="button" style={{ ...btnGhost, width: "100%", fontSize: 12, padding: "8px 6px" }} onClick={onHomework}>
          Homework
        </button>
        <button type="button" style={{ ...btnGhost, width: "100%", fontSize: 12, padding: "8px 6px" }} onClick={onNotices}>
          Notices
        </button>
      </div>
    </div>
  );
}

function LearnerSwitchStrip({
  learners,
  selectedId,
  onSelect,
}: {
  learners: LinkRow[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (learners.length <= 1) return null;
  return (
    <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 10, paddingBottom: 2 }}>
      {learners.map((row) => (
        <button
          key={row.learner.id}
          type="button"
          onClick={() => onSelect(row.learner.id)}
          style={{
            flex: "0 0 auto",
            padding: "6px 10px",
            borderRadius: 999,
            border: selectedId === row.learner.id ? `1px solid ${gold}` : `1px solid rgba(255,255,255,0.1)`,
            background: selectedId === row.learner.id ? "rgba(212,175,55,0.12)" : "transparent",
            color: selectedId === row.learner.id ? gold : muted,
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          {row.learner.firstName}
        </button>
      ))}
    </div>
  );
}

function PanelHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <h3 style={{ margin: 0, fontSize: 17, color: gold }}>{title}</h3>
      <button type="button" style={{ ...btnGhost, fontSize: 12, padding: "6px 10px" }} onClick={onBack}>
        Back
      </button>
    </div>
  );
}
