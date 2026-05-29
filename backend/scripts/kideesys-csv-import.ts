/**
 * Kid-e-Sys official CSV export — real import (idempotent).
 *
 *   npx tsx scripts/kideesys-csv-import.ts --source "/path" --schoolId "..."
 */
import "dotenv/config";

import { PrismaClient } from "@prisma/client";

import {
  printKidESysCsvDryRunReport,
  runKidESysCsvDryRun,
} from "../src/services/daSilvaMigration/kideesysCsv/kideesysCsvAudit";
import { importKidESysCsv } from "../src/services/daSilvaMigration/kideesysCsv/kideesysCsvImporter";

const prisma = new PrismaClient();

function parseArgs(argv: string[]): { source: string; schoolId: string; projectId?: string } {
  let source = "";
  let schoolId = "";
  let projectId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source" && argv[i + 1]) source = argv[++i];
    else if (argv[i] === "--schoolId" && argv[i + 1]) schoolId = argv[++i];
    else if (argv[i] === "--projectId" && argv[i + 1]) projectId = argv[++i];
  }
  if (!source) source = String(process.env.KIDESYS_CSV_SOURCE || "").trim();
  if (!schoolId) schoolId = String(process.env.KIDESYS_SCHOOL_ID || "").trim();
  return { source, schoolId, projectId };
}

async function main(): Promise<void> {
  const { source, schoolId, projectId } = parseArgs(process.argv.slice(2));
  if (!source) throw new Error("Provide --source <zipOrDir>");
  if (!schoolId) throw new Error("Provide --schoolId <id>");

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new Error(`School not found: ${schoolId}`);

  console.log(`School: ${school.name} (${school.id})`);
  console.log(`Source: ${source}`);

  const dryRun = runKidESysCsvDryRun(source);
  printKidESysCsvDryRunReport(dryRun);
  if (!dryRun.passed) {
    console.error("Dry-run failed — import aborted.");
    process.exit(1);
  }

  const result = await importKidESysCsv({
    schoolId,
    sourcePath: source,
    projectId,
    dryRun: false,
  });

  console.log("\nImported:");
  for (const [key, value] of Object.entries(result.imported)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log(`Project: ${result.projectId}`);
  if (result.backupPath) console.log(`Backup: ${result.backupPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
