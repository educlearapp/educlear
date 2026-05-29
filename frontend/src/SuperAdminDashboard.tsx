import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import AccessDenied from "./auth/AccessDenied";
import { canAccessMigration, migrationAccessDeniedDebug } from "./auth/migrationAccess";
import logo from "./assets/logo.png";
import MigrationCenter from "./pages/superadmin/MigrationCenter";
import MigrationResearch from "./pages/superadmin/MigrationResearch";
import SuperAdminMigrationPage from "./pages/SuperAdminMigrationPage";
import LiveBillingPlansImportPage from "./pages/superadmin/LiveBillingPlansImportPage";
import SuperAdminSchoolsPage from "./pages/SuperAdminSchoolsPage";
import "./App.css";
import "./SuperAdminDashboard.css";

type NavItem = {
  key: "schools" | "migration";
  label: string;
  path: string;
  icon: string;
};

const NAV_ITEMS: NavItem[] = [
  { key: "schools", label: "Schools Management", path: "/super-admin/schools", icon: "🏫" },
  { key: "migration", label: "Migration Center", path: "/super-admin/migration", icon: "🔄" },
];

export default function SuperAdminDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const superAdmin = canAccessMigration();

  const onMigrationRoute =
    location.pathname.startsWith("/super-admin/migration") || location.pathname === "/migration";

  const activeKey = onMigrationRoute
    ? "migration"
    : (NAV_ITEMS.find((item) => location.pathname.startsWith(item.path))?.key ?? "schools");

  if (!superAdmin) {
    return (
      <AccessDenied
        message="Access denied — Migration Center requires a school owner or platform admin account."
        debug={migrationAccessDeniedDebug()}
      />
    );
  }

  return (
    <div className="school-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <img src={logo} className="sidebar-logo" alt="EduClear" />
          <span>EduClear</span>
        </div>

        <div className="sa-admin-sidebar-label">Super Admin</div>

        {superAdmin &&
          NAV_ITEMS.map((item) => (
            <div
              key={item.key}
              className={`top-dashboard ${activeKey === item.key ? "active" : ""}`}
              onClick={() => navigate(item.path)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate(item.path);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <span className="menu-icon">{item.icon}</span>
              <span>{item.label}</span>
            </div>
          ))}
      </aside>

      <main className="main-content">
        <div className="page-area">
          <Routes>
            <Route path="/" element={<Navigate to="schools" replace />} />
            <Route path="schools" element={<SuperAdminSchoolsPage />} />
            <Route path="migration" element={<MigrationCenter />} />
            <Route path="migration/research" element={<MigrationResearch />} />
            <Route path="migration/billing-plans" element={<LiveBillingPlansImportPage />} />
            <Route path="migration/legacy" element={<SuperAdminMigrationPage />} />
            <Route path="*" element={<Navigate to="schools" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
