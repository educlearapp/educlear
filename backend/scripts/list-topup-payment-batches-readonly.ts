/**
 * Read-only: list MigrationTopupPaymentBatch rows for Da Silva (or SCHOOL_ID).
 *
 *   cd backend && npx ts-node --transpile-only scripts/list-topup-payment-batches-readonly.ts
 *
 * Requires production DATABASE_URL on Render (not localhost).
 */
import "dotenv/config";

import { PrismaClient } from "@prisma/client";

const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
/** Da Silva production school — do not use backend/.env SCHOOL_ID (often a dev test school). */
const schoolId = String(
  process.argv.find((a) => a.startsWith("--school-id="))?.split("=")[1] ||
    process.env.DA_SILVA_SCHOOL_ID ||
    DA_SILVA_SCHOOL_ID
).trim();

const prisma = new PrismaClient();

async function main() {
  let databaseHost = "unknown";
  try {
    databaseHost =
      new URL(String(process.env.DATABASE_URL || "").replace(/^postgres(ql)?:\/\//i, "https://"))
        .hostname || "unknown";
  } catch {
    databaseHost = "invalid DATABASE_URL";
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });

  const batches = await prisma.migrationTopupPaymentBatch.findMany({
    where: { schoolId },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      schoolId: true,
      uploadedAt: true,
      rowsImported: true,
      rowsSkipped: true,
      totalAmount: true,
      sourceFilename: true,
      uploadedBy: true,
      rolledBackAt: true,
      _count: {
        select: {
          rows: true,
        },
      },
    },
  });

  const importedRowCounts = await Promise.all(
    batches.map((b) =>
      prisma.migrationTopupPaymentRow.count({
        where: { batchId: b.id, status: "imported" },
      })
    )
  );

  const list = batches.map((b, i) => ({
    batchId: b.id,
    schoolId: b.schoolId,
    uploadedAt: b.uploadedAt.toISOString(),
    rowsImported: b.rowsImported,
    rowsSkipped: b.rowsSkipped,
    totalAmount: b.totalAmount,
    importedRowCountInDb: importedRowCounts[i],
    totalRowRecords: b._count.rows,
    sourceFilename: b.sourceFilename,
    uploadedBy: b.uploadedBy,
    rolledBackAt: b.rolledBackAt?.toISOString() ?? null,
  }));

  console.log(
    JSON.stringify(
      {
        readOnly: true,
        databaseHost,
        isProductionDb: databaseHost.includes("oregon-postgres.render.com"),
        school: school ?? { id: schoolId, name: null, note: "school row not found" },
        batchCount: list.length,
        batches: list,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
