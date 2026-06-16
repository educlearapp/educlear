/**
 * resolvePaymentLearnerId stale-account guard tests.
 * Run: npx tsx src/billing/resolvePaymentLearnerId.test.ts
 */
import {
  learnerMatchesBillingAccountRef,
  resolvePaymentLearnerId,
} from "./paymentLearnerResolver";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const learners = [
  {
    id: "learner-a",
    firstName: "Alpha",
    surname: "One",
    familyAccount: { accountRef: "TST001" },
  },
  {
    id: "learner-b",
    firstName: "Beta",
    surname: "Two",
    familyAccount: { accountRef: "TST002" },
  },
];

function testCandidateAcceptedWhenAccountMatches() {
  const id = resolvePaymentLearnerId(
    {
      id: "learner-a",
      learnerId: "learner-a",
      accountNo: "TST001",
      name: "Alpha",
      surname: "One",
      balance: 0,
    },
    learners,
    "TST001"
  );
  assert(id === "learner-a", "candidate accepted when learner belongs to account");
  console.log("✓ candidate accepted for matching account");
}

function testStaleCandidateIgnoredForDifferentAccount() {
  const id = resolvePaymentLearnerId(
    {
      id: "learner-a",
      learnerId: "learner-a",
      accountNo: "TST002",
      name: "Beta",
      surname: "Two",
      balance: 0,
    },
    learners,
    "TST002"
  );
  assert(id === "learner-b", "stale learner-a ignored; resolves learner-b from TST002");
  console.log("✓ stale candidate ignored for different account");
}

function testResolveFromAccountWhenNoCandidate() {
  const id = resolvePaymentLearnerId(
    {
      id: "",
      learnerId: "",
      accountNo: "TST002",
      name: "-",
      surname: "-",
      balance: 0,
    },
    learners,
    "TST002"
  );
  assert(id === "learner-b", "resolves from accountNo when no candidate");
  console.log("✓ resolves from accountNo");
}

function testLearnerMatchesBillingAccountRef() {
  assert(
    learnerMatchesBillingAccountRef(learners[0], "TST001"),
    "learner a matches TST001"
  );
  assert(
    !learnerMatchesBillingAccountRef(learners[0], "TST002"),
    "learner a does not match TST002"
  );
  console.log("✓ learnerMatchesBillingAccountRef");
}

function main() {
  testCandidateAcceptedWhenAccountMatches();
  testStaleCandidateIgnoredForDifferentAccount();
  testResolveFromAccountWhenNoCandidate();
  testLearnerMatchesBillingAccountRef();
  console.log("\nAll resolvePaymentLearnerId tests passed.");
}

main();
