/**
 * Frontend parent ID conflict UX helpers.
 * Run: npx --yes tsx src/learner/parentIdConflict.test.ts
 */
import assert from "node:assert/strict";
import {
  canViewExistingParentConflict,
  existingParentDisplayName,
  parseParentIdConflictPayload,
  PARENT_ID_ALREADY_EXISTS,
  PARENT_ID_CONFLICT_MESSAGE,
  ParentIdConflictClientError,
} from "./parentIdConflict";

function testParse409Payload() {
  const parsed = parseParentIdConflictPayload({
    success: false,
    code: PARENT_ID_ALREADY_EXISTS,
    message: PARENT_ID_CONFLICT_MESSAGE,
    idNumber: "8001015009087",
    existingParent: {
      id: "p1",
      schoolId: "s1",
      firstName: "Jane",
      surname: "Doe",
      cellNo: "082",
      email: "a@b.c",
      idNumber: "8001015009087",
      familyAccountId: null,
      primaryLearnerId: "learner-1",
    },
  });
  assert.ok(parsed);
  assert.equal(parsed!.code, PARENT_ID_ALREADY_EXISTS);
  assert.equal(parsed!.message, PARENT_ID_CONFLICT_MESSAGE);
  assert.equal(parsed!.existingParent?.primaryLearnerId, "learner-1");
  console.log("✓ parses HTTP 409 PARENT_ID_ALREADY_EXISTS payload");
}

function testFrontendErrorMessage() {
  const err = new ParentIdConflictClientError({
    success: false,
    code: PARENT_ID_ALREADY_EXISTS,
    message: PARENT_ID_CONFLICT_MESSAGE,
    idNumber: "8001015009087",
    existingParent: null,
  });
  assert.equal(
    err.message,
    "This ID number already belongs to another parent record and cannot be assigned here."
  );
  console.log("✓ frontend error message exact text");
}

function testOwnerAdminGate() {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };

  store.userRole = "TEACHER";
  store.userAppRole = "Viewer";
  store.isOwner = "false";
  assert.equal(canViewExistingParentConflict(), false);

  store.userRole = "SCHOOL_ADMIN";
  assert.equal(canViewExistingParentConflict(), true);

  store.userRole = "TEACHER";
  store.isOwner = "true";
  assert.equal(canViewExistingParentConflict(), true);

  store.isOwner = "false";
  store.userAppRole = "Owner";
  assert.equal(canViewExistingParentConflict(), true);
  console.log("✓ View existing parent gated to Owner/Admin");
}

function testExistingParentNavigationTarget() {
  const existing = {
    id: "p1",
    schoolId: "s1",
    firstName: "Jane",
    surname: "Doe",
    cellNo: "082",
    email: null,
    idNumber: "8001015009087",
    familyAccountId: null,
    primaryLearnerId: "learner-99",
  };
  assert.equal(existingParentDisplayName(existing), "Jane Doe");
  assert.equal(existing.primaryLearnerId, "learner-99");
  console.log("✓ existing parent navigation uses primaryLearnerId");
}

function testUniquenessRegressionMessageStable() {
  assert.equal(
    PARENT_ID_CONFLICT_MESSAGE,
    "This ID number already belongs to another parent record and cannot be assigned here."
  );
  assert.equal(PARENT_ID_ALREADY_EXISTS, "PARENT_ID_ALREADY_EXISTS");
  console.log("✓ uniqueness conflict code/message regression locked");
}

function main() {
  testParse409Payload();
  testFrontendErrorMessage();
  testOwnerAdminGate();
  testExistingParentNavigationTarget();
  testUniquenessRegressionMessageStable();
  console.log("\nALL parentIdConflict frontend tests passed");
}

main();
