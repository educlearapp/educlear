/**
 * EduClear vs ledger-join account number helpers.
 * Run: npx tsx src/services/familyAccountNumber.test.ts
 */
import {
  formatAccountNoWithSource,
  resolveEduClearAccountNo,
  resolveLedgerJoinAccountRef,
  resolveVisibleAccountNo,
} from "./familyAccountNumber";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function testDaSilvaKidESysUsesAccountRefUntilDedicatedSet() {
  const family = { accountRef: "ADA004", accountNo: null };
  assert(resolveEduClearAccountNo(family) === "ADA004", "Kid-e-Sys accountRef is the visible number");
  assert(resolveLedgerJoinAccountRef(family) === "ADA004", "ledger join stays accountRef");
  assert(resolveVisibleAccountNo(family) === "ADA004", "display is ADA004");
  assert(formatAccountNoWithSource(family) === "ADA004", "no duplicate source when they match");
  console.log("✓ Da Silva / MBB Kid-e-Sys accountRef remains the number");
}

function testFlyEagleExpressIsJoinNotEduClearNumber() {
  const family = { accountRef: "ABAYE TUMO ASHANAFY", accountNo: null };
  assert(resolveEduClearAccountNo(family) === "", "Express name is not an EduClear number");
  assert(resolveLedgerJoinAccountRef(family) === "ABAYE TUMO ASHANAFY", "ledger join is Express ref");
  assert(resolveVisibleAccountNo(family) === "ABAYE TUMO ASHANAFY", "until backfill, show Express ref");
  console.log("✓ Fly Eagle Express ref is join key, not EduClear number");
}

function testFlyEagleAfterDedicatedAssignment() {
  const family = { accountRef: "ABAYE TUMO ASHANAFY", accountNo: "ABA001" };
  assert(resolveEduClearAccountNo(family) === "ABA001", "dedicated accountNo is the EduClear number");
  assert(resolveLedgerJoinAccountRef(family) === "ABAYE TUMO ASHANAFY", "ledger join unchanged");
  assert(resolveVisibleAccountNo(family) === "ABA001", "staff display is ABA001");
  assert(
    formatAccountNoWithSource(family) === "ABA001 — ABAYE TUMO ASHANAFY",
    "display keeps Express context"
  );
  console.log("✓ Fly Eagle display uses ABA001 without replacing Express join");
}

function testNativeNewFamilyWritesSameCodeBothFields() {
  const family = { accountRef: "MOK017", accountNo: "MOK017" };
  assert(resolveEduClearAccountNo(family) === "MOK017", "native number");
  assert(resolveLedgerJoinAccountRef(family) === "MOK017", "native ledger join");
  assert(formatAccountNoWithSource(family) === "MOK017", "no doubled label");
  console.log("✓ native enrolment uses one code for number and join");
}

testDaSilvaKidESysUsesAccountRefUntilDedicatedSet();
testFlyEagleExpressIsJoinNotEduClearNumber();
testFlyEagleAfterDedicatedAssignment();
testNativeNewFamilyWritesSameCodeBothFields();
console.log("\nAll familyAccountNumber tests passed.");
