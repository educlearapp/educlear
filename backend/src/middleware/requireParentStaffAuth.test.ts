/**
 * Trusted Parent staff auth decision tests (pure).
 * Run: npx ts-node --transpile-only src/middleware/requireParentStaffAuth.test.ts
 */
import assert from "assert";
import {
  evaluateParentStaffAuth,
  isTrustedOwnerAdminRole,
} from "./requireParentStaffAuth";
import { emptyPermissionMap, permissionsForRole } from "../utils/userPermissions";

const SCHOOL_A = "school-a-parent-auth";
const SCHOOL_B = "school-b-parent-auth";

function jwtPayload(schoolId: string, role = "SCHOOL_ADMIN") {
  return {
    userId: "user-parent-auth-1",
    schoolId,
    email: "owner@example.com",
    role,
  };
}

function activeUser(schoolId: string, role = "SCHOOL_ADMIN") {
  return { id: "user-parent-auth-1", schoolId, role, isActive: true };
}

function testUnauthenticated401() {
  const d = evaluateParentStaffAuth({
    jwtPayload: null,
    user: null,
    appRole: "Owner",
    permissions: null,
    requestSchoolId: SCHOOL_A,
  });
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.equal(d.status, 401);
  console.log("✓ TEST 5 unauthenticated → 401");
}

function testOwnerAdminAllowed() {
  for (const role of ["Owner", "Admin"] as const) {
    const d = evaluateParentStaffAuth({
      jwtPayload: jwtPayload(SCHOOL_A),
      user: activeUser(SCHOOL_A),
      appRole: role,
      permissions: permissionsForRole(role),
      requestSchoolId: SCHOOL_A,
      requireOwnerAdmin: true,
    });
    assert.equal(d.allowed, true);
    if (d.allowed) {
      assert.equal(d.authorizedSchoolId, SCHOOL_A);
      assert.equal(d.auth.isOwnerAdmin, true);
    }
  }
  console.log("✓ TEST 1/2 Owner + Admin JWT allowed");
}

function testTeacherSpoofDenied() {
  const d = evaluateParentStaffAuth({
    jwtPayload: jwtPayload(SCHOOL_A, "STAFF"),
    user: activeUser(SCHOOL_A, "STAFF"),
    appRole: "Teacher",
    permissions: permissionsForRole("Teacher"),
    requestSchoolId: SCHOOL_A,
    requireOwnerAdmin: true,
  });
  assert.equal(d.allowed, false);
  if (!d.allowed) {
    assert.equal(d.status, 403);
    assert.equal(d.code, "FORBIDDEN_OWNER_ADMIN");
  }
  console.log("✓ TEST 3/4 Teacher cannot satisfy Owner/Admin (spoof headers irrelevant to evaluate)");
}

function testCrossSchoolBodyDenied() {
  const d = evaluateParentStaffAuth({
    jwtPayload: jwtPayload(SCHOOL_A),
    user: activeUser(SCHOOL_A),
    appRole: "Owner",
    permissions: permissionsForRole("Owner"),
    requestSchoolId: SCHOOL_B,
  });
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.equal(d.code, "SCHOOL_MISMATCH");
  console.log("✓ TEST 13 body schoolId spoof → SCHOOL_MISMATCH");
}

function testJwtDbSchoolMismatch() {
  const d = evaluateParentStaffAuth({
    jwtPayload: jwtPayload(SCHOOL_B),
    user: activeUser(SCHOOL_A),
    appRole: "Owner",
    permissions: permissionsForRole("Owner"),
    requestSchoolId: SCHOOL_A,
  });
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.equal(d.code, "SCHOOL_ACCESS_DENIED");
  console.log("✓ jwt/db school mismatch → 403");
}

function testParentsCreatePermission() {
  const teacher = evaluateParentStaffAuth({
    jwtPayload: jwtPayload(SCHOOL_A, "STAFF"),
    user: activeUser(SCHOOL_A, "STAFF"),
    appRole: "Teacher",
    permissions: permissionsForRole("Teacher"),
    requirePermission: { module: "parents", action: "create" },
  });
  assert.equal(teacher.allowed, false);

  const admin = evaluateParentStaffAuth({
    jwtPayload: jwtPayload(SCHOOL_A),
    user: activeUser(SCHOOL_A),
    appRole: "Admin",
    permissions: permissionsForRole("Admin"),
    requirePermission: { module: "parents", action: "create" },
  });
  assert.equal(admin.allowed, true);
  console.log("✓ parents.create: Admin yes, Teacher no");
}

function testClientRoleStringsNotTrusted() {
  // Even if appRole were somehow "Owner" from a client field, evaluate only uses
  // the server-resolved appRole argument — routes must not pass client headers here.
  assert.equal(isTrustedOwnerAdminRole("OWNER"), false); // case-sensitive AppRole
  assert.equal(isTrustedOwnerAdminRole("Owner"), true);
  assert.equal(isTrustedOwnerAdminRole("Admin"), true);
  assert.equal(isTrustedOwnerAdminRole("Teacher"), false);
  console.log("✓ TEST 19 trusted role helper ignores loose client casing tricks except exact AppRole");
}

function testInactiveUser() {
  const d = evaluateParentStaffAuth({
    jwtPayload: jwtPayload(SCHOOL_A),
    user: { ...activeUser(SCHOOL_A), isActive: false },
    appRole: "Owner",
    permissions: emptyPermissionMap(),
  });
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.equal(d.status, 401);
  console.log("✓ inactive user → 401");
}

function main() {
  testUnauthenticated401();
  testOwnerAdminAllowed();
  testTeacherSpoofDenied();
  testCrossSchoolBodyDenied();
  testJwtDbSchoolMismatch();
  testParentsCreatePermission();
  testClientRoleStringsNotTrusted();
  testInactiveUser();
  console.log("requireParentStaffAuth.test.ts: OK");
}

main();
