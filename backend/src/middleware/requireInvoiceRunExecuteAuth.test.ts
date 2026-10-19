/**
 * Invoice run preview/execute auth tests (pure decision logic).
 * Fly Eagle, Da Silva, and MBB tenant isolation — client schoolId cannot override session school.
 * Run: npx tsx src/middleware/requireInvoiceRunExecuteAuth.test.ts
 */
import { evaluateInvoiceRunExecuteAuth } from "./requireInvoiceRunExecuteAuth";
import { emptyPermissionMap, type PermissionMap } from "../utils/userPermissions";

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

function invoiceRunPermissions(action: "view" | "create" | "manage"): PermissionMap {
  const map = emptyPermissionMap();
  map.invoiceRuns[action] = true;
  return map;
}

function testCustomRoleFollowsInvoiceRunPermission() {
  const viewOnly = evaluateInvoiceRunExecuteAuth({
    jwtPayload: jwtPayload(FLY_EAGLE),
    user: activeUser(FLY_EAGLE),
    appRole: "Custom",
    permissions: invoiceRunPermissions("view"),
    intent: "preview",
    requestSchoolId: FLY_EAGLE,
  });
  assert(viewOnly.allowed, "Fly Eagle Custom with invoiceRuns.view can preview");

  const viewCannotExecute = evaluateInvoiceRunExecuteAuth({
    jwtPayload: jwtPayload(FLY_EAGLE),
    user: activeUser(FLY_EAGLE),
    appRole: "Custom",
    permissions: invoiceRunPermissions("view"),
    intent: "execute",
    requestSchoolId: FLY_EAGLE,
  });
  assert(!viewCannotExecute.allowed && viewCannotExecute.status === 403, "view-only Custom cannot execute");

  const createCanExecute = evaluateInvoiceRunExecuteAuth({
    jwtPayload: jwtPayload(FLY_EAGLE),
    user: activeUser(FLY_EAGLE),
    appRole: "Custom",
    permissions: invoiceRunPermissions("create"),
    intent: "execute",
    requestSchoolId: FLY_EAGLE,
  });
  assert(createCanExecute.allowed, "Custom with invoiceRuns.create can execute");

  const teacher = evaluateInvoiceRunExecuteAuth({
    jwtPayload: jwtPayload(FLY_EAGLE),
    user: activeUser(FLY_EAGLE),
    appRole: "Teacher",
    permissions: emptyPermissionMap(),
    intent: "preview",
    requestSchoolId: FLY_EAGLE,
  });
  assert(!teacher.allowed && teacher.status === 403, "Teacher without Invoice Runs permission → 403");

  const manageCanExecute = evaluateInvoiceRunExecuteAuth({
    jwtPayload: jwtPayload(DA_SILVA),
    user: activeUser(DA_SILVA),
    appRole: "Custom",
    permissions: invoiceRunPermissions("manage"),
    intent: "execute",
    requestSchoolId: DA_SILVA,
  });
  assert(manageCanExecute.allowed, "Da Silva Custom with invoiceRuns.manage can execute");

  const daSilvaView = evaluateInvoiceRunExecuteAuth({
    jwtPayload: jwtPayload(DA_SILVA),
    user: activeUser(DA_SILVA),
    appRole: "Custom",
    permissions: invoiceRunPermissions("view"),
    intent: "preview",
    requestSchoolId: DA_SILVA,
  });
  assert(daSilvaView.allowed, "Da Silva Custom with invoiceRuns.view can preview");
  const daSilvaViewExecute = evaluateInvoiceRunExecuteAuth({
    jwtPayload: jwtPayload(DA_SILVA),
    user: activeUser(DA_SILVA),
    appRole: "Custom",
    permissions: invoiceRunPermissions("view"),
    intent: "execute",
    requestSchoolId: DA_SILVA,
  });
  assert(
    !daSilvaViewExecute.allowed &&
      daSilvaViewExecute.status === 403 &&
      daSilvaViewExecute.error === "Invoice Runs create permission required for invoice run execute",
    "Da Silva view-only Custom gets a clear execute error"
  );

  const noInvoiceRuns = evaluateInvoiceRunExecuteAuth({
    jwtPayload: jwtPayload(FLY_EAGLE),
    user: activeUser(FLY_EAGLE),
    appRole: "Custom",
    permissions: emptyPermissionMap(),
    intent: "preview",
    requestSchoolId: FLY_EAGLE,
  });
  assert(
    !noInvoiceRuns.allowed &&
      noInvoiceRuns.error === "Invoice Runs permission required for invoice run preview",
    "Custom without Invoice Runs permission cannot preview"
  );

  const ownerWithoutBits = evaluateInvoiceRunExecuteAuth({
    jwtPayload: jwtPayload(DA_SILVA),
    user: activeUser(DA_SILVA),
    appRole: "Owner",
    permissions: emptyPermissionMap(),
    intent: "execute",
    requestSchoolId: DA_SILVA,
  });
  assert(ownerWithoutBits.allowed, "Owner access is unchanged when permission bits are empty");

  const spoof = evaluateInvoiceRunExecuteAuth({
    jwtPayload: jwtPayload(FLY_EAGLE),
    user: activeUser(FLY_EAGLE),
    appRole: "Custom",
    permissions: invoiceRunPermissions("create"),
    intent: "preview",
    requestSchoolId: DA_SILVA,
  });
  assert(!spoof.allowed && spoof.status === 403, "Custom permission cannot cross tenants");
  console.log("✓ Custom Invoice Runs permission allows preview without bypassing tenant or execute gates");
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
  testCustomRoleFollowsInvoiceRunPermission();
  testMatchingBodySchoolAllowed();
  console.log("requireInvoiceRunExecuteAuth.test.ts: OK");
}

main();
