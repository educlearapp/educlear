import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { teacherPortalPwaHead } from "../pwa/pwaIconConfig";
import { usePortalPwaHead } from "../pwa/usePortalPwaHead";
import { resolveSchoolLogoUrl } from "../utils/schoolLogo";
import { staffApiFetch } from "../staffApi";

const SIDEBAR_LINKS = [
  { to: "/teacher/home", label: "Dashboard", icon: "🏠", end: true },
  { to: "/teacher/inbox", label: "Inbox", icon: "✉️" },
  { to: "/teacher/homework", label: "Homework", icon: "📝" },
  { to: "/teacher/notices", label: "Notices", icon: "📌" },
  { to: "/teacher/incidents", label: "Incidents", icon: "⚠️" },
  { to: "/teacher/documents", label: "Documents", icon: "📎" },
  { to: "/teacher/learners", label: "Learners", icon: "🎓" },
  { to: "/teacher/attendance", label: "Attendance", icon: "📋" },
  { to: "/teacher/homesafe", label: "HomeSafe", icon: "🏡" },
] as const;

const INBOX_POLL_MS = 45_000;

export default function TeacherShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = localStorage.getItem("token");
  const schoolId = localStorage.getItem("schoolId");
  const [schoolLogoUrl, setSchoolLogoUrl] = useState(() => resolveSchoolLogoUrl());
  const [schoolName, setSchoolName] = useState(() => localStorage.getItem("schoolName") || "");
  const [unreadInbox, setUnreadInbox] = useState(0);
  const [inboxNotice, setInboxNotice] = useState<string | null>(null);

  const path = location.pathname;
  const onLogin = path.endsWith("/login");
  const onHome = path === "/teacher" || path.endsWith("/home");

  usePortalPwaHead(teacherPortalPwaHead);

  useEffect(() => {
    if (!token || !schoolId || onLogin) return;
    let cancelled = false;
    let lastUnread = 0;
    let primed = false;

    async function refreshUnread() {
      try {
        const data = (await staffApiFetch("/api/teacher-app/me")) as {
          school?: { name?: string | null; logoUrl?: string | null };
          unreadInbox?: number;
        };
        if (cancelled) return;
        if (data?.school?.name) {
          setSchoolName(String(data.school.name));
          localStorage.setItem("schoolName", String(data.school.name));
        }
        const logo = resolveSchoolLogoUrl(data?.school || null);
        if (logo) {
          setSchoolLogoUrl(logo);
          localStorage.setItem("schoolLogoUrl", logo);
        }
        const next = Math.max(0, Number(data?.unreadInbox) || 0);
        setUnreadInbox(next);
        if (primed && next > lastUnread) {
          const added = next - lastUnread;
          const msg =
            added === 1
              ? "New parent message in your Inbox"
              : `${added} new parent messages in your Inbox`;
          setInboxNotice(msg);
          // In-app / foreground only — teacher device push is not configured.
          try {
            if (
              typeof Notification !== "undefined" &&
              Notification.permission === "granted" &&
              document.visibilityState !== "visible"
            ) {
              new Notification("EduClear Teacher Portal", { body: msg });
            }
          } catch {
            /* ignore */
          }
        }
        lastUnread = next;
        primed = true;
      } catch {
        /* ignore transient poll errors */
      }
    }

    void refreshUnread();
    const id = window.setInterval(() => void refreshUnread(), INBOX_POLL_MS);
    const onFocus = () => void refreshUnread();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [token, schoolId, onLogin]);

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("schoolId");
    localStorage.removeItem("userEmail");
    localStorage.removeItem("userName");
    localStorage.removeItem("userRole");
    navigate("/teacher/login", { replace: true });
  }

  if (onLogin) {
    return <Outlet />;
  }

  if (!token || !schoolId) {
    return <Navigate to="/teacher/login" replace />;
  }

  return (
    <div className="teacher-app-layout">
      <aside className="teacher-app-sidebar" aria-label="Teacher Portal navigation">
        <div className="teacher-sidebar-logo-wrap" aria-hidden={!schoolLogoUrl}>
          {schoolLogoUrl ? (
            <img src={schoolLogoUrl} alt="" />
          ) : (
            <span className="teacher-sidebar-logo-fallback">SCH</span>
          )}
        </div>
        <p className="teacher-app-sidebar-brand">Teacher Portal</p>
        <p className="teacher-app-sidebar-tag">{schoolName || "EduClear Teacher App"}</p>
        <nav className="teacher-app-sidebar-nav">
          {SIDEBAR_LINKS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={"end" in item ? item.end : false}
              className={({ isActive }) =>
                [
                  isActive ? "active" : "",
                  item.to === "/teacher/homesafe" ? "teacher-nav-homesafe" : "",
                ]
                  .filter(Boolean)
                  .join(" ")
              }
            >
              <span className="nav-icon" aria-hidden>
                {item.icon}
              </span>
              {item.label}
              {item.to === "/teacher/inbox" && unreadInbox > 0
                ? ` (${unreadInbox > 9 ? "9+" : unreadInbox})`
                : ""}
            </NavLink>
          ))}
        </nav>
        <div className="teacher-app-sidebar-footer">
          <button type="button" className="teacher-touch-btn" onClick={logout} style={{ width: "100%" }}>
            Log out
          </button>
        </div>
      </aside>

      <div className="teacher-app-body">
        <header className="teacher-app-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {!onHome && (
              <button
                type="button"
                className="teacher-touch-btn icon-only"
                onClick={() => navigate(-1)}
                aria-label="Back"
              >
                ←
              </button>
            )}
            <span className="teacher-app-title">Teacher Portal</span>
          </div>
          <button type="button" className="teacher-touch-btn" onClick={logout}>
            Log out
          </button>
        </header>
        <main className="teacher-app-main">
          {inboxNotice && (
            <div
              role="status"
              style={{
                margin: "0 0 12px",
                padding: "10px 12px",
                borderRadius: 10,
                background: "rgba(212,175,55,0.18)",
                border: "1px solid rgba(212,175,55,0.45)",
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600 }}>{inboxNotice}</span>
              <span style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="teacher-touch-btn primary"
                  onClick={() => {
                    setInboxNotice(null);
                    navigate("/teacher/inbox");
                  }}
                >
                  Open Inbox
                </button>
                <button type="button" className="teacher-touch-btn" onClick={() => setInboxNotice(null)}>
                  Dismiss
                </button>
              </span>
            </div>
          )}
          <Outlet />
        </main>
        <nav className="teacher-bottom-nav" aria-label="Teacher navigation">
          <NavLink to="/teacher/home" className={({ isActive }) => (isActive ? "active" : "")} end>
            Home
          </NavLink>
          <NavLink to="/teacher/inbox" className={({ isActive }) => (isActive ? "active" : "")}>
            Inbox{unreadInbox > 0 ? ` (${unreadInbox > 9 ? "9+" : unreadInbox})` : ""}
          </NavLink>
          <NavLink to="/teacher/homework" className={({ isActive }) => (isActive ? "active" : "")}>
            Homework
          </NavLink>
          <NavLink to="/teacher/learners" className={({ isActive }) => (isActive ? "active" : "")}>
            Learners
          </NavLink>
          <NavLink
            to="/teacher/homesafe"
            className={({ isActive }) =>
              [isActive ? "active" : "", "teacher-nav-homesafe"].filter(Boolean).join(" ")
            }
          >
            HomeSafe
          </NavLink>
        </nav>
      </div>
    </div>
  );
}
