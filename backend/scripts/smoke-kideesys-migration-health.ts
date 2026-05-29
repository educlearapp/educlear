/**
 * Smoke test: fails when a Kid-e-Sys migrated school has broken billing links.
 *
 * Usage:
 *   npx tsx scripts/smoke-kideesys-migration-health.ts [schoolId]
 *
 * Exits 1 when:
 *   - Many learners but zero resolvable account numbers
 *   - Many accounts but all R0 while ledger/history has monetary activity
 *   - Duplicate statement account keys (payments page duplicate symptom)
 */
import "dotenv/config";

import { PrismaClient } from "@prisma/client";

import { auditKideesysMigrationHealth } from "../src/services/kideesysMigration/kideesysBillingReconciliation";

const prisma = new PrismaClient();
const schoolIdArg = process.argv[2];

const MIN_LEARNERS = Number(process.env.KIDESYS_SMOKE_MIN_LEARNERS || "50");

async function resolveSchoolId(): Promise<string> {
  const hint = String(schoolIdArg || process.env.KIDESYS_SCHOOL_ID || "").trim();
  if (hint) return hint;
  const top = await prisma.learner.groupBy({
    by: ["schoolId"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 1,
  });
  if (!top.length) throw new Error("No schoolId and no learners in DB");
  return top[0].schoolId;
}

async function main(): Promise<void> {
  const schoolId = await resolveSchoolId();
  const audit = await auditKideesysMigrationHealth(schoolId);
  const failures: string[] = [];

  if (
    audit.learnersTotal >= MIN_LEARNERS &&
    audit.learnersWithResolvableAccountNo === 0
  ) {
    failures.push(
      `${audit.learnersTotal} learners but 0 resolvable account numbers`
    );
  }

  if (
    audit.ledgerRowsTotal > 0 &&
    audit.kidesysHistoryRowsTotal > 0 &&
    audit.learnersTotal >= MIN_LEARNERS &&
    audit.nonZeroBalanceAccountCount === 0
  ) {
    failures.push(
      `${audit.learnersTotal} learners with Kid-e-Sys history but all statement balances are R0`
    );
  }

  if (audit.duplicateStatementAccountKeys > 0) {
    failures.push(
      `${audit.duplicateStatementAccountKeys} duplicate statement account key(s) (payments list duplication risk)`
    );
  }

  if (!audit.gatePassed) {
    failures.push(...audit.gateErrors);
  }

  const payload = {
    schoolId,
    passed: failures.length === 0,
    failures,
    audit: {
      learnersTotal: audit.learnersTotal,
      learnersWithResolvableAccountNo: audit.learnersWithResolvableAccountNo,
      nonZeroBalanceAccountCount: audit.nonZeroBalanceAccountCount,
      duplicateStatementAccountKeys: audit.duplicateStatementAccountKeys,
      statementRowsWithAccountDash: audit.statementRowsWithAccountDash,
    },
  };

  console.log(JSON.stringify(payload, null, 2));
  if (failures.length) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
