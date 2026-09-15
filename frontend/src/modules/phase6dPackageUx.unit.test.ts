/**
 * Phase 6D customer UX cleanup checks.
 * Run: npx tsx src/modules/phase6dPackageUx.unit.test.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { upgradeCodesFrom } from "./educlearCommercialPackages";
import {
  isModularCheckoutAvailable,
  modularCheckoutDisabledReason,
  onlinePackagePaymentsUnavailableNotice,
} from "../subscriptions/dashboardPackagePanelLogic";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FE_SRC = path.join(__dirname, "..");

function testBusinessUpgradeFullOnly() {
  assert.deepStrictEqual(upgradeCodesFrom("BUSINESS"), ["FULL"]);
  assert.deepStrictEqual(upgradeCodesFrom("CORE"), [
    "CORE_ACCOUNTING",
    "CORE_PAYROLL",
    "FULL",
  ]);
  assert.deepStrictEqual(upgradeCodesFrom("ACCOUNTING"), [
    "BUSINESS",
    "CORE_ACCOUNTING",
    "FULL",
  ]);
  assert.deepStrictEqual(upgradeCodesFrom("PAYROLL"), ["BUSINESS", "CORE_PAYROLL", "FULL"]);
  assert.deepStrictEqual(upgradeCodesFrom("CORE_ACCOUNTING"), ["FULL"]);
  assert.deepStrictEqual(upgradeCodesFrom("CORE_PAYROLL"), ["FULL"]);
  assert.deepStrictEqual(upgradeCodesFrom("FULL"), []);
  console.log("✓ upgrade matrix including Business → Full only");
}

function testCustomerFacingCopyClean() {
  assert.strictEqual(isModularCheckoutAvailable(), false);
  assert.strictEqual(
    modularCheckoutDisabledReason(),
    "Online package changes are not available yet. Contact EduClear to change your package."
  );
  assert.strictEqual(
    onlinePackagePaymentsUnavailableNotice(),
    "Online package payments are currently unavailable."
  );

  const schoolSurfaces = [
    "subscriptions/SubscriptionPackages.tsx",
    "subscriptions/DashboardPackagePanel.tsx",
    "subscriptions/SubscriptionStatus.tsx",
    "subscriptions/dashboardPackagePanelLogic.ts",
  ];
  for (const rel of schoolSurfaces) {
    const text = fs.readFileSync(path.join(FE_SRC, rel), "utf8");
    assert.ok(!text.includes("PAYFAST_MERCHANT_ID"), rel);
    assert.ok(!text.includes("PAYFAST_MERCHANT_KEY"), rel);
    assert.ok(!text.includes("PAYFAST_PASSPHRASE"), rel);
    assert.ok(!text.includes("PAYFAST_RETURN_URL"), rel);
    assert.ok(!text.includes("PAYFAST_CANCEL_URL"), rel);
    assert.ok(!text.includes("PAYFAST_NOTIFY_URL"), rel);
    assert.ok(!text.includes("PayFast still uses legacy capacity packages"), rel);
    assert.ok(!text.includes("PayFast is not configured on this server"), rel);
    if (rel.endsWith(".tsx")) {
      assert.ok(!/legacy capacity packages/i.test(text), rel);
      assert.ok(!/Missing: \$\{missingPayFastEnv/i.test(text), rel);
      // No dead disabled Upgrade button while checkout is offline
      assert.ok(!/disabled.*Upgrade to|Upgrade to \$\{pkg\.shortLabel\}/i.test(text), rel);
      assert.ok(text.includes("packageUpgradeCta") || text.includes("Contact EduClear to upgrade") || rel.includes("Status"), rel);
    }
  }
  // Package surfaces must use contact CTA helper
  const packages = fs.readFileSync(
    path.join(FE_SRC, "subscriptions/SubscriptionPackages.tsx"),
    "utf8"
  );
  const dashboard = fs.readFileSync(
    path.join(FE_SRC, "subscriptions/DashboardPackagePanel.tsx"),
    "utf8"
  );
  assert.ok(packages.includes("packageUpgradeCta"));
  assert.ok(dashboard.includes("packageUpgradeCta"));
  assert.ok(packages.includes("Contact EduClear to upgrade") || packages.includes("PACKAGE_UPGRADE_CONTACT_CTA_LABEL") || packages.includes("packageUpgradeCta"));
  console.log("✓ school UI free of raw PayFast env / legacy capacity / dead Upgrade CTAs");
}

function testPricingUntouched() {
  const catalog = fs.readFileSync(
    path.join(FE_SRC, "modules/educlearCommercialPackages.ts"),
    "utf8"
  );
  assert.ok(catalog.includes("monthlyPriceZar: 1000"));
  assert.ok(catalog.includes("monthlyPriceZar: 750"));
  assert.ok(catalog.includes("monthlyPriceZar: 1250"));
  assert.ok(catalog.includes("monthlyPriceZar: 1500"));
  assert.ok(catalog.includes("monthlyPriceZar: 2000"));
  console.log("✓ canonical pricing values unchanged");
}

function main() {
  testBusinessUpgradeFullOnly();
  testCustomerFacingCopyClean();
  testPricingUntouched();
  console.log("\nAll phase6dPackageUx tests passed.");
}

main();
