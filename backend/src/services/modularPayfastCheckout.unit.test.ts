/**
 * Modular PayFast checkout Phase 1 — pricing, intent, activation plans.
 * Run: npx tsx src/services/modularPayfastCheckout.unit.test.ts
 */
import assert from "assert";

import { EDUCLEAR_COMMERCIAL_PACKAGES } from "./educlearCommercialPackages";
import { formatPayFastAmount } from "./payfastService";
import {
  ModularCheckoutError,
  assertModularUpgradeAllowed,
  buildModularPaymentIntent,
  computeSubscriptionPeriodEnd,
  entitlementPatchesForModules,
  formatAmountZarFromCents,
  isLegacyCapacityInitiationCode,
  isModularPayfastCheckoutEnabled,
  legacyCapacityCodeForCommercialSku,
  parseCommercialSku,
  parseModularBillingCycle,
  planModularActivationFromIntent,
  readModularPaymentIntent,
  resolveModularCheckoutQuote,
  zarToCents,
} from "./modularPayfastCheckout";

const EXPECTED: Record<string, { monthly: string; annual: string }> = {
  CORE: { monthly: "1000.00", annual: "10000.00" },
  ACCOUNTING: { monthly: "750.00", annual: "7500.00" },
  PAYROLL: { monthly: "750.00", annual: "7500.00" },
  BUSINESS: { monthly: "1250.00", annual: "12500.00" },
  CORE_ACCOUNTING: { monthly: "1500.00", annual: "15000.00" },
  CORE_PAYROLL: { monthly: "1500.00", annual: "15000.00" },
  FULL_100: { monthly: "1500.00", annual: "15000.00" },
  FULL_UNLIMITED: { monthly: "2000.00", annual: "20000.00" },
};

function testFeatureFlagDefaultOff() {
  assert.strictEqual(isModularPayfastCheckoutEnabled({}), false);
  assert.strictEqual(isModularPayfastCheckoutEnabled({ ENABLE_MODULAR_PAYFAST_CHECKOUT: "" }), false);
  assert.strictEqual(isModularPayfastCheckoutEnabled({ ENABLE_MODULAR_PAYFAST_CHECKOUT: "false" }), false);
  assert.strictEqual(isModularPayfastCheckoutEnabled({ ENABLE_MODULAR_PAYFAST_CHECKOUT: "true" }), true);
  console.log("✓ feature flag default OFF; true only when explicitly enabled");
}

function testSixteenCheckoutCombinations() {
  for (const pkg of EDUCLEAR_COMMERCIAL_PACKAGES) {
    for (const cycle of ["MONTHLY", "ANNUAL"] as const) {
      const quote = resolveModularCheckoutQuote({ sku: pkg.code, billingCycle: cycle });
      const expected = EXPECTED[pkg.code][cycle === "MONTHLY" ? "monthly" : "annual"];
      assert.strictEqual(quote.sku, pkg.code, `${pkg.code} sku`);
      assert.strictEqual(quote.amountZarDisplay, expected, `${pkg.code} ${cycle} display`);
      assert.strictEqual(quote.amountCents, zarToCents(Number(expected)), `${pkg.code} cents`);
      assert.strictEqual(
        formatPayFastAmount(quote.amountCents),
        expected,
        `${pkg.code} PayFast payload amount`
      );
      assert.strictEqual(quote.periodMonths, cycle === "ANNUAL" ? 12 : 1);
      assert.ok(quote.itemName.includes(pkg.name), `${pkg.code} item label`);
      assert.deepStrictEqual(quote.modules, pkg.modules);

      const intent = buildModularPaymentIntent({ schoolId: "school-1", quote });
      assert.strictEqual(intent.commercialSku, pkg.code);
      assert.strictEqual(intent.billingCycle, cycle);
      assert.strictEqual(intent.amountCents, quote.amountCents);
      assert.strictEqual(intent.schoolId, "school-1");

      const plan = planModularActivationFromIntent(intent);
      assert.deepStrictEqual(plan.modules, pkg.modules);
      assert.strictEqual(plan.learnerLimit, pkg.learnerLimit);
      assert.strictEqual(plan.legacyCapacityCode, pkg.code === "FULL_100" ? "STARTER" : "UNLIMITED");
      assert.strictEqual(plan.periodMonths, quote.periodMonths);

      const patches = entitlementPatchesForModules(plan.modules);
      assert.strictEqual(patches.length, 3);
      assert.strictEqual(patches.find((p) => p.module === "CORE")?.enabled, pkg.modules.CORE);
      assert.strictEqual(
        patches.find((p) => p.module === "ACCOUNTING")?.enabled,
        pkg.modules.ACCOUNTING
      );
      assert.strictEqual(patches.find((p) => p.module === "PAYROLL")?.enabled, pkg.modules.PAYROLL);
    }
  }
  console.log("✓ 16 checkout combinations: SKU, cents, label, intent, entitlements, capacity, duration");
}

function testRejects() {
  assert.throws(
    () => resolveModularCheckoutQuote({ sku: "STARTER", billingCycle: "MONTHLY" }),
    (e: unknown) => e instanceof ModularCheckoutError && e.code === "INVALID_SKU"
  );
  assert.throws(
    () => resolveModularCheckoutQuote({ sku: "UNLIMITED", billingCycle: "MONTHLY" }),
    (e: unknown) => e instanceof ModularCheckoutError && e.code === "INVALID_SKU"
  );
  assert.throws(
    () => resolveModularCheckoutQuote({ sku: "NOPE", billingCycle: "MONTHLY" }),
    (e: unknown) => e instanceof ModularCheckoutError && e.code === "INVALID_SKU"
  );
  assert.throws(
    () => resolveModularCheckoutQuote({ sku: "CORE", billingCycle: "WEEKLY" }),
    (e: unknown) => e instanceof ModularCheckoutError && e.code === "INVALID_BILLING_CYCLE"
  );
  assert.throws(
    () =>
      resolveModularCheckoutQuote({
        sku: "CORE",
        billingCycle: "MONTHLY",
        clientAmountCents: 1,
      }),
    (e: unknown) => e instanceof ModularCheckoutError && e.code === "AMOUNT_TAMPER"
  );
  assert.throws(
    () =>
      resolveModularCheckoutQuote({
        sku: "FULL_100",
        billingCycle: "MONTHLY",
        clientAmountZar: 2000,
      }),
    (e: unknown) => e instanceof ModularCheckoutError && e.code === "AMOUNT_TAMPER"
  );
  assert.ok(isLegacyCapacityInitiationCode("STARTER"));
  assert.ok(isLegacyCapacityInitiationCode("UNLIMITED"));
  assert.ok(!isLegacyCapacityInitiationCode("CORE"));
  console.log("✓ unknown SKU / STARTER / UNLIMITED / cycle / tampered amount rejected");
}

function testFull100VsUnlimitedAndBusiness() {
  const a = resolveModularCheckoutQuote({ sku: "FULL_100", billingCycle: "MONTHLY" });
  const b = resolveModularCheckoutQuote({ sku: "FULL_UNLIMITED", billingCycle: "MONTHLY" });
  assert.notStrictEqual(a.amountCents, b.amountCents);
  assert.strictEqual(a.learnerLimit, 100);
  assert.strictEqual(b.learnerLimit, null);
  assert.strictEqual(legacyCapacityCodeForCommercialSku("FULL_100"), "STARTER");
  assert.strictEqual(legacyCapacityCodeForCommercialSku("FULL_UNLIMITED"), "UNLIMITED");

  const biz = resolveModularCheckoutQuote({ sku: "BUSINESS", billingCycle: "MONTHLY" });
  const ca = resolveModularCheckoutQuote({ sku: "CORE_ACCOUNTING", billingCycle: "MONTHLY" });
  const cp = resolveModularCheckoutQuote({ sku: "CORE_PAYROLL", billingCycle: "MONTHLY" });
  assert.notDeepStrictEqual(biz.modules, ca.modules);
  assert.notDeepStrictEqual(biz.modules, cp.modules);
  assert.strictEqual(biz.modules.CORE, false);
  assert.strictEqual(ca.modules.CORE, true);
  console.log("✓ FULL_100 ≠ FULL_UNLIMITED; BUSINESS ≠ CORE_ACCOUNTING / CORE_PAYROLL");
}

function testPeriodLogic() {
  const start = new Date(2026, 0, 15, 12, 0, 0);
  const monthlyEnd = computeSubscriptionPeriodEnd(start, "MONTHLY");
  const annualEnd = computeSubscriptionPeriodEnd(start, "ANNUAL");
  assert.strictEqual(monthlyEnd.getFullYear(), 2026);
  assert.strictEqual(monthlyEnd.getMonth(), 1);
  assert.strictEqual(monthlyEnd.getDate(), 15);
  assert.strictEqual(annualEnd.getFullYear(), 2027);
  assert.strictEqual(annualEnd.getMonth(), 0);
  assert.strictEqual(annualEnd.getDate(), 15);
  console.log("✓ monthly = 1 month; annual = 12 months");
}

function testIntentRoundTripAndIdempotentRead() {
  const quote = resolveModularCheckoutQuote({ sku: "BUSINESS", billingCycle: "ANNUAL" });
  const intent = buildModularPaymentIntent({ schoolId: "abc", quote });
  const raw = { ...intent, checkoutPayload: { amount: "12500.00" } };
  const read = readModularPaymentIntent(raw);
  assert.ok(read);
  assert.strictEqual(read!.commercialSku, "BUSINESS");
  assert.strictEqual(read!.amountCents, 1_250_000);
  assert.strictEqual(readModularPaymentIntent({ checkoutKind: "CREDITS" }), null);
  assert.strictEqual(
    readModularPaymentIntent({
      ...intent,
      amountCents: 1,
    }),
    null
  );
  console.log("✓ payment intent metadata round-trip; tampered intent rejected");
}

function testUpgradePolicy() {
  assert.doesNotThrow(() =>
    assertModularUpgradeAllowed({
      currentModules: { CORE: true, ACCOUNTING: false, PAYROLL: false },
      targetSku: "FULL_UNLIMITED",
    })
  );
  assert.throws(
    () =>
      assertModularUpgradeAllowed({
        currentModules: { CORE: true, ACCOUNTING: false, PAYROLL: false },
        targetSku: "CORE",
      }),
    (e: unknown) => e instanceof ModularCheckoutError && e.code === "SAME_PACKAGE"
  );
  assert.throws(
    () =>
      assertModularUpgradeAllowed({
        currentModules: { CORE: true, ACCOUNTING: true, PAYROLL: true },
        targetSku: "CORE",
        legacyPackageCode: "UNLIMITED",
      }),
    (e: unknown) => e instanceof ModularCheckoutError && e.code === "DOWNGRADE_OR_LATERAL_BLOCKED"
  );
  console.log("✓ upgrade allowed; same package / downgrade blocked");
}

function testParsers() {
  assert.strictEqual(parseCommercialSku("core"), "CORE");
  assert.strictEqual(parseModularBillingCycle("monthly"), "MONTHLY");
  assert.strictEqual(parseModularBillingCycle("annual"), "ANNUAL");
  assert.strictEqual(formatAmountZarFromCents(150_000), "1500.00");
  console.log("✓ parsers + display amount formatting");
}

function main() {
  testFeatureFlagDefaultOff();
  testSixteenCheckoutCombinations();
  testRejects();
  testFull100VsUnlimitedAndBusiness();
  testPeriodLogic();
  testIntentRoundTripAndIdempotentRead();
  testUpgradePolicy();
  testParsers();
  console.log("\nAll modularPayfastCheckout.unit.test.ts passed.");
}

main();
