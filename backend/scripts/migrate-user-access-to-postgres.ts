/**
 * One-time migration: legacy data/user-access.json → PostgreSQL UserRbacMeta.
 *
 * Usage:
 *   cd backend && npx tsc && node dist/scripts/migrate-user-access-to-postgres.js
 *
 * Safe to re-run: upserts from JSON; does not delete existing Postgres rows.
 */
import { prisma } from "../src/prisma";
import { migrateLegacyJsonToPostgres } from "../src/utils/userAccessStore";

async function main() {
  console.log("[migrate-user-access] Starting legacy JSON → PostgreSQL migration…");

  const before = await prisma.userRbacMeta.count();
  console.log(`[migrate-user-access] UserRbacMeta rows before: ${before}`);

  const result = await migrateLegacyJsonToPostgres();

  console.log("[migrate-user-access] Result:", result);
  console.log(
    `[migrate-user-access] Done. imported=${result.imported} skipped=${result.skipped} postgresCount=${result.postgresCount}`
  );

  const sample = await prisma.userRbacMeta.findMany({
    take: 5,
    select: { userId: true, schoolId: true, appRole: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
  });
  console.log("[migrate-user-access] Sample rows:", sample);
}

main()
  .catch((error) => {
    console.error("[migrate-user-access] FAILED:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
