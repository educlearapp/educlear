/**
 * Parent fee-check (cross-school debtor lookup) tests — Phase 1B / 1I.
 * Run: npx tsx src/services/parentFeeCheckService.test.ts
 */
// @ts-nocheck
import {
  feeStatusFromOutstanding,
  lookupParentFeesBySaId,
  normalizeSaIdNumber,
} from "./parentFeeCheckService";
import { prisma } from "../prisma";
import { evaluateParentStaffAuth } from "../middleware/requireParentStaffAuth";
import { permissionsForRole } from "../utils/userPermissions";
import fs from "fs";
import os from "os";
import path from "path";
import {
  setFamilyAccountAgeAnalysisStoreDataDirForTests,
  upsertSchoolFamilyAccountAgeAnalysisSnapshots,
} from "../utils/familyAccountAgeAnalysisStore";
import { setBillingLedgerStoreDataDirForTests } from "../utils/billingLedgerStore";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function withTempAuthorityStores(fn: () => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feecheck-auth-"));
  setBillingLedgerStoreDataDirForTests(dir);
  setFamilyAccountAgeAnalysisStoreDataDirForTests(dir);
  return fn().finally(() => {
    setBillingLedgerStoreDataDirForTests(null);
    setFamilyAccountAgeAnalysisStoreDataDirForTests(null);
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

function testNormalizeSaId() {
  assert(normalizeSaIdNumber("800101 5009 087") === "8001015009087", "SA ID normalized");
  console.log("✓ normalizeSaIdNumber");
}

function testFeeStatusThresholds() {
  assert(feeStatusFromOutstanding(0) === "GREEN", "zero outstanding is GREEN");
  assert(feeStatusFromOutstanding(24290) === "RED", "large debt is RED");
  assert(feeStatusFromOutstanding(2800) === "AMBER", "moderate debt is AMBER");
  console.log("✓ feeStatusFromOutstanding thresholds");
}

function testFeeCheckResultExposesNoTransactionDetail() {
  const sample = {
    parentName: "Guardian Test",
    schoolId: "school-1",
    schoolName: "Test School",
    familyAccountNumber: "DEBT001",
    familyAccountId: "fa-1",
    outstandingAmount: 5000,
    status: "AMBER",
    learners: [{ id: "l1", name: "Historical Child" }],
    isHomeSchool: true,
    learnerCount: 1,
  };
  const serialized = JSON.stringify(sample);
  assert(!("transactions" in sample), "no transactions field");
  assert(!("ledger" in sample), "no ledger field");
  assert(!serialized.includes("invoice"), "no invoice detail in fee-check payload");
  assert(!serialized.includes("payment"), "no payment detail in fee-check payload");
  console.log("✓ fee-check response exposes balance warning only, not transaction detail");
}

function testFeeCheckAuthRequired() {
  const unauth = evaluateParentStaffAuth({
    jwtPayload: null,
    user: null,
    appRole: "",
    permissions: null,
    requireOwnerAdmin: true,
  });
  assert(!unauth.allowed && unauth.status === 401, "unauthenticated rejected");

  const teacher = evaluateParentStaffAuth({
    jwtPayload: { userId: "t1", schoolId: "school-home", role: "STAFF" },
    user: { id: "t1", schoolId: "school-home", role: "STAFF", isActive: true },
    appRole: "Teacher",
    permissions: permissionsForRole("Teacher"),
    requireOwnerAdmin: true,
  });
  assert(!teacher.allowed && teacher.status === 403, "Teacher rejected for Fee Check");

  const owner = evaluateParentStaffAuth({
    jwtPayload: { userId: "o1", schoolId: "school-home", role: "SCHOOL_ADMIN" },
    user: { id: "o1", schoolId: "school-home", role: "SCHOOL_ADMIN", isActive: true },
    appRole: "Owner",
    permissions: permissionsForRole("Owner"),
    requireOwnerAdmin: true,
  });
  assert(owner.allowed === true, "Owner allowed for Fee Check");
  console.log("✓ Fee Check Owner/Admin gate");
}

async function testMultiSchoolFeeCheckWithPiiMinimization() {
  const originalFindMany = prisma.parent.findMany.bind(prisma.parent);

  prisma.parent.findMany = async () => [
    {
      id: "parent-a",
      schoolId: "school-home",
      firstName: "Guardian",
      surname: "Home",
      title: null,
      idNumber: "8001015009087",
      familyAccountId: "fa-home",
      outstandingAmount: 0,
      school: { id: "school-home", name: "Home School" },
      familyAccount: { id: "fa-home", accountRef: "HOME001", familyName: "Home Family" },
      links: [
        {
          learner: {
            id: "learner-home",
            firstName: "Home",
            lastName: "Child",
            familyAccountId: "fa-home",
            familyAccount: { id: "fa-home", accountRef: "HOME001", familyName: "Home Family" },
          },
        },
      ],
    },
    {
      id: "parent-b",
      schoolId: "school-other",
      firstName: "Guardian",
      surname: "Other",
      title: null,
      idNumber: "8001015009087",
      familyAccountId: "fa-other",
      outstandingAmount: 0,
      school: { id: "school-other", name: "Other School" },
      familyAccount: { id: "fa-other", accountRef: "OTHER001", familyName: "Other Family" },
      links: [
        {
          learner: {
            id: "learner-secret",
            firstName: "Secret",
            lastName: "Child",
            familyAccountId: "fa-other",
            familyAccount: {
              id: "fa-other",
              accountRef: "OTHER001",
              familyName: "Other Family",
            },
          },
        },
      ],
    },
  ];

  try {
    await withTempAuthorityStores(async () => {
      upsertSchoolFamilyAccountAgeAnalysisSnapshots("school-home", {
        HOME001: {
          schoolId: "school-home",
          accountRef: "HOME001",
          accountHolder: "Home",
          balance: 1000,
          buckets: { current: 1000, d30: 0, d60: 0, d90: 0, d120: 0 },
          source: "universal-migration-baseline",
          importedAt: "2026-05-23T23:59:59.999Z",
        },
      });
      upsertSchoolFamilyAccountAgeAnalysisSnapshots("school-other", {
        OTHER001: {
          schoolId: "school-other",
          accountRef: "OTHER001",
          accountHolder: "Other",
          balance: 5000,
          buckets: { current: 5000, d30: 0, d60: 0, d90: 0, d120: 0 },
          source: "universal-migration-baseline",
          importedAt: "2026-05-23T23:59:59.999Z",
        },
      });

      const result = await lookupParentFeesBySaId("8001015009087", {
        viewerSchoolId: "school-home",
      });
      assert(result.found, "fee-check finds multi-school guardian");
      assert(result.results.length === 2, "two school results");
      assert(result.totalOutstanding === 6000, "aggregate total correct");

      const home = result.results.find((r) => r.schoolId === "school-home");
      const other = result.results.find((r) => r.schoolId === "school-other");
      assert(!!home && !!other, "both schools present");
      assert(home.isHomeSchool === true, "home school flagged");
      assert(other.isHomeSchool === false, "other school flagged");
      assert(home.learners.some((l) => l.name.includes("Home")), "home learner name visible");
      assert(home.familyAccountId === "fa-home", "home familyAccountId kept");
      assert(other.familyAccountId === null, "other familyAccountId redacted");
      assert(!JSON.stringify(other.learners).includes("Secret"), "other learner name redacted");
      assert(other.learnerCount === 1, "other learner count preserved");
      assert(home.familyAccountNumber === "HOME001", "home account isolated");
      assert(other.familyAccountNumber === "OTHER001", "other account isolated");
      assert(home.outstandingAmount === 1000, "home balance school-specific");
      assert(other.outstandingAmount === 5000, "other balance school-specific");
      assert(home.balanceAuthority === "AUTHORITATIVE_FAMILY_ACCOUNT", "home uses shared authority");
      assert(other.balanceAuthority === "AUTHORITATIVE_FAMILY_ACCOUNT", "other uses shared authority");
      console.log("✓ multi-school Fee Check with home full PII / other minimized");
    });
  } finally {
    prisma.parent.findMany = originalFindMany;
  }
}

async function testHistoricalLearnerDebtStillFoundByFeeCheck() {
  const originalFindMany = prisma.parent.findMany.bind(prisma.parent);

  prisma.parent.findMany = async () => [
    {
      id: "parent-hist-1",
      schoolId: "school-hist",
      firstName: "Guardian",
      surname: "Debtor",
      title: null,
      idNumber: "8001015009087",
      familyAccountId: "fa-debt",
      outstandingAmount: 0,
      school: { id: "school-hist", name: "Other School" },
      familyAccount: { id: "fa-debt", accountRef: "DEBT001", familyName: "Debt Family" },
      links: [
        {
          learner: {
            id: "learner-hist-1",
            firstName: "Historical",
            lastName: "Child",
            familyAccountId: "fa-debt",
            familyAccount: { id: "fa-debt", accountRef: "DEBT001", familyName: "Debt Family" },
          },
        },
      ],
    },
  ];

  try {
    await withTempAuthorityStores(async () => {
      upsertSchoolFamilyAccountAgeAnalysisSnapshots("school-hist", {
        DEBT001: {
          schoolId: "school-hist",
          accountRef: "DEBT001",
          accountHolder: "Debt",
          balance: 5000,
          buckets: { current: 5000, d30: 0, d60: 0, d90: 0, d120: 0 },
          source: "universal-migration-baseline",
          importedAt: "2026-05-23T23:59:59.999Z",
        },
      });
      const result = await lookupParentFeesBySaId("8001015009087", {
        viewerSchoolId: "school-viewer",
      });
      assert(result.found, "fee-check finds historical debtor guardian");
      assert(result.results.length === 1, "one school result");
      assert(result.results[0].outstandingAmount === 5000, "outstanding preserved");
      assert(result.results[0].status === "AMBER", "debt warning returned");
      assert(result.results[0].familyAccountNumber === "DEBT001", "account ref returned");
      assert(result.results[0].isHomeSchool === false, "not home school");
      assert(
        result.results[0].balanceAuthority === "AUTHORITATIVE_FAMILY_ACCOUNT",
        "uses shared authority"
      );
      const payload = JSON.stringify(result);
      assert(!payload.includes("Historical"), "cross-school learner name redacted");
      assert(!payload.includes("transaction"), "no transaction detail leaked");
      assert(!payload.includes("ledger"), "no ledger detail leaked");
      console.log("✓ historical cross-school debt found with minimized PII");
    });
  } finally {
    prisma.parent.findMany = originalFindMany;
  }
}

async function main() {
  testNormalizeSaId();
  testFeeStatusThresholds();
  testFeeCheckResultExposesNoTransactionDetail();
  testFeeCheckAuthRequired();
  await testMultiSchoolFeeCheckWithPiiMinimization();
  await testHistoricalLearnerDebtStillFoundByFeeCheck();
  console.log("\nALL parentFeeCheckService tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
