import { isSuperAdmin } from "./roles";
import {
  hasPermission,
  type ModuleKey,
  type PermissionAction,
} from "../users/permissions";
import { getSchoolSessionUser, type SchoolSessionUser } from "./schoolSession";
import {
  deniedModuleForSchoolPage,
  getSchoolModuleEntitlements,
  hasSchoolModule,
  isSchoolPageModuleEntitled,
  schoolPageModuleDenialMessage,
  schoolPageModuleRequirement,
  type ProductModuleKey,
  type SchoolModuleEntitlements,
} from "../modules/schoolModuleEntitlements";

export type SchoolPageKey = string;

type PageRule = { module: ModuleKey; action: PermissionAction };

const PAGE_RULES: Record<string, PageRule> = {
  dashboard: { module: "dashboard", action: "view" },
  schoolProfile: { module: "settings", action: "view" },
  schoolPackage: { module: "settings", action: "view" },
  schoolCredits: { module: "settings", action: "view" },
  schoolUsers: { module: "users", action: "view" },
  schoolSettings: { module: "settings", action: "view" },
  registrations: { module: "registrations", action: "view" },
  sasamsReportUpload: { module: "registrations", action: "view" },
  parentPortal: { module: "parents", action: "view" },
  teacherInbox: { module: "teachers", action: "view" },
  learnerProfile: { module: "learners", action: "view" },
  addLearner: { module: "learners", action: "create" },
  classrooms: { module: "classrooms", action: "view" },
  classroomManage: { module: "classrooms", action: "edit" },
  groups: { module: "classrooms", action: "view" },
  groupManage: { module: "classrooms", action: "edit" },
  employees: { module: "employees", action: "view" },
  employeeManage: { module: "employees", action: "edit" },
  teacherPerformance: { module: "teachers", action: "view" },
  attendance: { module: "attendance", action: "view" },
  attendanceManage: { module: "attendance", action: "edit" },
  attendanceReports: { module: "reports", action: "view" },
  homesafe: { module: "attendance", action: "view" },
  incidents: { module: "learners", action: "view" },
  incidentManage: { module: "learners", action: "edit" },
  lists: { module: "reports", action: "view" },
  forms: { module: "reports", action: "view" },
  help: { module: "dashboard", action: "view" },
  more: { module: "dashboard", action: "view" },
  statements: { module: "statements", action: "view" },
  statementManage: { module: "statements", action: "view" },
  invoices: { module: "invoices", action: "view" },
  invoiceCreate: { module: "invoices", action: "create" },
  payments: { module: "payments", action: "view" },
  paymentCreate: { module: "payments", action: "create" },
  educlock: { module: "educlock", action: "manage" },
  payroll: { module: "payroll", action: "view" },
  fees: { module: "billing", action: "view" },
  feeUpsert: { module: "billing", action: "edit" },
  plans: { module: "billingPlans", action: "view" },
  runs: { module: "invoiceRuns", action: "view" },
  reports: { module: "reports", action: "view" },
  outstandingAccounts: { module: "statements", action: "view" },
  financeHub: { module: "reports", action: "view" },
  financeCollections: { module: "reports", action: "view" },
  documents: { module: "billingDocuments", action: "view" },
  "billing-help": { module: "billing", action: "view" },
  "billing-more": { module: "billing", action: "view" },
  billingDeposits: { module: "billing", action: "view" },
  billingSettings: { module: "billing", action: "manage" },
  communicationEmail: { module: "settings", action: "view" },
  communicationSms: { module: "settings", action: "view" },
  communicationSettings: { module: "settings", action: "view" },
  communicationCentre: { module: "settings", action: "view" },
  /** Banking — CORE || ACCOUNTING (module gate); fee vs expense UI is field-policy. */
  bankStatementImport: { module: "payments", action: "view" },
  accountingOverview: { module: "reports", action: "view" },
  accountingBanking: { module: "payments", action: "view" },
  accountingExpenses: { module: "reports", action: "view" },
  accountingSuppliers: { module: "reports", action: "view" },
  accountingAssets: { module: "reports", action: "view" },
  accountingJournals: { module: "reports", action: "view" },
  accountingGeneralLedger: { module: "reports", action: "view" },
  accountingChartOfAccounts: { module: "reports", action: "view" },
  accountingBudget: { module: "reports", action: "view" },
  accountingFinancialStatements: { module: "reports", action: "view" },
  accountingReports: { module: "reports", action: "view" },
  accountingDebtorsAgeing: { module: "reports", action: "view" },
  accountingCreditorsAgeing: { module: "reports", action: "view" },
  accountingSupplierInvoices: { module: "reports", action: "view" },
  accountingAuditCompliance: { module: "reports", action: "view" },
  accountingExportCenter: { module: "reports", action: "view" },
  accountingSettings: { module: "settings", action: "view" },
  /** Settings → Admissions (OA-03A). Dashboard module comes later. */
  admissionsSettings: { module: "admissions", action: "view" },
  admissions: { module: "admissions", action: "view" },
  admissionsDetail: { module: "admissions", action: "view" },
};

const FALLBACK_PAGE_ORDER: SchoolPageKey[] = [
  "dashboard",
  "accountingOverview",
  "payroll",
  "employees",
  "schoolProfile",
  "registrations",
  "statements",
  "invoices",
  "payments",
  "plans",
  "fees",
  "reports",
  "settings",
];

export type SchoolPageAccessDenial =
  | { allowed: true }
  | {
      allowed: false;
      reason: "auth" | "permission" | "module";
      message: string;
      module?: ProductModuleKey;
    };

/** RBAC-only check (ignores product modules). */
export function canAccessSchoolPageByPermission(
  page: SchoolPageKey,
  user: SchoolSessionUser | null = getSchoolSessionUser()
): boolean {
  if (isSuperAdmin()) return true;
  if (!user) return false;

  if (page === "migrationCentre") {
    return false;
  }

  // Admin HomeSafe is staff-dashboard only (not Teacher portal / Finance-only).
  if (page === "homesafe") {
    const role = String(user.appRole || "").trim();
    if (role === "Teacher" || role === "Finance") {
      return false;
    }
  }

  if (user.appRole === "Owner") return true;

  // Accounting product area is Owner-only. reports.view still powers Billing Reports / Lists.
  if (String(page).startsWith("accounting")) {
    return false;
  }

  const rule = PAGE_RULES[page];
  if (!rule) return false;
  return hasPermission(user, rule.module, rule.action);
}

export function evaluateSchoolPageAccess(
  page: SchoolPageKey,
  user: SchoolSessionUser | null = getSchoolSessionUser(),
  entitlements: SchoolModuleEntitlements = getSchoolModuleEntitlements()
): SchoolPageAccessDenial {
  if (isSuperAdmin()) return { allowed: true };
  if (!user) {
    return { allowed: false, reason: "auth", message: "Authentication required." };
  }

  if (!isSchoolPageModuleEntitled(page, entitlements)) {
    const denied = deniedModuleForSchoolPage(page, entitlements);
    return {
      allowed: false,
      reason: "module",
      module: denied,
      message:
        schoolPageModuleDenialMessage(page, entitlements) ||
        "This section is not included in this school’s EduClear package.",
    };
  }

  if (!canAccessSchoolPageByPermission(page, user)) {
    return {
      allowed: false,
      reason: "permission",
      message: "You do not have permission to access this section.",
    };
  }

  return { allowed: true };
}

export function canAccessSchoolPage(
  page: SchoolPageKey,
  user: SchoolSessionUser | null = getSchoolSessionUser(),
  entitlements: SchoolModuleEntitlements = getSchoolModuleEntitlements()
): boolean {
  return evaluateSchoolPageAccess(page, user, entitlements).allowed;
}

/**
 * Preferred post-login / invalid-route landing by commercial package.
 * CORE → school Dashboard; Accounting (no Core) → Accounting Overview; Payroll-only → Payroll.
 */
export function resolvePreferredLandingPage(
  user: SchoolSessionUser | null = getSchoolSessionUser(),
  entitlements: SchoolModuleEntitlements = getSchoolModuleEntitlements()
): SchoolPageKey {
  if (hasSchoolModule("CORE", entitlements) && canAccessSchoolPage("dashboard", user, entitlements)) {
    return "dashboard";
  }
  if (
    hasSchoolModule("ACCOUNTING", entitlements) &&
    canAccessSchoolPage("accountingOverview", user, entitlements)
  ) {
    return "accountingOverview";
  }
  if (hasSchoolModule("PAYROLL", entitlements) && canAccessSchoolPage("payroll", user, entitlements)) {
    return "payroll";
  }
  if (canAccessSchoolPage("employees", user, entitlements)) return "employees";
  if (canAccessSchoolPage("schoolProfile", user, entitlements)) return "schoolProfile";
  for (const page of FALLBACK_PAGE_ORDER) {
    if (canAccessSchoolPage(page, user, entitlements)) return page;
  }
  for (const page of Object.keys(PAGE_RULES)) {
    if (canAccessSchoolPage(page, user, entitlements)) return page;
  }
  return "schoolProfile";
}

export function findFirstAllowedSchoolPage(
  user: SchoolSessionUser | null = getSchoolSessionUser(),
  entitlements: SchoolModuleEntitlements = getSchoolModuleEntitlements()
): SchoolPageKey {
  return resolvePreferredLandingPage(user, entitlements);
}

export function canViewAnySchoolPage(
  pages: SchoolPageKey[],
  user: SchoolSessionUser | null = getSchoolSessionUser(),
  entitlements: SchoolModuleEntitlements = getSchoolModuleEntitlements()
): boolean {
  return pages.some((page) => canAccessSchoolPage(page, user, entitlements));
}

/** Re-export for callers that need to inspect gates without importing modules twice. */
export { schoolPageModuleRequirement };
