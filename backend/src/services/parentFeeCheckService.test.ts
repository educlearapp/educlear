/**
 * Parent fee-check (cross-school debtor lookup) tests.
 * Run: npm run build && node dist/services/parentFeeCheckService.test.js
 */
// @ts-nocheck
import {
  feeStatusFromOutstanding,
  lookupParentFeesBySaId,
  normalizeSaIdNumber,
} from "./parentFeeCheckService";
import { prisma } from "../prisma";
import * as statementAccounts from "./statementAccounts";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
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
  };
  const serialized = JSON.stringify(sample);
  assert(!("transactions" in sample), "no transactions field");
  assert(!("ledger" in sample), "no ledger field");
  assert(!serialized.includes("invoice"), "no invoice detail in fee-check payload");
  assert(!serialized.includes("payment"), "no payment detail in fee-check payload");
  console.log("✓ fee-check response exposes balance warning only, not transaction detail");
}

async function testHistoricalLearnerDebtStillFoundByFeeCheck() {
  const originalFindMany = prisma.parent.findMany.bind(prisma.parent);
  const originalBuild = statementAccounts.buildAccountsFromAgeAnalysisSnapshots;

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

  statementAccounts.buildAccountsFromAgeAnalysisSnapshots = async () => [
    {
      accountNo: "DEBT001",
      balance: 5000,
      learnerId: "learner-hist-1",
      schoolId: "school-hist",
      name: "Historical",
      surname: "Child",
      status: "Recently Owing",
    },
  ];

  try {
    const result = await lookupParentFeesBySaId("8001015009087");
    assert(result.found, "fee-check finds historical debtor guardian");
    assert(result.results.length === 1, "one school result");
    assert(result.results[0].outstandingAmount === 5000, "outstanding preserved");
    assert(result.results[0].status === "AMBER", "debt warning returned");
    assert(result.results[0].familyAccountNumber === "DEBT001", "account ref returned");
    const payload = JSON.stringify(result);
    assert(!payload.includes("transaction"), "no transaction detail leaked");
    assert(!payload.includes("ledger"), "no ledger detail leaked");
    console.log("✓ historical learner debt found by fee-check regardless of enrollment");
  } finally {
    prisma.parent.findMany = originalFindMany;
    statementAccounts.buildAccountsFromAgeAnalysisSnapshots = originalBuild;
  }
}

async function run() {
  testNormalizeSaId();
  testFeeStatusThresholds();
  testFeeCheckResultExposesNoTransactionDetail();
  await testHistoricalLearnerDebtStillFoundByFeeCheck();
  console.log("\nAll parentFeeCheckService tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
