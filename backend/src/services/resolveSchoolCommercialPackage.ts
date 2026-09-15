/**
 * Resolve a school's current commercial package from module entitlements.
 * Never from legacy STARTER/UNLIMITED capacity codes.
 */
import {
  type EduClearCommercialPackage,
  findCommercialPackageByModules,
  formatCommercialPackagePrice,
  modulesToBits,
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
    modules: { ...pkg.modules },
  };
}

export function commercialPackageFromEntitlements(
  entitlements: SchoolModuleEntitlementsMap
): CommercialPackageApiPayload | null {
  const pkg = findCommercialPackageByModules(entitlements);
  if (!pkg) return null;
  return serializeCommercialPackage(pkg);
}

export async function resolveSchoolCommercialPackage(
  schoolId: string
): Promise<{
  moduleEntitlements: SchoolModuleEntitlementsMap;
  commercialPackage: CommercialPackageApiPayload | null;
  bits: string;
}> {
  const moduleEntitlements = await getSchoolModuleEntitlements(schoolId);
  const bits = modulesToBits(moduleEntitlements);
  return {
    moduleEntitlements,
    commercialPackage: commercialPackageFromEntitlements(moduleEntitlements),
    bits,
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
}> {
  const moduleEntitlements = await getSchoolModuleEntitlementsReadOnly(schoolId);
  const bits = modulesToBits(moduleEntitlements);
  return {
    moduleEntitlements,
    commercialPackage: commercialPackageFromEntitlements(moduleEntitlements),
    bits,
  };
}
