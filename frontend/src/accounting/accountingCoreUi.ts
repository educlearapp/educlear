/**
 * Phase 5D — Core billing enrichment for Accounting UI.
 * Accounting-native surfaces work with ACCOUNTING alone.
 * School-fee / FamilyAccount / learner widgets are CORE enrichment only.
 */
import { hasSchoolModule } from "../modules/schoolModuleEntitlements";
import type { ExportReportType } from "./accountingExportEngine";
import { EXPORT_REPORT_OPTIONS } from "./accountingExportEngine";

/** True when school-fee Billing / FamilyAccount enrichment may appear in Accounting. */
export function isAccountingCoreBillingEnabled(): boolean {
  return hasSchoolModule("CORE");
}

/** Accounting Reports catalog entries that require CORE (school-fee debtors). */
export const ACCOUNTING_CORE_ONLY_REPORT_TYPES = ["debtors"] as const;

/** Export Center types that require CORE (school-fee / FamilyAccount data). */
export const ACCOUNTING_CORE_ONLY_EXPORT_TYPES: readonly ExportReportType[] = [
  "debtors-ageing",
  "management-reports",
];

export function isCoreOnlyExportType(reportType: ExportReportType): boolean {
  return (ACCOUNTING_CORE_ONLY_EXPORT_TYPES as readonly string[]).includes(reportType);
}

export function exportOptionsForModules(coreBillingEnabled: boolean) {
  if (coreBillingEnabled) return EXPORT_REPORT_OPTIONS;
  return EXPORT_REPORT_OPTIONS.filter((opt) => !isCoreOnlyExportType(opt.id));
}

export function isCoreOnlyReportType(reportType: string): boolean {
  return (ACCOUNTING_CORE_ONLY_REPORT_TYPES as readonly string[]).includes(reportType);
}
