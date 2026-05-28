import type { ReactNode } from "react";

import AccessDenied from "./AccessDenied";
import { canAccessMigration, migrationAccessDeniedDebug } from "./migrationAccess";

type Props = {
  children: ReactNode;
};

/** Migration Center — platform super admin or school owner/admin only. */
export default function MigrationAccessGate({ children }: Props) {
  if (!canAccessMigration()) {
    const debug = migrationAccessDeniedDebug();
    return (
      <AccessDenied
        message="Access denied — Migration Center requires a school owner or platform admin account."
        debug={debug}
      />
    );
  }

  return <>{children}</>;
}
