/**
 * Lost-response retry: same idempotency key after an interrupted response never creates a
 * second payment or second allocation set. Isolated JSON stores; local DB used read-only
 * (FamilyAccount lifecycle lookup).
 * Run: npx tsx src/services/capturePayment.attemptRetry.test.ts
 */
import fs from "fs";
import os from "os";
import path from "path";

import { captureManualPayment, setCapturePaymentFamilyResolverForTests } from "./capturePaymentService";
import { lookupPaymentAttemptStatus } from "./paymentAttemptStatus";
import { evaluateCapturePaymentFamily } from "./resolveCapturePaymentFamilyAccount";
import {
  listPayments,
  setBillingLedgerStoreDataDirForTests,
  writeSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import { setFamilyAccountAgeAnalysisStoreDataDirForTests } from "../utils/familyAccountAgeAnalysisStore";
import {
  listPaymentAllocations,
  setPaymentAllocationStoreDataDirForTests,
} from "../utils/paymentAllocationStore";

const FLY_EAGLE = "school-test-fly-eagle-retry";
const DA_SILVA = "school-test-da-silva-retry";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const families = new Map([
  [
    "fa-len",
    {
      id: "fa-len",
      schoolId: FLY_EAGLE,
      accountRef: "LENTSWE OMAATLA OTENG",
      familyName: "Oteng",
      learnerCount: 1,
    },
  ],
  [
    "fa-sil",
    {
      id: "fa-sil",
      schoolId: DA_SILVA,
      accountRef: "SIL007",
      familyName: "Silva",
      learnerCount: 2,
    },
  ],
]);

async function fakeResolve(input: { familyAccountId: string; authorizedSchoolId: string }) {
  return evaluateCapturePaymentFamily({
    family: families.get(input.familyAccountId) || null,
    authorizedSchoolId: input.authorizedSchoolId,
  });
}

function invoice(schoolId: string, accountNo: string, amount: number, id: string): BillingLedgerEntry {
  return {
    id,
    schoolId,
    learnerId: "",
    accountNo,
    type: "invoice",
    amount,
    date: "2026-10-01",
    reference: `INV-${id}`,
    description: "Tuition",
    source: "manual",
    createdAt: "2026-10-01T08:00:00.000Z",
  };
}

async function withIsolatedStores(fn: () => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capture-retry-"));
  for (const name of ["billing-ledger.json", "payment-allocations.json", "family-account-age-analysis.json"]) {
    fs.writeFileSync(path.join(dir, name), "{}", "utf8");
  }
  setBillingLedgerStoreDataDirForTests(dir);
  setPaymentAllocationStoreDataDirForTests(dir);
  setFamilyAccountAgeAnalysisStoreDataDirForTests(dir);
  setCapturePaymentFamilyResolverForTests(fakeResolve);
  try {
    await fn();
  } finally {
    setCapturePaymentFamilyResolverForTests(null);
    setBillingLedgerStoreDataDirForTests(null);
    setPaymentAllocationStoreDataDirForTests(null);
    setFamilyAccountAgeAnalysisStoreDataDirForTests(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function capture(schoolId: string, familyAccountId: string, key: string, invoiceId: string) {
  return captureManualPayment({
    authorizedSchoolId: schoolId,
    familyAccountId,
    amount: 1400,
    date: "2026-10-06",
    method: "Bank Transfer",
    description: "Payment",
    idempotencyKey: key,
    capturedByUserId: "user-1",
    capturedByEmail: "staff@school.test",
    capturedByName: "Staff",
    allocationLines: [{ invoiceId, allocatedAmount: 1400 }],
  });
}

async function testLostResponseRetryFlyEagle() {
  await withIsolatedStores(async () => {
    writeSchoolLedger(FLY_EAGLE, [invoice(FLY_EAGLE, "LENTSWE OMAATLA OTENG", 2800, "inv-len")]);
    const key = "6d3b8f0e-4b2a-4c1e-9f7a-2e5c8b1d0a11";

    const first = await capture(FLY_EAGLE, "fa-len", key, "inv-len");
    // Response lost in transit here — browser only sees "Failed to fetch".

    const status = lookupPaymentAttemptStatus({ authorizedSchoolId: FLY_EAGLE, idempotencyKey: key });
    assert(status.ok && status.body.found === true, "status endpoint confirms the saved attempt");
    if (status.ok && status.body.found) {
      assert(status.body.payment.id === first.payment.id, "status returns the original payment id");
      assert(status.body.allocationSaved === true, "status reports allocation saved");
    }

    const retry = await capture(FLY_EAGLE, "fa-len", key, "inv-len");
    assert(first.duplicate === false && retry.duplicate === true, "retry with same key is a replay");
    assert(retry.payment.id === first.payment.id, "same payment id");
    assert(retry.payment.reference === first.payment.reference, "same receipt number");
    assert(listPayments(FLY_EAGLE).length === 1, "exactly one payment on the ledger");
    const allocs = listPaymentAllocations(FLY_EAGLE, String(first.payment.id));
    assert(allocs.length === 1, `allocation rows not duplicated (got ${allocs.length})`);
    assert(
      String(first.payment.accountNo) === "LENTSWE OMAATLA OTENG",
      "Fly Eagle name-based accountRef preserved on the ledger"
    );
    assert(retry.balance === 1400, "balance reflects a single R1,400 payment");
  });
  console.log("✓ Fly Eagle lost response → status found → same-key retry = one payment, one allocation set");
}

async function testLostResponseRetryDaSilva() {
  await withIsolatedStores(async () => {
    writeSchoolLedger(DA_SILVA, [invoice(DA_SILVA, "SIL007", 1400, "inv-sil")]);
    const key = "9a7c2d1e-0b3f-4e6a-8c5d-1f2e3a4b5c66";
    const first = await capture(DA_SILVA, "fa-sil", key, "inv-sil");
    const retry = await capture(DA_SILVA, "fa-sil", key, "inv-sil");
    assert(retry.duplicate === true && retry.payment.id === first.payment.id, "Da Silva replay");
    assert(listPayments(DA_SILVA).length === 1, "Da Silva one payment");
    assert(listPaymentAllocations(DA_SILVA, String(first.payment.id)).length === 1, "Da Silva one allocation set");
    assert(String(first.payment.accountNo).toUpperCase() === "SIL007", "Kid-e-Sys code preserved");
    const crossSchool = lookupPaymentAttemptStatus({ authorizedSchoolId: FLY_EAGLE, idempotencyKey: key });
    assert(crossSchool.ok && crossSchool.body.found === false, "Fly Eagle cannot see Da Silva attempt");
  });
  console.log("✓ Da Silva Kid-e-Sys code → same-key retry = one payment; isolated from Fly Eagle");
}

async function testNotFoundThenSameKeySaveOnce() {
  await withIsolatedStores(async () => {
    writeSchoolLedger(FLY_EAGLE, [invoice(FLY_EAGLE, "LENTSWE OMAATLA OTENG", 1400, "inv-nf")]);
    const key = "nf-0000-key";
    const before = lookupPaymentAttemptStatus({ authorizedSchoolId: FLY_EAGLE, idempotencyKey: key });
    assert(before.ok && before.body.found === false, "request never reached server → not found");
    const saved = await capture(FLY_EAGLE, "fa-len", key, "inv-nf");
    assert(saved.duplicate === false, "save with the same key creates it once");
    const after = lookupPaymentAttemptStatus({ authorizedSchoolId: FLY_EAGLE, idempotencyKey: key });
    assert(after.ok && after.body.found === true, "now found");
    assert(listPayments(FLY_EAGLE).length === 1, "one payment");
  });
  console.log("✓ not found → Save again with same key → exactly one payment");
}

async function testEarlyNotFoundThenConcurrentOriginalAndRetry() {
  await withIsolatedStores(async () => {
    writeSchoolLedger(FLY_EAGLE, [invoice(FLY_EAGLE, "LENTSWE OMAATLA OTENG", 2800, "inv-race")]);
    const key = "race-0000-original-still-running";
    const early = lookupPaymentAttemptStatus({ authorizedSchoolId: FLY_EAGLE, idempotencyKey: key });
    assert(early.ok && early.body.found === false, "reopen check runs before the original write → not found");
    const [original, retry] = await Promise.all([
      capture(FLY_EAGLE, "fa-len", key, "inv-race"),
      capture(FLY_EAGLE, "fa-len", key, "inv-race"),
    ]);
    assert([original, retry].filter((r) => !r.duplicate).length === 1, "exactly one creating write");
    assert(original.payment.id === retry.payment.id, "both resolve to the same payment");
    assert(listPayments(FLY_EAGLE).length === 1, "one ledger payment");
    assert(listPaymentAllocations(FLY_EAGLE, String(original.payment.id)).length === 1, "one allocation set");
    const later = lookupPaymentAttemptStatus({ authorizedSchoolId: FLY_EAGLE, idempotencyKey: key });
    assert(later.ok && later.body.found === true, "subsequent status check finds it");
  });
  console.log("✓ early found:false → original + same-key retry race = one payment, one allocation set");
}

async function testPostWriteAllocationErrorIsNot4xx() {
  await withIsolatedStores(async () => {
    writeSchoolLedger(FLY_EAGLE, [invoice(FLY_EAGLE, "LENTSWE OMAATLA OTENG", 2800, "inv-over")]);
    const result = await captureManualPayment({
      authorizedSchoolId: FLY_EAGLE,
      familyAccountId: "fa-len",
      amount: 100,
      date: "2026-10-06",
      method: "EFT",
      description: "Payment",
      idempotencyKey: "post-write-alloc-error",
      capturedByUserId: "user-1",
      capturedByEmail: "staff@school.test",
      capturedByName: "Staff",
      allocationLines: [{ invoiceId: "inv-over", allocatedAmount: 999 }],
    });
    assert(result.success === true, "post-write ALLOCATION_EXCEEDS_PAYMENT does not throw (route returns 207, not 4xx)");
    assert(result.allocationSaved === false, "allocation failure reported in body");
    assert(listPayments(FLY_EAGLE).length === 1, "payment was written");
  });
  console.log("✓ the only post-append CapturePaymentError (allocation 400) is swallowed → 207, never a 4xx");
}

async function main() {
  await testLostResponseRetryFlyEagle();
  await testLostResponseRetryDaSilva();
  await testNotFoundThenSameKeySaveOnce();
  await testEarlyNotFoundThenConcurrentOriginalAndRetry();
  await testPostWriteAllocationErrorIsNot4xx();
  console.log("\nAll capturePayment.attemptRetry tests passed.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
