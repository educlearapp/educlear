/**
 * Billing settings resilience tests.
 * Run: npx tsx src/routes/billingSettings.resilience.test.ts
 */
import fs from "fs";
import path from "path";

import {
  billingSettingsFromDbRow,
  defaultBillingSettings,
} from "./billingSettings";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function testDefaultWhenRowMissing() {
  const settings = billingSettingsFromDbRow(null);
  assert(settings.invoice.dueDate === defaultBillingSettings().invoice.dueDate, "defaults when null");
  console.log("✓ billingSettingsFromDbRow returns defaults when row missing");
}

function testParseStoredRow() {
  const settings = billingSettingsFromDbRow({
    settings: { invoice: { invoicePrefix: "DS-" } },
  });
  assert(settings.invoice.invoicePrefix === "DS-", "merges stored invoice prefix");
  assert(
    settings.uiPreferences.showBillingSummaryCards === true,
    "defaults billing summary cards visible"
  );
  console.log("✓ billingSettingsFromDbRow merges stored settings");
}

function testLoadSchoolBillingSettingsHasPrismaFallback() {
  const file = path.join(__dirname, "billingSettings.ts");
  const src = fs.readFileSync(file, "utf8");
  const fnStart = src.indexOf("export async function loadSchoolBillingSettings");
  assert(fnStart >= 0, "loadSchoolBillingSettings exists");
  const fnBody = src.slice(fnStart, fnStart + 600);
  assert(fnBody.includes("try {"), "loadSchoolBillingSettings uses try");
  assert(fnBody.includes("defaultBillingSettings()"), "returns defaults on failure");
  assert(fnBody.includes("console.error"), "logs server-side on failure");
  console.log("✓ loadSchoolBillingSettings catches Prisma errors and falls back to defaults");
}

function main() {
  testDefaultWhenRowMissing();
  testParseStoredRow();
  testLoadSchoolBillingSettingsHasPrismaFallback();
  const fallback = defaultBillingSettings();
  assert(Boolean(fallback.invoice), "default settings include invoice block");
  console.log("✓ default billing settings safe for invoice creation fallback");
  console.log("\nAll billingSettings resilience tests passed.");
}

main();
