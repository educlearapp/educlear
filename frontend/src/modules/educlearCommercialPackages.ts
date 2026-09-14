/**
 * Canonical EduClear commercial package catalog (Phase 6C).
 *
 * Keep in sync with backend/src/services/educlearCommercialPackages.ts
 * (contract tests on both sides).
 *
 * Legacy STARTER / UNLIMITED are not new-sale SKUs.
 */

export type CommercialModuleBits = "100" | "010" | "001" | "011" | "110" | "101" | "111";

export type CommercialPackageCode =
  | "CORE"
  | "ACCOUNTING"
  | "PAYROLL"
  | "BUSINESS"
  | "CORE_ACCOUNTING"
  | "CORE_PAYROLL"
  | "FULL";

export type CommercialPackageModules = {
  CORE: boolean;
  ACCOUNTING: boolean;
  PAYROLL: boolean;
};

export type EduClearCommercialPackage = {
  bits: CommercialModuleBits;
  code: CommercialPackageCode;
  name: string;
  shortLabel: string;
  secondaryLabel: string | null;
  modules: CommercialPackageModules;
  monthlyPriceZar: number;
  annualPriceZar: number;
  description: string;
};

export const ANNUAL_MONTHS_PAID = 10;
export const ANNUAL_PROMOTION_COPY = "Pay annually and get 2 months free.";

export const EDUCLEAR_COMMERCIAL_PACKAGES: readonly EduClearCommercialPackage[] = [
  {
    bits: "100",
    code: "CORE",
    name: "EduClear Core",
    shortLabel: "Core",
    secondaryLabel: null,
    modules: { CORE: true, ACCOUNTING: false, PAYROLL: false },
    monthlyPriceZar: 1000,
    annualPriceZar: 10_000,
    description: "School administration + complete school-fee Billing.",
  },
  {
    bits: "010",
    code: "ACCOUNTING",
    name: "EduClear Accounting",
    shortLabel: "Accounting",
    secondaryLabel: null,
    modules: { CORE: false, ACCOUNTING: true, PAYROLL: false },
    monthlyPriceZar: 750,
    annualPriceZar: 7500,
    description: "Standalone Accounting.",
  },
  {
    bits: "001",
    code: "PAYROLL",
    name: "EduClear Payroll",
    shortLabel: "Payroll",
    secondaryLabel: null,
    modules: { CORE: false, ACCOUNTING: false, PAYROLL: true },
    monthlyPriceZar: 750,
    annualPriceZar: 7500,
    description: "Standalone Payroll + employee directory.",
  },
  {
    bits: "011",
    code: "BUSINESS",
    name: "EduClear Business",
    shortLabel: "Business",
    secondaryLabel: "Accounting + Payroll",
    modules: { CORE: false, ACCOUNTING: true, PAYROLL: true },
    monthlyPriceZar: 1250,
    annualPriceZar: 12_500,
    description: "Accounting + Payroll without school-management Core.",
  },
  {
    bits: "110",
    code: "CORE_ACCOUNTING",
    name: "EduClear Core + Accounting",
    shortLabel: "Core + Accounting",
    secondaryLabel: null,
    modules: { CORE: true, ACCOUNTING: true, PAYROLL: false },
    monthlyPriceZar: 1500,
    annualPriceZar: 15_000,
    description: "School administration, Billing, and Accounting.",
  },
  {
    bits: "101",
    code: "CORE_PAYROLL",
    name: "EduClear Core + Payroll",
    shortLabel: "Core + Payroll",
    secondaryLabel: null,
    modules: { CORE: true, ACCOUNTING: false, PAYROLL: true },
    monthlyPriceZar: 1500,
    annualPriceZar: 15_000,
    description: "School administration, Billing, and Payroll.",
  },
  {
    bits: "111",
    code: "FULL",
    name: "EduClear Full",
    shortLabel: "Full",
    secondaryLabel: null,
    modules: { CORE: true, ACCOUNTING: true, PAYROLL: true },
    monthlyPriceZar: 2000,
    annualPriceZar: 20_000,
    description: "Complete EduClear platform.",
  },
] as const;

export const LEGACY_CAPACITY_PACKAGE_CODES = ["STARTER", "UNLIMITED"] as const;

export type BillingInterval = "monthly" | "annual";

/** Feature matrix rows for package comparison UI. */
export type PackageComparisonRow = {
  feature: string;
  group: "Core" | "Accounting" | "Payroll" | "Conditional";
  /** Which packages include this feature (by commercial code). */
  includedIn: ReadonlyArray<CommercialPackageCode>;
  note?: string;
};

export const PACKAGE_COMPARISON_ROWS: readonly PackageComparisonRow[] = [
  {
    feature: "Learners",
    group: "Core",
    includedIn: ["CORE", "CORE_ACCOUNTING", "CORE_PAYROLL", "FULL"],
  },
  {
    feature: "Parents/Guardians",
    group: "Core",
    includedIn: ["CORE", "CORE_ACCOUNTING", "CORE_PAYROLL", "FULL"],
  },
  {
    feature: "Admissions",
    group: "Core",
    includedIn: ["CORE", "CORE_ACCOUNTING", "CORE_PAYROLL", "FULL"],
  },
  {
    feature: "Attendance",
    group: "Core",
    includedIn: ["CORE", "CORE_ACCOUNTING", "CORE_PAYROLL", "FULL"],
  },
  {
    feature: "EduClock",
    group: "Core",
    includedIn: ["CORE", "CORE_ACCOUNTING", "CORE_PAYROLL", "FULL"],
  },
  {
    feature: "Parent Portal",
    group: "Core",
    includedIn: ["CORE", "CORE_ACCOUNTING", "CORE_PAYROLL", "FULL"],
  },
  {
    feature: "Communications",
    group: "Core",
    includedIn: ["CORE", "CORE_ACCOUNTING", "CORE_PAYROLL", "FULL"],
  },
  {
    feature: "Reports/Registers",
    group: "Core",
    includedIn: ["CORE", "CORE_ACCOUNTING", "CORE_PAYROLL", "FULL"],
  },
  {
    feature: "Complete school-fee Billing",
    group: "Core",
    includedIn: ["CORE", "CORE_ACCOUNTING", "CORE_PAYROLL", "FULL"],
    note: "Billing is a Core feature — not Accounting.",
  },
  {
    feature: "Fee Banking",
    group: "Core",
    includedIn: ["CORE", "CORE_ACCOUNTING", "CORE_PAYROLL", "FULL"],
  },
  {
    feature: "GL / Chart of Accounts",
    group: "Accounting",
    includedIn: ["ACCOUNTING", "BUSINESS", "CORE_ACCOUNTING", "FULL"],
  },
  {
    feature: "Suppliers / Expenses / Journals",
    group: "Accounting",
    includedIn: ["ACCOUNTING", "BUSINESS", "CORE_ACCOUNTING", "FULL"],
  },
  {
    feature: "Assets / Budgets",
    group: "Accounting",
    includedIn: ["ACCOUNTING", "BUSINESS", "CORE_ACCOUNTING", "FULL"],
  },
  {
    feature: "Financial Statements & Accounting Reports",
    group: "Accounting",
    includedIn: ["ACCOUNTING", "BUSINESS", "CORE_ACCOUNTING", "FULL"],
  },
  {
    feature: "Accounting Banking",
    group: "Accounting",
    includedIn: ["ACCOUNTING", "BUSINESS", "CORE_ACCOUNTING", "FULL"],
  },
  {
    feature: "Employees",
    group: "Conditional",
    includedIn: ["CORE", "PAYROLL", "BUSINESS", "CORE_ACCOUNTING", "CORE_PAYROLL", "FULL"],
    note: "Available with Core OR Payroll.",
  },
  {
    feature: "Payroll runs / Payslips / Payroll reports",
    group: "Payroll",
    includedIn: ["PAYROLL", "BUSINESS", "CORE_PAYROLL", "FULL"],
  },
  {
    feature: "Banking (fee or accounting)",
    group: "Conditional",
    includedIn: ["CORE", "ACCOUNTING", "BUSINESS", "CORE_ACCOUNTING", "CORE_PAYROLL", "FULL"],
    note: "Available with Core OR Accounting.",
  },
  {
    feature: "EduClock → Payroll",
    group: "Conditional",
    includedIn: ["CORE_PAYROLL", "FULL"],
    note: "Requires Core AND Payroll.",
  },
  {
    feature: "Debtors Ageing",
    group: "Conditional",
    includedIn: ["CORE_ACCOUNTING", "FULL"],
    note: "Requires Core AND Accounting.",
  },
] as const;

export function modulesToBits(modules: CommercialPackageModules): CommercialModuleBits | "000" {
  const c = modules.CORE === true ? "1" : "0";
  const a = modules.ACCOUNTING === true ? "1" : "0";
  const p = modules.PAYROLL === true ? "1" : "0";
  return `${c}${a}${p}` as CommercialModuleBits | "000";
}

export function findCommercialPackageByBits(
  bits: string
): EduClearCommercialPackage | null {
  const key = String(bits || "").trim();
  if (key === "000") return null;
  return EDUCLEAR_COMMERCIAL_PACKAGES.find((pkg) => pkg.bits === key) ?? null;
}

export function findCommercialPackageByCode(
  code: string
): EduClearCommercialPackage | null {
  const key = String(code || "").trim().toUpperCase();
  return EDUCLEAR_COMMERCIAL_PACKAGES.find((pkg) => pkg.code === key) ?? null;
}

export function findCommercialPackageByModules(
  modules: CommercialPackageModules
): EduClearCommercialPackage | null {
  const bits = modulesToBits(modules);
  if (bits === "000") return null;
  return findCommercialPackageByBits(bits);
}

export function commercialPackageShortDisplay(
  modules: CommercialPackageModules,
  opts?: { includeSecondary?: boolean }
): string {
  const pkg = findCommercialPackageByModules(modules);
  if (!pkg) return "Invalid / No modules";
  if (opts?.includeSecondary && pkg.secondaryLabel) {
    return `${pkg.shortLabel} / ${pkg.secondaryLabel}`;
  }
  return pkg.shortLabel;
}

export function formatCommercialPriceZar(
  amountZar: number,
  interval: BillingInterval
): string {
  const formatted = `R${amountZar.toLocaleString("en-US")}`;
  return interval === "annual" ? `${formatted} / year` : `${formatted} / month`;
}

export function formatCommercialPackagePrice(
  pkg: EduClearCommercialPackage,
  interval: BillingInterval = "monthly"
): string {
  const amount = interval === "annual" ? pkg.annualPriceZar : pkg.monthlyPriceZar;
  return formatCommercialPriceZar(amount, interval);
}

export function upgradeCodesFrom(code: CommercialPackageCode): CommercialPackageCode[] {
  switch (code) {
    case "CORE":
      return ["CORE_ACCOUNTING", "CORE_PAYROLL", "FULL"];
    case "ACCOUNTING":
      return ["BUSINESS", "CORE_ACCOUNTING", "FULL"];
    case "PAYROLL":
      return ["BUSINESS", "CORE_PAYROLL", "FULL"];
    case "BUSINESS":
      return ["CORE_ACCOUNTING", "CORE_PAYROLL", "FULL"];
    case "CORE_ACCOUNTING":
      return ["FULL"];
    case "CORE_PAYROLL":
      return ["FULL"];
    case "FULL":
      return [];
    default:
      return [];
  }
}

export function upgradePackagesFrom(
  modules: CommercialPackageModules
): EduClearCommercialPackage[] {
  const current = findCommercialPackageByModules(modules);
  if (!current) return [];
  return upgradeCodesFrom(current.code)
    .map((code) => findCommercialPackageByCode(code))
    .filter((pkg): pkg is EduClearCommercialPackage => Boolean(pkg));
}

export function isLegacyCapacityPackageCode(code: string | null | undefined): boolean {
  const key = String(code || "").trim().toUpperCase();
  return (LEGACY_CAPACITY_PACKAGE_CODES as readonly string[]).includes(key);
}

export function listNewSaleCommercialPackages(): EduClearCommercialPackage[] {
  return [...EDUCLEAR_COMMERCIAL_PACKAGES];
}

export function assertAnnualEqualsTenMonths(pkg: EduClearCommercialPackage): boolean {
  return pkg.annualPriceZar === pkg.monthlyPriceZar * ANNUAL_MONTHS_PAID;
}

export function packageIncludesFeature(
  pkg: EduClearCommercialPackage,
  row: PackageComparisonRow
): boolean {
  return row.includedIn.includes(pkg.code);
}
