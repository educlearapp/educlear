/**
 * Rollback: delete only Employee rows created by a staff-restore apply batch.
 * Does NOT touch User / STAFF accounts.
 *
 *   CONFIRM_PRODUCTION_EMPLOYEE_RESTORE_ROLLBACK=true \
 *   DATABASE_URL="postgresql://..." \
 *   RESTORE_BATCH_ID="1780..." \
 *   npx ts-node --transpile-only scripts/employee-restore-from-staff-rollback-production.ts
 *
 * If RESTORE_BATCH_ID is omitted, rolls back the most recent apply manifest.
 */
import { config as loadDotenv } from "dotenv";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

import {
  assertConfirm,
  CONFIRM_ROLLBACK_ENV,
  DA_SILVA_SCHOOL_ID,
  listRestoreManifests,
  manifestDir,
  readManifest,
  requireProductionDatabaseUrl,
  RESTORE_NOTE_PREFIX,
} from "./lib/employeeRestoreFromStaff";

loadDotenv();

async function main(): Promise<void> {
  assertConfirm(CONFIRM_ROLLBACK_ENV);
  requireProductionDatabaseUrl();

  const batchId =
    String(process.env.RESTORE_BATCH_ID || "").trim() ||
    listRestoreManifests()[0]?.batchId ||
    "";

  if (!batchId) {
    throw new Error("No restore batch found. Set RESTORE_BATCH_ID or run apply first.");
  }

  const manifest = readManifest(batchId);
  const prisma = new PrismaClient();

  try {
    const candidates = await prisma.employee.findMany({
      where: {
        schoolId: DA_SILVA_SCHOOL_ID,
        id: { in: manifest.createdEmployeeIds },
      },
      select: { id: true, firstName: true, lastName: true, email: true, notes: true },
    });

    const tagged = candidates.filter((row) =>
      String(row.notes || "").includes(`${RESTORE_NOTE_PREFIX}${batchId}]`)
    );

    if (tagged.length !== manifest.createdEmployeeIds.length) {
      console.warn(
        `Warning: manifest lists ${manifest.createdEmployeeIds.length} ids, tagged matches=${tagged.length}. Rolling back tagged rows only.`
      );
    }

    const deleteIds = tagged.map((row) => row.id);
    const deleted = await prisma.employee.deleteMany({
      where: { id: { in: deleteIds }, schoolId: DA_SILVA_SCHOOL_ID },
    });

    const rollbackDir = path.join(manifestDir(batchId), "rollback");
    fs.mkdirSync(rollbackDir, { recursive: true });
    fs.writeFileSync(
      path.join(rollbackDir, "rollback-result.json"),
      JSON.stringify(
        {
          batchId,
          rolledBackAt: new Date().toISOString(),
          deletedCount: deleted.count,
          deletedEmployeeIds: deleteIds,
          usersUntouched: true,
        },
        null,
        2
      ),
      "utf8"
    );

    console.log("Employee restore rollback complete.");
    console.log(`batchId: ${batchId}`);
    console.log(`deleted Employee rows: ${deleted.count}`);
    console.log(`User accounts untouched: yes`);

    const verifyCount = await prisma.employee.count({ where: { schoolId: DA_SILVA_SCHOOL_ID } });
    console.log(`Employee table count after rollback: ${verifyCount}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
