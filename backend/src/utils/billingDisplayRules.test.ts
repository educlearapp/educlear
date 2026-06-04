/**
 * Run: npx ts-node --transpile-only src/utils/billingDisplayRules.test.ts
 */
import { countsTowardPostImportBalanceDelta } from "./billingDisplayRules";
import type { BillingLedgerEntry } from "./billingLedgerStore";

function payment(source: string): BillingLedgerEntry {
  return {
    id: "pay-test",
    schoolId: "s1",
    learnerId: "",
    accountNo: "SIL001",
    type: "payment",
    amount: 100,
    date: "2026-06-01",
    reference: "R1",
    description: "Payment",
    source,
    createdAt: "2026-06-04T12:00:00.000Z",
  };
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(countsTowardPostImportBalanceDelta(payment("manual")), "manual payments post to balance");
assert(countsTowardPostImportBalanceDelta(payment("bank_import")), "bank import payments post to balance");
assert(
  countsTowardPostImportBalanceDelta(payment("kidesys_topup")),
  "top-up import payments must post to balance like manual payments"
);
assert(
  !countsTowardPostImportBalanceDelta(payment("kidesys_display_history")),
  "display history payments must not post to balance"
);

console.log("billingDisplayRules.test.ts: ok");
