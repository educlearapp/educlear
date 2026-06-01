import { useCallback, useEffect, useMemo, useState } from "react";
import { API_URL, apiFetch } from "../api";
import { absolutizeSchoolLogoUrl } from "../utils/schoolLogo";
import "./parentPortal.css";
import {
  buildStatementCoverEmailHtml,
  buildStatementEmailDefaults,
  downloadParentStatementPdf,
  loadStatementSchoolBranding,
  openParentStatementPdfPrint,
  type StatementSchoolBranding,
} from "../billing/statementDocument";
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

const navItems: { key: Panel; label: string; icon: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "🏠" },
  { key: "messages", label: "Messages", icon: "✉️" },
  { key: "homework", label: "Homework", icon: "📝" },
  { key: "notices", label: "Notices", icon: "📌" },
  { key: "documents", label: "Documents", icon: "📎" },
  { key: "statements", label: "Statements", icon: "💳" },
  { key: "incidents", label: "Incidents", icon: "⚠️" },
  { key: "settings", label: "Settings", icon: "⚙️" },
];

const bottomNavItems: { key: Panel; label: string }[] = [
  { key: "dashboard", label: "Home" },
  { key: "messages", label: "Messages" },
  { key: "statements", label: "Billing" },
  { key: "notifications", label: "Alerts" },
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
  const [otpTestCode, setOtpTestCode] = useState<string | null>(null);
  const [loginSuccess, setLoginSuccess] = useState<string | null>(null);
  const [sendOtpLoading, setSendOtpLoading] = useState(false);
  const [verifyOtpLoading, setVerifyOtpLoading] = useState(false);
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
  const [statementBranding, setStatementBranding] = useState<StatementSchoolBranding | null>(null);
  const [statementNotice, setStatementNotice] = useState<string | null>(null);
  const [statementActionBusy, setStatementActionBusy] = useState(false);

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

  useEffect(() => {
    setOtpSent(false);
    setOtpCode("");
    setLoginSuccess(null);
    setError(null);
  }, [schoolId, idNumber, cellNo]);

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
        setSchoolBranding({
          logoUrl: s?.logoUrl ? absolutizeSchoolLogoUrl(String(s.logoUrl)) : null,
          name: s?.name || undefined,
        });
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
    if (shellView !== "app" || panel !== "statements" || !sid) return;
    let cancelled = false;
    void loadStatementSchoolBranding(sid)
      .then((branding) => {
        if (!cancelled) setStatementBranding(branding);
      })
      .catch(() => {
        if (!cancelled) setStatementBranding({ name: schoolName });
      });
    return () => {
      cancelled = true;
    };
  }, [shellView, panel, sid, schoolName]);

  useEffect(() => {
    if (shellView !== "app" || (panel !== "statements" && panel !== "dashboard")) return;
    const anchorId = selectedLearnerId || activeLearner?.id || learners[0]?.learner?.id || "";
    if (!anchorId) return;
    let cancelled = false;
    setStatementNotice(null);
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
      setLoginSuccess(null);
      return;
    }
    setSendOtpLoading(true);
    setError(null);
    setLoginSuccess(null);
    setOtpTestCode(null);
    try {
      const data = await apiFetch("/api/parent-portal/auth/request-otp", {
        method: "POST",
        body: JSON.stringify({ schoolId, idNumber, cellNo: cellNo.trim() }),
      });
      const testOtp = String(data?.testOtp || data?.devOtp || "").trim();
      const delivery = String(data?.delivery || "");
      const smsNotConfigured =
        data?.smsConfigured === false || delivery === "not_configured";

      if (testOtp) {
        setOtpCode(testOtp);
        setOtpTestCode(testOtp);
        setLoginSuccess(null);
      } else if (!smsNotConfigured) {
        setLoginSuccess(String(data?.message || "Verification code requested."));
      } else {
        setLoginSuccess(String(data?.message || "SMS provider not configured yet."));
      }

      setOtpSent(Boolean(data?.success));
    } catch (e: any) {
      setOtpSent(false);
      setOtpTestCode(null);
      setError(e?.message || "OTP request failed");
    } finally {
      setSendOtpLoading(false);
    }
  }

  async function verifyOtp() {
    if (!schoolId || !idNumber) {
      setError("Select your school and enter your ID number.");
      return;
    }
    if (!otpSent) {
      setError("Tap Send OTP to receive a verification code first.");
      return;
    }
    const code = otpCode.trim();
    if (!code) {
      setError("Enter the verification code.");
      return;
    }
    setVerifyOtpLoading(true);
    setError(null);
    try {
      const data = await apiFetch("/api/parent-portal/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ schoolId, idNumber, cellNo: cellNo.trim(), code }),
      });
      setParentSession(data.token, { parent: data.parent, learners: data.learners });
      setSession({ parent: data.parent, learners: data.learners });
      setShellView("app");
      setPanel("dashboard");
      await loadDashboard();
    } catch (e: any) {
      setError(e?.message || "Verification failed");
    } finally {
      setVerifyOtpLoading(false);
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

  const parentAccountLabel = useMemo(() => {
    if (!familyBilling) return "";
    const accountRef = familyBilling.accountRef || "—";
    if (familyBilling.isFamilyAccount) return `Family account ${accountRef}`;
    return (
      `${familyBillingLearners[0]?.firstName || ""} ${familyBillingLearners[0]?.lastName || ""}`.trim() ||
      parentDisplayName
    );
  }, [familyBilling, familyBillingLearners, parentDisplayName]);

  const statementPdfFilename = useMemo(() => {
    const ref = (familyBilling?.accountRef || "statement").replace(/[^\w.-]+/g, "_");
    return `${ref}-statement.pdf`;
  }, [familyBilling?.accountRef]);

  async function handleDownloadStatement() {
    setStatementNotice(null);
    const anchorId = selectedLearnerId || activeLearner?.id || learners[0]?.learner?.id || "";
    const token = getParentToken();
    if (!anchorId) {
      setStatementNotice("Select a learner to download your statement.");
      return;
    }
    try {
      await downloadParentStatementPdf(anchorId, statementPdfFilename, token);
    } catch (e: unknown) {
      setStatementNotice((e as Error).message || "Could not download your statement PDF.");
    }
  }

  async function handlePrintStatement() {
    setStatementNotice(null);
    const anchorId = selectedLearnerId || activeLearner?.id || learners[0]?.learner?.id || "";
    const token = getParentToken();
    if (!anchorId) {
      setStatementNotice("Billing details are still loading. Please try again in a moment.");
      return;
    }
    try {
      const opened = await openParentStatementPdfPrint(anchorId, token);
      if (!opened) {
        setStatementNotice("Please allow pop-ups to print your statement.");
      }
    } catch (e: unknown) {
      setStatementNotice((e as Error).message || "Could not generate your statement PDF.");
    }
  }

  async function handleEmailStatement() {
    setStatementNotice(null);
    const anchorId = selectedLearnerId || activeLearner?.id || learners[0]?.learner?.id || "";
    if (!anchorId) {
      setStatementNotice("Select a learner to email your statement.");
      return;
    }
    const email = String(session?.parent?.email || "").trim();
    if (!email) {
      setStatementNotice("No email on your profile. Contact the school to add your email address.");
      return;
    }
    if (!familyBilling || !parentAccountLabel) {
      setStatementNotice("Billing details are still loading. Please try again in a moment.");
      return;
    }
    const branding = statementBranding || { name: schoolName };
    const accountLabel = parentAccountLabel;
    setStatementActionBusy(true);
    try {
      const defaults = await buildStatementEmailDefaults(sid, branding.name, accountLabel, parentDisplayName);
      const emailHtml = buildStatementCoverEmailHtml({
        school: branding,
        messagePlain: defaults.message,
      });
      await parentApiFetch("/api/parent-portal/billing/email-statement", {
        method: "POST",
        body: JSON.stringify({
          learnerId: anchorId,
          subject: defaults.subject,
          html: emailHtml,
        }),
      });
      setStatementNotice(`Statement emailed to ${email}.`);
    } catch (e: unknown) {
      const err = e as { message?: string };
      const msg = String(err?.message || "Could not send statement email.");
      if (/setup|smtp|email/i.test(msg)) {
        setStatementNotice("The school has not finished email setup yet. Please contact the school office.");
      } else {
        setStatementNotice(msg);
      }
    } finally {
      setStatementActionBusy(false);
    }
  }

  const latestStatement = useMemo(() => {
    const list = (dashboard?.notifications || []) as Notification[];
    return list.find((n) => n.type === "STATEMENT_READY") || null;
  }, [dashboard?.notifications]);

  const homeworkDuePreview = useMemo(() => nextDueHomework(dashboard?.homework || []), [dashboard?.homework]);

  const attendancePreview = useMemo(() => {
    if (!activeLearner) return "Select a learner";
    const parts = [activeLearner.grade, activeLearner.className].filter(Boolean);
    return parts.length ? parts.join(" · ") : "Class details on profile";
  }, [activeLearner]);

  const outstandingBalanceLabel = useMemo(() => {
    if (billingLoading && panel === "dashboard") return "Loading…";
    if (familyBilling) return formatMoney(familyBilling.balance);
    return "—";
  }, [familyBilling, billingLoading, panel]);

  const profileLearner = profileLearnerId ? findLearner(profileLearnerId) : null;

  function switchPanel(next: Panel) {
    setProfileLearnerId(null);
    setIncidentDetail(null);
    setPanel(next);
  }

  if (shellView === "login") {
    return (
      <div className="parent-portal-root parent-portal-root--login">
        <header className="parent-portal-login-header">
          <strong>EduClear Parent Portal</strong>
        </header>
        <main className="parent-portal-login-main">
          <div className="parent-portal-card parent-portal-login-card" style={{ padding: 14 }}>
            <h2>Sign in</h2>
            <p className="parent-portal-muted" style={{ margin: 0 }}>
              Sign in with your ID number and OTP. View invoices, statements, notices, and message your child&apos;s class teacher.
            </p>
            <label className="parent-portal-field-label">School</label>
            <select className="parent-portal-select" value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
              <option value="">Select school</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <label className="parent-portal-field-label">ID number</label>
            <input
              className="parent-portal-input"
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
              autoComplete="off"
              inputMode="numeric"
            />
            <label className="parent-portal-field-label">Mobile (optional if on file at school)</label>
            <input
              className="parent-portal-input"
              value={cellNo}
              onChange={(e) => setCellNo(e.target.value)}
              type="tel"
              autoComplete="tel"
              placeholder="e.g. 0821234567"
            />
            {otpTestCode && (
              <div className="parent-portal-otp-test-notice" role="status">
                <p className="parent-portal-login-success parent-portal-otp-test-label">
                  SMS provider not configured yet.
                </p>
                <p className="parent-portal-login-success">
                  Verification code generated for testing: {otpTestCode}
                </p>
              </div>
            )}
            {loginSuccess && <p className="parent-portal-login-success">{loginSuccess}</p>}
            {error && <p className="parent-portal-login-error">{error}</p>}
            <button
              type="button"
              className="parent-portal-btn-primary parent-portal-full-width mt12"
              onClick={() => void requestOtp()}
              disabled={sendOtpLoading || verifyOtpLoading || !schoolId || !idNumber}
            >
              {sendOtpLoading && <span className="parent-portal-spinner" aria-hidden />}
              {sendOtpLoading ? "Sending…" : "Send OTP"}
            </button>
            <label className="parent-portal-field-label">OTP code</label>
            <input
              className="parent-portal-input"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={otpSent ? "6-digit code" : "Send OTP first"}
              disabled={!otpSent || sendOtpLoading || verifyOtpLoading}
            />
            <button
              type="button"
              className="parent-portal-btn-primary parent-portal-full-width mt12"
              onClick={() => void verifyOtp()}
              disabled={
                !otpSent ||
                sendOtpLoading ||
                verifyOtpLoading ||
                otpCode.trim().length < 6 ||
                !schoolId ||
                !idNumber
              }
            >
              {verifyOtpLoading && <span className="parent-portal-spinner" aria-hidden />}
              {verifyOtpLoading ? "Verifying…" : "Verify & enter"}
            </button>
            {isMobile() && (
              <button
                type="button"
                className="parent-portal-btn-ghost parent-portal-full-width mt12"
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
      <div className="parent-portal-root" style={{ padding: 16 }}>
        <div className="parent-portal-card">
          <h2 className="parent-portal-page-heading" style={{ marginTop: 0 }}>
            <span>Add EduClear</span> to your home screen
          </h2>
          <p className="parent-portal-muted" style={{ fontSize: 14 }}>
            <strong>iPhone (Safari):</strong> Tap Share → Add to Home Screen.
          </p>
          <p className="parent-portal-muted" style={{ fontSize: 14 }}>
            <strong>Android (Chrome):</strong> Menu (⋮) → Install app / Add to Home screen.
          </p>
          <p style={{ fontSize: 14 }}>
            Open:{" "}
            <a href="/parent" className="parent-portal-link">
              {window.location.origin}/parent
            </a>
          </p>
          <button type="button" className="parent-portal-btn-primary" onClick={() => setShellView(getParentToken() ? "app" : "login")}>
            Back
          </button>
        </div>
      </div>
    );
  }

  const panelTitle = navItems.find((n) => n.key === panel)?.label || "Parent Portal";

  return (
    <div className="parent-portal-root">
      <div className="parent-portal-layout">
        <aside className="parent-portal-sidebar" aria-label="Parent Portal navigation">
          <div className="parent-portal-sidebar-logo">
            {schoolBranding.logoUrl ? (
              <img src={schoolBranding.logoUrl} alt="" />
            ) : (
              <span className="parent-portal-notif-type" style={{ fontSize: 11 }}>
                SCH
              </span>
            )}
          </div>
          <p className="parent-portal-sidebar-brand">Parent Portal</p>
          <p className="parent-portal-sidebar-tag">{schoolName}</p>
          <nav className="parent-portal-sidebar-nav">
            {navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={panel === item.key ? "active" : ""}
                onClick={() => switchPanel(item.key)}
              >
                <span className="nav-icon" aria-hidden>
                  {item.icon}
                </span>
                {item.label}
              </button>
            ))}
          </nav>
          <div className="parent-portal-sidebar-footer">
            <button type="button" className="parent-portal-btn-ghost" onClick={logout}>
              Log out
            </button>
          </div>
        </aside>

        <div className="parent-portal-body">
          <header className="parent-portal-app-header">
            <div style={{ minWidth: 0 }}>
              <h1 className="parent-portal-app-header-title">{panelTitle}</h1>
              <p className="parent-portal-app-header-sub">{schoolName}</p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
              <button
                type="button"
                aria-label="Notifications"
                className="parent-portal-btn-ghost parent-portal-btn-ghost--header parent-portal-alerts-btn"
                onClick={() => void openNotificationsPanel()}
                style={{ padding: "8px 12px", borderRadius: 999 }}
              >
                Alerts
                {unreadNotifCount > 0 ? (
                  <span className="parent-portal-badge">{unreadNotifCount > 9 ? "9+" : unreadNotifCount}</span>
                ) : null}
              </button>
              <button
                type="button"
                className="parent-portal-btn-ghost parent-portal-btn-ghost--header"
                style={{ padding: "8px 12px" }}
                onClick={logout}
              >
                Log out
              </button>
            </div>
          </header>

          <main className="parent-portal-main">
        {error && <div className="parent-portal-card parent-portal-card--error" style={{ marginBottom: 10, padding: 10, fontSize: 13 }}>{error}</div>}

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

            <div className="parent-portal-kpi-grid" aria-label="Dashboard summary">
              <SummaryCard
                title="Outstanding Balance"
                value={outstandingBalanceLabel}
                subtitle={familyBilling?.accountRef ? `Ref ${familyBilling.accountRef}` : "Family billing account"}
                onClick={() => switchPanel("statements")}
              />
              <SummaryCard
                title="Upcoming Homework"
                value={homeworkDuePreview?.title?.slice(0, 28) || "None"}
                subtitle={homeworkDuePreview ? homeworkDuePreview.due : "No due dates yet"}
                onClick={() => switchPanel("homework")}
              />
              <SummaryCard
                title="Notifications"
                value={String(unreadNotifCount)}
                subtitle={unreadNotifCount ? "Unread alerts" : "Up to date"}
                onClick={() => void openNotificationsPanel()}
              />
              <SummaryCard
                title="Attendance"
                value={attendancePreview}
                subtitle="Class · contact school for records"
                onClick={() => {
                  if (activeLearner) {
                    setProfileLearnerId(activeLearner.id);
                    switchPanel("profile");
                  }
                }}
              />
            </div>

            <div className="parent-portal-section-label">YOUR CHILDREN</div>
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
          <div className="parent-portal-card">
            <PanelHeader title="Notifications" onBack={() => setPanel("dashboard")} />
            <p className="parent-portal-muted" style={{ fontSize: 12, marginTop: 0 }}>
              Invoice ready, teacher replies, incidents, homework, and notices appear here.
            </p>
            {notifications.length === 0 && <p className="parent-portal-muted">No notifications yet.</p>}
            {notifications.map((n) => (
              <div
                key={n.id}
                className="parent-portal-list-divider"
                style={{ opacity: n.isRead ? 0.72 : 1 }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <div>
                    <div className="parent-portal-notif-type">{notificationCategoryLabel(n.type)}</div>
                    <strong style={{ fontSize: 14 }}>{n.title}</strong>
                  </div>
                  <span className="parent-portal-muted" style={{ fontSize: 10, whiteSpace: "nowrap" }}>{new Date(n.createdAt).toLocaleDateString()}</span>
                </div>
                <p className="parent-portal-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>{n.message}</p>
                {!n.isRead ? (
                  <button type="button" className="parent-portal-btn-ghost parent-portal-btn-ghost--gold-text" style={{ marginTop: 8, fontSize: 12, padding: "6px 10px" }} onClick={() => void markNotificationRead(n.id)}>
                    Mark read
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {panel === "messages" && (
          <div className="parent-portal-card">
            <PanelHeader title="Messages" onBack={() => setPanel("dashboard")} />
            <LearnerSwitchStrip learners={learners} selectedId={selectedLearnerId} onSelect={setSelectedLearnerId} />
            {activeLearner ? (
              <p className="parent-portal-muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
                {activeLearner.firstName} {activeLearner.lastName} · {activeLearner.grade}{" "}
                {activeLearner.className ? `· ${activeLearner.className}` : ""}
              </p>
            ) : null}
            <h3 className="parent-portal-page-heading" style={{ margin: "0 0 8px", fontSize: 16 }}>
              <span>Class teacher:</span> {teacherInfo?.name || "Assigned teacher"}
            </h3>
            <div style={{ maxHeight: 340, overflowY: "auto", margin: "8px 0", display: "flex", flexDirection: "column", gap: 6 }}>
              {threadMessages.map((m) => (
                <div
                  key={m.id}
                  className={`parent-portal-msg-bubble ${m.sender === "PARENT" ? "parent-portal-msg-bubble--parent" : "parent-portal-msg-bubble--other"}`}
                >
                  <div className="parent-portal-notif-type" style={{ fontSize: 10 }}>{m.senderName || m.sender}</div>
                  <div style={{ fontSize: 14, lineHeight: 1.45 }}>{m.body}</div>
                </div>
              ))}
            </div>
            <textarea
              className="parent-portal-textarea"
              value={messageDraft}
              onChange={(e) => setMessageDraft(e.target.value)}
              rows={3}
            />
            <button type="button" className="parent-portal-btn-primary parent-portal-full-width" onClick={() => void sendMessage()} disabled={loading}>
              Send
            </button>
            <p className="parent-portal-muted" style={{ fontSize: 11, marginTop: 8 }}>
              Messages go to your child&apos;s class teacher for this learner. Switch learner from the dashboard if you have more than one child.
            </p>
          </div>
        )}

        {panel === "homework" && (
          <div className="parent-portal-card">
            <PanelHeader title="Homework" onBack={() => setPanel("dashboard")} />
            <LearnerSwitchStrip learners={learners} selectedId={selectedLearnerId} onSelect={setSelectedLearnerId} />
            {(!dashboard?.homework || dashboard.homework.length === 0) && <p className="parent-portal-muted">No homework posted yet.</p>}
            {(dashboard?.homework || []).map((h: any) => (
              <div key={h.id} className="parent-portal-list-divider">
                <strong style={{ fontSize: 14 }}>{h.title}</strong>
                {h.dueDate ? (
                  <div className="parent-portal-notif-type" style={{ fontSize: 12, marginTop: 4 }}>Due {new Date(h.dueDate).toLocaleDateString()}</div>
                ) : (
                  <div className="parent-portal-muted" style={{ fontSize: 12, marginTop: 4 }}>No due date</div>
                )}
              </div>
            ))}
          </div>
        )}

        {panel === "notices" && (
          <div className="parent-portal-card">
            <PanelHeader title="Notices" onBack={() => setPanel("dashboard")} />
            <LearnerSwitchStrip learners={learners} selectedId={selectedLearnerId} onSelect={setSelectedLearnerId} />
            {(!dashboard?.notices || dashboard.notices.length === 0) && <p className="parent-portal-muted">No notices yet.</p>}
            {(dashboard?.notices || []).map((n: any) => (
              <div key={n.id} className="parent-portal-list-divider">
                <strong style={{ fontSize: 14 }}>{n.title}</strong>
                <div className="parent-portal-muted" style={{ fontSize: 13, marginTop: 4 }}>{String(n.body || "").slice(0, 220)}</div>
              </div>
            ))}
          </div>
        )}

        {panel === "documents" && (
          <div className="parent-portal-card">
            <PanelHeader title="Documents" onBack={() => setPanel("dashboard")} />
            <LearnerSwitchStrip learners={learners} selectedId={selectedLearnerId} onSelect={setSelectedLearnerId} />
            {(!dashboard?.documents || dashboard.documents.length === 0) && <p className="parent-portal-muted">No documents yet.</p>}
            {(dashboard?.documents || []).map((d: any) => (
              <div key={d.id} className="parent-portal-list-divider">
                <a href={documentHref(d.fileUrl)} target="_blank" rel="noreferrer" className="parent-portal-link">
                  {d.title}
                </a>
                {d.description ? <div className="parent-portal-muted" style={{ fontSize: 12, marginTop: 4 }}>{d.description}</div> : null}
              </div>
            ))}
          </div>
        )}

        {panel === "statements" && (
          <div className="parent-portal-card">
            <PanelHeader title="Statements & invoices" onBack={() => setPanel("dashboard")} />
            <p className="parent-portal-muted" style={{ fontSize: 13, marginTop: 0 }}>
              View and download your school billing files. A credit or negative amount on a statement usually means your account is in credit — not
              necessarily an error.
            </p>
            {familyBillingLearners.length > 1 ? (
              <div className="parent-portal-highlight-box">
                <div className="parent-portal-notif-type" style={{ marginBottom: 6 }}>
                  Billing account{" "}
                  {familyBillingLearners[0]?.familyAccount?.accountRef || "shared"}
                </div>
                <div style={{ fontWeight: 800, marginBottom: 4 }}>Children on this account</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
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
              <div className="parent-portal-highlight-box" style={{ fontSize: 13 }}>
                <div className="parent-portal-notif-type" style={{ marginBottom: 4 }}>Latest invoice notice</div>
                {dashboard.latestInvoiceNotification.message}
              </div>
            )}
            {latestStatement && (
              <div className="parent-portal-highlight-box parent-portal-highlight-box--slate" style={{ fontSize: 13 }}>
                <div className="parent-portal-muted" style={{ fontSize: 11, fontWeight: 800, marginBottom: 4 }}>Latest statement notice</div>
                <strong>{latestStatement.title}</strong>
                <div className="parent-portal-muted" style={{ marginTop: 4 }}>{latestStatement.message}</div>
              </div>
            )}
            {billingLoading ? (
              <p className="parent-portal-muted" style={{ fontSize: 13 }}>Loading billing…</p>
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
                    <div className="parent-portal-notif-type">Account balance</div>
                    <div
                      className={`parent-portal-billing-balance${
                        familyBilling.balance > 0
                          ? " parent-portal-billing-balance--due"
                          : " parent-portal-billing-balance--credit"
                      }`}
                    >
                      {formatMoney(familyBilling.balance)}
                    </div>
                  </div>
                  {familyBilling.accountRef ? (
                    <div className="parent-portal-muted" style={{ fontSize: 12, fontWeight: 700 }}>Ref {familyBilling.accountRef}</div>
                  ) : null}
                </div>
                {familyBilling.transactions.length === 0 ? (
                  <p className="parent-portal-muted" style={{ fontSize: 13, margin: 0 }}>No transactions on this account yet.</p>
                ) : (
                  <div className="parent-portal-table-wrap">
                    <table className="parent-portal-table parent-portal-table--statement">
                      <thead>
                        <tr>
                          {(familyBilling.isFamilyAccount
                            ? ["Date", "Type", "Learner", "Description", "In", "Out", "Balance"]
                            : ["Date", "Type", "Description", "In", "Out", "Balance"]
                          ).map((h) => (
                            <th key={h} className={h === "In" || h === "Out" || h === "Balance" ? "num" : undefined}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {familyBilling.transactions.map((row) => (
                          <tr key={row.id}>
                            <td data-label="Date">{row.date || "—"}</td>
                            <td data-label="Type">{row.type}</td>
                            {familyBilling.isFamilyAccount ? (
                              <td data-label="Learner">{row.learner || "—"}</td>
                            ) : null}
                            <td data-label="Description">{row.description || row.reference || "—"}</td>
                            <td className="num" data-label="In">
                              {row.amountIn ? formatMoney(row.amountIn) : "—"}
                            </td>
                            <td className="num" data-label="Out">
                              {row.amountOut ? formatMoney(row.amountOut) : "—"}
                            </td>
                            <td className="num" data-label="Balance" style={{ fontWeight: 800 }}>
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
            {familyBilling && !billingLoading ? (
              <div className="parent-portal-statement-actions">
                <button
                  type="button"
                  className="parent-portal-btn-primary parent-portal-statement-btn"
                  disabled={statementActionBusy}
                  onClick={handleDownloadStatement}
                >
                  Download Statement PDF
                </button>
                <button
                  type="button"
                  className="parent-portal-btn-ghost parent-portal-statement-btn parent-portal-btn-ghost--gold-text"
                  disabled={statementActionBusy}
                  onClick={handlePrintStatement}
                >
                  Print Statement
                </button>
                <button
                  type="button"
                  className="parent-portal-btn-ghost parent-portal-statement-btn parent-portal-btn-ghost--gold-text"
                  disabled={statementActionBusy}
                  onClick={() => void handleEmailStatement()}
                >
                  {statementActionBusy ? "Sending…" : "Email Statement"}
                </button>
                {statementNotice ? (
                  <p className="parent-portal-muted" style={{ fontSize: 13, margin: 0 }}>
                    {statementNotice}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        {panel === "incidents" && (
          <div className="parent-portal-card">
            <PanelHeader title="Incidents" onBack={() => setPanel("dashboard")} />
            <LearnerSwitchStrip learners={learners} selectedId={selectedLearnerId} onSelect={setSelectedLearnerId} />
            {incidentLoading && <p className="parent-portal-muted" style={{ fontSize: 13 }}>Loading…</p>}
            {(!dashboard?.incidents || dashboard.incidents.length === 0) && !incidentLoading && (
              <p className="parent-portal-muted">No incidents to show.</p>
            )}
            {(dashboard?.incidents || []).map((inc: any) => (
              <button key={inc.id} type="button" className="parent-portal-incident-btn" onClick={() => void openIncident(inc.id)}>
                <strong style={{ fontSize: 14 }}>{inc.subject}</strong>
                <div className="parent-portal-muted" style={{ fontSize: 12, marginTop: 4 }}>{String(inc.summary || "").slice(0, 160)}</div>
              </button>
            ))}
            {incidentDetail && (
              <div className="parent-portal-incident-detail">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <strong className="parent-portal-notif-type" style={{ fontSize: 14 }}>{incidentDetail.subject}</strong>
                  <button type="button" className="parent-portal-btn-ghost parent-portal-btn-ghost--gold-text" style={{ fontSize: 11, padding: "4px 8px" }} onClick={() => setIncidentDetail(null)}>
                    Close
                  </button>
                </div>
                <div className="parent-portal-muted" style={{ fontSize: 12, marginTop: 4 }}>{formatShortDate(incidentDetail.incidentDate)}</div>
                <p style={{ fontSize: 14, lineHeight: 1.5, marginTop: 8 }}>{incidentDetail.summary}</p>
              </div>
            )}
          </div>
        )}

        {panel === "settings" && (
          <div className="parent-portal-card">
            <PanelHeader title="Settings" onBack={() => setPanel("dashboard")} />
            <p className="parent-portal-muted" style={{ fontSize: 13 }}>Keep things simple: use the dashboard for day-to-day updates.</p>
            {isMobile() && (
              <button type="button" className="parent-portal-btn-primary parent-portal-full-width" onClick={() => setShellView("pwa")}>
                Install app instructions
              </button>
            )}
            <button type="button" className="parent-portal-btn-ghost parent-portal-full-width" onClick={logout}>
              Sign out
            </button>
          </div>
        )}

        {panel === "profile" && !profileLearner && (
          <div className="parent-portal-card">
            <PanelHeader title="Learner profile" onBack={() => setPanel("dashboard")} />
            <p className="parent-portal-muted">Choose a learner from the dashboard.</p>
          </div>
        )}

        {panel === "profile" && profileLearner && (
          <div className="parent-portal-card">
            <PanelHeader title="Learner profile" onBack={() => setPanel("dashboard")} />
            <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 4 }}>
              {profileLearner.firstName} {profileLearner.lastName}
            </div>
            <div className="parent-portal-muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
              <div>
                <span className="parent-portal-notif-type" style={{ fontSize: 13 }}>Grade / class:</span> {profileLearner.grade}
                {profileLearner.className ? ` · ${profileLearner.className}` : ""}
              </div>
              {profileLearner.admissionNo ? (
                <div>
                  <span className="parent-portal-notif-type" style={{ fontSize: 13 }}>Admission no.:</span> {profileLearner.admissionNo}
                </div>
              ) : null}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
              <button type="button" className="parent-portal-btn-primary" style={{ width: "100%" }} onClick={() => void openMessages(profileLearner.id)}>
                Message teacher
              </button>
              <button
                type="button"
                className="parent-portal-btn-ghost parent-portal-btn-ghost--gold-text"
                style={{ width: "100%" }}
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
          <p className="parent-portal-muted" style={{ textAlign: "center", fontSize: 13, marginTop: 8 }}>Loading…</p>
        )}
          </main>

          <nav className="parent-portal-bottom-nav" aria-label="Parent navigation">
            {bottomNavItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={panel === item.key ? "active" : ""}
                onClick={() => {
                  if (item.key === "notifications") {
                    void openNotificationsPanel();
                  } else {
                    switchPanel(item.key);
                  }
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </div>
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
    <div className="parent-portal-card parent-portal-welcome">
      <div className="parent-portal-welcome-logo">
        {logoUrl ? (
          <img src={logoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <span className="parent-portal-notif-type" style={{ fontSize: 11 }}>SCH</span>
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="parent-portal-muted" style={{ fontSize: 11, fontWeight: 700 }}>Welcome back</div>
        <div className="parent-portal-welcome-name">{parentName}</div>
        <div className="parent-portal-muted" style={{ fontSize: 12, marginTop: 2, fontWeight: 600 }}>{schoolName}</div>
        <div className="parent-portal-muted" style={{ fontSize: 11, marginTop: 4 }}>
          {learnerCount} learner{learnerCount === 1 ? "" : "s"}
          {lastVisit ? ` · Last visit: ${lastVisit}` : ""}
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenNotifications}
        className="parent-portal-btn-ghost parent-portal-btn-ghost--gold-text parent-portal-alerts-btn"
        style={{ width: 40, height: 40, borderRadius: 999, padding: 0 }}
        aria-label="Open notifications"
      >
        <span style={{ fontSize: 10, fontWeight: 900 }}>Alerts</span>
        {unreadCount > 0 ? <span className="parent-portal-badge">{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
      </button>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  subtitle,
  onClick,
}: {
  title: string;
  value: string;
  subtitle: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className="parent-portal-summary-card">
      <div className="parent-portal-summary-card-title">{title}</div>
      <div className="parent-portal-summary-card-value">{value}</div>
      <div className="parent-portal-summary-card-sub">{subtitle}</div>
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
  const chipClass =
    billingHint.tone === "gold" ? "parent-portal-chip parent-portal-chip--gold" : "parent-portal-chip parent-portal-chip--slate";

  return (
    <div className={`parent-portal-card parent-portal-learner-card${selected ? " selected" : ""}`}>
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
          color: "#1d2736",
          textAlign: "left",
        }}
      >
        <div>
          <div style={{ fontSize: 17, fontWeight: 900 }}>
            {learner.firstName} {learner.lastName}
          </div>
          <div className="parent-portal-muted" style={{ fontSize: 12, marginTop: 2, fontWeight: 600 }}>
            {learner.grade}
            {learner.className ? ` · ${learner.className}` : ""}
            {relation ? ` · ${relation}` : ""}
          </div>
        </div>
        {selected ? (
          <span style={{ fontSize: 10, fontWeight: 900, color: "#0f0f0f", background: gold, padding: "3px 8px", borderRadius: 999 }}>SELECTED</span>
        ) : (
          <span className="parent-portal-muted" style={{ fontSize: 10, fontWeight: 800 }}>Tap to select</span>
        )}
      </button>
      <div className={chipClass}>{billingHint.label}</div>
      <div className="parent-portal-learner-actions">
        <button type="button" className="parent-portal-btn-ghost parent-portal-btn-ghost--gold-text" style={{ fontSize: 12, padding: "8px 6px" }} onClick={onProfile}>
          View profile
        </button>
        <button type="button" className="parent-portal-btn-primary" style={{ fontSize: 12, padding: "8px 6px" }} onClick={onMessage}>
          Message teacher
        </button>
        <button type="button" className="parent-portal-btn-ghost parent-portal-btn-ghost--gold-text" style={{ fontSize: 12, padding: "8px 6px" }} onClick={onHomework}>
          Homework
        </button>
        <button type="button" className="parent-portal-btn-ghost parent-portal-btn-ghost--gold-text" style={{ fontSize: 12, padding: "8px 6px" }} onClick={onNotices}>
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
    <div className="parent-portal-learner-switch">
      {learners.map((row) => (
        <button
          key={row.learner.id}
          type="button"
          className={`parent-portal-learner-switch-btn${selectedId === row.learner.id ? " active" : ""}`}
          onClick={() => onSelect(row.learner.id)}
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
      <h3 className="parent-portal-page-heading" style={{ fontSize: 17 }}>
        <span>{title}</span>
      </h3>
      <button type="button" className="parent-portal-btn-ghost parent-portal-btn-ghost--gold-text" style={{ fontSize: 12, padding: "6px 10px" }} onClick={onBack}>
        Back
      </button>
    </div>
  );
}
