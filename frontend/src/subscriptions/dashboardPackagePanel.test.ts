/**
 * Dashboard package panel logic tests (Phase 6C / 6D / 6D.1 + premium UX).
 * Run: npx tsx src/subscriptions/dashboardPackagePanel.test.ts
 */
import assert from "assert";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { EDUCLEAR_LEGAL_CONTACT } from "../components/legal/legalContact";
import {
  findCommercialPackageByCode,
  formatCommercialPackagePrice,
  listNewSaleCommercialPackages,
} from "../modules/educlearCommercialPackages";
import {
  FULL_UNLIMITED_TOP_PACKAGE_MESSAGE,
  PACKAGE_ACCEPT_TERMS_CTA_LABEL,
  PACKAGE_DOWNGRADE_LATERAL_NOTICE,
  PACKAGE_OPENING_PAYMENT_LABEL,
  PACKAGE_PAGE_INTRO_COPY,
  PACKAGE_PAY_ANNUALLY_LABEL,
  PACKAGE_PAY_NOW_LABEL,
  PACKAGE_UPGRADE_AND_PAY_LABEL,
  PACKAGE_UPGRADE_CONTACT_CTA_LABEL,
  PACKAGE_UPGRADE_MAIL_SUBJECT,
  buildPackageUpgradeMailtoHref,
  cataloguePriceLinesForInterval,
  formatCurrentPackageCard,
  formatPackageCapacityDisplay,
  isModularCheckoutAvailable,
  listUpgradeOptions,
  modularCheckoutDisabledReason,
  onlinePackagePaymentsUnavailableNotice,
  packageChangePolicyNotice,
  packageUpgradeCta,
  resolveCurrentCommercialPackageStrict,
  resolvePackageActionCta,
  resolvePackagePageVisibility,
  upgradeButtonLabel,
} from "./dashboardPackagePanelLogic";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  assert.strictEqual(card.capacityLine, "Unlimited learners");
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
    ["FULL_100", "FULL_UNLIMITED"]
  );
  const fromFull = listUpgradeOptions({ CORE: true, ACCOUNTING: true, PAYROLL: true });
  assert.strictEqual(fromFull.length, 0);
  console.log("✓ Business → Full SKUs; Full Unlimited → none");
}

function testCoreUpgradeChoices() {
  const fromCore = listUpgradeOptions({
    CORE: true,
    ACCOUNTING: false,
    PAYROLL: false,
  });
  assert.deepStrictEqual(
    fromCore.map((p) => p.code),
    ["CORE_ACCOUNTING", "CORE_PAYROLL", "FULL_100", "FULL_UNLIMITED"]
  );
  console.log("✓ CORE shows correct upgrade choices");
}

function testFullUnlimitedCurrentState() {
  const pkg = resolveCurrentCommercialPackageStrict(
    { CORE: true, ACCOUNTING: true, PAYROLL: true },
    { legacyPackageCode: "UNLIMITED" }
  );
  assert.strictEqual(pkg?.code, "FULL_UNLIMITED");
  const monthly = formatCurrentPackageCard(pkg!, "monthly");
  const annual = formatCurrentPackageCard(pkg!, "annual");
  assert.strictEqual(monthly.priceLine, "R2,000 / month");
  assert.strictEqual(annual.priceLine, "R20,000 / year");
  assert.strictEqual(monthly.capacityLine, "Unlimited learners");
  assert.ok(annual.promoLine && /2 months free/i.test(annual.promoLine));
  assert.strictEqual(listUpgradeOptions({ CORE: true, ACCOUNTING: true, PAYROLL: true }).length, 0);
  assert.ok(/Full Unlimited/i.test(FULL_UNLIMITED_TOP_PACKAGE_MESSAGE));

  const activeFull = resolvePackagePageVisibility({
    entitlements: { CORE: true, ACCOUNTING: true, PAYROLL: true },
    subscriptionStatus: "ACTIVE",
    legacyPackageCode: "UNLIMITED",
  });
  assert.strictEqual(activeFull.kind, "existing");
  assert.strictEqual(activeFull.current?.code, "FULL_UNLIMITED");
  assert.strictEqual(activeFull.offerPackages.length, 0);
  console.log("✓ FULL_UNLIMITED current package has no upgrade CTA + correct prices");
}

function testNewUnpaidNotInterpretedAsFullUnlimited() {
  // Fail-open entitlements (all true) + unpaid must NOT become FULL_UNLIMITED.
  const unpaid = resolvePackagePageVisibility({
    entitlements: { CORE: true, ACCOUNTING: true, PAYROLL: true },
    subscriptionStatus: null,
    legacyPackageCode: "UNLIMITED",
  });
  assert.strictEqual(unpaid.kind, "new_unpaid");
  assert.strictEqual(unpaid.current, null);
  assert.deepStrictEqual(
    unpaid.offerPackages.map((p) => p.code),
    [
      "CORE",
      "ACCOUNTING",
      "PAYROLL",
      "BUSINESS",
      "CORE_ACCOUNTING",
      "CORE_PAYROLL",
      "FULL_100",
      "FULL_UNLIMITED",
    ]
  );

  const pending = resolvePackagePageVisibility({
    entitlements: { CORE: true, ACCOUNTING: true, PAYROLL: true },
    subscriptionStatus: "PENDING_PAYMENT",
  });
  assert.strictEqual(pending.kind, "new_unpaid");
  assert.strictEqual(pending.offerPackages.length, 8);
  console.log("✓ NEW / unpaid school shows all 8 packages (not false FULL_UNLIMITED)");
}

function testLowerPackageValidUpgradesOnly() {
  const core = resolvePackagePageVisibility({
    entitlements: { CORE: true, ACCOUNTING: false, PAYROLL: false },
    subscriptionStatus: "ACTIVE",
  });
  assert.strictEqual(core.kind, "existing");
  assert.strictEqual(core.current?.code, "CORE");
  assert.deepStrictEqual(
    core.offerPackages.map((p) => p.code),
    ["CORE_ACCOUNTING", "CORE_PAYROLL", "FULL_100", "FULL_UNLIMITED"]
  );

  const business = resolvePackagePageVisibility({
    entitlements: { CORE: false, ACCOUNTING: true, PAYROLL: true },
    subscriptionStatus: "ACTIVE",
  });
  assert.deepStrictEqual(
    business.offerPackages.map((p) => p.code),
    ["FULL_100", "FULL_UNLIMITED"]
  );
  console.log("✓ lower package shows valid upgrades only (no downgrade/lateral)");
}

function testExistingCustomersPreservedViaActiveStatus() {
  // Da Silva-like: ACTIVE Full Unlimited remains current-only.
  const daSilva = resolvePackagePageVisibility({
    entitlements: { CORE: true, ACCOUNTING: true, PAYROLL: true },
    subscriptionStatus: "ACTIVE",
    legacyPackageCode: "UNLIMITED",
  });
  assert.strictEqual(daSilva.current?.code, "FULL_UNLIMITED");
  assert.strictEqual(daSilva.offerPackages.length, 0);

  // ACTIVE Core school still sees Core upgrades (unchanged graph).
  const activeCore = resolvePackagePageVisibility({
    entitlements: { CORE: true, ACCOUNTING: false, PAYROLL: false },
    subscriptionStatus: "ACTIVE",
  });
  assert.strictEqual(activeCore.current?.code, "CORE");
  assert.ok(activeCore.offerPackages.some((p) => p.code === "FULL_UNLIMITED"));
  console.log("✓ existing ACTIVE customers preserved");
}

function testContactCtaReplacesDeadUpgrade() {
  assert.strictEqual(isModularCheckoutAvailable(), false);
  assert.strictEqual(isModularCheckoutAvailable(false), false);
  const full = findCommercialPackageByCode("FULL_UNLIMITED")!;
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
  assert.ok(decoded.includes("Requested package: EduClear Full Unlimited"));
  assert.ok(!/Upgrade to Full/i.test(cta.label));

  const checkoutCta = packageUpgradeCta({
    checkoutAvailable: isModularCheckoutAvailable(true),
    currentPackageName: "EduClear Business",
    requestedPackage: full,
  });
  assert.strictEqual(checkoutCta.kind, "checkout");
  if (checkoutCta.kind !== "checkout") throw new Error("expected checkout");
  assert.strictEqual(checkoutCta.label, PACKAGE_UPGRADE_AND_PAY_LABEL);
  assert.strictEqual(upgradeButtonLabel(full), PACKAGE_UPGRADE_AND_PAY_LABEL);
  console.log("✓ contact CTA replaces dead Upgrade action");
  console.log("✓ flag-ON checkout CTA kind available");
}

function testFinalPayfastCtaLabels() {
  const core = findCommercialPackageByCode("CORE")!;

  const unpaidNoTerms = resolvePackageActionCta({
    checkoutAvailable: true,
    pageKind: "new_unpaid",
    interval: "monthly",
    termsAccepted: false,
    currentPackageName: "No package yet",
    requestedPackage: core,
  });
  assert.strictEqual(unpaidNoTerms.kind, "terms_gate");
  assert.strictEqual(unpaidNoTerms.label, PACKAGE_ACCEPT_TERMS_CTA_LABEL);

  const unpaidMonthly = resolvePackageActionCta({
    checkoutAvailable: true,
    pageKind: "new_unpaid",
    interval: "monthly",
    termsAccepted: true,
    currentPackageName: "No package yet",
    requestedPackage: core,
  });
  assert.strictEqual(unpaidMonthly.kind, "checkout");
  if (unpaidMonthly.kind !== "checkout") throw new Error("expected checkout");
  assert.strictEqual(unpaidMonthly.label, PACKAGE_PAY_NOW_LABEL);
  assert.ok(!/mailto:/i.test(JSON.stringify(unpaidMonthly)));

  const unpaidAnnual = resolvePackageActionCta({
    checkoutAvailable: true,
    pageKind: "new_unpaid",
    interval: "annual",
    termsAccepted: true,
    currentPackageName: "No package yet",
    requestedPackage: core,
  });
  assert.strictEqual(unpaidAnnual.kind, "checkout");
  if (unpaidAnnual.kind !== "checkout") throw new Error("expected checkout");
  assert.strictEqual(unpaidAnnual.label, PACKAGE_PAY_ANNUALLY_LABEL);

  const busy = resolvePackageActionCta({
    checkoutAvailable: true,
    pageKind: "new_unpaid",
    interval: "monthly",
    termsAccepted: true,
    checkoutBusy: true,
    currentPackageName: "No package yet",
    requestedPackage: core,
  });
  assert.strictEqual(busy.kind, "checkout");
  if (busy.kind !== "checkout") throw new Error("expected checkout");
  assert.strictEqual(busy.label, PACKAGE_OPENING_PAYMENT_LABEL);

  const existing = resolvePackageActionCta({
    checkoutAvailable: true,
    pageKind: "existing",
    interval: "monthly",
    termsAccepted: true,
    currentPackageName: "EduClear Core",
    requestedPackage: findCommercialPackageByCode("FULL_UNLIMITED")!,
  });
  assert.strictEqual(existing.kind, "checkout");
  if (existing.kind !== "checkout") throw new Error("expected checkout");
  assert.strictEqual(existing.label, PACKAGE_UPGRADE_AND_PAY_LABEL);

  const flagOff = resolvePackageActionCta({
    checkoutAvailable: false,
    pageKind: "new_unpaid",
    interval: "monthly",
    termsAccepted: true,
    currentPackageName: "No package yet",
    requestedPackage: core,
  });
  assert.strictEqual(flagOff.kind, "mailto");
  if (flagOff.kind !== "mailto") throw new Error("expected mailto");
  assert.ok(flagOff.href.startsWith("mailto:"));

  // Flag ON never mailto
  for (const interval of ["monthly", "annual"] as const) {
    const cta = resolvePackageActionCta({
      checkoutAvailable: true,
      pageKind: "new_unpaid",
      interval,
      termsAccepted: true,
      currentPackageName: "No package yet",
      requestedPackage: core,
    });
    assert.notStrictEqual(cta.kind, "mailto");
    assert.ok(!/Upgrade/i.test(cta.kind === "checkout" || cta.kind === "terms_gate" ? cta.label : ""));
  }

  assert.strictEqual(packageChangePolicyNotice("new_unpaid"), null);
  assert.strictEqual(packageChangePolicyNotice("existing"), PACKAGE_DOWNGRADE_LATERAL_NOTICE);

  const fullUnlimited = resolvePackagePageVisibility({
    entitlements: { CORE: true, ACCOUNTING: true, PAYROLL: true },
    subscriptionStatus: "ACTIVE",
    legacyPackageCode: "UNLIMITED",
    fullCapacityCode: "FULL_UNLIMITED",
  });
  assert.strictEqual(fullUnlimited.current?.code, "FULL_UNLIMITED");
  assert.strictEqual(fullUnlimited.offerPackages.length, 0);

  console.log("✓ NEW unpaid Pay now / Pay annually; existing Upgrade & Pay; flag-off mailto");
  console.log("✓ unpaid has no downgrade warning; Full Unlimited has no upgrade CTA");
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
  assert.ok(!/bitmask|entitlement internals/i.test(PACKAGE_PAGE_INTRO_COPY));
  assert.strictEqual(
    onlinePackagePaymentsUnavailableNotice(),
    "Online package payments are currently unavailable."
  );
  console.log("✓ clean customer copy + checkout disabled");
}

function testAllEightPrices() {
  const monthlyExpected: Record<string, string> = {
    CORE: "R1,000 / month",
    ACCOUNTING: "R750 / month",
    PAYROLL: "R750 / month",
    BUSINESS: "R1,250 / month",
    CORE_ACCOUNTING: "R1,500 / month",
    CORE_PAYROLL: "R1,500 / month",
    FULL_100: "R1,500 / month",
    FULL_UNLIMITED: "R2,000 / month",
  };
  const annualExpected: Record<string, string> = {
    CORE: "R10,000 / year",
    ACCOUNTING: "R7,500 / year",
    PAYROLL: "R7,500 / year",
    BUSINESS: "R12,500 / year",
    CORE_ACCOUNTING: "R15,000 / year",
    CORE_PAYROLL: "R15,000 / year",
    FULL_100: "R15,000 / year",
    FULL_UNLIMITED: "R20,000 / year",
  };
  assert.deepStrictEqual(cataloguePriceLinesForInterval("monthly"), monthlyExpected);
  assert.deepStrictEqual(cataloguePriceLinesForInterval("annual"), annualExpected);

  const names = Object.fromEntries(
    listNewSaleCommercialPackages().map((p) => [p.code, p.name])
  );
  assert.strictEqual(names.CORE, "EduClear Core");
  assert.strictEqual(names.ACCOUNTING, "EduClear Accounting");
  assert.strictEqual(names.PAYROLL, "EduClear Payroll");
  assert.strictEqual(names.BUSINESS, "EduClear Business");
  assert.strictEqual(names.CORE_ACCOUNTING, "EduClear Core + Accounting");
  assert.strictEqual(names.CORE_PAYROLL, "EduClear Core + Payroll");
  assert.strictEqual(names.FULL_100, "EduClear Full ≤100 learners");
  assert.strictEqual(names.FULL_UNLIMITED, "EduClear Full Unlimited");
  assert.strictEqual(formatPackageCapacityDisplay(findCommercialPackageByCode("FULL_100")!), "Up to 100 active learners");
  assert.strictEqual(
    formatPackageCapacityDisplay(findCommercialPackageByCode("FULL_UNLIMITED")!),
    "Unlimited learners"
  );
  console.log("✓ all 8 monthly/annual prices + presentation names");
}

function testIntervalToggleLabelsVisibleInSource() {
  const toggleSrc = readFileSync(path.join(__dirname, "BillingIntervalToggle.tsx"), "utf8");
  assert.ok(toggleSrc.includes(">Monthly<") || toggleSrc.includes("Monthly"));
  assert.ok(toggleSrc.includes(">Annual<") || toggleSrc.includes("Annual"));
  assert.ok(toggleSrc.includes('data-testid="billing-interval-monthly"'));
  assert.ok(toggleSrc.includes('data-testid="billing-interval-annual"'));
  assert.ok(toggleSrc.includes("aria-pressed"));
  // Explicit ink color — must not inherit body #f5deb3
  assert.ok(toggleSrc.includes('#111827') || toggleSrc.includes("INK"));
  assert.ok(toggleSrc.includes("color: active"));
  console.log("✓ Monthly/Annual labels + explicit ink color in toggle");
}

function testPanelsWireToggleAndFailSafeContact() {
  const dash = readFileSync(path.join(__dirname, "DashboardPackagePanel.tsx"), "utf8");
  const packs = readFileSync(path.join(__dirname, "SubscriptionPackages.tsx"), "utf8");
  for (const src of [dash, packs]) {
    assert.ok(src.includes("BillingIntervalToggle"));
    assert.ok(src.includes("PACKAGE_PAGE_INTRO_COPY"));
    assert.ok(src.includes("color: INK") || src.includes('color: "#0f172a"') || src.includes("INK"));
    assert.ok(src.includes("packageChangePolicyNotice"));
    assert.ok(src.includes('visibility.kind === "existing"'));
    assert.ok(!/Upgrade to \$\{/.test(src));
    assert.ok(src.includes("createSubscriptionCheckout"));
    assert.ok(src.includes("sku: pkg.code"));
    assert.ok(src.includes('billingCycle = interval === "annual" ? "ANNUAL" : "MONTHLY"'));
  }
  assert.ok(dash.includes("checkoutBusySku"));
  assert.ok(dash.includes("if (!checkoutAvailable || checkoutBusySku) return"));
  assert.ok(dash.includes("resolvePackageActionCta") || dash.includes("resolvePackagePageVisibility"));
  assert.ok(packs.includes("resolvePackageActionCta"));
  assert.ok(packs.includes("Pay now") || packs.includes("PACKAGE_PAY_NOW") || packs.includes("resolvePackageActionCta"));
  console.log("✓ panels wire toggle; flag-ON checkout passes SKU/cycle; duplicate click guarded");
  console.log("✓ unpaid path has no Upgrade-to label; downgrade notice gated to existing only");
}

function testPriceSwitchesWithInterval() {
  const full = findCommercialPackageByCode("FULL_UNLIMITED")!;
  assert.strictEqual(formatCommercialPackagePrice(full, "monthly"), "R2,000 / month");
  assert.strictEqual(formatCommercialPackagePrice(full, "annual"), "R20,000 / year");
  const core = findCommercialPackageByCode("CORE")!;
  assert.strictEqual(formatCurrentPackageCard(core, "monthly").priceLine, "R1,000 / month");
  assert.strictEqual(formatCurrentPackageCard(core, "annual").priceLine, "R10,000 / year");
  console.log("✓ price switches correctly monthly ↔ annual");
}

function main() {
  testCurrentPackageFromEntitlements();
  testUpgradeOptions();
  testCoreUpgradeChoices();
  testFullUnlimitedCurrentState();
  testNewUnpaidNotInterpretedAsFullUnlimited();
  testLowerPackageValidUpgradesOnly();
  testExistingCustomersPreservedViaActiveStatus();
  testContactCtaReplacesDeadUpgrade();
  testFinalPayfastCtaLabels();
  testMailtoOmitsMissingSchool();
  testModularCheckoutDisabledCopy();
  testAllEightPrices();
  testIntervalToggleLabelsVisibleInSource();
  testPanelsWireToggleAndFailSafeContact();
  testPriceSwitchesWithInterval();
  console.log("\nAll dashboardPackagePanel tests passed.");
}

main();
