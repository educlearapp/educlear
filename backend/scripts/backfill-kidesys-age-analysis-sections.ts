/**
 * Backfill Kid-e-Sys age-analysis section labels into family-account-age-analysis.json
 * (no balance / ledger changes).
 *
 * Usage:
 *   npx ts-node scripts/backfill-kidesys-age-analysis-sections.ts [schoolId] [ageAnalysisXls]
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import { normalizeKidesysBillingSection } from "../src/services/billingSummary";
import { parseAgeAnalysisFileWithAudit } from "../src/services/daSilvaMigration/parsers";
import {
  backfillKidesysSectionsInSnapshots,
  readSchoolFamilyAccountAgeAnalysisSnapshots,
} from "../src/utils/familyAccountAgeAnalysisStore";

const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";

function findLatestAgeAnalysisXls(): string {
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
  if (!hits.length) throw new Error("No age_analysis.xls found under uploads/ or storage/");
  return hits[0].file;
}

async function main() {
  const schoolId = process.argv[2]?.trim() || DA_SILVA_SCHOOL_ID;
  const xls = process.argv[3]?.trim() || findLatestAgeAnalysisXls();
  const { accounts } = parseAgeAnalysisFileWithAudit(xls);
  const sectionsByAccountRef: Record<string, string> = {};
  for (const account of accounts) {
    const ref = String(account.accountNo || "").trim().toUpperCase();
    if (!ref) continue;
    sectionsByAccountRef[ref] = normalizeKidesysBillingSection(account.section);
  }

  const before = readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId);
  const result = backfillKidesysSectionsInSnapshots(schoolId, sectionsByAccountRef);
  const after = readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId);
  const withSection = Object.values(after).filter((s) => String(s.kidesysSection || "").trim()).length;

  console.log(
    JSON.stringify(
      {
        schoolId,
        ageAnalysisXls: xls,
        parsedAccounts: accounts.length,
        snapshotsBefore: Object.keys(before).length,
        snapshotsAfter: Object.keys(after).length,
        sectionsUpdated: result.updated,
        snapshotsWithSection: withSection,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
