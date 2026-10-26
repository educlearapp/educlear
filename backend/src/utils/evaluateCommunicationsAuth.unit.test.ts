/**
 * Run: npx tsx src/utils/evaluateCommunicationsAuth.unit.test.ts
 */
import assert from "node:assert/strict";
import { evaluateCommunicationsAuth } from "./evaluateCommunicationsAuth";
import { emptyPermissionMap, permissionsForRole } from "./userPermissions";

function main() {
  const admin = permissionsForRole("Admin");
  const teacher = permissionsForRole("Teacher");

  assert.equal(
    evaluateCommunicationsAuth({
      auth: {
        appRole: "Custom",
        authorizedSchoolId: "s",
        permissions: emptyPermissionMap(),
      },
      requireAction: "view",
      requestSchoolId: "s",
    }).allowed,
    false
  );

  const mismatch = evaluateCommunicationsAuth({
    auth: { appRole: "Admin", authorizedSchoolId: "s1", permissions: admin },
    requireAction: "view",
    requestSchoolId: "other",
  });
  assert.equal(mismatch.allowed, false);
  if (!mismatch.allowed) assert.equal(mismatch.code, "SCHOOL_MISMATCH");

  assert.equal(
    evaluateCommunicationsAuth({
      auth: { appRole: "Admin", authorizedSchoolId: "s1", permissions: admin },
      requireAction: "send",
      requestSchoolId: "s1",
    }).allowed,
    true
  );

  assert.equal(
    evaluateCommunicationsAuth({
      auth: { appRole: "Teacher", authorizedSchoolId: "s1", permissions: teacher },
      requireAction: "view",
      requestSchoolId: "s1",
    }).allowed,
    false
  );

  assert.equal(
    evaluateCommunicationsAuth({
      auth: { appRole: "Teacher", authorizedSchoolId: "s1", permissions: teacher },
      requireAction: "view",
      requestSchoolId: "s1",
      allowTeacherViewFallback: true,
    }).allowed,
    true
  );

  console.log("✓ evaluateCommunicationsAuth unit tests passed");
}

main();
