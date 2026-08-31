/**
 * Fly Eagle dual-identity statement lookup + Da Silva / MBB regression.
 * Run: npx tsx src/services/resolveStatementLedgerJoin.test.ts
 */
import { resolveStatementLedgerJoinFromFamilies } from "./resolveStatementLedgerJoin";

const FLY_EAGLE = "cmt1e8bjp0jo8lcjeketlynhl";
const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";
const MBB = "cmq4xjckq00at60gqg4eb956h";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const flyEagleAbaye = {
  schoolId: FLY_EAGLE,
  accountRef: "ABAYE TUMO ASHANAFY",
  accountNo: "ABA001",
};

const flyEagleMok = {
  schoolId: FLY_EAGLE,
  accountRef: "MOK017",
  accountNo: "MOK017",
};

const daSilvaAli = {
  schoolId: DA_SILVA,
  accountRef: "ALI002",
  accountNo: null,
};

const daSilvaDup = {
  schoolId: DA_SILVA,
  accountRef: "DUP001",
  accountNo: null,
};

const mbbOne = {
  schoolId: MBB,
  accountRef: "MBB001",
  accountNo: null,
};

const allSchools = [flyEagleAbaye, flyEagleMok, daSilvaAli, daSilvaDup, mbbOne];

function testFlyEagleDedicatedAccountNoUsesPreservedAccountRef() {
  const join = resolveStatementLedgerJoinFromFamilies({
    authorizedSchoolId: FLY_EAGLE,
    query: "ABA001",
    families: [flyEagleAbaye],
  });
  assert(join === "ABAYE TUMO ASHANAFY", "ABA001 must join ledger via Express accountRef");
  assert(join !== "ABA001", "dedicated accountNo is not the ledger key");
  console.log("✓ Fly Eagle ABA001 → preserved Express accountRef");
}

function testFlyEagleExpressNameStillResolves() {
  const join = resolveStatementLedgerJoinFromFamilies({
    authorizedSchoolId: FLY_EAGLE,
    query: "ABAYE TUMO ASHANAFY",
    families: [flyEagleAbaye],
  });
  assert(join === "ABAYE TUMO ASHANAFY", "Express name query still joins on accountRef");
  console.log("✓ Fly Eagle Express name query → same join key");
}

function testFlyEagleNativeCodeUnchanged() {
  const join = resolveStatementLedgerJoinFromFamilies({
    authorizedSchoolId: FLY_EAGLE,
    query: "MOK017",
    families: [flyEagleMok],
  });
  assert(join === "MOK017", "native EduClear code remains the join key");
  console.log("✓ Fly Eagle native MOK017 join unchanged");
}

function testDaSilvaKidESysUnchanged() {
  const ali = resolveStatementLedgerJoinFromFamilies({
    authorizedSchoolId: DA_SILVA,
    query: "ALI002",
    families: [daSilvaAli, daSilvaDup],
  });
  const dup = resolveStatementLedgerJoinFromFamilies({
    authorizedSchoolId: DA_SILVA,
    query: "dup001",
    families: [daSilvaAli, daSilvaDup],
  });
  assert(ali === "ALI002", "Da Silva ALI002 still joins on accountRef");
  assert(dup === "DUP001", "Da Silva DUP001 still joins on accountRef");
  console.log("✓ Da Silva Kid-e-Sys statement identity unchanged");
}

function testMbbKidESysUnchanged() {
  const join = resolveStatementLedgerJoinFromFamilies({
    authorizedSchoolId: MBB,
    query: "MBB001",
    families: [mbbOne],
  });
  assert(join === "MBB001", "MBB Kid-e-Sys join unchanged");
  console.log("✓ Magical Bright Beginnings statement identity unchanged");
}

function testTenantIsolationIgnoresOtherSchoolFamilies() {
  const flyEagleLookingUpAli = resolveStatementLedgerJoinFromFamilies({
    authorizedSchoolId: FLY_EAGLE,
    query: "ALI002",
    families: allSchools,
  });
  assert(flyEagleLookingUpAli === null, "Fly Eagle must not resolve Da Silva ALI002");

  const daSilvaLookingUpAba = resolveStatementLedgerJoinFromFamilies({
    authorizedSchoolId: DA_SILVA,
    query: "ABA001",
    families: allSchools,
  });
  assert(daSilvaLookingUpAba === null, "Da Silva must not resolve Fly Eagle ABA001");

  const mbbLookingUpExpress = resolveStatementLedgerJoinFromFamilies({
    authorizedSchoolId: MBB,
    query: "ABAYE TUMO ASHANAFY",
    families: allSchools,
  });
  assert(mbbLookingUpExpress === null, "MBB must not resolve Fly Eagle Express ref");
  console.log("✓ statement join is school-scoped (Fly Eagle / Da Silva / MBB)");
}

function testSasamsNumericRejected() {
  const join = resolveStatementLedgerJoinFromFamilies({
    authorizedSchoolId: FLY_EAGLE,
    query: "1234567",
    families: [{ schoolId: FLY_EAGLE, accountRef: "1234567", accountNo: null }],
  });
  assert(join === null, "SA-SAMS numeric must not be a statement join key");
  console.log("✓ SA-SAMS numeric query rejected");
}

function testEmptyQueryAndDashRejected() {
  assert(
    resolveStatementLedgerJoinFromFamilies({
      authorizedSchoolId: FLY_EAGLE,
      query: "",
      families: [flyEagleAbaye],
    }) === null,
    "empty query"
  );
  assert(
    resolveStatementLedgerJoinFromFamilies({
      authorizedSchoolId: FLY_EAGLE,
      query: "-",
      families: [flyEagleAbaye],
    }) === null,
    "placeholder dash"
  );
  console.log("✓ empty / placeholder query rejected");
}

function main() {
  testFlyEagleDedicatedAccountNoUsesPreservedAccountRef();
  testFlyEagleExpressNameStillResolves();
  testFlyEagleNativeCodeUnchanged();
  testDaSilvaKidESysUnchanged();
  testMbbKidESysUnchanged();
  testTenantIsolationIgnoresOtherSchoolFamilies();
  testSasamsNumericRejected();
  testEmptyQueryAndDashRejected();
  console.log("resolveStatementLedgerJoin.test.ts: OK");
}

main();
