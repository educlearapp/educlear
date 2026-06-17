/**
 * Manual invoice duplicate fingerprint rules (sibling-safe).
 * Run: npx tsx src/utils/billingLedgerStore.invoiceDuplicate.test.ts
 */
import { invoiceDuplicateFingerprint } from "./billingLedgerStore";

const SCHOOL = "school-test";
const ACCOUNT = "SIL001";
const DATE = "2026-06-17";
const DUE = "2026-06-30";
const DESC = "Monthly tuition";
const AMOUNT = 2500;

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function fp(input: {
  learnerId?: string;
  lineKey?: string;
  description?: string;
  invoiceDate?: string;
  dueDate?: string;
  amount?: number;
  invoicePeriod?: string;
  runId?: string;
}) {
  return invoiceDuplicateFingerprint(SCHOOL, {
    accountNo: ACCOUNT,
    description: DESC,
    invoiceDate: DATE,
    dueDate: DUE,
    amount: AMOUNT,
    ...input,
  });
}

function testSameLearnerSameFeeBlocked() {
  const a = fp({ learnerId: "learner-a" });
  const b = fp({ learnerId: "learner-a" });
  assert(a === b, "same fee twice for same learner = blocked");
  console.log("✓ same fee twice for same learner = blocked");
}

function testSiblingFeesAllowed() {
  const siblingA = fp({ learnerId: "learner-a" });
  const siblingB = fp({ learnerId: "learner-b" });
  assert(siblingA !== siblingB, "same fee for sibling A and sibling B = allowed");
  console.log("✓ same fee for sibling A and sibling B = allowed");
}

function testDifferentLearnerIdAllowed() {
  const one = fp({ learnerId: "learner-x" });
  const two = fp({ learnerId: "learner-y" });
  assert(one !== two, "same fee on same account with different learnerId = allowed");
  console.log("✓ same fee on same account with different learnerId = allowed");
}

function testExactDuplicateSameLearnerSameDateBlocked() {
  const first = fp({ learnerId: "learner-a", invoiceDate: DATE });
  const second = fp({ learnerId: "learner-a", invoiceDate: DATE });
  assert(first === second, "exact duplicate same learner/same fee/same date = blocked");
  console.log("✓ exact duplicate same learner/same fee/same date = blocked");
}

function testAccountLevelDifferentLineKeyAllowed() {
  const lineA = fp({ lineKey: "child-a" });
  const lineB = fp({ lineKey: "child-b" });
  assert(lineA !== lineB, "account-level line with different lineKey = allowed");
  console.log("✓ account-level line with different lineKey/childKey = allowed");
}

function testDifferentInvoiceDateAllowed() {
  const june = fp({ learnerId: "learner-a", invoiceDate: "2026-06-17" });
  const july = fp({ learnerId: "learner-a", invoiceDate: "2026-07-17" });
  assert(june !== july, "same learner/fee on different invoice dates = allowed");
  console.log("✓ same learner/fee on different invoice dates = allowed");
}

function main() {
  testSameLearnerSameFeeBlocked();
  testSiblingFeesAllowed();
  testDifferentLearnerIdAllowed();
  testExactDuplicateSameLearnerSameDateBlocked();
  testAccountLevelDifferentLineKeyAllowed();
  testDifferentInvoiceDateAllowed();
  console.log("\nAll invoice duplicate fingerprint tests passed.");
}

main();
