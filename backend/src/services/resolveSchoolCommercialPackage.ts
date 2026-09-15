/**
 * Resolve a school's current commercial package from module entitlements
 * plus legacy STARTER/UNLIMITED capacity (Full ≤100 vs Full Unlimited).
 * Feature gating must use module entitlements — never package-name checks.
 */
import { prisma } from "../prisma";
import {
  findCommercialPackageByModules,
  formatCommercialPackagePrice,
  formatLearnerCapacityLabel,
  modulesToBits,
  type EduClearCommercialPackage,
} from "./educlearCommercialPackages";
import {
  getSchoolModuleEntitlements,
  getSchoolModuleEntitlementsReadOnly,
  type SchoolModuleEntitlementsMap,
} from "./schoolModuleEntitlements";

export type CommercialPackageApiPayload = {
  bits: string;
  code: string;
  name: string;
  shortLabel: string;
  secondaryLabel: string | null;
  description: string;
  monthlyPriceZar: number;
  annualPriceZar: number;
  monthlyPriceCents: number;
  priceLabelMonthly: string;
  priceLabelAnnual: string;
  learnerLimit: number | null;
  learnerCapacityLabel: string;
  modules: SchoolModuleEntitlementsMap;
};

export function serializeCommercialPackage(
  pkg: EduClearCommercialPackage
): CommercialPackageApiPayload {
  return {
    bits: pkg.bits,
    code: pkg.code,
    name: pkg.name,
    shortLabel: pkg.shortLabel,
    secondaryLabel: pkg.secondaryLabel,
    description: pkg.description,
    monthlyPriceZar: pkg.monthlyPriceZar,
    annualPriceZar: pkg.annualPriceZar,
    monthlyPriceCents: pkg.monthlyPriceZar * 100,
    priceLabelMonthly: formatCommercialPackagePrice(pkg, "monthly"),
    priceLabelAnnual: formatCommercialPackagePrice(pkg, "annual"),
    learnerLimit: pkg.learnerLimit,
    learnerCapacityLabel: formatLearnerCapacityLabel(pkg.learnerLimit),
    modules: { ...pkg.modules },
  };
}

export function commercialPackageFromEntitlements(
  entitlements: SchoolModuleEntitlementsMap,
  legacyPackageCode?: string | null
): CommercialPackageApiPayload | null {
  const pkg = findCommercialPackageByModules(entitlements, {
    legacyPackageCode,
  });
  if (!pkg) return null;
  return serializeCommercialPackage(pkg);
}

async function loadLegacyCapacityCode(schoolId: string): Promise<string | null> {
  const sub = await prisma.schoolSubscription.findUnique({
    where: { schoolId },
    select: { packageCode: true },
  });
  return sub?.packageCode ? String(sub.packageCode) : null;
}

export async function resolveSchoolCommercialPackage(
  schoolId: string
): Promise<{
  moduleEntitlements: SchoolModuleEntitlementsMap;
  commercialPackage: CommercialPackageApiPayload | null;
  bits: string;
  legacyCapacityPackageCode: string | null;
}> {
  const moduleEntitlements = await getSchoolModuleEntitlements(schoolId);
  const legacyCapacityPackageCode = await loadLegacyCapacityCode(schoolId);
  const bits = modulesToBits(moduleEntitlements);
  return {
    moduleEntitlements,
    commercialPackage: commercialPackageFromEntitlements(
      moduleEntitlements,
      legacyCapacityPackageCode
    ),
    bits,
    legacyCapacityPackageCode,
  };
}

/**
 * Read-only commercial resolve for GET status surfaces.
 * Uses fail-open missing-row semantics without writing entitlement rows.
 */
export async function resolveSchoolCommercialPackageReadOnly(
  schoolId: string
): Promise<{
  moduleEntitlements: SchoolModuleEntitlementsMap;
  commercialPackage: CommercialPackageApiPayload | null;
  bits: string;
  legacyCapacityPackageCode: string | null;
}> {
  const moduleEntitlements = await getSchoolModuleEntitlementsReadOnly(schoolId);
  const legacyCapacityPackageCode = await loadLegacyCapacityCode(schoolId);
  const bits = modulesToBits(moduleEntitlements);
  return {
    moduleEntitlements,
    commercialPackage: commercialPackageFromEntitlements(
      moduleEntitlements,
      legacyCapacityPackageCode
    ),
    bits,
    legacyCapacityPackageCode,
  };
}
