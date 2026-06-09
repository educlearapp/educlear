/**
 * Read-only export: Da Silva STAFF users → proposed Employee names.
 *
 *   DATABASE_URL="postgresql://..." \
 *   npx ts-node --transpile-only scripts/employee-restore-from-staff-export.ts
 */
import { config as loadDotenv } from "dotenv";
import { PrismaClient } from "@prisma/client";

import {
  DA_SILVA_SCHOOL_ID,
  formatExportReport,
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
    const report = formatExportReport(rows, school.name);
    const reportPath = writeReportFile("employee-restore-export", report);

    console.log(report);
    console.log("");
    console.log(`Report saved: ${reportPath}`);
    console.log(`STAFF rows exported: ${rows.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
