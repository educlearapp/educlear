/**
 * Classroom roster response / Add Learners candidate tests.
 * Run: npx tsx src/classroomRoster.test.ts
 */
import {
  addLearnerCandidates,
  addLearnersResultMessage,
  classroomDetailChildrenCount,
  classroomDetailLearners,
  deleteClassroomConfirmMessage,
  deleteClassroomResultMessage,
} from "./classroomRoster";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

test("reads learners from GET /api/classrooms/:id nested shape", () => {
  const data = { classroom: { id: "c1", name: "Grade RA", learners: [{ id: "a" }, { id: "b" }], childrenCount: 2 } };
  const rows = classroomDetailLearners(data);
  assert(rows.length === 2, `expected 2 rows, got ${rows.length}`);
  assert(classroomDetailChildrenCount(data, rows) === 2, "count");
});

test("empty roster is returned as empty (so the UI clears removed learners)", () => {
  const data = { classroom: { id: "c1", name: "Grade RA", learners: [], childrenCount: 0 } };
  assert(classroomDetailLearners(data).length === 0, "should be empty");
});

test("legacy top-level shape still supported", () => {
  assert(classroomDetailLearners({ learners: [{ id: "a" }] }).length === 1, "legacy learners");
  assert(classroomDetailLearners({ children: [{ id: "a" }] }).length === 1, "legacy children");
  assert(classroomDetailLearners(null).length === 0, "null");
});

test("add candidates exclude learners already on this roster, keep others with their class", () => {
  const learners = [
    { id: "a", firstName: "Ava", lastName: "One", grade: "Grade R", className: "Grade RA" },
    { id: "b", firstName: "Ben", lastName: "Two", grade: "Grade R", className: "" },
    { id: "c", firstName: "Cara", lastName: "Three", grade: "Grade R", className: "Grade RB" },
    { id: "", firstName: "No", lastName: "Id" },
  ];
  const rows = addLearnerCandidates(learners, ["a"]);
  assert(rows.map((r) => r.id).join(",") === "b,c", `candidates ${rows.map((r) => r.id)}`);
  assert(rows.find((r) => r.id === "c")?.currentClass === "Grade RB", "current class shown");
});

test("add result message reports real counts", () => {
  const msg = addLearnersResultMessage({ assigned: 1, classroomName: "Grade RA", skippedLearnerIds: ["x"] }, 2);
  assert(msg.includes("1 of 2") && msg.includes("Grade RA") && msg.includes("1 could not"), msg);
});

test("delete confirmation states that the roster will be unassigned, with the count", () => {
  const msg = deleteClassroomConfirmMessage(3);
  assert(msg.includes("Learners will NOT be deleted") && msg.includes("3 active learner(s)"), msg);
  assert(deleteClassroomConfirmMessage(Number.NaN).includes("0 active learner(s)"), "NaN → 0");
});

test("delete result message shows the API's unassigned count", () => {
  const msg = deleteClassroomResultMessage({ success: true, classroomName: "Grade RA", unassigned: 2 });
  assert(msg === "Grade RA deleted. 2 learner(s) unassigned.", msg);
  assert(deleteClassroomResultMessage(null) === "Classroom deleted. 0 learner(s) unassigned.", "null result");
});

console.log(`classroomRoster: ${passed} passed`);
