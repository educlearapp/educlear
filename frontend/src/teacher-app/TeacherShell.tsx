import { useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

export default function TeacherShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = localStorage.getItem("token");
  const schoolId = localStorage.getItem("schoolId");

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
    theme.content = "#0a0a0a";
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
    if (!onLogin && (!token || !schoolId)) {
      navigate("/teacher/login", { replace: true });
    }
  }, [onLogin, token, schoolId, navigate]);

  if (onLogin) {
    return <Outlet />;
  }

  if (!token || !schoolId) {
    return null;
  }

  return (
    <>
      <header className="teacher-app-header">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {!onHome && (
            <button type="button" className="teacher-touch-btn" onClick={() => navigate(-1)} aria-label="Back">
              ←
            </button>
          )}
          <span className="teacher-app-title">Teacher</span>
        </div>
        <button
          type="button"
          className="teacher-touch-btn"
          onClick={() => {
            localStorage.removeItem("token");
            localStorage.removeItem("schoolId");
            navigate("/teacher/login", { replace: true });
          }}
        >
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
    </>
  );
}
