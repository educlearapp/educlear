/**
 * Lists & Registers catalogue integrity — every visible title resolves.
 * Run: npx --yes tsx src/listsRegisters/catalogueIntegrity.test.ts
 */
import assert from "assert";
import { isLearnerAttendanceRegister } from "../attendance/attendanceReportCatalog";
import {
  COMPLETE_LIST_REGISTER_DEFS,
  LIST_REGISTER_CATALOGUE_LABELS,
  PHASE1_LIST_REGISTER_DEFS,
  catalogueIntegrity,
  getListRegisterDefByLabel,
  needsListsRegistersApi,
} from "./listRegisterCatalog";
import {
  assertEmployeeDatasetNotLearners,
  buildListRegisterReport,
  type ListRegisterControls,
  type ListRegisterLearnerInput,
} from "./buildListRegisterReport";

const EXPECTED_ORDER = [
  "Child List",
  "Class List",
  "Contact List",
  "Address List",
  "Age List",
  "Birthday Child List",
  "Attendance List",
  "Attendance Register (Daily)",
  "Attendance Register (Monthly)",
  "Attendance Register (Monthly) (Weekends)",
  "Attendance Register (Weekly)",
  "Attendance Register (Weekly) (Weekends)",
  "Allergies List",
  "Birthday Employee List",
  "Birthday Parent List",
  "Block Sheet (5 Blocks)",
  "Block Sheet (10 Blocks)",
  "Block Sheet (20 Blocks)",
  "Child List (3 Extra Fields)",
  "Child List (6 Extra Fields)",
  "Employee Attendance Register (Monthly)",
  "Employee Attendance Register (Monthly) (Weekends)",
  "Employee Attendance Register (Weekly)",
  "Employee Attendance Register (Weekly) (Weekends)",
  "Employee Attendance Time Register (Weekly)",
  "Employee Attendance Time Register (Weekly) (Weekends)",
  "Employee Contact List",
  "Future Enrolled List",
  "Group List",
  "Incident List",
];

assert.equal(LIST_REGISTER_CATALOGUE_LABELS.length, 30);
assert.deepEqual(LIST_REGISTER_CATALOGUE_LABELS, EXPECTED_ORDER);
console.log("✓ LIST_REGISTER_CATALOGUE_LABELS exact order (30)");

const integrity = catalogueIntegrity();
assert.equal(integrity.length, 30);

for (const item of integrity) {
  assert.ok(
    item.resolution === "implemented" ||
      item.resolution === "blocked_missing_data" ||
      item.resolution === "learner-attendance",
    `${item.label} bad resolution ${item.resolution}`
  );
  if (item.resolution === "blocked_missing_data") {
    assert.ok(item.def?.blockedReason, `${item.label} missing blockedReason`);
    assert.equal(item.def?.implemented, false);
  }
  if (item.resolution === "implemented") {
    assert.equal(item.def?.implemented, true);
    assert.equal(item.def?.status, "implemented");
  }
  if (item.resolution === "learner-attendance") {
    assert.ok(isLearnerAttendanceRegister(item.label));
  }
}
console.log("✓ every title resolves implemented | blocked | learner-attendance");

// No generic fallback: unknown label returns null
assert.equal(getListRegisterDefByLabel("Totally Fake Report"), null);
assert.equal(getListRegisterDefByLabel(""), null);
console.log("✓ unknown titles do not invent a generic def");

const blocked = integrity.filter((i) => i.resolution === "blocked_missing_data");
assert.equal(blocked.length, 1);
assert.deepEqual(
  blocked.map((b) => b.label),
  ["Future Enrolled List"]
);
for (const b of blocked) {
  assert.ok(!/not yet implemented/i.test(b.def!.blockedReason || ""));
  assert.ok(!/schema|enum|LearnerEnrollmentStatus/i.test(b.def!.blockedReason || ""), `${b.label} should not expose technical jargon`);
  assert.ok((b.def!.blockedReason || "").length > 20);
}
console.log("✓ exactly one blocked title (Future Enrolled List)");

const implementedNonAttendance = integrity.filter((i) => i.resolution === "implemented");
assert.equal(implementedNonAttendance.length, 23); // 6 phase1 + 17 v3
assert.equal(PHASE1_LIST_REGISTER_DEFS.length, 6);
assert.equal(
  COMPLETE_LIST_REGISTER_DEFS.filter((d) => d.implemented).length,
  23
);
console.log("✓ implemented counts (phase1 + v3)");

const learnerOnly: ListRegisterLearnerInput[] = [
  {
    id: "l1",
    firstName: "Ada",
    surname: "Zephyr",
    enrollmentStatus: "ACTIVE",
    birthDate: "2014-03-15",
  },
];
const controls: ListRegisterControls = {
  classroom: "all",
  grade: "all",
  month: "all",
  hasAddress: "all",
  sort: "surname",
};

for (const label of [
  "Birthday Employee List",
  "Employee Contact List",
  "Employee Attendance Register (Weekly)",
  "Employee Attendance Time Register (Weekly)",
]) {
  const def = getListRegisterDefByLabel(label)!;
  assert.equal(def.entity, "employee");
  assert.throws(
    () => assertEmployeeDatasetNotLearners(def, { learners: learnerOnly }),
    /learner-only/
  );
  // Builder uses employee dataset only — never invents learner roster rows
  const empty = buildListRegisterReport(def, controls, { employees: [] });
  assert.equal(empty.rows.length, 0);
  assert.ok(empty.rows.every((r) => r._entity === "employee"));
  assert.ok(needsListsRegistersApi(def));
}
console.log("✓ employee reports reject learner-only datasets conceptually");

const group = getListRegisterDefByLabel("Group List")!;
assert.equal(group.entity, "group-member");
assert.ok(needsListsRegistersApi(group));
const incident = getListRegisterDefByLabel("Incident List")!;
assert.equal(incident.entity, "incident");
assert.ok(needsListsRegistersApi(incident));

const child = getListRegisterDefByLabel("Child List")!;
assert.equal(needsListsRegistersApi(child), false);
const block = getListRegisterDefByLabel("Block Sheet (5 Blocks)")!;
assert.equal(needsListsRegistersApi(block), false);

console.log("\nAll catalogueIntegrity tests passed.");
