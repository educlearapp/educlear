/**
 * Kid-e-Sys migration billing health audit (read-only).
 *
 * Usage:
 *   npx tsx scripts/audit-kideesys-migration-health.ts [schoolId]
 *   npx tsx scripts/audit-kideesys-migration-health.ts [schoolId] --json
 */
import "dotenv/config";

import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";

import { auditKideesysMigrationHealth } from "../src/services/kideesysMigration/kideesysBillingReconciliation";

const prisma = new PrismaClient();
const jsonOut = process.argv.includes("--json");
const schoolIdArg = process.argv.slice(2).find((a) => a !== "--json");

async function resolveSchoolId(): Promise<string> {
  const hint = String(schoolIdArg || process.env.KIDESYS_SCHOOL_ID || "").trim();
  if (hint) {
    const school = await prisma.school.findUnique({ where: { id: hint }, select: { id: true } });
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

function printHuman(audit: Awaited<ReturnType<typeof auditKideesysMigrationHealth>>) {
  console.log("Kid-e-Sys migration health audit");
  console.log("================================");
  console.log(`School: ${audit.schoolId}`);
  console.log(`At:     ${audit.auditedAt}`);
  console.log("");
  console.log(`Learners total:                    ${audit.learnersTotal}`);
  console.log(`Learners with admissionNo:         ${audit.learnersWithAdmissionNo}`);
  console.log(`Learners with resolvable accountNo: ${audit.learnersWithResolvableAccountNo}`);
  console.log(`Learners with familyAccountId:     ${audit.learnersWithFamilyAccountId}`);
  console.log(`Active learners missing account:   ${audit.activeLearnersMissingAccountWhenSourceHas}`);
  console.log("");
  console.log(`Family accounts total:             ${audit.familyAccountsTotal}`);
  console.log(`Family accounts linked:            ${audit.familyAccountsLinkedToLearners}`);
  console.log(`Family accounts orphaned:          ${audit.familyAccountsOrphaned}`);
  console.log("");
  console.log(`Ledger / history rows total:       ${audit.ledgerRowsTotal}`);
  console.log(`Ledger linked by accountNo:        ${audit.ledgerRowsLinkedByAccountNo}`);
  console.log(`Ledger linked by learnerId:        ${audit.ledgerRowsLinkedByLearnerId}`);
  console.log(`Ledger unresolvable:               ${audit.ledgerRowsUnresolvable}`);
  console.log(`Kid-e-Sys history rows:            ${audit.kidesysHistoryRowsTotal}`);
  console.log("");
  console.log(`Statement rows accountNo "-":      ${audit.statementRowsWithAccountDash}`);
  console.log(`Duplicate statement account keys:  ${audit.duplicateStatementAccountKeys}`);
  console.log(`Duplicate payment ledger ids:      ${audit.duplicatePaymentLedgerIds}`);
  console.log(`Accounts with non-zero balance:    ${audit.nonZeroBalanceAccountCount}`);
  console.log(`Source account numbers in bundle:  ${audit.sourceAccountNumbersInBundle}`);
  if (audit.ageAnalysisParseAudit) {
    const pa = audit.ageAnalysisParseAudit;
    console.log("");
    console.log("Age Analysis parser audit (from staging bundle):");
    console.log(`  Rows parsed:              ${pa.ageAnalysisRowsParsed}`);
    console.log(`  Account numbers parsed:   ${pa.accountNumbersParsed}`);
    console.log(`  Learners matched:         ${pa.learnersMatchedFromAgeAnalysis ?? "n/a"}`);
    console.log(`  Learners not matched:     ${pa.learnersNotMatchedFromAgeAnalysis ?? "n/a"}`);
    console.log(`  Multi-learner accounts:   ${pa.accountsWithMultipleLearners}`);
  }
  console.log("");
  console.log(`Completion gate: ${audit.gatePassed ? "PASSED" : "FAILED"}`);
  if (audit.gateErrors.length) {
    console.log("Gate errors:");
    for (const err of audit.gateErrors) console.log(`  - ${err}`);
  }
  if (audit.brokenSamples.length) {
    console.log("");
    console.log("Sample broken rows:");
    for (const sample of audit.brokenSamples) {
      console.log(
        `  [${sample.kind}] ${sample.reason}` +
          (sample.id ? ` (id=${sample.id})` : "") +
          (sample.accountNo ? ` accountNo=${sample.accountNo}` : "")
      );
    }
  }
}

async function main(): Promise<void> {
  const schoolId = await resolveSchoolId();
  const audit = await auditKideesysMigrationHealth(schoolId);

  const outPath = path.join(process.cwd(), "kideesys-migration-health-audit.json");
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
