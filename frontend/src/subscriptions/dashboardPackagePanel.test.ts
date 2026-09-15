/**
 * Dashboard package panel logic tests (Phase 6C / 6D / 6D.1).
 * Run: npx tsx src/subscriptions/dashboardPackagePanel.test.ts
 */
import assert from "assert";

import { EDUCLEAR_LEGAL_CONTACT } from "../components/legal/legalContact";
import { findCommercialPackageByCode } from "../modules/educlearCommercialPackages";
import {
  PACKAGE_UPGRADE_CONTACT_CTA_LABEL,
  PACKAGE_UPGRADE_MAIL_SUBJECT,
  buildPackageUpgradeMailtoHref,
  formatCurrentPackageCard,
  isModularCheckoutAvailable,
  listUpgradeOptions,
  modularCheckoutDisabledReason,
  onlinePackagePaymentsUnavailableNotice,
  packageUpgradeCta,
  resolveCurrentCommercialPackageStrict,
} from "./dashboardPackagePanelLogic";

function testCurrentPackageFromEntitlements() {
  const pkg = resolveCurrentCommercialPackageStrict({
    CORE: false,
    ACCOUNTING: true,
    PAYROLL: false,
  });
  assert.strictEqual(pkg?.code, "ACCOUNTING");
  assert.strictEqual(pkg?.monthlyPriceZar, 750);
  const card = formatCurrentPackageCard(pkg!, "monthly");
  assert.strictEqual(card.title, "EduClear Accounting");
  assert.strictEqual(card.priceLine, "R750 / month");
  console.log("✓ current package card from entitlements");
}

function testUpgradeOptions() {
  const fromBusiness = listUpgradeOptions({
    CORE: false,
    ACCOUNTING: true,
    PAYROLL: true,
  });
  assert.deepStrictEqual(
    fromBusiness.map((p) => p.code),
    ["FULL"]
  );
  const fromFull = listUpgradeOptions({ CORE: true, ACCOUNTING: true, PAYROLL: true });
  assert.strictEqual(fromFull.length, 0);
  console.log("✓ Business → Full only; Full → none");
}

function testContactCtaReplacesDeadUpgrade() {
  assert.strictEqual(isModularCheckoutAvailable(), false);
  const full = findCommercialPackageByCode("FULL")!;
  const cta = packageUpgradeCta({
    checkoutAvailable: false,
    currentPackageName: "EduClear Business",
    requestedPackage: full,
    schoolName: "Example Primary School",
  });
  assert.strictEqual(cta.kind, "mailto");
  if (cta.kind !== "mailto") throw new Error("expected mailto");
  assert.strictEqual(cta.label, PACKAGE_UPGRADE_CONTACT_CTA_LABEL);
  assert.ok(cta.href.startsWith(`mailto:${EDUCLEAR_LEGAL_CONTACT.email}?`));
  assert.ok(cta.href.includes(encodeURIComponent(PACKAGE_UPGRADE_MAIL_SUBJECT).replace(/%20/g, "%20")));
  const decoded = decodeURIComponent(cta.href);
  assert.ok(decoded.includes("EduClear Package Upgrade Request"));
  assert.ok(decoded.includes("School: Example Primary School"));
  assert.ok(decoded.includes("Current package: EduClear Business"));
  assert.ok(decoded.includes("Requested package: EduClear Full"));
  assert.ok(!/Upgrade to Full/i.test(cta.label));
  console.log("✓ contact CTA replaces dead Upgrade action");
}

function testMailtoOmitsMissingSchool() {
  const href = buildPackageUpgradeMailtoHref({
    currentPackageName: "EduClear Core",
    requestedPackageName: "EduClear Full",
  });
  const decoded = decodeURIComponent(href);
  assert.ok(!decoded.includes("School:"));
  assert.ok(decoded.includes("Current package: EduClear Core"));
  assert.ok(decoded.includes("Requested package: EduClear Full"));
  assert.ok(href.startsWith(`mailto:${EDUCLEAR_LEGAL_CONTACT.email}`));
  console.log("✓ mailto omits school when unavailable");
}

function testModularCheckoutDisabledCopy() {
  assert.strictEqual(isModularCheckoutAvailable(), false);
  const reason = modularCheckoutDisabledReason();
  assert.strictEqual(
    reason,
    "Online package changes are not available yet. Contact EduClear to change your package."
  );
  assert.ok(!/legacy capacity/i.test(reason));
  assert.ok(!/PAYFAST_/i.test(reason));
  assert.strictEqual(
    onlinePackagePaymentsUnavailableNotice(),
    "Online package payments are currently unavailable."
  );
  console.log("✓ clean customer copy + checkout disabled");
}

function main() {
  testCurrentPackageFromEntitlements();
  testUpgradeOptions();
  testContactCtaReplacesDeadUpgrade();
  testMailtoOmitsMissingSchool();
  testModularCheckoutDisabledCopy();
  console.log("\nAll dashboardPackagePanel tests passed.");
}

main();
