/**
 * School product module entitlements (CORE / ACCOUNTING / PAYROLL).
 * Orthogonal to RBAC permissions and STARTER/UNLIMITED capacity packages.
 *
 * Rollout-safe default: missing/invalid data → all modules enabled (matches backend fail-open).
 * Explicit false is preserved (including CORE=false).
 * Entitlements are bound to schoolId so login/school switch cannot reuse another tenant’s cache.
 *
 * Phase 5C: page gates mirror backend — CORE pages, ACCOUNTING pages, PAYROLL pages,
 * Employees = CORE||PAYROLL, Banking = CORE||ACCOUNTING. Shared platform pages are ungated.
 */
export type ProductModuleKey = "CORE" | "ACCOUNTING" | "PAYROLL";

export type SchoolModuleEntitlements = {
  CORE: boolean;
  ACCOUNTING: boolean;
  PAYROLL: boolean;
};

export const DEFAULT_SCHOOL_MODULE_ENTITLEMENTS: SchoolModuleEntitlements = {
  CORE: true,
  ACCOUNTING: true,
  PAYROLL: true,
};

export const SCHOOL_MODULE_ENTITLEMENTS_STORAGE_KEY = "schoolModuleEntitlements";
export const SCHOOL_MODULE_ENTITLEMENTS_SCHOOL_ID_KEY = "schoolModuleEntitlementsSchoolId";

/** Shared platform — available for any valid commercial package (no module gate). */
export const SHARED_PLATFORM_PAGES = [
  "schoolProfile",
  "schoolPackage",
  "schoolCredits",
  "schoolUsers",
  "schoolSettings",
  "help",
] as const;

/**
 * Safe standalone Accounting bookkeeping (no learner / FamilyAccount / school-fee dependency).
 * Visible for Accounting-only tenants.
 */
export const ACCOUNTING_SAFE_STANDALONE_PAGES = [
  "accountingOverview",
  "accountingExpenses",
  "accountingSuppliers",
  "accountingAssets",
  "accountingJournals",
  "accountingGeneralLedger",
  "accountingChartOfAccounts",
  "accountingBudget",
  "accountingCreditorsAgeing",
  "accountingSupplierInvoices",
  "accountingSettings",
] as const;

/**
 * Accounting pages that still pull Core billing / learners.
 * Require CORE && ACCOUNTING until Phase 5D repairs them for Core-off.
 */
export const ACCOUNTING_CORE_DEPENDENT_PAGES = [
  "accountingFinancialStatements",
  "accountingReports",
  "accountingDebtorsAgeing",
  "accountingAuditCompliance",
  "accountingExportCenter",
] as const;

/** All ACCOUNTING-gated bookkeeping pages (safe + Core-dependent). Banking is separate. */
export const ACCOUNTING_ONLY_PAGES = [
  ...ACCOUNTING_SAFE_STANDALONE_PAGES,
  ...ACCOUNTING_CORE_DEPENDENT_PAGES,
] as const;

/** Pages that require PAYROLL. */
export const PAYROLL_ONLY_PAGES = ["payroll"] as const;

/** Employees directory — CORE || PAYROLL. */
export const EMPLOYEES_ANY_MODULE_PAGES = ["employees", "employeeManage"] as const;

/** Banking — CORE || ACCOUNTING. */
export const BANKING_ANY_MODULE_PAGES = ["bankStatementImport", "accountingBanking"] as const;

/**
 * Core-owned school surfaces (learners, billing, attendance, EduClock, communications, etc.).
 * Pages not listed here may still be CORE via default in schoolPageModuleRequirement.
 */
export const CORE_OWNED_PAGES = [
  "dashboard",
  "registrations",
  "sasamsReportUpload",
  "parentPortal",
  "teacherInbox",
  "learnerProfile",
  "addLearner",
  "classrooms",
  "classroomManage",
  "groups",
  "groupManage",
  "teacherPerformance",
  "attendance",
  "attendanceManage",
  "attendanceReports",
  "homesafe",
  "incidents",
  "incidentManage",
  "lists",
  "forms",
  "more",
  "statements",
  "statementManage",
  "invoices",
  "invoiceCreate",
  "payments",
  "paymentCreate",
  "educlock",
  "fees",
  "feeUpsert",
  "plans",
  "runs",
  "reports",
  "outstandingAccounts",
  "financeHub",
  "financeCollections",
  "documents",
  "billing-help",
  "billing-more",
  "billingDeposits",
  "billingSettings",
  "communicationEmail",
  "communicationSms",
  "communicationSettings",
  "communicationCentre",
  "admissionsSettings",
  "admissions",
  "admissionsDetail",
] as const;

export type SchoolPageModuleRequirement =
  | { kind: "single"; module: ProductModuleKey }
  | { kind: "any"; modules: readonly ProductModuleKey[] }
  | { kind: "all"; modules: readonly ProductModuleKey[] };

/**
 * Normalize entitlement payload.
 * Missing/invalid object → Full (fail-open).
 * Explicit false for any module (including CORE) is preserved.
 * Missing keys inside a valid object fail-open to true.
 */
export function asSchoolModuleEntitlements(
  raw: unknown
): SchoolModuleEntitlements {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_SCHOOL_MODULE_ENTITLEMENTS };
  }
  const o = raw as Record<string, unknown>;
  return {
    CORE: o.CORE !== false,
    ACCOUNTING: o.ACCOUNTING !== false,
    PAYROLL: o.PAYROLL !== false,
  };
}

export function hasAnyCommercialModule(entitlements: SchoolModuleEntitlements): boolean {
  return (
    entitlements.CORE !== false ||
    entitlements.ACCOUNTING !== false ||
    entitlements.PAYROLL !== false
  );
}

export function getEntitlementBoundSchoolId(): string {
  try {
    return String(localStorage.getItem(SCHOOL_MODULE_ENTITLEMENTS_SCHOOL_ID_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function getSchoolModuleEntitlements(
  forSchoolId?: string | null
): SchoolModuleEntitlements {
  try {
    const boundSchoolId = getEntitlementBoundSchoolId();
    const want = String(forSchoolId || "").trim();
    if (want && boundSchoolId && want !== boundSchoolId) {
      // Do not reuse another school’s cached modules.
      return { ...DEFAULT_SCHOOL_MODULE_ENTITLEMENTS };
    }
    const raw = localStorage.getItem(SCHOOL_MODULE_ENTITLEMENTS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SCHOOL_MODULE_ENTITLEMENTS };
    return asSchoolModuleEntitlements(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SCHOOL_MODULE_ENTITLEMENTS };
  }
}

export function setSchoolModuleEntitlements(
  next: SchoolModuleEntitlements,
  schoolId?: string | null
): void {
  const normalised = asSchoolModuleEntitlements(next);
  localStorage.setItem(SCHOOL_MODULE_ENTITLEMENTS_STORAGE_KEY, JSON.stringify(normalised));
  const sid = String(schoolId || "").trim();
  if (sid) {
    localStorage.setItem(SCHOOL_MODULE_ENTITLEMENTS_SCHOOL_ID_KEY, sid);
  }
}

export function clearSchoolModuleEntitlements(): void {
  localStorage.removeItem(SCHOOL_MODULE_ENTITLEMENTS_STORAGE_KEY);
  localStorage.removeItem(SCHOOL_MODULE_ENTITLEMENTS_SCHOOL_ID_KEY);
}

function extractAuthSchoolId(data: unknown): string {
  const root = data !== null && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const user = root?.user !== null && typeof root?.user === "object" ? (root!.user as Record<string, unknown>) : null;
  const school =
    root?.school !== null && typeof root?.school === "object" ? (root!.school as Record<string, unknown>) : null;
  return String(user?.schoolId || school?.id || root?.schoolId || "").trim();
}

/**
 * Persist entitlements from login /auth/me.
 * Always binds to the auth schoolId. Successful payloads overwrite cache.
 * Missing moduleEntitlements on a school change resets to fail-open defaults for that school
 * (never keeps the previous school’s flags).
 */
export function syncSchoolModuleEntitlementsFromAuthResponse(data: unknown): SchoolModuleEntitlements {
  const root = data !== null && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const user = root?.user !== null && typeof root?.user === "object" ? (root!.user as Record<string, unknown>) : null;
  const school =
    root?.school !== null && typeof root?.school === "object" ? (root!.school as Record<string, unknown>) : null;

  const schoolId = extractAuthSchoolId(data);
  const raw =
    root?.moduleEntitlements ??
    user?.moduleEntitlements ??
    school?.moduleEntitlements ??
    null;

  const prevSchoolId = getEntitlementBoundSchoolId();
  const schoolChanged = Boolean(schoolId && prevSchoolId && schoolId !== prevSchoolId);

  if (raw == null) {
    if (schoolChanged || !prevSchoolId) {
      const defaults = { ...DEFAULT_SCHOOL_MODULE_ENTITLEMENTS };
      setSchoolModuleEntitlements(defaults, schoolId || null);
      return defaults;
    }
    // Same school, payload omitted → keep cache (rollout-safe).
    return getSchoolModuleEntitlements(schoolId || prevSchoolId);
  }

  const next = asSchoolModuleEntitlements(raw);
  setSchoolModuleEntitlements(next, schoolId || prevSchoolId || null);
  return next;
}

/**
 * Drop cached entitlements when they belong to a different school than the active session.
 * Call on /auth/me failure or schoolId hydration.
 */
export function discardEntitlementsIfSchoolMismatch(activeSchoolId: string | null | undefined): boolean {
  const active = String(activeSchoolId || "").trim();
  const bound = getEntitlementBoundSchoolId();
  if (!bound) return false;
  if (active && bound === active) return false;
  clearSchoolModuleEntitlements();
  return true;
}

export function hasSchoolModule(
  module: ProductModuleKey,
  entitlements: SchoolModuleEntitlements = getSchoolModuleEntitlements()
): boolean {
  return entitlements[module] !== false;
}

function pageInList(page: string, list: readonly string[]): boolean {
  return list.includes(page);
}

/**
 * Commercial module gate for a dashboard page key.
 * null = Shared Platform (no commercial gate).
 */
export function schoolPageModuleRequirement(page: string): SchoolPageModuleRequirement | null {
  if (pageInList(page, SHARED_PLATFORM_PAGES)) return null;
  if (pageInList(page, EMPLOYEES_ANY_MODULE_PAGES)) {
    return { kind: "any", modules: ["CORE", "PAYROLL"] };
  }
  if (pageInList(page, BANKING_ANY_MODULE_PAGES)) {
    return { kind: "any", modules: ["CORE", "ACCOUNTING"] };
  }
  if (pageInList(page, PAYROLL_ONLY_PAGES)) {
    return { kind: "single", module: "PAYROLL" };
  }
  if (pageInList(page, ACCOUNTING_CORE_DEPENDENT_PAGES)) {
    return { kind: "all", modules: ["ACCOUNTING", "CORE"] };
  }
  if (pageInList(page, ACCOUNTING_SAFE_STANDALONE_PAGES)) {
    return { kind: "single", module: "ACCOUNTING" };
  }
  if (pageInList(page, CORE_OWNED_PAGES)) {
    return { kind: "single", module: "CORE" };
  }
  // Unknown dashboard keys default to CORE so new Core surfaces are not accidentally open.
  return { kind: "single", module: "CORE" };
}

/**
 * Single-module requirement for a page, or null when shared / any / multi-all.
 * Prefer schoolPageModuleRequirement + isSchoolPageModuleEntitled for access checks.
 */
export function requiredModuleForSchoolPage(page: string): ProductModuleKey | null {
  const req = schoolPageModuleRequirement(page);
  if (!req || req.kind !== "single") return null;
  return req.module;
}

export function isSchoolPageModuleEntitled(
  page: string,
  entitlements: SchoolModuleEntitlements = getSchoolModuleEntitlements()
): boolean {
  const req = schoolPageModuleRequirement(page);
  if (!req) return true;
  if (req.kind === "single") return hasSchoolModule(req.module, entitlements);
  if (req.kind === "any") {
    return req.modules.some((m) => hasSchoolModule(m, entitlements));
  }
  return req.modules.every((m) => hasSchoolModule(m, entitlements));
}

function formatModuleList(modules: readonly ProductModuleKey[]): string {
  if (modules.length === 1) return modules[0];
  if (modules.length === 2) return `${modules[0]} or ${modules[1]}`;
  return `${modules.slice(0, -1).join(", ")}, or ${modules[modules.length - 1]}`;
}

export function schoolPageModuleDenialMessage(
  page: string,
  entitlements: SchoolModuleEntitlements = getSchoolModuleEntitlements()
): string | null {
  if (isSchoolPageModuleEntitled(page, entitlements)) return null;
  const req = schoolPageModuleRequirement(page);
  if (!req) return null;
  if (req.kind === "single") {
    if (req.module === "ACCOUNTING") {
      return "Accounting is not included in this school’s EduClear package.";
    }
    if (req.module === "PAYROLL") {
      return "Payroll is not included in this school’s EduClear package.";
    }
    return "EduClear Core is not included in this school’s package.";
  }
  if (req.kind === "any") {
    return `This section requires ${formatModuleList(req.modules)} in this school’s EduClear package.`;
  }
  if (!hasSchoolModule("ACCOUNTING", entitlements)) {
    return "Accounting is not included in this school’s EduClear package.";
  }
  return "This Accounting feature also requires EduClear Core (school billing / learners) and is not available on Accounting-only packages yet.";
}

/** Primary denied module for UI badges (first missing when multi). */
export function deniedModuleForSchoolPage(
  page: string,
  entitlements: SchoolModuleEntitlements = getSchoolModuleEntitlements()
): ProductModuleKey | undefined {
  const req = schoolPageModuleRequirement(page);
  if (!req || isSchoolPageModuleEntitled(page, entitlements)) return undefined;
  if (req.kind === "single") return req.module;
  for (const m of req.modules) {
    if (!hasSchoolModule(m, entitlements)) return m;
  }
  return req.modules[0];
}

/** Deterministic commercial package label (same rules as backend). */
export function describeModulePackageLabel(entitlements: SchoolModuleEntitlements): string {
  const c = entitlements.CORE !== false;
  const a = entitlements.ACCOUNTING !== false;
  const p = entitlements.PAYROLL !== false;
  if (c && a && p) return "Full";
  if (!c && a && p) return "Accounting + Payroll";
  if (c && a && !p) return "Core + Accounting";
  if (c && !a && p) return "Core + Payroll";
  if (c && !a && !p) return "Core";
  if (!c && a && !p) return "Accounting";
  if (!c && !a && p) return "Payroll";
  return "Invalid / No modules";
}

/** Named entitlement presets for tests / docs. */
export const MODULE_PRESETS = {
  CORE_ONLY: { CORE: true, ACCOUNTING: false, PAYROLL: false } as SchoolModuleEntitlements,
  ACCOUNTING_ONLY: { CORE: false, ACCOUNTING: true, PAYROLL: false } as SchoolModuleEntitlements,
  PAYROLL_ONLY: { CORE: false, ACCOUNTING: false, PAYROLL: true } as SchoolModuleEntitlements,
  ACCOUNTING_PAYROLL: { CORE: false, ACCOUNTING: true, PAYROLL: true } as SchoolModuleEntitlements,
  CORE_ACCOUNTING: { CORE: true, ACCOUNTING: true, PAYROLL: false } as SchoolModuleEntitlements,
  CORE_PAYROLL: { CORE: true, ACCOUNTING: false, PAYROLL: true } as SchoolModuleEntitlements,
  FULL: { CORE: true, ACCOUNTING: true, PAYROLL: true } as SchoolModuleEntitlements,
  NONE: { CORE: false, ACCOUNTING: false, PAYROLL: false } as SchoolModuleEntitlements,
};
