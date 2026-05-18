import type { ReactNode } from "react";
import AccessDenied from "./AccessDenied";
import { isSuperAdmin } from "./roles";

type Props = {
  children: ReactNode;
};

/** Renders children only for EduClear super admins; otherwise shows access denied. */
export default function SuperAdminGate({ children }: Props) {
  if (!isSuperAdmin()) {
    return <AccessDenied />;
  }

  return <>{children}</>;
}
