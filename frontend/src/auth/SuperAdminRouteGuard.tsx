import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { SUPER_ADMIN_ENTRY_PATH, isSuperAdmin } from "./roles";
import {
  clearSuperAdminSession,
  getCurrentAuthenticatedEmail,
  isPlatformSuperAdminEmail,
} from "./superAdminSession";

type Props = {
  children: ReactNode;
};

/**
 * Super Admin area auth boundary — ignores school staff session.
 * Redirects to dedicated login when no super-admin session exists.
 */
export default function SuperAdminRouteGuard({ children }: Props) {
  const location = useLocation();
  const currentEmail = getCurrentAuthenticatedEmail();

  if (isSuperAdmin()) {
    return <>{children}</>;
  }

  if (currentEmail && !isPlatformSuperAdminEmail(currentEmail)) {
    clearSuperAdminSession();
    return <Navigate to="/dashboard" replace />;
  }

  const hasSchoolSession = Boolean(
    localStorage.getItem("token") && localStorage.getItem("schoolId")
  );
  if (hasSchoolSession) {
    return <Navigate to="/dashboard" replace />;
  }

  const returnPath = `${location.pathname}${location.search}`;
  const loginPath = `/super-admin/login?return=${encodeURIComponent(
    returnPath || SUPER_ADMIN_ENTRY_PATH
  )}`;

  return <Navigate to={loginPath} replace />;
}
