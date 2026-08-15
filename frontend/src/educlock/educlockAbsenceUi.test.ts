/**
 * EduClock staff self-reported absence UI helpers + source guards.
 * Run from frontend: npx --yes tsx src/educlock/educlockAbsenceUi.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  STAFF_ABSENCE_REASON_LABELS,
  STAFF_ABSENCE_REASONS,
  absenceNoteRequired,
  absenceReasonLabel,
  formatSchoolLocalDateLong,
  isAbsentStaffStatus,
  validateStaffAbsenceForm,
} from "./educlockAbsenceUi";

assert.deepEqual(
  [...STAFF_ABSENCE_REASONS],
  [
    "SICK",
    "FAMILY_RESPONSIBILITY",
    "EMERGENCY",
    "MEDICAL_APPOINTMENT",
    "APPROVED_LEAVE",
    "UNPAID_LEAVE",
    "TRAINING_OFFICIAL_DUTY",
    "OTHER",
  ]
);
assert.equal(STAFF_ABSENCE_REASON_LABELS.SICK, "Sick");
assert.equal(STAFF_ABSENCE_REASON_LABELS.FAMILY_RESPONSIBILITY, "Family Responsibility");
assert.equal(STAFF_ABSENCE_REASON_LABELS.EMERGENCY, "Emergency");
assert.equal(STAFF_ABSENCE_REASON_LABELS.MEDICAL_APPOINTMENT, "Medical Appointment");
assert.equal(STAFF_ABSENCE_REASON_LABELS.APPROVED_LEAVE, "Approved Leave");
assert.equal(STAFF_ABSENCE_REASON_LABELS.UNPAID_LEAVE, "Unpaid Leave");
assert.equal(STAFF_ABSENCE_REASON_LABELS.TRAINING_OFFICIAL_DUTY, "Training / Official Duty");
assert.equal(STAFF_ABSENCE_REASON_LABELS.OTHER, "Other");
assert.equal(absenceReasonLabel("SICK"), "Sick");
assert.equal(absenceNoteRequired("OTHER"), true);
assert.equal(absenceNoteRequired("SICK"), false);
assert.equal(validateStaffAbsenceForm({ reason: "", note: "" }).ok, false);
assert.equal(validateStaffAbsenceForm({ reason: "OTHER", note: "   " }).ok, false);
assert.equal(validateStaffAbsenceForm({ reason: "SICK", note: "" }).ok, true);
assert.equal(validateStaffAbsenceForm({ reason: "OTHER", note: "Doctor visit" }).ok, true);
assert.equal(isAbsentStaffStatus("ABSENT"), true);
assert.equal(isAbsentStaffStatus("Absent — Sick"), true);
assert.equal(isAbsentStaffStatus("Clocked In"), false);
assert.ok(formatSchoolLocalDateLong("2026-08-14").includes("August"));
assert.ok(formatSchoolLocalDateLong("2026-08-14").includes("2026"));

const dir = path.join(process.cwd(), "src/educlock");
const staffSrc = fs.readFileSync(path.join(dir, "EduClockStaffClockPage.tsx"), "utf8");
assert.ok(staffSrc.includes("Report yourself absent for"), "confirmation copy");
assert.ok(staffSrc.includes("onAbsenceContinue"), "dropdown does not submit");
assert.ok(!staffSrc.includes("onChange={() => void onConfirmAbsence"), "no submit on select");
assert.ok(staffSrc.includes('postStaffAbsence'), "uses staff absence API");
assert.ok(!staffSrc.includes("employeeId"), "staff page does not send employeeId");

const apiSrc = fs.readFileSync(path.join(dir, "educlockApi.ts"), "utf8");
assert.ok(apiSrc.includes("/api/educlock/me/absence"), "staff absence endpoint");
assert.ok(apiSrc.includes("/api/educlock/owner/absences/"), "owner cancel endpoint");

console.log("EDUCLOCK ABSENCE UI TESTS PASS");
