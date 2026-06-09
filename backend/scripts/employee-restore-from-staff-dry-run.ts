/**
 * Dry-run restore report: STAFF users → Employee table (no writes).
 *
 *   DATABASE_URL="postgresql://..." \
 *   npx ts-node --transpile-only scripts/employee-restore-from-staff-dry-run.ts
 */
import { config as loadDotenv } from "dotenv";
import { PrismaClient } from "@prisma/client";

import {
  DA_SILVA_SCHOOL_ID,
  duplicateCheck,
  formatDryRunReport,
  loadExistingEmployees,
  loadStaffSourceRows,
  requireProductionDatabaseUrl,
  writeReportFile,
} from "./lib/employeeRestoreFromStaff";

loadDotenv();

async function main(): Promise<void> {
  requireProductionDatabaseUrl();
  const prisma = new PrismaClient();

  try {
    const school = await prisma.school.findUnique({
      where: { id: DA_SILVA_SCHOOL_ID },
      select: { name: true },
    });
    if (!school) throw new Error(`School not found: ${DA_SILVA_SCHOOL_ID}`);

    const rows = await loadStaffSourceRows(prisma);
    const existing = await loadExistingEmployees(prisma);

    const wouldCreate = [];
    const wouldSkip: Array<{
      row: (typeof rows)[number];
      reason: string;
      existingEmployeeId: string;
    }> = [];

    for (const row of rows) {
      const check = duplicateCheck(existing, row);
      if (check.status === "create") {
        wouldCreate.push(row);
      } else {
        wouldSkip.push({
          row,
          reason: check.reason,
          existingEmployeeId: check.existingEmployeeId,
        });
      }
    }

    const report = formatDryRunReport({
      schoolName: school.name,
      rows,
      existingCount: existing.length,
      wouldCreate,
      wouldSkip,
      xlsPhoneMatches: rows.filter((row) => Boolean(row.mobileNumber)).length,
      xlsAddressMatches: rows.filter((row) => Boolean(row.physicalAddress)).length,
    });

    const reportPath = writeReportFile("employee-restore-dry-run", report);

    console.log(report);
    console.log("");
    console.log(`Report saved: ${reportPath}`);
    console.log(`Would create: ${wouldCreate.length}`);
    console.log(`Would skip: ${wouldSkip.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
