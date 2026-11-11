/**
 * Teacher HomeSafe Collections helpers.
 * Run: npx tsx src/teacher-app/TeacherHomeSafeCollections.test.ts
 */
import assert from "node:assert/strict";
import {
  isoDateForWeekday,
  nextProgressForGroup,
  progressActionLabel,
} from "./TeacherHomeSafeCollections";

assert.equal(isoDateForWeekday("2026-11-11", "Mon"), "2026-11-09");
assert.equal(isoDateForWeekday("2026-11-11", "Tue"), "2026-11-10");
assert.equal(isoDateForWeekday("2026-11-11", "Wed"), "2026-11-11");
assert.equal(isoDateForWeekday("2026-11-11", "Thu"), "2026-11-12");
assert.equal(isoDateForWeekday("2026-11-11", "Fri"), "2026-11-13");
assert.equal(isoDateForWeekday("2026-11-14", "Mon"), null, "weekend base → null");

assert.equal(nextProgressForGroup("TRANSPORT", "WAITING"), "READY");
assert.equal(nextProgressForGroup("TRANSPORT", "CALLED"), "READY");
assert.equal(nextProgressForGroup("TRANSPORT", "READY"), "COLLECTED");
assert.equal(nextProgressForGroup("TRANSPORT", "COLLECTED"), null);

assert.equal(nextProgressForGroup("ACTIVITY", "WAITING"), "PARTICIPATING");
assert.equal(nextProgressForGroup("ACTIVITY", "PARTICIPATING"), "RETURNED");
assert.equal(nextProgressForGroup("ACTIVITY", "RETURNED"), null);

assert.equal(progressActionLabel("TRANSPORT", "WAITING"), "Mark ready");
assert.equal(progressActionLabel("TRANSPORT", "READY"), "Mark collected");
assert.equal(progressActionLabel("ACTIVITY", "WAITING"), "Mark participating");

console.log("TeacherHomeSafeCollections.test.ts: PASS");
