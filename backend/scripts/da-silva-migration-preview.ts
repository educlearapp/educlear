/**
 * Dry-run Da Silva Kid-e-Sys migration against local export folders.
 * Usage: npx ts-node scripts/da-silva-migration-preview.ts [desktopRoot]
 */
import fs from "fs";
import path from "path";
import { buildDaSilvaBundleFromDesktopLayout } from "../src/services/daSilvaMigration/daSilvaMigrationService";
import {
  classifyVarianceGroup,
  isMergedFamilyAccount,
  learnersPerAccount,
} from "../src/services/daSilvaMigration/daSilvaVarianceClassification";

function isMissingAccountName(fullName: string): boolean {
  return !String(fullName || "").trim();
}

const desktopRoot = process.argv[2] || path.join(process.env.HOME || "", "Desktop");
const schoolId = "preview-school";
const projectId = "preview-project";

const bundle = buildDaSilvaBundleFromDesktopLayout(schoolId, projectId, desktopRoot);

console.log("=== Da Silva Migration Preview ===");
console.log(JSON.stringify(bundle.countValidation, null, 2));
console.log("\n=== Totals ===");
console.log(JSON.stringify(bundle.reconciliation.totals, null, 2));
console.log("\ncanImport:", bundle.canImport);
if (!bundle.canImport) {
  console.error("\nBLOCKED:", bundle.countValidation.errors.join("\n"));
  process.exit(1);
}
console.log("\nReconciliation sample (first 5):");
console.log(JSON.stringify(bundle.reconciliation.rows.slice(0, 5), null, 2));
const ada004 = bundle.reconciliation.rows.find((r) => r.accountNo === "ADA004");
if (ada004) {
  console.log("\nADA004 (merged family):");
  console.log(JSON.stringify(ada004, null, 2));
}
const varianceRows = bundle.reconciliation.rows.filter((r) => Math.abs(r.variance) > 0.01);
console.log(`\nReconciliation variances: ${varianceRows.length}`);

const learnerCountByAccount = learnersPerAccount(bundle.learners);
const ageAnalysisAccountNos = new Set(bundle.accounts.map((a) => a.accountNo));
const mergedFamilyAccountNos = new Set(bundle.mergedFamilyAccountNos || []);

const classifiedVariances = varianceRows.map((row) => {
  const account = bundle.accounts.find((a) => a.accountNo === row.accountNo);
  const fullName = row.fullName || account?.fullName || "";
  const inAgeAnalysis = ageAnalysisAccountNos.has(row.accountNo);
  const mergedFamily = isMergedFamilyAccount(
    row.accountNo,
    fullName,
    learnerCountByAccount,
    mergedFamilyAccountNos
  );
  const varianceGroup = classifyVarianceGroup(
    { ...row, fullName },
    inAgeAnalysis,
    bundle.transactions,
    mergedFamily
  );
  return {
    accountNo: row.accountNo,
    fullName,
    inAgeAnalysis,
    ageAnalysisBalance: row.ageAnalysisBalance,
    ledgerBalanceFromImport: row.ledgerBalanceFromImport,
    variance: row.variance,
    mergedFamily,
    missingAccountName: isMissingAccountName(fullName),
    varianceGroup,
  };
});

const classificationCounts = {
  activeAgeAnalysisMismatch: classifiedVariances.filter(
    (v) => v.varianceGroup === "activeAgeAnalysisMismatch"
  ).length,
  mergedFamilyLedgerGap: classifiedVariances.filter(
    (v) => v.varianceGroup === "mergedFamilyLedgerGap"
  ).length,
  zeroBalanceHistoricalLedgerOnly: classifiedVariances.filter(
    (v) => v.varianceGroup === "zeroBalanceHistoricalLedgerOnly"
  ).length,
  overpaidCredit: classifiedVariances.filter((v) => v.varianceGroup === "overpaidCredit")
    .length,
  missingAccountName: classifiedVariances.filter((v) => v.missingAccountName).length,
};

console.log("\n=== Variance classification ===");
console.log(
  `1. Active age-analysis balance mismatches: ${classificationCounts.activeAgeAnalysisMismatch}`
);
console.log(
  `2. Merged-family ledger gaps (age analysis authoritative, no adjustment): ${classificationCounts.mergedFamilyLedgerGap}`
);
console.log(
  `3. Zero-balance historical ledger-only accounts: ${classificationCounts.zeroBalanceHistoricalLedgerOnly}`
);
console.log(`4. Overpaid/credit accounts: ${classificationCounts.overpaidCredit}`);
console.log(`5. Missing account-name rows: ${classificationCounts.missingAccountName}`);
console.log(`   (groups 3–5 overlap on ledger-only rows with no age-analysis name)`);

const ob = bundle.openingBalance;
console.log("\n=== Opening balance adjustments (preview only — no import) ===");
console.log(`Label: ${ob.label}`);
console.log(`Cutover date: ${ob.summary.cutoverDate}`);
console.log(`Total adjustments count: ${ob.summary.adjustmentCount}`);
console.log(`Total adjustment value (|R| sum): R${ob.summary.totalAdjustmentValue.toFixed(2)}`);
console.log(`Net adjustment value: R${ob.summary.netAdjustmentValue.toFixed(2)}`);
console.log(`Total before balance (txn ledger): R${ob.summary.totalBeforeBalance.toFixed(2)}`);
console.log(`Total after balance (age analysis): R${ob.summary.totalAfterBalance.toFixed(2)}`);
console.log(`All adjustments reconcile to age analysis: ${ob.allAdjustmentsBalanceToAgeAnalysis}`);
console.log(
  `Age-analysis remaining variance (accounts with Kid-e-Sys balance > 0): ${ob.summary.ageAnalysisRemainingVarianceCount} (must be 0)`
);

if (ob.adjustments.length) {
  console.log("\nSample adjustments — before / after (first 5):");
  for (const adj of ob.adjustments.slice(0, 5)) {
    console.log(
      `  ${adj.accountNo} ${adj.fullName}: ledger R${adj.beforeBalance.toFixed(2)} + adj R${adj.adjustmentAmount.toFixed(2)} => age R${adj.afterBalance.toFixed(2)}`
    );
  }
  console.log(JSON.stringify(ob.adjustments.slice(0, 5), null, 2));
}

const sil007 = bundle.reconciliation.rows.find((r) => r.accountNo === "SIL007");
if (sil007) {
  console.log("\nSIL007 (merged family check):");
  console.log(
    JSON.stringify(
      {
        ...sil007,
        mergedFamily: mergedFamilyAccountNos.has("SIL007"),
        openingAdjustment: ob.adjustments.find((a) => a.accountNo === "SIL007") || null,
      },
      null,
      2
    )
  );
}
console.log(`Total variances: ${classifiedVariances.length}`);

const varianceReport = {
  generatedAt: new Date().toISOString(),
  desktopRoot,
  varianceCount: varianceRows.length,
  classificationCounts,
  openingBalance: ob,
  variances: classifiedVariances,
};

const reportPath = path.join(__dirname, "..", "variance-report.json");
fs.writeFileSync(reportPath, JSON.stringify(varianceReport, null, 2), "utf8");
console.log("\nFull variance report written to variance-report.json");
