/**
 * Kid-e-Sys reports (Tony exports) — billing-only import (localhost).
 *
 * Order:
 *  1) Age Analysis → FamilyAccount + age-analysis snapshot store
 *  2) Billing Plans → learner-billing-plans.json
 *  3) Transactions → billing-ledger.json (invoices/payments/journals)
 *  4) Employees → Employee table
 *
 * Dry-run always runs first. Import aborts if dry-run fails.
 *
 * Usage:
 *   npx tsx scripts/kideesys-reports-import.ts --schoolId "..." \
 *     --age "/abs/02_age_analysis.xls" \
 *     --plans "/abs/03_billing_plan.xls" \
 *     --tx "/abs/01_transactions.xls" \
 *     --employees "/abs/06_employees.xls"
 */
import "dotenv/config";

import { PrismaClient } from "@prisma/client";

import { kideesysReportsImportAndAudit } from "../src/services/kideesysReportsBillingImport";

const prisma = new PrismaClient();

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!k || !k.startsWith("--")) continue;
    if (v && !v.startsWith("--")) {
      out[k.slice(2)] = v;
      i += 1;
    } else {
      out[k.slice(2)] = "true";
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const schoolId = String(args.schoolId || process.env.KIDESYS_SCHOOL_ID || "").trim();
  const age = String(args.age || "").trim();
  const plans = String(args.plans || "").trim();
  const tx = String(args.tx || "").trim();
  const employees = String(args.employees || "").trim();

  if (!schoolId) throw new Error("Provide --schoolId <id> (or KIDESYS_SCHOOL_ID)");
  if (!age || !plans || !tx || !employees) {
    throw new Error("Provide --age, --plans, --tx, and --employees (absolute .xls paths)");
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new Error(`School not found: ${schoolId}`);

  const result = await kideesysReportsImportAndAudit({
    schoolId,
    paths: {
      ageAnalysisXls: age,
      billingPlanXls: plans,
      transactionsXls: tx,
      employeesXls: employees,
    },
    dryRun: false,
  });

  if (!result.dryRun.passed) {
    console.log("Dry run FAIL");
    for (const issue of result.dryRun.issues) console.log(`- ${issue}`);
    process.exit(1);
  }

  console.log("Dry run PASS");
  if (!result.import) {
    console.log("Import skipped");
    return;
  }

  const imp = result.import;
  console.log(`Accounts imported: ${imp.imported.accounts}`);
  console.log(`Billing plans imported: ${imp.imported.billingPlans}`);
  console.log(`Invoices imported: ${imp.imported.invoices}`);
  console.log(`Payments imported: ${imp.imported.payments}`);
  console.log(`Journals imported: ${imp.imported.journals}`);
  console.log(`Employees imported: ${imp.imported.employees}`);
  console.log(`Statements with balance: ${imp.statements.withBalance}`);
  console.log(`Statements with last invoice: ${imp.statements.withLastInvoice}`);
  console.log(`Statements with last payment: ${imp.statements.withLastPayment}`);
  console.log(`Unmatched accounts: ${imp.unmatchedAccounts}`);
  console.log(`Audit ${imp.auditPassed ? "PASS" : "FAIL"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

