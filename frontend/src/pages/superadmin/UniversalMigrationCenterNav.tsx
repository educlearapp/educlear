import { Link, useLocation } from "react-router-dom";
import "./MigrationCenter.css";

export default function UniversalMigrationCenterNav({ className }: { className?: string }) {
  const location = useLocation();
  const path = location.pathname;

  const onCenter =
    path.startsWith("/super-admin/migration") &&
    !path.includes("/research") &&
    !path.includes("/legacy") &&
    !path.includes("/billing-plans") &&
    !path.includes("/learner-repair") &&
    !path.includes("/topup-payments");

  return (
    <nav
      className={`uc-migration-center-nav${className ? ` ${className}` : ""}`}
      aria-label="Migration navigation"
    >
      <Link
        to="/super-admin/migration"
        className={`uc-migration-center-nav-link${onCenter ? " uc-migration-center-nav-link--active" : ""}`}
      >
        Migration Center
      </Link>
      <Link
        to="/super-admin/migration/research"
        className={`uc-migration-center-nav-link${path.includes("/research") ? " uc-migration-center-nav-link--active" : ""}`}
      >
        Systems Registry
      </Link>
      <Link
        to="/super-admin/migration/billing-plans"
        className={`uc-migration-center-nav-link${path.includes("/billing-plans") ? " uc-migration-center-nav-link--active" : ""}`}
      >
        Billing plans import
      </Link>
      <Link
        to="/super-admin/migration/topup-payments"
        className={`uc-migration-center-nav-link${path.includes("/topup-payments") ? " uc-migration-center-nav-link--active" : ""}`}
      >
        Top-Up Payments
      </Link>
      <Link
        to="/super-admin/migration/learner-repair"
        className={`uc-migration-center-nav-link${path.includes("/learner-repair") ? " uc-migration-center-nav-link--active" : ""}`}
      >
        Learner Repair
      </Link>
      <Link
        to="/super-admin/migration/legacy"
        className={`uc-migration-center-nav-link${path.includes("/legacy") ? " uc-migration-center-nav-link--active" : ""}`}
      >
        Legacy migration
      </Link>
    </nav>
  );
}
