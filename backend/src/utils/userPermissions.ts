export const PERMISSION_ACTIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "print",
  "send",
  "manage",
] as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[number];

export const PERMISSION_MODULES = [
  { key: "dashboard", label: "Dashboard" },
  { key: "registrations", label: "Registrations" },
  { key: "learners", label: "Learners" },
  { key: "parents", label: "Parents" },
  { key: "attendance", label: "Attendance" },
  { key: "classrooms", label: "Classrooms" },
  { key: "employees", label: "Employees" },
  { key: "teachers", label: "Teachers" },
  { key: "users", label: "Users" },
  { key: "billing", label: "Billing" },
  { key: "statements", label: "Statements" },
  { key: "payments", label: "Payments" },
  { key: "invoices", label: "Invoices" },
  { key: "invoiceRuns", label: "Invoice Runs" },
  { key: "billingPlans", label: "Billing Plans" },
  { key: "billingDocuments", label: "Billing Documents" },
  { key: "legalDocuments", label: "Legal Documents" },
  { key: "reports", label: "Reports" },
  { key: "payroll", label: "Payroll" },
  { key: "settings", label: "Settings" },
] as const;

export type ModuleKey = (typeof PERMISSION_MODULES)[number]["key"];

export type PermissionMap = Record<ModuleKey, Partial<Record<PermissionAction, boolean>>>;

export const APP_ROLES = [
  "Owner",
  "Admin",
  "Finance",
  "Teacher",
  "Viewer",
  "Custom",
] as const;

export type AppRole = (typeof APP_ROLES)[number];

export function emptyPermissionMap(): PermissionMap {
  const map = {} as PermissionMap;
  for (const mod of PERMISSION_MODULES) {
    map[mod.key] = {};
    for (const action of PERMISSION_ACTIONS) {
      map[mod.key][action] = false;
    }
  }
  return map;
}

export function allPermissionsTrue(): PermissionMap {
  const map = emptyPermissionMap();
  for (const mod of PERMISSION_MODULES) {
    for (const action of PERMISSION_ACTIONS) {
      map[mod.key][action] = true;
    }
  }
  return map;
}

function withPermissions(partial: Partial<Record<ModuleKey, Partial<Record<PermissionAction, boolean>>>>): PermissionMap {
  const base = emptyPermissionMap();
  for (const mod of PERMISSION_MODULES) {
    const actions = partial[mod.key];
    if (!actions) continue;
    for (const action of PERMISSION_ACTIONS) {
      if (typeof actions[action] === "boolean") {
        base[mod.key][action] = actions[action];
      }
    }
  }
  return base;
}

export const roleTemplates: Record<Exclude<AppRole, "Custom">, PermissionMap> = {
  Owner: allPermissionsTrue(),
  Admin: withPermissions({
    dashboard: { view: true, manage: true },
    registrations: { view: true, create: true, edit: true, print: true },
    learners: { view: true, create: true, edit: true, print: true },
    parents: { view: true, create: true, edit: true, print: true },
    attendance: { view: true, edit: true },
    classrooms: { view: true, edit: true },
    employees: { view: true, edit: true },
    teachers: { view: true, edit: true },
    users: { view: true, create: true, edit: true, manage: true },
    billing: { view: true, print: true },
    statements: { view: true, print: true },
    payments: { view: true },
    invoices: { view: true, print: true },
    invoiceRuns: { view: true },
    billingPlans: { view: true },
    billingDocuments: { view: true, print: true },
    legalDocuments: { view: true, print: true },
    reports: { view: true, print: true },
    payroll: { view: true },
    settings: { view: true, edit: true, manage: true },
  }),
  Finance: withPermissions({
    dashboard: { view: true },
    registrations: { view: true },
    learners: { view: true },
    parents: { view: true },
    billing: { view: true, create: true, edit: true, manage: true },
    statements: { view: true, create: true, edit: true, print: true, send: true },
    payments: { view: true, create: true, edit: true, print: true },
    invoices: { view: true, create: true, edit: true, print: true },
    invoiceRuns: { view: true, create: true, edit: true, manage: true },
    billingPlans: { view: true, edit: true },
    billingDocuments: { view: true, create: true, edit: true, print: true, send: true },
    legalDocuments: { view: true, create: true, edit: true, print: true, send: true },
    reports: { view: true, print: true },
  }),
  Teacher: withPermissions({
    dashboard: { view: true },
    learners: { view: true },
    attendance: { view: true, create: true, edit: true },
    classrooms: { view: true },
    teachers: { view: true },
    reports: { view: true },
  }),
  Viewer: withPermissions({
    dashboard: { view: true },
    registrations: { view: true },
    learners: { view: true },
    parents: { view: true },
    attendance: { view: true },
    classrooms: { view: true },
    reports: { view: true },
  }),
};

export function permissionsForRole(appRole: string, custom?: PermissionMap | null): PermissionMap {
  if (appRole === "Owner") return allPermissionsTrue();
  if (appRole === "Custom" && custom) return mergePermissions(custom);
  const template = roleTemplates[appRole as Exclude<AppRole, "Custom">];
  return template ? mergePermissions(template) : emptyPermissionMap();
}

export function mergePermissions(input: PermissionMap): PermissionMap {
  const base = emptyPermissionMap();
  for (const mod of PERMISSION_MODULES) {
    for (const action of PERMISSION_ACTIONS) {
      base[mod.key][action] = Boolean(input?.[mod.key]?.[action]);
    }
  }
  return base;
}

export function hasPermission(
  user: { appRole?: string; isActive?: boolean; permissions?: PermissionMap | null },
  module: ModuleKey,
  action: PermissionAction
): boolean {
  if (user.isActive === false) return false;
  if (user.appRole === "Owner") return true;
  const perms =
    user.appRole === "Custom" && user.permissions
      ? mergePermissions(user.permissions)
      : permissionsForRole(String(user.appRole || "Viewer"), user.permissions || null);
  return Boolean(perms[module]?.[action]);
}

export function prismaRoleForAppRole(appRole: string): "SCHOOL_ADMIN" | "FINANCE" | "STAFF" {
  if (appRole === "Owner" || appRole === "Admin") return "SCHOOL_ADMIN";
  if (appRole === "Finance") return "FINANCE";
  return "STAFF";
}
