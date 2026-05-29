/**
 * Confirm the database and JSON billing stores are fully clean before Da Silva Phase 1.
 *
 * Usage:
 *   npx tsx scripts/audit-da-silva-empty-state.ts
 *   npx tsx scripts/audit-da-silva-empty-state.ts --json
 *
 * Exit 0 when empty; exit 1 when any Da Silva-linked data remains.
 */
import "dotenv/config";

import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";

import {
  auditDaSilvaEmptyState,
  collectDaSilvaSchoolIds,
  type DaSilvaEmptyStateReport,
} from "./lib/daSilvaEmptyState";

const prisma = new PrismaClient();
const WRITE_JSON = process.argv.includes("--json");

function printReport(report: DaSilvaEmptyStateReport): void {
  console.log("=== Da Silva empty-state audit ===");
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Scope school ids (${report.scopeSchoolIds.length}):`);
  for (const id of report.scopeSchoolIds) console.log(`  - ${id}`);
  console.log("\nCounts (must all be 0):");
  const c = report.counts;
  console.log(`  schools: ${c.schools}`);
  console.log(`  learners: ${c.learners}`);
  console.log(`  classrooms: ${c.classrooms}`);
  console.log(`  parents: ${c.parents}`);
  console.log(`  family accounts: ${c.familyAccounts}`);
  console.log(`  parent-learner links: ${c.parentLearnerLinks}`);
  console.log(`  billing ledger entries: ${c.billingLedgerEntries}`);
  console.log(`  billing plans (learners): ${c.billingPlanLearners}`);
  console.log(`  opening balance entries: ${c.openingBalanceEntries}`);
  console.log(`  Kid-e-Sys history rows: ${c.kidesysHistoryRows}`);
  console.log(`\nResult: ${report.passed ? "PASS — safe to start Phase 1" : "FAIL"}`);
  if (report.blockers.length) {
    console.log("\nBlockers:");
    for (const b of report.blockers) console.log(`  - ${b}`);
  }
}

async function main(): Promise<void> {
  const report = await auditDaSilvaEmptyState(prisma);
  printReport(report);

  if (WRITE_JSON) {
    const jsonOut = path.join(process.cwd(), "audit-da-silva-empty-state.json");
    const txtOut = path.join(process.cwd(), "audit-da-silva-empty-state.txt");
    fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2), "utf8");
    const lines = [
      `Da Silva empty-state audit — ${report.passed ? "PASS" : "FAIL"}`,
      `Generated: ${report.generatedAt}`,
      `Scope ids: ${report.scopeSchoolIds.join(", ")}`,
      "",
      ...Object.entries(report.counts).map(([k, v]) => `${k}: ${v}`),
      "",
      ...(report.blockers.length
        ? ["Blockers:", ...report.blockers.map((b) => `  - ${b}`)]
        : ["No blockers."]),
    ];
    fs.writeFileSync(txtOut, lines.join("\n"), "utf8");
    console.log(`\nWrote ${jsonOut}`);
    console.log(`Wrote ${txtOut}`);
  }

  if (!report.passed) {
    const ids = await collectDaSilvaSchoolIds(prisma);
    console.error(
      "\nRun a full hard delete before migration:\n" +
        "  npx tsx scripts/delete-da-silva-school.ts --apply [--schoolId <id>]"
    );
    if (ids.length) {
      console.error(`Known Da Silva school ids: ${ids.join(", ")}`);
    }
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
