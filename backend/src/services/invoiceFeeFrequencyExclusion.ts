import { prisma } from "../prisma";
import {
  DA_SILVA_BILLING_DATA_SCHOOL_ID,
  isDaSilvaSchoolId,
  refreshDaSilvaSchoolIdCache,
} from "./daSilvaSchoolResolve";
import { resolveFeeStructureType } from "./billingPlanRecurringGuard";
import type { StoredBillingPlanItem } from "../utils/learnerBillingPlanStore";
import { normalizeInvoicePeriod } from "../utils/billingLedgerStore";

/**
 * Fee-catalogue frequency / uiType values that omit specific calendar months
 * from monthly invoice runs. Exclusion uses the invoice *period* month
 * (YYYY-MM), never the run execution date.
 */
const EXCL_DEC = "MONTHLY_EXCL_DEC";
const EXCL_NOV_DEC = "MONTHLY_EXCL_NOV_DEC";

export type FeeFrequencyCatalogueEntry = {
  id: string;
  name: string;
  amount: number;
  type: string;
};

/**
 * Explicit school-scoped plan-description aliases.
 * - `single`: one canonical catalogue fee; exclude when that fee is period-excluded.
 * - `all`: every listed canonical fee must resolve and every one must be period-excluded
 *   (used for combined Aftercare/Intervention labels).
 * Prefer `feeStructureIds` when known; otherwise resolve `canonicalNames` by exact name.
 */
export type FeeExclusionAliasRule = {
  /** Normalised plan/extra description (lowercase, collapsed spaces). */
  description: string;
  mode: "single" | "all";
  /** Preferred stable catalogue ids (same order as canonicalNames when both set). */
  feeStructureIds?: readonly string[];
  /** Exact catalogue fee names (case-insensitive via normaliseName). */
  canonicalNames: readonly string[];
};

const MONEY_TOLERANCE = 0.01;

function normaliseName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function moneyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= MONEY_TOLERANCE;
}

function normaliseFeeType(type: unknown): string {
  return String(type ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

/**
 * Verified production catalogue names (Da Silva Academy, read-only 2026-11-16).
 * Plan descriptions often differ (e.g. AFTERCARE, 2026 Transport); aliases map to these.
 * feeStructureIds intentionally omitted until an approved production id lookup —
 * resolution uses exact canonical names (case-insensitive).
 */
export const DA_SILVA_PROD_CATALOGUE_NAMES = {
  aftercarePrimary: "Aftercare primary",
  aftercareHighSchool: "Aftercare High School",
  transport: "Transport",
  intervention: "Intervention",
} as const;

/**
 * Da Silva-only plan-description aliases aligned to live catalogue names.
 * - AFTERCARE (75 lines @ R550) → Aftercare primary (not a rename of plans)
 * - 2026 Transport → Transport (exact "Transport" already matches by name)
 * - Combined Aftercare/Intervention labels use mode "all" and require BOTH
 *   Aftercare primary and Intervention to be period-excluded
 * Engine never overrides catalogue frequency (Transport stays MONTHLY until
 * an approved catalogue change sets MONTHLY_EXCL_DEC).
 */
export const DA_SILVA_FEE_EXCLUSION_ALIASES: readonly FeeExclusionAliasRule[] = [
  {
    description: "aftercare",
    mode: "single",
    canonicalNames: [DA_SILVA_PROD_CATALOGUE_NAMES.aftercarePrimary],
  },
  {
    description: "2026 transport",
    mode: "single",
    canonicalNames: [DA_SILVA_PROD_CATALOGUE_NAMES.transport],
  },
  {
    description: "aftercare/intervention",
    mode: "all",
    canonicalNames: [
      DA_SILVA_PROD_CATALOGUE_NAMES.aftercarePrimary,
      DA_SILVA_PROD_CATALOGUE_NAMES.intervention,
    ],
  },
  {
    description: "aftercare/ intervention",
    mode: "all",
    canonicalNames: [
      DA_SILVA_PROD_CATALOGUE_NAMES.aftercarePrimary,
      DA_SILVA_PROD_CATALOGUE_NAMES.intervention,
    ],
  },
  {
    description: "intervention/aftercare",
    mode: "all",
    canonicalNames: [
      DA_SILVA_PROD_CATALOGUE_NAMES.aftercarePrimary,
      DA_SILVA_PROD_CATALOGUE_NAMES.intervention,
    ],
  },
  {
    description: "intervention/aftercare both",
    mode: "all",
    canonicalNames: [
      DA_SILVA_PROD_CATALOGUE_NAMES.aftercarePrimary,
      DA_SILVA_PROD_CATALOGUE_NAMES.intervention,
    ],
  },
  {
    description: "intervention compulsory",
    mode: "single",
    canonicalNames: [DA_SILVA_PROD_CATALOGUE_NAMES.intervention],
  },
  {
    description: "intervention - compulsory",
    mode: "single",
    canonicalNames: [DA_SILVA_PROD_CATALOGUE_NAMES.intervention],
  },
  {
    description: "intervention condition for all subjects",
    mode: "single",
    canonicalNames: [DA_SILVA_PROD_CATALOGUE_NAMES.intervention],
  },
  {
    description: "aftercare starting feb",
    mode: "single",
    canonicalNames: [DA_SILVA_PROD_CATALOGUE_NAMES.aftercarePrimary],
  },
] as const;

const ALIASES_BY_SCHOOL: Record<string, readonly FeeExclusionAliasRule[]> = {
  [DA_SILVA_BILLING_DATA_SCHOOL_ID]: DA_SILVA_FEE_EXCLUSION_ALIASES,
};

/** Calendar month (1–12) of a normalised invoice period, or 0 if unknown. */
export function invoicePeriodCalendarMonth(invoicePeriod: string): number {
  const period = normalizeInvoicePeriod(invoicePeriod);
  if (!/^\d{4}-\d{2}$/.test(period)) return 0;
  const month = Number(period.slice(5, 7));
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : 0;
}

/**
 * True when a fee catalogue type must not be charged for this billing period.
 * Unknown / blank types are never excluded (tuition-style MONTHLY stays billable).
 */
export function isFeeTypeExcludedForInvoicePeriod(
  feeType: unknown,
  invoicePeriod: string
): boolean {
  const type = normaliseFeeType(feeType);
  if (!type) return false;
  const month = invoicePeriodCalendarMonth(invoicePeriod);
  if (!month) return false;
  if (type === EXCL_DEC) return month === 12;
  if (type === EXCL_NOV_DEC) return month === 11 || month === 12;
  return false;
}

/** School-scoped alias rules (empty for schools without an allowlist). */
export function feeExclusionAliasesForSchool(schoolId: string): readonly FeeExclusionAliasRule[] {
  const key = String(schoolId || "").trim();
  if (!key) return [];
  if (ALIASES_BY_SCHOOL[key]) return ALIASES_BY_SCHOOL[key];
  // Live Da Silva row ids registered at runtime share the canonical allowlist.
  if (isDaSilvaSchoolId(key)) return DA_SILVA_FEE_EXCLUSION_ALIASES;
  return [];
}

export function findFeeExclusionAlias(
  schoolId: string,
  feeDescription: unknown
): FeeExclusionAliasRule | null {
  const description = normaliseName(feeDescription);
  if (!description) return null;
  return feeExclusionAliasesForSchool(schoolId).find((rule) => rule.description === description) || null;
}

/** Match a plan/extra line to a catalogue fee (id first, then unique name / amount). */
export function matchFeeFrequencyCatalogueEntry(
  item: StoredBillingPlanItem,
  catalogue: FeeFrequencyCatalogueEntry[]
): FeeFrequencyCatalogueEntry | null {
  const explicitId = String(item.feeStructureId || "").trim();
  if (explicitId) {
    const byId = catalogue.find((fee) => fee.id === explicitId);
    if (byId) return byId;
  }
  const name = normaliseName(item.feeDescription);
  if (!name) return null;
  const named = catalogue.filter((fee) => normaliseName(fee.name) === name);
  if (named.length === 1) return named[0];
  const amount = Number(item.amount) || 0;
  const sameAmount = named.filter((fee) => moneyEqual(Number(fee.amount) || 0, amount));
  return sameAmount.length === 1 ? sameAmount[0] : null;
}

/** Exact unique catalogue name only — no amount fallback (alias resolution). */
export function resolveCatalogueFeeByCanonicalName(
  canonicalName: string,
  catalogue: FeeFrequencyCatalogueEntry[]
): FeeFrequencyCatalogueEntry | null {
  const name = normaliseName(canonicalName);
  if (!name) return null;
  const named = catalogue.filter((fee) => normaliseName(fee.name) === name);
  return named.length === 1 ? named[0] : null;
}

export function resolveCatalogueFeeById(
  feeStructureId: string,
  catalogue: FeeFrequencyCatalogueEntry[]
): FeeFrequencyCatalogueEntry | null {
  const id = String(feeStructureId || "").trim();
  if (!id) return null;
  return catalogue.find((fee) => fee.id === id) || null;
}

/**
 * Resolve alias targets to catalogue fees.
 * Prefers feeStructureIds when present and found; otherwise exact canonical names.
 * Returns null if any required target cannot be resolved uniquely.
 */
export function resolveAliasCatalogueFees(
  rule: FeeExclusionAliasRule,
  catalogue: FeeFrequencyCatalogueEntry[]
): FeeFrequencyCatalogueEntry[] | null {
  const ids = rule.feeStructureIds || [];
  const names = rule.canonicalNames || [];
  const count = Math.max(ids.length, names.length);
  if (!count) return null;

  const resolved: FeeFrequencyCatalogueEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = ids[i];
    const name = names[i] || names[0];
    const byId = id ? resolveCatalogueFeeById(id, catalogue) : null;
    const fee = byId || (name ? resolveCatalogueFeeByCanonicalName(name, catalogue) : null);
    if (!fee) return null;
    resolved.push(fee);
  }
  return resolved;
}

/**
 * Whether an alias rule excludes the line for this period.
 * - single: the one resolved fee must be period-excluded
 * - all: every resolved fee must be period-excluded (combined Aftercare/Intervention)
 */
export function isAliasExcludedForInvoicePeriod(
  rule: FeeExclusionAliasRule,
  catalogue: FeeFrequencyCatalogueEntry[],
  invoicePeriod: string
): boolean {
  const fees = resolveAliasCatalogueFees(rule, catalogue);
  if (!fees || !fees.length) return false;
  const expected = Math.max(rule.canonicalNames.length, rule.feeStructureIds?.length || 0);
  if (fees.length < expected) return false;
  if (rule.mode === "all") {
    // Combined Aftercare/Intervention labels require every underlying fee to exclude the month.
    return fees.every((fee) => isFeeTypeExcludedForInvoicePeriod(fee.type, invoicePeriod));
  }
  return isFeeTypeExcludedForInvoicePeriod(fees[0].type, invoicePeriod);
}

function stampFeeStructureId(
  item: StoredBillingPlanItem,
  feeId: string
): StoredBillingPlanItem {
  if (item.feeStructureId) return item;
  return { ...item, feeStructureId: feeId };
}

function keepItemForPeriod(
  item: StoredBillingPlanItem,
  catalogue: FeeFrequencyCatalogueEntry[],
  invoicePeriod: string,
  schoolId: string
): StoredBillingPlanItem | null {
  const direct = matchFeeFrequencyCatalogueEntry(item, catalogue);
  if (direct) {
    if (isFeeTypeExcludedForInvoicePeriod(direct.type, invoicePeriod)) return null;
    return stampFeeStructureId(item, direct.id);
  }

  const alias = findFeeExclusionAlias(schoolId, item.feeDescription);
  if (!alias) return item;

  const resolved = resolveAliasCatalogueFees(alias, catalogue);
  if (!resolved || !resolved.length) return item;

  if (alias.mode === "all") {
    const expected = Math.max(alias.canonicalNames.length, alias.feeStructureIds?.length || 0);
    if (expected >= 2 && resolved.length < 2) return item;
    const allExcluded = resolved.every((fee) =>
      isFeeTypeExcludedForInvoicePeriod(fee.type, invoicePeriod)
    );
    if (allExcluded) return null;
    return item;
  }

  if (isFeeTypeExcludedForInvoicePeriod(resolved[0].type, invoicePeriod)) return null;
  return stampFeeStructureId(item, resolved[0].id);
}

/**
 * Drop recurring catalogue lines whose fee type excludes the invoice-period month.
 * Unmatched lines (custom descriptions) are kept unless an explicit school alias applies.
 * Preview and execute must both use this.
 */
export function applyFeeFrequencyExclusionGuard(input: {
  planItems: StoredBillingPlanItem[];
  extraFees?: StoredBillingPlanItem[] | null;
  catalogue: FeeFrequencyCatalogueEntry[];
  invoicePeriod: string;
  schoolId?: string;
}): { planItems: StoredBillingPlanItem[]; extraFees: StoredBillingPlanItem[] } {
  const catalogue = input.catalogue || [];
  if (!catalogue.length) {
    return {
      planItems: input.planItems || [],
      extraFees: input.extraFees || [],
    };
  }
  const schoolId = String(input.schoolId || "").trim();
  return {
    planItems: (input.planItems || [])
      .map((item) => keepItemForPeriod(item, catalogue, input.invoicePeriod, schoolId))
      .filter((item): item is StoredBillingPlanItem => Boolean(item)),
    extraFees: (input.extraFees || [])
      .map((item) => keepItemForPeriod(item, catalogue, input.invoicePeriod, schoolId))
      .filter((item): item is StoredBillingPlanItem => Boolean(item)),
  };
}

/** Active fee catalogue with resolved uiType / frequency (incl. MONTHLY_EXCL_*). */
export async function loadFeeFrequencyCatalogue(
  schoolId: string
): Promise<FeeFrequencyCatalogueEntry[]> {
  const key = String(schoolId || "").trim();
  if (!key) return [];
  const schoolIds = isDaSilvaSchoolId(key) ? await refreshDaSilvaSchoolIdCache() : [key];
  const fees = await prisma.feeStructure.findMany({
    where: { schoolId: { in: schoolIds }, isActive: true },
    select: { id: true, name: true, amount: true, frequency: true, grade: true },
  });
  return fees.map((fee) => ({
    id: fee.id,
    name: fee.name,
    amount: fee.amount,
    type: resolveFeeStructureType(fee),
  }));
}
