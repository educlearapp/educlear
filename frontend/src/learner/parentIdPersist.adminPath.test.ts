/**
 * Frontend Admin path: payload shape, wrong-button guard, duplicate error UX.
 * Run: npx esbuild src/learner/parentIdPersist.adminPath.test.ts --bundle --platform=node --outfile=/tmp/p.admin.js --format=cjs && node /tmp/p.admin.js
 */
import assert from "node:assert/strict";
import {
  parentIdDraftNeedsSaveParent,
  PARENT_ID_USE_SAVE_PARENT_MESSAGE,
  parentToApiPayload,
} from "./parentFormUtils";
import {
  canViewExistingParentConflict,
  parseParentIdConflictPayload,
  PARENT_ID_ALREADY_EXISTS,
  PARENT_ID_CONFLICT_MESSAGE,
  ParentIdConflictClientError,
} from "./parentIdConflict";

function testAdminPayloadContainsTypedId() {
  const payload = parentToApiPayload({
    id: "parent-1",
    firstName: "Parent",
    surname: "Example",
    idNumber: "8901015009087",
    cellNo: "0000000000",
    email: "a@b.c",
  });
  assert.equal(payload.idNumber, "8901015009087");
  assert.equal(payload.id, "parent-1");
  console.log("✓ Admin Save Parent payload includes typed idNumber");
}

function testBlankOmittedFromPayload() {
  const payload = parentToApiPayload({
    id: "parent-1",
    firstName: "Parent",
    surname: "Example",
    idNumber: "",
    cellNo: "0000000000",
  });
  assert.equal("idNumber" in payload, false);
  console.log("✓ blank idNumber omitted from Admin payload (preserve path)");
}

function testLearnerSaveGuardWhenDraftHasNewId() {
  assert.equal(
    parentIdDraftNeedsSaveParent({
      mode: "manage",
      draft: { id: "p1", idNumber: "8901015009087", firstName: "A", surname: "B", cellNo: "1" },
      linkedParents: [{ id: "p1", idNumber: "", firstName: "A", surname: "B", cellNo: "1" }],
    }),
    true
  );
  assert.equal(
    parentIdDraftNeedsSaveParent({
      mode: "manage",
      draft: { id: "p1", idNumber: "8901015009087", firstName: "A", surname: "B", cellNo: "1" },
      linkedParents: [{ id: "p1", idNumber: "8901015009087", firstName: "A", surname: "B", cellNo: "1" }],
    }),
    false
  );
  assert.equal(
    PARENT_ID_USE_SAVE_PARENT_MESSAGE,
    "You have unsaved parent details. Please click Save Parent before saving the learner."
  );
  console.log("✓ learner Save blocked while unsaved parent ID draft open");
}

function testDuplicateVisibleErrorAndNav() {
  const parsed = parseParentIdConflictPayload({
    success: false,
    code: PARENT_ID_ALREADY_EXISTS,
    message: PARENT_ID_CONFLICT_MESSAGE,
    idNumber: "8901015009087",
    existingParent: {
      id: "owner",
      schoolId: "s",
      firstName: "Jane",
      surname: "Doe",
      cellNo: "082",
      email: null,
      idNumber: "8901015009087",
      familyAccountId: null,
      primaryLearnerId: "learner-99",
    },
  });
  assert.ok(parsed);
  assert.equal(
    parsed!.message,
    "This ID number already belongs to another parent record and cannot be assigned here."
  );
  const err = new ParentIdConflictClientError(parsed!);
  assert.equal(err.message, PARENT_ID_CONFLICT_MESSAGE);
  assert.equal(parsed!.existingParent?.primaryLearnerId, "learner-99");

  const store: Record<string, string> = { userRole: "SCHOOL_ADMIN", isOwner: "false", userAppRole: "" };
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
  assert.equal(canViewExistingParentConflict(), true);
  console.log("✓ duplicate 409 → visible message + View existing parent target");
}

function main() {
  testAdminPayloadContainsTypedId();
  testBlankOmittedFromPayload();
  testLearnerSaveGuardWhenDraftHasNewId();
  testDuplicateVisibleErrorAndNav();
  console.log("\nALL parentIdPersist.adminPath frontend tests passed");
}

main();
