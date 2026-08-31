/**
 * Invoice run preview/execute auth tests (pure decision logic).
 * Fly Eagle, Da Silva, and MBB tenant isolation — client schoolId cannot override session school.
 * Run: npx tsx src/middleware/requireInvoiceRunExecuteAuth.test.ts
 */
import { evaluateInvoiceRunExecuteAuth } from "./requireInvoiceRunExecuteAuth";

const FLY_EAGLE = "cmt1e8bjp0jo8lcjeketlynhl";
const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";
const MBB = "cmq4xjckq00at60gqg4eb956h";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function jwtPayload(schoolId: string) {
  return {
    userId: "user-invoice-run-execute",
    schoolId,
    email: "finance@example.com",
    role: "SCHOOL_ADMIN",
  };
}

function activeUser(schoolId: string, role = "SCHOOL_ADMIN") {
  return { schoolId, role, isActive: true };
}

function testUnauthenticated401() {
  const d = evaluateInvoiceRunExecuteAuth({
    jwtPayload: null,
    user: null,
    appRole: "Owner",
    requestSchoolId: FLY_EAGLE,
  });
  assert(!d.allowed && d.status === 401, "missing jwt → 401");
  console.log("✓ unauthenticated → 401");
}

function testWrongRole403() {
  for (const role of ["Teacher", "Viewer", "Staff"]) {
    const d = evaluateInvoiceRunExecuteAuth({
      jwtPayload: jwtPayload(FLY_EAGLE),
      user: activeUser(FLY_EAGLE),
      appRole: role,
      requestSchoolId: FLY_EAGLE,
    });
    assert(!d.allowed && d.status === 403, `${role} → 403`);
  }
  console.log("✓ Teacher/Viewer/Staff → 403");
}

function testAllowedFinanceRoles() {
  for (const schoolId of [FLY_EAGLE, DA_SILVA, MBB]) {
    for (const role of ["Owner", "Admin", "Finance"]) {
      const d = evaluateInvoiceRunExecuteAuth({
        jwtPayload: jwtPayload(schoolId),
        user: activeUser(schoolId),
        appRole: role,
        requestSchoolId: schoolId,
      });
      assert(d.allowed && d.authorizedSchoolId === schoolId, `${role} @ ${schoolId} allowed`);
    }
  }
  console.log("✓ Owner/Admin/Finance allowed for Fly Eagle, Da Silva, MBB");
}

function testClientSchoolIdCannotOverrideTenant() {
  const flyEagleSpoofingDaSilva = evaluateInvoiceRunExecuteAuth({
    jwtPayload: jwtPayload(FLY_EAGLE),
    user: activeUser(FLY_EAGLE),
    appRole: "Owner",
    requestSchoolId: DA_SILVA,
  });
  assert(!flyEagleSpoofingDaSilva.allowed && flyEagleSpoofingDaSilva.status === 403, "Fly Eagle → Da Silva 403");

  const daSilvaSpoofingFlyEagle = evaluateInvoiceRunExecuteAuth({
    jwtPayload: jwtPayload(DA_SILVA),
    user: activeUser(DA_SILVA),
    appRole: "Finance",
    requestSchoolId: FLY_EAGLE,
  });
  assert(!daSilvaSpoofingFlyEagle.allowed && daSilvaSpoofingFlyEagle.status === 403, "Da Silva → Fly Eagle 403");

  const mbbSpoofingFlyEagle = evaluateInvoiceRunExecuteAuth({
    jwtPayload: jwtPayload(MBB),
    user: activeUser(MBB),
    appRole: "Admin",
    requestSchoolId: FLY_EAGLE,
  });
  assert(!mbbSpoofingFlyEagle.allowed && mbbSpoofingFlyEagle.status === 403, "MBB → Fly Eagle 403");

  const flyEagleSpoofingMbb = evaluateInvoiceRunExecuteAuth({
    jwtPayload: jwtPayload(FLY_EAGLE),
    user: activeUser(FLY_EAGLE),
    appRole: "Owner",
    requestSchoolId: MBB,
  });
  assert(!flyEagleSpoofingMbb.allowed && flyEagleSpoofingMbb.status === 403, "Fly Eagle → MBB 403");
  console.log("✓ client schoolId cannot override tenant (Fly Eagle / Da Silva / MBB)");
}

function testJwtSchoolMismatch403() {
  const d = evaluateInvoiceRunExecuteAuth({
    jwtPayload: jwtPayload(MBB),
    user: activeUser(FLY_EAGLE),
    appRole: "Owner",
    requestSchoolId: MBB,
  });
  assert(!d.allowed && d.status === 403, "jwt school != db user school → 403");
  console.log("✓ jwt/db school mismatch → 403");
}

function testEmptyBodyUsesAuthorizedSchool() {
  for (const schoolId of [FLY_EAGLE, DA_SILVA, MBB]) {
    const d = evaluateInvoiceRunExecuteAuth({
      jwtPayload: jwtPayload(schoolId),
      user: activeUser(schoolId),
      appRole: "Finance",
      requestSchoolId: "",
    });
    assert(d.allowed && d.authorizedSchoolId === schoolId, `empty body uses ${schoolId}`);
  }
  console.log("✓ empty request schoolId uses authenticated school");
}

function testMatchingBodySchoolAllowed() {
  const d = evaluateInvoiceRunExecuteAuth({
    jwtPayload: jwtPayload(FLY_EAGLE),
    user: activeUser(FLY_EAGLE),
    appRole: "Owner",
    requestSchoolId: FLY_EAGLE,
  });
  assert(d.allowed && d.authorizedSchoolId === FLY_EAGLE, "matching body schoolId still binds session school");
  console.log("✓ matching client schoolId still binds session school");
}

function main() {
  testUnauthenticated401();
  testWrongRole403();
  testAllowedFinanceRoles();
  testClientSchoolIdCannotOverrideTenant();
  testJwtSchoolMismatch403();
  testEmptyBodyUsesAuthorizedSchool();
  testMatchingBodySchoolAllowed();
  console.log("requireInvoiceRunExecuteAuth.test.ts: OK");
}

main();
