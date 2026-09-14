import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { isSuperAdmin, SUPER_ADMIN_ENTRY_PATH } from "../auth/roles";
import { isPlatformSuperAdminEmail } from "../auth/superAdminSession";
import logoIcon from "../assets/logo.icon.png";
import {
  type SchoolSubscriptionStatus,
  type SubscriptionStatusResponse,
  clearSubscriptionGateCache,
  fetchSchoolSubscriptionStatus,
  formatDisplayDate,
  formatSubscriptionStatus,
  isSubscriptionDashboardUnlocked,
} from "./subscriptionsApi";
import {
  isModularCheckoutAvailable,
  modularCheckoutDisabledReason,
} from "./dashboardPackagePanelLogic";

const GOLD = "#D4AF37";
const BG =
  "radial-gradient(circle at top, #151515 0%, #050505 55%, #000 100%)";

const pageShell: React.CSSProperties = {
  minHeight: "100vh",
  background: BG,
  color: "#fff",
  fontFamily: "Arial, sans-serif",
};

const header: React.CSSProperties = {
  height: 82,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 42px",
  borderBottom: "1px solid rgba(212,175,55,0.25)",
  background: "rgba(0,0,0,0.75)",
};

const main: React.CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "48px 24px 64px",
};

const summaryCard: React.CSSProperties = {
  marginTop: 32,
  borderRadius: 22,
  padding: "32px 28px",
  background:
    "linear-gradient(180deg, rgba(212,175,55,0.14) 0%, rgba(255,255,255,0.04) 100%)",
  border: "1px solid rgba(212,175,55,0.55)",
  boxShadow: "0 0 32px rgba(212,175,55,0.18), 0 24px 50px rgba(0,0,0,0.4)",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 16,
  padding: "14px 0",
  borderBottom: "1px solid rgba(212,175,55,0.18)",
};

const rowLabel: React.CSSProperties = {
  color: "#bdbdbd",
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: 1.5,
  textTransform: "uppercase",
};

const rowValue: React.CSSProperties = {
  color: "#fff",
  fontSize: 17,
  fontWeight: 700,
  textAlign: "right",
  WebkitTextFillColor: "#ffffff",
};

function statusBadgeStyle(status: SchoolSubscriptionStatus | string): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-block",
    padding: "6px 14px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: 1,
    textTransform: "uppercase",
  };

  switch (status) {
    case "ACTIVE":
      return {
        ...base,
        background: "rgba(34,197,94,0.18)",
        color: "#86efac",
        border: "1px solid rgba(134,239,172,0.45)",
      };
    case "PENDING_PAYMENT":
      return {
        ...base,
        background: "rgba(212,175,55,0.18)",
        color: GOLD,
        border: "1px solid rgba(212,175,55,0.45)",
      };
    case "PAST_DUE":
      return {
        ...base,
        background: "rgba(249,115,22,0.18)",
        color: "#fdba74",
        border: "1px solid rgba(253,186,116,0.45)",
      };
    case "SUSPENDED":
      return {
        ...base,
        background: "rgba(239,68,68,0.18)",
        color: "#fca5a5",
        border: "1px solid rgba(252,165,165,0.45)",
      };
    default:
      return {
        ...base,
        background: "rgba(148,163,184,0.18)",
        color: "#cbd5e1",
        border: "1px solid rgba(203,213,225,0.35)",
      };
  }
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={rowStyle}>
      <span style={rowLabel}>{label}</span>
      <span style={rowValue}>{value}</span>
    </div>
  );
}

export default function SubscriptionStatus() {
  const navigate = useNavigate();
  const schoolId = useMemo(
    () => String(localStorage.getItem("schoolId") || "").trim(),
    []
  );

  const [data, setData] = useState<SubscriptionStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [returnNotice, setReturnNotice] = useState("");

  const refreshStatus = useCallback(async () => {
    if (!schoolId) return;
    const response = await fetchSchoolSubscriptionStatus(schoolId);
    setData(response);
    return response;
  }, [schoolId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") === "return" || window.location.pathname.includes("/return")) {
      setReturnNotice(
        "Thanks — we are confirming your PayFast payment. This page refreshes automatically."
      );
    }
    if (params.get("payment") === "cancel" || window.location.pathname.includes("/cancel")) {
      setReturnNotice("Payment was cancelled. You can try again when ready.");
    }
  }, []);

  useEffect(() => {
    if (!schoolId) {
      setLoading(false);
      setError("No school selected. Please log in or register a school first.");
      return;
    }

    let cancelled = false;

    refreshStatus()
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load subscription status");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [schoolId, refreshStatus]);

  const subscription = data?.subscription ?? null;
  const commercial = data?.commercialPackage ?? null;
  const packageName = commercial?.name || "Not assigned";
  const displayPrice = commercial?.priceLabelMonthly || "—";
  const statusLabel = subscription
    ? formatSubscriptionStatus(subscription.status)
    : "No subscription";
  const nextPaymentDate = formatDisplayDate(subscription?.currentPeriodEnd);
  const canOpenDashboard = isSubscriptionDashboardUnlocked(data);
  const needsPayment = Boolean(
    subscription?.status === "PENDING_PAYMENT" || !canOpenDashboard
  );
  useEffect(() => {
    if (!schoolId || !needsPayment || canOpenDashboard) return;

    const intervalId = window.setInterval(() => {
      refreshStatus().catch(() => undefined);
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, [schoolId, needsPayment, canOpenDashboard, refreshStatus]);

  useEffect(() => {
    if (!canOpenDashboard) return;
    clearSubscriptionGateCache();
    setReturnNotice("Payment confirmed. Your dashboard is now unlocked.");
  }, [canOpenDashboard]);

  async function handlePayNow() {
    setError(modularCheckoutDisabledReason());
    navigate("/subscription/packages");
  }
  if (isSuperAdmin() || isPlatformSuperAdminEmail(localStorage.getItem("userEmail"))) {
    return <Navigate to={SUPER_ADMIN_ENTRY_PATH} replace />;
  }

  return (
    <div style={pageShell}>
      <header style={header}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <img
            src={logoIcon}
            alt="EduClear"
            style={{ width: 72, height: 72, objectFit: "contain" }}
          />
          <strong style={{ fontSize: 22, letterSpacing: 1 }}>EduClear</strong>
        </div>
        <Link
          to="/subscription/packages"
          style={{ color: GOLD, textDecoration: "none", fontWeight: 700 }}
        >
          View packages
        </Link>
      </header>

      <main style={main}>
        <p
          style={{
            color: GOLD,
            letterSpacing: 4,
            fontSize: 13,
            fontWeight: 800,
            marginBottom: 12,
          }}
        >
          SUBSCRIPTION STATUS
        </p>
        <h1 style={{ fontSize: 38, margin: "0 0 8px", lineHeight: 1.15, color: "#fff" }}>
          Your EduClear subscription
        </h1>
        {data?.schoolName ? (
          <p style={{ color: "#d6d6d6", margin: 0, fontSize: 16 }}>{data.schoolName}</p>
        ) : null}

        {returnNotice ? (
          <p style={{ color: GOLD, marginTop: 20, lineHeight: 1.6 }}>{returnNotice}</p>
        ) : null}

        {loading ? (
          <p style={{ color: "#bdbdbd", marginTop: 32 }}>Loading subscription...</p>
        ) : null}

        {error ? (
          <p style={{ color: "#f87171", marginTop: 32 }} role="alert">
            {error}
          </p>
        ) : null}

        {!loading && !error ? (
          <section style={summaryCard}>
            <p
              style={{
                color: GOLD,
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 3,
                margin: "0 0 20px",
                textTransform: "uppercase",
              }}
            >
              Premium summary
            </p>

            <SummaryRow label="Current package" value={packageName} />
            {commercial?.secondaryLabel ? (
              <SummaryRow label="Also known as" value={commercial.secondaryLabel} />
            ) : null}
            <SummaryRow label="Monthly fee" value={displayPrice} />
            {commercial?.description ? (
              <p style={{ color: "#d6d6d6", margin: "8px 0 0", lineHeight: 1.5, fontSize: 14 }}>
                {commercial.description}
              </p>
            ) : null}
            <div style={{ ...rowStyle, borderBottom: "none", marginTop: 8 }}>
              <span style={rowLabel}>Status</span>
              <span style={statusBadgeStyle(subscription?.status || "")}>
                {statusLabel}
              </span>
            </div>

            {nextPaymentDate ? (
              <SummaryRow label="Next payment date" value={nextPaymentDate} />
            ) : null}

            {!subscription ? (
              <p style={{ color: "#d6d6d6", marginTop: 20, lineHeight: 1.6 }}>
                No payment subscription record yet. Your commercial package above is defined by
                your EduClear modules. Online package payments are currently unavailable.
              </p>
            ) : null}

            {subscription?.status === "PENDING_PAYMENT" ? (
              <p style={{ color: "#d6d6d6", marginTop: 20, lineHeight: 1.6 }}>
                {modularCheckoutDisabledReason()}
              </p>
            ) : null}

            <div style={{ display: "flex", gap: 12, marginTop: 28, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => navigate("/subscription/packages")}
                style={{
                  padding: "12px 18px",
                  borderRadius: 12,
                  border: "1px solid rgba(212,175,55,0.55)",
                  background: "transparent",
                  color: GOLD,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                View packages
              </button>

              {needsPayment && isModularCheckoutAvailable() ? (
                <button
                  type="button"
                  onClick={handlePayNow}
                  style={{
                    padding: "12px 18px",
                    borderRadius: 12,
                    border: "none",
                    background:
                      "linear-gradient(180deg, rgba(212,175,55,0.28) 0%, rgba(212,175,55,0.12) 100%)",
                    color: GOLD,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Pay now with PayFast
                </button>
              ) : null}

              {canOpenDashboard ? (
                <button
                  type="button"
                  onClick={() => navigate("/dashboard")}
                  style={{
                    padding: "12px 18px",
                    borderRadius: 12,
                    border: "none",
                    background:
                      "linear-gradient(180deg, rgba(34,197,94,0.28) 0%, rgba(34,197,94,0.12) 100%)",
                    color: "#86efac",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Open dashboard
                </button>
              ) : null}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
