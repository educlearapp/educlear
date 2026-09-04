/**
 * EduClock staff movement UI helpers + source guards.
 * Run from frontend: npx --yes tsx src/educlock/educlockMovementUi.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  STAFF_MOVEMENT_REASON_LABELS,
  STAFF_MOVEMENT_REASONS,
  formatElapsedAwayMs,
  movementDestinationRequired,
  movementNoteRequired,
  validateStaffMovementForm,
} from "./educlockMovementUi";

assert.deepEqual(
  [...STAFF_MOVEMENT_REASONS],
  [
    "SCHOOL_BUSINESS",
    "MEETING",
    "COLLECT_DELIVER",
    "PERSONAL",
    "MEDICAL",
    "BANK_ERRAND",
    "EMERGENCY",
    "TRAINING_OFFICIAL_DUTY",
    "OTHER",
  ]
);
assert.equal(STAFF_MOVEMENT_REASON_LABELS.SCHOOL_BUSINESS, "School Business");
assert.equal(movementDestinationRequired("MEETING"), true);
assert.equal(movementDestinationRequired("PERSONAL"), false);
assert.equal(movementNoteRequired("OTHER"), true);
assert.equal(validateStaffMovementForm({ reason: "", destination: "", note: "" }).ok, false);
assert.equal(validateStaffMovementForm({ reason: "SCHOOL_BUSINESS", destination: "", note: "" }).ok, false);
assert.equal(validateStaffMovementForm({ reason: "PERSONAL", destination: "", note: "" }).ok, true);
assert.equal(validateStaffMovementForm({ reason: "OTHER", destination: "X", note: "" }).ok, false);
assert.equal(validateStaffMovementForm({ reason: "MEETING", destination: "SGB", note: "" }).ok, true);
assert.equal(formatElapsedAwayMs(70 * 60 * 1000), "1h 10m");

const dir = path.join(process.cwd(), "src/educlock");
const staffSrc = fs.readFileSync(path.join(dir, "EduClockStaffClockPage.tsx"), "utf8");
assert.ok(staffSrc.includes("Leave Premises"), "employee Leave Premises button");
assert.ok(staffSrc.includes("I Have Returned"), "employee return button");
assert.ok(staffSrc.includes("postStaffMovementLeave"), "uses leave API");
assert.ok(staffSrc.includes("offPremises"), "uses offPremises metadata");
assert.ok(staffSrc.includes("disabled={busy || offPremises}"), "clock out disabled while off premises");
assert.ok(!staffSrc.includes("validateStaffClockGps"), "employee page does not geofence movement");

const apiSrc = fs.readFileSync(path.join(dir, "educlockApi.ts"), "utf8");
assert.ok(apiSrc.includes("/api/educlock/me/movements/leave"), "leave endpoint");
assert.ok(apiSrc.includes("/api/educlock/me/movements/return"), "return endpoint");
assert.ok(apiSrc.includes("/api/educlock/owner/movements"), "owner list endpoint");

const ownerSrc = fs.readFileSync(path.join(dir, "EduClock.tsx"), "utf8");
assert.ok(ownerSrc.includes("Movement Register"), "owner tab");
assert.ok(ownerSrc.includes("Staff Off Premises"), "overview card");

const attSrc = fs.readFileSync(path.join(dir, "EduClockAttendanceTab.tsx"), "utf8");
assert.ok(attSrc.includes("Off Premises"), "attendance badge");
assert.ok(attSrc.includes("row.offPremises"), "does not replace Clocked In");

const billingApi = fs.readFileSync(path.join(process.cwd(), "src/billing/billingApi.ts"), "utf8");
assert.ok(billingApi.includes("export const createPayment"), "createPayment still present");
assert.ok(
  /createPayment[\s\S]{0,200}staffAuthHeaders\(\)/.test(billingApi),
  "createPayment still sends staffAuthHeaders / Bearer"
);
const paymentCreate = fs.readFileSync(path.join(process.cwd(), "src/billing/PaymentCreateClean.tsx"), "utf8");
assert.ok(paymentCreate.includes("familyAccountId"), "payment payload still includes familyAccountId");

console.log("educlockMovementUi.test.ts PASS");
