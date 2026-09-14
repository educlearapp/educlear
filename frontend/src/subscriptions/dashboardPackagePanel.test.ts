/**
 * Dashboard package panel logic tests (Phase 6C modular + 6D UX).
 * Run: npx tsx src/subscriptions/dashboardPackagePanel.test.ts
 */
import assert from "assert";

import {
  formatCurrentPackageCard,
  isModularCheckoutAvailable,
  listUpgradeOptions,
  modularCheckoutDisabledReason,
  onlinePackagePaymentsUnavailableNotice,
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
  const fromAccounting = listUpgradeOptions({
    CORE: false,
    ACCOUNTING: true,
    PAYROLL: false,
  });
  assert.deepStrictEqual(
    fromAccounting.map((p) => p.code),
    ["BUSINESS", "CORE_ACCOUNTING", "FULL"]
  );
  const fromPayroll = listUpgradeOptions({
    CORE: false,
    ACCOUNTING: false,
    PAYROLL: true,
  });
  assert.deepStrictEqual(
    fromPayroll.map((p) => p.code),
    ["BUSINESS", "CORE_PAYROLL", "FULL"]
  );
  const fromBusiness = listUpgradeOptions({
    CORE: false,
    ACCOUNTING: true,
    PAYROLL: true,
  });
  assert.deepStrictEqual(
    fromBusiness.map((p) => p.code),
    ["FULL"]
  );
  const fromCoreAcc = listUpgradeOptions({
    CORE: true,
    ACCOUNTING: true,
    PAYROLL: false,
  });
  assert.deepStrictEqual(
    fromCoreAcc.map((p) => p.code),
    ["FULL"]
  );
  const fromCorePay = listUpgradeOptions({
    CORE: true,
    ACCOUNTING: false,
    PAYROLL: true,
  });
  assert.deepStrictEqual(
    fromCorePay.map((p) => p.code),
    ["FULL"]
  );
  const fromFull = listUpgradeOptions({ CORE: true, ACCOUNTING: true, PAYROLL: true });
  assert.strictEqual(fromFull.length, 0);
  assert.strictEqual(upgradeButtonLabel(fromCore[0]), "Upgrade to Core + Accounting");
  console.log("✓ upgrade options matrix");
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

function testModularCheckoutDisabledCopy() {
  assert.strictEqual(isModularCheckoutAvailable(), false);
  const reason = modularCheckoutDisabledReason();
  assert.strictEqual(
    reason,
    "Online package changes are not available yet. Contact EduClear to change your package."
  );
  assert.ok(!/legacy capacity/i.test(reason));
  assert.ok(!/PAYFAST_/i.test(reason));
  assert.ok(!/PayFast still uses/i.test(reason));
  const notice = onlinePackagePaymentsUnavailableNotice();
  assert.strictEqual(notice, "Online package payments are currently unavailable.");
  assert.ok(!/PAYFAST_/i.test(notice));
  console.log("✓ modular checkout disabled + clean customer copy");
}

function main() {
  testCurrentPackageFromEntitlements();
  testAnnualCard();
  testUpgradeOptions();
  testNo000();
  testModularCheckoutDisabledCopy();
  console.log("\nAll dashboardPackagePanel tests passed.");
}

main();
