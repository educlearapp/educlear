/**
 * Learner parent list must come only from persisted links — never surname/family inference.
 * Run: npx tsx src/learner/learnerLinkedParents.test.ts
 */
import { learnerLinkedParents } from "./learnerLinkedParents";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

const guardian = { id: "p-guardian", firstName: "Guardian", surname: "Testfamily", familyAccountId: "fa-test001" };

test("returns only API-linked parents", () => {
  const learner = { id: "l-primary", lastName: "Testfamily", familyAccountId: "fa-test001", parents: [guardian] };
  const ids = learnerLinkedParents(learner).map((p) => p.id);
  assert(ids.length === 1 && ids[0] === "p-guardian", `expected only the linked guardian, got ${ids.join(",")}`);
});

test("zero linked parents stays empty (no surname or family-account fallback)", () => {
  const learner = { id: "l-primary", lastName: "Testfamily", familyAccountId: "fa-test001", parents: [] };
  assert(learnerLinkedParents(learner).length === 0, "must not infer parents for an unlinked learner");
});

test("learner without parents field returns empty", () => {
  assert(learnerLinkedParents({ id: "l-x", lastName: "Testfamily" }).length === 0, "no parents field → empty");
  assert(learnerLinkedParents(null).length === 0, "null learner → empty");
});

test("parentLinks shape is honoured", () => {
  const learner = { id: "l-primary", parentLinks: [{ parent: guardian }] };
  const ids = learnerLinkedParents(learner).map((p) => p.id);
  assert(ids.length === 1 && ids[0] === "p-guardian", "parentLinks[].parent used");
});

test("signature takes no school parent list, so non-linked parents cannot leak in", () => {
  assert(learnerLinkedParents.length === 1, "learnerLinkedParents(learner) only");
});

console.log(`\nAll ${passed} learnerLinkedParents tests passed.`);
