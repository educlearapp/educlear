/**
 * Da Silva — validate billing summary cards vs Kid-e-Sys targets.
 * Writes backend/storage/billing-summary-validation-da-silva.json
 *
 * Usage: npx ts-node scripts/validate-billing-summary-da-silva.ts [schoolId] [ageAnalysisXls]
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import {
  buildBillingSummaryValidationReport,
  buildKidesysSummaryTargetsFromAgeAnalysis,
  DA_SILVA_KIDESYS_SUMMARY_TARGETS,
} from "../src/services/billingSummary";
import { parseAgeAnalysisFileWithAudit } from "../src/services/daSilvaMigration/parsers";
import { buildAccountsFromAgeAnalysisSnapshots } from "../src/services/statementAccounts";
import { readSchoolFamilyAccountAgeAnalysisSnapshots } from "../src/utils/familyAccountAgeAnalysisStore";

const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";

function findLatestAgeAnalysisXls(): string | null {
  const roots = [
    path.join(process.cwd(), "uploads", "migration-staging", "tmp"),
    path.join(process.cwd(), "storage", "migration-staging"),
  ];
  const hits: { file: string; mtime: number }[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const ent of fs.readdirSync(root)) {
      if (!/age_analysis/i.test(ent)) continue;
      const file = path.join(root, ent);
      if (!fs.statSync(file).isFile()) continue;
      hits.push({ file, mtime: fs.statSync(file).mtimeMs });
    }
  }
  hits.sort((a, b) => b.mtime - a.mtime);
  return hits[0]?.file || null;
}

async function main() {
  const schoolId = process.argv[2]?.trim() || DA_SILVA_SCHOOL_ID;
  const xlsArg = process.argv[3]?.trim();
  const xls = xlsArg || findLatestAgeAnalysisXls();

  const accounts = await buildAccountsFromAgeAnalysisSnapshots(schoolId);
  const snapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId);

  let expectedAccountRefs: string[] = Object.keys(snapshots);
  let ageAnalysisAccountCount: number | null = null;
  let targets = DA_SILVA_KIDESYS_SUMMARY_TARGETS;
  if (xls && fs.existsSync(xls)) {
    const parsed = parseAgeAnalysisFileWithAudit(xls);
    ageAnalysisAccountCount = parsed.accounts.length;
    expectedAccountRefs = parsed.accounts.map((a) => a.accountNo);
    targets = buildKidesysSummaryTargetsFromAgeAnalysis(parsed.accounts);
  }

  const report = buildBillingSummaryValidationReport(schoolId, accounts, {
    targets,
    expectedAccountRefs,
  });

  const snapshotRefs = new Set(Object.keys(snapshots).map((r) => r.toUpperCase()));
  const parsedRefs = new Set(expectedAccountRefs.map((r) => String(r).toUpperCase()));
  const inAgeAnalysisNotInSnapshots = [...parsedRefs].filter((ref) => !snapshotRefs.has(ref));
  const inSnapshotsNotInAgeAnalysis = [...snapshotRefs].filter((ref) => !parsedRefs.has(ref));

  const extended = {
    ...report,
    ageAnalysisXls: xls,
    ageAnalysisAccountCount,
    snapshotCount: snapshotRefs.size,
    inAgeAnalysisNotInEduClearSnapshots: inAgeAnalysisNotInSnapshots,
    inEduClearSnapshotsNotInAgeAnalysis: inSnapshotsNotInAgeAnalysis,
    accountCountGapVsKidESys:
      ageAnalysisAccountCount !== null
        ? DA_SILVA_KIDESYS_SUMMARY_TARGETS.accountsCount - ageAnalysisAccountCount
        : DA_SILVA_KIDESYS_SUMMARY_TARGETS.accountsCount - report.actual.accountsCount,
  };

  const outDir = path.join(process.cwd(), "storage");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "billing-summary-validation-da-silva.json");
  fs.writeFileSync(outPath, JSON.stringify(extended, null, 2), "utf8");

  console.log(JSON.stringify({ outPath, passed: extended.passed, actual: extended.actual }, null, 2));
  await prisma.$disconnect();
  process.exit(extended.passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
