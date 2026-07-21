/**
 * Backfill zero-balance finance baselines for active linked FamilyAccounts
 * missing from family-account-age-analysis.json.
 *
 * Usage:
 *   npx tsx scripts/backfill-finance-account-baselines.ts <schoolId>           # dry-run
 *   npx tsx scripts/backfill-finance-account-baselines.ts <schoolId> --apply   # apply
 */
import "dotenv/config";

import {
  backfillFinanceAccountBaselines,
  findMissingFinanceAccountBaselines,
} from "../src/services/financeAccountBaseline";

const apply = process.argv.includes("--apply");
const schoolId = process.argv.slice(2).find((arg) => !arg.startsWith("--"));

async function main() {
  if (!schoolId) {
    console.error("Usage: npx tsx scripts/backfill-finance-account-baselines.ts <schoolId> [--apply]");
    process.exit(1);
  }

  console.log(`\n=== Finance account baseline backfill (${apply ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`schoolId: ${schoolId}\n`);

  const preview = await findMissingFinanceAccountBaselines(schoolId);

  console.log(`Missing baseline candidates (active linked learners): ${preview.candidates.length}`);
  for (const row of preview.candidates) {
    console.log(
      `  ${row.accountRef} | familyAccountId=${row.familyAccountId} | learners=${row.activeLearnerNames.join(", ")}`
    );
  }

  console.log(`\nOrphan FamilyAccount shells (no active learners): ${preview.orphanShells.length}`);
  for (const row of preview.orphanShells) {
    console.log(
      `  ${row.accountRef} | familyAccountId=${row.familyAccountId} | created=${row.createdAt.toISOString()}`
    );
  }

  if (!apply) {
    console.log("\nDry-run complete. Re-run with --apply to insert zero-balance baselines.");
    return;
  }

  const result = await backfillFinanceAccountBaselines(schoolId, { dryRun: false });

  console.log(`\nInserted: ${result.inserted.length ? result.inserted.join(", ") : "(none)"}`);
  console.log(`Skipped (already present): ${result.skipped.length ? result.skipped.join(", ") : "(none)"}`);
  if (result.errors.length) {
    console.log("Errors:");
    for (const err of result.errors) {
      console.log(`  ${err.accountRef}: ${err.error}`);
    }
    process.exit(1);
  }

  console.log("\nBackfill complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
