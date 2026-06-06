/**
 * Read-only verification report for RBAC persistence (PostgreSQL UserRbacMeta).
 *
 * Usage:
 *   cd backend && npx tsc && node dist/scripts/verify-user-rbac-persistence.js
 *   cd backend && npx tsc && node dist/scripts/verify-user-rbac-persistence.js --schoolId=<id>
 */
import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import { getUserAccessMeta } from "../src/utils/userAccessStore";
import { resolveStoredPermissions } from "../src/utils/userPermissions";

const ACCESS_FILE = path.join(process.cwd(), "data", "user-access.json");

function countGranted(permissions: Record<string, Record<string, boolean>>): number {
  let count = 0;
  for (const mod of Object.values(permissions)) {
    for (const allowed of Object.values(mod || {})) {
      if (allowed) count += 1;
    }
  }
  return count;
}

async function main() {
  const schoolIdArg = process.argv.find((a) => a.startsWith("--schoolId="));
  const schoolIdFilter = schoolIdArg ? schoolIdArg.split("=")[1]?.trim() : "";

  const postgresCount = await prisma.userRbacMeta.count();
  const jsonExists = fs.existsSync(ACCESS_FILE);
  let jsonUserCount = 0;
  if (jsonExists) {
    try {
      const parsed = JSON.parse(fs.readFileSync(ACCESS_FILE, "utf8")) as {
        users?: Record<string, unknown>;
      };
      jsonUserCount = Object.keys(parsed.users || {}).length;
    } catch {
      jsonUserCount = -1;
    }
  }

  const where = schoolIdFilter ? { schoolId: schoolIdFilter } : {};
  const rows = await prisma.userRbacMeta.findMany({
    where,
    include: {
      user: { select: { email: true, isActive: true, role: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  const usersWithoutMeta = await prisma.user.findMany({
    where: {
      ...(schoolIdFilter ? { schoolId: schoolIdFilter } : {}),
      rbacMeta: null,
      isActive: true,
    },
    select: { id: true, email: true, schoolId: true, role: true },
    take: 20,
  });

  console.log("=== User RBAC Persistence Report ===");
  console.log(`PostgreSQL UserRbacMeta rows: ${postgresCount}`);
  console.log(`Legacy user-access.json exists: ${jsonExists} (users=${jsonUserCount})`);
  console.log(`Filtered schoolId: ${schoolIdFilter || "(all)"}`);
  console.log(`Active users missing RBAC meta: ${usersWithoutMeta.length}`);

  if (usersWithoutMeta.length) {
    console.log("\n--- Active users without saved RBAC (will use Prisma role fallback, NOT Viewer default) ---");
    for (const u of usersWithoutMeta) {
      console.log(`  ${u.id} ${u.email} schoolId=${u.schoolId} prismaRole=${u.role}`);
    }
  }

  console.log("\n--- Saved RBAC records ---");
  for (const row of rows) {
    const meta = await getUserAccessMeta(row.userId);
    const perms = resolveStoredPermissions(row.appRole, meta?.permissions || null);
    console.log(
      [
        `userId=${row.userId}`,
        `email=${row.user.email}`,
        `schoolId=${row.schoolId}`,
        `appRole=${row.appRole}`,
        `permissionsGranted=${countGranted(perms as Record<string, Record<string, boolean>>)}`,
        `updatedAt=${row.updatedAt.toISOString()}`,
        row.updatedBy ? `updatedBy=${row.updatedBy}` : null,
        row.roleChangedAt ? `roleChangedAt=${row.roleChangedAt.toISOString()}` : null,
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  const viewerOnlyFromMissingMeta = usersWithoutMeta.filter((u) => u.role === "STAFF").length;
  if (viewerOnlyFromMissingMeta > 0) {
    console.log(
      `\n[WARN] ${viewerOnlyFromMissingMeta} active STAFF user(s) have no RBAC meta — assign roles via Users page.`
    );
  } else if (!rows.length && !usersWithoutMeta.length) {
    console.log("\n[INFO] No RBAC data found for filter.");
  } else {
    console.log("\n[PASS] RBAC records loaded from PostgreSQL.");
  }
}

main()
  .catch((error) => {
    console.error("[verify-user-rbac] FAILED:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
