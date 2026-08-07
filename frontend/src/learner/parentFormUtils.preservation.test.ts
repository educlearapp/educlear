/**
 * Frontend parent payload preservation helpers.
 * Run from frontend/: npx --yes tsx src/learner/parentFormUtils.preservation.test.ts
 */
import assert from "node:assert/strict";
import { parentToApiPayload } from "./parentFormUtils";
import type { ParentRecord } from "./parentFormTypes";

function baseParent(overrides: Partial<ParentRecord> = {}): ParentRecord {
  return {
    id: "parent-1",
    relationship: "Parent",
    firstName: "Jane",
    surname: "Doe",
    idNumber: "8001015009087",
    email: "existing@example.com",
    cellNo: "0821111111",
    ...overrides,
  };
}

function testOmitBlankIdentity() {
  const payload = parentToApiPayload(
    baseParent({ idNumber: "", email: "" })
  ) as Record<string, unknown>;
  assert.equal("idNumber" in payload, false);
  assert.equal("email" in payload, false);
  assert.equal(payload.cellNo, "0821111111");
  console.log("✓ parentToApiPayload omits blank idNumber/email");
}

function testKeepsNonEmptyIdentity() {
  const payload = parentToApiPayload(baseParent()) as Record<string, unknown>;
  assert.equal(payload.idNumber, "8001015009087");
  assert.equal(payload.email, "existing@example.com");
  console.log("✓ parentToApiPayload keeps non-empty identity");
}

function testCellOnlyEditKeepsIdentityInPayload() {
  const draft = baseParent({ cellNo: "0822222222" });
  const payload = parentToApiPayload(draft) as Record<string, unknown>;
  assert.equal(payload.cellNo, "0822222222");
  assert.equal(payload.idNumber, "8001015009087");
  assert.equal(payload.email, "existing@example.com");
  console.log("✓ cell-only draft still sends identity when present in state");
}

function testEmailOnlyChangeOmitsBlankId() {
  const payload = parentToApiPayload(
    baseParent({ idNumber: "", email: "new@example.com" })
  ) as Record<string, unknown>;
  assert.equal("idNumber" in payload, false);
  assert.equal(payload.email, "new@example.com");
  console.log("✓ email change with blank id omits idNumber key");
}

function main() {
  testOmitBlankIdentity();
  testKeepsNonEmptyIdentity();
  testCellOnlyEditKeepsIdentityInPayload();
  testEmailOnlyChangeOmitsBlankId();
  console.log("\nALL parentFormUtils preservation tests passed");
}

main();
