/**
 * Invoice-run recurring monthly due-date policy tests (phase 1).
 * Run: npx tsx src/utils/billingSettingsEngine.invoiceRunDueDate.test.ts
 */
import { defaultBillingSettings } from "../routes/billingSettings";
import {
  computeRecurringMonthlyInvoiceDueDate,
  resolveInvoiceRunPostingDueDate,
  resolveRecurringMonthlyInvoiceDueDay,
} from "./billingSettingsEngine";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function settingsWithDueDay(day: number) {
  const settings = defaultBillingSettings();
  settings.financePolicy.monthlyFeeDueDay = day;
  return settings;
}

function testRecurringMonthlyDueDatesBySchoolPolicy() {
  assert(
    computeRecurringMonthlyInvoiceDueDate("2026-07", 3) === "2026-07-03",
    "due day 3 + July period -> 03 July"
  );
  assert(
    computeRecurringMonthlyInvoiceDueDate("2026-08", 3) === "2026-08-03",
    "due day 3 + August period -> 03 August"
  );
  assert(
    computeRecurringMonthlyInvoiceDueDate("August 2026", 7) === "2026-08-07",
    "due day 7 + August period label -> 07 August"
  );
  assert(
    computeRecurringMonthlyInvoiceDueDate("2026-08", 7, "2026-07-20") === "2026-08-07",
    "invoice date does not shift recurring due date"
  );
  console.log("✓ recurring monthly due dates by school policy");
}

function testResolveRecurringMonthlyInvoiceDueDay() {
  assert(resolveRecurringMonthlyInvoiceDueDay(defaultBillingSettings()) === 3, "default due day 3");
  assert(resolveRecurringMonthlyInvoiceDueDay(settingsWithDueDay(7)) === 7, "configured due day 7");
  console.log("✓ resolve recurring monthly invoice due day");
}

function testResolveInvoiceRunPostingDueDate() {
  const settings = settingsWithDueDay(3);
  assert(
    resolveInvoiceRunPostingDueDate("2026-07", "2026-07-31", settings) === "2026-07-03",
    "July period + due day 3 -> 2026-07-03 regardless of invoice date"
  );
  assert(
    resolveInvoiceRunPostingDueDate("2027-04", "2027-04-01", settings) === "2027-04-03",
    "missing explicit due date uses recurring policy day"
  );
  assert(
    resolveInvoiceRunPostingDueDate("2027-04", "2027-04-01", settings, "2027-04-15") ===
      "2027-04-15",
    "explicit run due date preserved"
  );
  console.log("✓ resolve invoice run posting due date");
}

function main() {
  testRecurringMonthlyDueDatesBySchoolPolicy();
  testResolveRecurringMonthlyInvoiceDueDay();
  testResolveInvoiceRunPostingDueDate();
  console.log("\nAll invoice-run due-date tests passed.");
}

main();
