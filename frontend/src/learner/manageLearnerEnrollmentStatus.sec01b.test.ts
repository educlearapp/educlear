/**
 * SEC-01B — ManageLearner enrollment-status UI source guards.
 * Run from frontend: npx --yes tsx src/learner/manageLearnerEnrollmentStatus.sec01b.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasPermission, permissionsForRole } from "../users/permissions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, "ManageLearner.tsx"), "utf8");

assert.ok(
  /enrollment-status[\s\S]{0,400}staffAuthHeaders\(\)/.test(src) ||
    /staffAuthHeaders\(\)[\s\S]{0,400}enrollment-status/.test(src),
  "ManageLearner enrollment-status PATCH must include staffAuthHeaders()"
);

const unenrolBlock = src.match(
  /handleUnenrolLearner[\s\S]*?finally\s*\{[\s\S]*?setUnenrolling\(false\);[\s\S]*?\}/
)?.[0];
assert.ok(unenrolBlock, "Unenrol handler present");
assert.ok(
  /headers:\s*\{\s*"Content-Type":\s*"application\/json",\s*\.\.\.staffAuthHeaders\(\)\s*\}/.test(
    unenrolBlock!
  ),
  "Unenrol PATCH spreads staffAuthHeaders"
);
assert.ok(
  /enrollmentStatus:\s*"HISTORICAL"/.test(unenrolBlock!),
  "Unenrol still sends HISTORICAL"
);
assert.ok(/schoolId:\s*learner\.schoolId/.test(unenrolBlock!), "Unenrol still sends learner.schoolId");

const reenrolBlock = src.match(
  /handleReenrolLearner[\s\S]*?finally\s*\{[\s\S]*?setUnenrolling\(false\);[\s\S]*?\}/
)?.[0];
assert.ok(reenrolBlock, "Re-enrol handler present");
assert.ok(
  /headers:\s*\{\s*"Content-Type":\s*"application\/json",\s*\.\.\.staffAuthHeaders\(\)\s*\}/.test(
    reenrolBlock!
  ),
  "Re-enrol PATCH spreads staffAuthHeaders"
);
assert.ok(/enrollmentStatus:\s*"ACTIVE"/.test(reenrolBlock!), "Re-enrol still sends ACTIVE");

assert.ok(
  /hasPermission\(\s*getSchoolSessionUser\(\),\s*"learners",\s*"edit"\s*\)/.test(src),
  "UI gates enrollment mutation on learners.edit"
);
assert.ok(
  /canMutateEnrollmentStatus\s*\?\s*\[enrollmentAction\]\s*:\s*\[\]/.test(src),
  "Unenrol/Re-enrol menu item only when learners.edit"
);
assert.ok(/profileMoreItems\.map/.test(src), "More menu uses gated profileMoreItems");

const owner = {
  appRole: "Owner",
  isActive: true,
  permissions: permissionsForRole("Owner"),
};
const admin = {
  appRole: "Admin",
  isActive: true,
  permissions: permissionsForRole("Admin"),
};
const finance = {
  appRole: "Finance",
  isActive: true,
  permissions: permissionsForRole("Finance"),
};
const teacher = {
  appRole: "Teacher",
  isActive: true,
  permissions: permissionsForRole("Teacher"),
};

assert.equal(hasPermission(owner, "learners", "edit"), true);
assert.equal(hasPermission(admin, "learners", "edit"), true);
assert.equal(hasPermission(finance, "learners", "edit"), false);
assert.equal(hasPermission(teacher, "learners", "edit"), false);

console.log("✓ SEC-01B ManageLearner enrollment-status UI guards passed");
