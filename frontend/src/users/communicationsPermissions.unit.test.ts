/**
 * Communications module in Users → Permissions matrix.
 * Run: npx tsx src/users/communicationsPermissions.unit.test.ts
 */
import assert from "node:assert/strict";

// Node harness — schoolAccess reads localStorage via isSuperAdmin().
const g = globalThis as typeof globalThis & { localStorage?: Storage };
if (!g.localStorage) {
  const store = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

import {
  PERMISSION_MODULES,
  defaultPermissionGroups,
  emptyPermissionMap,
  hasCommunicationsPermission,
  hasPermission,
  mergePermissions,
  permissionsForRole,
  resolveStoredPermissions,
} from "./permissions";
import { canAccessSchoolPageByPermission } from "../auth/schoolAccess";
import type { SchoolSessionUser } from "../auth/schoolSession";

function user(
  appRole: string,
  permissions: ReturnType<typeof emptyPermissionMap>
): SchoolSessionUser {
  return {
    id: "u1",
    schoolId: "s1",
    email: "u@ex.com",
    firstName: "U",
    surname: "Ser",
    fullName: "U Ser",
    appRole,
    role: "STAFF",
    status: "Active",
    isActive: true,
    permissions,
    lastLoginAt: null,
  } as SchoolSessionUser;
}

function main() {
  assert.ok(
    PERMISSION_MODULES.some((m) => m.key === "communications" && m.label === "Communications"),
    "communications module in catalog"
  );
  assert.ok(
    defaultPermissionGroups.some((g) => g.module === "communications"),
    "matrix groups include Communications"
  );
  const commsGroup = defaultPermissionGroups.find((g) => g.module === "communications")!;
  for (const needed of ["view", "create", "edit", "delete", "print", "send"]) {
    assert.ok(
      commsGroup.actions.some((a) => a.key === needed),
      `Communications supports ${needed}`
    );
  }

  const admin = permissionsForRole("Admin");
  assert.equal(admin.communications?.view, true);
  assert.equal(admin.communications?.send, true);

  const teacher = permissionsForRole("Teacher");
  assert.equal(teacher.communications?.view, false);
  assert.equal(teacher.teachers?.view, true);

  const finance = permissionsForRole("Finance");
  assert.equal(finance.communications?.view, false);

  const viewer = permissionsForRole("Viewer");
  assert.equal(viewer.communications?.view, false);

  // Soft-fill: legacy stored map without communications key → Admin template fill
  const legacyAdminStored = mergePermissions(permissionsForRole("Admin"));
  delete (legacyAdminStored as any).communications;
  const resolved = resolveStoredPermissions("Admin", legacyAdminStored as any);
  assert.equal(resolved.communications?.view, true, "legacy Admin soft-fills communications");

  // Explicit false after Owner saves matrix → denied
  const explicitDeny = mergePermissions({
    ...permissionsForRole("Admin"),
    communications: {
      view: false,
      create: false,
      edit: false,
      delete: false,
      print: false,
      send: false,
    },
  });
  assert.equal(
    hasCommunicationsPermission(user("Admin", explicitDeny), "view"),
    false,
    "explicit deny wins"
  );

  // Teacher Inbox preserved; Communications Centre requires communications.view
  const teacherUser = user("Teacher", teacher);
  assert.equal(canAccessSchoolPageByPermission("teacherInbox", teacherUser), true);
  assert.equal(
    canAccessSchoolPageByPermission("communicationsHub", teacherUser),
    false,
    "teachers do not reach Centre without communications.view"
  );
  assert.equal(
    canAccessSchoolPageByPermission("communicationSms", teacherUser),
    false,
    "teachers do not get SMS centre without communications"
  );
  assert.equal(
    canAccessSchoolPageByPermission("communicationEmail", teacherUser),
    false
  );

  // Staff with communications.view
  const staffMap = emptyPermissionMap();
  staffMap.communications = { view: true, send: true };
  const staff = user("Custom", staffMap);
  assert.equal(canAccessSchoolPageByPermission("communicationSms", staff), true);
  assert.equal(canAccessSchoolPageByPermission("communicationsHub", staff), true);
  assert.equal(hasPermission(staff, "communications", "send"), true);
  assert.equal(hasPermission(staff, "communications", "view"), true);
  assert.equal(hasPermission(staff, "billing", "view"), false);

  // View alone does not imply send
  const viewOnlyMap = emptyPermissionMap();
  viewOnlyMap.communications = { view: true };
  const viewOnly = user("Custom", viewOnlyMap);
  assert.equal(hasPermission(viewOnly, "communications", "view"), true);
  assert.equal(hasPermission(viewOnly, "communications", "send"), false);

  // Unauthorised Custom user — nav and direct page keys denied
  const none = user("Custom", emptyPermissionMap());
  assert.equal(canAccessSchoolPageByPermission("communicationsHub", none), false);
  assert.equal(canAccessSchoolPageByPermission("communicationCentre", none), false);
  assert.equal(canAccessSchoolPageByPermission("communicationEmail", none), false);
  assert.equal(canAccessSchoolPageByPermission("communicationSms", none), false);
  assert.equal(canAccessSchoolPageByPermission("communicationSettings", none), false);

  // Owner always
  assert.equal(
    canAccessSchoolPageByPermission("communicationsHub", user("Owner", emptyPermissionMap())),
    true
  );

  console.log("✓ communications permissions unit tests passed");
}

main();
