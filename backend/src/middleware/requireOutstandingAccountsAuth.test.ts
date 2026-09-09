/**
 * Outstanding Accounts auth decision tests (pure).
 * Run: npx tsx src/middleware/requireOutstandingAccountsAuth.test.ts
 */
import assert from "assert";
import { evaluateOutstandingAccountsAuth } from "./requireOutstandingAccountsAuth";
import { permissionsForRole } from "../utils/userPermissions";

const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";
const OTHER_SCHOOL = "cmt1e8bjp0jo8lcjeketlynhl";

function jwtPayload(schoolId: string) {
  return {
    userId: "user-oa-1",
    schoolId,
    email: "finance@example.com",
    role: "FINANCE",
  };
}

function activeUser(schoolId: string) {
  return { id: "user-oa-1", schoolId, role: "FINANCE", isActive: true };
}

function testUnauthenticated() {
  const d = evaluateOutstandingAccountsAuth({
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
  const d = evaluateOutstandingAccountsAuth({
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

function testTeacherDenied() {
  const d = evaluateOutstandingAccountsAuth({
    jwtPayload: jwtPayload(DA_SILVA),
    user: activeUser(DA_SILVA),
    appRole: "Teacher",
    permissions: permissionsForRole("Teacher"),
    requestSchoolId: DA_SILVA,
  });
  assert.equal(d.allowed, false);
  if (!d.allowed) {
    assert.equal(d.status, 403);
    assert.equal(d.code, "FORBIDDEN_PERMISSION");
  }
  console.log("✓ Teacher without statements.view → 403");
}

function testFinanceAllowed() {
  const d = evaluateOutstandingAccountsAuth({
    jwtPayload: jwtPayload(DA_SILVA),
    user: activeUser(DA_SILVA),
    appRole: "Finance",
    permissions: permissionsForRole("Finance"),
    requestSchoolId: DA_SILVA,
  });
  assert.equal(d.allowed, true);
  if (d.allowed) assert.equal(d.authorizedSchoolId, DA_SILVA);
  console.log("✓ Finance same-school → allowed");
}

function testAuthorizedSchoolWinsWithoutQuerySchool() {
  const d = evaluateOutstandingAccountsAuth({
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
testTeacherDenied();
testFinanceAllowed();
testAuthorizedSchoolWinsWithoutQuerySchool();
console.log("\nAll requireOutstandingAccountsAuth tests passed.");
