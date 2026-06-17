/**
 * Subscription PayFast checkout helpers.
 * Run: npx tsx src/services/subscriptionPayfastCheckout.test.ts
 */
import { SchoolSubscriptionStatus } from "@prisma/client";

import {
  readCheckoutTargetPackageCode,
  resolvePaidPackageFromCheckout,
  shouldPersistPackageOnSubscriptionBeforePayment,
} from "./subscriptionPayfastCheckout";

const PACKAGES = [
  { id: "pkg-starter", code: "STARTER" as const, monthlyPriceCents: 150_000 },
  { id: "pkg-unlimited", code: "UNLIMITED" as const, monthlyPriceCents: 200_000 },
];

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function testPendingPaymentAllowsPreCheckoutPackagePersist() {
  assert(
    shouldPersistPackageOnSubscriptionBeforePayment(SchoolSubscriptionStatus.PENDING_PAYMENT),
    "PENDING_PAYMENT should persist package before payment"
  );
  console.log("✓ PENDING_PAYMENT pre-checkout package persist");
}

function testActiveBlocksPreCheckoutPackagePersist() {
  assert(
    !shouldPersistPackageOnSubscriptionBeforePayment(SchoolSubscriptionStatus.ACTIVE),
    "ACTIVE should not persist package before payment"
  );
  console.log("✓ ACTIVE blocks pre-checkout package persist");
}

function testReadTargetPackageFromPaymentLog() {
  const raw = {
    checkoutType: "SUBSCRIPTION",
    packageCode: "UNLIMITED",
    targetPackageCode: "UNLIMITED",
    targetPackageId: "pkg-unlimited",
    subscriptionStatusAtCheckout: "ACTIVE",
  };
  assert(readCheckoutTargetPackageCode(raw) === "UNLIMITED", "reads UNLIMITED from payment log");
  console.log("✓ read target package from payment log");
}

function testResolvePaidPackageForActiveUpgradeCheckout() {
  const raw = {
    targetPackageCode: "UNLIMITED",
    packageCode: "UNLIMITED",
    subscriptionStatusAtCheckout: "ACTIVE",
  };
  const paid = resolvePaidPackageFromCheckout(raw, 200_000, PACKAGES);
  assert(paid?.code === "UNLIMITED", "ACTIVE upgrade checkout resolves UNLIMITED package");
  assert(paid?.id === "pkg-unlimited", "includes package id for ITN update");
  console.log("✓ ACTIVE upgrade checkout resolves paid package");
}

function testResolvePaidPackageForFirstTimeStarter() {
  const raw = {
    targetPackageCode: "STARTER",
    packageCode: "STARTER",
    subscriptionStatusAtCheckout: "PENDING_PAYMENT",
  };
  const paid = resolvePaidPackageFromCheckout(raw, 150_000, PACKAGES);
  assert(paid?.code === "STARTER", "first-time Starter checkout resolves STARTER");
  console.log("✓ first-time Starter checkout resolves paid package");
}

function testAmountFallbackWhenMetadataMissing() {
  const paid = resolvePaidPackageFromCheckout({}, 150_000, PACKAGES);
  assert(paid?.code === "STARTER", "amount fallback selects STARTER for R1,500");
  console.log("✓ amount fallback resolves package");
}

function main() {
  testPendingPaymentAllowsPreCheckoutPackagePersist();
  testActiveBlocksPreCheckoutPackagePersist();
  testReadTargetPackageFromPaymentLog();
  testResolvePaidPackageForActiveUpgradeCheckout();
  testResolvePaidPackageForFirstTimeStarter();
  testAmountFallbackWhenMetadataMissing();
  console.log("\nAll subscriptionPayfastCheckout tests passed.");
}

main();
