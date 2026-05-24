/** Auth/session keys — never removed by migration cache clear. */
const AUTH_SESSION_KEYS = new Set([
  "token",
  "schoolId",
  "schoolName",
  "schoolLogoUrl",
  "userEmail",
  "userRole",
  "userName",
  "isOwner",
  "selectedSchoolId",
  "currentSchoolId",
]);

/** Known billing / UI cache keys that can mask imported server data. */
export const EDUCLEAR_MIGRATION_DEMO_CACHE_KEYS = [
  "educlearBillingPlans",
  "billingPlanFeeOptions",
  "selectedBillingPlanLearner",
  "registrationLearnerEdits",
  "selectedLearnerForManage",
  "selectedLearnerForSibling",
  "selectedClassroomForManage",
  "selectedGroupForManage",
  "selectedEmployeeForManage",
  "selectedInvoiceAccount",
  "selectedStatementAccount",
  "selectedPaymentAccount",
  "addLearnerPrefillClassName",
  "educlearGroups",
  "educlearEmployees",
] as const;

const MIGRATION_DEMO_KEY_PATTERN = /migration|dasilva|demo|staging|mig-test|mig_test/i;

/**
 * Clears migration/demo localStorage caches. Does not touch auth or session keys.
 * Safe to call from the browser console: `educlearClearMigrationCache()`
 */
export function clearEduClearMigrationCache(): string[] {
  const removed: string[] = [];

  for (const key of EDUCLEAR_MIGRATION_DEMO_CACHE_KEYS) {
    if (localStorage.getItem(key) !== null) {
      localStorage.removeItem(key);
      removed.push(key);
    }
  }

  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (!key || AUTH_SESSION_KEYS.has(key)) continue;
    if (MIGRATION_DEMO_KEY_PATTERN.test(key) && !removed.includes(key)) {
      localStorage.removeItem(key);
      removed.push(key);
    }
  }

  return removed;
}

export function registerEduClearStorageDebugGlobals(): void {
  if (typeof window === "undefined") return;
  (window as Window & { educlearClearMigrationCache?: () => string[] }).educlearClearMigrationCache =
    clearEduClearMigrationCache;
}
