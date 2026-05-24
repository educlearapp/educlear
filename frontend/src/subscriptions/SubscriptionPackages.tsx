import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import "../App.css";
import logo from "../assets/logo.png";
import {
  getPackageDisplayPrice,
  submitPayFastCheckout,
} from "./payfastCheckout";
import {
  type EduClearPackage,
  clearSubscriptionGateCache,
  createSubscriptionCheckout,
  fetchSchoolSubscriptionStatus,
  fetchSubscriptionPackages,
  formatLearnerLimit,
  formatPayrollLimit,
  isSubscriptionDashboardUnlocked,
} from "./subscriptionsApi";

const GOLD = "#d4af37";

const actionBtn: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: "10px",
  border: "1px solid rgba(15, 23, 42, 0.14)",
  background: "#ffffff",
  fontWeight: 800,
  fontSize: "13px",
  color: "#0f172a",
  boxShadow: "0 4px 10px rgba(15, 23, 42, 0.05)",
  cursor: "pointer",
};

const goldBtn: React.CSSProperties = {
  ...actionBtn,
  border: "1px solid rgba(212, 175, 55, 0.7)",
  background: "linear-gradient(135deg, #d4af37, #f5d06f)",
  color: "#111827",
  boxShadow: "0 8px 18px rgba(212, 175, 55, 0.28)",
};

function packageSortOrder(code: string): number {
  if (code === "STARTER") return 0;
  if (code === "UNLIMITED") return 1;
  return 2;
}

function SubscriptionDashboardShell({
  children,
  dashboardUnlocked,
  onNavigateStatus,
  onNavigateDashboard,
}: {
  children: React.ReactNode;
  dashboardUnlocked: boolean;
  onNavigateStatus: () => void;
  onNavigateDashboard: () => void;
}) {
  const [schoolsOpen, setSchoolsOpen] = useState(true);

  return (
    <div className="school-shell">
      <aside className="sidebar">
        <div className="brand-row">
          <img src={logo} className="sidebar-logo" alt="EduClear" />
          <span>EduClear</span>
        </div>

        <div
          className={`top-dashboard ${dashboardUnlocked ? "" : ""}`}
          onClick={onNavigateDashboard}
          style={dashboardUnlocked ? undefined : { opacity: 0.55 }}
          title={
            dashboardUnlocked
              ? "Open dashboard"
              : "Dashboard unlocks after subscription payment is confirmed"
          }
        >
          <span className="menu-icon">◉</span>
          <span>Dashboard</span>
        </div>

        <div className="main-section">
          <div
            className="section-header"
            onClick={() => setSchoolsOpen((open) => !open)}
          >
            <div className="section-left">
              <span className="menu-icon">🏫</span>
              <span>Schools</span>
            </div>
            <span className={`chevron ${schoolsOpen ? "open" : ""}`}>⌄</span>
          </div>

          {schoolsOpen ? (
            <div className="submenu">
              <div className="submenu-item active">Package</div>
              <div className="submenu-item" onClick={onNavigateStatus}>
                Subscription status
              </div>
            </div>
          ) : null}
        </div>

        <div className="bottom-section">
          <div className="sidebar-collapse">≪</div>
        </div>
      </aside>

      <main
        className="main-content"
        style={{
          flex: 1,
          width: "100%",
          minWidth: 0,
          display: "flex",
          alignItems: "stretch",
          boxSizing: "border-box",
          padding: 0,
          background: "#f7f4ef",
        }}
      >
        <div
          className="page-area"
          style={{
            flex: 1,
            width: "100%",
            minWidth: 0,
            maxWidth: "none",
            display: "block",
            boxSizing: "border-box",
          }}
        >
          {children}
        </div>
      </main>
    </div>
  );
}

function StarterPackageCard({
  pkg,
  isCurrent,
  checkoutBusy,
  onSelect,
}: {
  pkg: EduClearPackage;
  isCurrent: boolean;
  checkoutBusy: boolean;
  onSelect: (pkg: EduClearPackage) => void;
}) {
  const displayPrice = getPackageDisplayPrice(pkg.code);

  return (
    <div
      style={{
        background: "#fff",
        borderRadius: "18px",
        padding: "28px",
        border: "1px solid rgba(15,23,42,0.08)",
        boxShadow: "0 12px 30px rgba(15,23,42,0.08)",
      }}
    >
      <h2 style={{ margin: "0 0 6px" }}>{pkg.name}</h2>
      <p
        style={{
          margin: "0 0 4px",
          fontSize: 24,
          fontWeight: 800,
          color: "#0f172a",
        }}
        data-testid={`package-price-${pkg.code}`}
        aria-label={`${pkg.name} monthly price`}
      >
        {displayPrice}
      </p>
      <p style={{ color: "#6b7280", marginTop: 8 }}>
        For smaller schools getting started.
      </p>
      <div style={{ marginTop: "20px", lineHeight: 2, color: "#334155" }}>
        ✅ {formatLearnerLimit(pkg.learnerLimit)}
        <br />
        ✅ {formatPayrollLimit(pkg.payrollStaffLimit)}
        <br />
        ✅ Billing, statements and payments
        <br />
        ✅ Registrations and learner records
      </div>
      <button
        type="button"
        disabled={checkoutBusy || isCurrent}
        onClick={() => onSelect(pkg)}
        style={{
          ...actionBtn,
          marginTop: "24px",
          width: "100%",
          border: `1px solid ${GOLD}`,
          background: isCurrent ? GOLD : "#fff",
          opacity: checkoutBusy ? 0.7 : 1,
          cursor: checkoutBusy ? "wait" : isCurrent ? "default" : "pointer",
        }}
      >
        {checkoutBusy
          ? "Opening PayFast..."
          : isCurrent
            ? "Current Package"
            : "Pay with PayFast — Starter"}
      </button>
    </div>
  );
}

function UnlimitedPackageCard({
  pkg,
  isCurrent,
  checkoutBusy,
  onSelect,
}: {
  pkg: EduClearPackage;
  isCurrent: boolean;
  checkoutBusy: boolean;
  onSelect: (pkg: EduClearPackage) => void;
}) {
  const displayPrice = getPackageDisplayPrice(pkg.code);

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #050505, #111827)",
        color: "#fff",
        borderRadius: "18px",
        padding: "28px",
        border: `2px solid ${GOLD}`,
        boxShadow: "0 18px 40px rgba(212,175,55,0.18)",
      }}
    >
      <div style={{ color: GOLD, fontWeight: 900, letterSpacing: "1px" }}>
        MOST POPULAR
      </div>
      <h2 style={{ margin: "8px 0 6px" }}>{pkg.name}</h2>
      <p
        style={{
          margin: "0 0 4px",
          fontSize: 24,
          fontWeight: 800,
          color: GOLD,
        }}
        data-testid={`package-price-${pkg.code}`}
        aria-label={`${pkg.name} monthly price`}
      >
        {displayPrice}
      </p>
      <p style={{ color: "#d1d5db", marginTop: 8 }}>
        For growing and larger schools.
      </p>
      <div style={{ marginTop: "20px", lineHeight: 2, color: "#e5e7eb" }}>
        ✅ {formatLearnerLimit(pkg.learnerLimit)}
        <br />
        ✅ {formatPayrollLimit(pkg.payrollStaffLimit)}
        <br />
        ✅ All EduClear features
        <br />
        ✅ Priority support
      </div>
      <button
        type="button"
        disabled={checkoutBusy || isCurrent}
        onClick={() => onSelect(pkg)}
        style={{
          ...goldBtn,
          marginTop: "24px",
          width: "100%",
          opacity: checkoutBusy || isCurrent ? 0.75 : 1,
          cursor: checkoutBusy ? "wait" : isCurrent ? "default" : "pointer",
        }}
      >
        {checkoutBusy
          ? "Opening PayFast..."
          : isCurrent
            ? "Current Package"
            : "Pay with PayFast — Unlimited"}
      </button>
    </div>
  );
}

export default function SubscriptionPackages() {
  const navigate = useNavigate();
  const [packages, setPackages] = useState<EduClearPackage[]>([]);
  const [currentPackageCode, setCurrentPackageCode] = useState("");
  const [dashboardUnlocked, setDashboardUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkoutCode, setCheckoutCode] = useState("");

  useEffect(() => {
    let cancelled = false;
    const schoolId = String(localStorage.getItem("schoolId") || "").trim();

    Promise.all([
      fetchSubscriptionPackages(),
      schoolId
        ? fetchSchoolSubscriptionStatus(schoolId).catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([rows, statusResponse]) => {
        if (cancelled) return;
        setPackages(
          [...rows].sort(
            (a, b) => packageSortOrder(a.code) - packageSortOrder(b.code)
          )
        );
        const activeCode = statusResponse?.subscription?.packageCode;
        if (activeCode) {
          setCurrentPackageCode(String(activeCode).trim().toUpperCase());
        }
        if (isSubscriptionDashboardUnlocked(statusResponse)) {
          clearSubscriptionGateCache();
          setDashboardUnlocked(true);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load packages");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!dashboardUnlocked) return;
    clearSubscriptionGateCache();
    navigate("/dashboard", { replace: true });
  }, [dashboardUnlocked, navigate]);

  async function handleSelect(pkg: EduClearPackage) {
    const schoolId = String(localStorage.getItem("schoolId") || "").trim();
    if (!schoolId) {
      setError("Please log in or register your school before choosing a package.");
      navigate("/login");
      return;
    }

    const packageCode = String(pkg.code || "").trim().toUpperCase();
    if (packageCode !== "STARTER" && packageCode !== "UNLIMITED") {
      setError("Invalid package. Choose Starter or Unlimited.");
      return;
    }

    setError("");
    setCheckoutCode(packageCode);
    localStorage.setItem("educlearSelectedPackageCode", packageCode);

    try {
      const payerEmail = String(localStorage.getItem("userEmail") || "").trim();
      const result = await createSubscriptionCheckout({
        schoolId,
        packageCode,
        payerEmail: payerEmail || undefined,
      });

      if (!result?.paymentUrl || !result?.payload) {
        throw new Error("PayFast checkout response was incomplete");
      }

      submitPayFastCheckout(result.paymentUrl, result.payload);
    } catch (err: unknown) {
      setCheckoutCode("");
      setError(
        err instanceof Error ? err.message : "Could not start PayFast checkout"
      );
    }
  }

  const currentPackage =
    packages.find((pkg) => pkg.code === currentPackageCode) ?? null;
  const currentBannerPrice = currentPackage
    ? getPackageDisplayPrice(currentPackage.code)
    : getPackageDisplayPrice(currentPackageCode);
  const starterPkg = packages.find((pkg) => pkg.code === "STARTER");
  const unlimitedPkg = packages.find((pkg) => pkg.code === "UNLIMITED");

  return (
    <SubscriptionDashboardShell
      dashboardUnlocked={dashboardUnlocked}
      onNavigateStatus={() => navigate("/subscription/status")}
      onNavigateDashboard={() => {
        if (dashboardUnlocked) navigate("/dashboard");
      }}
    >
      <div style={{ padding: "32px" }}>
        <h1 className="page-title">Package</h1>
        <p style={{ color: "#475569", marginTop: "-8px" }}>
          Choose the EduClear package that matches your school size. Pay securely
          through PayFast — your dashboard unlocks when payment is confirmed.
        </p>

        {loading ? (
          <p style={{ color: "#64748b", marginTop: 24 }}>Loading packages...</p>
        ) : null}

        {error ? (
          <p style={{ color: "#b91c1c", marginTop: 24 }} role="alert">
            {error}
          </p>
        ) : null}

        {!loading && currentPackage ? (
          <div
            style={{
              background: "linear-gradient(135deg, #050505, #111827)",
              color: "#fff",
              borderRadius: "18px",
              padding: "28px",
              marginTop: "24px",
              border: "1px solid rgba(212,175,55,0.35)",
            }}
          >
            <div style={{ color: GOLD, fontWeight: 900, letterSpacing: "1px" }}>
              CURRENT PACKAGE
            </div>
            <h2 style={{ margin: "12px 0 6px" }}>{currentPackage.name}</h2>
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 20,
                fontWeight: 800,
                color: GOLD,
              }}
              data-testid="current-package-price"
            >
              {currentBannerPrice}
            </p>
            <p style={{ margin: 0, color: "#d1d5db" }}>
              {formatLearnerLimit(currentPackage.learnerLimit)} •{" "}
              {formatPayrollLimit(currentPackage.payrollStaffLimit)}
            </p>
          </div>
        ) : null}

        {!loading && !error && (starterPkg || unlimitedPkg) ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "28px",
              marginTop: "28px",
            }}
          >
            {starterPkg ? (
              <StarterPackageCard
                pkg={starterPkg}
                isCurrent={currentPackageCode === "STARTER"}
                checkoutBusy={checkoutCode === "STARTER"}
                onSelect={handleSelect}
              />
            ) : null}
            {unlimitedPkg ? (
              <UnlimitedPackageCard
                pkg={unlimitedPkg}
                isCurrent={currentPackageCode === "UNLIMITED"}
                checkoutBusy={checkoutCode === "UNLIMITED"}
                onSelect={handleSelect}
              />
            ) : null}
          </div>
        ) : null}

        {!loading && !error && packages.length === 0 ? (
          <p style={{ color: "#64748b", marginTop: 24 }}>No packages available.</p>
        ) : null}
      </div>
    </SubscriptionDashboardShell>
  );
}
