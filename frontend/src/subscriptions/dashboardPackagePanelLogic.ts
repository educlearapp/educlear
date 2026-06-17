import type { EduClearPackage, SchoolSubscriptionStatus } from "./subscriptionsApi";

export function normalizePackageCode(code: string | null | undefined): string {
  return String(code || "").trim().toUpperCase();
}

export function isCurrentActivePackage(
  currentCode: string,
  targetCode: string,
  status: SchoolSubscriptionStatus | string | null | undefined
): boolean {
  return (
    normalizePackageCode(currentCode) === normalizePackageCode(targetCode) &&
    String(status || "").trim().toUpperCase() === "ACTIVE"
  );
}

export function getPackageSwitchButtonLabel(
  currentCode: string,
  targetCode: string,
  status: SchoolSubscriptionStatus | string | null | undefined,
  checkoutBusy: boolean
): string {
  if (checkoutBusy) return "Opening PayFast...";
  if (isCurrentActivePackage(currentCode, targetCode, status)) return "Current Package";
  const targetName = normalizePackageCode(targetCode) === "UNLIMITED" ? "Unlimited" : "Starter";
  return `Switch to ${targetName}`;
}

export function isPackageSwitchDisabled(
  currentCode: string,
  targetCode: string,
  status: SchoolSubscriptionStatus | string | null | undefined,
  checkoutBusy: boolean,
  termsAccepted: boolean,
  payfastConfigured: boolean
): boolean {
  if (!payfastConfigured) return true;
  if (!termsAccepted) return true;
  if (checkoutBusy) return true;
  return isCurrentActivePackage(currentCode, targetCode, status);
}

export function findPackageByCode(
  packages: EduClearPackage[],
  code: string
): EduClearPackage | null {
  const key = normalizePackageCode(code);
  return packages.find((pkg) => normalizePackageCode(pkg.code) === key) ?? null;
}

export function resolveDisplayedCurrentPackage(
  packages: EduClearPackage[],
  subscriptionPackageCode: string | null | undefined,
  subscriptionPackage: EduClearPackage | null | undefined
): EduClearPackage | null {
  if (subscriptionPackage?.code) return subscriptionPackage;
  return findPackageByCode(packages, subscriptionPackageCode || "");
}
