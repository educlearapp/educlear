import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { isSuperAdmin, SUPER_ADMIN_ENTRY_PATH } from "../auth/roles";
import { isPlatformSuperAdminEmail } from "../auth/superAdminSession";
import {
  clearSubscriptionGateCache,
  fetchSchoolSubscriptionStatus,
  getInitialSubscriptionGateState,
  isSubscriptionDashboardUnlocked,
  type SchoolSubscriptionStatus,
  type SubscriptionGateState,
} from "./subscriptionsApi";

/**
 * Blocks school dashboard routes until subscription status is ACTIVE in the database.
 * Da Silva and other schools unlock only when manually marked ACTIVE or after PayFast ITN.
 */
export default function SubscriptionGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const schoolId = String(localStorage.getItem("schoolId") || "").trim();
  const token = String(localStorage.getItem("token") || "").trim();
  const isPlatformEmailSession = isPlatformSuperAdminEmail(localStorage.getItem("userEmail"));
  const subscriptionGateExempt = isSuperAdmin() || isPlatformEmailSession;
  const [gate, setGate] = useState<SubscriptionGateState>(() =>
    subscriptionGateExempt ? "allowed" : getInitialSubscriptionGateState(schoolId)
  );
  const [blockedStatus, setBlockedStatus] = useState<SchoolSubscriptionStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (subscriptionGateExempt) {
      return;
    }

    if (!token || !schoolId) {
      setGate("blocked");
      setBlockedStatus(null);
      return;
    }

    const initial = getInitialSubscriptionGateState(schoolId);
    if (initial === "loading") {
      setGate("loading");
    }

    fetchSchoolSubscriptionStatus(schoolId)
      .then((response) => {
        if (cancelled) return;
        if (isSubscriptionDashboardUnlocked(response)) {
          clearSubscriptionGateCache();
          setGate("allowed");
          setBlockedStatus(null);
          return;
        }
        setBlockedStatus(response.subscription?.status ?? null);
        setGate("blocked");
      })
      .catch(() => {
        if (cancelled) return;
        const fallback = getInitialSubscriptionGateState(schoolId);
        if (fallback === "allowed") {
          setGate("allowed");
          setBlockedStatus(null);
          return;
        }
        setGate("blocked");
        setBlockedStatus(null);
      });

    return () => {
      cancelled = true;
    };
  }, [schoolId, token, subscriptionGateExempt]);

  if (subscriptionGateExempt) {
    return isPlatformEmailSession ? <Navigate to={SUPER_ADMIN_ENTRY_PATH} replace /> : <>{children}</>;
  }

  if (!token || !schoolId) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (gate === "loading") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#050505",
          color: "#d4af37",
          fontFamily: "Arial, sans-serif",
        }}
      >
        Checking subscription...
      </div>
    );
  }

  if (gate === "blocked") {
    if (blockedStatus === "SUSPENDED") {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            background: "#050505",
            color: "#ffffff",
            fontFamily: "Arial, sans-serif",
          }}
        >
          <div
            style={{
              width: "min(560px, 100%)",
              borderRadius: 14,
              border: "2px solid #d4af37",
              padding: "26px 22px",
              background: "#0a0a0a",
              boxShadow: "0 0 24px rgba(212, 175, 55, 0.25), 0 24px 60px rgba(0,0,0,0.5)",
            }}
          >
            <h1 style={{ margin: "0 0 12px", color: "#d4af37", fontSize: "1.35rem" }}>
              Account suspended
            </h1>
            <p style={{ margin: 0, lineHeight: 1.55, color: "rgba(255,255,255,0.85)" }}>
              Your EduClear account has been suspended. Please contact EduClear support to reactivate
              your account.
            </p>
          </div>
        </div>
      );
    }
    return <Navigate to="/subscription/packages" replace />;
  }

  return <>{children}</>;
}
