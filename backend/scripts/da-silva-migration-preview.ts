/**
 * Dry-run Da Silva Kid-e-Sys migration against local export folders.
 * Usage: npx ts-node scripts/da-silva-migration-preview.ts [desktopRoot]
 */
import path from "path";
import { buildDaSilvaBundleFromDesktopLayout } from "../src/services/daSilvaMigration/daSilvaMigrationService";

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
