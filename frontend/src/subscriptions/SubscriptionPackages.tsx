import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { isSuperAdmin, SUPER_ADMIN_ENTRY_PATH } from "../auth/roles";
import { isPlatformSuperAdminEmail } from "../auth/superAdminSession";
import "../App.css";
import logo from "../assets/logo.png";
import TermsAgreementCheckbox from "../components/legal/TermsAgreementCheckbox";
import {
  ANNUAL_PROMOTION_COPY,
  PACKAGE_COMPARISON_ROWS,
  type BillingInterval,
  type EduClearCommercialPackage,
  formatCommercialPackagePrice,
  listNewSaleCommercialPackages,
  packageIncludesFeature,
} from "../modules/educlearCommercialPackages";
import type { SchoolModuleEntitlements } from "../modules/schoolModuleEntitlements";
import { apiFetch } from "../api";
import { BillingIntervalToggle } from "./BillingIntervalToggle";
import {
  FULL_UNLIMITED_TOP_PACKAGE_MESSAGE,
  PACKAGE_PAGE_INTRO_COPY,
  formatCurrentPackageCard,
  formatPackageCapacityDisplay,
  isModularCheckoutAvailable,
  listUpgradeOptions,
  modularCheckoutDisabledReason,
  onlinePackagePaymentsUnavailableNotice,
  packageUpgradeCta,
  resolveCurrentCommercialPackageStrict,
} from "./dashboardPackagePanelLogic";
import {
  activateSubscriptionTestMode,
  clearSubscriptionGateCache,
  createSubscriptionCheckout,
  fetchSchoolSubscriptionStatus,
  fetchSubscriptionConfig,
  isSubscriptionDashboardUnlocked,
} from "./subscriptionsApi";
import { submitPayFastCheckout } from "./payfastCheckout";

const GOLD = "#d4af37";
const INK = "#0f172a";

const goldBtn: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: "10px",
  border: "1px solid rgba(212, 175, 55, 0.7)",
  background: "linear-gradient(135deg, #d4af37, #f5d06f)",
  color: "#111827",
  boxShadow: "0 8px 18px rgba(212, 175, 55, 0.28)",
  fontWeight: 800,
  fontSize: "13px",
  cursor: "pointer",
};

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
          className="top-dashboard"
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
          <div className="section-header" onClick={() => setSchoolsOpen((open) => !open)}>
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

export default function SubscriptionPackages() {
  const navigate = useNavigate();
  const [entitlements, setEntitlements] = useState<SchoolModuleEntitlements | null>(null);
  const [dashboardUnlocked, setDashboardUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payfastConfigured, setPayfastConfigured] = useState(true);
  const [testModeAvailable, setTestModeAvailable] = useState(false);
  const [testModeBusy, setTestModeBusy] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [showComparison, setShowComparison] = useState(true);
  const [schoolName, setSchoolName] = useState<string | null>(null);
  const [modularCheckoutAvailable, setModularCheckoutAvailable] = useState(false);
  const [checkoutBusySku, setCheckoutBusySku] = useState<string | null>(null);
  const [legacyPackageCode, setLegacyPackageCode] = useState<string | null>(null);

  const catalog = useMemo(() => listNewSaleCommercialPackages(), []);
  const packageOpts = useMemo(() => ({ legacyPackageCode }), [legacyPackageCode]);
  const current = useMemo(
    () => resolveCurrentCommercialPackageStrict(entitlements, packageOpts),
    [entitlements, packageOpts]
  );
  const upgrades = useMemo(
    () => listUpgradeOptions(entitlements, packageOpts),
    [entitlements, packageOpts]
  );
  const currentCard = current ? formatCurrentPackageCard(current, interval) : null;
  const checkoutAvailable = isModularCheckoutAvailable(modularCheckoutAvailable);

  useEffect(() => {
    let cancelled = false;
    const schoolId = String(localStorage.getItem("schoolId") || "").trim();
    const token = String(localStorage.getItem("token") || "").trim();

    Promise.all([
      fetchSubscriptionConfig().catch(() => ({
        payfastConfigured: true,
        testModeAvailable: false,
        modularCheckoutAvailable: false,
        missingPayFastEnv: [] as string[],
      })),
      schoolId
        ? fetchSchoolSubscriptionStatus(schoolId).catch(() => null)
        : Promise.resolve(null),
      token
        ? apiFetch("/api/auth/me", {
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => null)
        : Promise.resolve(null),
    ])
      .then(([configResponse, statusResponse, me]) => {
        if (cancelled) return;
        setPayfastConfigured(Boolean(configResponse?.payfastConfigured));
        setTestModeAvailable(Boolean(configResponse?.testModeAvailable));
        setModularCheckoutAvailable(Boolean(configResponse?.modularCheckoutAvailable));
        // Never surface missingPayFastEnv / secret names to school users.
        const statusSchool = String(
          (statusResponse as { schoolName?: string } | null)?.schoolName || ""
        ).trim();
        setSchoolName(statusSchool || null);
        const statusPkg = String(
          (statusResponse as { subscription?: { packageCode?: string } } | null)?.subscription
            ?.packageCode || ""
        ).trim();
        setLegacyPackageCode(statusPkg || null);
        const mods =
          (me as { moduleEntitlements?: SchoolModuleEntitlements } | null)?.moduleEntitlements ||
          (me as { school?: { moduleEntitlements?: SchoolModuleEntitlements } } | null)?.school
            ?.moduleEntitlements ||
          null;
        if (mods) setEntitlements(mods);
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

  async function handleUpgradeCheckout(pkg: EduClearCommercialPackage) {
    if (!checkoutAvailable || checkoutBusySku) return;
    const schoolId = String(localStorage.getItem("schoolId") || "").trim();
    if (!schoolId) {
      setError("Please log in or register your school before continuing.");
      navigate("/login");
      return;
    }
    setError("");
    setCheckoutBusySku(pkg.code);
    try {
      const billingCycle = interval === "annual" ? "ANNUAL" : "MONTHLY";
      const result = await createSubscriptionCheckout({
        schoolId,
        sku: pkg.code,
        billingCycle,
      });
      if (!result?.paymentUrl || !result?.payload) {
        throw new Error("Checkout response incomplete");
      }
      submitPayFastCheckout(result.paymentUrl, result.payload);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start PayFast checkout");
      setCheckoutBusySku(null);
    }
  }

  async function handleTestModeActivate() {
    if (!agreedToTerms) {
      setError("You must agree to the EduClear Terms & Conditions before activating.");
      return;
    }
    const schoolId = String(localStorage.getItem("schoolId") || "").trim();
    if (!schoolId) {
      setError("Please log in or register your school before continuing.");
      navigate("/login");
      return;
    }
    setError("");
    setTestModeBusy(true);
    try {
      // Test-mode still activates legacy capacity subscription row (schema FK) — not a modular sale.
      await activateSubscriptionTestMode("UNLIMITED");
      clearSubscriptionGateCache();
      setDashboardUnlocked(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not activate test mode");
    } finally {
      setTestModeBusy(false);
    }
  }

  if (isSuperAdmin() || isPlatformSuperAdminEmail(localStorage.getItem("userEmail"))) {
    return <Navigate to={SUPER_ADMIN_ENTRY_PATH} replace />;
  }

  return (
    <SubscriptionDashboardShell
      dashboardUnlocked={dashboardUnlocked}
      onNavigateStatus={() => navigate("/subscription/status")}
      onNavigateDashboard={() => {
        if (dashboardUnlocked) navigate("/dashboard");
      }}
    >
      <div style={{ padding: "32px", maxWidth: 1100, color: INK, boxSizing: "border-box" }}>
        <h1 className="page-title" style={{ color: INK }}>
          Package
        </h1>
        <p style={{ color: "#64748b", marginTop: "-8px", lineHeight: 1.5, maxWidth: 640 }}>
          {PACKAGE_PAGE_INTRO_COPY}
        </p>

        {loading ? (
          <p style={{ color: "#64748b", marginTop: 24 }} data-testid="packages-loading">
            Loading packages...
          </p>
        ) : null}
        {error ? (
          <p style={{ color: "#b91c1c", marginTop: 24 }} role="alert">
            {error}
          </p>
        ) : null}

        {!loading ? (
          <div
            style={{
              marginTop: 24,
              padding: "16px 18px",
              borderRadius: 14,
              border: "1px solid rgba(212, 175, 55, 0.35)",
              background: "#fff",
              color: INK,
            }}
          >
            <TermsAgreementCheckbox
              checked={agreedToTerms}
              onChange={setAgreedToTerms}
              id="subscription-package-terms"
            />
          </div>
        ) : null}

        {!loading && !payfastConfigured ? (
          <div
            style={{
              marginTop: 24,
              padding: "16px 18px",
              borderRadius: 14,
              border: "1px solid rgba(148, 163, 184, 0.45)",
              background: "#fff",
              color: "#475569",
            }}
            role="status"
            data-testid="online-payments-unavailable"
          >
            <p style={{ margin: 0, fontWeight: 700, lineHeight: 1.5 }}>
              {onlinePackagePaymentsUnavailableNotice()}
            </p>
            {testModeAvailable ? (
              <button
                type="button"
                disabled={testModeBusy || !agreedToTerms}
                onClick={handleTestModeActivate}
                style={{
                  ...goldBtn,
                  marginTop: 16,
                  opacity: testModeBusy || !agreedToTerms ? 0.75 : 1,
                  cursor: testModeBusy || !agreedToTerms ? "not-allowed" : "pointer",
                }}
              >
                {testModeBusy
                  ? "Activating test mode..."
                  : !agreedToTerms
                    ? "Accept Terms to Continue"
                    : "Continue in Test Mode"}
              </button>
            ) : null}
          </div>
        ) : null}

        {!loading ? (
          <div style={{ marginTop: 20 }}>
            <BillingIntervalToggle value={interval} onChange={setInterval} />
          </div>
        ) : null}

        {!loading && currentCard && current ? (
          <div
            style={{
              background: "linear-gradient(135deg, #050505, #111827)",
              color: "#fff",
              borderRadius: "18px",
              padding: "28px",
              marginTop: "24px",
              border: "1px solid rgba(212,175,55,0.35)",
            }}
            data-testid="current-package-card"
          >
            <div style={{ color: GOLD, fontWeight: 900, letterSpacing: "1px" }}>
              CURRENT PACKAGE
            </div>
            <h2 style={{ margin: "12px 0 6px", color: "#fff" }} data-testid="current-package-name">
              {currentCard.title}
            </h2>
            <p
              style={{ margin: 0, color: "#d1d5db", fontWeight: 600 }}
              data-testid="current-package-capacity"
            >
              {currentCard.capacityLine}
            </p>
            <p
              style={{ margin: "12px 0 8px", fontSize: 22, fontWeight: 800, color: GOLD }}
              data-testid="current-package-price"
            >
              {currentCard.priceLine}
            </p>
            {interval === "annual" ? (
              <p style={{ margin: 0, color: "#86efac", fontWeight: 700 }}>{ANNUAL_PROMOTION_COPY}</p>
            ) : null}
            <p style={{ margin: "10px 0 0", color: "#d1d5db" }}>{currentCard.description}</p>
            {current.code === "FULL_UNLIMITED" ? (
              <p
                style={{ margin: "14px 0 0", color: "#86efac", fontWeight: 700 }}
                data-testid="top-package-message"
              >
                {FULL_UNLIMITED_TOP_PACKAGE_MESSAGE}
              </p>
            ) : null}
          </div>
        ) : null}

        {!loading && current?.code !== "FULL_UNLIMITED" && upgrades.length > 0 ? (
          <section style={{ marginTop: 28 }} data-testid="upgrade-options-section">
            <h3 style={{ color: INK }}>Upgrade options</h3>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 16,
                alignItems: "stretch",
              }}
            >
              {upgrades.map((pkg) => {
                const cta = packageUpgradeCta({
                  checkoutAvailable,
                  currentPackageName: current?.name || "Unknown",
                  requestedPackage: pkg,
                  schoolName,
                });
                return (
                  <div
                    key={pkg.code}
                    style={{
                      background: "#fff",
                      borderRadius: 16,
                      padding: 20,
                      border: "1px solid rgba(15,23,42,0.1)",
                      color: INK,
                      display: "flex",
                      flexDirection: "column",
                      minHeight: 220,
                      boxSizing: "border-box",
                    }}
                    data-testid={`upgrade-card-${pkg.code}`}
                  >
                    <h4 style={{ margin: "0 0 6px", color: INK }}>{pkg.name}</h4>
                    <p style={{ margin: 0, color: "#64748b", fontSize: 13, fontWeight: 600 }}>
                      {formatPackageCapacityDisplay(pkg)}
                    </p>
                    <p style={{ margin: "10px 0 8px", fontWeight: 800, color: INK }}>
                      {formatCommercialPackagePrice(pkg, interval)}
                    </p>
                    {interval === "annual" ? (
                      <p style={{ margin: "0 0 8px", color: "#047857", fontWeight: 700, fontSize: 13 }}>
                        {ANNUAL_PROMOTION_COPY}
                      </p>
                    ) : null}
                    <p style={{ margin: "0 0 12px", color: "#64748b", fontSize: 14 }}>
                      {pkg.description}
                    </p>
                    {cta.kind === "mailto" ? (
                      <a
                        href={cta.href}
                        data-testid={`upgrade-contact-cta-${pkg.code}`}
                        style={{
                          ...goldBtn,
                          display: "inline-block",
                          textDecoration: "none",
                          marginTop: "auto",
                          textAlign: "center",
                        }}
                      >
                        {cta.label}
                      </a>
                    ) : (
                      <button
                        type="button"
                        style={{
                          ...goldBtn,
                          marginTop: "auto",
                          opacity: checkoutBusySku && checkoutBusySku !== pkg.code ? 0.65 : 1,
                          cursor: checkoutBusySku ? "not-allowed" : "pointer",
                        }}
                        data-testid={`upgrade-checkout-cta-${pkg.code}`}
                        disabled={Boolean(checkoutBusySku)}
                        onClick={() => void handleUpgradeCheckout(pkg)}
                      >
                        {checkoutBusySku === pkg.code ? "Opening PayFast…" : cta.label}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {!checkoutAvailable ? (
              <p
                style={{ marginTop: 12, color: "#92400e", fontWeight: 600 }}
                data-testid="modular-checkout-disabled"
              >
                {modularCheckoutDisabledReason()}
              </p>
            ) : null}
          </section>
        ) : null}

        {!loading ? (
          <button
            type="button"
            onClick={() => setShowComparison((v) => !v)}
            style={{ ...goldBtn, marginTop: 24, background: "#fff", color: INK }}
          >
            {showComparison ? "Hide comparison" : "Show comparison"}
          </button>
        ) : null}

        {!loading && showComparison ? (
          <div
            style={{
              overflowX: "auto",
              marginTop: 16,
              background: "#fff",
              borderRadius: 16,
              padding: 12,
              color: INK,
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, color: INK }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 8 }}>Feature</th>
                  {catalog.map((pkg) => (
                    <th key={pkg.code} style={{ textAlign: "center", padding: 8 }}>
                      {pkg.shortLabel}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PACKAGE_COMPARISON_ROWS.map((row) => (
                  <tr key={row.feature} style={{ borderTop: "1px solid #e2e8f0" }}>
                    <td style={{ padding: 8 }}>
                      <strong>{row.feature}</strong>
                      <div style={{ color: "#94a3b8", fontSize: 11 }}>{row.group}</div>
                    </td>
                    {catalog.map((pkg: EduClearCommercialPackage) => (
                      <td key={pkg.code} style={{ textAlign: "center", padding: 8 }}>
                        {packageIncludesFeature(pkg, row) ? "✅" : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </SubscriptionDashboardShell>
  );
}
