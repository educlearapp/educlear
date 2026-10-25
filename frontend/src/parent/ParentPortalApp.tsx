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
import { useParentPortalPushPreparation } from "./useParentPortalPushPreparation";
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
  | "documents"
  | "statements"
  | "incidents"
  | "settings"
  | "notifications"
  | "profile";

const navItems: { key: Panel; label: string; icon: string; tile: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "🏠", tile: "home" },
  { key: "messages", label: "Messages", icon: "✉️", tile: "messages" },
  { key: "homework", label: "Homework", icon: "📝", tile: "homework" },
  { key: "notices", label: "Notices", icon: "📌", tile: "notices" },
  { key: "documents", label: "Documents", icon: "📎", tile: "documents" },
  { key: "statements", label: "Finance Hub", icon: "💳", tile: "finance" },
  { key: "incidents", label: "Incidents", icon: "⚠️", tile: "incidents" },
  { key: "settings", label: "Settings", icon: "⚙️", tile: "settings" },
];

const bottomNavItems: { key: Panel; label: string; icon: string }[] = [
  { key: "dashboard", label: "Home", icon: "🏠" },
  { key: "messages", label: "Messages", icon: "✉️" },
  { key: "statements", label: "Finance", icon: "💳" },
  { key: "notifications", label: "Alerts", icon: "🔔" },
];

/** Dashboard shortcut tiles — only implemented parent-portal surfaces. */
const dashboardTiles: { key: Panel; label: string; icon: string; tile: string; hint: string }[] = [
  { key: "statements", label: "Finance", icon: "💳", tile: "finance", hint: "Balance & statements" },
  { key: "messages", label: "Messages", icon: "✉️", tile: "messages", hint: "Teacher chat" },
  { key: "homework", label: "Homework", icon: "📝", tile: "homework", hint: "Assignments" },
  { key: "notices", label: "Notices", icon: "📌", tile: "notices", hint: "School updates" },
  { key: "documents", label: "Documents", icon: "📎", tile: "documents", hint: "Files to download" },
  { key: "incidents", label: "Incidents", icon: "⚠️", tile: "incidents", hint: "Behaviour notes" },
  { key: "notifications", label: "Alerts", icon: "🔔", tile: "alerts", hint: "Notifications" },
  { key: "settings", label: "Settings", icon: "⚙️", tile: "settings", hint: "App & sign out" },
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

  const unreadNotifCount = useMemo(() => {
    const list = (dashboard?.notifications || []) as Notification[];
    return list.filter((n) => !n.isRead).length;
  }, [dashboard?.notifications]);

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

  const sid = session?.parent?.school?.id || "";
  const parentId = session?.parent?.id || "";

  useParentPortalPushPreparation({
    enabled: import.meta.env.VITE_REGISTER_PARENT_PUSH_SW === "true",
    schoolId: sid,
    parentId,
  });

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
    if (selectedLearnerId) qs.set("learnerId", selectedLearnerId);
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
  }, [shellView, panel, selectedLearnerId]);

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
                  {item.icon}
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
                            {row.relation ? ` · ${row.relation}` : ""}
                          </small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="parent-portal-card">
                <p className="parent-portal-muted" style={{ margin: 0 }}>
                  No linked learners are available for this parent account. Contact the school if this looks wrong.
                </p>
              </div>
            )}

            <button
              type="button"
              className="parent-portal-finance-summary"
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

            {homeworkDuePreview ? (
              <button
                type="button"
                className="parent-portal-notice-strip parent-portal-notice-strip--homework"
                onClick={() => switchPanel("homework")}
              >
                <span className="parent-portal-tile-icon parent-portal-tile-icon--homework" aria-hidden>
                  📝
                </span>
                <span>
                  <strong>Upcoming homework</strong>
                  <small>
                    {homeworkDuePreview.title} · {homeworkDuePreview.due}
                  </small>
                </span>
              </button>
            ) : null}

            <div className="parent-portal-section-label">School notices</div>
            <div className="parent-portal-notices-preview">
              {noticePreview.length === 0 ? (
                <p className="parent-portal-muted" style={{ margin: "0 0 12px" }}>
                  No school notices right now.
                </p>
              ) : (
                noticePreview.map((n: any) => (
                  <button
                    key={String(n.id || n.title)}
                    type="button"
                    className="parent-portal-notice-strip"
                    onClick={() => switchPanel("notices")}
                  >
                    <span className="parent-portal-tile-icon parent-portal-tile-icon--notices" aria-hidden>
                      📌
                    </span>
                    <span>
                      <strong>{String(n.title || "Notice")}</strong>
                      <small>{String(n.body || "").slice(0, 120) || "Open notices"}</small>
                    </span>
                  </button>
                ))
              )}
            </div>

            <div className="parent-portal-section-label">Quick access</div>
            <div className="parent-portal-tile-grid" aria-label="Parent portal shortcuts">
              {dashboardTiles.map((tile) => (
                <button
                  key={tile.key}
                  type="button"
                  className={`parent-portal-tile parent-portal-tile--${tile.tile}`}
                  onClick={() => {
                    if (tile.key === "notifications") void openNotificationsPanel();
                    else switchPanel(tile.key);
                  }}
                >
                  <span className={`parent-portal-tile-icon parent-portal-tile-icon--${tile.tile}`} aria-hidden>
                    {tile.icon}
                  </span>
                  <strong>{tile.label}</strong>
                  <small>{tile.hint}</small>
                </button>
              ))}
            </div>

            <div className="parent-portal-section-label">Children details</div>
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
            {contentListLoading && <p className="parent-portal-muted" style={{ fontSize: 13 }}>Loading…</p>}
            {!contentListLoading && contentList.length === 0 && <p className="parent-portal-muted">No homework posted yet.</p>}
            {contentList.map((h: any) => (
              <div key={h.id} className="parent-portal-list-divider">
                <strong style={{ fontSize: 14 }}>{h.title}</strong>
                {h.dueDate ? (
                  <div className="parent-portal-notif-type" style={{ fontSize: 12, marginTop: 4 }}>Due {new Date(h.dueDate).toLocaleDateString()}</div>
                ) : (
                  <div className="parent-portal-muted" style={{ fontSize: 12, marginTop: 4 }}>No due date</div>
                )}
              </div>
            ))}
            {contentListHasMore ? (
              <p className="parent-portal-muted" style={{ fontSize: 11, marginTop: 8 }}>Showing latest 50 items.</p>
            ) : null}
          </div>
        )}

        {panel === "notices" && (
          <div className="parent-portal-card">
            <PanelHeader title="Notices" onBack={() => setPanel("dashboard")} />
            <LearnerSwitchStrip learners={learners} selectedId={selectedLearnerId} onSelect={setSelectedLearnerId} />
            {contentListLoading && <p className="parent-portal-muted" style={{ fontSize: 13 }}>Loading…</p>}
            {!contentListLoading && contentList.length === 0 && <p className="parent-portal-muted">No notices yet.</p>}
            {contentList.map((n: any) => (
              <div key={n.id} className="parent-portal-list-divider">
                <strong style={{ fontSize: 14 }}>{n.title}</strong>
                <div className="parent-portal-muted" style={{ fontSize: 13, marginTop: 4 }}>{String(n.body || "").slice(0, 220)}</div>
              </div>
            ))}
            {contentListHasMore ? (
              <p className="parent-portal-muted" style={{ fontSize: 11, marginTop: 8 }}>Showing latest 50 items.</p>
            ) : null}
          </div>
        )}

        {panel === "documents" && (
          <div className="parent-portal-card">
            <PanelHeader title="Documents" onBack={() => setPanel("dashboard")} />
            <LearnerSwitchStrip learners={learners} selectedId={selectedLearnerId} onSelect={setSelectedLearnerId} />
            {contentListLoading && <p className="parent-portal-muted" style={{ fontSize: 13 }}>Loading…</p>}
            {!contentListLoading && contentList.length === 0 && <p className="parent-portal-muted">No documents yet.</p>}
            {contentList.map((d: any) => (
              <div key={d.id} className="parent-portal-list-divider">
                <a href={documentHref(d.fileUrl)} target="_blank" rel="noreferrer" className="parent-portal-link">
                  {d.title}
                </a>
                {d.description ? <div className="parent-portal-muted" style={{ fontSize: 12, marginTop: 4 }}>{d.description}</div> : null}
              </div>
            ))}
            {contentListHasMore ? (
              <p className="parent-portal-muted" style={{ fontSize: 11, marginTop: 8 }}>Showing latest 50 items.</p>
            ) : null}
          </div>
        )}

        {panel === "statements" && (
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
        )}

        {panel === "incidents" && (
          <div className="parent-portal-card">
            <PanelHeader title="Incidents" onBack={() => setPanel("dashboard")} />
            <LearnerSwitchStrip learners={learners} selectedId={selectedLearnerId} onSelect={setSelectedLearnerId} />
            {(incidentLoading || contentListLoading) && <p className="parent-portal-muted" style={{ fontSize: 13 }}>Loading…</p>}
            {!contentListLoading && contentList.length === 0 && !incidentLoading && (
              <p className="parent-portal-muted">No incidents to show.</p>
            )}
            {contentList.map((inc: any) => (
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
                  {item.icon}
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
          <img
            src={logoUrl}
            alt={`${schoolName} logo`}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span className="parent-portal-notif-type" style={{ fontSize: 11 }}>SCH</span>
        )}
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="parent-portal-muted" style={{ fontSize: 11, fontWeight: 700 }}>Welcome back</div>
        <div className="parent-portal-welcome-name">Hello, {parentName}</div>
        <div className="parent-portal-muted" style={{ fontSize: 12, marginTop: 2, fontWeight: 600 }}>{schoolName}</div>
        <div className="parent-portal-muted" style={{ fontSize: 11, marginTop: 4 }}>
          {learnerCount} linked child{learnerCount === 1 ? "" : "ren"}
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
          <span className="parent-portal-selected-badge">SELECTED</span>
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
