import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { isSuperAdmin } from "../auth/roles";
import {
  clearSubscriptionGateCache,
  fetchSchoolSubscriptionStatus,
  getInitialSubscriptionGateState,
  isSubscriptionDashboardUnlocked,
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
  const subscriptionGateExempt = isSuperAdmin();
  const [gate, setGate] = useState<SubscriptionGateState>(() =>
    subscriptionGateExempt ? "allowed" : getInitialSubscriptionGateState(schoolId)
  );

  useEffect(() => {
    let cancelled = false;

    if (subscriptionGateExempt) {
      return;
    }

    if (!token || !schoolId) {
      setGate("blocked");
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
          return;
        }
        setGate("blocked");
      })
      .catch(() => {
        if (cancelled) return;
        const fallback = getInitialSubscriptionGateState(schoolId);
        if (fallback === "allowed") {
          setGate("allowed");
          return;
        }
        setGate("blocked");
      });

    return () => {
      cancelled = true;
    };
  }, [schoolId, token, subscriptionGateExempt]);

  if (subscriptionGateExempt) {
    return <>{children}</>;
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
    return <Navigate to="/subscription/packages" replace />;
  }

  return <>{children}</>;
}
