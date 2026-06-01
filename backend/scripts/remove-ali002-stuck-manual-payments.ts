/**
 * Remove stuck manual EFT test payments on ALI002 (2026-06-01).
 *
 *   npx tsx scripts/remove-ali002-stuck-manual-payments.ts
 *   npx tsx scripts/remove-ali002-stuck-manual-payments.ts --apply
 */
import { DA_SILVA_ACADEMY_SCHOOL_ID } from "../src/services/activateDaSilvaSubscription";
import {
  isStuckAli002ManualTestPayment,
  removeStuckAli002ManualTestPayments,
} from "../src/services/repairStuckManualBillingEntries";
import { readSchoolLedger } from "../src/utils/billingLedgerStore";

const APPLY = process.argv.includes("--apply");

const schoolId = DA_SILVA_ACADEMY_SCHOOL_ID;
const matches = readSchoolLedger(schoolId).filter(isStuckAli002ManualTestPayment);

console.log(`School: ${schoolId}`);
console.log(`Matching stuck manual payments: ${matches.length}`);
for (const row of matches) {
  console.log(
    `  - ${row.id} · ${row.date} · ${row.reference} · R${row.amount} · source=${row.source || "(none)"}`
  );
}

if (!APPLY) {
  console.log("\nDry run. Re-run with --apply to remove up to 3 rows (newest first).");
  process.exit(0);
}

const removed = removeStuckAli002ManualTestPayments(schoolId);
console.log(`\nRemoved ${removed.length} entr${removed.length === 1 ? "y" : "ies"}:`, removed);
