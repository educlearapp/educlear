import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { isSuperAdmin } from "./roles";

type Props = {
  children: ReactNode;
};

/**
 * Super Admin area auth boundary — ignores school staff session.
 * Redirects to dedicated login when no super-admin session exists.
 */
export default function SuperAdminRouteGuard({ children }: Props) {
  const location = useLocation();

  if (isSuperAdmin()) {
    return <>{children}</>;
  }

  const returnPath = `${location.pathname}${location.search}`;
  const loginPath = `/super-admin/login?return=${encodeURIComponent(returnPath)}`;

  return <Navigate to={loginPath} replace />;
}
