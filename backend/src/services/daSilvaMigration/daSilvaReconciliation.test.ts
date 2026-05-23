/**
 * Family-account reconciliation checks (run: npx ts-node src/services/daSilvaMigration/daSilvaReconciliation.test.ts)
 */
import path from "path";
import { buildDaSilvaBundleFromDesktopLayout } from "./daSilvaMigrationService";

const desktopRoot = process.argv[2] || path.join(process.env.HOME || "", "Desktop");

const bundle = buildDaSilvaBundleFromDesktopLayout("test-school", "test-project", desktopRoot);

const ada004 = bundle.reconciliation.rows.find((r) => r.accountNo === "ADA004");
if (!ada004) {
  throw new Error("ADA004 not found in reconciliation rows");
}
if (Math.abs(ada004.variance) > 0.01) {
  throw new Error(
    `ADA004 expected zero variance, got age=${ada004.ageAnalysisBalance} ledger=${ada004.ledgerBalanceFromImport} variance=${ada004.variance}`
  );
}

const zem = bundle.learners.find((l) => l.fullName === "Zem Adamu");
if (!zem?.accountNo || zem.accountNo !== "ADA004") {
  throw new Error(`Zem Adamu should map to family account ADA004, got "${zem?.accountNo || ""}"`);
}

const chi005 = bundle.reconciliation.rows.find((r) => r.accountNo === "CHI005");
if (chi005 && Math.abs(chi005.variance) > 0.01) {
  throw new Error(`CHI005 merged family should reconcile, variance=${chi005.variance}`);
}

const sil007 = bundle.reconciliation.rows.find((r) => r.accountNo === "SIL007");
if (!sil007) {
  throw new Error("SIL007 not found in reconciliation rows");
}
if (!bundle.mergedFamilyAccountNos.includes("SIL007")) {
  throw new Error("SIL007 should be detected as a merged family account");
}
if (Math.abs(sil007.variance) > 0.01) {
  throw new Error(
    `SIL007 merged family should reconcile to age analysis, variance=${sil007.variance}`
  );
}

const ada004Opening = bundle.openingBalance.adjustments.find((a) => a.accountNo === "ADA004");
if (ada004Opening) {
  throw new Error("ADA004 merged family should not receive an opening balance adjustment");
}

const sil007Opening = bundle.openingBalance.adjustments.find((a) => a.accountNo === "SIL007");
if (sil007Opening) {
  throw new Error("SIL007 merged family should not receive an opening balance adjustment");
}

for (const adj of bundle.openingBalance.adjustments) {
  const projected = Math.round((adj.beforeBalance + adj.adjustmentAmount) * 100) / 100;
  if (Math.abs(projected - adj.afterBalance) > 0.01) {
    throw new Error(
      `${adj.accountNo} adjustment does not reach age analysis: before=${adj.beforeBalance} adj=${adj.adjustmentAmount} after=${adj.afterBalance}`
    );
  }
}

if (!bundle.openingBalance.allAdjustmentsBalanceToAgeAnalysis) {
  throw new Error("Opening balance plan failed internal reconciliation check");
}

if (bundle.openingBalance.summary.ageAnalysisRemainingVarianceCount !== 0) {
  throw new Error(
    `Expected 0 age-analysis variances after opening adjustments, got ${bundle.openingBalance.summary.ageAnalysisRemainingVarianceCount}`
  );
}

const varianceCount = bundle.reconciliation.rows.filter((r) => Math.abs(r.variance) > 0.01).length;
console.log("Family reconciliation checks passed.");
console.log(`ADA004: age R${ada004.ageAnalysisBalance} = ledger R${ada004.ledgerBalanceFromImport}`);
console.log(`Opening balance adjustments: ${bundle.openingBalance.summary.adjustmentCount}`);
console.log(
  `Age-analysis variance after adjustments: ${bundle.openingBalance.summary.ageAnalysisRemainingVarianceCount}`
);
console.log(`Raw reconciliation variances (pre-adjustment): ${varianceCount}`);
