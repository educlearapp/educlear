import { useCallback, useEffect, useMemo, useState } from "react";

import { apiFetch } from "../api";
import type { SchoolModuleEntitlements } from "../modules/schoolModuleEntitlements";
import {
  ANNUAL_PROMOTION_COPY,
  PACKAGE_COMPARISON_ROWS,
  type BillingInterval,
  type EduClearCommercialPackage,
  formatCommercialPackagePrice,
  listNewSaleCommercialPackages,
  packageIncludesFeature,
} from "../modules/educlearCommercialPackages";
import {
  formatCurrentPackageCard,
  isModularCheckoutAvailable,
  listUpgradeOptions,
  modularCheckoutDisabledReason,
  packageUpgradeCta,
  resolveCurrentCommercialPackageStrict,
} from "./dashboardPackagePanelLogic";
import { submitPayFastCheckout } from "./payfastCheckout";
import {
  createSubscriptionCheckout,
  fetchSchoolSubscriptionStatus,
  fetchSubscriptionConfig,
  formatSubscriptionStatus,
} from "./subscriptionsApi";

const GOLD = "#d4af37";

const cardBase: React.CSSProperties = {
  borderRadius: 16,
  padding: 22,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  background: "#fff",
  boxShadow: "0 8px 20px rgba(15, 23, 42, 0.06)",
};

type Props = {
  moduleEntitlements?: SchoolModuleEntitlements | null;
};

export default function DashboardPackagePanel({ moduleEntitlements = null }: Props) {
  const schoolId = String(localStorage.getItem("schoolId") || "").trim();
  const [entitlements, setEntitlements] = useState<SchoolModuleEntitlements | null>(
    moduleEntitlements
  );
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [schoolName, setSchoolName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showComparison, setShowComparison] = useState(false);
  const [modularCheckoutAvailable, setModularCheckoutAvailable] = useState(false);
  const [checkoutBusySku, setCheckoutBusySku] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState("");

  useEffect(() => {
    if (moduleEntitlements) setEntitlements(moduleEntitlements);
  }, [moduleEntitlements]);

  const loadData = useCallback(async () => {
    if (!schoolId) {
      setError("No school selected. Please log in again.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [statusResponse, configResponse] = await Promise.all([
        fetchSchoolSubscriptionStatus(schoolId),
        fetchSubscriptionConfig().catch(() => null),
      ]);
      setSubscriptionStatus(statusResponse?.subscription?.status ?? null);
      const name = String(statusResponse?.schoolName || "").trim();
      setSchoolName(name || null);
      setModularCheckoutAvailable(Boolean(configResponse?.modularCheckoutAvailable));

      if (!moduleEntitlements) {
        const token = String(localStorage.getItem("token") || "").trim();
        const body = (await apiFetch("/api/auth/me", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })) as {
          moduleEntitlements?: SchoolModuleEntitlements;
          school?: { moduleEntitlements?: SchoolModuleEntitlements };
        };
        const mods = body.moduleEntitlements || body.school?.moduleEntitlements || null;
        if (mods) setEntitlements(mods);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load package details");
    } finally {
      setLoading(false);
    }
  }, [schoolId, moduleEntitlements]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const current = useMemo(
    () => resolveCurrentCommercialPackageStrict(entitlements),
    [entitlements]
  );
  const upgrades = useMemo(() => listUpgradeOptions(entitlements), [entitlements]);
  const catalog = useMemo(() => listNewSaleCommercialPackages(), []);
  const currentCard = current ? formatCurrentPackageCard(current, interval) : null;
  const checkoutAvailable = isModularCheckoutAvailable(modularCheckoutAvailable);

  const handleUpgradeCheckout = useCallback(
    async (pkg: EduClearCommercialPackage) => {
      if (!checkoutAvailable || checkoutBusySku) return;
      if (!schoolId) {
        setCheckoutError("No school selected. Please log in again.");
        return;
      }
      setCheckoutError("");
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
        setCheckoutError(err instanceof Error ? err.message : "Failed to start PayFast checkout");
        setCheckoutBusySku(null);
      }
    },
    [checkoutAvailable, checkoutBusySku, interval, schoolId]
  );

  if (loading) {
    return <div style={{ padding: 24 }}>Loading package…</div>;
  }

  return (
    <div style={{ padding: "8px 4px 32px", maxWidth: 1100 }} data-testid="dashboard-package-panel">
      <h1 style={{ margin: "0 0 8px", fontSize: 28, fontWeight: 800 }}>Package</h1>
      <p style={{ margin: "0 0 20px", color: "#64748b" }}>
        Your EduClear commercial package is defined by Core, Accounting, and Payroll modules.
        School-fee Billing is included with Core — it is not an Accounting add-on.
      </p>

      {error ? (
        <div style={{ marginBottom: 16, color: "#b91c1c", fontWeight: 600 }}>{error}</div>
      ) : null}
      {checkoutError ? (
        <div style={{ marginBottom: 16, color: "#b91c1c", fontWeight: 600 }} data-testid="checkout-error">
          {checkoutError}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => setInterval("monthly")}
          style={{
            ...cardBase,
            padding: "8px 14px",
            fontWeight: 700,
            cursor: "pointer",
            borderColor: interval === "monthly" ? GOLD : undefined,
          }}
        >
          Monthly
        </button>
        <button
          type="button"
          onClick={() => setInterval("annual")}
          style={{
            ...cardBase,
            padding: "8px 14px",
            fontWeight: 700,
            cursor: "pointer",
            borderColor: interval === "annual" ? GOLD : undefined,
          }}
        >
          Annual
        </button>
      </div>

      <section
        style={{
          ...cardBase,
          marginBottom: 20,
          border: `2px solid ${GOLD}`,
          background: "linear-gradient(135deg, #fffbeb, #ffffff)",
        }}
        data-testid="current-package-card"
      >
        <div style={{ color: GOLD, fontWeight: 900, letterSpacing: 1, fontSize: 12 }}>
          CURRENT PACKAGE
        </div>
        {currentCard && current ? (
          <>
            <h2 style={{ margin: "8px 0 4px" }} data-testid="current-package-name">
              {currentCard.title}
            </h2>
            {current.secondaryLabel ? (
              <div style={{ color: "#64748b", fontWeight: 600 }}>{current.secondaryLabel}</div>
            ) : null}
            <p
              style={{ margin: "10px 0 4px", fontSize: 26, fontWeight: 800 }}
              data-testid="current-package-price"
            >
              {currentCard.priceLine}
            </p>
            {currentCard.promoLine ? (
              <p style={{ margin: "0 0 8px", color: "#047857", fontWeight: 700 }}>
                {currentCard.promoLine}
              </p>
            ) : null}
            <p style={{ margin: 0, color: "#475569" }}>{currentCard.description}</p>
            {subscriptionStatus ? (
              <p style={{ margin: "12px 0 0", fontSize: 13, color: "#64748b" }}>
                Subscription status: {formatSubscriptionStatus(subscriptionStatus as never)}
              </p>
            ) : null}
          </>
        ) : (
          <p style={{ margin: "8px 0 0", color: "#b91c1c", fontWeight: 700 }}>
            Invalid package (no commercial modules). Contact EduClear support.
          </p>
        )}
      </section>

      {current?.code === "FULL_UNLIMITED" ? (
        <p style={{ fontWeight: 700, color: "#047857" }}>
          You already have EduClear Full Unlimited — no upgrade required.
        </p>
      ) : (
        <section style={{ marginBottom: 28 }}>
          <h3 style={{ margin: "0 0 12px" }}>Upgrade options</h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 14,
            }}
          >
            {upgrades.map((pkg) => (
              <UpgradeCard
                key={pkg.code}
                pkg={pkg}
                interval={interval}
                checkoutAvailable={checkoutAvailable}
                checkoutBusy={checkoutBusySku === pkg.code}
                checkoutDisabled={Boolean(checkoutBusySku)}
                currentPackageName={current?.name || "Unknown"}
                schoolName={schoolName}
                onCheckout={() => void handleUpgradeCheckout(pkg)}
              />
            ))}
          </div>
          {!checkoutAvailable ? (
            <p
              style={{ marginTop: 14, color: "#92400e", fontWeight: 600 }}
              data-testid="modular-checkout-disabled"
            >
              {modularCheckoutDisabledReason()}
            </p>
          ) : null}
        </section>
      )}

      <button
        type="button"
        onClick={() => setShowComparison((v) => !v)}
        style={{
          marginBottom: 12,
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid rgba(15,23,42,0.14)",
          background: "#fff",
          fontWeight: 800,
          cursor: "pointer",
        }}
      >
        {showComparison ? "Hide package comparison" : "Show package comparison"}
      </button>

      {showComparison ? <PackageComparisonTable catalog={catalog} /> : null}
    </div>
  );
}

function UpgradeCard({
  pkg,
  interval,
  checkoutAvailable,
  checkoutBusy,
  checkoutDisabled,
  currentPackageName,
  schoolName,
  onCheckout,
}: {
  pkg: EduClearCommercialPackage;
  interval: BillingInterval;
  checkoutAvailable: boolean;
  checkoutBusy: boolean;
  checkoutDisabled: boolean;
  currentPackageName: string;
  schoolName?: string | null;
  onCheckout: () => void;
}) {
  const cta = packageUpgradeCta({
    checkoutAvailable,
    currentPackageName,
    requestedPackage: pkg,
    schoolName,
  });
  const buttonStyle: React.CSSProperties = {
    display: "inline-block",
    padding: "10px 14px",
    borderRadius: 10,
    border: `1px solid ${GOLD}`,
    background: "linear-gradient(135deg, #d4af37, #f5d06f)",
    fontWeight: 800,
    cursor: checkoutDisabled ? "not-allowed" : "pointer",
    color: "#111827",
    textDecoration: "none",
    textAlign: "center",
    opacity: checkoutDisabled && !checkoutBusy ? 0.65 : 1,
  };

  return (
    <div style={cardBase} data-testid={`upgrade-card-${pkg.code}`}>
      <h4 style={{ margin: "0 0 4px" }}>{pkg.name}</h4>
      {pkg.secondaryLabel ? (
        <div style={{ color: "#64748b", fontSize: 13 }}>{pkg.secondaryLabel}</div>
      ) : null}
      <p style={{ margin: "10px 0 4px", fontSize: 20, fontWeight: 800 }}>
        {formatCommercialPackagePrice(pkg, interval)}
      </p>
      {interval === "annual" ? (
        <p style={{ margin: "0 0 8px", color: "#047857", fontSize: 13, fontWeight: 700 }}>
          {ANNUAL_PROMOTION_COPY}
        </p>
      ) : null}
      <p style={{ margin: "0 0 14px", color: "#475569", fontSize: 14 }}>{pkg.description}</p>
      {cta.kind === "mailto" ? (
        <a
          href={cta.href}
          data-testid={`upgrade-contact-cta-${pkg.code}`}
          style={buttonStyle}
        >
          {cta.label}
        </a>
      ) : (
        <button
          type="button"
          data-testid={`upgrade-checkout-cta-${pkg.code}`}
          style={buttonStyle}
          disabled={checkoutDisabled}
          onClick={onCheckout}
        >
          {checkoutBusy ? "Opening PayFast…" : cta.label}
        </button>
      )}
    </div>
  );
}

function PackageComparisonTable({ catalog }: { catalog: EduClearCommercialPackage[] }) {
  const columns = catalog;
  return (
    <div style={{ overflowX: "auto", ...cardBase }} data-testid="package-comparison-table">
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: 8 }}>Feature</th>
            {columns.map((pkg) => (
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
                <div style={{ fontWeight: 700 }}>{row.feature}</div>
                <div style={{ color: "#94a3b8", fontSize: 11 }}>{row.group}</div>
                {row.note ? (
                  <div style={{ color: "#64748b", fontSize: 11 }}>{row.note}</div>
                ) : null}
              </td>
              {columns.map((pkg) => (
                <td key={pkg.code} style={{ textAlign: "center", padding: 8 }}>
                  {packageIncludesFeature(pkg, row) ? "✅" : "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
