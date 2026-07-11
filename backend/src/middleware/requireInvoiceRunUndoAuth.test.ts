/**
 * Invoice run undo auth tests (pure decision logic).
 * Run: npx tsx src/middleware/requireInvoiceRunUndoAuth.test.ts
 */
import { evaluateInvoiceRunUndoAuth } from "./requireInvoiceRunUndoAuth";

const SCHOOL_A = "school-a-invoice-run-undo";
const SCHOOL_B = "school-b-invoice-run-undo";

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
  const d = evaluateInvoiceRunUndoAuth({
    jwtPayload: null,
    user: null,
    appRole: "Owner",
    requestSchoolId: SCHOOL_A,
  });
  assert(!d.allowed && d.status === 401, "missing jwt → 401");
  console.log("✓ unauthenticated → 401");
}

function testWrongRole403() {
  for (const role of ["Teacher", "Viewer", "Staff"]) {
    const d = evaluateInvoiceRunUndoAuth({
      jwtPayload: jwtPayload(SCHOOL_A),
      user: activeUser(SCHOOL_A),
      appRole: role,
      requestSchoolId: SCHOOL_A,
    });
    assert(!d.allowed && d.status === 403, `${role} → 403`);
  }
  console.log("✓ Teacher/Viewer/Staff → 403");
}

function testAllowedFinanceRoles() {
  for (const role of ["Owner", "Admin", "Finance"]) {
    const d = evaluateInvoiceRunUndoAuth({
      jwtPayload: jwtPayload(SCHOOL_A),
      user: activeUser(SCHOOL_A),
      appRole: role,
      requestSchoolId: SCHOOL_A,
    });
    assert(d.allowed && d.authorizedSchoolId === SCHOOL_A, `${role} allowed`);
  }
  console.log("✓ Owner/Admin/Finance allowed");
}

function testCrossSchoolBody403() {
  const d = evaluateInvoiceRunUndoAuth({
    jwtPayload: jwtPayload(SCHOOL_A),
    user: activeUser(SCHOOL_A),
    appRole: "Owner",
    requestSchoolId: SCHOOL_B,
  });
  assert(!d.allowed && d.status === 403, "spoofed body schoolId → 403");
  console.log("✓ cross-school body schoolId → 403");
}

function testJwtSchoolMismatch403() {
  const d = evaluateInvoiceRunUndoAuth({
    jwtPayload: jwtPayload(SCHOOL_B),
    user: activeUser(SCHOOL_A),
    appRole: "Owner",
    requestSchoolId: SCHOOL_B,
  });
  assert(!d.allowed && d.status === 403, "jwt school != db user school → 403");
  console.log("✓ jwt/db school mismatch → 403");
}

function testEmptyBodyUsesAuthorizedSchool() {
  const d = evaluateInvoiceRunUndoAuth({
    jwtPayload: jwtPayload(SCHOOL_A),
    user: activeUser(SCHOOL_A),
    appRole: "Finance",
    requestSchoolId: "",
  });
  assert(d.allowed && d.authorizedSchoolId === SCHOOL_A, "empty body school uses auth school");
  console.log("✓ empty request schoolId uses authenticated school");
}

function main() {
  testUnauthenticated401();
  testWrongRole403();
  testAllowedFinanceRoles();
  testCrossSchoolBody403();
  testJwtSchoolMismatch403();
  testEmptyBodyUsesAuthorizedSchool();
  console.log("requireInvoiceRunUndoAuth.test.ts: OK");
}

main();
