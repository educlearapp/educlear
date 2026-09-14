/**
 * Dashboard package panel logic tests (Phase 6C modular).
 * Run: npx tsx src/subscriptions/dashboardPackagePanel.test.ts
 */
import assert from "assert";

import {
  formatCurrentPackageCard,
  isModularCheckoutAvailable,
  listUpgradeOptions,
  resolveCurrentCommercialPackageStrict,
  upgradeButtonLabel,
} from "./dashboardPackagePanelLogic";

function testCurrentPackageFromEntitlements() {
  const pkg = resolveCurrentCommercialPackageStrict({
    CORE: false,
    ACCOUNTING: true,
    PAYROLL: false,
  });
  assert.strictEqual(pkg?.code, "ACCOUNTING");
  assert.strictEqual(pkg?.monthlyPriceZar, 750);
  const card = formatCurrentPackageCard(pkg!, "monthly");
  assert.strictEqual(card.title, "EduClear Accounting");
  assert.strictEqual(card.priceLine, "R750 / month");
  console.log("✓ current package card from entitlements");
}

function testAnnualCard() {
  const pkg = resolveCurrentCommercialPackageStrict({
    CORE: true,
    ACCOUNTING: false,
    PAYROLL: false,
  });
  const card = formatCurrentPackageCard(pkg!, "annual");
  assert.strictEqual(card.priceLine, "R10,000 / year");
  assert.ok(card.promoLine?.includes("2 months free"));
  console.log("✓ annual current package card");
}

function testUpgradeOptions() {
  const fromCore = listUpgradeOptions({ CORE: true, ACCOUNTING: false, PAYROLL: false });
  assert.deepStrictEqual(
    fromCore.map((p) => p.code),
    ["CORE_ACCOUNTING", "CORE_PAYROLL", "FULL"]
  );
  const fromFull = listUpgradeOptions({ CORE: true, ACCOUNTING: true, PAYROLL: true });
  assert.strictEqual(fromFull.length, 0);
  assert.strictEqual(upgradeButtonLabel(fromCore[0]), "Upgrade to Core + Accounting");
  console.log("✓ upgrade options");
}

function testNo000() {
  assert.strictEqual(
    resolveCurrentCommercialPackageStrict({
      CORE: false,
      ACCOUNTING: false,
      PAYROLL: false,
    }),
    null
  );
  console.log("✓ no 000 current package");
}

function testModularCheckoutDisabled() {
  assert.strictEqual(isModularCheckoutAvailable(), false);
  console.log("✓ modular checkout disabled until PayFast integration");
}

function main() {
  testCurrentPackageFromEntitlements();
  testAnnualCard();
  testUpgradeOptions();
  testNo000();
  testModularCheckoutDisabled();
  console.log("\nAll dashboardPackagePanel tests passed.");
}

main();
