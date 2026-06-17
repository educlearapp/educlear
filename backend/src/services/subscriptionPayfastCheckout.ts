import { EduClearPackageCode, SchoolSubscriptionStatus } from "@prisma/client";

export type CheckoutPackageSnapshot = {
  code: EduClearPackageCode;
  id: string;
  monthlyPriceCents: number;
};

/** Unpaid schools may reflect the selected package before PayFast completes. */
export function shouldPersistPackageOnSubscriptionBeforePayment(
  status: SchoolSubscriptionStatus | null | undefined,
): boolean {
  return status === SchoolSubscriptionStatus.PENDING_PAYMENT || status == null;
}

export function parseSubscriptionPackageCode(raw: unknown): EduClearPackageCode | null {
  const normalized = String(raw || "").trim().toUpperCase();
  if (normalized === "STARTER" || normalized === "UNLIMITED") {
    return normalized as EduClearPackageCode;
  }
  return null;
}

export function readCheckoutTargetPackageCode(rawRequest: unknown): EduClearPackageCode | null {
  if (!rawRequest || typeof rawRequest !== "object") return null;
  const raw = rawRequest as Record<string, unknown>;
  return (
    parseSubscriptionPackageCode(raw.targetPackageCode) ||
    parseSubscriptionPackageCode(raw.packageCode)
  );
}

/** Resolve the package paid for from checkout metadata, with amount fallback. */
export function resolvePaidPackageFromCheckout(
  rawRequest: unknown,
  amountCents: number,
  packages: CheckoutPackageSnapshot[],
): CheckoutPackageSnapshot | null {
  const code = readCheckoutTargetPackageCode(rawRequest);
  if (code) {
    const byCode = packages.find((pkg) => pkg.code === code);
    if (byCode) return byCode;
  }

  const byAmount = packages.filter((pkg) => pkg.monthlyPriceCents === amountCents);
  if (byAmount.length === 1) return byAmount[0]!;
  return null;
}
