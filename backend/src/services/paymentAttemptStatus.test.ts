/**
 * Read-only Capture Payment attempt status — isolated stores only (no DB, no production data).
 * Run: npx tsx src/services/paymentAttemptStatus.test.ts
 */
import fs from "fs";
import os from "os";
import path from "path";

import { lookupPaymentAttemptStatus } from "./paymentAttemptStatus";
import { DA_SILVA_ACADEMY_SCHOOL_ID } from "./activateDaSilvaSubscription";
import { registerDaSilvaSchoolId } from "./daSilvaSchoolResolve";
import {
  appendSchoolEntrySafe,
  findSchoolPaymentByIdempotencyKey,
  paymentEntryIdForIdempotencyKey,
  setBillingLedgerStoreDataDirForTests,
  writeSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import {
  setPaymentAllocationStoreDataDirForTests,
  writePaymentAllocations,
} from "../utils/paymentAllocationStore";

const FLY_EAGLE = "cmt1e8bjp0jo8lcjeketlynhl";
const MBB = "cmq4xjckq00at60gqg4eb956h";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function makeTempDir(withFiles = true): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pay-attempt-"));
  if (withFiles) {
    fs.writeFileSync(path.join(dir, "billing-ledger.json"), "{}", "utf8");
    fs.writeFileSync(path.join(dir, "payment-allocations.json"), "{}", "utf8");
  }
  return dir;
}

function withStores(fn: (dir: string) => void, withFiles = true) {
  const dir = makeTempDir(withFiles);
  setBillingLedgerStoreDataDirForTests(dir);
  setPaymentAllocationStoreDataDirForTests(dir);
  try {
    fn(dir);
  } finally {
    setBillingLedgerStoreDataDirForTests(null);
    setPaymentAllocationStoreDataDirForTests(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function capturedPayment(schoolId: string, key: string, overrides: Partial<BillingLedgerEntry> = {}) {
  return {
    id: "",
    schoolId,
    learnerId: "",
    accountNo: "LENTSWE OMAATLA OTENG",
    type: "payment" as const,
    amount: 1400,
    date: "2026-10-06",
    reference: "",
    description: "Payment private note",
    method: "Bank Transfer",
    source: "manual",
    createdAt: "2026-10-07T05:41:42.206Z",
    familyAccountId: "cmt7tn8nj007silmlb7vyaqs4",
    idempotencyKey: key,
    capturedByUserId: "user-1",
    capturedByEmail: "staff@flyeagle.test",
    capturedByName: "Staff Member",
    bankReference: "BANK-REF-SECRET",
    ...overrides,
  };
}

function appendLikeCapture(schoolId: string, key: string) {
  return appendSchoolEntrySafe(schoolId, capturedPayment(schoolId, key), {
    idempotencyKey: key,
    generatePaymentReference: true,
    skipPaymentFingerprint: true,
  });
}

function snapshot(dir: string) {
  return fs
    .readdirSync(dir)
    .sort()
    .map((name) => {
      const file = path.join(dir, name);
      const stat = fs.statSync(file);
      return `${name}:${stat.size}:${stat.mtimeMs}:${fs.readFileSync(file, "utf8")}`;
    })
    .join("\n");
}

function testFoundByStableIdMatchesAppend() {
  withStores(() => {
    const key = "3f1c9a52-7e0b-4f7e-9d4b-2a6c1e5b8f00";
    const appended = appendLikeCapture(FLY_EAGLE, key);
    assert(appended.created, "fixture appended");
    assert(
      appended.entry.id === paymentEntryIdForIdempotencyKey(key),
      "stable id helper matches appendSchoolEntrySafe"
    );
    const longKey = `k${"a".repeat(110)}`;
    const longAppend = appendLikeCapture(FLY_EAGLE, longKey);
    assert(
      longAppend.entry.id === paymentEntryIdForIdempotencyKey(longKey),
      "stable id helper matches append for keys longer than 80 chars"
    );

    const decision = lookupPaymentAttemptStatus({ authorizedSchoolId: FLY_EAGLE, idempotencyKey: key });
    assert(decision.ok && decision.body.found === true, "saved attempt is found");
    if (decision.ok && decision.body.found) {
      assert(decision.body.payment.id === appended.entry.id, "returns saved payment id");
      assert(decision.body.payment.reference.startsWith("PAY-"), "returns PAY- receipt reference");
      assert(decision.body.payment.amount === 1400, "returns amount");
      assert(decision.body.payment.date === "2026-10-06", "returns date");
      assert(decision.body.payment.method === "Bank Transfer", "returns method");
    }
    const long = lookupPaymentAttemptStatus({ authorizedSchoolId: FLY_EAGLE, idempotencyKey: longKey });
    assert(long.ok && long.body.found === true, "long key found via stable id");
  });
  console.log("✓ found by stable pay-<key> id; helper matches appendSchoolEntrySafe");
}

function testFoundByStoredKeyField() {
  withStores(() => {
    writeSchoolLedger(FLY_EAGLE, [
      capturedPayment(FLY_EAGLE, "legacy-key-1", { id: "pay-legacy-other-id", reference: "PAY-000777" }),
    ]);
    const decision = lookupPaymentAttemptStatus({
      authorizedSchoolId: FLY_EAGLE,
      idempotencyKey: "legacy-key-1",
    });
    assert(decision.ok && decision.body.found === true, "found via stored idempotencyKey field");
    if (decision.ok && decision.body.found) {
      assert(decision.body.payment.id === "pay-legacy-other-id", "returns the stored entry id");
    }
  });
  console.log("✓ found by stored idempotencyKey field");
}

function testNotFound() {
  withStores(() => {
    appendLikeCapture(FLY_EAGLE, "known-key");
    const decision = lookupPaymentAttemptStatus({
      authorizedSchoolId: FLY_EAGLE,
      idempotencyKey: "unknown-key",
    });
    assert(decision.ok && decision.body.found === false, "unknown key not found");
    assert(
      decision.ok && Object.keys(decision.body).sort().join(",") === "found,success",
      "not-found body is minimal"
    );
  });
  console.log("✓ not found");
}

function testInvoiceWithSameIdIsIgnored() {
  withStores(() => {
    writeSchoolLedger(FLY_EAGLE, [
      {
        ...capturedPayment(FLY_EAGLE, "inv-key"),
        id: paymentEntryIdForIdempotencyKey("inv-key"),
        type: "invoice",
      },
    ]);
    const decision = lookupPaymentAttemptStatus({ authorizedSchoolId: FLY_EAGLE, idempotencyKey: "inv-key" });
    assert(decision.ok && decision.body.found === false, "only payment rows match");
  });
  console.log("✓ non-payment rows never match");
}

function testCrossSchoolNotFound() {
  withStores(() => {
    appendLikeCapture(FLY_EAGLE, "fe-only-key");
    for (const other of [MBB, DA_SILVA_ACADEMY_SCHOOL_ID]) {
      const decision = lookupPaymentAttemptStatus({
        authorizedSchoolId: other,
        idempotencyKey: "fe-only-key",
      });
      assert(decision.ok && decision.body.found === false, `${other} cannot see Fly Eagle attempt`);
    }
    const own = lookupPaymentAttemptStatus({ authorizedSchoolId: FLY_EAGLE, idempotencyKey: "fe-only-key" });
    assert(own.ok && own.body.found === true, "own school still found");
  });
  console.log("✓ another school's key reports not found");
}

function testInvalidKeysAndMissingSchool() {
  withStores(() => {
    for (const bad of ["", " ", "../etc/passwd", "a b", "key;drop", "k".repeat(121), null, 42, undefined]) {
      const decision = lookupPaymentAttemptStatus({ authorizedSchoolId: FLY_EAGLE, idempotencyKey: bad });
      assert(!decision.ok && decision.status === 400, `invalid key rejected: ${String(bad).slice(0, 12)}`);
    }
    const ok = lookupPaymentAttemptStatus({ authorizedSchoolId: FLY_EAGLE, idempotencyKey: "k".repeat(120) });
    assert(ok.ok, "120-char key accepted");
    const noSchool = lookupPaymentAttemptStatus({ authorizedSchoolId: "", idempotencyKey: "abc" });
    assert(!noSchool.ok && noSchool.status === 403, "missing authorized school rejected");
  });
  console.log("✓ invalid keys → 400, missing school → 403");
}

function testMinimalPayloadNoPii() {
  withStores(() => {
    const appended = appendLikeCapture(FLY_EAGLE, "pii-key");
    writePaymentAllocations(FLY_EAGLE, appended.entry.id, [
      {
        id: `palloc-${appended.entry.id}-0`,
        paymentId: appended.entry.id,
        schoolId: FLY_EAGLE,
        accountNo: "LENTSWE OMAATLA OTENG",
        invoiceId: "inv-1",
        allocatedAmount: 1400,
        allocatedAt: "2026-10-07T05:41:42.206Z",
        allocatedBy: "staff@flyeagle.test",
      } as never,
    ]);
    const decision = lookupPaymentAttemptStatus({ authorizedSchoolId: FLY_EAGLE, idempotencyKey: "pii-key" });
    assert(decision.ok && decision.body.found === true, "found");
    if (!decision.ok || !decision.body.found) return;
    assert(
      Object.keys(decision.body).sort().join(",") === "allocationSaved,found,payment,success",
      "top-level keys minimal"
    );
    assert(
      Object.keys(decision.body.payment).sort().join(",") === "amount,createdAt,date,id,method,reference",
      "payment keys minimal"
    );
    assert(decision.body.allocationSaved === true, "allocation reported saved");
    // The PAY- receipt number embeds an account token by design (it is what the operator is shown).
    const json = JSON.stringify({ ...decision.body, payment: { ...decision.body.payment, reference: "" } });
    for (const secret of [
      "LENTSWE",
      "staff@flyeagle.test",
      "Staff Member",
      "BANK-REF-SECRET",
      "private note",
      "cmt7tn8nj007silmlb7vyaqs4",
      "user-1",
    ]) {
      assert(!json.includes(secret), `response must not include ${secret}`);
    }
    const noAlloc = appendLikeCapture(FLY_EAGLE, "no-alloc-key");
    const d2 = lookupPaymentAttemptStatus({ authorizedSchoolId: FLY_EAGLE, idempotencyKey: "no-alloc-key" });
    assert(d2.ok && d2.body.found === true && d2.body.allocationSaved === false, `allocation missing reported for ${noAlloc.entry.id}`);
  });
  console.log("✓ minimal payload — no account, names, emails, references, notes");
}

function testZeroWrites() {
  withStores((dir) => {
    appendLikeCapture(FLY_EAGLE, "zero-write-key");
    const before = snapshot(dir);
    for (let i = 0; i < 3; i += 1) {
      lookupPaymentAttemptStatus({ authorizedSchoolId: FLY_EAGLE, idempotencyKey: "zero-write-key" });
      lookupPaymentAttemptStatus({ authorizedSchoolId: FLY_EAGLE, idempotencyKey: "missing-key" });
      lookupPaymentAttemptStatus({ authorizedSchoolId: MBB, idempotencyKey: "zero-write-key" });
    }
    assert(snapshot(dir) === before, "ledger + allocation files unchanged by status lookups");
  });

  withStores((dir) => {
    const decision = lookupPaymentAttemptStatus({ authorizedSchoolId: FLY_EAGLE, idempotencyKey: "abc" });
    assert(decision.ok && decision.body.found === false, "missing files → not found");
    assert(findSchoolPaymentByIdempotencyKey(FLY_EAGLE, "abc") === null, "direct helper null");
    assert(fs.readdirSync(dir).length === 0, "status lookup never creates store files");
  }, false);
  console.log("✓ zero writes (existing files unchanged; missing files not created)");
}

function testDaSilvaAlias() {
  withStores(() => {
    const liveId = "live-da-silva-row-test";
    registerDaSilvaSchoolId(liveId);
    appendLikeCapture(DA_SILVA_ACADEMY_SCHOOL_ID, "dsa-key");
    const viaLive = lookupPaymentAttemptStatus({ authorizedSchoolId: liveId, idempotencyKey: "dsa-key" });
    assert(viaLive.ok && viaLive.body.found === true, "live Da Silva id resolves canonical ledger bucket");
    const viaFe = lookupPaymentAttemptStatus({ authorizedSchoolId: FLY_EAGLE, idempotencyKey: "dsa-key" });
    assert(viaFe.ok && viaFe.body.found === false, "Fly Eagle cannot see Da Silva attempt");
  });
  console.log("✓ Da Silva live-id alias resolves the same bucket as capture");
}

testFoundByStableIdMatchesAppend();
testFoundByStoredKeyField();
testNotFound();
testInvoiceWithSameIdIsIgnored();
testCrossSchoolNotFound();
testInvalidKeysAndMissingSchool();
testMinimalPayloadNoPii();
testZeroWrites();
testDaSilvaAlias();
console.log("\nAll paymentAttemptStatus tests passed.");
