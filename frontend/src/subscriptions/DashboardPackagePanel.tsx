import { useCallback, useEffect, useState } from "react";

import TermsAgreementCheckbox from "../components/legal/TermsAgreementCheckbox";
import { submitPayFastCheckout } from "./payfastCheckout";
import {
  findPackageByCode,
  getPackageSwitchButtonLabel,
  isPackageSwitchDisabled,
  normalizePackageCode,
  resolveDisplayedCurrentPackage,
} from "./dashboardPackagePanelLogic";
import {
  type EduClearPackage,
  type SchoolSubscriptionStatus,
  createSubscriptionCheckout,
  fetchSchoolSubscriptionStatus,
  fetchSubscriptionConfig,
  fetchSubscriptionPackages,
  formatLearnerLimit,
  formatPackagePriceLabel,
  formatPayrollLimit,
  formatSubscriptionStatus,
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

type PackageCardProps = {
  pkg: EduClearPackage;
  currentPackageCode: string;
  subscriptionStatus: SchoolSubscriptionStatus | null;
  checkoutCode: string;
  payfastConfigured: boolean;
  termsAccepted: boolean;
  variant: "starter" | "unlimited";
  onSelect: (pkg: EduClearPackage) => void;
};

function PackageCard({
  pkg,
  currentPackageCode,
  subscriptionStatus,
  checkoutCode,
  payfastConfigured,
  termsAccepted,
  variant,
  onSelect,
}: PackageCardProps) {
  const targetCode = normalizePackageCode(pkg.code);
  const checkoutBusy = checkoutCode === targetCode;
  const disabled = isPackageSwitchDisabled(
    currentPackageCode,
    targetCode,
    subscriptionStatus,
    checkoutBusy,
    termsAccepted,
    payfastConfigured
  );
  const label = getPackageSwitchButtonLabel(
    currentPackageCode,
    targetCode,
    subscriptionStatus,
    checkoutBusy
  );
  const priceLabel = formatPackagePriceLabel(pkg);

  if (variant === "unlimited") {
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
        <div style={{ color: GOLD, fontWeight: 900, letterSpacing: "1px" }}>MOST POPULAR</div>
        <h2 style={{ margin: "8px 0 6px" }}>{pkg.name}</h2>
        <p
          style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 800, color: GOLD }}
          data-testid={`dashboard-package-price-${pkg.code}`}
        >
          {priceLabel}
        </p>
        <p style={{ color: "#d1d5db", marginTop: 8 }}>For growing and larger schools.</p>
        <div style={{ marginTop: "20px", lineHeight: 2, color: "#e5e7eb" }}>
          ✅ {formatLearnerLimit(pkg.learnerLimit)}
          <br />
          ✅ {formatPayrollLimit(pkg.payrollStaffLimit)}
          <br />
          ✅ All EduClear features
          <br />
          ✅ Priority support
        </div>
        {payfastConfigured ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSelect(pkg)}
            style={{
              ...goldBtn,
              marginTop: "24px",
              width: "100%",
              opacity: disabled ? 0.75 : 1,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            {!termsAccepted && !isPackageSwitchDisabled(currentPackageCode, targetCode, subscriptionStatus, checkoutBusy, true, payfastConfigured)
              ? "Accept Terms to Continue"
              : label}
          </button>
        ) : null}
      </div>
    );
  }

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
        style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 800, color: "#0f172a" }}
        data-testid={`dashboard-package-price-${pkg.code}`}
      >
        {priceLabel}
      </p>
      <p style={{ color: "#6b7280", marginTop: 8 }}>For smaller schools getting started.</p>
      <div style={{ marginTop: "20px", lineHeight: 2, color: "#334155" }}>
        ✅ {formatLearnerLimit(pkg.learnerLimit)}
        <br />
        ✅ {formatPayrollLimit(pkg.payrollStaffLimit)}
        <br />
        ✅ Billing, statements and payments
        <br />
        ✅ Registrations and learner records
      </div>
      {payfastConfigured ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelect(pkg)}
          style={{
            ...actionBtn,
            marginTop: "24px",
            width: "100%",
            border: `1px solid ${GOLD}`,
            background:
              isPackageSwitchDisabled(currentPackageCode, targetCode, subscriptionStatus, false, true, payfastConfigured) &&
              normalizePackageCode(currentPackageCode) === targetCode
                ? GOLD
                : "#fff",
            opacity: disabled ? 0.7 : 1,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          {!termsAccepted && !isPackageSwitchDisabled(currentPackageCode, targetCode, subscriptionStatus, checkoutBusy, true, payfastConfigured)
            ? "Accept Terms to Continue"
            : label}
        </button>
      ) : null}
    </div>
  );
}

export default function DashboardPackagePanel() {
  const schoolId = String(localStorage.getItem("schoolId") || "").trim();
  const [packages, setPackages] = useState<EduClearPackage[]>([]);
  const [currentPackageCode, setCurrentPackageCode] = useState("");
  const [subscriptionStatus, setSubscriptionStatus] = useState<SchoolSubscriptionStatus | null>(null);
  const [currentPackage, setCurrentPackage] = useState<EduClearPackage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkoutCode, setCheckoutCode] = useState("");
  const [payfastConfigured, setPayfastConfigured] = useState(true);
  const [missingPayFastEnv, setMissingPayFastEnv] = useState<string[]>([]);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const loadData = useCallback(async () => {
    if (!schoolId) {
      setError("No school selected. Please log in again.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [rows, configResponse, statusResponse] = await Promise.all([
        fetchSubscriptionPackages(),
        fetchSubscriptionConfig().catch(() => ({
          payfastConfigured: true,
          missingPayFastEnv: [] as string[],
        })),
        fetchSchoolSubscriptionStatus(schoolId),
      ]);

      setPayfastConfigured(Boolean(configResponse?.payfastConfigured));
      setMissingPayFastEnv(
        Array.isArray(configResponse?.missingPayFastEnv) ? configResponse.missingPayFastEnv : []
      );

      const sorted = [...rows].sort(
        (a, b) => packageSortOrder(a.code) - packageSortOrder(b.code)
      );
      setPackages(sorted);

      const activeCode = normalizePackageCode(statusResponse?.subscription?.packageCode);
      setCurrentPackageCode(activeCode);
      setSubscriptionStatus(statusResponse?.subscription?.status ?? null);
      setCurrentPackage(
        resolveDisplayedCurrentPackage(
          sorted,
          activeCode,
          statusResponse?.subscription?.package ?? null
        )
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load package details");
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSelect(pkg: EduClearPackage) {
    if (!agreedToTerms) {
      setError("You must agree to the EduClear Terms & Conditions before payment.");
      return;
    }

    if (!schoolId) {
      setError("Please log in again before choosing a package.");
      return;
    }

    const packageCode = normalizePackageCode(pkg.code);
    if (packageCode !== "STARTER" && packageCode !== "UNLIMITED") {
      setError("Invalid package. Choose Starter or Unlimited.");
      return;
    }

    if (
      isPackageSwitchDisabled(
        currentPackageCode,
        packageCode,
        subscriptionStatus,
        false,
        true,
        payfastConfigured
      )
    ) {
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
      setError(err instanceof Error ? err.message : "Could not start PayFast checkout");
    }
  }

  const starterPkg = findPackageByCode(packages, "STARTER");
  const unlimitedPkg = findPackageByCode(packages, "UNLIMITED");
  const statusLabel = subscriptionStatus ? formatSubscriptionStatus(subscriptionStatus) : "No subscription";

  return (
    <div style={{ padding: "32px" }}>
      <h1 className="page-title">Package</h1>
      <p style={{ color: "#475569", marginTop: "-8px" }}>
        Choose the EduClear package that matches your school size. Package changes are completed
        through PayFast when payment is confirmed.
      </p>

      {loading ? <p style={{ color: "#64748b", marginTop: 24 }}>Loading packages...</p> : null}

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
          }}
        >
          <TermsAgreementCheckbox
            checked={agreedToTerms}
            onChange={setAgreedToTerms}
            id="dashboard-package-terms"
          />
        </div>
      ) : null}

      {!loading && !payfastConfigured ? (
        <div
          style={{
            marginTop: 24,
            padding: "20px 22px",
            borderRadius: 14,
            border: "1px solid rgba(217, 119, 6, 0.35)",
            background: "rgba(255, 251, 235, 0.95)",
            color: "#92400e",
          }}
          role="status"
        >
          <p style={{ margin: "0 0 8px", fontWeight: 800 }}>
            PayFast is not configured on this server
          </p>
          <p style={{ margin: 0, lineHeight: 1.6 }}>
            {missingPayFastEnv.length
              ? `Missing: ${missingPayFastEnv.join(", ")}`
              : "PayFast environment variables are not set."}
          </p>
        </div>
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
          data-testid="dashboard-current-package-banner"
        >
          <div style={{ color: GOLD, fontWeight: 900, letterSpacing: "1px" }}>CURRENT PACKAGE</div>
          <h2 style={{ margin: "12px 0 6px" }} data-testid="dashboard-current-package-name">
            {currentPackage.name}
          </h2>
          <p style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 800, color: GOLD }}>
            {formatPackagePriceLabel(currentPackage)}
          </p>
          <p style={{ margin: "0 0 8px", color: "#d1d5db" }}>
            Status: <strong>{statusLabel}</strong>
          </p>
          <p style={{ margin: 0, color: "#d1d5db" }}>
            {formatLearnerLimit(currentPackage.learnerLimit)} •{" "}
            {formatPayrollLimit(currentPackage.payrollStaffLimit)}
          </p>
        </div>
      ) : null}

      {!loading && (starterPkg || unlimitedPkg) ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "28px",
            marginTop: "28px",
          }}
        >
          {starterPkg ? (
            <PackageCard
              pkg={starterPkg}
              currentPackageCode={currentPackageCode}
              subscriptionStatus={subscriptionStatus}
              checkoutCode={checkoutCode}
              payfastConfigured={payfastConfigured}
              termsAccepted={agreedToTerms}
              variant="starter"
              onSelect={handleSelect}
            />
          ) : null}
          {unlimitedPkg ? (
            <PackageCard
              pkg={unlimitedPkg}
              currentPackageCode={currentPackageCode}
              subscriptionStatus={subscriptionStatus}
              checkoutCode={checkoutCode}
              payfastConfigured={payfastConfigured}
              termsAccepted={agreedToTerms}
              variant="unlimited"
              onSelect={handleSelect}
            />
          ) : null}
        </div>
      ) : null}

      {!loading && packages.length === 0 ? (
        <p style={{ color: "#64748b", marginTop: 24 }}>No packages available.</p>
      ) : null}
    </div>
  );
}
