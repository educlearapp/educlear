import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { fetchSchoolSubscriptionStatus } from "./subscriptionsApi";

type GateState = "loading" | "allowed" | "blocked";

/**
 * Blocks school dashboard routes until subscription status is ACTIVE in the database.
 * Da Silva and other schools unlock only when manually marked ACTIVE or after PayFast ITN.
 */
export default function SubscriptionGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const schoolId = String(localStorage.getItem("schoolId") || "").trim();
  const token = String(localStorage.getItem("token") || "").trim();
  const [gate, setGate] = useState<GateState>("loading");

  useEffect(() => {
    let cancelled = false;

    if (!token || !schoolId) {
      setGate("blocked");
      return;
    }

    setGate("loading");

    fetchSchoolSubscriptionStatus(schoolId)
      .then((response) => {
        if (cancelled) return;
        setGate(response.dashboardUnlocked ? "allowed" : "blocked");
      })
      .catch(() => {
        if (!cancelled) setGate("blocked");
      });

    return () => {
      cancelled = true;
    };
  }, [schoolId, token, location.pathname]);

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
