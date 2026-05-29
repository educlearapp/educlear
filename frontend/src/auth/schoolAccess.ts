import { canAccessMigration } from "./migrationAccess";
import { isSuperAdmin } from "./roles";
import {
  hasPermission,
  type ModuleKey,
  type PermissionAction,
} from "../users/permissions";
import { getSchoolSessionUser, type SchoolSessionUser } from "./schoolSession";

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
  payroll: { module: "payroll", action: "view" },
  fees: { module: "billing", action: "view" },
  feeUpsert: { module: "billing", action: "edit" },
  plans: { module: "billingPlans", action: "view" },
  runs: { module: "invoiceRuns", action: "view" },
  reports: { module: "reports", action: "view" },
  documents: { module: "billingDocuments", action: "view" },
  "billing-help": { module: "billing", action: "view" },
  "billing-more": { module: "billing", action: "view" },
  billingDeposits: { module: "billing", action: "view" },
  billingSettings: { module: "billing", action: "manage" },
  communicationEmail: { module: "settings", action: "view" },
  communicationSms: { module: "settings", action: "view" },
  communicationSettings: { module: "settings", action: "view" },
  communicationCentre: { module: "settings", action: "view" },
  bankStatementImport: { module: "reports", action: "view" },
  accountingOverview: { module: "reports", action: "view" },
  accountingBanking: { module: "reports", action: "view" },
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
};

const FALLBACK_PAGE_ORDER: SchoolPageKey[] = [
  "dashboard",
  "registrations",
  "statements",
  "invoices",
  "payments",
  "plans",
  "fees",
  "reports",
  "settings",
];

export function canAccessSchoolPage(
  page: SchoolPageKey,
  user: SchoolSessionUser | null = getSchoolSessionUser()
): boolean {
  if (isSuperAdmin()) return true;
  if (!user) return false;
  if (user.appRole === "Owner") return true;

  if (page === "migrationCentre") {
    return canAccessMigration();
  }

  const rule = PAGE_RULES[page];
  if (!rule) return false;
  return hasPermission(user, rule.module, rule.action);
}

export function findFirstAllowedSchoolPage(
  user: SchoolSessionUser | null = getSchoolSessionUser()
): SchoolPageKey {
  for (const page of FALLBACK_PAGE_ORDER) {
    if (canAccessSchoolPage(page, user)) return page;
  }
  for (const page of Object.keys(PAGE_RULES)) {
    if (canAccessSchoolPage(page, user)) return page;
  }
  return "dashboard";
}

export function canViewAnySchoolPage(
  pages: SchoolPageKey[],
  user: SchoolSessionUser | null = getSchoolSessionUser()
): boolean {
  return pages.some((page) => canAccessSchoolPage(page, user));
}
