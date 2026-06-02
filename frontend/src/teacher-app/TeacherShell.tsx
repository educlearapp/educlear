import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
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
] as const;

export default function TeacherShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = localStorage.getItem("token");
  const schoolId = localStorage.getItem("schoolId");
  const [schoolLogoUrl, setSchoolLogoUrl] = useState(() => resolveSchoolLogoUrl());
  const [schoolName, setSchoolName] = useState(() => localStorage.getItem("schoolName") || "");

  const path = location.pathname;
  const onLogin = path.endsWith("/login");
  const onHome = path === "/teacher" || path.endsWith("/home");

  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "/teacher-manifest.webmanifest";
    document.head.appendChild(link);
    const theme = document.createElement("meta");
    theme.name = "theme-color";
    theme.content = "#f7f4ef";
    document.head.appendChild(theme);
    const apple = document.createElement("meta");
    apple.name = "apple-mobile-web-app-capable";
    apple.content = "yes";
    document.head.appendChild(apple);
    return () => {
      document.head.removeChild(link);
      document.head.removeChild(theme);
      document.head.removeChild(apple);
    };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/teacher-sw.js").catch(() => {});
  }, []);

  useEffect(() => {
    if (!token || !schoolId) return;
    void staffApiFetch("/api/teacher-app/me")
      .then((data: { school?: { name?: string | null; logoUrl?: string | null } }) => {
        if (data?.school?.name) {
          setSchoolName(String(data.school.name));
          localStorage.setItem("schoolName", String(data.school.name));
        }
        const logo = resolveSchoolLogoUrl(data?.school || null);
        if (logo) {
          setSchoolLogoUrl(logo);
          localStorage.setItem("schoolLogoUrl", logo);
        }
      })
      .catch(() => {});
  }, [token, schoolId]);

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
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              <span className="nav-icon" aria-hidden>
                {item.icon}
              </span>
              {item.label}
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
          <Outlet />
        </main>
        <nav className="teacher-bottom-nav" aria-label="Teacher navigation">
          <NavLink to="/teacher/home" className={({ isActive }) => (isActive ? "active" : "")} end>
            Home
          </NavLink>
          <NavLink to="/teacher/inbox" className={({ isActive }) => (isActive ? "active" : "")}>
            Inbox
          </NavLink>
          <NavLink to="/teacher/homework" className={({ isActive }) => (isActive ? "active" : "")}>
            Homework
          </NavLink>
          <NavLink to="/teacher/learners" className={({ isActive }) => (isActive ? "active" : "")}>
            Learners
          </NavLink>
        </nav>
      </div>
    </div>
  );
}
