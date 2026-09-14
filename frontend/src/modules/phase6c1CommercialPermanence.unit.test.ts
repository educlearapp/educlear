/**
 * Phase 6C.1 frontend permanence checks.
 * Run: npx tsx src/modules/phase6c1CommercialPermanence.unit.test.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  EDUCLEAR_COMMERCIAL_PACKAGES,
  findCommercialPackageByModules,
  formatCommercialPackagePrice,
  listNewSaleCommercialPackages,
} from "./educlearCommercialPackages";
import { isModularCheckoutAvailable } from "../subscriptions/dashboardPackagePanelLogic";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FE_SRC = path.join(__dirname, "..");

function testSingleSourcePrices() {
  const core = findCommercialPackageByModules({
    CORE: true,
    ACCOUNTING: false,
    PAYROLL: false,
  })!;
  assert.strictEqual(formatCommercialPackagePrice(core, "monthly"), "R1,000 / month");
  const accounting = findCommercialPackageByModules({
    CORE: false,
    ACCOUNTING: true,
    PAYROLL: false,
  })!;
  assert.strictEqual(formatCommercialPackagePrice(accounting, "monthly"), "R750 / month");
  const full = findCommercialPackageByModules({
    CORE: true,
    ACCOUNTING: true,
    PAYROLL: true,
  })!;
  assert.strictEqual(formatCommercialPackagePrice(full, "monthly"), "R2,000 / month");
  // Mutating the live catalogue object would affect runtime — prove surfaces import catalogue.
  assert.strictEqual(EDUCLEAR_COMMERCIAL_PACKAGES[0].monthlyPriceZar, 1000);
  console.log("✓ entitlement → catalogue prices");
}

function testNoHardcodedLegacySalePrices() {
  const files = [
    "subscriptions/DashboardPackagePanel.tsx",
    "subscriptions/SubscriptionPackages.tsx",
    "subscriptions/SubscriptionStatus.tsx",
    "subscriptions/payfastCheckout.ts",
  ];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(FE_SRC, rel), "utf8");
    assert.ok(!text.includes("R1,500 / month"), rel);
    assert.ok(!text.includes('"R1,500"'), rel);
    assert.ok(!/STARTER:\s*"R1/.test(text), rel);
    assert.ok(!/UNLIMITED:\s*"R2/.test(text), rel);
  }
  console.log("✓ no active hardcoded Starter/Unlimited sale prices in subscription UI");
}

function testStatusUsesCommercialPackage() {
  const status = fs.readFileSync(
    path.join(FE_SRC, "subscriptions/SubscriptionStatus.tsx"),
    "utf8"
  );
  assert.ok(status.includes("commercialPackage"));
  assert.ok(!status.includes("getPackageDisplayPrice"));
  console.log("✓ Subscription Status derives from commercialPackage");
}

function testCheckoutDisabled() {
  assert.strictEqual(isModularCheckoutAvailable(), false);
  assert.strictEqual(listNewSaleCommercialPackages().length, 7);
  console.log("✓ modular checkout disabled + 7 packages");
}

function testLegalCopyUpdated() {
  const refund = fs.readFileSync(
    path.join(FE_SRC, "pages/RefundAndCancellationPolicy.tsx"),
    "utf8"
  );
  assert.ok(refund.includes("Modular Packages") || refund.includes("modular"));
  assert.ok(!refund.includes("title: \"3. Starter & Unlimited Packages\""));
  const terms = fs.readFileSync(path.join(FE_SRC, "pages/TermsAndConditions.tsx"), "utf8");
  assert.ok(terms.includes("modular subscription packages") || terms.includes("Core, Accounting, Payroll"));
  console.log("✓ legal copy updated for modular packages");
}

function main() {
  testSingleSourcePrices();
  testNoHardcodedLegacySalePrices();
  testStatusUsesCommercialPackage();
  testCheckoutDisabled();
  testLegalCopyUpdated();
  console.log("\nAll phase6c1 frontend permanence tests passed.");
}

main();
