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
  buildStatementPdfFilename,
  normalizeStatementPeriod,
} from "../billing/statementPeriod";
import StatementPeriodModal, {
  persistStatementExportPeriod,
  readRememberedStatementExportPeriod,
} from "../billing/StatementPeriodModal";
import { consumeInactivityLogoutMessage } from "../auth/sessionLogout";
import {
  clearParentSession,
  getParentSession,
  getParentToken,
  parentApiFetch,
  setParentSession,
} from "./parentApi";
import ParentFinanceHub from "./ParentFinanceHub";
import ParentEventsPanel from "./ParentEventsPanel";
import ParentPushSettings from "./ParentPushSettings";
import ParentAttachmentList from "./ParentAttachmentList";
import { downloadAuthenticatedBlob } from "../utils/authenticatedBlobDownload";
import { usePortalPwaHead } from "../pwa/usePortalPwaHead";
import { parentPortalPwaHead } from "../pwa/pwaIconConfig";
import { useParentNotificationLive } from "./useParentNotificationLive";
import { clearParentAppBadge } from "./parentAppBadge";
import { fetchBillingSettings } from "../billingSettings/billingSettingsApi";
import type { FinancePolicySettings } from "../finance/financePolicy";
import {
  formatOutstandingBalanceLabel,
  normalizeLinkedLearners,
  parseBillingBalance,
  resolveFamilyBillingLearnerIds,
  resolveSelectedLearnerId,
  type ParentPortalLearner as Learner,
  type ParentPortalLinkRow as LinkRow,
} from "./parentPortalLearners";
import { formatParentMessageDateTime } from "./parentMessageTime";
import { PortalIcon } from "./ParentPortalIcons";

const LAST_VISIT_KEY = "parentPortalLastVisitAt";

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
  attachments?: { name?: string; downloadPath?: string | null; url?: string | null }[];
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
  chargeLines?: Array<{ lineKey: string; description: string; amount: number }>;
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
  | "events"
  | "documents"
  | "statements"
  | "incidents"
  | "settings"
  | "notifications"
  | "profile";

const navItems: { key: Panel; label: string; tile: string }[] = [
  { key: "dashboard", label: "Dashboard", tile: "home" },
  { key: "messages", label: "Messages", tile: "messages" },
  { key: "homework", label: "Homework", tile: "homework" },
  { key: "notices", label: "Notices", tile: "notices" },
  { key: "events", label: "Events", tile: "events" },
  { key: "documents", label: "Documents", tile: "documents" },
  { key: "statements", label: "Finance Hub", tile: "finance" },
  { key: "incidents", label: "Incidents", tile: "incidents" },
  { key: "settings", label: "Settings", tile: "settings" },
];

const bottomNavItems: { key: Panel; label: string; tile: string }[] = [
  { key: "dashboard", label: "Home", tile: "home" },
  { key: "messages", label: "Messages", tile: "messages" },
  { key: "statements", label: "Finance", tile: "finance" },
  { key: "notifications", label: "Alerts", tile: "alerts" },
];

/** Dashboard shortcut tiles — only implemented parent-portal surfaces. */
const dashboardTiles: { key: Panel; label: string; tile: string; hint: string }[] = [
  { key: "statements", label: "Finance", tile: "finance", hint: "Balance & statements" },
  { key: "messages", label: "Messages", tile: "messages", hint: "Teacher chat" },
  { key: "homework", label: "Homework", tile: "homework", hint: "Assignments" },
  { key: "notices", label: "Notices", tile: "notices", hint: "School updates" },
  { key: "events", label: "Events", tile: "events", hint: "School calendar" },
  { key: "documents", label: "Documents", tile: "documents", hint: "Files to download" },
  { key: "incidents", label: "Incidents", tile: "incidents", hint: "Behaviour notes" },
  { key: "notifications", label: "Alerts", tile: "alerts", hint: "Notifications" },
  { key: "settings", label: "Settings", tile: "settings", hint: "App & sign out" },
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
    case "SCHOOL_EVENT":
      return "Event added";
    case "DOCUMENT":
      return "Document";
    case "ONBOARDING":
      return "Welcome";
    default:
      return type.replace(/_/g, " ").toLowerCase();
  }
}

async function downloadParentDocument(doc: {
  id?: string;
  title?: string;
  downloadPath?: string | null;
  fileName?: string;
}) {
  const path =
    String(doc.downloadPath || "").trim() ||
    (doc.id ? `/api/parent-portal/documents/${encodeURIComponent(doc.id)}/file` : "");
  await downloadAuthenticatedBlob(path, doc.fileName || doc.title || "document", {
    mode: "parent",
    token: getParentToken(),
    apiBase: API_URL,
  });
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
  if (!first) return list[0] ? { title: list[0].title, due: "Due date not set" } : null;
  return { title: first.h.title, due: `Due ${new Date(first.h.dueDate).toLocaleDateString()}` };
}

function homeworkDueLabel(dueDate: unknown): string {
  if (!dueDate) return "Due date not set";
  const t = new Date(String(dueDate)).getTime();
  if (Number.isNaN(t)) return "Due date not set";
  return `Due ${new Date(t).toLocaleDateString()}`;
}

type ParentExportAction = "print" | "download" | "email";

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
  const [contentList, setContentList] = useState<any[]>([]);
  const [contentListLoading, setContentListLoading] = useState(false);
  const [contentListHasMore, setContentListHasMore] = useState(false);
  const [lastVisitShown, setLastVisitShown] = useState<string | null>(null);
  const [familyBilling, setFamilyBilling] = useState<ParentBillingSnapshot | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [statementBranding, setStatementBranding] = useState<StatementSchoolBranding | null>(null);
  const [statementNotice, setStatementNotice] = useState<string | null>(null);
  const [statementActionBusy, setStatementActionBusy] = useState(false);
  const [statementExportModal, setStatementExportModal] = useState<ParentExportAction | null>(null);
  const [statementExportPeriod, setStatementExportPeriod] = useState(readRememberedStatementExportPeriod);
  const [inactivityNotice, setInactivityNotice] = useState<string | null>(null);
  const [financePolicy, setFinancePolicy] = useState<FinancePolicySettings | null>(null);

  const learners: LinkRow[] = useMemo(
    () =>
      normalizeLinkedLearners(
        session?.learners as any[] | undefined,
        dashboard?.learners as any[] | undefined
      ),
    [session, dashboard]
  );

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
    const schoolId = String(session?.parent?.school?.id || "").trim();
    return resolveFamilyBillingLearnerIds(learners, anchorId, {
      expectedSchoolId: schoolId || null,
    }).learners;
  }, [learners, selectedLearnerId, activeLearner?.id, session?.parent?.school?.id]);

  const schoolName =
    schoolBranding?.name || session?.parent?.school?.name || dashboard?.activeLearner?.school?.name || "Your school";

  const parentDisplayName = session?.parent
    ? `${session.parent.firstName} ${session.parent.surname}`.trim()
    : "Parent";

  const sid = session?.parent?.school?.id || "";
  const parentId = session?.parent?.id || "";

  usePortalPwaHead(parentPortalPwaHead);

  const liveNotifs = useParentNotificationLive({
    enabled: shellView === "app" && Boolean(getParentToken()) && Boolean(sid) && Boolean(parentId),
    schoolId: sid,
    parentId,
  });

  const dashboardUnread = useMemo(() => {
    const list = (dashboard?.notifications || []) as Notification[];
    return list.filter((n) => !n.isRead).length;
  }, [dashboard?.notifications]);

  const unreadNotifCount = liveNotifs.ready ? liveNotifs.unreadCount : dashboardUnread;

  useEffect(() => {
    void apiFetch("/api/public/schools", { skipAuth: true })
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

  useEffect(() => {
    if (!sid) return;
    void apiFetch(`/api/public/schools/${encodeURIComponent(sid)}`, { skipAuth: true })
      .then((s: any) => {
        setSchoolBranding({
          logoUrl: s?.logoUrl ? absolutizeSchoolLogoUrl(String(s.logoUrl)) : null,
          name: s?.name || undefined,
        });
      })
      .catch(() => {});
  }, [sid]);

  useEffect(() => {
    if (!sid) return;
    let cancelled = false;
    void fetchBillingSettings(sid)
      .then((settings) => {
        if (!cancelled) setFinancePolicy(settings.financePolicy || null);
      })
      .catch(() => {
        if (!cancelled) setFinancePolicy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sid]);

  useEffect(() => {
    const inactivityMessage = consumeInactivityLogoutMessage();
    if (inactivityMessage) {
      clearParentSession();
      setSession(null);
      setDashboard(null);
      setSelectedLearnerId("");
      setShellView("login");
      setInactivityNotice(inactivityMessage);
    }
  }, []);

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
        const balance = parseBillingBalance(data?.balance);
        if (balance === null) {
          // Failed/invalid balance must not render as R0.00
          setFamilyBilling(null);
          return;
        }
        setFamilyBilling({
          balance,
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

  // Bounded list endpoints for homework / notices / documents / incidents (beyond dashboard preview).
  useEffect(() => {
    const listPanels = ["homework", "notices", "documents", "incidents"] as const;
    if (shellView !== "app" || !listPanels.includes(panel as (typeof listPanels)[number])) {
      return;
    }
    let cancelled = false;
    setContentListLoading(true);
    const qs = new URLSearchParams({ limit: "50", offset: "0" });
    const effectiveLearnerId =
      selectedLearnerId || activeLearner?.id || learners[0]?.learner?.id || "";
    if (effectiveLearnerId) qs.set("learnerId", effectiveLearnerId);
    const path =
      panel === "homework"
        ? `/api/parent-portal/homework?${qs}`
        : panel === "notices"
          ? `/api/parent-portal/notices?${qs}`
          : panel === "documents"
            ? `/api/parent-portal/documents?${qs}`
            : `/api/parent-portal/incidents?${qs}`;
    void parentApiFetch(path)
      .then((data) => {
        if (cancelled) return;
        const key =
          panel === "homework"
            ? "homework"
            : panel === "notices"
              ? "notices"
              : panel === "documents"
                ? "documents"
                : "incidents";
        setContentList(Array.isArray(data?.[key]) ? data[key] : []);
        setContentListHasMore(Boolean(data?.hasMore));
      })
      .catch(() => {
        if (!cancelled) {
          setContentList([]);
          setContentListHasMore(false);
        }
      })
      .finally(() => {
        if (!cancelled) setContentListLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shellView, panel, selectedLearnerId, activeLearner?.id, learners]);

  async function loadDashboard() {
    setLoading(true);
    setError(null);
    try {
      const qs = selectedLearnerId ? `?learnerId=${encodeURIComponent(selectedLearnerId)}` : "";
      const data = await parentApiFetch(`/api/parent-portal/dashboard${qs}`);
      setDashboard(data);
      const me = await parentApiFetch("/api/parent-portal/me");
      setSession({ parent: me.parent, learners: me.learners });
      const linked = normalizeLinkedLearners(me.learners, data?.learners);
      setSelectedLearnerId((current) =>
        resolveSelectedLearnerId(current, linked, data?.autoSelectLearner?.id || null)
      );
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
        skipAuth: true,
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
        skipAuth: true,
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
      await liveNotifs.syncAfterMarkRead();
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
    liveNotifs.clearOnLogout();
    void clearParentAppBadge();
    clearParentSession();
    setShellView("login");
    setDashboard(null);
    setSession(null);
    setSelectedLearnerId("");
    setPanel("dashboard");
  }

  // Deep-link / SW: open Alerts panel (?panel=alerts or service-worker message).
  useEffect(() => {
    if (shellView !== "app") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("panel") === "alerts") {
      void openNotificationsPanel();
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete("panel");
        window.history.replaceState({}, "", url.pathname + url.search + url.hash);
      } catch {
        /* ignore */
      }
    }
    const onMsg = (event: MessageEvent) => {
      if (event.data?.type === "educlear-parent-open-alerts" || event.data?.type === "educlear-parent-push") {
        if (event.data?.type === "educlear-parent-open-alerts") void openNotificationsPanel();
        else void liveNotifs.pollNow();
      }
    };
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", onMsg);
      return () => navigator.serviceWorker.removeEventListener("message", onMsg);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shellView]);

  const parentAccountLabel = useMemo(() => {
    if (!familyBilling) return "";
    const accountRef = familyBilling.accountRef || "—";
    if (familyBilling.isFamilyAccount) return `Family account ${accountRef}`;
    return (
      `${familyBillingLearners[0]?.firstName || ""} ${familyBillingLearners[0]?.lastName || ""}`.trim() ||
      parentDisplayName
    );
  }, [familyBilling, familyBillingLearners, parentDisplayName]);

  const parentFinanceLearnerLabel = useMemo(() => {
    const names = familyBillingLearners
      .map((learner) => `${learner.firstName || ""} ${learner.lastName || ""}`.trim())
      .filter(Boolean);
    if (names.length > 1) return names.join(", ");
    return names[0] || activeLearner?.firstName || "your child";
  }, [activeLearner?.firstName, familyBillingLearners]);

  const parentExportPeriodActionLabel = (action: ParentExportAction) => {
    if (action === "print") return "Print Statement";
    if (action === "download") return "Download PDF";
    return "Email Statement";
  };

  const openStatementExportModal = (action: ParentExportAction) => {
    if (statementActionBusy) return;
    setStatementExportPeriod(readRememberedStatementExportPeriod());
    setStatementExportModal(action);
  };

  const closeStatementExportModal = () => {
    if (statementActionBusy) return;
    setStatementExportModal(null);
  };

  async function runParentDownloadStatement(selectedPeriod: string) {
    const anchorId = selectedLearnerId || activeLearner?.id || learners[0]?.learner?.id || "";
    const token = getParentToken();
    if (!anchorId) {
      setStatementNotice("Select a learner to download your statement.");
      return;
    }
    const filename = buildStatementPdfFilename(familyBilling?.accountRef || "statement", selectedPeriod);
    setStatementActionBusy(true);
    try {
      await downloadParentStatementPdf(anchorId, filename, token, selectedPeriod);
    } catch (e: unknown) {
      setStatementNotice((e as Error).message || "Could not download your statement PDF.");
    } finally {
      setStatementActionBusy(false);
    }
  }

  async function runParentPrintStatement(selectedPeriod: string) {
    const anchorId = selectedLearnerId || activeLearner?.id || learners[0]?.learner?.id || "";
    const token = getParentToken();
    if (!anchorId) {
      setStatementNotice("Billing details are still loading. Please try again in a moment.");
      return;
    }
    setStatementActionBusy(true);
    try {
      const opened = await openParentStatementPdfPrint(anchorId, token, selectedPeriod);
      if (!opened) {
        setStatementNotice("Please allow pop-ups to print your statement.");
      }
    } catch (e: unknown) {
      setStatementNotice((e as Error).message || "Could not generate your statement PDF.");
    } finally {
      setStatementActionBusy(false);
    }
  }

  async function runParentEmailStatement(selectedPeriod: string) {
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
          period: normalizeStatementPeriod(selectedPeriod),
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

  async function confirmStatementExportPeriod() {
    if (statementActionBusy || !statementExportModal) return;
    const selectedPeriod = normalizeStatementPeriod(statementExportPeriod);
    persistStatementExportPeriod(selectedPeriod);
    const action = statementExportModal;
    setStatementExportModal(null);
    setStatementNotice(null);

    if (action === "download") {
      await runParentDownloadStatement(selectedPeriod);
    } else if (action === "print") {
      await runParentPrintStatement(selectedPeriod);
    } else {
      await runParentEmailStatement(selectedPeriod);
    }
  }

  function handleDownloadStatement() {
    if (statementActionBusy) return;
    setStatementNotice(null);
    const anchorId = selectedLearnerId || activeLearner?.id || learners[0]?.learner?.id || "";
    if (!anchorId) {
      setStatementNotice("Select a learner to download your statement.");
      return;
    }
    openStatementExportModal("download");
  }

  function handlePrintStatement() {
    if (statementActionBusy) return;
    setStatementNotice(null);
    const anchorId = selectedLearnerId || activeLearner?.id || learners[0]?.learner?.id || "";
    if (!anchorId) {
      setStatementNotice("Billing details are still loading. Please try again in a moment.");
      return;
    }
    openStatementExportModal("print");
  }

  function handleEmailStatement() {
    if (statementActionBusy) return;
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
    openStatementExportModal("email");
  }

  const latestStatement = useMemo(() => {
    const list = (dashboard?.notifications || []) as Notification[];
    return list.find((n) => n.type === "STATEMENT_READY") || null;
  }, [dashboard?.notifications]);

  const homeworkDuePreview = useMemo(() => nextDueHomework(dashboard?.homework || []), [dashboard?.homework]);

  const outstandingBalanceLabel = useMemo(
    () => formatOutstandingBalanceLabel(familyBilling, billingLoading),
    [familyBilling, billingLoading]
  );

  const noticePreview = useMemo(() => {
    const list = Array.isArray(dashboard?.notices) ? dashboard.notices : [];
    return list.slice(0, 3);
  }, [dashboard?.notices]);

  const latestUpdates = useMemo(() => {
    type UpdateRow = {
      id: string;
      kind: string;
      tile: string;
      title: string;
      meta: string;
      panel: Panel;
    };
    const rows: UpdateRow[] = [];
    if (homeworkDuePreview) {
      rows.push({
        id: `hw-${homeworkDuePreview.title}`,
        kind: "Homework",
        tile: "homework",
        title: homeworkDuePreview.title,
        meta: homeworkDuePreview.due,
        panel: "homework",
      });
    }
    for (const n of noticePreview) {
      rows.push({
        id: `notice-${String(n.id || n.title)}`,
        kind: "Notice",
        tile: "notices",
        title: String(n.title || "Notice"),
        meta: String(n.body || "").slice(0, 90) || "Open notices",
        panel: "notices",
      });
    }
    const events = Array.isArray(dashboard?.upcomingEvents) ? dashboard.upcomingEvents.slice(0, 3) : [];
    for (const ev of events) {
      const cancelled = String(ev.lifecycleStatus || "").toUpperCase() === "CANCELLED";
      rows.push({
        id: `event-${String(ev.id || ev.title)}`,
        kind: cancelled ? "Cancelled" : "Event",
        tile: "events",
        title: String(ev.title || "Event"),
        meta: ev.startsAt
          ? new Date(ev.startsAt).toLocaleString(undefined, {
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "Open events",
        panel: "events",
      });
    }
    return rows.slice(0, 4);
  }, [homeworkDuePreview, noticePreview, dashboard?.upcomingEvents]);

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
            {inactivityNotice && (
              <p className="parent-portal-login-error" role="status">
                {inactivityNotice}
              </p>
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
              <img src={schoolBranding.logoUrl} alt={`${schoolName} logo`} />
            ) : (
              <span className="parent-portal-notif-type" style={{ fontSize: 11 }}>
                SCH
              </span>
            )}
          </div>
          <p className="parent-portal-sidebar-brand">EduClear</p>
          <p className="parent-portal-sidebar-tag">{schoolName}</p>
          <nav className="parent-portal-sidebar-nav">
            {navItems.map((item) => {
              const active = panel === item.key;
              return (
              <button
                key={item.key}
                type="button"
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
                onClick={() => switchPanel(item.key)}
              >
                <span className={`nav-icon parent-portal-tile-icon parent-portal-tile-icon--${item.tile}`} aria-hidden>
                  <PortalIcon name={item.tile} />
                </span>
                {item.label}
              </button>
              );
            })}
          </nav>
          <div className="parent-portal-sidebar-footer">
            <button type="button" className="parent-portal-btn-ghost" onClick={logout}>
              Log out
            </button>
          </div>
        </aside>

        <div className="parent-portal-body">
          <header
            className={`parent-portal-app-header${panel === "dashboard" ? " parent-portal-app-header--dash" : ""}`}
          >
            <div style={{ minWidth: 0 }}>
              <h1 className="parent-portal-app-header-title">{panelTitle}</h1>
              <p className="parent-portal-app-header-sub">{schoolName}</p>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
              {panel !== "dashboard" ? (
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
              ) : null}
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
          <div className="parent-portal-dash">
            <CompactDashHeader
              parentName={parentDisplayName}
              schoolName={schoolName}
              logoUrl={schoolBranding.logoUrl}
              lastVisit={lastVisitShown}
              unreadCount={unreadNotifCount}
              onOpenNotifications={() => void openNotificationsPanel()}
              onOpenSettings={() => switchPanel("settings")}
            />

            {learners.length > 0 ? (
              <div className="parent-portal-child-selector" aria-label="Select a child">
                <div className="parent-portal-section-label">My children</div>
                <div className="parent-portal-child-chips" role="list">
                  {learners.map((row) => {
                    const selected = selectedLearnerId === row.learner.id;
                    return (
                      <button
                        key={row.learner.id}
                        type="button"
                        role="listitem"
                        className={`parent-portal-child-chip${selected ? " active" : ""}`}
                        aria-pressed={selected}
                        aria-current={selected ? "true" : undefined}
                        onClick={() => setSelectedLearnerId(row.learner.id)}
                      >
                        <span className="parent-portal-child-chip-avatar" aria-hidden>
                          {(row.learner.firstName || "?").charAt(0).toUpperCase()}
                        </span>
                        <span className="parent-portal-child-chip-text">
                          <strong>
                            {row.learner.firstName} {row.learner.lastName}
                          </strong>
                          <small>
                            {[row.learner.grade, row.learner.className].filter(Boolean).join(" · ") || "Learner"}
                          </small>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {activeLearner ? (
                  <div className="parent-portal-child-actions" aria-label={`Actions for ${activeLearner.firstName}`}>
                    <button
                      type="button"
                      className="parent-portal-child-action"
                      onClick={() => {
                        setProfileLearnerId(activeLearner.id);
                        setPanel("profile");
                      }}
                    >
                      <PortalIcon name="profile" />
                      Profile
                    </button>
                    <button
                      type="button"
                      className="parent-portal-child-action"
                      onClick={() => void openMessages(activeLearner.id)}
                    >
                      <PortalIcon name="messages" />
                      Message
                    </button>
                    <button
                      type="button"
                      className="parent-portal-child-action"
                      onClick={() => {
                        setSelectedLearnerId(activeLearner.id);
                        setPanel("homework");
                      }}
                    >
                      <PortalIcon name="homework" />
                      Homework
                    </button>
                    <button
                      type="button"
                      className="parent-portal-child-action"
                      onClick={() => {
                        setSelectedLearnerId(activeLearner.id);
                        setPanel("notices");
                      }}
                    >
                      <PortalIcon name="notices" />
                      Notices
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="parent-portal-card parent-portal-card--compact">
                <p className="parent-portal-muted" style={{ margin: 0 }}>
                  No linked learners are available for this parent account. Contact the school if this looks wrong.
                </p>
              </div>
            )}

            <button
              type="button"
              className="parent-portal-finance-summary parent-portal-finance-summary--compact"
              onClick={() => switchPanel("statements")}
              aria-label="Open Finance Hub"
            >
              <div>
                <div className="parent-portal-finance-summary-label">Account balance</div>
                <div className="parent-portal-finance-summary-value">{outstandingBalanceLabel}</div>
                <div className="parent-portal-finance-summary-sub">
                  {billingLoading
                    ? "Updating billing…"
                    : familyBilling?.accountRef
                      ? `Ref ${familyBilling.accountRef}`
                      : familyBilling
                        ? "Family billing account"
                        : "Balance unavailable — try again shortly"}
                </div>
              </div>
              <span className="parent-portal-finance-summary-cta" aria-hidden>
                View
              </span>
            </button>

            <div className="parent-portal-updates">
              <div className="parent-portal-updates-head">
                <div className="parent-portal-section-label parent-portal-section-label--inline">Latest updates</div>
                <button
                  type="button"
                  className="parent-portal-link-btn"
                  onClick={() => switchPanel("notices")}
                >
                  View all
                </button>
              </div>
              {latestUpdates.length === 0 ? (
                <p className="parent-portal-muted parent-portal-updates-empty">No recent updates.</p>
              ) : (
                <ul className="parent-portal-updates-list">
                  {latestUpdates.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        className="parent-portal-update-row"
                        onClick={() => switchPanel(row.panel)}
                      >
                        <span className={`parent-portal-tile-icon parent-portal-tile-icon--sm parent-portal-tile-icon--${row.tile}`} aria-hidden>
                          <PortalIcon name={row.tile} />
                        </span>
                        <span className="parent-portal-update-row-text">
                          <strong>
                            <span className="parent-portal-update-kind">{row.kind}</span>
                            {row.title}
                          </strong>
                          <small>{row.meta}</small>
                        </span>
                        <PortalIcon name="chevron" className="parent-portal-update-chevron" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="parent-portal-section-label">Quick access</div>
            <div className="parent-portal-tile-grid parent-portal-tile-grid--compact" aria-label="Parent portal shortcuts">
              {dashboardTiles.map((tile) => (
                <button
                  key={tile.key}
                  type="button"
                  className={`parent-portal-tile parent-portal-tile--compact parent-portal-tile--${tile.tile}`}
                  onClick={() => {
                    if (tile.key === "notifications") void openNotificationsPanel();
                    else switchPanel(tile.key);
                  }}
                >
                  <span className={`parent-portal-tile-icon parent-portal-tile-icon--sm parent-portal-tile-icon--${tile.tile}`} aria-hidden>
                    <PortalIcon name={tile.tile} />
                  </span>
                  <strong>{tile.label}</strong>
                </button>
              ))}
            </div>
          </div>
        )}

        {panel === "notifications" && (
          <div className="parent-portal-card parent-portal-panel">
            <PanelHeader title="Alerts" onBack={() => setPanel("dashboard")} />
            {notifications.length === 0 ? (
              <p className="parent-portal-empty">No alerts yet.</p>
            ) : (
              <ul className="parent-portal-panel-list">
                {notifications.map((n) => (
                  <li key={n.id} className={`parent-portal-panel-row${n.isRead ? " is-read" : ""}`}>
                    <div className="parent-portal-panel-row-top">
                      <span className={`parent-portal-tile-icon parent-portal-tile-icon--sm parent-portal-tile-icon--alerts`} aria-hidden>
                        <PortalIcon name="alerts" />
                      </span>
                      <div className="parent-portal-panel-row-text">
                        <div className="parent-portal-notif-type">{notificationCategoryLabel(n.type)}</div>
                        <strong>{n.title}</strong>
                        <small>{n.message}</small>
                      </div>
                      <span className="parent-portal-panel-row-meta">{new Date(n.createdAt).toLocaleDateString()}</span>
                    </div>
                    {!n.isRead ? (
                      <button
                        type="button"
                        className="parent-portal-btn-ghost parent-portal-btn-ghost--gold-text parent-portal-panel-inline-btn"
                        onClick={() => void markNotificationRead(n.id)}
                      >
                        Mark read
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {panel === "messages" && (
          <div className="parent-portal-card parent-portal-panel parent-portal-panel--messages">
            <PanelHeader title="Messages" onBack={() => setPanel("dashboard")} />
            <LearnerSwitchStrip learners={learners} selectedId={selectedLearnerId} onSelect={setSelectedLearnerId} />
            <div className="parent-portal-msg-meta">
              {activeLearner ? (
                <span>
                  {activeLearner.firstName} {activeLearner.lastName}
                  {activeLearner.grade ? ` · ${activeLearner.grade}` : ""}
                  {activeLearner.className ? ` · ${activeLearner.className}` : ""}
                </span>
              ) : (
                <span>Select a child</span>
              )}
              <span className="parent-portal-msg-teacher">Teacher · {teacherInfo?.name || "Assigned teacher"}</span>
            </div>
            <div className="parent-portal-msg-thread" role="log" aria-live="polite">
              {threadMessages.length === 0 ? (
                <p className="parent-portal-empty">No messages yet. Send a note to the class teacher.</p>
              ) : (
                threadMessages.map((m) => (
                  <div
                    key={m.id}
                    className={`parent-portal-msg-bubble ${m.sender === "PARENT" ? "parent-portal-msg-bubble--parent" : "parent-portal-msg-bubble--other"}`}
                  >
                    <div className="parent-portal-notif-type">{m.senderName || m.sender}</div>
                    <div className="parent-portal-msg-body">{m.body}</div>
                    {formatParentMessageDateTime(m.createdAt) ? (
                      <div className="parent-portal-muted" style={{ fontSize: 11, marginTop: 4 }}>
                        {formatParentMessageDateTime(m.createdAt)}
                      </div>
                    ) : null}
                    <ParentAttachmentList attachments={m.attachments} label="Message attachments" />
                  </div>
                ))
              )}
            </div>
            <div className="parent-portal-msg-composer">
              <textarea
                className="parent-portal-textarea parent-portal-textarea--compact"
                value={messageDraft}
                onChange={(e) => setMessageDraft(e.target.value)}
                rows={2}
                placeholder="Write a message…"
                aria-label="Message to class teacher"
              />
              <button
                type="button"
                className="parent-portal-btn-primary"
                onClick={() => void sendMessage()}
                disabled={loading || !messageDraft.trim()}
              >
                Send
              </button>
            </div>
          </div>
        )}

        {panel === "homework" && (
          <div className="parent-portal-card parent-portal-panel">
            <PanelHeader title="Homework" onBack={() => setPanel("dashboard")} />
            <LearnerSwitchStrip learners={learners} selectedId={selectedLearnerId} onSelect={setSelectedLearnerId} />
            {contentListLoading && <p className="parent-portal-muted parent-portal-panel-status">Loading…</p>}
            {!contentListLoading && contentList.length === 0 && <p className="parent-portal-empty">No homework posted yet.</p>}
            <ul className="parent-portal-panel-list">
              {contentList.map((h: any) => (
                <li key={h.id} className="parent-portal-panel-row">
                  <div className="parent-portal-panel-row-top">
                    <span className="parent-portal-tile-icon parent-portal-tile-icon--sm parent-portal-tile-icon--homework" aria-hidden>
                      <PortalIcon name="homework" />
                    </span>
                    <div className="parent-portal-panel-row-text">
                      <strong>{h.title}</strong>
                      <small className={h.dueDate ? undefined : "is-muted"}>{homeworkDueLabel(h.dueDate)}</small>
                    </div>
                  </div>
                  <ParentAttachmentList attachments={h.attachments} label="Homework attachments" />
                </li>
              ))}
            </ul>
            {contentListHasMore ? (
              <p className="parent-portal-muted parent-portal-panel-status">Showing latest 50 items.</p>
            ) : null}
          </div>
        )}

        {panel === "notices" && (
          <div className="parent-portal-card parent-portal-panel">
            <PanelHeader title="Notices" onBack={() => setPanel("dashboard")} />
            <LearnerSwitchStrip learners={learners} selectedId={selectedLearnerId} onSelect={setSelectedLearnerId} />
            {contentListLoading && <p className="parent-portal-muted parent-portal-panel-status">Loading…</p>}
            {!contentListLoading && contentList.length === 0 && <p className="parent-portal-empty">No notices yet.</p>}
            <ul className="parent-portal-panel-list">
              {contentList.map((n: any) => (
                <li key={n.id} className="parent-portal-panel-row">
                  <div className="parent-portal-panel-row-top">
                    <span className="parent-portal-tile-icon parent-portal-tile-icon--sm parent-portal-tile-icon--notices" aria-hidden>
                      <PortalIcon name="notices" />
                    </span>
                    <div className="parent-portal-panel-row-text">
                      <strong>{n.title}</strong>
                      <small>{String(n.body || "").slice(0, 180) || "Open for details"}</small>
                    </div>
                  </div>
                  <ParentAttachmentList attachments={n.attachments} label="Notice attachments" />
                </li>
              ))}
            </ul>
            {contentListHasMore ? (
              <p className="parent-portal-muted parent-portal-panel-status">Showing latest 50 items.</p>
            ) : null}
          </div>
        )}

        {panel === "events" && (
          <div className="parent-portal-card parent-portal-panel">
            <PanelHeader title="Events" onBack={() => setPanel("dashboard")} />
            <ParentEventsPanel />
          </div>
        )}

        {panel === "documents" && (
          <div className="parent-portal-card parent-portal-panel">
            <PanelHeader title="Documents" onBack={() => setPanel("dashboard")} />
            <LearnerSwitchStrip learners={learners} selectedId={selectedLearnerId} onSelect={setSelectedLearnerId} />
            {contentListLoading && <p className="parent-portal-muted parent-portal-panel-status">Loading…</p>}
            {!contentListLoading && contentList.length === 0 && <p className="parent-portal-empty">No documents yet.</p>}
            <ul className="parent-portal-panel-list">
              {contentList.map((d: any) => (
                <li key={d.id} className="parent-portal-panel-row parent-portal-panel-row--doc">
                  <div className="parent-portal-panel-row-top">
                    <span className="parent-portal-tile-icon parent-portal-tile-icon--sm parent-portal-tile-icon--documents" aria-hidden>
                      <PortalIcon name="documents" />
                    </span>
                    <div className="parent-portal-panel-row-text">
                      <strong>{d.title}</strong>
                      {d.description ? <small>{d.description}</small> : null}
                    </div>
                  </div>
                  <div className="parent-portal-doc-actions">
                    <button
                      type="button"
                      className="parent-portal-btn-ghost parent-portal-btn-ghost--gold-text parent-portal-attach-btn"
                      onClick={() => {
                        void downloadParentDocument(d).catch((e: unknown) => {
                          window.alert(e instanceof Error ? e.message : "Download failed");
                        });
                      }}
                    >
                      Download
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {contentListHasMore ? (
              <p className="parent-portal-muted parent-portal-panel-status">Showing latest 50 items.</p>
            ) : null}
          </div>
        )}

        {panel === "statements" && (
          <div className="parent-portal-panel parent-portal-panel--finance">
            <PanelHeader title="Finance" onBack={() => setPanel("dashboard")} />
            <ParentFinanceHub
              billing={familyBilling}
              loading={billingLoading}
              policy={financePolicy}
              accountLabel={parentAccountLabel}
              parentName={parentDisplayName || "Parent"}
              learnerName={parentFinanceLearnerLabel}
              childrenOnAccount={familyBillingLearners}
              statementNotice={statementNotice}
              statementBusy={statementActionBusy}
              onDownloadStatement={() => void handleDownloadStatement()}
            />
          </div>
        )}

        {panel === "incidents" && (
          <div className="parent-portal-card parent-portal-panel">
            <PanelHeader title="Incidents" onBack={() => setPanel("dashboard")} />
            <LearnerSwitchStrip learners={learners} selectedId={selectedLearnerId} onSelect={setSelectedLearnerId} />
            {(incidentLoading || contentListLoading) && (
              <p className="parent-portal-muted parent-portal-panel-status">Loading…</p>
            )}
            {!contentListLoading && contentList.length === 0 && !incidentLoading && (
              <p className="parent-portal-empty">No incidents to show.</p>
            )}
            <ul className="parent-portal-panel-list">
              {contentList.map((inc: any) => (
                <li key={inc.id}>
                  <button type="button" className="parent-portal-incident-btn" onClick={() => void openIncident(inc.id)}>
                    <span className="parent-portal-tile-icon parent-portal-tile-icon--sm parent-portal-tile-icon--incidents" aria-hidden>
                      <PortalIcon name="incidents" />
                    </span>
                    <span className="parent-portal-panel-row-text">
                      <strong>{inc.subject}</strong>
                      <small>{String(inc.summary || "").slice(0, 140)}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {incidentDetail && (
              <div className="parent-portal-incident-detail">
                <div className="parent-portal-incident-detail-head">
                  <strong>{incidentDetail.subject}</strong>
                  <button
                    type="button"
                    className="parent-portal-btn-ghost parent-portal-btn-ghost--gold-text parent-portal-panel-inline-btn"
                    onClick={() => setIncidentDetail(null)}
                  >
                    Close
                  </button>
                </div>
                <div className="parent-portal-muted" style={{ fontSize: 12 }}>{formatShortDate(incidentDetail.incidentDate)}</div>
                <p className="parent-portal-incident-detail-body">{incidentDetail.summary}</p>
              </div>
            )}
          </div>
        )}

        {panel === "settings" && (
          <div className="parent-portal-card parent-portal-panel">
            <PanelHeader title="Settings" onBack={() => setPanel("dashboard")} />
            <button type="button" className="parent-portal-btn-primary parent-portal-full-width" onClick={() => setShellView("pwa")}>
              Install app instructions
            </button>
            <ParentPushSettings onPrefsChanged={() => void liveNotifs.refreshPrefs()} />
            <button type="button" className="parent-portal-btn-ghost parent-portal-full-width" style={{ marginTop: 12 }} onClick={logout}>
              Sign out
            </button>
          </div>
        )}

        {panel === "profile" && !profileLearner && (
          <div className="parent-portal-card parent-portal-panel">
            <PanelHeader title="Learner profile" onBack={() => setPanel("dashboard")} />
            <p className="parent-portal-empty">Choose a learner from the dashboard.</p>
          </div>
        )}

        {panel === "profile" && profileLearner && (
          <div className="parent-portal-card parent-portal-panel">
            <PanelHeader title="Learner profile" onBack={() => setPanel("dashboard")} />
            <div className="parent-portal-profile-name">
              {profileLearner.firstName} {profileLearner.lastName}
            </div>
            <div className="parent-portal-profile-meta">
              <div>
                Grade / class: {profileLearner.grade}
                {profileLearner.className ? ` · ${profileLearner.className}` : ""}
              </div>
              {profileLearner.admissionNo ? <div>Admission no.: {profileLearner.admissionNo}</div> : null}
            </div>
            <div className="parent-portal-profile-actions">
              <button type="button" className="parent-portal-btn-primary" onClick={() => void openMessages(profileLearner.id)}>
                Message teacher
              </button>
              <button
                type="button"
                className="parent-portal-btn-ghost parent-portal-btn-ghost--gold-text"
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
            {bottomNavItems.map((item) => {
              const active = panel === item.key;
              return (
              <button
                key={item.key}
                type="button"
                className={active ? "active" : ""}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  if (item.key === "notifications") {
                    void openNotificationsPanel();
                  } else {
                    switchPanel(item.key);
                  }
                }}
              >
                <span className="parent-portal-bottom-nav-icon" aria-hidden>
                  <PortalIcon name={item.tile} />
                </span>
                {item.label}
              </button>
              );
            })}
          </nav>
        </div>
      </div>

      {statementExportModal ? (
        <StatementPeriodModal
          title={
            statementExportModal === "print"
              ? "Print Statement"
              : statementExportModal === "download"
                ? "Download Statement PDF"
                : "Email Statement"
          }
          actionLabel={parentExportPeriodActionLabel(statementExportModal)}
          period={statementExportPeriod}
          busy={statementActionBusy}
          onPeriodChange={setStatementExportPeriod}
          onConfirm={() => void confirmStatementExportPeriod()}
          onClose={closeStatementExportModal}
        />
      ) : null}
    </div>
  );
}

function CompactDashHeader({
  parentName,
  schoolName,
  logoUrl,
  lastVisit,
  unreadCount,
  onOpenNotifications,
  onOpenSettings,
}: {
  parentName: string;
  schoolName: string;
  logoUrl?: string | null;
  lastVisit: string | null;
  unreadCount: number;
  onOpenNotifications: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="parent-portal-dash-header">
      <div className="parent-portal-dash-header-brand">
        <div className="parent-portal-welcome-logo parent-portal-welcome-logo--sm">
          {logoUrl ? (
            <img src={logoUrl} alt={`${schoolName} logo`} />
          ) : (
            <span className="parent-portal-notif-type" style={{ fontSize: 10 }}>
              SCH
            </span>
          )}
        </div>
        <div className="parent-portal-dash-header-text">
          <p className="parent-portal-dash-greeting">Hello, {parentName}</p>
          <p className="parent-portal-dash-school">{schoolName}</p>
          {lastVisit ? <p className="parent-portal-dash-visit">Last visit {lastVisit}</p> : null}
        </div>
      </div>
      <div className="parent-portal-dash-header-actions">
        <button
          type="button"
          className="parent-portal-icon-btn parent-portal-alerts-btn"
          onClick={onOpenNotifications}
          aria-label={unreadCount > 0 ? `Alerts, ${unreadCount} unread` : "Alerts"}
        >
          <PortalIcon name="alerts" />
          {unreadCount > 0 ? (
            <span className="parent-portal-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          className="parent-portal-icon-btn"
          onClick={onOpenSettings}
          aria-label="Settings"
        >
          <PortalIcon name="settings" />
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
    <div className="parent-portal-panel-head">
      <p className="parent-portal-panel-kicker" aria-hidden>
        {title}
      </p>
      <button type="button" className="parent-portal-back-btn" onClick={onBack} aria-label={`Back to dashboard from ${title}`}>
        Back
      </button>
    </div>
  );
}
