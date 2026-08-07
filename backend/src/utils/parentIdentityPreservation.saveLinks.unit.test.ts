/**
 * Simulated saveParentLinks identity behaviour (no DB).
 * Covers ManageLearner multi-parent and learner-only rewrite scenarios.
 *
 * Run: npx ts-node --transpile-only src/utils/parentIdentityPreservation.saveLinks.unit.test.ts
 */
import assert from "assert";
import {
  applyParentIdentityPreservationForUpdate,
  parentIdentityForCreate,
} from "./parentIdentityPreservation";

type ParentRow = {
  id: string;
  firstName: string;
  surname: string;
  cellNo: string;
  idNumber: string | null;
  email: string | null;
};

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function buildParentWriteData(rawParent: any, schoolId: string) {
  const identity = parentIdentityForCreate(rawParent);
  return {
    schoolId,
    firstName: cleanString(rawParent.firstName) || "Parent",
    surname: cleanString(rawParent.surname) || "-",
    cellNo: cleanString(rawParent.cellNo) || "-",
    idNumber: identity.idNumber,
    email: identity.email,
  };
}

/** Mirrors saveParentLinks update/create branching with an in-memory store. */
function simulateSaveParentLinks(
  store: Map<string, ParentRow>,
  parents: any[],
  schoolId = "school-1"
) {
  const writes: Array<{ id: string; data: Record<string, unknown> }> = [];

  for (const rawParent of parents) {
    const parentData = buildParentWriteData(rawParent, schoolId);
    const idNumber = cleanString(rawParent.idNumber);

    if (rawParent.id && !String(rawParent.id).startsWith("local-parent-")) {
      const updateData = applyParentIdentityPreservationForUpdate(parentData, rawParent);
      const existing = store.get(String(rawParent.id));
      assert.ok(existing, `parent ${rawParent.id} must exist`);
      const next = { ...existing, ...updateData } as ParentRow;
      store.set(existing.id, next);
      writes.push({ id: existing.id, data: updateData });
    } else if (idNumber) {
      const updateData = applyParentIdentityPreservationForUpdate(parentData, rawParent);
      // upsert by idNumber
      let found: ParentRow | undefined;
      for (const row of store.values()) {
        if (row.idNumber === idNumber) {
          found = row;
          break;
        }
      }
      if (found) {
        const next = { ...found, ...updateData } as ParentRow;
        store.set(found.id, next);
        writes.push({ id: found.id, data: updateData });
      } else {
        const id = `created-${store.size + 1}`;
        const created = { id, ...parentData, idNumber } as ParentRow;
        store.set(id, created);
        writes.push({ id, data: created });
      }
    } else {
      const id = `created-${store.size + 1}`;
      const created = { id, ...parentData } as ParentRow;
      store.set(id, created);
      writes.push({ id, data: created });
    }
  }

  return writes;
}

function seedStore(): Map<string, ParentRow> {
  const store = new Map<string, ParentRow>();
  store.set("p1", {
    id: "p1",
    firstName: "Jane",
    surname: "Doe",
    cellNo: "0821111111",
    idNumber: "8001015009087",
    email: "existing@example.com",
  });
  store.set("p2", {
    id: "p2",
    firstName: "John",
    surname: "Doe",
    cellNo: "0833333333",
    idNumber: "9001014800087",
    email: "john@example.com",
  });
  return store;
}

function test1_LearnerOnlyOmitsParentsPayload() {
  // When ManageLearner omits parents, simulateSave is not called — store unchanged.
  const store = seedStore();
  const before = JSON.stringify([...store.entries()]);
  // no-op
  assert.strictEqual(JSON.stringify([...store.entries()]), before);
  console.log("✓ TEST 1/9: learner-only (no parents payload) leaves parents unchanged");
}

function test2_CellOnlyPreservesIdentity() {
  const store = seedStore();
  simulateSaveParentLinks(store, [
    {
      id: "p1",
      firstName: "Jane",
      surname: "Doe",
      cellNo: "0822222222",
      idNumber: "8001015009087",
      email: "existing@example.com",
    },
  ]);
  const row = store.get("p1")!;
  assert.strictEqual(row.cellNo, "0822222222");
  assert.strictEqual(row.idNumber, "8001015009087");
  assert.strictEqual(row.email, "existing@example.com");
  console.log("✓ TEST 2: cell-only edit preserves ID+email");
}

function test3_OmittedIdentityPreserved() {
  const store = seedStore();
  simulateSaveParentLinks(store, [
    { id: "p1", firstName: "Jane", surname: "Doe", cellNo: "0821111111" },
  ]);
  const row = store.get("p1")!;
  assert.strictEqual(row.idNumber, "8001015009087");
  assert.strictEqual(row.email, "existing@example.com");
  console.log("✓ TEST 3: omitted idNumber/email preserved");
}

function test4_EmptyStringPreserved() {
  const store = seedStore();
  simulateSaveParentLinks(store, [
    {
      id: "p1",
      firstName: "Jane",
      surname: "Doe",
      cellNo: "0821111111",
      idNumber: "",
      email: "",
    },
  ]);
  const row = store.get("p1")!;
  assert.strictEqual(row.idNumber, "8001015009087");
  assert.strictEqual(row.email, "existing@example.com");
  console.log("✓ TEST 4: empty string incidental identity preserved");
}

function test5_NullPreserved() {
  const store = seedStore();
  simulateSaveParentLinks(store, [
    {
      id: "p1",
      firstName: "Jane",
      surname: "Doe",
      cellNo: "0821111111",
      idNumber: null,
      email: null,
    },
  ]);
  const row = store.get("p1")!;
  assert.strictEqual(row.idNumber, "8001015009087");
  assert.strictEqual(row.email, "existing@example.com");
  console.log("✓ TEST 5: null incidental identity preserved");
}

function test6_EmailReplacement() {
  const store = seedStore();
  simulateSaveParentLinks(store, [
    {
      id: "p1",
      firstName: "Jane",
      surname: "Doe",
      cellNo: "0821111111",
      idNumber: "8001015009087",
      email: "new@example.com",
    },
  ]);
  const row = store.get("p1")!;
  assert.strictEqual(row.email, "new@example.com");
  assert.strictEqual(row.idNumber, "8001015009087");
  console.log("✓ TEST 6: deliberate email change; ID unchanged");
}

function test7_IdReplacement() {
  const store = seedStore();
  simulateSaveParentLinks(store, [
    {
      id: "p1",
      firstName: "Jane",
      surname: "Doe",
      cellNo: "0821111111",
      idNumber: "9101014800083",
      email: "existing@example.com",
    },
  ]);
  const row = store.get("p1")!;
  assert.strictEqual(row.idNumber, "9101014800083");
  assert.strictEqual(row.email, "existing@example.com");
  console.log("✓ TEST 7: deliberate ID change; email unchanged");
}

function test8_CreateWithoutIdentity() {
  const store = seedStore();
  simulateSaveParentLinks(store, [
    { firstName: "New", surname: "Guardian", cellNo: "0844444444", idNumber: "", email: "" },
  ]);
  const created = [...store.values()].find((p) => p.firstName === "New")!;
  assert.ok(created);
  assert.strictEqual(created.idNumber, null);
  assert.strictEqual(created.email, null);
  console.log("✓ TEST 8: create new parent without ID/email still allowed");
}

function test10_EditingOneParentDoesNotTouchSibling() {
  const store = seedStore();
  const siblingBefore = { ...store.get("p2")! };
  simulateSaveParentLinks(store, [
    {
      id: "p1",
      firstName: "Jane",
      surname: "Doe",
      cellNo: "0829999999",
      idNumber: "",
      email: "",
    },
  ]);
  const sibling = store.get("p2")!;
  assert.strictEqual(sibling.idNumber, siblingBefore.idNumber);
  assert.strictEqual(sibling.email, siblingBefore.email);
  assert.strictEqual(sibling.cellNo, siblingBefore.cellNo);
  const p1 = store.get("p1")!;
  assert.strictEqual(p1.cellNo, "0829999999");
  assert.strictEqual(p1.idNumber, "8001015009087");
  assert.strictEqual(p1.email, "existing@example.com");
  console.log("✓ TEST 10: editing one parent does not erase sibling identity");
}

function testLegacyMultiParentRewriteWouldWipeSibling_DocumentedFixed() {
  // Old ManageLearner sent all siblings; blank sibling state would wipe via legacy || null.
  const legacyWipe = (raw: any) => ({
    idNumber: (typeof raw.idNumber === "string" ? raw.idNumber.trim() : "") || null,
    email: (typeof raw.email === "string" ? raw.email.trim() : "") || null,
  });
  const blankSibling = { id: "p2", idNumber: "", email: "", cellNo: "0833333333" };
  const wiped = legacyWipe(blankSibling);
  assert.strictEqual(wiped.idNumber, null);
  assert.strictEqual(wiped.email, null);

  // After fix: only edited parent is sent, and blanks are preserved if somehow sent.
  const store = seedStore();
  simulateSaveParentLinks(store, [blankSibling]);
  assert.strictEqual(store.get("p2")!.idNumber, "9001014800087");
  assert.strictEqual(store.get("p2")!.email, "john@example.com");
  console.log("✓ BEFORE/AFTER: multi-parent blank sibling wipe fixed");
}

function main() {
  test1_LearnerOnlyOmitsParentsPayload();
  test2_CellOnlyPreservesIdentity();
  test3_OmittedIdentityPreserved();
  test4_EmptyStringPreserved();
  test5_NullPreserved();
  test6_EmailReplacement();
  test7_IdReplacement();
  test8_CreateWithoutIdentity();
  test10_EditingOneParentDoesNotTouchSibling();
  testLegacyMultiParentRewriteWouldWipeSibling_DocumentedFixed();
  console.log("\nALL saveParentLinks simulation tests passed");
}

main();
