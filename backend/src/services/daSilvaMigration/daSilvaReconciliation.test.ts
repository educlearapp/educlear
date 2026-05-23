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

const varianceCount = bundle.reconciliation.rows.filter((r) => Math.abs(r.variance) > 0.01).length;
console.log("Family reconciliation checks passed.");
console.log(`ADA004: age R${ada004.ageAnalysisBalance} = ledger R${ada004.ledgerBalanceFromImport}`);
console.log(`Remaining variances (non-merged / real mismatches): ${varianceCount}`);
