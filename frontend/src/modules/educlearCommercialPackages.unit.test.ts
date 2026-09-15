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
  formatLearnerCapacityLabel,
  isLegacyCapacityPackageCode,
  listNewSaleCommercialPackages,
  mapLegacyCapacityToFullCode,
  modulesToBits,
  packageIncludesFeature,
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

const COMMERCIAL_PACKAGE_CONTRACT_FINGERPRINT = EXPECTED.map(
  (r) => `${r.bits}|${r.code}|${r.shortLabel}|${r.monthly}|${r.annual}|${r.learnerLimit ?? "null"}`
).join(";");

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
  assert.strictEqual(findCommercialPackageByBits("111")?.code, "FULL_UNLIMITED");
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
  const sale = listNewSaleCommercialPackages();
  assert.strictEqual(sale.length, 8);
  assert.ok(!sale.some((p) => p.code === ("STARTER" as never)));
  assert.ok(isLegacyCapacityPackageCode("STARTER"));
  assert.ok(isLegacyCapacityPackageCode("unlimited"));
  console.log("✓ no Starter/Unlimited in new-sale catalog");
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
  assert.deepStrictEqual(upgradeCodesFrom("FULL"), []);
  assert.deepStrictEqual(upgradeCodesFrom("FULL_UNLIMITED"), []);
  const upgrades = upgradePackagesFrom({ CORE: true, ACCOUNTING: true, PAYROLL: false });
  assert.strictEqual(upgrades.length, 2);
  assert.deepStrictEqual(
    upgrades.map((p) => p.code),
    ["FULL_100", "FULL_UNLIMITED"]
  );
  const fromBusiness = upgradePackagesFrom({
    CORE: false,
    ACCOUNTING: true,
    PAYROLL: true,
  });
  assert.deepStrictEqual(
    fromBusiness.map((p) => p.code),
    ["FULL_100", "FULL_UNLIMITED"]
  );
  console.log("✓ upgrade paths");
}

function testFull100VsUnlimited() {
  const fullMods = { CORE: true, ACCOUNTING: true, PAYROLL: true };
  const a = findCommercialPackageByModules(fullMods, { legacyPackageCode: "STARTER" });
  const b = findCommercialPackageByModules(fullMods, { legacyPackageCode: "UNLIMITED" });
  assert.strictEqual(a?.code, "FULL_100");
  assert.strictEqual(b?.code, "FULL_UNLIMITED");
  assert.deepStrictEqual(a!.modules, b!.modules);
  assert.strictEqual(a!.learnerLimit, 100);
  assert.strictEqual(b!.learnerLimit, null);
  assert.strictEqual(mapLegacyCapacityToFullCode("STARTER"), "FULL_100");
  assert.strictEqual(formatLearnerCapacityLabel(null), "Unlimited");
  console.log("✓ Full ≤100 vs Full Unlimited");
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
  assert.ok(billing!.includedIn.includes("FULL_100"));
  assert.ok(billing!.includedIn.includes("FULL_UNLIMITED"));
  const core = findCommercialPackageByCode("CORE")!;
  assert.ok(packageIncludesFeature(core, billing!));
  const acc = findCommercialPackageByCode("ACCOUNTING")!;
  assert.ok(!packageIncludesFeature(acc, billing!));
  console.log("✓ Core Billing ownership in comparison");
}

function testContractFingerprint() {
  assert.strictEqual(
    COMMERCIAL_PACKAGE_CONTRACT_FINGERPRINT,
    "100|CORE|Core|1000|10000|null;010|ACCOUNTING|Accounting|750|7500|null;001|PAYROLL|Payroll|750|7500|null;011|BUSINESS|Business|1250|12500|null;110|CORE_ACCOUNTING|Core + Accounting|1500|15000|null;101|CORE_PAYROLL|Core + Payroll|1500|15000|null;111|FULL_100|Full ≤100|1500|15000|100;111|FULL_UNLIMITED|Full Unlimited|2000|20000|null"
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
  testFull100VsUnlimited();
  testPriceFormatting();
  testComparisonBillingOwnership();
  testContractFingerprint();
  console.log("\nAll educlearCommercialPackages (frontend) tests passed.");
}

main();
