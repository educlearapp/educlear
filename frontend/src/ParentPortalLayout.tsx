import * as React from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { clearParentPortalSession, getParentPortalSession } from "./parentPortalSession";
import logo from "./assets/logo.png";

const linkBaseStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  width: "100%",
  padding: "12px 14px",
  borderRadius: 12,
  textDecoration: "none",
  fontWeight: 900,
  border: "1px solid rgba(15,23,42,0.10)",
};

function ParentNavLink(props: { to: string; label: string }) {
  return (
    <NavLink
      to={props.to}
      style={({ isActive }) => ({
        ...linkBaseStyle,
        background: isActive ? "rgba(180,138,0,0.12)" : "#fff",
        color: isActive ? "#8b6b16" : "#0f172a",
        borderColor: isActive ? "rgba(180,138,0,0.35)" : "rgba(15,23,42,0.10)",
      })}
      end={props.to === "/parent/dashboard"}
    >
      <span>{props.label}</span>
      <span style={{ opacity: 0.55 }}>›</span>
    </NavLink>
  );
}

export default function ParentPortalLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const session = React.useMemo(() => getParentPortalSession(), []);

  React.useEffect(() => {
    if (!session) navigate("/parent/login", { replace: true, state: { from: location.pathname } });
  }, [location.pathname, navigate, session]);

  if (!session) return null;

  return (
    <div style={{ minHeight: "100vh", background: "#f7f4ef" }}>
      <div style={{ maxWidth: 1260, margin: "0 auto", padding: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, alignItems: "start" }}>
          <aside
            style={{
              position: "sticky",
              top: 16,
              borderRadius: 16,
              border: "1px solid rgba(212,175,55,0.18)",
              background: "linear-gradient(180deg, #0f0f0f 0%, #1a1a1a 100%)",
              color: "#f5deb3",
              padding: 14,
            }}
          >
            <div style={{ padding: "10px 10px 14px 10px", borderBottom: "1px solid rgba(212,175,55,0.18)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {session.schoolLogoUrl ? (
                  <img
                    src={session.schoolLogoUrl}
                    alt={session.schoolName ? `${session.schoolName} logo` : "School logo"}
                    style={{ maxHeight: 60, width: "auto", objectFit: "contain", display: "block" }}
                  />
                ) : (
                  <img src={logo} alt="EduClear" style={{ maxHeight: 44, width: "auto", objectFit: "contain", display: "block" }} />
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 900, color: "#d4af37", fontSize: 18 }}>
                    {session.schoolName ? session.schoolName : "EduClear Parent Portal"}
                  </div>
                  <div
                    style={{
                      marginTop: 2,
                      color: "rgba(226, 232, 240, 0.9)",
                      fontWeight: 700,
                      fontSize: 12,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 220,
                    }}
                  >
                    {session.parentEmail}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 6, color: "#e2e8f0", fontWeight: 700, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}>
                {/* kept for layout spacing compatibility */}
              </div>
            </div>

            <nav style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <ParentNavLink to="/parent/dashboard" label="Dashboard" />
              <ParentNavLink to="/parent/statements" label="Statements" />
              <ParentNavLink to="/parent/homework" label="Homework" />
              <ParentNavLink to="/parent/projects" label="Projects" />
              <ParentNavLink to="/parent/notices" label="Notices" />
              <ParentNavLink to="/parent/tuckshop" label="Tuckshop" />
              <ParentNavLink to="/parent/messages" label="Messages" />
            </nav>

            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(212,175,55,0.12)" }}>
              <button
                type="button"
                onClick={() => {
                  clearParentPortalSession();
                  navigate("/parent/login", { replace: true });
                }}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(212,175,55,0.25)",
                  background: "transparent",
                  color: "#f8fafc",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Logout
              </button>
            </div>
          </aside>

          <main
            style={{
              minHeight: "calc(100vh - 32px)",
              background: "#fff",
              borderRadius: 16,
              border: "1px solid rgba(15,23,42,0.08)",
              padding: 16,
            }}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

