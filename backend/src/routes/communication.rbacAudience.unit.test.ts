/**
 * Dual-gate regression: communications.* RBAC AND audience/classroom scope.
 * Pure unit — no HTTP / DB / outbound SMS-email.
 *
 * Run: node --import tsx src/routes/communication.rbacAudience.unit.test.ts
 */
import assert from "node:assert/strict";
import { evaluateCommunicationsAuth } from "../utils/evaluateCommunicationsAuth";
import {
  emptyPermissionMap,
  mergePermissions,
  permissionsForRole,
} from "../utils/userPermissions";
import {
  assertCommunicationAudienceAllowed,
  assertContactsAllowedForActor,
  parseAudienceMode,
} from "../services/communicationRecipientService";

const teacherActor = { isSchoolWideAdmin: false, assignedClassNames: ["Class A"] };
const adminActor = { isSchoolWideAdmin: true, assignedClassNames: ["Class A"] };

function teacherWithCommsSend() {
  return mergePermissions({
    ...permissionsForRole("Teacher"),
    communications: {
      view: true,
      create: true,
      edit: true,
      delete: true,
      print: true,
      send: true,
    },
  });
}

function viewOnlyComms() {
  return mergePermissions({
    ...emptyPermissionMap(),
    communications: { view: true },
  });
}

function main() {
  // 1) Default Teacher template cannot enter Centre APIs
  assert.equal(
    evaluateCommunicationsAuth({
      auth: {
        appRole: "Teacher",
        authorizedSchoolId: "s1",
        permissions: permissionsForRole("Teacher"),
      },
      requireAction: "view",
      requestSchoolId: "s1",
    }).allowed,
    false,
    "Teacher template lacks communications.view"
  );

  // 2) Explicit communications.send still requires audience scope
  assert.equal(
    evaluateCommunicationsAuth({
      auth: {
        appRole: "Teacher",
        authorizedSchoolId: "s1",
        permissions: teacherWithCommsSend(),
      },
      requireAction: "send",
      requestSchoolId: "s1",
    }).allowed,
    true,
    "Teacher with communications.send passes RBAC"
  );
  assert.ok(
    assertCommunicationAudienceAllowed(teacherActor, {
      audience: parseAudienceMode("all_parents"),
      kind: "parents",
    }),
    "same teacher still denied school-wide audience"
  );

  // 3) View never implies send
  assert.equal(
    evaluateCommunicationsAuth({
      auth: {
        appRole: "Custom",
        authorizedSchoolId: "s1",
        permissions: viewOnlyComms(),
      },
      requireAction: "view",
      requestSchoolId: "s1",
    }).allowed,
    true
  );
  assert.equal(
    evaluateCommunicationsAuth({
      auth: {
        appRole: "Custom",
        authorizedSchoolId: "s1",
        permissions: viewOnlyComms(),
      },
      requireAction: "send",
      requestSchoolId: "s1",
    }).allowed,
    false,
    "communications.view must not authorise send"
  );
  assert.equal(
    evaluateCommunicationsAuth({
      auth: {
        appRole: "Custom",
        authorizedSchoolId: "s1",
        permissions: viewOnlyComms(),
      },
      requireAction: "create",
      requestSchoolId: "s1",
    }).allowed,
    false,
    "communications.view must not authorise create"
  );

  // 4) Admin RBAC + school-wide audience both allow
  assert.equal(
    evaluateCommunicationsAuth({
      auth: {
        appRole: "Admin",
        authorizedSchoolId: "s1",
        permissions: permissionsForRole("Admin"),
      },
      requireAction: "send",
      requestSchoolId: "s1",
    }).allowed,
    true
  );
  assert.equal(
    assertCommunicationAudienceAllowed(adminActor, {
      audience: "all_parents",
      kind: "parents",
    }),
    null
  );

  // 5) Teacher with send may message assigned class parents only
  assert.equal(
    assertCommunicationAudienceAllowed(teacherActor, {
      audience: "by_class",
      classScope: "classroom",
      className: "Class A",
      kind: "parents",
    }),
    null
  );
  assert.ok(
    assertCommunicationAudienceAllowed(teacherActor, {
      audience: "by_class",
      classScope: "classroom",
      className: "Class Z",
      kind: "parents",
    })
  );
  assert.ok(
    assertContactsAllowedForActor(teacherActor, [
      { source: "parent", sourceId: "p-z", classNames: ["Class Z"], contactName: "Out" },
    ])
  );

  // 6) School mismatch still blocks even with communications.send + in-scope audience
  const mismatch = evaluateCommunicationsAuth({
    auth: {
      appRole: "Teacher",
      authorizedSchoolId: "s1",
      permissions: teacherWithCommsSend(),
    },
    requireAction: "send",
    requestSchoolId: "other",
  });
  assert.equal(mismatch.allowed, false);
  if (!mismatch.allowed) assert.equal(mismatch.code, "SCHOOL_MISMATCH");

  console.log("communication.rbacAudience.unit.test.ts: ok");
}

main();
