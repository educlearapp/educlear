/**
 * Capture Payment auth decision tests (pure).
 * Run: npx tsx src/middleware/requireCapturePaymentAuth.test.ts
 */
import assert from "assert";
import { evaluateCapturePaymentAuth } from "./requireCapturePaymentAuth";
import { permissionsForRole } from "../utils/userPermissions";

const FLY_EAGLE = "cmt1e8bjp0jo8lcjeketlynhl";
const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";
const MBB = "cmq4xjckq00at60gqg4eb956h";

function jwtPayload(schoolId: string, role = "FINANCE") {
  return {
    userId: "user-capture-1",
    schoolId,
    email: "finance@example.com",
    role,
  };
}

function activeUser(schoolId: string, role = "FINANCE") {
  return { id: "user-capture-1", schoolId, role, isActive: true };
}

function testUnauthenticated() {
  const d = evaluateCapturePaymentAuth({
    jwtPayload: null,
    user: null,
    appRole: "Finance",
    permissions: null,
    requestSchoolId: FLY_EAGLE,
  });
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.equal(d.status, 401);
  console.log("✓ unauthenticated → 401");
}

function testUnauthorizedRoles() {
  for (const role of ["Teacher", "Viewer", "Admin"] as const) {
    const d = evaluateCapturePaymentAuth({
      jwtPayload: jwtPayload(FLY_EAGLE, "STAFF"),
      user: activeUser(FLY_EAGLE, "STAFF"),
      appRole: role,
      permissions: permissionsForRole(role),
      requestSchoolId: FLY_EAGLE,
    });
    assert.equal(d.allowed, false, `${role} must be denied`);
    if (!d.allowed) {
      assert.equal(d.status, 403);
      assert.equal(d.code, "FORBIDDEN_PERMISSION");
    }
  }
  console.log("✓ Teacher / Viewer / Admin (no payments.create) → 403");
}

function testAllowedRoles() {
  for (const role of ["Owner", "Finance"] as const) {
    const d = evaluateCapturePaymentAuth({
      jwtPayload: jwtPayload(FLY_EAGLE),
      user: activeUser(FLY_EAGLE),
      appRole: role,
      permissions: permissionsForRole(role),
      requestSchoolId: FLY_EAGLE,
    });
    assert.equal(d.allowed, true, `${role} must be allowed`);
    if (d.allowed) assert.equal(d.authorizedSchoolId, FLY_EAGLE);
  }
  console.log("✓ Owner + Finance allowed");
}

function testClientSchoolIdCannotOverride() {
  const d = evaluateCapturePaymentAuth({
    jwtPayload: jwtPayload(FLY_EAGLE),
    user: activeUser(FLY_EAGLE),
    appRole: "Finance",
    permissions: permissionsForRole("Finance"),
    requestSchoolId: DA_SILVA,
  });
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.equal(d.code, "SCHOOL_MISMATCH");
  console.log("✓ client schoolId cannot override session (Fly Eagle → Da Silva body)");
}

function testCrossSchoolRejected() {
  const pairs: Array<[string, string, string]> = [
    [FLY_EAGLE, DA_SILVA, "Fly Eagle → Da Silva"],
    [FLY_EAGLE, MBB, "Fly Eagle → Magical Bright Beginnings"],
    [DA_SILVA, FLY_EAGLE, "Da Silva → Fly Eagle"],
    [MBB, FLY_EAGLE, "Magical Bright Beginnings → Fly Eagle"],
  ];
  for (const [from, to, label] of pairs) {
    const d = evaluateCapturePaymentAuth({
      jwtPayload: jwtPayload(from),
      user: activeUser(from),
      appRole: "Finance",
      permissions: permissionsForRole("Finance"),
      requestSchoolId: to,
    });
    assert.equal(d.allowed, false, label);
    if (!d.allowed) assert.equal(d.status, 403);
  }
  console.log("✓ cross-school POST schoolId rejected for FE / DSA / MBB");
}

function testInactiveUser() {
  const d = evaluateCapturePaymentAuth({
    jwtPayload: jwtPayload(FLY_EAGLE),
    user: { id: "user-capture-1", schoolId: FLY_EAGLE, role: "FINANCE", isActive: false },
    appRole: "Finance",
    permissions: permissionsForRole("Finance"),
    requestSchoolId: FLY_EAGLE,
  });
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.equal(d.status, 401);
  console.log("✓ inactive user → 401");
}

function testReadViewAllowsAdminAndFinance() {
  for (const role of ["Owner", "Finance", "Admin"] as const) {
    const d = evaluateCapturePaymentAuth({
      jwtPayload: jwtPayload(FLY_EAGLE),
      user: activeUser(FLY_EAGLE),
      appRole: role,
      permissions: permissionsForRole(role),
      requestSchoolId: FLY_EAGLE,
      requireAction: "view",
    });
    assert.equal(d.allowed, true, `${role} must be allowed to read payments`);
  }
  for (const role of ["Teacher", "Viewer"] as const) {
    const d = evaluateCapturePaymentAuth({
      jwtPayload: jwtPayload(FLY_EAGLE, "STAFF"),
      user: activeUser(FLY_EAGLE, "STAFF"),
      appRole: role,
      permissions: permissionsForRole(role),
      requestSchoolId: FLY_EAGLE,
      requireAction: "view",
    });
    assert.equal(d.allowed, false, `${role} must not read payments`);
  }
  console.log("✓ payments.view: Owner/Finance/Admin allowed; Teacher/Viewer denied");
}

function testUnauthenticatedRead() {
  const d = evaluateCapturePaymentAuth({
    jwtPayload: null,
    user: null,
    appRole: "Finance",
    permissions: null,
    requestSchoolId: FLY_EAGLE,
    requireAction: "view",
  });
  assert.equal(d.allowed, false);
  if (!d.allowed) assert.equal(d.status, 401);
  console.log("✓ unauthenticated payment GET → 401");
}

testUnauthenticated();
testUnauthorizedRoles();
testAllowedRoles();
testClientSchoolIdCannotOverride();
testCrossSchoolRejected();
testInactiveUser();
testReadViewAllowsAdminAndFinance();
testUnauthenticatedRead();
console.log("\nAll requireCapturePaymentAuth tests passed.");
