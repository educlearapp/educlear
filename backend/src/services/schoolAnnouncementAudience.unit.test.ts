/**
 * Unit tests for announcement audience normalisation / visibility (no DB).
 * Run: npx tsx src/services/schoolAnnouncementAudience.unit.test.ts
 */
import assert from "assert";
import {
  normalizeAnnouncementTargeting,
  noticeHasExplicitParentAudience,
  parentMayViewNotice,
  parseAudienceParentIds,
  readAudienceParentIdsForVisibility,
} from "./schoolAnnouncementAudience";

assert.throws(() => parseAudienceParentIds([]), /at least one/);
assert.throws(() => parseAudienceParentIds("x"), /array/);
assert.deepEqual(parseAudienceParentIds(["a", "a", "b"]), ["a", "b"]);

assert.equal(readAudienceParentIdsForVisibility(null), "absent");
assert.equal(readAudienceParentIdsForVisibility([]), "invalid_empty");
assert.equal(noticeHasExplicitParentAudience([]), true);
assert.equal(noticeHasExplicitParentAudience(null), false);

const all = normalizeAnnouncementTargeting({ audienceMode: "all_parents" });
assert.equal(all.mode, "all_parents");
assert.equal(all.audienceParentIds, null);
assert.equal(all.grade, null);
assert.equal(all.className, null);

const grade = normalizeAnnouncementTargeting({
  audienceMode: "by_class",
  classScope: "grade",
  grade: "1",
});
assert.equal(grade.mode, "by_class");
assert.equal(grade.grade, "1");
assert.equal(grade.className, null);

const room = normalizeAnnouncementTargeting({
  audienceMode: "by_class",
  classScope: "classroom",
  className: "Grade 1A",
});
assert.equal(room.className, "Grade 1A");
assert.equal(room.grade, null);

const individual = normalizeAnnouncementTargeting({
  audienceMode: "individual",
  parentIds: ["p1", "p2"],
});
assert.equal(individual.mode, "individual");
assert.deepEqual(individual.audienceParentIds, ["p1", "p2"]);
assert.equal(individual.grade, null);
assert.equal(individual.className, null);

// Individual audience must never look school-wide to parents outside the list
assert.equal(
  parentMayViewNotice({
    parentId: "p1",
    learners: [{ id: "l1", grade: "1", className: "A" }],
    notice: { audienceParentIds: ["p1"], grade: null, className: null, learnerId: null },
    sameClassroom: () => true,
  }),
  true
);
assert.equal(
  parentMayViewNotice({
    parentId: "p2",
    learners: [{ id: "l1", grade: "1", className: "A" }],
    notice: { audienceParentIds: ["p1"], grade: null, className: null, learnerId: null },
    sameClassroom: () => true,
  }),
  false
);
assert.equal(
  parentMayViewNotice({
    parentId: "p2",
    learners: [{ id: "l1", grade: "1", className: "A" }],
    notice: { audienceParentIds: [], grade: null, className: null, learnerId: null },
    sameClassroom: () => true,
  }),
  false,
  "empty individual list must not become school-wide"
);
assert.equal(
  parentMayViewNotice({
    parentId: "p2",
    learners: [{ id: "l1", grade: "1", className: "A" }],
    notice: { audienceParentIds: null, grade: null, className: null, learnerId: null },
    sameClassroom: () => true,
  }),
  true,
  "legacy school-wide still visible"
);

console.log("schoolAnnouncementAudience.unit.test: PASS");
