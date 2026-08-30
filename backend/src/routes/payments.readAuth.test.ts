/**
 * Payment GET + allocation-suggest tenant isolation (isolated ledger only).
 * Run: npx tsx src/routes/payments.readAuth.test.ts
 */
import fs from "fs";
import os from "os";
import path from "path";

import { evaluateCapturePaymentAuth } from "../middleware/requireCapturePaymentAuth";
import { permissionsForRole } from "../utils/userPermissions";
import {
  listPayments,
  readSchoolLedger,
  setBillingLedgerStoreDataDirForTests,
  writeSchoolLedger,
  computeOpenInvoiceLines,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";

const FLY_EAGLE = "cmt1e8bjp0jo8lcjeketlynhl";
const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";
const MBB = "cmq4xjckq00at60gqg4eb956h";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function jwtPayload(schoolId: string) {
  return {
    userId: `user-${schoolId.slice(-6)}`,
    schoolId,
    email: "finance@example.com",
    role: "FINANCE",
  };
}

function activeUser(schoolId: string) {
  return { id: `user-${schoolId.slice(-6)}`, schoolId, role: "FINANCE", isActive: true };
}

function readAuth(schoolId: string, requestSchoolId?: string) {
  return evaluateCapturePaymentAuth({
    jwtPayload: jwtPayload(schoolId),
    user: activeUser(schoolId),
    appRole: "Finance",
    permissions: permissionsForRole("Finance"),
    requestSchoolId,
    requireAction: "view",
  });
}

function simulatePaymentGet(authorizedSchool: string, querySchoolId: string) {
  const decision = readAuth(authorizedSchool, querySchoolId);
  if (!decision.allowed) {
    return { status: decision.status, code: decision.code, payments: [] as BillingLedgerEntry[] };
  }
  return { status: 200, payments: listPayments(decision.authorizedSchoolId) };
}

function simulateOpenInvoices(authorizedSchool: string, querySchoolId: string, accountNo: string) {
  const decision = readAuth(authorizedSchool, querySchoolId);
  if (!decision.allowed) {
    return { status: decision.status, code: decision.code, openInvoices: [] as unknown[] };
  }
  const ledger = readSchoolLedger(decision.authorizedSchoolId);
  const ref = String(accountNo || "").trim().toUpperCase();
  const scoped = ledger.filter(
    (e) => String(e.accountNo || "").trim().toUpperCase() === ref
  );
  return {
    status: 200,
    schoolId: decision.authorizedSchoolId,
    openInvoices: computeOpenInvoiceLines(scoped, "", ref),
  };
}

function simulateSuggest(authorizedSchool: string, bodySchoolId: string, accountNo: string) {
  const decision = readAuth(authorizedSchool, bodySchoolId);
  if (!decision.allowed) {
    return { status: decision.status, code: decision.code, suggestions: [] as { invoiceId: string }[] };
  }
  const ledger = readSchoolLedger(decision.authorizedSchoolId);
  const ref = String(accountNo || "").trim().toUpperCase();
  const open = computeOpenInvoiceLines(ledger, "", ref);
  return {
    status: 200,
    schoolId: decision.authorizedSchoolId,
    suggestions: open.map((inv) => ({ invoiceId: inv.id })),
  };
}

function pay(schoolId: string, accountNo: string, id: string): BillingLedgerEntry {
  return {
    id,
    schoolId,
    learnerId: "",
    accountNo,
    type: "payment",
    amount: 100,
    date: "2026-08-30",
    reference: `PAY-${id}`,
    description: "Test",
    source: "manual",
    createdAt: "2026-08-30T12:00:00.000Z",
  };
}

function invoice(schoolId: string, accountNo: string, id: string): BillingLedgerEntry {
  return {
    id,
    schoolId,
    learnerId: "",
    accountNo,
    type: "invoice",
    amount: 500,
    date: "2026-08-01",
    reference: `INV-${id}`,
    description: "Fees",
    source: "manual",
    createdAt: "2026-08-01T08:00:00.000Z",
  };
}

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pay-read-auth-"));
  fs.writeFileSync(path.join(dir, "billing-ledger.json"), "{}", "utf8");
  return dir;
}

function withIsolatedLedger(fn: () => void) {
  const dir = makeTempDir();
  setBillingLedgerStoreDataDirForTests(dir);
  try {
    writeSchoolLedger(FLY_EAGLE, [
      pay(FLY_EAGLE, "ABAYE TUMO ASHANAFY", "pay-fe"),
      invoice(FLY_EAGLE, "ABAYE TUMO ASHANAFY", "inv-fe"),
    ]);
    writeSchoolLedger(DA_SILVA, [
      pay(DA_SILVA, "SIL007", "pay-dsa"),
      invoice(DA_SILVA, "SIL007", "inv-dsa"),
    ]);
    writeSchoolLedger(MBB, [
      pay(MBB, "MBB012", "pay-mbb"),
      invoice(MBB, "MBB012", "inv-mbb"),
    ]);
    fn();
  } finally {
    setBillingLedgerStoreDataDirForTests(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function testUnauthenticatedGetRejected() {
  const d = evaluateCapturePaymentAuth({
    jwtPayload: null,
    user: null,
    appRole: "Finance",
    permissions: null,
    requestSchoolId: FLY_EAGLE,
    requireAction: "view",
  });
  assert(!d.allowed && d.status === 401, "unauthenticated GET rejected");
  console.log("✓ unauthenticated payment GET rejected");
}

function testFlyEagleCanReadOwn() {
  withIsolatedLedger(() => {
    const got = simulatePaymentGet(FLY_EAGLE, FLY_EAGLE);
    assert(got.status === 200, "Fly Eagle GET 200");
    assert(got.payments.length === 1, "one Fly Eagle payment");
    assert(got.payments[0].id === "pay-fe", "own payment only");
    assert(
      got.payments.every((p) => p.schoolId === FLY_EAGLE),
      "session school ledger only"
    );
    const accounts = simulateOpenInvoices(FLY_EAGLE, FLY_EAGLE, "ABAYE TUMO ASHANAFY");
    assert(accounts.status === 200, "open-invoices 200");
    assert(accounts.openInvoices.length === 1, "Fly Eagle invoice visible");
  });
  console.log("✓ authenticated Fly Eagle user can read Fly Eagle payment/account data");
}

function testCrossSchoolGetsRejected() {
  withIsolatedLedger(() => {
    const pairs: Array<[string, string, string]> = [
      [FLY_EAGLE, DA_SILVA, "Fly Eagle cannot read Da Silva"],
      [FLY_EAGLE, MBB, "Fly Eagle cannot read Magical Bright Beginnings"],
      [DA_SILVA, FLY_EAGLE, "Da Silva cannot read Fly Eagle"],
      [MBB, FLY_EAGLE, "Magical Bright Beginnings cannot read Fly Eagle"],
    ];
    for (const [from, to, label] of pairs) {
      const got = simulatePaymentGet(from, to);
      assert(got.status === 403, `${label} GET`);
      assert(got.payments.length === 0, `${label} returns no payments`);
      const invoices = simulateOpenInvoices(from, to, "SIL007");
      assert(invoices.status === 403, `${label} open-invoices`);
      const suggest = simulateSuggest(from, to, "SIL007");
      assert(suggest.status === 403, `${label} suggest`);
    }
  });
  console.log("✓ Fly Eagle / Da Silva / Magical Bright Beginnings cannot read each other");
}

function testQuerySchoolIdCannotOverride() {
  withIsolatedLedger(() => {
    const got = simulatePaymentGet(FLY_EAGLE, DA_SILVA);
    assert(got.status === 403, "spoofed query schoolId rejected");
    const own = simulatePaymentGet(FLY_EAGLE, "");
    assert(own.status === 200 && own.payments[0].id === "pay-fe", "omitted query uses session school");
  });
  console.log("✓ body/query schoolId cannot override authenticated school");
}

function testUnauthorizedSuggestRejected() {
  const d = evaluateCapturePaymentAuth({
    jwtPayload: jwtPayload(FLY_EAGLE),
    user: activeUser(FLY_EAGLE),
    appRole: "Teacher",
    permissions: permissionsForRole("Teacher"),
    requestSchoolId: FLY_EAGLE,
    requireAction: "view",
  });
  assert(!d.allowed && d.status === 403, "Teacher suggest denied");
  const unauth = evaluateCapturePaymentAuth({
    jwtPayload: null,
    user: null,
    appRole: "Finance",
    permissions: null,
    requestSchoolId: FLY_EAGLE,
    requireAction: "view",
  });
  assert(!unauth.allowed && unauth.status === 401, "unauthenticated suggest rejected");
  console.log("✓ unauthorized allocation suggest rejected");
}

function testAuthorizedSuggestWorks() {
  withIsolatedLedger(() => {
    const ok = simulateSuggest(FLY_EAGLE, FLY_EAGLE, "ABAYE TUMO ASHANAFY");
    assert(ok.status === 200, "authorized suggest 200");
    assert(ok.schoolId === FLY_EAGLE, "suggest uses session school");
    assert(ok.suggestions.length === 1 && ok.suggestions[0].invoiceId === "inv-fe", "suggests own invoice");

    const sameRefOtherSchool = simulateSuggest(FLY_EAGLE, FLY_EAGLE, "SIL007");
    assert(sameRefOtherSchool.status === 200, "own-school lookup still authorized");
    assert(sameRefOtherSchool.suggestions.length === 0, "Da Silva invoice not leaked via accountNo");
  });
  console.log("✓ authorized allocation suggest still works and stays school-scoped");
}

testUnauthenticatedGetRejected();
testFlyEagleCanReadOwn();
testCrossSchoolGetsRejected();
testQuerySchoolIdCannotOverride();
testUnauthorizedSuggestRejected();
testAuthorizedSuggestWorks();
console.log("\nAll payments.readAuth tests passed.");
