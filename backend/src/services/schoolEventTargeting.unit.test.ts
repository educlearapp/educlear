/**
 * Phase 3 — event targeting / window validation (no DB).
 * Run: npx tsx src/services/schoolEventTargeting.unit.test.ts
 */
import assert from "assert";
import {
  assertEventWindow,
  normalizeEventTargeting,
  parseEventInstant,
  parentVisibleEventWhere,
} from "./schoolEventService";

assert.deepEqual(normalizeEventTargeting({}), {
  grade: null,
  className: null,
  learnerId: null,
  mode: "SCHOOL",
});
assert.equal(normalizeEventTargeting({ grade: "3" }).mode, "GRADE");
assert.equal(normalizeEventTargeting({ className: "3A", grade: "3" }).mode, "CLASS");
assert.equal(normalizeEventTargeting({ learnerId: "L1", className: "3A" }).mode, "LEARNER");
assert.equal(normalizeEventTargeting({ learnerId: "L1", className: "3A", grade: "3" }).grade, null);

let threw = false;
try {
  normalizeEventTargeting({ learnerId: "L1", grade: "3" });
} catch {
  threw = true;
}
assert.ok(threw, "learner+grade without class rejected");

const a = parseEventInstant("2026-10-25T10:00:00.000Z", "startsAt");
const b = parseEventInstant("2026-10-25T11:00:00.000Z", "endsAt");
assertEventWindow(a, b);
threw = false;
try {
  assertEventWindow(b, a);
} catch {
  threw = true;
}
assert.ok(threw, "startsAt > endsAt rejected");

const gate = parentVisibleEventWhere();
assert.deepEqual(gate.lifecycleStatus, { in: ["PUBLISHED", "CANCELLED"] });

console.log("schoolEventTargeting.unit.test: PASS");
