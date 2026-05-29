/**
 * Universal Kid-e-Sys billing link repair (dry-run by default).
 *
 * Usage:
 *   npx tsx scripts/reconcile-kideesys-billing-links.ts [schoolId]
 *   npx tsx scripts/reconcile-kideesys-billing-links.ts [schoolId] --apply
 *   npx tsx scripts/reconcile-kideesys-billing-links.ts [schoolId] --apply --skip-gate
 */
import "dotenv/config";

import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";

import { reconcileKideesysBillingLinks } from "../src/services/kideesysMigration/kideesysBillingReconciliation";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const skipGate = process.argv.includes("--skip-gate");
const schoolIdArg = process.argv
  .slice(2)
  .find((a) => !a.startsWith("--"));

async function resolveSchoolId(): Promise<{ id: string; name: string }> {
  const hint = String(schoolIdArg || process.env.KIDESYS_SCHOOL_ID || "").trim();
  const school =
    (hint
      ? await prisma.school.findUnique({ where: { id: hint }, select: { id: true, name: true } })
      : null) ||
    (await prisma.school.findFirst({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }));
  if (!school) throw new Error("School not found — pass schoolId");
  return school;
}

function printAudit(label: string, audit: { gatePassed: boolean; gateErrors: string[] }) {
  console.log(`${label}: gate ${audit.gatePassed ? "PASSED" : "FAILED"}`);
  if (audit.gateErrors.length) {
    for (const err of audit.gateErrors) console.log(`  - ${err}`);
  }
}

async function main(): Promise<void> {
  const school = await resolveSchoolId();
  const result = await reconcileKideesysBillingLinks({
    schoolId: school.id,
    apply,
    skipGate,
  });

  const outPath = path.join(process.cwd(), "reconcile-kideesys-billing-links.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

  const falseRemoved =
    Math.max(
      0,
      (result.auditBefore as any).activeLearnersMissingKidesysAccountRef -
        (result.auditAfter as any).activeLearnersMissingKidesysAccountRef
    ) || 0;

  console.log(`False active unresolved removed: ${falseRemoved}`);
  console.log(
    `Real active unresolved: ${(result.auditAfter as any).activeLearnersMissingKidesysAccountRef ?? 0}`
  );
  console.log(
    `FamilyAccount.accountRef based rows: ${(result.auditAfter as any).familyAccountAccountRefRows ?? 0}`
  );
  console.log(
    `SA-SAMS numeric accountRef rows ignored: ${(result.auditAfter as any).sasamsNumericAccountRefRowsIgnored ?? 0}`
  );
  console.log(`Statements with balance: ${(result.auditAfter as any).statementsWithBalance ?? 0}`);
  console.log(
    `Statements with last invoice: ${(result.auditAfter as any).statementsWithLastInvoice ?? 0}`
  );
  console.log(
    `Statements with last payment: ${(result.auditAfter as any).statementsWithLastPayment ?? 0}`
  );
  console.log(`Audit ${result.auditAfter.gatePassed ? "PASS" : "FAIL"}`);
  console.log(`\nWrote ${outPath}`);

  if (!apply) {
    console.log("\nDry run only. Re-run with --apply to persist repairs.");
    return;
  }

  if (!result.auditAfter.gatePassed && !skipGate) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
