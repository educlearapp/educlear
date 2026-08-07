/**
 * Parent ID/email preservation on partial updates.
 *
 * Run: npx ts-node --transpile-only src/utils/parentIdentityPreservation.unit.test.ts
 *
 * Documents the OLD wipe behaviour (reproduced via the previous
 * `value || null` pattern) and asserts the NEW preserve semantics.
 */
import assert from "assert";
import {
  applyParentIdentityPreservationForUpdate,
  parentIdentityForCreate,
  parentIdentityForUpdate,
} from "./parentIdentityPreservation";

/** Legacy wipe semantics from buildParentWriteData before the fix. */
function legacyIdentityWrite(raw: { idNumber?: unknown; email?: unknown }) {
  const clean = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    idNumber: clean(raw.idNumber) || null,
    email: clean(raw.email) || null,
  };
}

function testBeforeFixReproduction_EmptyWipesExisting() {
  const existing = {
    idNumber: "8001015009087",
    email: "existing@example.com",
  };
  const incidentalBlankPayload = { idNumber: "", email: "", cellNo: "0821111111" };
  const wiped = legacyIdentityWrite(incidentalBlankPayload);

  assert.strictEqual(wiped.idNumber, null, "OLD: empty idNumber became null");
  assert.strictEqual(wiped.email, null, "OLD: empty email became null");
  assert.notStrictEqual(
    wiped.idNumber,
    existing.idNumber,
    "OLD: would overwrite stored ID"
  );
  assert.notStrictEqual(wiped.email, existing.email, "OLD: would overwrite stored email");
  console.log("✓ BEFORE-FIX reproduction: empty → null wipe");
}

function testBeforeFixReproduction_NullWipesExisting() {
  const wiped = legacyIdentityWrite({ idNumber: null, email: null });
  assert.strictEqual(wiped.idNumber, null);
  assert.strictEqual(wiped.email, null);
  console.log("✓ BEFORE-FIX reproduction: null → null wipe");
}

function testCaseA_OmittedFieldsDoNotAppearInUpdate() {
  const update = parentIdentityForUpdate({ cellNo: "0821111111" } as {
    idNumber?: unknown;
    email?: unknown;
  });
  assert.strictEqual(update.idNumber, undefined);
  assert.strictEqual(update.email, undefined);
  assert.deepStrictEqual(Object.keys(update), []);
  console.log("✓ CASE A: omitted idNumber/email → no update keys");
}

function testCaseB_UndefinedFieldsDoNotAppearInUpdate() {
  const update = parentIdentityForUpdate({
    idNumber: undefined,
    email: undefined,
  });
  // hasOwnProperty is true for explicit undefined on a plain object assigned that way
  const raw = {} as { idNumber?: unknown; email?: unknown };
  raw.idNumber = undefined;
  raw.email = undefined;
  const update2 = parentIdentityForUpdate(raw);
  assert.deepStrictEqual(update2, {});
  console.log("✓ CASE B: undefined → preserve (omit)");
}

function testCaseC_EmptyStringDoesNotClear() {
  const update = parentIdentityForUpdate({ idNumber: "", email: "" });
  assert.deepStrictEqual(update, {});
  console.log("✓ CASE C: empty string → preserve (omit)");
}

function testCaseD_NullDoesNotClear() {
  const update = parentIdentityForUpdate({ idNumber: null, email: null });
  assert.deepStrictEqual(update, {});
  console.log("✓ CASE D: null → preserve (omit)");
}

function testCaseE_ValidEmailReplacementKeepsIdOmitted() {
  const update = parentIdentityForUpdate({
    email: "new@example.com",
  });
  assert.strictEqual(update.email, "new@example.com");
  assert.strictEqual(update.idNumber, undefined);
  console.log("✓ CASE E: valid email replacement; id omitted");
}

function testCaseE_ValidIdReplacementKeepsEmailOmitted() {
  const update = parentIdentityForUpdate({
    idNumber: "9001014800087",
  });
  assert.strictEqual(update.idNumber, "9001014800087");
  assert.strictEqual(update.email, undefined);
  console.log("✓ CASE E: valid idNumber replacement; email omitted");
}

function testCreateStillAllowsNullIdentity() {
  const created = parentIdentityForCreate({ idNumber: "", email: "" });
  assert.strictEqual(created.idNumber, null);
  assert.strictEqual(created.email, null);

  const createdPartial = parentIdentityForCreate({
    idNumber: "8001015009087",
    email: "",
  });
  assert.strictEqual(createdPartial.idNumber, "8001015009087");
  assert.strictEqual(createdPartial.email, null);
  console.log("✓ CREATE: blank identity still becomes null");
}

function testApplyPreservationStripsBlankFromWriteData() {
  const writeData = {
    schoolId: "school-1",
    firstName: "Jane",
    surname: "Doe",
    cellNo: "0822222222",
    idNumber: null as string | null,
    email: null as string | null,
  };
  const preserved = applyParentIdentityPreservationForUpdate(writeData, {
    idNumber: "",
    email: null,
  });
  assert.strictEqual("idNumber" in preserved, false);
  assert.strictEqual("email" in preserved, false);
  assert.strictEqual(preserved.cellNo, "0822222222");
  console.log("✓ applyParentIdentityPreservationForUpdate strips blank identity");
}

function testApplyPreservationKeepsLegitimateReplacement() {
  const writeData = {
    schoolId: "school-1",
    firstName: "Jane",
    surname: "Doe",
    cellNo: "0822222222",
    idNumber: "9001014800087",
    email: "new@example.com",
  };
  const preserved = applyParentIdentityPreservationForUpdate(writeData, {
    idNumber: "9001014800087",
    email: "new@example.com",
  });
  assert.strictEqual(preserved.idNumber, "9001014800087");
  assert.strictEqual(preserved.email, "new@example.com");
  console.log("✓ applyParentIdentityPreservationForUpdate keeps replacements");
}

function testWhitespaceOnlyTreatedAsBlank() {
  assert.deepStrictEqual(parentIdentityForUpdate({ idNumber: "  ", email: "\t" }), {});
  console.log("✓ whitespace-only identity → preserve");
}

function main() {
  testBeforeFixReproduction_EmptyWipesExisting();
  testBeforeFixReproduction_NullWipesExisting();
  testCaseA_OmittedFieldsDoNotAppearInUpdate();
  testCaseB_UndefinedFieldsDoNotAppearInUpdate();
  testCaseC_EmptyStringDoesNotClear();
  testCaseD_NullDoesNotClear();
  testCaseE_ValidEmailReplacementKeepsIdOmitted();
  testCaseE_ValidIdReplacementKeepsEmailOmitted();
  testCreateStillAllowsNullIdentity();
  testApplyPreservationStripsBlankFromWriteData();
  testApplyPreservationKeepsLegitimateReplacement();
  testWhitespaceOnlyTreatedAsBlank();
  console.log("\nALL parentIdentityPreservation tests passed");
}

main();
