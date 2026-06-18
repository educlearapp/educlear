import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { apiFetch } from "../api";
import SuperAdminLogin from "../SuperAdminLogin";
import { PLATFORM_SUPER_ADMIN_EMAIL } from "./roles";
import {
  clearSuperAdminSession,
  getSuperAdminToken,
  isPlatformSuperAdminEmail,
  setSuperAdminSessionFromAuthenticatedEmail,
} from "./superAdminSession";

type Props = {
  children: ReactNode;
};

type AuthCheck = "checking" | "allowed" | "denied";

function getAuthTokenForEmailValidation(): string {
  return String(localStorage.getItem("token") || getSuperAdminToken() || "").trim();
}

function readAuthenticatedUser(data: unknown): { email: string; userId: string } {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const user = root.user && typeof root.user === "object" ? (root.user as Record<string, unknown>) : {};
  return {
    email: String(user.email || root.email || "").trim().toLowerCase(),
    userId: String(user.id || root.userId || "").trim(),
  };
}

/** Super Admin is exclusive to the authenticated info@educlear.co.za account. */
export default function SuperAdminRouteGuard({ children }: Props) {
  const location = useLocation();
  const [authCheck, setAuthCheck] = useState<AuthCheck>("checking");

  useEffect(() => {
    let cancelled = false;

    async function validateAuthenticatedEmail() {
      const token = getAuthTokenForEmailValidation();
      let authenticatedEmail = "";
      let authenticatedUserId = "";

      if (token) {
        try {
          const data = await apiFetch("/auth/me", {
            headers: { Authorization: `Bearer ${token}` },
          });
          const user = readAuthenticatedUser(data);
          authenticatedEmail = user.email;
          authenticatedUserId = user.userId;
        } catch {
          authenticatedEmail = "";
        }
      }

      if (authenticatedEmail !== PLATFORM_SUPER_ADMIN_EMAIL) {
        clearSuperAdminSession();
        if (!cancelled) setAuthCheck("denied");
        return;
      }

      if (!isPlatformSuperAdminEmail(authenticatedEmail)) {
        clearSuperAdminSession();
        if (!cancelled) setAuthCheck("denied");
        return;
      }

      if (!setSuperAdminSessionFromAuthenticatedEmail(token, authenticatedEmail, authenticatedUserId)) {
        if (!cancelled) setAuthCheck("denied");
        return;
      }

      if (!cancelled) setAuthCheck("allowed");
    }

    void validateAuthenticatedEmail();

    return () => {
      cancelled = true;
    };
  }, []);

  if (authCheck === "checking") {
    return null;
  }

  if (authCheck === "allowed") {
    return <>{children}</>;
  }

  const returnPath = `${location.pathname}${location.search}`;

  return (
    <SuperAdminLogin
      initialStatus="Super Admin access is restricted to info@educlear.co.za."
      returnPathOverride={returnPath}
    />
  );
}
