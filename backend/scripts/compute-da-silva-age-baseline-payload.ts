/**
 * Compute Da Silva exact age-analysis baseline payload from latest Kid-e-Sys export.
 * No proportional scaling — each account uses the parsed Age Analysis balance.
 *
 *   npx ts-node --transpile-only scripts/compute-da-silva-age-baseline-payload.ts
 *   npx ts-node --transpile-only scripts/compute-da-silva-age-baseline-payload.ts --apply
 */
import fs from "fs";
import path from "path";

import {
  buildExactAgeAnalysisSnapshots,
  compareExactAgeAnalysisBalances,
  DA_SILVA_AGE_BASELINE_IMPORTED_AT,
} from "../src/services/migrationCentre/ageAnalysisExactBaseline";
import { buildAccountsFromAgeAnalysisSnapshots } from "../src/services/statementAccounts";
import { upsertSchoolFamilyAccountAgeAnalysisSnapshots } from "../src/utils/familyAccountAgeAnalysisStore";

const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";

async function main() {
  const apply = process.argv.includes("--apply");
  const beforeRows = await buildAccountsFromAgeAnalysisSnapshots(SCHOOL_ID);

  const { ageAnalysisXls, snapshots, parsedAccountCount } = buildExactAgeAnalysisSnapshots({
    schoolId: SCHOOL_ID,
    importedAt: DA_SILVA_AGE_BASELINE_IMPORTED_AT,
  });

  if (apply) {
    upsertSchoolFamilyAccountAgeAnalysisSnapshots(SCHOOL_ID, snapshots);
  }

  const kidesysBalanceByAccount: Record<string, number> = {};
  for (const [acct, snap] of Object.entries(snapshots)) {
    kidesysBalanceByAccount[acct] = Number(snap.balance) || 0;
  }

  const beforeByAccount = Object.fromEntries(
    beforeRows.map((row) => [String(row.accountNo).toUpperCase(), Number(row.balance) || 0])
  );

  const { resolveAuthoritativeAccountBalanceFromSnapshot } = await import(
    "../src/services/statementAccounts"
  );
  const { readSchoolLedger } = await import("../src/utils/billingLedgerStore");
  const ledger = readSchoolLedger(SCHOOL_ID);
  const afterByAccount: Record<string, number> = {};
  for (const [acct, snap] of Object.entries(snapshots)) {
    const entries = ledger.filter(
      (e) => String(e.accountNo || "").trim().toUpperCase() === acct
    );
    afterByAccount[acct] = resolveAuthoritativeAccountBalanceFromSnapshot(snap, entries);
  }

  const beforeMatch = compareExactAgeAnalysisBalances({
    kidesysBalanceByAccount,
    eduClearBalanceByAccount: beforeByAccount,
  });
  const afterMatch = compareExactAgeAnalysisBalances({
    kidesysBalanceByAccount,
    eduClearBalanceByAccount: afterByAccount,
  });

  const ali002Kidesys = kidesysBalanceByAccount.ALI002 ?? null;
  const ali002Before = beforeByAccount.ALI002 ?? null;
  const ali002After = afterByAccount.ALI002 ?? null;

  const report = {
    apply,
    ageAnalysisXls,
    parsedAccountCount,
    snapshotCount: Object.keys(snapshots).length,
    importedAt: DA_SILVA_AGE_BASELINE_IMPORTED_AT,
    ali002: {
      kidesysBalance: ali002Kidesys,
      eduClearBefore: ali002Before,
      eduClearAfter: ali002After,
    },
    matchingExactlyCount: afterMatch.matchingExactly.length,
    unmatchedCount: afterMatch.unmatched.length,
    unmatchedAccounts: afterMatch.unmatched,
    beforeFix: {
      matchingExactlyCount: beforeMatch.matchingExactly.length,
      unmatchedCount: beforeMatch.unmatched.length,
    },
  };

  const outPath = path.join(process.cwd(), "storage", "age-baseline-computed.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
