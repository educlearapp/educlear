/**
 * Modular commercial package panel helpers (Phase 6C / 6D / 6D.1).
 */
import type { SchoolModuleEntitlements } from "../modules/schoolModuleEntitlements";
import { EDUCLEAR_LEGAL_CONTACT } from "../components/legal/legalContact";
import {
  type BillingInterval,
  type CommercialPackageCode,
  type EduClearCommercialPackage,
  ANNUAL_PROMOTION_COPY,
  findCommercialPackageByModules,
  formatCommercialPackagePrice,
  isLegacyCapacityPackageCode,
  listNewSaleCommercialPackages,
  upgradePackagesFrom,
} from "../modules/educlearCommercialPackages";

export { isLegacyCapacityPackageCode };

export const PACKAGE_UPGRADE_CONTACT_CTA_LABEL = "Contact EduClear to upgrade";
export const PACKAGE_UPGRADE_MAIL_SUBJECT = "EduClear Package Upgrade Request";

/** Customer-facing package page intro (no internal module language). */
export const PACKAGE_PAGE_INTRO_COPY =
  "Choose the EduClear package that fits your school. Upgrade at any time as your school grows.";

export const FULL_UNLIMITED_TOP_PACKAGE_MESSAGE =
  "You're on EduClear Full Unlimited — our complete package.";

export function formatPackageCapacityDisplay(pkg: EduClearCommercialPackage): string {
  if (pkg.learnerLimit == null) return "Unlimited learners";
  return `Up to ${Math.trunc(pkg.learnerLimit)} active learners`;
}

/**
 * Paid commercial package UI requires an ACTIVE subscription.
 * Fail-open module entitlements (missing rows → all true) must NOT be treated
 * as FULL_UNLIMITED for unpaid / pending schools.
 */
export function isPaidActiveSubscription(
  subscriptionStatus: string | null | undefined
): boolean {
  return String(subscriptionStatus || "").trim().toUpperCase() === "ACTIVE";
}

export type PackagePageVisibility = {
  kind: "new_unpaid" | "existing";
  current: EduClearCommercialPackage | null;
  /** New unpaid: all 8 catalogue SKUs. Existing: valid upgrades only (never downgrade/lateral). */
  offerPackages: EduClearCommercialPackage[];
};

/**
 * Package page visibility SoT.
 * - New / unpaid (no ACTIVE subscription): no current paid package; offer all 8.
 * - Existing ACTIVE lower package: current + upgrade graph only.
 * - Existing ACTIVE FULL_UNLIMITED: current only; no offer cards.
 */
export function resolvePackagePageVisibility(input: {
  entitlements: SchoolModuleEntitlements | null | undefined;
  subscriptionStatus: string | null | undefined;
  legacyPackageCode?: string | null;
  fullCapacityCode?: "FULL_100" | "FULL_UNLIMITED" | null;
}): PackagePageVisibility {
  if (!isPaidActiveSubscription(input.subscriptionStatus)) {
    return {
      kind: "new_unpaid",
      current: null,
      offerPackages: listNewSaleCommercialPackages(),
    };
  }

  const opts = {
    legacyPackageCode: input.legacyPackageCode,
    fullCapacityCode: input.fullCapacityCode,
  };
  const current = resolveCurrentCommercialPackageStrict(input.entitlements, opts);
  if (!current) {
    return { kind: "existing", current: null, offerPackages: [] };
  }
  if (current.code === "FULL_UNLIMITED") {
    return { kind: "existing", current, offerPackages: [] };
  }
  return {
    kind: "existing",
    current,
    offerPackages: listUpgradeOptions(input.entitlements, opts),
  };
}

export function resolveCurrentCommercialPackageStrict(
  entitlements: SchoolModuleEntitlements | null | undefined,
  opts?: { legacyPackageCode?: string | null; fullCapacityCode?: "FULL_100" | "FULL_UNLIMITED" | null }
): EduClearCommercialPackage | null {
  if (!entitlements) return null;
  return findCommercialPackageByModules(
    {
      CORE: entitlements.CORE === true,
      ACCOUNTING: entitlements.ACCOUNTING === true,
      PAYROLL: entitlements.PAYROLL === true,
    },
    {
      legacyPackageCode: opts?.legacyPackageCode,
      fullCapacityCode: opts?.fullCapacityCode,
    }
  );
}

export function listUpgradeOptions(
  entitlements: SchoolModuleEntitlements | null | undefined,
  opts?: { legacyPackageCode?: string | null; fullCapacityCode?: "FULL_100" | "FULL_UNLIMITED" | null }
): EduClearCommercialPackage[] {
  const current = resolveCurrentCommercialPackageStrict(entitlements, opts);
  if (!current) return [];
  return upgradePackagesFrom(current.modules, opts);
}

export function formatCurrentPackageCard(
  pkg: EduClearCommercialPackage,
  interval: BillingInterval = "monthly"
): {
  title: string;
  capacityLine: string;
  priceLine: string;
  promoLine: string | null;
  description: string;
} {
  const priceLine = formatCommercialPackagePrice(pkg, interval);
  return {
    title: pkg.name,
    capacityLine: formatPackageCapacityDisplay(pkg),
    priceLine,
    promoLine: interval === "annual" ? ANNUAL_PROMOTION_COPY : null,
    description: pkg.description,
  };
}

/** Checkout CTA when modular PayFast is enabled (flag ON). */
export function upgradeButtonLabel(target: EduClearCommercialPackage): string {
  return `Upgrade to ${target.name}`;
}

/** All 8 catalogue prices for the selected interval (regression helper). */
export function cataloguePriceLinesForInterval(interval: BillingInterval): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pkg of listNewSaleCommercialPackages()) {
    out[pkg.code] = formatCommercialPackagePrice(pkg, interval);
  }
  return out;
}

/** Backend-controlled. Pass modularCheckoutAvailable from GET /api/subscriptions/config. */
export function isModularCheckoutAvailable(backendFlag?: boolean | null): boolean {
  // Modular online checkout stays off unless the backend explicitly enables it.
  return backendFlag === true;
}

export function modularCheckoutDisabledReason(): string {
  return "Online package changes are not available yet. Contact EduClear to change your package.";
}

/** Safe school-user notice when online payments are unavailable (no config/secret names). */
export function onlinePackagePaymentsUnavailableNotice(): string {
  return "Online package payments are currently unavailable.";
}

export type PackageUpgradeMailtoInput = {
  currentPackageName: string;
  requestedPackageName: string;
  schoolName?: string | null;
};

/**
 * Builds a mailto: href to the canonical EduClear contact email.
 * Omits school name when not safely available. No IDs, secrets, or balances.
 */
export function buildPackageUpgradeMailtoHref(input: PackageUpgradeMailtoInput): string {
  const current = String(input.currentPackageName || "").trim() || "Unknown";
  const requested = String(input.requestedPackageName || "").trim() || "Unknown";
  const school = String(input.schoolName || "").trim();

  const lines = [
    ...(school ? [`School: ${school}`] : []),
    `Current package: ${current}`,
    `Requested package: ${requested}`,
  ];

  const params = new URLSearchParams({
    subject: PACKAGE_UPGRADE_MAIL_SUBJECT,
    body: lines.join("\n"),
  });
  // URLSearchParams uses + for spaces; mailto clients prefer %20
  const query = params.toString().replace(/\+/g, "%20");
  return `mailto:${EDUCLEAR_LEGAL_CONTACT.email}?${query}`;
}

/** While modular checkout is offline, always use the contact CTA (never a dead Upgrade button). */
export function packageUpgradeCta(input: {
  checkoutAvailable: boolean;
  currentPackageName: string;
  requestedPackage: EduClearCommercialPackage;
  schoolName?: string | null;
}): { kind: "mailto"; label: string; href: string } | { kind: "checkout"; label: string } {
  if (input.checkoutAvailable) {
    return { kind: "checkout", label: upgradeButtonLabel(input.requestedPackage) };
  }
  return {
    kind: "mailto",
    label: PACKAGE_UPGRADE_CONTACT_CTA_LABEL,
    href: buildPackageUpgradeMailtoHref({
      currentPackageName: input.currentPackageName,
      requestedPackageName: input.requestedPackage.name,
      schoolName: input.schoolName,
    }),
  };
}

/** @deprecated Legacy capacity helpers — not for new-sale UX. */
export function normalizePackageCode(code: string | null | undefined): string {
  return String(code || "").trim().toUpperCase();
}

/** @deprecated */
export function isCurrentActivePackage(
  currentCode: string,
  targetCode: string,
  status: string | null | undefined
): boolean {
  return (
    normalizePackageCode(currentCode) === normalizePackageCode(targetCode) &&
    String(status || "").trim().toUpperCase() === "ACTIVE"
  );
}

/** @deprecated */
export function getPackageSwitchButtonLabel(
  currentCode: string,
  targetCode: string,
  status: string | null | undefined,
  checkoutBusy: boolean
): string {
  if (checkoutBusy) return "Opening PayFast...";
  if (isCurrentActivePackage(currentCode, targetCode, status)) return "Current Package";
  const targetName = normalizePackageCode(targetCode) === "UNLIMITED" ? "Unlimited" : "Starter";
  return `Switch to ${targetName}`;
}

/** @deprecated */
export function isPackageSwitchDisabled(
  currentCode: string,
  targetCode: string,
  status: string | null | undefined,
  checkoutBusy: boolean,
  termsAccepted: boolean,
  payfastConfigured: boolean
): boolean {
  if (!payfastConfigured) return true;
  if (!termsAccepted) return true;
  if (checkoutBusy) return true;
  return isCurrentActivePackage(currentCode, targetCode, status);
}

/** @deprecated */
export function findPackageByCode<T extends { code: string }>(
  packages: T[],
  code: string
): T | null {
  const key = normalizePackageCode(code);
  return packages.find((pkg) => normalizePackageCode(pkg.code) === key) ?? null;
}

/** @deprecated */
export function resolveDisplayedCurrentPackage<T extends { code: string }>(
  packages: T[],
  subscriptionPackageCode: string | null | undefined,
  subscriptionPackage: T | null | undefined
): T | null {
  if (subscriptionPackage?.code) return subscriptionPackage;
  return findPackageByCode(packages, subscriptionPackageCode || "");
}

export type { CommercialPackageCode, EduClearCommercialPackage };
