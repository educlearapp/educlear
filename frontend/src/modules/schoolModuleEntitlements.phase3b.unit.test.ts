/**
 * Phase 3B — module combination matrix, Payroll≠Accounting, session cache.
 * Run: npx tsx src/modules/schoolModuleEntitlements.phase3b.unit.test.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  MODULE_PRESETS,
  asSchoolModuleEntitlements,
  clearSchoolModuleEntitlements,
  describeModulePackageLabel,
  discardEntitlementsIfSchoolMismatch,
  getEntitlementBoundSchoolId,
  getSchoolModuleEntitlements,
  hasSchoolModule,
  requiredModuleForSchoolPage,
  setSchoolModuleEntitlements,
  syncSchoolModuleEntitlementsFromAuthResponse,
  SCHOOL_MODULE_ENTITLEMENTS_STORAGE_KEY,
  SCHOOL_MODULE_ENTITLEMENTS_SCHOOL_ID_KEY,
} from "./schoolModuleEntitlements";
import {
  canAccessSchoolPage,
  evaluateSchoolPageAccess,
} from "../auth/schoolAccess";
import {
  clearSchoolSession,
  syncSchoolSessionFromLoginResponse,
  type SchoolSessionUser,
} from "../auth/schoolSession";
import { permissionsForRole } from "../users/permissions";

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
function viewer(): SchoolSessionUser {
  return { appRole: "Viewer", permissions: permissionsForRole("Viewer"), isActive: true };
}
function finance(): SchoolSessionUser {
  return { appRole: "Finance", permissions: permissionsForRole("Finance"), isActive: true };
}

const CORE_PAGES = [
  "dashboard",
  "registrations",
  "admissions",
  "employees",
  "attendance",
  "educlock",
  "statements",
  "invoices",
  "payments",
  "accountingBanking",
  "fees",
  "plans",
  "runs",
  "reports",
] as const;

const ACCOUNTING_PAGES = [
  "accountingOverview",
  "accountingExpenses",
  "accountingSuppliers",
  "accountingJournals",
  "accountingChartOfAccounts",
  "accountingSettings",
] as const;

function assertNavVisibility(
  label: string,
  entitlements: ReturnType<typeof asSchoolModuleEntitlements>,
  expect: { accounting: boolean; payroll: boolean; banking: boolean; educlock: boolean }
) {
  const u = owner();
  for (const page of CORE_PAGES) {
    assert.strictEqual(
      canAccessSchoolPage(page, u, entitlements),
      true,
      `${label}: core page ${page} should be allowed`
    );
  }
  for (const page of ACCOUNTING_PAGES) {
    assert.strictEqual(
      canAccessSchoolPage(page, u, entitlements),
      expect.accounting,
      `${label}: ${page}`
    );
  }
  assert.strictEqual(canAccessSchoolPage("payroll", u, entitlements), expect.payroll, `${label}: payroll`);
  assert.strictEqual(
    canAccessSchoolPage("accountingBanking", u, entitlements),
    expect.banking,
    `${label}: banking`
  );
  assert.strictEqual(canAccessSchoolPage("educlock", u, entitlements), expect.educlock, `${label}: educlock`);
}

function main() {
  memory.clear();

  // --- Presets ---
  assert.strictEqual(describeModulePackageLabel(MODULE_PRESETS.CORE_ONLY), "Core");
  assert.strictEqual(describeModulePackageLabel(MODULE_PRESETS.ACCOUNTING_ONLY), "Accounting");
  assert.strictEqual(describeModulePackageLabel(MODULE_PRESETS.PAYROLL_ONLY), "Payroll");
  assert.strictEqual(
    describeModulePackageLabel(MODULE_PRESETS.ACCOUNTING_PAYROLL),
    "Accounting + Payroll"
  );
  assert.strictEqual(describeModulePackageLabel(MODULE_PRESETS.CORE_ACCOUNTING), "Core + Accounting");
  assert.strictEqual(describeModulePackageLabel(MODULE_PRESETS.CORE_PAYROLL), "Core + Payroll");
  assert.strictEqual(describeModulePackageLabel(MODULE_PRESETS.FULL), "Full");
  assert.strictEqual(describeModulePackageLabel(MODULE_PRESETS.NONE), "Invalid / No modules");

  // Explicit CORE=false preserved through normalize/cache
  const accountingOnly = asSchoolModuleEntitlements({
    CORE: false,
    ACCOUNTING: true,
    PAYROLL: false,
  });
  assert.deepStrictEqual(accountingOnly, MODULE_PRESETS.ACCOUNTING_ONLY);
  assert.strictEqual(hasSchoolModule("CORE", accountingOnly), false);
  assert.strictEqual(hasSchoolModule("ACCOUNTING", accountingOnly), true);
  setSchoolModuleEntitlements(accountingOnly, "school-acc");
  assert.deepStrictEqual(getSchoolModuleEntitlements("school-acc"), MODULE_PRESETS.ACCOUNTING_ONLY);
  // Missing/invalid payload still fail-opens Full
  assert.deepStrictEqual(asSchoolModuleEntitlements(null), MODULE_PRESETS.FULL);
  assert.deepStrictEqual(asSchoolModuleEntitlements(undefined), MODULE_PRESETS.FULL);
  assert.deepStrictEqual(asSchoolModuleEntitlements("x"), MODULE_PRESETS.FULL);
  // --- CORE ONLY ---
  assertNavVisibility("CORE ONLY", MODULE_PRESETS.CORE_ONLY, {
    accounting: false,
    payroll: false,
    banking: true,
    educlock: true,
  });
  {
    const d = evaluateSchoolPageAccess("accountingOverview", owner(), MODULE_PRESETS.CORE_ONLY);
    assert.ok(!d.allowed && d.reason === "module" && d.module === "ACCOUNTING");
  }
  {
    const d = evaluateSchoolPageAccess("payroll", owner(), MODULE_PRESETS.CORE_ONLY);
    assert.ok(!d.allowed && d.reason === "module" && d.module === "PAYROLL");
  }

  // --- CORE + ACCOUNTING ---
  assertNavVisibility("CORE+ACCOUNTING", MODULE_PRESETS.CORE_ACCOUNTING, {
    accounting: true,
    payroll: false,
    banking: true,
    educlock: true,
  });
  {
    const d = evaluateSchoolPageAccess("payroll", owner(), MODULE_PRESETS.CORE_ACCOUNTING);
    assert.ok(!d.allowed && d.reason === "module");
  }

  // --- CORE + PAYROLL (ACCOUNTING OFF) — critical ---
  assertNavVisibility("CORE+PAYROLL", MODULE_PRESETS.CORE_PAYROLL, {
    accounting: false,
    payroll: true,
    banking: true,
    educlock: true,
  });
  assert.strictEqual(hasSchoolModule("PAYROLL", MODULE_PRESETS.CORE_PAYROLL), true);
  assert.strictEqual(hasSchoolModule("ACCOUNTING", MODULE_PRESETS.CORE_PAYROLL), false);
  assert.strictEqual(requiredModuleForSchoolPage("payroll"), "PAYROLL");
  assert.strictEqual(requiredModuleForSchoolPage("accountingBanking"), null);
  {
    const d = evaluateSchoolPageAccess("accountingExpenses", owner(), MODULE_PRESETS.CORE_PAYROLL);
    assert.ok(!d.allowed && d.reason === "module" && d.module === "ACCOUNTING");
  }
  assert.strictEqual(
    canAccessSchoolPage("payroll", owner(), MODULE_PRESETS.CORE_PAYROLL),
    true
  );

  // --- FULL ---
  assertNavVisibility("FULL", MODULE_PRESETS.FULL, {
    accounting: true,
    payroll: true,
    banking: true,
    educlock: true,
  });

  // --- RBAC ---
  assert.strictEqual(
    canAccessSchoolPage("payroll", viewer(), MODULE_PRESETS.FULL),
    false,
    "module ON + permission OFF"
  );
  {
    const d = evaluateSchoolPageAccess("payroll", viewer(), MODULE_PRESETS.FULL);
    assert.ok(!d.allowed && d.reason === "permission");
  }
  {
    const d = evaluateSchoolPageAccess(
      "accountingOverview",
      finance(),
      MODULE_PRESETS.CORE_PAYROLL
    );
    assert.ok(!d.allowed && d.reason === "module", "module OFF + permission ON → module denial");
  }
  assert.strictEqual(
    canAccessSchoolPage("payroll", owner(), MODULE_PRESETS.CORE_PAYROLL),
    true,
    "module ON + permission ON"
  );

  // --- Session / cache ---
  memory.clear();
  setSchoolModuleEntitlements(MODULE_PRESETS.CORE_ONLY, "school-a");
  assert.strictEqual(getEntitlementBoundSchoolId(), "school-a");
  assert.strictEqual(getSchoolModuleEntitlements("school-a").ACCOUNTING, false);

  // Different school must not inherit school-a flags via get(..., school-b)
  // (returns fail-open defaults when requesting mismatched school without overwrite)
  const foreignRead = getSchoolModuleEntitlements("school-b");
  assert.strictEqual(foreignRead.ACCOUNTING, true, "mismatch read uses fail-open defaults");

  // School switch via auth sync overwrites
  syncSchoolModuleEntitlementsFromAuthResponse({
    moduleEntitlements: MODULE_PRESETS.CORE_PAYROLL,
    user: { schoolId: "school-b", appRole: "Owner", permissions: {} },
    school: { id: "school-b" },
  });
  assert.strictEqual(getEntitlementBoundSchoolId(), "school-b");
  assert.strictEqual(getSchoolModuleEntitlements("school-b").PAYROLL, true);
  assert.strictEqual(getSchoolModuleEntitlements("school-b").ACCOUNTING, false);

  // Successful /auth/me overwrite
  syncSchoolModuleEntitlementsFromAuthResponse({
    moduleEntitlements: MODULE_PRESETS.FULL,
    user: { schoolId: "school-b", appRole: "Owner", permissions: {} },
  });
  assert.deepStrictEqual(getSchoolModuleEntitlements("school-b"), MODULE_PRESETS.FULL);

  // Logout clears
  clearSchoolSession();
  assert.strictEqual(localStorage.getItem(SCHOOL_MODULE_ENTITLEMENTS_STORAGE_KEY), null);
  assert.strictEqual(localStorage.getItem(SCHOOL_MODULE_ENTITLEMENTS_SCHOOL_ID_KEY), null);

  // Login path: clear then sync another school
  clearSchoolSession();
  syncSchoolSessionFromLoginResponse({
    moduleEntitlements: MODULE_PRESETS.CORE_ACCOUNTING,
    user: {
      schoolId: "school-c",
      appRole: "Owner",
      permissions: permissionsForRole("Owner"),
    },
    school: { id: "school-c" },
  });
  assert.strictEqual(getEntitlementBoundSchoolId(), "school-c");
  assert.strictEqual(getSchoolModuleEntitlements("school-c").ACCOUNTING, true);
  assert.strictEqual(getSchoolModuleEntitlements("school-c").PAYROLL, false);

  // Mismatch discard
  setSchoolModuleEntitlements(MODULE_PRESETS.CORE_ONLY, "school-old");
  assert.strictEqual(discardEntitlementsIfSchoolMismatch("school-new"), true);
  assert.strictEqual(getEntitlementBoundSchoolId(), "");

  // School change with missing entitlements payload → defaults for new school (not old flags)
  setSchoolModuleEntitlements(MODULE_PRESETS.CORE_ONLY, "school-old");
  syncSchoolModuleEntitlementsFromAuthResponse({
    user: { schoolId: "school-new", appRole: "Owner", permissions: {} },
    school: { id: "school-new" },
  });
  assert.strictEqual(getEntitlementBoundSchoolId(), "school-new");
  assert.strictEqual(getSchoolModuleEntitlements("school-new").ACCOUNTING, true);
  assert.strictEqual(getSchoolModuleEntitlements("school-new").PAYROLL, true);

  // --- Source contracts: Payroll optional Accounting ---
  const payrollSrc = fs.readFileSync(path.join(__dirname, "../Payroll.tsx"), "utf8");
  assert.ok(payrollSrc.includes('hasSchoolModule("ACCOUNTING")'));
  assert.ok(payrollSrc.includes("accountingModuleEnabled"));
  assert.ok(payrollSrc.includes("schoolId && accountingModuleEnabled"));
  assert.ok(payrollSrc.includes("results.length > 0 && schoolId && accountingModuleEnabled"));
  assert.ok(
    payrollSrc.includes("!schoolId || !accountingModuleEnabled") ||
      payrollSrc.includes("!accountingModuleEnabled || !schoolId"),
    "COA repair / events gated"
  );

  // Dashboard nav contracts
  const dash = fs.readFileSync(path.join(__dirname, "../SchoolDashboard.tsx"), "utf8");
  const accountingSubmenu = dash.slice(
    dash.indexOf("<span>Accounting</span>"),
    dash.indexOf("<span>Communication</span>")
  );
  assert.ok(!accountingSubmenu.includes('go("educlock")'));
  assert.ok(!accountingSubmenu.includes('go("payroll")'));
  assert.ok(!accountingSubmenu.includes('go("accountingBanking")'));
  assert.ok(dash.includes('go("accountingBanking")'), "Banking under Billing");
  assert.ok(dash.includes("hasPayrollModule ? tabButton"));
  assert.ok(dash.includes("Staff Active"));
  assert.ok(dash.includes("discardEntitlementsIfSchoolMismatch"));

  // Banking ACCOUNTING off/on controls
  const banking = fs.readFileSync(
    path.join(__dirname, "../banking/BankStatementImport.tsx"),
    "utf8"
  );
  assert.ok(banking.includes('hasSchoolModule("ACCOUNTING")'));
  assert.ok(banking.includes("Expense Matches"));
  assert.ok(banking.includes("accountingEnabled ?"));
  assert.ok(banking.includes("Payment Matches"));
  assert.ok(banking.includes("accountingEnabled && txn.moneyOut"));

  // Single Banking menu (Billing only)
  const bankingNavHits = dash.split('go("accountingBanking")').length - 1;
  assert.ok(bankingNavHits >= 1, "Banking nav present");
  assert.ok(!accountingSubmenu.includes("Banking"), "no Banking under Accounting");

  console.log("✓ schoolModuleEntitlements.phase3b.unit.test.ts passed");
}

main();
