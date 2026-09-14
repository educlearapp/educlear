/**
 * School product module entitlements (CORE / ACCOUNTING / PAYROLL).
 * Orthogonal to RBAC permissions and STARTER/UNLIMITED capacity packages.
 *
 * Rollout-safe default: missing data → all modules enabled (matches backend fail-open).
 * Entitlements are bound to schoolId so login/school switch cannot reuse another tenant’s cache.
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

/** Pages that require optional ACCOUNTING (bookkeeping). Banking fee import is CORE. */
export const ACCOUNTING_ONLY_PAGES = [
  "accountingOverview",
  "accountingExpenses",
  "accountingSuppliers",
  "accountingAssets",
  "accountingJournals",
  "accountingGeneralLedger",
  "accountingChartOfAccounts",
  "accountingBudget",
  "accountingFinancialStatements",
  "accountingReports",
  "accountingDebtorsAgeing",
  "accountingCreditorsAgeing",
  "accountingSupplierInvoices",
  "accountingAuditCompliance",
  "accountingExportCenter",
  "accountingSettings",
] as const;

/** Pages that require optional PAYROLL. */
export const PAYROLL_ONLY_PAGES = ["payroll"] as const;

export function asSchoolModuleEntitlements(
  raw: unknown
): SchoolModuleEntitlements {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_SCHOOL_MODULE_ENTITLEMENTS };
  }
  const o = raw as Record<string, unknown>;
  return {
    // CORE cannot be disabled for an active school product surface.
    CORE: true,
    ACCOUNTING: o.ACCOUNTING !== false,
    PAYROLL: o.PAYROLL !== false,
  };
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
  if (module === "CORE") return true;
  return entitlements[module] !== false;
}

/** Optional module required for a dashboard page key, or null for Core. */
export function requiredModuleForSchoolPage(
  page: string
): "ACCOUNTING" | "PAYROLL" | null {
  if ((ACCOUNTING_ONLY_PAGES as readonly string[]).includes(page)) return "ACCOUNTING";
  if ((PAYROLL_ONLY_PAGES as readonly string[]).includes(page)) return "PAYROLL";
  return null;
}

export function isSchoolPageModuleEntitled(
  page: string,
  entitlements: SchoolModuleEntitlements = getSchoolModuleEntitlements()
): boolean {
  const required = requiredModuleForSchoolPage(page);
  if (!required) return true;
  return hasSchoolModule(required, entitlements);
}

export function schoolPageModuleDenialMessage(page: string): string | null {
  const required = requiredModuleForSchoolPage(page);
  if (!required) return null;
  if (hasSchoolModule(required)) return null;
  if (required === "ACCOUNTING") {
    return "Accounting is not included in this school’s EduClear package.";
  }
  return "Payroll is not included in this school’s EduClear package.";
}

/** Super Admin display helper — not a persisted package field. */
export function describeModulePackageLabel(entitlements: SchoolModuleEntitlements): string {
  const accounting = entitlements.ACCOUNTING !== false;
  const payroll = entitlements.PAYROLL !== false;
  if (accounting && payroll) return "Full";
  if (accounting) return "Core + Accounting";
  if (payroll) return "Core + Payroll";
  return "Core";
}

/** Named entitlement presets for tests / docs. */
export const MODULE_PRESETS = {
  CORE_ONLY: { CORE: true, ACCOUNTING: false, PAYROLL: false } as SchoolModuleEntitlements,
  CORE_ACCOUNTING: { CORE: true, ACCOUNTING: true, PAYROLL: false } as SchoolModuleEntitlements,
  CORE_PAYROLL: { CORE: true, ACCOUNTING: false, PAYROLL: true } as SchoolModuleEntitlements,
  FULL: { CORE: true, ACCOUNTING: true, PAYROLL: true } as SchoolModuleEntitlements,
};
