/**
 * Backend Communications RBAC catalog + centre access helper.
 * Run: npx tsx src/utils/communicationsPermissions.unit.test.ts
 *
 * Intentionally avoids importing Express middleware (pulls Prisma).
 */
import assert from "node:assert/strict";
import {
  PERMISSION_MODULES,
  emptyPermissionMap,
  hasCommunicationsPermission,
  mergePermissions,
  permissionsForRole,
  resolveStoredPermissions,
} from "./userPermissions";
import { allowCommunicationsCentreActor } from "./communicationsCentreAccess";

function main() {
  assert.ok(PERMISSION_MODULES.some((m) => m.key === "communications"));

  const admin = permissionsForRole("Admin");
  assert.equal(admin.communications?.view, true);
  assert.equal(admin.communications?.create, true);
  assert.equal(admin.communications?.edit, true);
  assert.equal(admin.communications?.delete, true);
  assert.equal(admin.communications?.print, true);
  assert.equal(admin.communications?.send, true);

  const teacher = permissionsForRole("Teacher");
  assert.equal(teacher.communications?.view, false);
  assert.equal(teacher.teachers?.view, true);

  const finance = permissionsForRole("Finance");
  assert.equal(finance.communications?.view, false);

  const viewer = permissionsForRole("Viewer");
  assert.equal(viewer.communications?.view, false);

  // Soft-fill legacy Admin map missing communications key
  const legacy = mergePermissions(admin);
  delete (legacy as any).communications;
  const filled = resolveStoredPermissions("Admin", legacy as any);
  assert.equal(filled.communications?.view, true);

  // Explicit deny after matrix save
  const denied = mergePermissions({
    ...admin,
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
    hasCommunicationsPermission({ appRole: "Admin", isActive: true, permissions: denied }, "view"),
    false
  );

  // Teacher class-scoped centre surfaces
  assert.equal(
    allowCommunicationsCentreActor(
      { auth: { appRole: "Teacher", permissions: teacher } },
      "view"
    ),
    true
  );
  assert.equal(
    allowCommunicationsCentreActor(
      { auth: { appRole: "Teacher", permissions: teacher } },
      "create"
    ),
    true
  );
  assert.equal(
    allowCommunicationsCentreActor(
      { auth: { appRole: "Teacher", permissions: teacher } },
      "delete"
    ),
    false
  );

  // Custom with no communications — denied for staff centre
  const empty = emptyPermissionMap();
  assert.equal(
    allowCommunicationsCentreActor({ auth: { appRole: "Custom", permissions: empty } }, "view"),
    false
  );
  assert.equal(
    hasCommunicationsPermission({ appRole: "Custom", isActive: true, permissions: empty }, "send"),
    false
  );

  // Owner always
  assert.equal(
    hasCommunicationsPermission(
      { appRole: "Owner", isActive: true, permissions: emptyPermissionMap() },
      "send"
    ),
    true
  );

  // Persist round-trip: merge then resolve keeps explicit grants
  const granted = mergePermissions({
    ...emptyPermissionMap(),
    communications: { view: true, send: true },
  });
  const again = resolveStoredPermissions("Custom", granted);
  assert.equal(again.communications?.view, true);
  assert.equal(again.communications?.send, true);
  assert.equal(again.communications?.edit, false);

  console.log("✓ backend communications permissions unit tests passed");
}

main();
