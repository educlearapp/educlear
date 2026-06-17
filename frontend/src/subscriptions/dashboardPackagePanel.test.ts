/**
 * Dashboard package panel logic tests.
 * Run: npx tsx src/subscriptions/dashboardPackagePanel.test.ts
 */
import {
  findPackageByCode,
  getPackageSwitchButtonLabel,
  isCurrentActivePackage,
  isPackageSwitchDisabled,
  resolveDisplayedCurrentPackage,
} from "./dashboardPackagePanelLogic";
import type { EduClearPackage } from "./subscriptionsApi";

const PACKAGES: EduClearPackage[] = [
  {
    id: "1",
    code: "STARTER",
    name: "Starter",
    monthlyPriceCents: 150_000,
    monthlyPriceZar: 1500,
    priceLabel: "R1,500 / month",
    learnerLimit: 100,
    payrollStaffLimit: 15,
    mostPopular: false,
    description: "Starter",
    isActive: true,
  },
  {
    id: "2",
    code: "UNLIMITED",
    name: "Unlimited",
    monthlyPriceCents: 200_000,
    monthlyPriceZar: 2000,
    priceLabel: "R2,000 / month",
    learnerLimit: null,
    payrollStaffLimit: null,
    mostPopular: true,
    description: "Unlimited",
    isActive: true,
  },
];

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function testRendersCurrentUnlimitedFromApi() {
  const current = resolveDisplayedCurrentPackage(PACKAGES, "UNLIMITED", PACKAGES[1]);
  assert(current?.code === "UNLIMITED", "current package should be Unlimited from API");
  assert(current?.name === "Unlimited", "shows Unlimited name");
  console.log("✓ renders current Unlimited from API");
}

function testCurrentPackageButtonDisabledWhenActive() {
  const disabled = isPackageSwitchDisabled(
    "UNLIMITED",
    "UNLIMITED",
    "ACTIVE",
    false,
    true,
    true
  );
  assert(disabled, "current Unlimited + ACTIVE should disable button");
  const label = getPackageSwitchButtonLabel("UNLIMITED", "UNLIMITED", "ACTIVE", false);
  assert(label === "Current Package", "label should be Current Package");
  console.log("✓ current package button disabled when ACTIVE");
}

function testSwitchLabelForDifferentPackage() {
  const label = getPackageSwitchButtonLabel("STARTER", "UNLIMITED", "ACTIVE", false);
  assert(label === "Switch to Unlimited", "different package shows switch label");
  const disabled = isPackageSwitchDisabled("STARTER", "UNLIMITED", "ACTIVE", false, true, true);
  assert(!disabled, "switch button enabled for ACTIVE Starter -> Unlimited");
  console.log("✓ switch label for different package");
}

function testPendingPaymentAllowsCheckoutForSelectedPackage() {
  assert(
    !isCurrentActivePackage("STARTER", "UNLIMITED", "PENDING_PAYMENT"),
    "pending payment is not current active package"
  );
  const label = getPackageSwitchButtonLabel("STARTER", "UNLIMITED", "PENDING_PAYMENT", false);
  assert(label === "Switch to Unlimited", "pending payment can switch package label");
  console.log("✓ pending payment allows checkout for selected package");
}

function testFindPackageByCode() {
  assert(findPackageByCode(PACKAGES, "starter")?.code === "STARTER", "finds starter case-insensitive");
  console.log("✓ findPackageByCode");
}

function main() {
  testRendersCurrentUnlimitedFromApi();
  testCurrentPackageButtonDisabledWhenActive();
  testSwitchLabelForDifferentPackage();
  testPendingPaymentAllowsCheckoutForSelectedPackage();
  testFindPackageByCode();
  console.log("\nAll dashboardPackagePanel tests passed.");
}

main();
