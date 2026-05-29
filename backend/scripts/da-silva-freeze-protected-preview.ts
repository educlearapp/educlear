/**
 * Final Da Silva freeze preview (protected) — preview only, no import, no DB writes.
 * Age-analysis is authoritative; opening balance adjustments align ledger → age.
 *
 * Freeze rules:
 * - Keep all approved opening-balance adjustments except excluded manual accounts
 * - Include inverse ledger>age accounts: MOL003, MOL044, JEC002, MAN010, MAH004, RAM010
 * - Exclude MAR005 (manual reconciliation required)
 *
 * Usage: npx ts-node scripts/da-silva-freeze-protected-preview.ts [desktopRoot]
 */
import path from "path";
import { buildDaSilvaBundleFromDesktopLayout } from "../src/services/daSilvaMigration/daSilvaMigrationService";
import {
  countAgeAnalysisVarianceAfterAdjustments,
  type DaSilvaOpeningBalanceAdjustment,
} from "../src/services/daSilvaMigration/daSilvaOpeningBalance";
import {
  countMergedFamilyLedgerGaps,
  DA_SILVA_FINAL_IMPORT_EXPECTED,
} from "../src/services/daSilvaMigration/daSilvaFinalImportGate";

const SCHOOL_NAME = "Da Silva Academy";

/** Inverse ledger>age accounts approved for opening-balance adjustment at freeze. */
const FREEZE_INCLUDED_INVERSE = [
  "MOL003",
  "MOL044",
  "JEC002",
  "MAN010",
  "MAH004",
  "RAM010",
] as const;

/** Excluded from opening balance — manual Kid-e-Sys reconciliation required. */
const FREEZE_EXCLUDED_MANUAL: Array<{
  accountNo: string;
  status: "manual reconciliation required";
}> = [{ accountNo: "MAR005", status: "manual reconciliation required" }];

const EXCLUDED_ACCOUNT_NOS = new Set(FREEZE_EXCLUDED_MANUAL.map((e) => e.accountNo));

type ExcludedManualAccount = {
  accountNo: string;
  fullName: string;
  ageAnalysisBalance: number;
  ledgerBalanceFromImport: number;
  variance: number;
  status: "manual reconciliation required";
  note: string;
};

function applyFreezeOpeningBalancePlan(
  adjustments: DaSilvaOpeningBalanceAdjustment[]
): DaSilvaOpeningBalanceAdjustment[] {
  return adjustments.filter((a) => !EXCLUDED_ACCOUNT_NOS.has(a.accountNo));
}

const desktopRoot = process.argv[2] || path.join(process.env.HOME || "", "Desktop");
const bundle = buildDaSilvaBundleFromDesktopLayout("freeze-preview", "freeze-preview", desktopRoot);

const freezeAdjustments = applyFreezeOpeningBalancePlan(bundle.openingBalance.adjustments);
const ageAnalysisAccountNos = new Set(bundle.accounts.map((a) => a.accountNo));
const ageAnalysisRemainingVariance = countAgeAnalysisVarianceAfterAdjustments(
  bundle.reconciliation.rows,
  freezeAdjustments,
  ageAnalysisAccountNos
);
const mergedFamilyLedgerGaps = countMergedFamilyLedgerGaps(bundle);

const missingInverse = FREEZE_INCLUDED_INVERSE.filter(
  (acct) => !freezeAdjustments.some((a) => a.accountNo === acct)
);
const stillHasMar005 = freezeAdjustments.some((a) => a.accountNo === "MAR005");

const excludedManualAccounts: ExcludedManualAccount[] = FREEZE_EXCLUDED_MANUAL.map((rule) => {
  const row = bundle.reconciliation.rows.find((r) => r.accountNo === rule.accountNo);
  const account = bundle.accounts.find((a) => a.accountNo === rule.accountNo);
  const fullName = row?.fullName || account?.fullName || "";
  return {
    accountNo: rule.accountNo,
    fullName,
    ageAnalysisBalance: row?.ageAnalysisBalance ?? account?.balance ?? 0,
    ledgerBalanceFromImport: row?.ledgerBalanceFromImport ?? 0,
    variance: row?.variance ?? 0,
    status: rule.status,
    note: "Excluded from Kid-e-Sys opening balance at freeze; reconcile in Kid-e-Sys or post-import manually.",
  };
});

const structuralOk =
  bundle.canImport &&
  ageAnalysisRemainingVariance === 0 &&
  mergedFamilyLedgerGaps === 0 &&
  missingInverse.length === 0 &&
  !stillHasMar005;

const importAllowed = structuralOk;

console.log("=== Da Silva freeze — protected preview (no import) ===");
console.log(`Desktop root: ${desktopRoot}`);
console.log(`Authority: age analysis (ledger aligned via opening balance adjustments)`);
console.log("");
console.log("--- Final snapshot ---");
console.log(`School name: ${SCHOOL_NAME}`);
console.log(`Learners: ${bundle.learners.length}`);
console.log(`Parents: ${bundle.reconciliation.totals.totalParents}`);
console.log(`Classes: ${bundle.reconciliation.totals.totalClasses}`);
console.log(`Billing accounts: ${bundle.countValidation.billingAccountsFromAgeAnalysis}`);
console.log(`Transaction count: ${bundle.transactions.length}`);
console.log(
  `Opening balance adjustment count: ${freezeAdjustments.length} (base plan: ${bundle.openingBalance.summary.adjustmentCount}, excluded manual: ${bundle.openingBalance.summary.adjustmentCount - freezeAdjustments.length})`
);
console.log(`Remaining age-analysis variance: ${ageAnalysisRemainingVariance}`);
console.log(`Merged-family gaps: ${mergedFamilyLedgerGaps}`);
console.log(
  `Excluded manual accounts: ${excludedManualAccounts.map((e) => `${e.accountNo} (${e.status})`).join(", ") || "none"}`
);
for (const ex of excludedManualAccounts) {
  console.log(
    `  ${ex.accountNo} ${ex.fullName}: age R${ex.ageAnalysisBalance.toFixed(2)}, ledger R${ex.ledgerBalanceFromImport.toFixed(2)}, variance R${ex.variance.toFixed(2)} — ${ex.status}`
  );
}
console.log(`Import allowed = ${importAllowed ? "YES" : "NO"}`);
console.log("");

console.log("--- Freeze inverse accounts (included) ---");
for (const acct of FREEZE_INCLUDED_INVERSE) {
  const adj = freezeAdjustments.find((a) => a.accountNo === acct);
  const row = bundle.reconciliation.rows.find((r) => r.accountNo === acct);
  if (!adj) {
    console.log(`  ${acct}: MISSING from freeze adjustment plan`);
    continue;
  }
  console.log(
    `  ${acct} ${adj.fullName}: ledger R${adj.beforeBalance.toFixed(2)} + adj R${adj.adjustmentAmount.toFixed(2)} => age R${adj.afterBalance.toFixed(2)} (variance was R${(row?.variance ?? 0).toFixed(2)})`
  );
}

if (missingInverse.length) {
  console.error(`\nBLOCKED: missing freeze inverse accounts: ${missingInverse.join(", ")}`);
}
if (stillHasMar005) {
  console.error("\nBLOCKED: MAR005 must be excluded from freeze adjustments");
}
if (!bundle.canImport) {
  console.error("\nBLOCKED: learner/export count validation failed:");
  for (const err of bundle.countValidation.errors) console.error(`  - ${err}`);
}
if (ageAnalysisRemainingVariance !== 0) {
  console.error(
    `\nBLOCKED: ${ageAnalysisRemainingVariance} age-analysis account(s) still out of line after freeze adjustments`
  );
}
if (mergedFamilyLedgerGaps !== 0) {
  console.error(`\nBLOCKED: ${mergedFamilyLedgerGaps} merged-family ledger gap(s)`);
}

console.log("\n--- Reference (approved import gate snapshot) ---");
console.log(
  `  Expected opening balance adjustments: ${DA_SILVA_FINAL_IMPORT_EXPECTED.openingBalanceAdjustments} (freeze uses ${freezeAdjustments.length} after MAR005 exclusion)`
);
console.log(`  Expected age-analysis remaining variance: ${DA_SILVA_FINAL_IMPORT_EXPECTED.ageAnalysisRemainingVariance}`);
console.log(`  Expected merged-family gaps: ${DA_SILVA_FINAL_IMPORT_EXPECTED.mergedFamilyLedgerGaps}`);

process.exit(importAllowed ? 0 : 1);
