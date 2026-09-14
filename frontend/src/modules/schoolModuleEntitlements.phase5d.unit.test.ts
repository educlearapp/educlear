/**
 * Phase 5D — Accounting standalone hardening (CORE=false + ACCOUNTING=true).
 * Run: npx tsx src/modules/schoolModuleEntitlements.phase5d.unit.test.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  ACCOUNTING_CORE_DEPENDENT_PAGES,
  ACCOUNTING_SAFE_STANDALONE_PAGES,
  MODULE_PRESETS,
  asSchoolModuleEntitlements,
  hasSchoolModule,
  isSchoolPageModuleEntitled,
  setSchoolModuleEntitlements,
  SCHOOL_MODULE_ENTITLEMENTS_STORAGE_KEY,
} from "./schoolModuleEntitlements";
import {
  canAccessSchoolPage,
  evaluateSchoolPageAccess,
  resolvePreferredLandingPage,
} from "../auth/schoolAccess";
import type { SchoolSessionUser } from "../auth/schoolSession";
import { permissionsForRole } from "../users/permissions";
import {
  ACCOUNTING_CORE_ONLY_EXPORT_TYPES,
  ACCOUNTING_CORE_ONLY_REPORT_TYPES,
  exportOptionsForModules,
  isAccountingCoreBillingEnabled,
  isCoreOnlyExportType,
  isCoreOnlyReportType,
} from "../accounting/accountingCoreUi";
import { EXPORT_REPORT_OPTIONS } from "../accounting/accountingExportEngine";
import { buildFinancialReport } from "../accounting/AccountingFinancialStatements";
import { resolveReportingPeriod } from "../accounting/accountingSettingsStorage";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const memory = new Map<string, string>();
const g = globalThis as typeof globalThis & { localStorage?: Storage };
g.localStorage = {
  getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
  setItem: (k: string, v: string) => {
    memory.set(k, String(v));
  },
  removeItem: (k: string) => {
    memory.delete(k);
  },
  clear: () => memory.clear(),
  key: () => null,
  get length() {
    return memory.size;
  },
};

function owner(): SchoolSessionUser {
  return { appRole: "Owner", permissions: permissionsForRole("Owner"), isActive: true };
}

function main() {
  memory.clear();

  // --- Entitlement unlocks (Debtors remain CORE+ACCOUNTING) ---
  assert.deepStrictEqual([...ACCOUNTING_CORE_DEPENDENT_PAGES], ["accountingDebtorsAgeing"]);
  assert.ok(ACCOUNTING_SAFE_STANDALONE_PAGES.includes("accountingFinancialStatements"));
  assert.ok(ACCOUNTING_SAFE_STANDALONE_PAGES.includes("accountingReports"));
  assert.ok(ACCOUNTING_SAFE_STANDALONE_PAGES.includes("accountingAuditCompliance"));
  assert.ok(ACCOUNTING_SAFE_STANDALONE_PAGES.includes("accountingExportCenter"));
  assert.ok(!ACCOUNTING_SAFE_STANDALONE_PAGES.includes("accountingDebtorsAgeing"));

  const acc = MODULE_PRESETS.ACCOUNTING_ONLY;
  const accPay = MODULE_PRESETS.ACCOUNTING_PAYROLL;
  const coreAcc = MODULE_PRESETS.CORE_ACCOUNTING;
  const full = MODULE_PRESETS.FULL;
  const u = owner();

  for (const page of [
    "accountingOverview",
    "accountingFinancialStatements",
    "accountingReports",
    "accountingAuditCompliance",
    "accountingExportCenter",
    "accountingExpenses",
    "accountingBanking",
  ] as const) {
    assert.strictEqual(canAccessSchoolPage(page, u, acc), true, `010 ${page}`);
    assert.strictEqual(canAccessSchoolPage(page, u, accPay), true, `011 ${page}`);
  }

  assert.strictEqual(canAccessSchoolPage("accountingDebtorsAgeing", u, acc), false);
  assert.strictEqual(canAccessSchoolPage("accountingDebtorsAgeing", u, accPay), false);
  assert.strictEqual(canAccessSchoolPage("accountingDebtorsAgeing", u, coreAcc), true);
  assert.strictEqual(canAccessSchoolPage("accountingDebtorsAgeing", u, full), true);

  {
    const d = evaluateSchoolPageAccess("accountingDebtorsAgeing", u, acc);
    assert.ok(!d.allowed && d.reason === "module" && d.module === "CORE");
  }

  // Core surfaces still hidden
  for (const page of ["dashboard", "statements", "learners", "educlock", "fees"] as const) {
    if (page === "learners") continue;
    assert.strictEqual(canAccessSchoolPage(page, u, acc), false, `010 no ${page}`);
  }
  assert.strictEqual(canAccessSchoolPage("employees", u, acc), false);
  assert.strictEqual(canAccessSchoolPage("employees", u, accPay), true);
  assert.strictEqual(canAccessSchoolPage("payroll", u, accPay), true);
  assert.strictEqual(canAccessSchoolPage("educlock", u, accPay), false);

  assert.strictEqual(resolvePreferredLandingPage(u, acc), "accountingOverview");
  assert.strictEqual(resolvePreferredLandingPage(u, accPay), "accountingOverview");
  assert.strictEqual(resolvePreferredLandingPage(u, coreAcc), "dashboard");
  assert.strictEqual(resolvePreferredLandingPage(u, full), "dashboard");

  // --- Core enrichment helper ---
  setSchoolModuleEntitlements(acc, "school-acc");
  assert.strictEqual(hasSchoolModule("CORE"), false);
  assert.strictEqual(isAccountingCoreBillingEnabled(), false);
  assert.ok(isCoreOnlyReportType("debtors"));
  assert.ok(!isCoreOnlyReportType("management"));
  assert.ok(isCoreOnlyExportType("debtors-ageing"));
  assert.ok(isCoreOnlyExportType("management-reports"));
  assert.ok(!isCoreOnlyExportType("general-ledger"));

  const filteredExports = exportOptionsForModules(false);
  assert.ok(!filteredExports.some((o) => o.id === "debtors-ageing"));
  assert.ok(!filteredExports.some((o) => o.id === "management-reports"));
  assert.ok(filteredExports.some((o) => o.id === "general-ledger"));
  assert.ok(filteredExports.some((o) => o.id === "financial-statements"));
  assert.strictEqual(exportOptionsForModules(true).length, EXPORT_REPORT_OPTIONS.length);
  assert.ok(ACCOUNTING_CORE_ONLY_EXPORT_TYPES.includes("debtors-ageing"));
  assert.ok(ACCOUNTING_CORE_ONLY_REPORT_TYPES.includes("debtors"));

  // Financial statements builder skips Core billing when disabled
  const period = resolveReportingPeriod("month", 2026, 0);
  const reportOff = buildFinancialReport("school-acc", [{ id: "L1" }], period, {
    coreBillingEnabled: false,
  });
  assert.strictEqual(reportOff.debtorsOutstanding, 0);
  assert.strictEqual(reportOff.totalIncome, 0);
  assert.ok(reportOff.totalExpenses >= 0);

  setSchoolModuleEntitlements(full, "school-full");
  assert.strictEqual(isAccountingCoreBillingEnabled(), true);

  // --- Source contracts ---
  const overview = fs.readFileSync(path.join(__dirname, "../accounting/AccountingOverview.tsx"), "utf8");
  assert.ok(overview.includes("isAccountingCoreBillingEnabled"));
  assert.ok(overview.includes("coreBillingEnabled"));
  assert.ok(overview.includes('coreOnly: true'));
  assert.ok(overview.includes("Fee income received"));

  const fsSrc = fs.readFileSync(
    path.join(__dirname, "../accounting/AccountingFinancialStatements.tsx"),
    "utf8"
  );
  assert.ok(fsSrc.includes("coreBillingEnabled"));
  assert.ok(fsSrc.includes("options?: { coreBillingEnabled?: boolean }"));
  assert.ok(fsSrc.includes("coreBillingEnabled ? getBillingRows"));

  const reports = fs.readFileSync(path.join(__dirname, "../accounting/AccountingReports.tsx"), "utf8");
  assert.ok(reports.includes("availableReportOptions"));
  assert.ok(reports.includes("isCoreOnlyReportType"));
  assert.ok(reports.includes("!coreBillingEnabled"));
  assert.ok(reports.includes("requires EduClear Core"));

  const audit = fs.readFileSync(path.join(__dirname, "../accounting/AccountingAuditCompliance.tsx"), "utf8");
  assert.ok(audit.includes("coreBillingEnabled"));
  assert.ok(audit.includes('c.id !== "debtors"'));
  assert.ok(audit.includes("Overdue Debtors"));

  const exportCenter = fs.readFileSync(
    path.join(__dirname, "../accounting/AccountingExportCenter.tsx"),
    "utf8"
  );
  assert.ok(exportCenter.includes("exportOptionsForModules"));
  assert.ok(exportCenter.includes("coreBillingEnabled"));

  const collectors = fs.readFileSync(
    path.join(__dirname, "../accounting/accountingExportCollectors.ts"),
    "utf8"
  );
  assert.ok(collectors.includes("isCoreOnlyExportType"));
  assert.ok(collectors.includes("coreBillingEnabled"));

  const banking = fs.readFileSync(path.join(__dirname, "../banking/BankStatementImport.tsx"), "utf8");
  assert.ok(banking.includes("Fee-payment matching requires EduClear Core"));
  assert.ok(banking.includes("coreEnabled"));
  assert.ok(banking.includes('...(coreEnabled ? ([["payments", "Payment Matches"]]'));

  const entitlements = fs.readFileSync(path.join(__dirname, "./schoolModuleEntitlements.ts"), "utf8");
  assert.ok(entitlements.includes('ACCOUNTING_CORE_DEPENDENT_PAGES = ["accountingDebtorsAgeing"]'));

  // Explicit CORE=false session
  memory.clear();
  setSchoolModuleEntitlements(MODULE_PRESETS.ACCOUNTING_ONLY, "s1");
  assert.strictEqual(asSchoolModuleEntitlements(JSON.parse(localStorage.getItem(SCHOOL_MODULE_ENTITLEMENTS_STORAGE_KEY)!)).CORE, false);
  assert.strictEqual(isSchoolPageModuleEntitled("accountingOverview", MODULE_PRESETS.ACCOUNTING_ONLY), true);
  assert.strictEqual(isSchoolPageModuleEntitled("accountingDebtorsAgeing", MODULE_PRESETS.ACCOUNTING_ONLY), false);

  console.log("✓ schoolModuleEntitlements.phase5d.unit.test.ts passed");
}

main();
