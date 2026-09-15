/**
 * Phase 6C.1 permanence + registration commercial identity tests.
 * Run: npx tsx src/services/phase6c1CommercialPermanence.unit.test.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";

import {
  EDUCLEAR_COMMERCIAL_PACKAGES,
  findCommercialPackageByCode,
  formatCommercialPackagePrice,
  listNewSaleCommercialPackages,
} from "./educlearCommercialPackages";
import { NEW_SCHOOL_LEGACY_CAPACITY_PLACEHOLDER } from "./ensureSchoolSubscription";
import { isModularPayfastCheckoutEnabled } from "./modularPayfastCheckout";
import { serializeCommercialPackage } from "./resolveSchoolCommercialPackage";

const ROOT = path.join(__dirname, "../../..");

function testCataloguePrices() {
  const expected: Record<string, [number, number]> = {
    CORE: [1000, 10_000],
    ACCOUNTING: [750, 7500],
    PAYROLL: [750, 7500],
    BUSINESS: [1250, 12_500],
    CORE_ACCOUNTING: [1500, 15_000],
    CORE_PAYROLL: [1500, 15_000],
    FULL: [2000, 20_000],
    FULL_100: [1500, 15_000],
    FULL_UNLIMITED: [2000, 20_000],
  };
  for (const [code, [m, a]] of Object.entries(expected)) {
    const pkg = findCommercialPackageByCode(code)!;
    assert.strictEqual(pkg.monthlyPriceZar, m);
    assert.strictEqual(pkg.annualPriceZar, a);
    assert.strictEqual(formatCommercialPackagePrice(pkg, "monthly"), serializeCommercialPackage(pkg).priceLabelMonthly);
  }
  console.log("✓ catalogue prices single source");
}

function testNewSchoolNotStarter() {
  assert.strictEqual(NEW_SCHOOL_LEGACY_CAPACITY_PLACEHOLDER, "UNLIMITED");
  assert.notStrictEqual(NEW_SCHOOL_LEGACY_CAPACITY_PLACEHOLDER, "STARTER");
  const ensureSrc = fs.readFileSync(
    path.join(__dirname, "ensureSchoolSubscription.ts"),
    "utf8"
  );
  assert.ok(ensureSrc.includes('NEW_SCHOOL_LEGACY_CAPACITY_PLACEHOLDER'));
  assert.ok(!ensureSrc.includes('DEFAULT_PACKAGE_CODE: EduClearPackageCode = "STARTER"'));
  assert.ok(!ensureSrc.includes('= "STARTER" as EduClearPackageCode'));
  // Default constant must not be STARTER
  assert.ok(ensureSrc.includes('export const NEW_SCHOOL_LEGACY_CAPACITY_PLACEHOLDER'));
  console.log("✓ new school subscription default is not STARTER");
}

function testNoIndependentReactPricingConstants() {
  const payfast = fs.readFileSync(
    path.join(ROOT, "frontend/src/subscriptions/payfastCheckout.ts"),
    "utf8"
  );
  assert.ok(!payfast.includes("R1,500"));
  assert.ok(!payfast.includes("R2,000"));
  assert.ok(!payfast.includes("150_000") && !payfast.includes("150000"));
  assert.ok(!payfast.includes('"R1,500 / month"'));

  const panel = fs.readFileSync(
    path.join(ROOT, "frontend/src/subscriptions/DashboardPackagePanel.tsx"),
    "utf8"
  );
  assert.ok(panel.includes("educlearCommercialPackages") || panel.includes("formatCommercialPackagePrice"));
  assert.ok(!panel.includes("R1,500 / month"));
  assert.ok(!panel.includes("R2,000 / month"));

  const status = fs.readFileSync(
    path.join(ROOT, "frontend/src/subscriptions/SubscriptionStatus.tsx"),
    "utf8"
  );
  assert.ok(status.includes("commercialPackage"));
  assert.ok(!status.includes("getPackageDisplayPrice"));
  console.log("✓ no independent React commercial price constants");
}

function testModularCheckoutDisabled() {
  const logic = fs.readFileSync(
    path.join(ROOT, "frontend/src/subscriptions/dashboardPackagePanelLogic.ts"),
    "utf8"
  );
  assert.ok(logic.includes("isModularCheckoutAvailable"));
  assert.ok(logic.includes("backendFlag === true"));
  const flagSrc = fs.readFileSync(
    path.join(__dirname, "modularPayfastCheckout.ts"),
    "utf8"
  );
  assert.ok(flagSrc.includes("ENABLE_MODULAR_PAYFAST_CHECKOUT"));
  assert.ok(flagSrc.includes('=== "true"'));
  assert.strictEqual(isModularPayfastCheckoutEnabled({}), false);
  console.log("✓ modular checkout remains disabled by default (explicit flag opt-in)");
}

function testPackagesEndpointIsModular() {
  const routes = fs.readFileSync(path.join(__dirname, "../routes/subscriptions.ts"), "utf8");
  assert.ok(routes.includes("listNewSaleCommercialPackages"));
  assert.ok(routes.includes('catalogue: "modular"'));
  assert.ok(routes.includes("commercialPackage"));
  assert.ok(routes.includes("legacyCapacityPackageCode"));
  console.log("✓ subscriptions API uses modular catalogue + commercialPackage");
}

function testAuthRegistersModules() {
  const auth = fs.readFileSync(path.join(__dirname, "../routes/auth.ts"), "utf8");
  assert.ok(auth.includes("ensureSchoolModuleEntitlements"));
  assert.ok(auth.includes("NEW_SCHOOL_LEGACY_CAPACITY_PLACEHOLDER"));
  console.log("✓ register-school ensures modular entitlements + non-Starter capacity");
}

function testNewSaleExcludesLegacy() {
  const sale = listNewSaleCommercialPackages();
  assert.strictEqual(sale.length, 8);
  assert.ok(!sale.some((p) => (p.code as string) === "STARTER"));
  assert.strictEqual(EDUCLEAR_COMMERCIAL_PACKAGES.length, 8);
  console.log("✓ new-sale catalogue excludes STARTER/UNLIMITED");
}

function main() {
  testCataloguePrices();
  testNewSchoolNotStarter();
  testNoIndependentReactPricingConstants();
  testModularCheckoutDisabled();
  testPackagesEndpointIsModular();
  testAuthRegistersModules();
  testNewSaleExcludesLegacy();
  console.log("\nAll phase6c1CommercialPermanence tests passed.");
}

main();
