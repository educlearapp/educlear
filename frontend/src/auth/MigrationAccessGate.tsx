import type { ReactNode } from "react";

import AccessDenied from "./AccessDenied";
import { canAccessMigration, migrationAccessDeniedDebug } from "./migrationAccess";

type Props = {
  children: ReactNode;
};

/** Migration Center — platform super admin only (same as Schools Management). */
export default function MigrationAccessGate({ children }: Props) {
  if (!canAccessMigration()) {
    const debug = migrationAccessDeniedDebug();
    return (
      <AccessDenied
        message="Access denied — Migration Center requires a platform super admin account."
        debug={debug}
      />
    );
  }

  return <>{children}</>;
}
