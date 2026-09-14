/**
 * Phase 3 — school module entitlements + page access matrix.
 * Run: npx tsx src/modules/schoolModuleEntitlements.phase3.unit.test.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  ACCOUNTING_ONLY_PAGES,
  asSchoolModuleEntitlements,
  describeModulePackageLabel,
  hasSchoolModule,
  isSchoolPageModuleEntitled,
  requiredModuleForSchoolPage,
  setSchoolModuleEntitlements,
  SCHOOL_MODULE_ENTITLEMENTS_STORAGE_KEY,
} from "./schoolModuleEntitlements";
import {
  canAccessSchoolPage,
  evaluateSchoolPageAccess,
} from "../auth/schoolAccess";
import type { SchoolSessionUser } from "../auth/schoolSession";
import { permissionsForRole } from "../users/permissions";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

function ownerUser(): SchoolSessionUser {
  return {
    appRole: "Owner",
    permissions: permissionsForRole("Owner"),
    isActive: true,
  };
}

function viewerUser(): SchoolSessionUser {
  return {
    appRole: "Viewer",
    permissions: permissionsForRole("Viewer"),
    isActive: true,
  };
}

function financeUser(): SchoolSessionUser {
  return {
    appRole: "Finance",
    permissions: permissionsForRole("Finance"),
    isActive: true,
  };
}

function main() {
  memory.clear();

  // Fail-open defaults
  assert.strictEqual(hasSchoolModule("ACCOUNTING"), true);
  assert.strictEqual(hasSchoolModule("PAYROLL"), true);
  assert.strictEqual(hasSchoolModule("CORE"), true);

  const coreOnly = asSchoolModuleEntitlements({
    CORE: true,
    ACCOUNTING: false,
    PAYROLL: false,
  });
  assert.strictEqual(coreOnly.CORE, true);
  assert.strictEqual(coreOnly.ACCOUNTING, false);
  assert.strictEqual(coreOnly.PAYROLL, false);
  assert.strictEqual(describeModulePackageLabel(coreOnly), "Core");
  assert.strictEqual(
    describeModulePackageLabel({ CORE: true, ACCOUNTING: true, PAYROLL: true }),
    "Full"
  );
  assert.strictEqual(
    describeModulePackageLabel({ CORE: false, ACCOUNTING: true, PAYROLL: false }),
    "Accounting"
  );
  assert.strictEqual(
    describeModulePackageLabel({ CORE: false, ACCOUNTING: false, PAYROLL: true }),
    "Payroll"
  );
  assert.strictEqual(
    describeModulePackageLabel({ CORE: false, ACCOUNTING: true, PAYROLL: true }),
    "Accounting + Payroll"
  );
  assert.strictEqual(
    describeModulePackageLabel({ CORE: false, ACCOUNTING: false, PAYROLL: false }),
    "Invalid / No modules"
  );

  // Explicit CORE=false must not be forced on
  const accOnly = asSchoolModuleEntitlements({ CORE: false, ACCOUNTING: true, PAYROLL: false });
  assert.strictEqual(accOnly.CORE, false);
  assert.strictEqual(hasSchoolModule("CORE", accOnly), false);
  // Missing data fail-opens Full
  assert.deepStrictEqual(asSchoolModuleEntitlements(null), {
    CORE: true,
    ACCOUNTING: true,
    PAYROLL: true,
  });

  setSchoolModuleEntitlements(coreOnly);
  assert.ok(localStorage.getItem(SCHOOL_MODULE_ENTITLEMENTS_STORAGE_KEY));

  // Page module map
  assert.strictEqual(requiredModuleForSchoolPage("accountingOverview"), "ACCOUNTING");
  assert.strictEqual(requiredModuleForSchoolPage("payroll"), "PAYROLL");
  assert.strictEqual(requiredModuleForSchoolPage("accountingBanking"), null);
  assert.strictEqual(requiredModuleForSchoolPage("bankStatementImport"), null);
  assert.strictEqual(requiredModuleForSchoolPage("educlock"), null);
  assert.strictEqual(requiredModuleForSchoolPage("statements"), null);
  assert.strictEqual(requiredModuleForSchoolPage("employees"), null);
  assert.ok(ACCOUNTING_ONLY_PAGES.includes("accountingExpenses"));

  assert.strictEqual(isSchoolPageModuleEntitled("accountingOverview", coreOnly), false);
  assert.strictEqual(isSchoolPageModuleEntitled("payroll", coreOnly), false);
  assert.strictEqual(isSchoolPageModuleEntitled("accountingBanking", coreOnly), true);
  assert.strictEqual(isSchoolPageModuleEntitled("educlock", coreOnly), true);
  assert.strictEqual(isSchoolPageModuleEntitled("payments", coreOnly), true);

  const owner = ownerUser();

  // CORE school: Owner — Accounting/Payroll blocked; Billing + Banking + EduClock allowed
  assert.strictEqual(canAccessSchoolPage("accountingOverview", owner, coreOnly), false);
  assert.strictEqual(canAccessSchoolPage("payroll", owner, coreOnly), false);
  assert.strictEqual(canAccessSchoolPage("accountingBanking", owner, coreOnly), true);
  assert.strictEqual(canAccessSchoolPage("educlock", owner, coreOnly), true);
  assert.strictEqual(canAccessSchoolPage("statements", owner, coreOnly), true);
  assert.strictEqual(canAccessSchoolPage("employees", owner, coreOnly), true);
  assert.strictEqual(canAccessSchoolPage("attendance", owner, coreOnly), true);

  const denied = evaluateSchoolPageAccess("accountingExpenses", owner, coreOnly);
  assert.strictEqual(denied.allowed, false);
  if (!denied.allowed) {
    assert.strictEqual(denied.reason, "module");
    assert.strictEqual(denied.module, "ACCOUNTING");
  }

  const full = asSchoolModuleEntitlements({
    CORE: true,
    ACCOUNTING: true,
    PAYROLL: true,
  });
  setSchoolModuleEntitlements(full);
  assert.strictEqual(canAccessSchoolPage("accountingOverview", owner, full), true);
  assert.strictEqual(canAccessSchoolPage("payroll", owner, full), true);

  // RBAC: module ON + permission OFF
  const viewer = viewerUser();
  assert.strictEqual(canAccessSchoolPage("payroll", viewer, full), false);
  const viewerDenial = evaluateSchoolPageAccess("payroll", viewer, full);
  assert.strictEqual(viewerDenial.allowed, false);
  if (!viewerDenial.allowed) assert.strictEqual(viewerDenial.reason, "permission");

  // module OFF + permission ON (Finance often has reports/payments)
  const finance = financeUser();
  assert.strictEqual(canAccessSchoolPage("accountingOverview", finance, coreOnly), false);
  const financeDenial = evaluateSchoolPageAccess("accountingOverview", finance, coreOnly);
  assert.strictEqual(financeDenial.allowed, false);
  if (!financeDenial.allowed) assert.strictEqual(financeDenial.reason, "module");

  // Nav / banking source contracts
  const dash = fs.readFileSync(
    path.join(__dirname, "../SchoolDashboard.tsx"),
    "utf8"
  );
  // Accounting submenu must not list Banking/Payroll/EduClock (those moved out).
  const accountingSubmenu = dash.slice(
    dash.indexOf("<span>Accounting</span>"),
    dash.indexOf("<span>Communication</span>")
  );
  assert.ok(!accountingSubmenu.includes('go("educlock")'), "EduClock not under Accounting");
  assert.ok(!accountingSubmenu.includes('go("payroll")'), "Payroll not under Accounting");
  assert.ok(!accountingSubmenu.includes('go("accountingBanking")'), "Banking not under Accounting");
  assert.ok(accountingSubmenu.includes('go("accountingExpenses")'), "Expenses remains under Accounting");

  const banking = fs.readFileSync(
    path.join(__dirname, "../banking/BankStatementImport.tsx"),
    "utf8"
  );
  assert.ok(banking.includes('hasSchoolModule("ACCOUNTING")'));
  assert.ok(banking.includes("Expense Matches"));
  assert.ok(banking.includes("accountingEnabled ?"));
  assert.ok(banking.includes("Payment Matches"));

  // Employee payroll tab gated
  assert.ok(dash.includes('hasPayrollModule ? tabButton("payroll"'));
  assert.ok(dash.includes("Staff Active"));

  console.log("✓ schoolModuleEntitlements.phase3.unit.test.ts passed");
}

main();
