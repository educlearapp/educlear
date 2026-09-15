/**
 * Learner-limit enforcement unit tests (feature-flagged).
 * Run: npx tsx src/services/learnerLimitEnforcement.unit.test.ts
 *
 * Synthetic only — no live school mutation.
 */
import assert from "assert";

import {
  LEARNER_LIMIT_ENFORCEMENT_ENV,
  isLearnerLimitEnforcementEnabled,
  resolvePackageForCapacity,
} from "./learnerLimitEnforcement";
import {
  findCommercialPackageByModules,
  formatLearnerCapacityLabel,
  mapLegacyCapacityToFullCode,
} from "./educlearCommercialPackages";

function testFlagDefaultsOff() {
  assert.strictEqual(isLearnerLimitEnforcementEnabled({}), false);
  assert.strictEqual(
    isLearnerLimitEnforcementEnabled({ [LEARNER_LIMIT_ENFORCEMENT_ENV]: "" }),
    false
  );
  assert.strictEqual(
    isLearnerLimitEnforcementEnabled({ [LEARNER_LIMIT_ENFORCEMENT_ENV]: "false" }),
    false
  );
  assert.strictEqual(
    isLearnerLimitEnforcementEnabled({ [LEARNER_LIMIT_ENFORCEMENT_ENV]: "true" }),
    true
  );
  assert.strictEqual(
    isLearnerLimitEnforcementEnabled({ [LEARNER_LIMIT_ENFORCEMENT_ENV]: "1" }),
    true
  );
  console.log("✓ ENFORCE_LEARNER_LIMITS defaults off; true/1 enable");
}

function testSyntheticFull100Capacity() {
  const ents = { CORE: true, ACCOUNTING: true, PAYROLL: true };
  const pkg = resolvePackageForCapacity(ents, "STARTER");
  assert.strictEqual(pkg?.code, "FULL_100");
  assert.strictEqual(pkg?.learnerLimit, 100);
  assert.strictEqual(formatLearnerCapacityLabel(pkg!.learnerLimit), "Up to 100 learners");

  // Synthetic: 100 active → at limit; 101 → over
  const limit = pkg!.learnerLimit!;
  assert.strictEqual(100 >= limit, true);
  assert.strictEqual(99 >= limit, false);
  console.log("✓ synthetic Full ≤100 capacity gate math");
}

function testSyntheticFullUnlimitedNeverBlocks() {
  const ents = { CORE: true, ACCOUNTING: true, PAYROLL: true };
  const pkg = resolvePackageForCapacity(ents, "UNLIMITED");
  assert.strictEqual(pkg?.code, "FULL_UNLIMITED");
  assert.strictEqual(pkg?.learnerLimit, null);
  // Unlimited never at-limit regardless of count
  const active = 10_000;
  const atOrOver = pkg!.learnerLimit != null && active >= pkg!.learnerLimit;
  assert.strictEqual(atOrOver, false);
  console.log("✓ synthetic Full Unlimited never blocks");
}

function testFailOpenMissingLegacyMapsUnlimited() {
  const ents = { CORE: true, ACCOUNTING: true, PAYROLL: true };
  assert.strictEqual(mapLegacyCapacityToFullCode(undefined), "FULL_UNLIMITED");
  const pkg = findCommercialPackageByModules(ents, { legacyPackageCode: null });
  assert.strictEqual(pkg?.code, "FULL_UNLIMITED");
  console.log("✓ missing legacy capacity → Full Unlimited (no downgrade)");
}

function testCoreOnlyUnlimitedCapacityMetadata() {
  const pkg = resolvePackageForCapacity(
    { CORE: true, ACCOUNTING: false, PAYROLL: false },
    "STARTER"
  );
  assert.strictEqual(pkg?.code, "CORE");
  assert.strictEqual(pkg?.learnerLimit, null);
  console.log("✓ non-Full SKUs have null learnerLimit metadata");
}

function main() {
  testFlagDefaultsOff();
  testSyntheticFull100Capacity();
  testSyntheticFullUnlimitedNeverBlocks();
  testFailOpenMissingLegacyMapsUnlimited();
  testCoreOnlyUnlimitedCapacityMetadata();
  console.log("\nAll learnerLimitEnforcement unit tests passed.");
}

main();
