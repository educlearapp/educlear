/**
 * Kid-e-Sys canonical CSV import audit (read-only).
 *
 * Usage:
 *   npx tsx scripts/audit-kideesys-csv-import.ts [schoolId] [csvZipOrDir]
 *   npx tsx scripts/audit-kideesys-csv-import.ts [schoolId] [csvZipOrDir] --json
 *   npx tsx scripts/audit-kideesys-csv-import.ts [schoolId] --project kideesys-csv-...
 *
 * Environment:
 *   KIDESYS_CSV_SOURCE  — path to official Kid-e-Sys export ZIP or folder
 *   KIDESYS_SCHOOL_ID   — school id when omitted
 */
import "dotenv/config";

import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";

import { auditDaSilvaKidESysCsvImport } from "../src/services/daSilvaMigration/daSilvaKidESysCsvImporter";

const prisma = new PrismaClient();
const args = process.argv.slice(2).filter((a) => a !== "--json");
const jsonOut = process.argv.includes("--json");
const projectFlag = args.indexOf("--project");
const projectId =
  projectFlag >= 0 ? String(args[projectFlag + 1] || "").trim() : "";
const filteredArgs = args.filter((a, i) => a !== "--project" && (projectFlag < 0 || i !== projectFlag + 1));

async function resolveSchoolId(hint: string): Promise<string> {
  const id = String(hint || process.env.KIDESYS_SCHOOL_ID || "").trim();
  if (id) {
    const school = await prisma.school.findUnique({ where: { id }, select: { id: true } });
    if (school) return school.id;
  }
  const recent = await prisma.learner.groupBy({
    by: ["schoolId"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 1,
  });
  if (!recent.length) throw new Error("No schoolId provided and no learners in database");
  return recent[0].schoolId;
}

function printHuman(audit: Awaited<ReturnType<typeof auditDaSilvaKidESysCsvImport>>) {
  console.log("Kid-e-Sys CSV import audit");
  console.log("==========================");
  console.log(`School:  ${audit.schoolId}`);
  console.log(`At:      ${audit.auditedAt}`);
  if (audit.sourcePath) console.log(`Source:  ${audit.sourcePath}`);
  console.log("");
  console.log("CSV bundle counts:");
  console.log(`  children:          ${audit.bundleCounts.children}`);
  console.log(`  child_parent:      ${audit.bundleCounts.childParents}`);
  console.log(`  accounts:          ${audit.bundleCounts.accounts}`);
  console.log(`  invoices:          ${audit.bundleCounts.invoices}`);
  console.log(`  payments:          ${audit.bundleCounts.payments}`);
  console.log(`  journals:          ${audit.bundleCounts.journals}`);
  console.log(`  monthly_accounts:  ${audit.bundleCounts.monthlyAccounts}`);
  console.log("");
  console.log("Learners (DB):");
  console.log(`  total:             ${audit.learnersTotal}`);
  console.log(`  with DOB:          ${audit.learnersWithDob}`);
  console.log(`  with gender:       ${audit.learnersWithGender}`);
  console.log(`  with className:    ${audit.learnersWithClassName}`);
  console.log(`  with admissionNo:  ${audit.learnersWithAdmissionNo}`);
  console.log(`  with familyAcct:   ${audit.learnersWithFamilyAccountId}`);
  console.log("");
  console.log("Parents:");
  console.log(`  links total:       ${audit.parentLinksTotal}`);
  console.log(`  links resolvable:  ${audit.parentLinksResolvable}`);
  console.log("");
  console.log("Billing:");
  console.log(`  CSV ledger rows:   ${audit.ledgerCsvSourceCount}`);
  console.log(`  CSV invoices:      ${audit.ledgerInvoiceCount}`);
  console.log(`  CSV payments:      ${audit.ledgerPaymentCount}`);
  console.log(`  history rows:      ${audit.historyEntryCount}`);
  console.log(`  duplicate ids:     ${audit.duplicateLedgerIds}`);
  console.log("");
  console.log("Statements overview:");
  console.log(`  accounts w/ invoice: ${audit.accountsWithLastInvoice}`);
  console.log(`  accounts w/ payment: ${audit.accountsWithLastPayment}`);
  console.log("");
  console.log("Balance reconcile (accounts.csv vs ledger):");
  console.log(`  passed:            ${audit.balanceReconcilePassed}`);
  console.log(`  failed:            ${audit.balanceReconcileFailed}`);
  if (audit.balanceVarianceSamples.length) {
    console.log("  samples:");
    for (const row of audit.balanceVarianceSamples) {
      console.log(
        `    ${row.accountNo}: target R${row.target} ledger R${row.ledger} variance R${row.variance}`
      );
    }
  }
  console.log("");
  console.log(`Gate: ${audit.gatePassed ? "PASSED" : "FAILED"}`);
  if (audit.gateErrors.length) {
    for (const err of audit.gateErrors) console.log(`  - ${err}`);
  }
}

async function main(): Promise<void> {
  const schoolId = await resolveSchoolId(filteredArgs[0] || "");
  const sourcePath =
    String(filteredArgs[1] || process.env.KIDESYS_CSV_SOURCE || "").trim() || undefined;

  const audit = await auditDaSilvaKidESysCsvImport({
    schoolId,
    sourcePath,
    projectId: projectId || undefined,
  });

  const outPath = path.join(process.cwd(), "kideesys-csv-import-audit.json");
  fs.writeFileSync(outPath, JSON.stringify(audit, null, 2));

  if (jsonOut) {
    console.log(JSON.stringify(audit, null, 2));
  } else {
    printHuman(audit);
    console.log(`\nWrote ${outPath}`);
  }

  if (!audit.gatePassed) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
