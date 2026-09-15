/**
 * Canonical EduClear commercial package catalog.
 *
 * Keep in sync with backend/src/services/educlearCommercialPackages.ts
 * (contract tests on both sides).
 *
 * Legacy STARTER / UNLIMITED are not new-sale SKUs.
 * STARTER → Full ≤100 capacity; UNLIMITED → Full Unlimited capacity.
 */

export type CommercialModuleBits = "100" | "010" | "001" | "011" | "110" | "101" | "111";

export type CommercialPackageCode =
  | "CORE"
  | "ACCOUNTING"
  | "PAYROLL"
  | "BUSINESS"
  | "CORE_ACCOUNTING"
  | "CORE_PAYROLL"
  | "FULL_100"
  | "FULL_UNLIMITED";

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
  learnerLimit: number | null;
};

export const ANNUAL_MONTHS_PAID = 10;
export const ANNUAL_PROMOTION_COPY = "Pay annually and get 2 months free.";

const FULL_MODULES: CommercialPackageModules = {
  CORE: true,
  ACCOUNTING: true,
  PAYROLL: true,
};

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
    learnerLimit: null,
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
    learnerLimit: null,
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
    learnerLimit: null,
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
    learnerLimit: null,
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
    learnerLimit: null,
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
    learnerLimit: null,
  },
  {
    bits: "111",
    code: "FULL_100",
    name: "EduClear Full ≤100 learners",
    shortLabel: "Full ≤100",
    secondaryLabel: "Up to 100 learners",
    modules: { ...FULL_MODULES },
    monthlyPriceZar: 1500,
    annualPriceZar: 15_000,
    description: "Complete EduClear platform for up to 100 active learners.",
    learnerLimit: 100,
  },
  {
    bits: "111",
    code: "FULL_UNLIMITED",
    name: "EduClear Full Unlimited",
    shortLabel: "Full Unlimited",
    secondaryLabel: "Unlimited learners",
    modules: { ...FULL_MODULES },
    monthlyPriceZar: 2000,
    annualPriceZar: 20_000,
    description: "Complete EduClear platform with unlimited active learners.",
    learnerLimit: null,
  },
] as const;

export const LEGACY_CAPACITY_PACKAGE_CODES = ["STARTER", "UNLIMITED"] as const;

export type BillingInterval = "monthly" | "annual";
export type FullCapacityCode = "FULL_100" | "FULL_UNLIMITED";

/** Feature matrix rows for package comparison UI. */
export type PackageComparisonRow = {
  feature: string;
  group: "Core" | "Accounting" | "Payroll" | "Conditional";
  includedIn: ReadonlyArray<CommercialPackageCode>;
  note?: string;
};

const FULL_CODES: CommercialPackageCode[] = ["FULL_100", "FULL_UNLIMITED"];

export const PACKAGE_COMPARISON_ROWS: readonly PackageComparisonRow[] = [
  {
    feature: "Learners",
    group: "Core",
    includedIn: ["CORE", "CORE_ACCOUNTING", "CORE_PAYROLL", ...FULL_CODES],
  },
  {
    feature: "Parents/Guardians",
    group: "Core",
    includedIn: ["CORE", "CORE_ACCOUNTING", "CORE_PAYROLL", ...FULL_CODES],
  },
  {
    feature: "Admissions",
    group: "Core",
    includedIn: ["CORE", "CORE_ACCOUNTING", "CORE_PAYROLL", ...FULL_CODES],
  },
  {
    feature: "Attendance",
    group: "Core",
    includedIn: ["CORE", "CORE_ACCOUNTING", "CORE_PAYROLL", ...FULL_CODES],
  },
  {
    feature: "EduClock",
    group: "Core",
    includedIn: ["CORE", "CORE_ACCOUNTING", "CORE_PAYROLL", ...FULL_CODES],
  },
  {
    feature: "Parent Portal",
    group: "Core",
    includedIn: ["CORE", "CORE_ACCOUNTING", "CORE_PAYROLL", ...FULL_CODES],
  },
  {
    feature: "Communications",
    group: "Core",
    includedIn: ["CORE", "CORE_ACCOUNTING", "CORE_PAYROLL", ...FULL_CODES],
  },
  {
    feature: "Reports/Registers",
    group: "Core",
    includedIn: ["CORE", "CORE_ACCOUNTING", "CORE_PAYROLL", ...FULL_CODES],
  },
  {
    feature: "Complete school-fee Billing",
    group: "Core",
    includedIn: ["CORE", "CORE_ACCOUNTING", "CORE_PAYROLL", ...FULL_CODES],
    note: "Billing is a Core feature — not Accounting.",
  },
  {
    feature: "Fee Banking",
    group: "Core",
    includedIn: ["CORE", "CORE_ACCOUNTING", "CORE_PAYROLL", ...FULL_CODES],
  },
  {
    feature: "GL / Chart of Accounts",
    group: "Accounting",
    includedIn: ["ACCOUNTING", "BUSINESS", "CORE_ACCOUNTING", ...FULL_CODES],
  },
  {
    feature: "Suppliers / Expenses / Journals",
    group: "Accounting",
    includedIn: ["ACCOUNTING", "BUSINESS", "CORE_ACCOUNTING", ...FULL_CODES],
  },
  {
    feature: "Assets / Budgets",
    group: "Accounting",
    includedIn: ["ACCOUNTING", "BUSINESS", "CORE_ACCOUNTING", ...FULL_CODES],
  },
  {
    feature: "Financial Statements & Accounting Reports",
    group: "Accounting",
    includedIn: ["ACCOUNTING", "BUSINESS", "CORE_ACCOUNTING", ...FULL_CODES],
  },
  {
    feature: "Accounting Banking",
    group: "Accounting",
    includedIn: ["ACCOUNTING", "BUSINESS", "CORE_ACCOUNTING", ...FULL_CODES],
  },
  {
    feature: "Employees",
    group: "Conditional",
    includedIn: [
      "CORE",
      "PAYROLL",
      "BUSINESS",
      "CORE_ACCOUNTING",
      "CORE_PAYROLL",
      ...FULL_CODES,
    ],
    note: "Available with Core OR Payroll.",
  },
  {
    feature: "Payroll runs / Payslips / Payroll reports",
    group: "Payroll",
    includedIn: ["PAYROLL", "BUSINESS", "CORE_PAYROLL", ...FULL_CODES],
  },
  {
    feature: "Banking (fee or accounting)",
    group: "Conditional",
    includedIn: [
      "CORE",
      "ACCOUNTING",
      "BUSINESS",
      "CORE_ACCOUNTING",
      "CORE_PAYROLL",
      ...FULL_CODES,
    ],
    note: "Available with Core OR Accounting.",
  },
  {
    feature: "EduClock → Payroll",
    group: "Conditional",
    includedIn: ["CORE_PAYROLL", ...FULL_CODES],
    note: "Requires Core AND Payroll.",
  },
  {
    feature: "Debtors Ageing",
    group: "Conditional",
    includedIn: ["CORE_ACCOUNTING", ...FULL_CODES],
    note: "Requires Core AND Accounting.",
  },
] as const;

export function mapLegacyCapacityToFullCode(
  legacyPackageCode: string | null | undefined
): FullCapacityCode {
  const key = String(legacyPackageCode || "")
    .trim()
    .toUpperCase();
  if (key === "STARTER") return "FULL_100";
  return "FULL_UNLIMITED";
}

export function modulesToBits(modules: CommercialPackageModules): CommercialModuleBits | "000" {
  const c = modules.CORE === true ? "1" : "0";
  const a = modules.ACCOUNTING === true ? "1" : "0";
  const p = modules.PAYROLL === true ? "1" : "0";
  return `${c}${a}${p}` as CommercialModuleBits | "000";
}

export function isFullModules(modules: CommercialPackageModules): boolean {
  return modules.CORE === true && modules.ACCOUNTING === true && modules.PAYROLL === true;
}

export function findCommercialPackageByCode(
  code: string
): EduClearCommercialPackage | null {
  const key = String(code || "").trim().toUpperCase();
  if (key === "FULL") {
    return EDUCLEAR_COMMERCIAL_PACKAGES.find((pkg) => pkg.code === "FULL_UNLIMITED") ?? null;
  }
  return EDUCLEAR_COMMERCIAL_PACKAGES.find((pkg) => pkg.code === key) ?? null;
}

export function findCommercialPackageByBits(
  bits: string,
  opts?: { fullCapacityCode?: FullCapacityCode | null; legacyPackageCode?: string | null }
): EduClearCommercialPackage | null {
  const key = String(bits || "").trim();
  if (key === "000") return null;
  if (key !== "111") {
    return EDUCLEAR_COMMERCIAL_PACKAGES.find((pkg) => pkg.bits === key) ?? null;
  }
  const fullCode =
    opts?.fullCapacityCode || mapLegacyCapacityToFullCode(opts?.legacyPackageCode);
  return findCommercialPackageByCode(fullCode);
}

export function findCommercialPackageByModules(
  modules: CommercialPackageModules,
  opts?: { fullCapacityCode?: FullCapacityCode | null; legacyPackageCode?: string | null }
): EduClearCommercialPackage | null {
  const bits = modulesToBits(modules);
  if (bits === "000") return null;
  return findCommercialPackageByBits(bits, opts);
}

export function commercialPackageShortDisplay(
  modules: CommercialPackageModules,
  opts?: {
    includeSecondary?: boolean;
    legacyPackageCode?: string | null;
    fullCapacityCode?: FullCapacityCode | null;
  }
): string {
  const pkg = findCommercialPackageByModules(modules, opts);
  if (!pkg) return "Invalid / No modules";
  if (opts?.includeSecondary && pkg.secondaryLabel) {
    return `${pkg.shortLabel} / ${pkg.secondaryLabel}`;
  }
  return pkg.shortLabel;
}

export function formatLearnerCapacityLabel(learnerLimit: number | null | undefined): string {
  if (learnerLimit == null) return "Unlimited";
  const n = Number(learnerLimit);
  if (!Number.isFinite(n) || n <= 0) return "Unlimited";
  return `Up to ${Math.trunc(n)} learners`;
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

export function upgradeCodesFrom(code: CommercialPackageCode | "FULL"): CommercialPackageCode[] {
  const normalized = code === "FULL" ? "FULL_UNLIMITED" : code;
  switch (normalized) {
    case "CORE":
      return ["CORE_ACCOUNTING", "CORE_PAYROLL", "FULL_100", "FULL_UNLIMITED"];
    case "ACCOUNTING":
      return ["BUSINESS", "CORE_ACCOUNTING", "FULL_100", "FULL_UNLIMITED"];
    case "PAYROLL":
      return ["BUSINESS", "CORE_PAYROLL", "FULL_100", "FULL_UNLIMITED"];
    case "BUSINESS":
      return ["FULL_100", "FULL_UNLIMITED"];
    case "CORE_ACCOUNTING":
      return ["FULL_100", "FULL_UNLIMITED"];
    case "CORE_PAYROLL":
      return ["FULL_100", "FULL_UNLIMITED"];
    case "FULL_100":
      return ["FULL_UNLIMITED"];
    case "FULL_UNLIMITED":
      return [];
    default:
      return [];
  }
}

export function upgradePackagesFrom(
  modules: CommercialPackageModules,
  opts?: { legacyPackageCode?: string | null; fullCapacityCode?: FullCapacityCode | null }
): EduClearCommercialPackage[] {
  const current = findCommercialPackageByModules(modules, opts);
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
