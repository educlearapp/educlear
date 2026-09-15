/**
 * Modular commercial PayFast checkout (Phase 1).
 *
 * Authoritative pricing + entitlement mapping from educlearCommercialPackages.
 * Gated by ENABLE_MODULAR_PAYFAST_CHECKOUT (default OFF).
 * Legacy STARTER/UNLIMITED initiation remains blocked elsewhere.
 */
import { EduClearPackageCode, ProductModule, type Prisma } from "@prisma/client";

import {
  type CommercialPackageCode,
  type CommercialPackageModules,
  type EduClearCommercialPackage,
  findCommercialPackageByCode,
  findCommercialPackageByModules,
  upgradeCodesFrom,
} from "./educlearCommercialPackages";
import { addCalendarMonths } from "./payfastService";

export const MODULAR_CHECKOUT_KIND = "MODULAR_COMMERCIAL" as const;
export const MODULAR_PAYFAST_ACTIVATION_SOURCE = "payfast_modular_itn" as const;

export type ModularBillingCycle = "MONTHLY" | "ANNUAL";

export type ModularPaymentIntent = {
  checkoutType: "SUBSCRIPTION";
  checkoutKind: typeof MODULAR_CHECKOUT_KIND;
  schoolId: string;
  commercialSku: CommercialPackageCode;
  billingCycle: ModularBillingCycle;
  amountCents: number;
  periodMonths: number;
  learnerLimit: number | null;
  modules: CommercialPackageModules;
  legacyCapacityCode: EduClearPackageCode;
  itemName: string;
  createdAt: string;
};

export type ModularCheckoutQuote = {
  sku: CommercialPackageCode;
  billingCycle: ModularBillingCycle;
  package: EduClearCommercialPackage;
  amountCents: number;
  amountZarDisplay: string;
  periodMonths: number;
  learnerLimit: number | null;
  modules: CommercialPackageModules;
  legacyCapacityCode: EduClearPackageCode;
  itemName: string;
  itemDescription: string;
};

/** Explicit opt-in. Unset / false / anything else → OFF. */
export function isModularPayfastCheckoutEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return String(env.ENABLE_MODULAR_PAYFAST_CHECKOUT || "")
    .trim()
    .toLowerCase() === "true";
}

export function parseCommercialSku(raw: unknown): CommercialPackageCode | null {
  const key = String(raw || "")
    .trim()
    .toUpperCase();
  const pkg = findCommercialPackageByCode(key);
  return pkg?.code ?? null;
}

export function parseModularBillingCycle(raw: unknown): ModularBillingCycle | null {
  const key = String(raw || "")
    .trim()
    .toUpperCase();
  if (key === "MONTHLY" || key === "ANNUAL") return key;
  // Accept FE interval aliases
  if (key === "MONTH") return "MONTHLY";
  if (key === "YEAR" || key === "YEARLY") return "ANNUAL";
  return null;
}

export function zarToCents(zar: number): number {
  return Math.round(Number(zar) * 100);
}

export function formatAmountZarFromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** FULL_100 → STARTER capacity FK; all other commercial SKUs → UNLIMITED capacity FK. */
export function legacyCapacityCodeForCommercialSku(
  sku: CommercialPackageCode
): EduClearPackageCode {
  return sku === "FULL_100" ? "STARTER" : "UNLIMITED";
}

export function periodMonthsForCycle(cycle: ModularBillingCycle): number {
  return cycle === "ANNUAL" ? 12 : 1;
}

export function computeSubscriptionPeriodEnd(
  from: Date,
  cycle: ModularBillingCycle
): Date {
  return addCalendarMonths(from, periodMonthsForCycle(cycle));
}

/**
 * Resolve authoritative quote. Rejects unknown SKU, invalid cycle, and
 * client-supplied amount that does not match catalogue cents.
 */
export function resolveModularCheckoutQuote(input: {
  sku: unknown;
  billingCycle: unknown;
  clientAmountCents?: unknown;
  clientAmountZar?: unknown;
}): ModularCheckoutQuote {
  const sku = parseCommercialSku(input.sku);
  if (!sku) {
    throw new ModularCheckoutError("Unknown commercial package SKU", 400, "INVALID_SKU");
  }
  const billingCycle = parseModularBillingCycle(input.billingCycle);
  if (!billingCycle) {
    throw new ModularCheckoutError(
      "billingCycle must be MONTHLY or ANNUAL",
      400,
      "INVALID_BILLING_CYCLE"
    );
  }

  const pkg = findCommercialPackageByCode(sku);
  if (!pkg) {
    throw new ModularCheckoutError("Unknown commercial package SKU", 400, "INVALID_SKU");
  }

  const amountZar =
    billingCycle === "ANNUAL" ? pkg.annualPriceZar : pkg.monthlyPriceZar;
  const amountCents = zarToCents(amountZar);

  if (input.clientAmountCents !== undefined && input.clientAmountCents !== null && input.clientAmountCents !== "") {
    const clientCents = Number(input.clientAmountCents);
    if (!Number.isFinite(clientCents) || Math.round(clientCents) !== amountCents) {
      throw new ModularCheckoutError(
        "Client amount does not match authoritative catalogue price",
        400,
        "AMOUNT_TAMPER"
      );
    }
  }
  if (input.clientAmountZar !== undefined && input.clientAmountZar !== null && input.clientAmountZar !== "") {
    const clientZar = Number(input.clientAmountZar);
    if (!Number.isFinite(clientZar) || zarToCents(clientZar) !== amountCents) {
      throw new ModularCheckoutError(
        "Client amount does not match authoritative catalogue price",
        400,
        "AMOUNT_TAMPER"
      );
    }
  }

  const cycleLabel = billingCycle === "ANNUAL" ? "Annual" : "Monthly";
  const itemName = `${pkg.name} (${cycleLabel})`;
  const itemDescription = `${pkg.description} — ${cycleLabel} subscription`;

  return {
    sku,
    billingCycle,
    package: pkg,
    amountCents,
    amountZarDisplay: formatAmountZarFromCents(amountCents),
    periodMonths: periodMonthsForCycle(billingCycle),
    learnerLimit: pkg.learnerLimit,
    modules: { ...pkg.modules },
    legacyCapacityCode: legacyCapacityCodeForCommercialSku(sku),
    itemName,
    itemDescription,
  };
}

export function buildModularPaymentIntent(input: {
  schoolId: string;
  quote: ModularCheckoutQuote;
  createdAt?: Date;
}): ModularPaymentIntent {
  return {
    checkoutType: "SUBSCRIPTION",
    checkoutKind: MODULAR_CHECKOUT_KIND,
    schoolId: String(input.schoolId || "").trim(),
    commercialSku: input.quote.sku,
    billingCycle: input.quote.billingCycle,
    amountCents: input.quote.amountCents,
    periodMonths: input.quote.periodMonths,
    learnerLimit: input.quote.learnerLimit,
    modules: { ...input.quote.modules },
    legacyCapacityCode: input.quote.legacyCapacityCode,
    itemName: input.quote.itemName,
    createdAt: (input.createdAt || new Date()).toISOString(),
  };
}

export function readModularPaymentIntent(raw: unknown): ModularPaymentIntent | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (String(obj.checkoutKind || "").trim() !== MODULAR_CHECKOUT_KIND) return null;

  try {
    const quote = resolveModularCheckoutQuote({
      sku: obj.commercialSku || obj.sku || obj.packageCode,
      billingCycle: obj.billingCycle,
      clientAmountCents: obj.amountCents,
    });
    const schoolId = String(obj.schoolId || "").trim();
    if (!schoolId) return null;
    if (Number(obj.amountCents) !== quote.amountCents) return null;
    return buildModularPaymentIntent({ schoolId, quote });
  } catch {
    return null;
  }
}

export function isLegacyCapacityInitiationCode(raw: unknown): boolean {
  const key = String(raw || "")
    .trim()
    .toUpperCase();
  return key === "STARTER" || key === "UNLIMITED";
}

/**
 * Upgrade-only policy (no silent downgrade).
 * Same SKU → rejected. Target must appear in upgradeCodesFrom(current).
 */
export function assertModularUpgradeAllowed(input: {
  currentModules: CommercialPackageModules;
  targetSku: CommercialPackageCode;
  legacyPackageCode?: string | null;
}): void {
  const currentPkg = findCommercialPackageByModules(input.currentModules, {
    legacyPackageCode: input.legacyPackageCode,
  });
  if (!currentPkg) {
    throw new ModularCheckoutError(
      "Current school package entitlements are invalid",
      400,
      "INVALID_CURRENT_PACKAGE"
    );
  }
  if (currentPkg.code === input.targetSku) {
    throw new ModularCheckoutError(
      "School is already on this package",
      400,
      "SAME_PACKAGE"
    );
  }
  const allowed = upgradeCodesFrom(currentPkg.code);
  if (!allowed.includes(input.targetSku)) {
    throw new ModularCheckoutError(
      "Downgrades and lateral package changes require contacting EduClear",
      403,
      "DOWNGRADE_OR_LATERAL_BLOCKED"
    );
  }
}

export class ModularCheckoutError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = "ModularCheckoutError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export type ModularActivationPlan = {
  modules: CommercialPackageModules;
  learnerLimit: number | null;
  legacyCapacityCode: EduClearPackageCode;
  billingCycle: ModularBillingCycle;
  periodMonths: number;
  commercialSku: CommercialPackageCode;
  amountCents: number;
};

export function planModularActivationFromIntent(
  intent: ModularPaymentIntent
): ModularActivationPlan {
  const pkg = findCommercialPackageByCode(intent.commercialSku);
  if (!pkg) {
    throw new ModularCheckoutError("Unknown commercial package SKU", 400, "INVALID_SKU");
  }
  return {
    modules: { ...pkg.modules },
    learnerLimit: pkg.learnerLimit,
    legacyCapacityCode: legacyCapacityCodeForCommercialSku(pkg.code),
    billingCycle: intent.billingCycle,
    periodMonths: periodMonthsForCycle(intent.billingCycle),
    commercialSku: pkg.code,
    amountCents: intent.amountCents,
  };
}

/** Exact entitlement rows for a commercial SKU (single mapping SoT). */
export function entitlementPatchesForModules(
  modules: CommercialPackageModules
): Array<{ module: ProductModule; enabled: boolean }> {
  return [
    { module: ProductModule.CORE, enabled: modules.CORE === true },
    { module: ProductModule.ACCOUNTING, enabled: modules.ACCOUNTING === true },
    { module: ProductModule.PAYROLL, enabled: modules.PAYROLL === true },
  ];
}

export const PAYFAST_ITN_ENTITLEMENT_ACTOR = {
  userId: "system:payfast-modular-itn",
  email: "payfast-itn@educlear.internal",
} as const;

/**
 * Apply exact commercial module entitlements (authoritative overwrite of all three flags).
 * Safe for ITN — does not require Super Admin session.
 */
export async function applyExactCommercialModuleEntitlements(input: {
  schoolId: string;
  modules: CommercialPackageModules;
  tx?: Prisma.TransactionClient;
  actor?: { userId: string; email: string };
}): Promise<void> {
  const schoolId = String(input.schoolId || "").trim();
  if (!schoolId) {
    throw new ModularCheckoutError("Missing schoolId", 400, "MISSING_SCHOOL");
  }
  const actor = input.actor || PAYFAST_ITN_ENTITLEMENT_ACTOR;
  const db = input.tx;
  if (!db) {
    throw new ModularCheckoutError("Transaction client required", 500, "MISSING_TX");
  }
  const patches = entitlementPatchesForModules(input.modules);
  for (const patch of patches) {
    await db.schoolModuleEntitlement.upsert({
      where: {
        schoolId_module: { schoolId, module: patch.module },
      },
      create: {
        schoolId,
        module: patch.module,
        enabled: patch.enabled,
        updatedByUserId: actor.userId,
        updatedByEmail: actor.email,
      },
      update: {
        enabled: patch.enabled,
        updatedByUserId: actor.userId,
        updatedByEmail: actor.email,
      },
    });
  }
}

export function modularIntentAsJson(
  intent: ModularPaymentIntent
): Prisma.InputJsonValue {
  return { ...intent } as Prisma.InputJsonValue;
}
