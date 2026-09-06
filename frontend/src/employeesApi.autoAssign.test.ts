/**
 * Add Employee payload mapping: auto-assign flag, no client-chosen number.
 * Run from frontend: npx tsx src/employeesApi.autoAssign.test.ts
 */
import {
  adminEmployeeToApiPayload,
  wantsAutoAssignEmployeeNumber,
} from "./employeesApi";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const employee = {
  firstName: "Ada",
  surname: "Lovelace",
  occupation: "Teacher",
  employeeNumber: "EMP0099",
  cell: "0820000000",
};

assert(wantsAutoAssignEmployeeNumber({ autoAssignEmployeeNumber: true }) === true, "strict true");
assert(wantsAutoAssignEmployeeNumber({ autoAssignEmployeeNumber: false }) === false, "false");
assert(
  wantsAutoAssignEmployeeNumber({ autoAssignEmployeeNumber: "true" as never }) === false,
  '"true" string is not auto-assign'
);
assert(wantsAutoAssignEmployeeNumber({ autoAssignEmployeeNumber: 1 as never }) === false, "1 is not auto-assign");
assert(wantsAutoAssignEmployeeNumber({ autoAssignEmployeeNumber: {} as never }) === false, "{} is not auto-assign");
assert(wantsAutoAssignEmployeeNumber(undefined) === false, "missing options is not auto-assign");

const autoPayload = adminEmployeeToApiPayload(employee, "school-a", { autoAssignEmployeeNumber: true });
assert(autoPayload.autoAssignEmployeeNumber === true, "Add Employee sends auto-assign flag");
assert(!("employeeNumber" in autoPayload), "Add Employee omits client employeeNumber");
assert(autoPayload.firstName === "Ada", "name still sent");
assert(autoPayload.schoolId === "school-a", "schoolId still sent");

const truthyRejected = adminEmployeeToApiPayload(employee, "school-a", {
  autoAssignEmployeeNumber: "true" as never,
});
assert(truthyRejected.autoAssignEmployeeNumber === undefined, '"true" does not send the flag');
assert(truthyRejected.employeeNumber === "EMP0099", '"true" keeps manual employeeNumber');

const updatePayload = adminEmployeeToApiPayload(employee, "school-a");
assert(updatePayload.autoAssignEmployeeNumber === undefined, "update does not auto-assign");
assert(updatePayload.employeeNumber === "EMP0099", "update keeps existing number field");

const restorePayload = adminEmployeeToApiPayload(
  { firstName: "Local", surname: "Restore", employeeNumber: "" },
  "school-a"
);
assert(restorePayload.autoAssignEmployeeNumber === undefined, "restore path has no auto-assign flag");
assert(restorePayload.employeeNumber === null, "restore without a number stays null");

const genericCreate = adminEmployeeToApiPayload(
  { id: "employee-local-1", firstName: "Local", surname: "Only", employeeNumber: "EMP0099" },
  "school-a"
);
assert(genericCreate.autoAssignEmployeeNumber === undefined, "generic local create does not auto-assign");
assert(genericCreate.employeeNumber === "EMP0099", "generic local create keeps supplied number");

console.log("✓ employeesApi auto-assign payload tests passed");
