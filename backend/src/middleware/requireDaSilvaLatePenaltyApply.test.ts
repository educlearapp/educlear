/**
 * Da Silva late penalty apply auth tests (pure decision logic).
 * Run: npx ts-node --transpile-only src/middleware/requireDaSilvaLatePenaltyApply.test.ts
 */
import { DA_SILVA_ACADEMY_SCHOOL_ID } from "../services/activateDaSilvaSubscription";
import { evaluateDaSilvaLatePenaltyApplyAuth } from "./requireDaSilvaLatePenaltyApply";

const MBB_SCHOOL_ID = "cmq4xjckq00at60gqg4eb956h";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function jwtPayload(schoolId: string) {
  return {
    userId: "user-test-1",
    schoolId,
    email: "test@example.com",
    role: "SCHOOL_ADMIN",
  };
}

function activeUser(schoolId: string, role = "SCHOOL_ADMIN") {
  return { schoolId, role, isActive: true };
}

function testUnauthenticated401() {
  const d = evaluateDaSilvaLatePenaltyApplyAuth({
    jwtPayload: null,
    user: null,
    appRole: "Owner",
    requestSchoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
  });
  assert(!d.allowed && d.status === 401, "missing jwt → 401");
  console.log("✓ unauthenticated → 401");
}

function testWrongRole403() {
  for (const role of ["Teacher", "Viewer", "Staff"]) {
    const d = evaluateDaSilvaLatePenaltyApplyAuth({
      jwtPayload: jwtPayload(DA_SILVA_ACADEMY_SCHOOL_ID),
      user: activeUser(DA_SILVA_ACADEMY_SCHOOL_ID),
      appRole: role,
      requestSchoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
    });
    assert(!d.allowed && d.status === 403, `${role} → 403`);
  }
  console.log("✓ Teacher/Viewer/Staff → 403");
}

function testAllowedFinanceRoles() {
  for (const role of ["Owner", "Admin", "Finance"]) {
    const d = evaluateDaSilvaLatePenaltyApplyAuth({
      jwtPayload: jwtPayload(DA_SILVA_ACADEMY_SCHOOL_ID),
      user: activeUser(DA_SILVA_ACADEMY_SCHOOL_ID),
      appRole: role,
      requestSchoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
    });
    assert(d.allowed && d.schoolId === DA_SILVA_ACADEMY_SCHOOL_ID, `${role} allowed`);
  }
  console.log("✓ Owner/Admin/Finance allowed");
}

function testMbb403() {
  const d = evaluateDaSilvaLatePenaltyApplyAuth({
    jwtPayload: jwtPayload(MBB_SCHOOL_ID),
    user: activeUser(MBB_SCHOOL_ID),
    appRole: "Owner",
    requestSchoolId: MBB_SCHOOL_ID,
  });
  assert(!d.allowed && d.status === 403, "MBB owner → 403");
  console.log("✓ MBB → 403");
}

function testWrongSchoolBody403() {
  const d = evaluateDaSilvaLatePenaltyApplyAuth({
    jwtPayload: jwtPayload(DA_SILVA_ACADEMY_SCHOOL_ID),
    user: activeUser(DA_SILVA_ACADEMY_SCHOOL_ID),
    appRole: "Owner",
    requestSchoolId: MBB_SCHOOL_ID,
  });
  assert(!d.allowed && d.status === 403, "Da Silva user + MBB body schoolId → 403");
  console.log("✓ wrong-school body schoolId → 403");
}

function testMbbUserCannotSpoofDaSilvaBody() {
  const d = evaluateDaSilvaLatePenaltyApplyAuth({
    jwtPayload: jwtPayload(MBB_SCHOOL_ID),
    user: activeUser(MBB_SCHOOL_ID),
    appRole: "Owner",
    requestSchoolId: DA_SILVA_ACADEMY_SCHOOL_ID,
  });
  assert(!d.allowed && d.status === 403, "MBB user cannot apply to Da Silva body schoolId");
  console.log("✓ MBB user spoofing Da Silva schoolId → 403");
}

function run() {
  testUnauthenticated401();
  testWrongRole403();
  testAllowedFinanceRoles();
  testMbb403();
  testWrongSchoolBody403();
  testMbbUserCannotSpoofDaSilvaBody();
  console.log("\nrequireDaSilvaLatePenaltyApply.test.ts: all passed");
}

run();
