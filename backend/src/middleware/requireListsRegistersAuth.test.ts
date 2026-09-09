/**
 * Lists & Registers auth decision tests (pure).
 * Run: npx tsx src/middleware/requireListsRegistersAuth.test.ts
 */
import assert from "assert";
import { evaluateListsRegistersAuth } from "./requireListsRegistersAuth";
import { permissionsForRole } from "../utils/userPermissions";

const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";
const OTHER_SCHOOL = "cmt1e8bjp0jo8lcjeketlynhl";

function jwtPayload(schoolId: string) {
  return {
    userId: "user-lr-1",
    schoolId,
    email: "staff@example.com",
    role: "ADMIN",
  };
}

function activeUser(schoolId: string) {
  return { id: "user-lr-1", schoolId, role: "ADMIN", isActive: true };
}

function testUnauthenticated() {
  const d = evaluateListsRegistersAuth({
    jwtPayload: null,
    user: null,
    appRole: "Finance",
    permissions: null,
    requestSchoolId: DA_SILVA,
  });
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.equal(d.status, 401);
  console.log("✓ unauthenticated → 401");
}

function testCrossSchoolDenied() {
  const d = evaluateListsRegistersAuth({
    jwtPayload: jwtPayload(DA_SILVA),
    user: activeUser(DA_SILVA),
    appRole: "Finance",
    permissions: permissionsForRole("Finance"),
    requestSchoolId: OTHER_SCHOOL,
  });
  assert.equal(d.allowed, false);
  if (!d.allowed) {
    assert.equal(d.status, 403);
    assert.equal(d.code, "SCHOOL_MISMATCH");
  }
  console.log("✓ School A cannot request School B → 403 SCHOOL_MISMATCH");
}

function testCustomNoPermissionDenied() {
  const empty = permissionsForRole("Custom", null as any);
  const d = evaluateListsRegistersAuth({
    jwtPayload: jwtPayload(DA_SILVA),
    user: { id: "user-lr-1", schoolId: DA_SILVA, role: "CUSTOM", isActive: true },
    appRole: "Custom",
    permissions: empty,
    requestSchoolId: DA_SILVA,
  });
  assert.equal(d.allowed, false);
  if (!d.allowed) {
    assert.equal(d.status, 403);
    assert.equal(d.code, "FORBIDDEN_PERMISSION");
  }
  console.log("✓ insufficient permission → 403");
}

function testReportsViewAllowed() {
  const d = evaluateListsRegistersAuth({
    jwtPayload: jwtPayload(DA_SILVA),
    user: { id: "user-lr-1", schoolId: DA_SILVA, role: "TEACHER", isActive: true },
    appRole: "Teacher",
    permissions: permissionsForRole("Teacher"),
    requestSchoolId: DA_SILVA,
  });
  assert.equal(d.allowed, true);
  if (d.allowed) assert.equal(d.authorizedSchoolId, DA_SILVA);
  console.log("✓ Teacher with reports.view → allowed");
}

function testAuthorizedSchoolWinsWithoutQuerySchool() {
  const d = evaluateListsRegistersAuth({
    jwtPayload: jwtPayload(DA_SILVA),
    user: activeUser(DA_SILVA),
    appRole: "Owner",
    permissions: permissionsForRole("Owner"),
    requestSchoolId: "",
  });
  assert.equal(d.allowed, true);
  if (d.allowed) assert.equal(d.authorizedSchoolId, DA_SILVA);
  console.log("✓ empty request schoolId still binds to authorized school");
}

testUnauthenticated();
testCrossSchoolDenied();
testCustomNoPermissionDenied();
testReportsViewAllowed();
testAuthorizedSchoolWinsWithoutQuerySchool();
console.log("\nAll requireListsRegistersAuth tests passed.");
