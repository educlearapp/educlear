/**
 * Kid-e-Sys official CSV export — dry-run (zero database writes).
 *
 *   npx tsx scripts/kideesys-csv-dry-run.ts --source "/path/to/csv-folder-or.zip" --schoolId "..."
 */
import "dotenv/config";

import { PrismaClient } from "@prisma/client";

import {
  printKidESysCsvDryRunReport,
  runKidESysCsvDryRun,
} from "../src/services/daSilvaMigration/kideesysCsv/kideesysCsvAudit";

const prisma = new PrismaClient();

function parseArgs(argv: string[]): { source: string; schoolId: string } {
  let source = "";
  let schoolId = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source" && argv[i + 1]) source = argv[++i];
    else if (argv[i] === "--schoolId" && argv[i + 1]) schoolId = argv[++i];
  }
  if (!source) source = String(process.env.KIDESYS_CSV_SOURCE || "").trim();
  if (!schoolId) schoolId = String(process.env.KIDESYS_SCHOOL_ID || "").trim();
  return { source, schoolId };
}

async function main(): Promise<void> {
  const { source, schoolId } = parseArgs(process.argv.slice(2));
  if (!source) {
    throw new Error("Provide --source <zipOrDir> (or KIDESYS_CSV_SOURCE)");
  }
  if (!schoolId) {
    throw new Error("Provide --schoolId <id> (or KIDESYS_SCHOOL_ID)");
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new Error(`School not found: ${schoolId}`);

  console.log(`School: ${school.name} (${school.id})`);
  console.log(`Source: ${source}`);

  const result = runKidESysCsvDryRun(source);
  printKidESysCsvDryRunReport(result);

  if (!result.passed) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
