/**
 * Apply: create Employee rows from Da Silva STAFF users (production, employees only).
 *
 *   CONFIRM_PRODUCTION_EMPLOYEE_RESTORE=true \
 *   DATABASE_URL="postgresql://..." \
 *   npx ts-node --transpile-only scripts/employee-restore-from-staff-apply-production.ts
 */
import { config as loadDotenv } from "dotenv";
import fs from "fs";
import { PrismaClient } from "@prisma/client";

import {
  assertConfirm,
  buildEmployeeCreateData,
  CONFIRM_APPLY_ENV,
  DA_SILVA_SCHOOL_ID,
  duplicateCheck,
  loadExistingEmployees,
  loadStaffSourceRows,
  manifestDir,
  manifestPath,
  requireProductionDatabaseUrl,
  type RestoreManifest,
} from "./lib/employeeRestoreFromStaff";

loadDotenv();

async function main(): Promise<void> {
  assertConfirm(CONFIRM_APPLY_ENV);
  requireProductionDatabaseUrl();

  const batchId = String(Date.now());
  const prisma = new PrismaClient();

  try {
    const school = await prisma.school.findUnique({
      where: { id: DA_SILVA_SCHOOL_ID },
      select: { name: true },
    });
    if (!school) throw new Error(`School not found: ${DA_SILVA_SCHOOL_ID}`);

    const rows = await loadStaffSourceRows(prisma);
    const existing = await loadExistingEmployees(prisma);

    const manifest: RestoreManifest = {
      batchId,
      schoolId: DA_SILVA_SCHOOL_ID,
      schoolName: school.name,
      appliedAt: new Date().toISOString(),
      source: "staff-users",
      staffCount: rows.length,
      createdCount: 0,
      skippedCount: 0,
      createdEmployeeIds: [],
      skipped: [],
      rows: [],
    };

    for (const row of rows) {
      const check = duplicateCheck(existing, row);
      if (check.status === "skip") {
        manifest.skippedCount += 1;
        manifest.skipped.push({
          userId: row.userId,
          email: row.email,
          reason: check.reason,
          existingEmployeeId: check.existingEmployeeId,
        });
        manifest.rows.push({
          userId: row.userId,
          email: row.email,
          firstName: row.proposedFirstName,
          lastName: row.proposedLastName,
          action: "skipped",
        });
        continue;
      }

      const data = buildEmployeeCreateData(row, batchId);
      const created = await prisma.employee.create({ data });
      manifest.createdCount += 1;
      manifest.createdEmployeeIds.push(created.id);
      manifest.rows.push({
        userId: row.userId,
        email: row.email,
        firstName: row.proposedFirstName,
        lastName: row.proposedLastName,
        employeeId: created.id,
        action: "created",
      });

      existing.push({
        id: created.id,
        firstName: created.firstName,
        lastName: created.lastName,
        email: created.email,
        notes: created.notes,
      });
    }

    const dir = manifestDir(batchId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(manifestPath(batchId), JSON.stringify(manifest, null, 2), "utf8");
    fs.writeFileSync(
      `${dir}/apply-result.txt`,
      [
        "EduClear Employee Restore — Apply Result",
        `batchId: ${batchId}`,
        `school: ${school.name} (${DA_SILVA_SCHOOL_ID})`,
        `staff source rows: ${manifest.staffCount}`,
        `created Employee rows: ${manifest.createdCount}`,
        `skipped duplicates: ${manifest.skippedCount}`,
        `manifest: ${manifestPath(batchId)}`,
      ].join("\n"),
      "utf8"
    );

    console.log("Employee restore apply complete.");
    console.log(`batchId: ${batchId}`);
    console.log(`created: ${manifest.createdCount}`);
    console.log(`skipped: ${manifest.skippedCount}`);
    console.log(`manifest: ${manifestPath(batchId)}`);

    const verifyCount = await prisma.employee.count({ where: { schoolId: DA_SILVA_SCHOOL_ID } });
    console.log(`Employee table count after apply: ${verifyCount}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
