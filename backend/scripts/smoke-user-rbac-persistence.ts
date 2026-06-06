/**
 * Smoke test: RBAC save → read persistence via PostgreSQL (no JSON).
 *
 * Usage:
 *   cd backend && npx tsx scripts/smoke-user-rbac-persistence.ts --userId=<id>
 */
import "dotenv/config";

import { prisma } from "../src/prisma";
import { getUserAccessMeta, setUserAccessMeta } from "../src/utils/userAccessStore";
import { mergePermissions, permissionsForRole, resolveStoredPermissions } from "../src/utils/userPermissions";
import type { PermissionMap } from "../src/utils/userPermissions";

function countGranted(permissions: PermissionMap): number {
  let count = 0;
  for (const mod of Object.values(permissions)) {
    for (const allowed of Object.values(mod || {})) {
      if (allowed) count += 1;
    }
  }
  return count;
}

async function main() {
  const userIdArg = process.argv.find((a) => a.startsWith("--userId="));
  const userId = userIdArg?.split("=")[1]?.trim();
  if (!userId) {
    console.error("Usage: npx tsx scripts/smoke-user-rbac-persistence.ts --userId=<id>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, schoolId: true, role: true },
  });
  if (!user) {
    console.error(`User not found: ${userId}`);
    process.exit(1);
  }

  const before = await getUserAccessMeta(userId);
  console.log("[smoke-rbac] before:", {
    userId,
    email: user.email,
    appRole: before?.appRole,
    permissionsGranted: before ? countGranted(before.permissions) : 0,
  });

  const adminBase = permissionsForRole("Admin");
  const custom = mergePermissions(adminBase);
  custom.users = { ...custom.users, delete: true };
  custom.settings = { ...custom.settings, delete: true };

  await setUserAccessMeta(userId, {
    schoolId: user.schoolId,
    firstName: before?.firstName || "RBAC",
    surname: before?.surname || "SmokeTest",
    appRole: "Admin",
    permissions: custom,
    lastLoginAt: before?.lastLoginAt || null,
  });

  await prisma.user.update({
    where: { id: userId },
    data: { role: "SCHOOL_ADMIN" },
  });

  const afterSave = await getUserAccessMeta(userId);
  const resolved = resolveStoredPermissions("Admin", afterSave?.permissions || null);

  console.log("[smoke-rbac] after save:", {
    appRole: afterSave?.appRole,
    permissionsGranted: countGranted(resolved),
    usersDelete: resolved.users?.delete,
    settingsDelete: resolved.settings?.delete,
    updatedAt: afterSave?.updatedAt,
    roleChangedAt: afterSave?.roleChangedAt,
  });

  const pass =
    afterSave?.appRole === "Admin" &&
    resolved.users?.delete === true &&
    resolved.settings?.delete === true;

  if (!pass) {
    console.error("[smoke-rbac] FAIL — saved role/permissions did not round-trip");
    process.exit(1);
  }

  console.log("[smoke-rbac] PASS — Admin role + custom permissions persisted in PostgreSQL");

  if (before) {
    await setUserAccessMeta(userId, before);
    console.log("[smoke-rbac] restored original RBAC for user");
  }
}

main()
  .catch((error) => {
    console.error("[smoke-rbac] FAILED:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
