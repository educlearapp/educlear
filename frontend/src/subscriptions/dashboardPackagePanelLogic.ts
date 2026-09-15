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
  upgradePackagesFrom,
} from "../modules/educlearCommercialPackages";

export { isLegacyCapacityPackageCode };

export const PACKAGE_UPGRADE_CONTACT_CTA_LABEL = "Contact EduClear to upgrade";
export const PACKAGE_UPGRADE_MAIL_SUBJECT = "EduClear Package Upgrade Request";

export function resolveCurrentCommercialPackageStrict(
  entitlements: SchoolModuleEntitlements | null | undefined
): EduClearCommercialPackage | null {
  if (!entitlements) return null;
  return findCommercialPackageByModules({
    CORE: entitlements.CORE === true,
    ACCOUNTING: entitlements.ACCOUNTING === true,
    PAYROLL: entitlements.PAYROLL === true,
  });
}

export function listUpgradeOptions(
  entitlements: SchoolModuleEntitlements | null | undefined
): EduClearCommercialPackage[] {
  const current = resolveCurrentCommercialPackageStrict(entitlements);
  if (!current) return [];
  return upgradePackagesFrom(current.modules);
}

export function formatCurrentPackageCard(
  pkg: EduClearCommercialPackage,
  interval: BillingInterval = "monthly"
): { title: string; priceLine: string; promoLine: string | null; description: string } {
  const priceLine = formatCommercialPackagePrice(pkg, interval);
  return {
    title: pkg.name,
    priceLine,
    promoLine: interval === "annual" ? ANNUAL_PROMOTION_COPY : null,
    description: pkg.description,
  };
}

/** @deprecated Prefer PACKAGE_UPGRADE_CONTACT_CTA_LABEL while modular checkout is offline. */
export function upgradeButtonLabel(target: EduClearCommercialPackage): string {
  return `Upgrade to ${target.shortLabel}`;
}

export function isModularCheckoutAvailable(): boolean {
  // Modular online checkout is intentionally not live yet.
  return false;
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
