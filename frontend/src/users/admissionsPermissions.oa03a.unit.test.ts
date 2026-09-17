/**
 * OA-03A frontend admissions permission module presence.
 * Run: npx tsx src/users/admissionsPermissions.oa03a.unit.test.ts
 */
import assert from "node:assert/strict";
import {
  PERMISSION_MODULES,
  permissionsForRole,
  hasPermission,
} from "./permissions";

function main() {
  assert.ok(PERMISSION_MODULES.some((m) => m.key === "admissions"));

  const admin = permissionsForRole("Admin");
  assert.equal(admin.admissions?.manage, true);

  const finance = permissionsForRole("Finance");
  assert.equal(finance.admissions?.view, true);
  assert.equal(finance.admissions?.manage, false);

  const teacher = permissionsForRole("Teacher");
  assert.equal(
    hasPermission(
      {
        id: "1",
        schoolId: "s",
        email: "t@ex.com",
        firstName: "T",
        surname: "T",
        fullName: "T T",
        appRole: "Teacher",
        role: "STAFF",
        status: "Active",
        isActive: true,
        permissions: teacher,
        lastLoginAt: null,
      },
      "admissions",
      "view"
    ),
    false
  );

  // R1600 is not a permission/default concern on frontend maps
  assert.equal(finance.admissions?.manage, false);

  console.log("✓ OA-03A frontend admissions permissions unit tests passed");
}

main();
