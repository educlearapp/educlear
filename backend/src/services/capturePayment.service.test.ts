/**
 * Capture Payment service tests — isolated ledger only (no production writes).
 * Run: npx tsx src/services/capturePayment.service.test.ts
 */
import fs from "fs";
import os from "os";
import path from "path";

import {
  captureManualPayment,
  CapturePaymentError,
  setCapturePaymentFamilyResolverForTests,
} from "./capturePaymentService";
import { evaluateCapturePaymentFamily } from "./resolveCapturePaymentFamilyAccount";
import {
  listPayments,
  readSchoolLedger,
  setBillingLedgerStoreDataDirForTests,
  writeSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import { setFamilyAccountAgeAnalysisStoreDataDirForTests } from "../utils/familyAccountAgeAnalysisStore";
import {
  listPaymentAllocations,
  setPaymentAllocationStoreDataDirForTests,
} from "../utils/paymentAllocationStore";

const FLY_EAGLE = "school-test-fly-eagle-capture";
const DA_SILVA = "school-test-da-silva-capture";
const MBB = "school-test-mbb-capture";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function invoice(
  schoolId: string,
  accountNo: string,
  amount: number,
  id: string
): BillingLedgerEntry {
  return {
    id,
    schoolId,
    learnerId: "",
    accountNo,
    type: "invoice",
    amount,
    date: "2026-01-15",
    reference: `INV-${id}`,
    description: "Tuition",
    source: "manual",
    createdAt: "2026-01-15T08:00:00.000Z",
  };
}

const families = new Map([
  [
    "fa-fe",
    {
      id: "fa-fe",
      schoolId: FLY_EAGLE,
      accountRef: "ABAYE TUMO ASHANAFY",
      familyName: "Abaye",
      learnerCount: 1,
    },
  ],
  [
    "fa-dsa",
    {
      id: "fa-dsa",
      schoolId: DA_SILVA,
      accountRef: "SIL007",
      familyName: "Silva",
      learnerCount: 2,
    },
  ],
  [
    "fa-mbb",
    {
      id: "fa-mbb",
      schoolId: MBB,
      accountRef: "MBB012",
      familyName: "Bright",
      learnerCount: 1,
    },
  ],
  [
    "fa-empty",
    {
      id: "fa-empty",
      schoolId: FLY_EAGLE,
      accountRef: "RETIRED",
      familyName: "Gone",
      learnerCount: 0,
    },
  ],
]);

async function fakeResolve(input: { familyAccountId: string; authorizedSchoolId: string }) {
  const family = families.get(input.familyAccountId) || null;
  return evaluateCapturePaymentFamily({
    family,
    authorizedSchoolId: input.authorizedSchoolId,
  });
}

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "capture-pay-"));
  fs.writeFileSync(path.join(dir, "billing-ledger.json"), "{}", "utf8");
  fs.writeFileSync(path.join(dir, "payment-allocations.json"), "{}", "utf8");
  fs.writeFileSync(path.join(dir, "family-account-age-analysis.json"), "{}", "utf8");
  return dir;
}

async function withIsolatedStores(fn: () => Promise<void>) {
  const dir = makeTempDir();
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

function baseCapture(overrides: Record<string, unknown> = {}) {
  return {
    authorizedSchoolId: FLY_EAGLE,
    familyAccountId: "fa-fe",
    amount: 100,
    date: "2026-08-30",
    method: "EFT",
    description: "School fees",
    bankReference: "BANK-REF-1",
    idempotencyKey: `key-${Math.random().toString(36).slice(2, 10)}`,
    capturedByUserId: "user-finance-1",
    capturedByEmail: "finance@flyeagle.test",
    capturedByName: "Finance Officer",
    ...overrides,
  };
}

async function testNormalPayment() {
  await withIsolatedStores(async () => {
    writeSchoolLedger(FLY_EAGLE, [invoice(FLY_EAGLE, "ABAYE TUMO ASHANAFY", 1000, "inv-1")]);
    const result = await captureManualPayment(baseCapture({ amount: 1000, idempotencyKey: "k-normal" }));
    assert(result.success && result.payment.amount === 1000, "normal payment saved");
    assert(result.balance === 0, "exact invoice payment clears balance");
    assert(result.familyAccountId === "fa-fe", "FamilyAccount.id on response");
    assert(result.payment.familyAccountId === "fa-fe", "FamilyAccount.id on payment");
    assert(String(result.payment.accountNo).toUpperCase() === "ABAYE TUMO ASHANAFY", "ledger uses accountRef");
    assert(listPayments(FLY_EAGLE).length === 1, "one payment on school ledger");
  });
  console.log("✓ 1 normal payment / Fly Eagle without Kid-e-Sys code");
}

async function testPartialAndMultiInvoice() {
  await withIsolatedStores(async () => {
    writeSchoolLedger(FLY_EAGLE, [
      invoice(FLY_EAGLE, "ABAYE TUMO ASHANAFY", 400, "inv-a"),
      invoice(FLY_EAGLE, "ABAYE TUMO ASHANAFY", 600, "inv-b"),
    ]);
    const partial = await captureManualPayment(
      baseCapture({ amount: 250, idempotencyKey: "k-partial" })
    );
    assert(partial.balance === 750, "partial payment leaves remainder");

    const multi = await captureManualPayment(
      baseCapture({
        amount: 750,
        idempotencyKey: "k-multi",
        allocationLines: [
          { invoiceId: "inv-a", allocatedAmount: 150 },
          { invoiceId: "inv-b", allocatedAmount: 600 },
        ],
      })
    );
    assert(multi.balance === 0, "multi-invoice payment clears remaining");
    assert(multi.allocationSaved === true, "allocation written in same request");
    const allocs = listPaymentAllocations(FLY_EAGLE, String(multi.payment.id));
    assert(allocs.length === 2, "two allocation rows stored");
  });
  console.log("✓ 2/3 partial + multi-invoice payment");
}

async function testOverpaymentAndCredit() {
  await withIsolatedStores(async () => {
    writeSchoolLedger(FLY_EAGLE, [invoice(FLY_EAGLE, "ABAYE TUMO ASHANAFY", 1000, "inv-over")]);
    const over = await captureManualPayment(
      baseCapture({ amount: 1234.56, idempotencyKey: "k-over" })
    );
    assert(over.balance === round2(1000 - 1234.56), "overpayment produces credit");
    assert(over.balance < 0, "credit remains negative");

    const again = await captureManualPayment(
      baseCapture({ amount: 50, idempotencyKey: "k-credit-more" })
    );
    assert(again.balance === round2(over.balance - 50), "existing credit is not converted to R0");
    assert(again.balance < 0, "credit still negative after further payment");
  });
  console.log("✓ 4/5/18 overpayment + existing credit remain negative");
}

async function testExactCents() {
  await withIsolatedStores(async () => {
    writeSchoolLedger(FLY_EAGLE, [invoice(FLY_EAGLE, "ABAYE TUMO ASHANAFY", 10.01, "inv-cents")]);
    const result = await captureManualPayment(
      baseCapture({ amount: 0.01, idempotencyKey: "k-cents" })
    );
    assert(result.payment.amount === 0.01, "R0.01 stored exactly");
    assert(result.balance === 10, "authoritative balance after cent payment");
  });
  console.log("✓ 6 exact cents");
}

async function testAmountRejects() {
  await withIsolatedStores(async () => {
    for (const [amount, code] of [
      [0, "AMOUNT_ZERO"],
      [-5, "AMOUNT_NEGATIVE"],
      ["nope", "AMOUNT_MALFORMED"],
    ] as const) {
      try {
        await captureManualPayment(baseCapture({ amount, idempotencyKey: `bad-${code}` }));
        throw new Error(`expected reject for ${String(amount)}`);
      } catch (error) {
        assert(error instanceof CapturePaymentError, "CapturePaymentError");
        assert(error.code === code, `code ${code}`);
      }
    }
    assert(listPayments(FLY_EAGLE).length === 0, "rejected amounts do not write");
  });
  console.log("✓ 7/8/9 zero / negative / malformed rejected with no write");
}

async function testWrongSchoolAndMissing() {
  await withIsolatedStores(async () => {
    try {
      await captureManualPayment(
        baseCapture({
          authorizedSchoolId: FLY_EAGLE,
          familyAccountId: "fa-dsa",
          idempotencyKey: "k-xschool",
        })
      );
      throw new Error("expected cross-school reject");
    } catch (error) {
      assert(error instanceof CapturePaymentError && error.status === 403, "wrong-school FA rejected");
    }
    try {
      await captureManualPayment(
        baseCapture({ familyAccountId: "does-not-exist", idempotencyKey: "k-missing" })
      );
      throw new Error("expected missing reject");
    } catch (error) {
      assert(error instanceof CapturePaymentError && error.status === 404, "nonexistent FA rejected");
    }
    try {
      await captureManualPayment(
        baseCapture({ familyAccountId: "fa-empty", idempotencyKey: "k-retired" })
      );
      throw new Error("expected retired reject");
    } catch (error) {
      assert(error instanceof CapturePaymentError && error.status === 409, "retired predecessor rejected");
    }
    assert(listPayments(FLY_EAGLE).length === 0, "no write on rejected destinations");
    assert(listPayments(DA_SILVA).length === 0, "Da Silva ledger untouched");
  });
  console.log("✓ 12/13/14 wrong-school / nonexistent / retired rejected");
}

async function testIdempotencyAndTwoLegitimate() {
  await withIsolatedStores(async () => {
    writeSchoolLedger(FLY_EAGLE, [invoice(FLY_EAGLE, "ABAYE TUMO ASHANAFY", 20000, "inv-big")]);
    const first = await captureManualPayment(
      baseCapture({ amount: 5000, idempotencyKey: "same-submit" })
    );
    const retry = await captureManualPayment(
      baseCapture({ amount: 5000, idempotencyKey: "same-submit" })
    );
    assert(first.duplicate === false, "first write is new");
    assert(retry.duplicate === true, "same key returns original");
    assert(retry.payment.id === first.payment.id, "same ledger id");
    assert(listPayments(FLY_EAGLE).length === 1, "duplicate submission = one payment");

    const second = await captureManualPayment(
      baseCapture({ amount: 5000, idempotencyKey: "other-submit" })
    );
    assert(second.duplicate === false, "new key is a new payment");
    assert(second.payment.id !== first.payment.id, "distinct ledger ids");
    assert(listPayments(FLY_EAGLE).length === 2, "two legitimate R5,000 payments allowed");
    assert(second.balance === round2(20000 - 10000), "both genuine payments applied");
  });
  console.log("✓ 15/16 idempotency vs two legitimate identical-value payments");
}

async function testAuditAndSchoolIsolation() {
  await withIsolatedStores(async () => {
    writeSchoolLedger(FLY_EAGLE, [invoice(FLY_EAGLE, "ABAYE TUMO ASHANAFY", 100, "inv-fe")]);
    writeSchoolLedger(DA_SILVA, [invoice(DA_SILVA, "SIL007", 100, "inv-dsa")]);
    const fe = await captureManualPayment(
      baseCapture({ amount: 10, idempotencyKey: "k-audit-fe" })
    );
    const dsa = await captureManualPayment({
      ...baseCapture({
        authorizedSchoolId: DA_SILVA,
        familyAccountId: "fa-dsa",
        amount: 10,
        idempotencyKey: "k-audit-dsa",
      }),
    });
    assert(fe.payment.capturedByUserId === "user-finance-1", "capturing user id");
    assert(fe.payment.capturedByEmail === "finance@flyeagle.test", "capturing email");
    assert(fe.payment.capturedByName === "Finance Officer", "capturing name");
    assert(fe.payment.idempotencyKey === "k-audit-fe", "idempotency on ledger");
    assert(fe.payment.schoolId === FLY_EAGLE, "school id on payment");
    assert(Boolean(fe.payment.id), "ledger entry id");
    assert(fe.payment.bankReference === "BANK-REF-1", "operator reference preserved");
    assert(listPayments(FLY_EAGLE).every((p) => p.schoolId === FLY_EAGLE), "Fly Eagle ledger only FE");
    assert(listPayments(DA_SILVA).every((p) => p.schoolId === DA_SILVA), "Da Silva ledger only DSA");
    assert(dsa.payment.accountNo === "SIL007" || dsa.payment.accountNo === "sil007" || String(dsa.payment.accountNo).toUpperCase() === "SIL007", "Da Silva account code preserved on ledger");
  });
  console.log("✓ 19/20/22 capturing-user metadata + school ledger isolation + Da Silva code");
}

async function testMbbAndConcurrency() {
  await withIsolatedStores(async () => {
    writeSchoolLedger(MBB, [invoice(MBB, "MBB012", 80, "inv-mbb")]);
    const mbb = await captureManualPayment({
      ...baseCapture({
        authorizedSchoolId: MBB,
        familyAccountId: "fa-mbb",
        amount: 80,
        idempotencyKey: "k-mbb",
      }),
    });
    assert(mbb.balance === 0, "MBB exact payment");
    assert(String(mbb.payment.accountNo).toUpperCase() === "MBB012", "MBB accountRef on ledger");

    const [a, b] = await Promise.all([
      captureManualPayment(baseCapture({ amount: 5, idempotencyKey: "k-race" })),
      captureManualPayment(baseCapture({ amount: 5, idempotencyKey: "k-race" })),
    ]);
    const created = [a, b].filter((r) => !r.duplicate);
    assert(created.length === 1, "concurrent same key = one financial write");
    assert(listPayments(FLY_EAGLE).length === 1, "Fly Eagle race writes once");
  });
  console.log("✓ 23 Magical Bright Beginnings + concurrent duplicate key");
}

async function testMissingIdempotency() {
  await withIsolatedStores(async () => {
    try {
      await captureManualPayment(baseCapture({ idempotencyKey: "" }));
      throw new Error("expected missing key reject");
    } catch (error) {
      assert(error instanceof CapturePaymentError && error.code === "MISSING_IDEMPOTENCY_KEY", "key required");
    }
  });
  console.log("✓ missing idempotencyKey rejected");
}

async function main() {
  await testNormalPayment();
  await testPartialAndMultiInvoice();
  await testOverpaymentAndCredit();
  await testExactCents();
  await testAmountRejects();
  await testWrongSchoolAndMissing();
  await testIdempotencyAndTwoLegitimate();
  await testAuditAndSchoolIsolation();
  await testMbbAndConcurrency();
  await testMissingIdempotency();
  console.log("\nAll capturePayment.service tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
