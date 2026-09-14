/**
 * Phase 6C commercial package catalog tests + FE/BE contract snapshot.
 * Run: npx tsx src/modules/educlearCommercialPackages.unit.test.ts
 */
import assert from "assert";

import {
  ANNUAL_MONTHS_PAID,
  ANNUAL_PROMOTION_COPY,
  EDUCLEAR_COMMERCIAL_PACKAGES,
  PACKAGE_COMPARISON_ROWS,
  assertAnnualEqualsTenMonths,
  commercialPackageShortDisplay,
  findCommercialPackageByBits,
  findCommercialPackageByCode,
  findCommercialPackageByModules,
  formatCommercialPackagePrice,
  isLegacyCapacityPackageCode,
  listNewSaleCommercialPackages,
  modulesToBits,
  packageIncludesFeature,
  upgradeCodesFrom,
  upgradePackagesFrom,
} from "./educlearCommercialPackages";

const EXPECTED = [
  { bits: "100", code: "CORE", shortLabel: "Core", monthly: 1000, annual: 10_000 },
  { bits: "010", code: "ACCOUNTING", shortLabel: "Accounting", monthly: 750, annual: 7500 },
  { bits: "001", code: "PAYROLL", shortLabel: "Payroll", monthly: 750, annual: 7500 },
  { bits: "011", code: "BUSINESS", shortLabel: "Business", monthly: 1250, annual: 12_500 },
  { bits: "110", code: "CORE_ACCOUNTING", shortLabel: "Core + Accounting", monthly: 1500, annual: 15_000 },
  { bits: "101", code: "CORE_PAYROLL", shortLabel: "Core + Payroll", monthly: 1500, annual: 15_000 },
  { bits: "111", code: "FULL", shortLabel: "Full", monthly: 2000, annual: 20_000 },
] as const;

const COMMERCIAL_PACKAGE_CONTRACT_FINGERPRINT = EXPECTED.map(
  (r) => `${r.bits}|${r.code}|${r.shortLabel}|${r.monthly}|${r.annual}`
).join(";");

function testCatalogMatrix() {
  assert.strictEqual(EDUCLEAR_COMMERCIAL_PACKAGES.length, 7);
  for (const row of EXPECTED) {
    const pkg = findCommercialPackageByBits(row.bits);
    assert.ok(pkg, `missing bits ${row.bits}`);
    assert.strictEqual(pkg!.code, row.code);
    assert.strictEqual(pkg!.shortLabel, row.shortLabel);
    assert.strictEqual(pkg!.monthlyPriceZar, row.monthly);
    assert.strictEqual(pkg!.annualPriceZar, row.annual);
    assert.ok(assertAnnualEqualsTenMonths(pkg!));
    assert.strictEqual(pkg!.annualPriceZar, pkg!.monthlyPriceZar * ANNUAL_MONTHS_PAID);
  }
  console.log("✓ catalog matrix 100→111 prices");
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
  const sale = listNewSaleCommercialPackages();
  assert.strictEqual(sale.length, 7);
  assert.ok(!sale.some((p) => p.code === ("STARTER" as never)));
  assert.ok(isLegacyCapacityPackageCode("STARTER"));
  assert.ok(isLegacyCapacityPackageCode("unlimited"));
  console.log("✓ no Starter/Unlimited in new-sale catalog");
}

function testUpgradePaths() {
  assert.deepStrictEqual(upgradeCodesFrom("CORE"), [
    "CORE_ACCOUNTING",
    "CORE_PAYROLL",
    "FULL",
  ]);
  assert.deepStrictEqual(upgradeCodesFrom("FULL"), []);
  const upgrades = upgradePackagesFrom({ CORE: true, ACCOUNTING: true, PAYROLL: false });
  assert.strictEqual(upgrades.length, 1);
  assert.strictEqual(upgrades[0].code, "FULL");
  console.log("✓ upgrade paths");
}

function testPriceFormatting() {
  const accounting = findCommercialPackageByCode("ACCOUNTING")!;
  assert.strictEqual(formatCommercialPackagePrice(accounting, "monthly"), "R750 / month");
  assert.strictEqual(formatCommercialPackagePrice(accounting, "annual"), "R7,500 / year");
  assert.ok(ANNUAL_PROMOTION_COPY.includes("2 months free"));
  console.log("✓ price formatting");
}

function testComparisonBillingOwnership() {
  const billing = PACKAGE_COMPARISON_ROWS.find((r) =>
    r.feature.includes("school-fee Billing")
  );
  assert.ok(billing);
  assert.strictEqual(billing!.group, "Core");
  assert.ok(!billing!.includedIn.includes("ACCOUNTING"));
  assert.ok(billing!.includedIn.includes("CORE"));
  const core = findCommercialPackageByCode("CORE")!;
  assert.ok(packageIncludesFeature(core, billing!));
  const acc = findCommercialPackageByCode("ACCOUNTING")!;
  assert.ok(!packageIncludesFeature(acc, billing!));
  console.log("✓ Core Billing ownership in comparison");
}

function testContractFingerprint() {
  assert.strictEqual(
    COMMERCIAL_PACKAGE_CONTRACT_FINGERPRINT,
    "100|CORE|Core|1000|10000;010|ACCOUNTING|Accounting|750|7500;001|PAYROLL|Payroll|750|7500;011|BUSINESS|Business|1250|12500;110|CORE_ACCOUNTING|Core + Accounting|1500|15000;101|CORE_PAYROLL|Core + Payroll|1500|15000;111|FULL|Full|2000|20000"
  );
  assert.strictEqual(
    commercialPackageShortDisplay({ CORE: false, ACCOUNTING: true, PAYROLL: true }),
    "Business"
  );
  console.log("✓ FE/BE contract fingerprint");
}

function main() {
  testCatalogMatrix();
  testNo000();
  testNoLegacyInNewSale();
  testUpgradePaths();
  testPriceFormatting();
  testComparisonBillingOwnership();
  testContractFingerprint();
  console.log("\nAll educlearCommercialPackages (frontend) tests passed.");
}

main();
