/**
 * Phase 5C — frontend module surfaces, navigation, landing, guards.
 * Run: npx tsx src/modules/schoolModuleEntitlements.phase5c.unit.test.ts
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
  describeModulePackageLabel,
  getSchoolModuleEntitlements,
  hasSchoolModule,
  isSchoolPageModuleEntitled,
  requiredModuleForSchoolPage,
  schoolPageModuleRequirement,
  setSchoolModuleEntitlements,
  syncSchoolModuleEntitlementsFromAuthResponse,
  SCHOOL_MODULE_ENTITLEMENTS_STORAGE_KEY,
  SCHOOL_MODULE_ENTITLEMENTS_SCHOOL_ID_KEY,
} from "./schoolModuleEntitlements";
import {
  canAccessSchoolPage,
  evaluateSchoolPageAccess,
  resolvePreferredLandingPage,
} from "../auth/schoolAccess";
import {
  clearSchoolSession,
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

const CORE_SURFACES = [
  "dashboard",
  "registrations",
  "admissions",
  "attendance",
  "educlock",
  "statements",
  "invoices",
  "payments",
  "fees",
  "plans",
  "runs",
  "reports",
  "communicationCentre",
  "parentPortal",
] as const;

type MatrixExpect = {
  core: boolean;
  accounting: boolean;
  payroll: boolean;
  employees: boolean;
  banking: boolean;
  educlock: boolean;
  landing: string;
};

function assertPackageMatrix(label: string, entitlements: typeof MODULE_PRESETS.FULL, expect: MatrixExpect) {
  const u = owner();
  for (const page of CORE_SURFACES) {
    assert.strictEqual(
      canAccessSchoolPage(page, u, entitlements),
      expect.core,
      `${label}: core surface ${page}`
    );
  }
  for (const page of ACCOUNTING_SAFE_STANDALONE_PAGES) {
    assert.strictEqual(
      canAccessSchoolPage(page, u, entitlements),
      expect.accounting,
      `${label}: accounting ${page}`
    );
  }
  assert.strictEqual(canAccessSchoolPage("payroll", u, entitlements), expect.payroll, `${label}: payroll`);
  assert.strictEqual(canAccessSchoolPage("employees", u, entitlements), expect.employees, `${label}: employees`);
  assert.strictEqual(
    canAccessSchoolPage("accountingBanking", u, entitlements),
    expect.banking,
    `${label}: banking`
  );
  assert.strictEqual(canAccessSchoolPage("educlock", u, entitlements), expect.educlock, `${label}: educlock`);
  assert.strictEqual(
    resolvePreferredLandingPage(u, entitlements),
    expect.landing,
    `${label}: landing`
  );
}

function main() {
  memory.clear();

  // --- Package labels (7 + invalid) ---
  assert.strictEqual(describeModulePackageLabel(MODULE_PRESETS.CORE_ONLY), "Core");
  assert.strictEqual(describeModulePackageLabel(MODULE_PRESETS.ACCOUNTING_ONLY), "Accounting");
  assert.strictEqual(describeModulePackageLabel(MODULE_PRESETS.PAYROLL_ONLY), "Payroll");
  assert.strictEqual(describeModulePackageLabel(MODULE_PRESETS.ACCOUNTING_PAYROLL), "Accounting + Payroll");
  assert.strictEqual(describeModulePackageLabel(MODULE_PRESETS.CORE_ACCOUNTING), "Core + Accounting");
  assert.strictEqual(describeModulePackageLabel(MODULE_PRESETS.CORE_PAYROLL), "Core + Payroll");
  assert.strictEqual(describeModulePackageLabel(MODULE_PRESETS.FULL), "Full");
  assert.strictEqual(describeModulePackageLabel(MODULE_PRESETS.NONE), "Invalid / No modules");

  // Explicit CORE=false preserved; missing payload fail-open Full
  const explicitCoreOff = asSchoolModuleEntitlements({
    CORE: false,
    ACCOUNTING: true,
    PAYROLL: false,
  });
  assert.strictEqual(explicitCoreOff.CORE, false);
  assert.strictEqual(hasSchoolModule("CORE", explicitCoreOff), false);
  assert.deepStrictEqual(asSchoolModuleEntitlements(null), MODULE_PRESETS.FULL);

  // --- Gate shapes ---
  assert.deepStrictEqual(schoolPageModuleRequirement("educlock"), { kind: "single", module: "CORE" });
  assert.deepStrictEqual(schoolPageModuleRequirement("payroll"), { kind: "single", module: "PAYROLL" });
  assert.deepStrictEqual(schoolPageModuleRequirement("accountingOverview"), {
    kind: "single",
    module: "ACCOUNTING",
  });
  assert.deepStrictEqual(schoolPageModuleRequirement("employees"), {
    kind: "any",
    modules: ["CORE", "PAYROLL"],
  });
  assert.deepStrictEqual(schoolPageModuleRequirement("accountingBanking"), {
    kind: "any",
    modules: ["CORE", "ACCOUNTING"],
  });
  assert.deepStrictEqual(schoolPageModuleRequirement("schoolUsers"), null);
  assert.strictEqual(requiredModuleForSchoolPage("educlock"), "CORE");
  assert.strictEqual(requiredModuleForSchoolPage("employees"), null);
  assert.strictEqual(requiredModuleForSchoolPage("accountingBanking"), null);

  // Phase 5C: ACCOUNTING_CORE_DEPENDENT was multi-page; Phase 5D unlocks FS/Reports/Audit/Export.
  for (const page of ACCOUNTING_CORE_DEPENDENT_PAGES) {
    assert.strictEqual(
      isSchoolPageModuleEntitled(page, MODULE_PRESETS.ACCOUNTING_ONLY),
      false,
      `${page} still requires CORE (school-fee AR)`
    );
    assert.strictEqual(
      isSchoolPageModuleEntitled(page, MODULE_PRESETS.CORE_ACCOUNTING),
      true,
      `${page} ok with CORE+ACCOUNTING`
    );
  }

  // --- Seven-package matrix ---
  assertPackageMatrix("100 Core", MODULE_PRESETS.CORE_ONLY, {
    core: true,
    accounting: false,
    payroll: false,
    employees: true,
    banking: true,
    educlock: true,
    landing: "dashboard",
  });
  assertPackageMatrix("010 Accounting", MODULE_PRESETS.ACCOUNTING_ONLY, {
    core: false,
    accounting: true,
    payroll: false,
    employees: false,
    banking: true,
    educlock: false,
    landing: "accountingOverview",
  });
  assertPackageMatrix("001 Payroll", MODULE_PRESETS.PAYROLL_ONLY, {
    core: false,
    accounting: false,
    payroll: true,
    employees: true,
    banking: false,
    educlock: false,
    landing: "payroll",
  });
  assertPackageMatrix("011 Accounting+Payroll", MODULE_PRESETS.ACCOUNTING_PAYROLL, {
    core: false,
    accounting: true,
    payroll: true,
    employees: true,
    banking: true,
    educlock: false,
    landing: "accountingOverview",
  });
  assertPackageMatrix("110 Core+Accounting", MODULE_PRESETS.CORE_ACCOUNTING, {
    core: true,
    accounting: true,
    payroll: false,
    employees: true,
    banking: true,
    educlock: true,
    landing: "dashboard",
  });
  assertPackageMatrix("101 Core+Payroll", MODULE_PRESETS.CORE_PAYROLL, {
    core: true,
    accounting: false,
    payroll: true,
    employees: true,
    banking: true,
    educlock: true,
    landing: "dashboard",
  });
  assertPackageMatrix("111 Full", MODULE_PRESETS.FULL, {
    core: true,
    accounting: true,
    payroll: true,
    employees: true,
    banking: true,
    educlock: true,
    landing: "dashboard",
  });

  // Direct route module denial (not permission)
  {
    const d = evaluateSchoolPageAccess("statements", owner(), MODULE_PRESETS.ACCOUNTING_ONLY);
    assert.ok(!d.allowed && d.reason === "module" && d.module === "CORE");
  }
  {
    const d = evaluateSchoolPageAccess("employees", owner(), MODULE_PRESETS.ACCOUNTING_ONLY);
    assert.ok(!d.allowed && d.reason === "module");
  }
  {
    const d = evaluateSchoolPageAccess("accountingBanking", owner(), MODULE_PRESETS.PAYROLL_ONLY);
    assert.ok(!d.allowed && d.reason === "module");
  }
  {
    const d = evaluateSchoolPageAccess("educlock", owner(), MODULE_PRESETS.PAYROLL_ONLY);
    assert.ok(!d.allowed && d.reason === "module" && d.module === "CORE");
  }

  // Shared platform stays open without CORE
  assert.strictEqual(
    canAccessSchoolPage("schoolProfile", owner(), MODULE_PRESETS.ACCOUNTING_ONLY),
    true
  );
  assert.strictEqual(
    canAccessSchoolPage("schoolUsers", owner(), MODULE_PRESETS.PAYROLL_ONLY),
    true
  );

  // Employees C||P
  assert.strictEqual(canAccessSchoolPage("employees", owner(), MODULE_PRESETS.CORE_ONLY), true);
  assert.strictEqual(canAccessSchoolPage("employees", owner(), MODULE_PRESETS.PAYROLL_ONLY), true);
  assert.strictEqual(canAccessSchoolPage("employees", owner(), MODULE_PRESETS.ACCOUNTING_ONLY), false);

  // Banking C||A
  assert.strictEqual(canAccessSchoolPage("accountingBanking", owner(), MODULE_PRESETS.CORE_ONLY), true);
  assert.strictEqual(
    canAccessSchoolPage("accountingBanking", owner(), MODULE_PRESETS.ACCOUNTING_ONLY),
    true
  );
  assert.strictEqual(
    canAccessSchoolPage("accountingBanking", owner(), MODULE_PRESETS.PAYROLL_ONLY),
    false
  );

  // Session: explicit CORE=false persists; logout clears
  memory.clear();
  setSchoolModuleEntitlements(MODULE_PRESETS.ACCOUNTING_ONLY, "school-acc");
  assert.strictEqual(hasSchoolModule("CORE", getSchoolModuleEntitlements("school-acc")), false);
  syncSchoolModuleEntitlementsFromAuthResponse({
    moduleEntitlements: MODULE_PRESETS.ACCOUNTING_ONLY,
    user: { schoolId: "school-acc", appRole: "Owner", permissions: {} },
  });
  assert.strictEqual(hasSchoolModule("CORE"), false);
  clearSchoolSession();
  assert.strictEqual(localStorage.getItem(SCHOOL_MODULE_ENTITLEMENTS_STORAGE_KEY), null);
  assert.strictEqual(localStorage.getItem(SCHOOL_MODULE_ENTITLEMENTS_SCHOOL_ID_KEY), null);

  // --- Source contracts ---
  const dash = fs.readFileSync(path.join(__dirname, "../SchoolDashboard.tsx"), "utf8");
  assert.ok(dash.includes("resolvePreferredLandingPage"));
  assert.ok(dash.includes("hasCoreModule"));
  assert.ok(dash.includes('hasCoreModule && canPage("accountingBanking")'));
  assert.ok(dash.includes('!hasCoreModule && canPage("accountingBanking")'));
  assert.ok(dash.includes("hasCoreModule &&"));
  assert.ok(dash.includes('hasPayrollModule ? tabButton("payroll"'));
  assert.ok(dash.includes("moduleEntitlements"));

  const banking = fs.readFileSync(
    path.join(__dirname, "../banking/BankStatementImport.tsx"),
    "utf8"
  );
  assert.ok(banking.includes("coreEnabled"));
  assert.ok(banking.includes("accountingEnabled"));
  assert.ok(banking.includes('...(coreEnabled ? ([["payments", "Payment Matches"]]'));
  assert.ok(banking.includes("Fee-payment posting requires EduClear Core"));

  const payroll = fs.readFileSync(path.join(__dirname, "../Payroll.tsx"), "utf8");
  assert.ok(payroll.includes("eduClockPayrollImportEnabled"));
  assert.ok(payroll.includes("coreModuleEnabled && hasSchoolModule(\"PAYROLL\")"));
  assert.ok(payroll.includes("schoolId && eduClockPayrollImportEnabled"));

  const superAdmin = fs.readFileSync(
    path.join(__dirname, "../pages/SuperAdminSchoolsPage.tsx"),
    "utf8"
  );
  assert.ok(superAdmin.includes("describeModulePackageLabel"));
  assert.ok(superAdmin.includes("EduClear Core"));
  assert.ok(superAdmin.includes("includes Billing"));
  assert.ok(superAdmin.includes("hasAnyCommercialModule"));

  console.log("✓ schoolModuleEntitlements.phase5c.unit.test.ts passed");
}

main();
