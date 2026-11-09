/**
 * All Parents class/parent selection helpers for Email Communications.
 * Run: npx tsx src/communication/emailAllParentsSelection.unit.test.ts
 */
import assert from "node:assert/strict";
import {
  areAllSelected,
  contactMatchesSelectedClasses,
  filterEligibleParentsByClasses,
  isEligibleParentEmail,
  pruneSelectedIds,
  selectAllClassNames,
  toggleClassSelection,
  uniqueSelectedEmailRecipients,
} from "./emailAllParentsSelection";

assert.equal(isEligibleParentEmail("parent@school.test"), true);
assert.equal(isEligibleParentEmail("  "), false);
assert.equal(isEligibleParentEmail("not-an-email"), false);
assert.equal(isEligibleParentEmail("missing@"), false);

const classes = ["Grade R A", "Grade 1 B", "Grade 2 C", "Hidden Class D"];
assert.deepEqual(selectAllClassNames(classes), classes);
assert.equal(selectAllClassNames(classes).length, 4, "Select All Classes includes every active class");

assert.deepEqual(toggleClassSelection(["Grade R A"], "Grade 1 B", true), ["Grade R A", "Grade 1 B"]);
assert.deepEqual(toggleClassSelection(["Grade R A", "Grade 1 B"], "Grade R A", false), ["Grade 1 B"]);

const parents = [
  { id: "p1", email: "shared@family.test", classNames: ["Grade R A", "Grade 1 B"] },
  { id: "p2", email: "only-r@family.test", classNames: ["Grade R A"] },
  { id: "p3", email: "only-1@family.test", classNames: ["Grade 1 B"] },
  { id: "p4", email: "", classNames: ["Grade R A"] },
  { id: "p5", email: "bad", classNames: ["Grade 2 C"] },
  { id: "p6", email: "grade2@family.test", classNames: ["Grade 2 C"] },
];

assert.equal(contactMatchesSelectedClasses(["Grade R A"], ["Grade R A"]), true);
assert.equal(contactMatchesSelectedClasses(["Grade R A"], ["Grade 1 B"]), false);
assert.equal(contactMatchesSelectedClasses(["Grade R A"], []), false);

const eligibleRA = filterEligibleParentsByClasses(parents, ["Grade R A"]);
assert.deepEqual(
  eligibleRA.map((p) => p.id),
  ["p1", "p2"],
  "Class R A: valid parents only; invalid email excluded"
);

const eligibleBoth = filterEligibleParentsByClasses(parents, ["Grade R A", "Grade 1 B"]);
assert.deepEqual(
  eligibleBoth.map((p) => p.id),
  ["p1", "p2", "p3"],
  "Multi-class filter unions eligible parents"
);

const allClasses = selectAllClassNames(classes);
const eligibleAll = filterEligibleParentsByClasses(parents, allClasses);
assert.deepEqual(
  eligibleAll.map((p) => p.id),
  ["p1", "p2", "p3", "p6"],
  "Select All Classes surfaces every eligible parent across the school"
);

const selectedAllIds = eligibleAll.map((p) => p.id);
const uniqueAll = uniqueSelectedEmailRecipients(eligibleAll, selectedAllIds);
assert.equal(uniqueAll.length, 4, "Unique recipient count after Select All Parents");

const multiClassOnce = uniqueSelectedEmailRecipients(eligibleBoth, ["p1", "p2", "p3"]);
assert.equal(multiClassOnce.length, 3, "Parent in two classes still one unique email");
assert.equal(multiClassOnce.filter((p) => p.email === "shared@family.test").length, 1);

const pruned = pruneSelectedIds(["p1", "p2", "p3", "p6"], ["p1", "p3"]);
assert.deepEqual(pruned, ["p1", "p3"], "Class deselect prunes parents no longer eligible");

assert.equal(areAllSelected(["p1", "p2", "p3"], ["p1", "p2", "p3"]), true);
assert.equal(areAllSelected(["p1", "p2"], ["p1", "p2", "p3"]), false);
assert.equal(areAllSelected([], []), false, "Empty eligible is not Select All");

// Immediate recount when class selection shrinks
const afterDropGrade1 = filterEligibleParentsByClasses(parents, ["Grade R A"]);
const afterDropIds = pruneSelectedIds(["p1", "p2", "p3"], afterDropGrade1.map((p) => p.id));
const afterDropUnique = uniqueSelectedEmailRecipients(afterDropGrade1, afterDropIds);
assert.deepEqual(afterDropIds, ["p1", "p2"]);
assert.equal(afterDropUnique.length, 2, "Recipient count updates when a class is deselected");

console.log("emailAllParentsSelection.unit.test.ts: ok");
