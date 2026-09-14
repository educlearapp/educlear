/**
 * Modular commercial package panel helpers (Phase 6C).
 */
import type { SchoolModuleEntitlements } from "../modules/schoolModuleEntitlements";
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
