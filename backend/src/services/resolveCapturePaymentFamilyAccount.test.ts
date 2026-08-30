/**
 * Capture Payment FamilyAccount.id resolution tests (pure).
 * Run: npx tsx src/services/resolveCapturePaymentFamilyAccount.test.ts
 */
import { evaluateCapturePaymentFamily } from "./resolveCapturePaymentFamilyAccount";

const FLY_EAGLE = "cmt1e8bjp0jo8lcjeketlynhl";
const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";
const MBB = "cmq4xjckq00at60gqg4eb956h";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function testUnknown() {
  const d = evaluateCapturePaymentFamily({
    family: null,
    authorizedSchoolId: FLY_EAGLE,
  });
  assert(!d.ok && d.status === 404, "unknown FamilyAccount.id → 404");
  console.log("✓ nonexistent FamilyAccount.id rejected");
}

function testCrossSchoolFamilyId() {
  const daSilvaFamily = {
    id: "fa-dasilva",
    schoolId: DA_SILVA,
    accountRef: "SIL007",
    familyName: "Silva",
    learnerCount: 2,
  };
  const d = evaluateCapturePaymentFamily({
    family: daSilvaFamily,
    authorizedSchoolId: FLY_EAGLE,
  });
  assert(!d.ok && d.status === 403 && d.code === "CROSS_SCHOOL_FAMILY_ACCOUNT", "Fly Eagle cannot pay Da Silva FA");

  const mbb = evaluateCapturePaymentFamily({
    family: { ...daSilvaFamily, id: "fa-mbb", schoolId: MBB, accountRef: "MBB001" },
    authorizedSchoolId: FLY_EAGLE,
  });
  assert(!mbb.ok && mbb.status === 403, "Fly Eagle cannot pay MBB FA");

  const reverse = evaluateCapturePaymentFamily({
    family: {
      id: "fa-fe",
      schoolId: FLY_EAGLE,
      accountRef: "ABAYE TUMO ASHANAFY",
      familyName: "Abaye",
      learnerCount: 1,
    },
    authorizedSchoolId: DA_SILVA,
  });
  assert(!reverse.ok && reverse.status === 403, "Da Silva cannot pay Fly Eagle FA");
  console.log("✓ valid FamilyAccount.id from another school rejected");
}

function testRetiredPredecessor() {
  const d = evaluateCapturePaymentFamily({
    family: {
      id: "fa-empty",
      schoolId: FLY_EAGLE,
      accountRef: "OLDREF",
      familyName: "Merged",
      learnerCount: 0,
    },
    authorizedSchoolId: FLY_EAGLE,
  });
  assert(!d.ok && d.status === 409, "0-learner predecessor rejected");

  const retired = evaluateCapturePaymentFamily({
    family: {
      id: "fa-retired",
      schoolId: FLY_EAGLE,
      accountRef: "OLDREF2",
      familyName: "Merged",
      learnerCount: 1,
    },
    authorizedSchoolId: FLY_EAGLE,
    retiredSnapshot: true,
  });
  assert(!retired.ok && retired.status === 409, "retired snapshot rejected");
  console.log("✓ retired/merged predecessor rejected");
}

function testFlyEagleNameRefAllowed() {
  const d = evaluateCapturePaymentFamily({
    family: {
      id: "fa-fe-name",
      schoolId: FLY_EAGLE,
      accountRef: "ABAYE TUMO ASHANAFY",
      familyName: "Abaye",
      learnerCount: 1,
    },
    authorizedSchoolId: FLY_EAGLE,
  });
  assert(d.ok && d.family.id === "fa-fe-name", "Fly Eagle name ref FamilyAccount accepted");
  console.log("✓ Fly Eagle account without Kid-e-Sys code accepted by FamilyAccount.id");
}

function testDaSilvaKidESysStillWorks() {
  const d = evaluateCapturePaymentFamily({
    family: {
      id: "fa-sil007",
      schoolId: DA_SILVA,
      accountRef: "SIL007",
      familyName: "Silva",
      learnerCount: 3,
    },
    authorizedSchoolId: DA_SILVA,
  });
  assert(d.ok && d.family.accountRef === "SIL007", "Da Silva Kid-e-Sys FamilyAccount accepted");
  console.log("✓ Da Silva Kid-e-Sys FamilyAccount still accepted");
}

function testMbbWorks() {
  const d = evaluateCapturePaymentFamily({
    family: {
      id: "fa-mbb",
      schoolId: MBB,
      accountRef: "MBB012",
      familyName: "Bright",
      learnerCount: 1,
    },
    authorizedSchoolId: MBB,
  });
  assert(d.ok && d.family.accountRef === "MBB012", "MBB FamilyAccount accepted");
  console.log("✓ Magical Bright Beginnings FamilyAccount accepted");
}

function testSimilarNamesDoNotMatch() {
  const fly = evaluateCapturePaymentFamily({
    family: {
      id: "fa-smith-fe",
      schoolId: FLY_EAGLE,
      accountRef: "SMITH FAMILY",
      familyName: "Smith",
      learnerCount: 1,
    },
    authorizedSchoolId: DA_SILVA,
  });
  assert(!fly.ok, "same family name at another school is not a match");
  console.log("✓ similar names across schools cannot cause cross-school matching");
}

testUnknown();
testCrossSchoolFamilyId();
testRetiredPredecessor();
testFlyEagleNameRefAllowed();
testDaSilvaKidESysStillWorks();
testMbbWorks();
testSimilarNamesDoNotMatch();
console.log("\nAll resolveCapturePaymentFamilyAccount tests passed.");
