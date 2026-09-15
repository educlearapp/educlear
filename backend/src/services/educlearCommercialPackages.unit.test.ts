/**
 * Phase 6C commercial package catalog tests + FE/BE contract snapshot.
 * Run: npx tsx src/services/educlearCommercialPackages.unit.test.ts
 */
import assert from "assert";

import {
  ANNUAL_MONTHS_PAID,
  ANNUAL_PROMOTION_COPY,
  EDUCLEAR_COMMERCIAL_PACKAGES,
  assertAnnualEqualsTenMonths,
  commercialPackageShortDisplay,
  findCommercialPackageByBits,
  findCommercialPackageByCode,
  findCommercialPackageByModules,
  formatCommercialPackagePrice,
  formatLearnerCapacityLabel,
  isFullModules,
  isLegacyCapacityPackageCode,
  listNewSaleCommercialPackages,
  mapLegacyCapacityToFullCode,
  modulesToBits,
  upgradeCodesFrom,
  upgradePackagesFrom,
} from "./educlearCommercialPackages";

const EXPECTED = [
  { bits: "100", code: "CORE", shortLabel: "Core", monthly: 1000, annual: 10_000, learnerLimit: null },
  { bits: "010", code: "ACCOUNTING", shortLabel: "Accounting", monthly: 750, annual: 7500, learnerLimit: null },
  { bits: "001", code: "PAYROLL", shortLabel: "Payroll", monthly: 750, annual: 7500, learnerLimit: null },
  { bits: "011", code: "BUSINESS", shortLabel: "Business", monthly: 1250, annual: 12_500, learnerLimit: null },
  { bits: "110", code: "CORE_ACCOUNTING", shortLabel: "Core + Accounting", monthly: 1500, annual: 15_000, learnerLimit: null },
  { bits: "101", code: "CORE_PAYROLL", shortLabel: "Core + Payroll", monthly: 1500, annual: 15_000, learnerLimit: null },
  { bits: "111", code: "FULL_100", shortLabel: "Full ≤100", monthly: 1500, annual: 15_000, learnerLimit: 100 },
  { bits: "111", code: "FULL_UNLIMITED", shortLabel: "Full Unlimited", monthly: 2000, annual: 20_000, learnerLimit: null },
] as const;

function testCatalogMatrix() {
  assert.strictEqual(EDUCLEAR_COMMERCIAL_PACKAGES.length, 8);
  for (const row of EXPECTED) {
    const pkg = findCommercialPackageByCode(row.code);
    assert.ok(pkg, `missing code ${row.code}`);
    assert.strictEqual(pkg!.bits, row.bits);
    assert.strictEqual(pkg!.shortLabel, row.shortLabel);
    assert.strictEqual(pkg!.monthlyPriceZar, row.monthly);
    assert.strictEqual(pkg!.annualPriceZar, row.annual);
    assert.strictEqual(pkg!.learnerLimit, row.learnerLimit);
    assert.ok(assertAnnualEqualsTenMonths(pkg!));
    assert.strictEqual(pkg!.annualPriceZar, pkg!.monthlyPriceZar * ANNUAL_MONTHS_PAID);
  }
  // Default 111 resolve → Full Unlimited (fail-open / no downgrade)
  const defaultFull = findCommercialPackageByBits("111");
  assert.strictEqual(defaultFull?.code, "FULL_UNLIMITED");
  console.log("✓ catalog matrix 100→111 prices + capacity");
}

function testNo000() {
  assert.strictEqual(findCommercialPackageByBits("000"), null);
  assert.strictEqual(
    findCommercialPackageByModules({ CORE: false, ACCOUNTING: false, PAYROLL: false }),
    null
  );
  assert.strictEqual(modulesToBits({ CORE: false, ACCOUNTING: false, PAYROLL: false }), "000");
  console.log("✓ no 000 package");
}

function testNoLegacyInNewSale() {
  const codes = listNewSaleCommercialPackages().map((p) => p.code);
  assert.strictEqual(codes.length, 8);
  assert.ok(!codes.includes("STARTER" as never));
  assert.ok(!codes.includes("UNLIMITED" as never));
  assert.ok(isLegacyCapacityPackageCode("STARTER"));
  assert.ok(isLegacyCapacityPackageCode("UNLIMITED"));
  assert.ok(!isLegacyCapacityPackageCode("FULL_100"));
  console.log("✓ no Starter/Unlimited in new-sale catalog");
}

function testBusinessSecondary() {
  const biz = findCommercialPackageByCode("BUSINESS");
  assert.strictEqual(biz?.secondaryLabel, "Accounting + Payroll");
  assert.strictEqual(
    commercialPackageShortDisplay(biz!.modules, { includeSecondary: true }),
    "Business / Accounting + Payroll"
  );
  console.log("✓ Business secondary label");
}

function testUpgradePaths() {
  assert.deepStrictEqual(upgradeCodesFrom("CORE"), [
    "CORE_ACCOUNTING",
    "CORE_PAYROLL",
    "FULL_100",
    "FULL_UNLIMITED",
  ]);
  assert.deepStrictEqual(upgradeCodesFrom("ACCOUNTING"), [
    "BUSINESS",
    "CORE_ACCOUNTING",
    "FULL_100",
    "FULL_UNLIMITED",
  ]);
  assert.deepStrictEqual(upgradeCodesFrom("PAYROLL"), [
    "BUSINESS",
    "CORE_PAYROLL",
    "FULL_100",
    "FULL_UNLIMITED",
  ]);
  assert.deepStrictEqual(upgradeCodesFrom("BUSINESS"), ["FULL_100", "FULL_UNLIMITED"]);
  assert.deepStrictEqual(upgradeCodesFrom("CORE_ACCOUNTING"), ["FULL_100", "FULL_UNLIMITED"]);
  assert.deepStrictEqual(upgradeCodesFrom("CORE_PAYROLL"), ["FULL_100", "FULL_UNLIMITED"]);
  assert.deepStrictEqual(upgradeCodesFrom("FULL_100"), ["FULL_UNLIMITED"]);
  assert.deepStrictEqual(upgradeCodesFrom("FULL"), []);
  assert.deepStrictEqual(upgradeCodesFrom("FULL_UNLIMITED"), []);
  const fromCore = upgradePackagesFrom({ CORE: true, ACCOUNTING: false, PAYROLL: false });
  assert.strictEqual(fromCore.length, 4);
  console.log("✓ upgrade paths");
}

function testFull100VsUnlimited() {
  const fullMods = { CORE: true, ACCOUNTING: true, PAYROLL: true };
  assert.ok(isFullModules(fullMods));
  const starterMapped = findCommercialPackageByModules(fullMods, {
    legacyPackageCode: "STARTER",
  });
  const unlimitedMapped = findCommercialPackageByModules(fullMods, {
    legacyPackageCode: "UNLIMITED",
  });
  assert.strictEqual(starterMapped?.code, "FULL_100");
  assert.strictEqual(starterMapped?.learnerLimit, 100);
  assert.strictEqual(starterMapped?.monthlyPriceZar, 1500);
  assert.strictEqual(unlimitedMapped?.code, "FULL_UNLIMITED");
  assert.strictEqual(unlimitedMapped?.learnerLimit, null);
  assert.strictEqual(unlimitedMapped?.monthlyPriceZar, 2000);
  // Identical module entitlements
  assert.deepStrictEqual(starterMapped!.modules, unlimitedMapped!.modules);
  assert.strictEqual(mapLegacyCapacityToFullCode("STARTER"), "FULL_100");
  assert.strictEqual(mapLegacyCapacityToFullCode("UNLIMITED"), "FULL_UNLIMITED");
  assert.strictEqual(mapLegacyCapacityToFullCode(null), "FULL_UNLIMITED");
  assert.strictEqual(formatLearnerCapacityLabel(100), "Up to 100 learners");
  assert.strictEqual(formatLearnerCapacityLabel(null), "Unlimited");
  // Alias FULL → Full Unlimited
  assert.strictEqual(findCommercialPackageByCode("FULL")?.code, "FULL_UNLIMITED");
  console.log("✓ Full ≤100 vs Full Unlimited entitlement mapping");
}

function testEntitlementMapping() {
  assert.strictEqual(
    findCommercialPackageByModules({ CORE: true, ACCOUNTING: false, PAYROLL: false })?.code,
    "CORE"
  );
  assert.strictEqual(
    findCommercialPackageByModules({ CORE: false, ACCOUNTING: true, PAYROLL: false })?.code,
    "ACCOUNTING"
  );
  assert.strictEqual(
    findCommercialPackageByModules({ CORE: false, ACCOUNTING: false, PAYROLL: true })?.code,
    "PAYROLL"
  );
  assert.strictEqual(
    findCommercialPackageByModules({ CORE: false, ACCOUNTING: true, PAYROLL: true })?.code,
    "BUSINESS"
  );
  assert.strictEqual(
    findCommercialPackageByModules({ CORE: true, ACCOUNTING: true, PAYROLL: false })?.code,
    "CORE_ACCOUNTING"
  );
  assert.strictEqual(
    findCommercialPackageByModules({ CORE: true, ACCOUNTING: false, PAYROLL: true })?.code,
    "CORE_PAYROLL"
  );
  console.log("✓ entitlement → commercial SKU mapping");
}

function testPriceFormatting() {
  const core = findCommercialPackageByCode("CORE")!;
  assert.strictEqual(formatCommercialPackagePrice(core, "monthly"), "R1,000 / month");
  assert.strictEqual(formatCommercialPackagePrice(core, "annual"), "R10,000 / year");
  assert.ok(ANNUAL_PROMOTION_COPY.includes("2 months free"));
  console.log("✓ price formatting + annual copy");
}

function testCoreBillingMessaging() {
  const core = findCommercialPackageByCode("CORE")!;
  assert.ok(core.description.toLowerCase().includes("billing"));
  const accounting = findCommercialPackageByCode("ACCOUNTING")!;
  assert.ok(!accounting.description.toLowerCase().includes("school-fee billing"));
  console.log("✓ Core Billing messaging");
}

/** Stable contract fingerprint — must match frontend unit test. */
export const COMMERCIAL_PACKAGE_CONTRACT_FINGERPRINT = EXPECTED.map(
  (r) => `${r.bits}|${r.code}|${r.shortLabel}|${r.monthly}|${r.annual}|${r.learnerLimit ?? "null"}`
).join(";");

function testContractFingerprint() {
  assert.strictEqual(
    COMMERCIAL_PACKAGE_CONTRACT_FINGERPRINT,
    "100|CORE|Core|1000|10000|null;010|ACCOUNTING|Accounting|750|7500|null;001|PAYROLL|Payroll|750|7500|null;011|BUSINESS|Business|1250|12500|null;110|CORE_ACCOUNTING|Core + Accounting|1500|15000|null;101|CORE_PAYROLL|Core + Payroll|1500|15000|null;111|FULL_100|Full ≤100|1500|15000|100;111|FULL_UNLIMITED|Full Unlimited|2000|20000|null"
  );
  console.log("✓ FE/BE contract fingerprint");
}

function main() {
  testCatalogMatrix();
  testNo000();
  testNoLegacyInNewSale();
  testBusinessSecondary();
  testUpgradePaths();
  testFull100VsUnlimited();
  testEntitlementMapping();
  testPriceFormatting();
  testCoreBillingMessaging();
  testContractFingerprint();
  console.log("\nAll educlearCommercialPackages (backend) tests passed.");
}

main();
