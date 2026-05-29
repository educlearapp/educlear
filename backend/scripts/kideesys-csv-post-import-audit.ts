/**
 * Post-import audit for Kid-e-Sys CSV migration.
 *
 *   npx tsx scripts/kideesys-csv-post-import-audit.ts --schoolId "..."
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";

import { auditKidESysCsvImport } from "../src/services/daSilvaMigration/kideesysCsv/kideesysCsvAudit";

const prisma = new PrismaClient();

function parseArgs(argv: string[]): { schoolId: string; source?: string; projectId?: string } {
  let schoolId = "";
  let source: string | undefined;
  let projectId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--schoolId" && argv[i + 1]) schoolId = argv[++i];
    else if (argv[i] === "--source" && argv[i + 1]) source = argv[++i];
    else if (argv[i] === "--projectId" && argv[i + 1]) projectId = argv[++i];
  }
  if (!schoolId) schoolId = String(process.env.KIDESYS_SCHOOL_ID || "").trim();
  return { schoolId, source, projectId };
}

function printAudit(audit: Awaited<ReturnType<typeof auditKidESysCsvImport>>): void {
  console.log("\n=== Kid-e-Sys CSV post-import audit ===\n");
  console.log(`School: ${audit.schoolId}`);
  console.log(`Learners: ${audit.learnersTotal}`);
  console.log(`  name populated: ${audit.namePopulatedCount}`);
  console.log(`  surname populated: ${audit.surnamePopulatedCount}`);
  console.log(`  DOB populated: ${audit.learnersWithDob}`);
  console.log(`  gender populated: ${audit.learnersWithGender}`);
  console.log(`  ID populated: ${audit.idPopulatedCount}`);
  console.log(`  classroom populated: ${audit.classroomPopulatedCount}`);
  console.log(`Parent links: ${audit.parentLinksTotal}`);
  console.log(`Family accounts: ${audit.familyAccountsCount}`);
  console.log(`Ledger invoices: ${audit.ledgerInvoiceCount}`);
  console.log(`Ledger payments: ${audit.ledgerPaymentCount}`);
  console.log(`Duplicate ledger IDs: ${audit.duplicateLedgerIds}`);
  console.log(`Statements w/ last invoice: ${audit.accountsWithLastInvoice}`);
  console.log(`Statements w/ last payment: ${audit.accountsWithLastPayment}`);
  console.log(
    `Balance reconcile: ${audit.balanceReconcilePassed} passed, ${audit.balanceReconcileFailed} failed`
  );
  if (audit.gateErrors.length) {
    console.log("\nGate errors:");
    for (const err of audit.gateErrors) console.log(`  ✗ ${err}`);
  }
  console.log(`\nAudit: ${audit.gatePassed ? "PASSED" : "FAILED"}\n`);
}

async function main(): Promise<void> {
  const { schoolId, source, projectId } = parseArgs(process.argv.slice(2));
  if (!schoolId) throw new Error("Provide --schoolId <id>");

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new Error(`School not found: ${schoolId}`);

  const audit = await auditKidESysCsvImport({ schoolId, sourcePath: source, projectId });
  printAudit(audit);

  const outPath = path.join(process.cwd(), "kideesys-csv-post-import-audit.json");
  fs.writeFileSync(outPath, JSON.stringify(audit, null, 2));
  console.log(`Report written: ${outPath}`);

  if (!audit.gatePassed) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
