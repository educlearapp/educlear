/**
 * Parent document DB-targeted visibility where (replaces MAX_SCAN=300).
 * Run: npx tsx src/services/parentDocumentVisibility.unit.test.ts
 */
import assert from "assert";
import { buildParentDocumentVisibilityWhere } from "./parentDocumentVisibility";

function spellingsFor(cn: string | null | undefined): string[] {
  const t = String(cn || "").trim();
  if (!t) return [];
  if (t === "4A" || t === "Grade 4A") return ["4A", "Grade 4A"];
  return [t];
}

const learners = [
  { id: "L1", grade: "4", className: "4A" },
  { id: "L2", grade: "5", className: "5B" },
];

const whereAll = buildParentDocumentVisibilityWhere({
  schoolId: "school-1",
  learners,
  spellingsFor,
});

assert.equal(whereAll.schoolId, "school-1");
assert.equal((whereAll as any).visibility, "CLASS_TEACHERS");
assert.ok(Array.isArray((whereAll as any).OR));
const or = (whereAll as any).OR as any[];
assert.ok(or.some((c) => c.learnerId?.in?.includes("L1")));
assert.ok(or.some((c) => c.grade?.in?.includes("4")));
assert.ok(or.some((c) => c.className?.in?.includes("4A")));
assert.ok(or.some((c) => c.className?.in?.includes("Grade 4A")));
assert.ok(or.some((c) => c.AND));

const whereOne = buildParentDocumentVisibilityWhere({
  schoolId: "school-1",
  learners,
  activeLearnerId: "L1",
  spellingsFor,
});
const orOne = (whereOne as any).OR as any[];
assert.ok(orOne.some((c) => c.learnerId?.in?.includes("L1")));
assert.equal(
  orOne.some((c) => c.learnerId?.in?.includes("L2")),
  false,
  "active learner filter must not include sibling learner ids"
);

const whereNone = buildParentDocumentVisibilityWhere({
  schoolId: "school-1",
  learners: [],
  spellingsFor,
});
assert.ok((whereNone as any).AND, "no learners → school-wide only");

console.log("parentDocumentVisibility.unit.test: PASS");
