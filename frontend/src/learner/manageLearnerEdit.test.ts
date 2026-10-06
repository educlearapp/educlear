/**
 * Manage Learner edit/save contract tests.
 * Run: npx tsx src/learner/manageLearnerEdit.test.ts
 */
import {
  applyLearnerFieldPatch,
  assignedClassName,
  buildManageLearnerSavePayload,
} from "./manageLearnerEdit";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

/** Learner as returned by GET /api/learners/:id for a Grade R learner with no class assigned. */
const apiGradeRNoClass = {
  id: "l1",
  firstName: "Ava",
  lastName: "Mokoena",
  grade: "Grade R",
  className: "",
  classroom: "Grade R",
  classroomName: "Grade R",
  homeLanguage: "English",
  citizenship: "South Africa",
  nationality: "South Africa",
  notes: "original",
};

test("assigned class never falls back to grade", () => {
  assert(assignedClassName(apiGradeRNoClass) === "", "API grade fallback must not count as a class");
  assert(assignedClassName({ ...apiGradeRNoClass, className: "Grade RA" }) === "Grade RA", "className wins");
  assert(assignedClassName({ classroom: "Grade RB" }) === "Grade RB", "legacy shape without className");
});

test("sequential alias edits in one event all survive (firstName + name)", () => {
  // ManageLearner calls updateLearnerField twice per keystroke; each call must build on the last.
  let latest: Record<string, unknown> = apiGradeRNoClass;
  latest = applyLearnerFieldPatch(latest, { firstName: "Avery" });
  latest = applyLearnerFieldPatch(latest, { name: "Avery" });
  assert(latest.firstName === "Avery" && latest.name === "Avery", "first name edit lost");
  latest = applyLearnerFieldPatch(latest, { lastName: "Dlamini" });
  latest = applyLearnerFieldPatch(latest, { surname: "Dlamini" });
  assert(latest.lastName === "Dlamini" && latest.surname === "Dlamini", "surname edit lost");
});

test("classroom edit keeps className aliases in sync", () => {
  const updated = applyLearnerFieldPatch(apiGradeRNoClass, { classroom: "Grade RA" });
  assert(updated.className === "Grade RA" && updated.classroomName === "Grade RA", "aliases not synced");
});

test("save payload sends edited name and profile fields", () => {
  let latest: Record<string, unknown> = apiGradeRNoClass;
  latest = applyLearnerFieldPatch(latest, { firstName: "Avery" });
  latest = applyLearnerFieldPatch(latest, { name: "Avery" });
  latest = applyLearnerFieldPatch(latest, { homeLanguage: "isiZulu" });
  latest = applyLearnerFieldPatch(latest, { nationality: "Lesotho" });
  latest = applyLearnerFieldPatch(latest, { notes: "updated" });
  const payload = buildManageLearnerSavePayload(latest);
  assert(payload.firstName === "Avery", `firstName ${payload.firstName}`);
  assert(payload.homeLanguage === "isiZulu", "homeLanguage missing");
  assert(payload.nationality === "Lesotho", "nationality missing");
  assert(payload.notes === "updated", "notes missing");
});

test("save payload never assigns the grade as a classroom", () => {
  const payload = buildManageLearnerSavePayload(apiGradeRNoClass);
  assert(payload.className === "" && payload.classroom === "" && payload.classroomName === "", "grade leaked");
  const assigned = buildManageLearnerSavePayload({ ...apiGradeRNoClass, className: "Grade RA" });
  assert(assigned.className === "Grade RA" && assigned.classroomName === "Grade RA", "class not sent");
});

test("partially loaded learner does not blank optional profile fields", () => {
  const listRow = { id: "l1", firstName: "Ava", lastName: "M", grade: "Grade R", className: "Grade RA" };
  const payload = buildManageLearnerSavePayload(listRow);
  assert(!("notes" in payload), "notes sent without being loaded");
  assert(!("homeLanguage" in payload), "homeLanguage sent without being loaded");
  assert(!("nationality" in payload), "nationality sent without being loaded");
  assert(!("allergies" in payload) && !("medicalAlert" in payload), "medical fields must use /sensitive-fields");
});

console.log(`manageLearnerEdit: ${passed} passed`);
