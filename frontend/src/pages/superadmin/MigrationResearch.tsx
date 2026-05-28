import { Link, useLocation } from "react-router-dom";
import MigrationSystemsRegistry from "../../components/migration/MigrationSystemsRegistry";
import "./MigrationResearch.css";

export default function MigrationResearch() {
  const location = useLocation();
  const onResearch = location.pathname.includes("/research");

  return (
    <div className="uc-migration-research-page">
      <header className="uc-migration-research-header">
        <h1 className="page-title">Migration Systems Registry</h1>
        <p className="uc-migration-research-subtitle">
          South African school system research and adapter readiness for the EduClear Universal Migration
          Framework. Registry only — no live imports from this view.
        </p>
      </header>

      <nav className="uc-migration-research-nav" aria-label="Migration navigation">
        <Link
          to="/super-admin/migration"
          className={`uc-migration-research-nav-link${!onResearch ? " uc-migration-research-nav-link--active" : ""}`}
        >
          Migration Center
        </Link>
        <Link
          to="/super-admin/migration/research"
          className={`uc-migration-research-nav-link${onResearch ? " uc-migration-research-nav-link--active" : ""}`}
        >
          Systems Registry
        </Link>
      </nav>

      <MigrationSystemsRegistry />
    </div>
  );
}
