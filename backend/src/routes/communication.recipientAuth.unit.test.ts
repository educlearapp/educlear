/**
 * Communication Centre recipient auth helpers used by contacts + send gates.
 * Pure unit coverage (no live API / DB). Route wiring reuses these asserts.
 * Run: node --import tsx src/routes/communication.recipientAuth.unit.test.ts
 */
import assert from "node:assert/strict";
import {
  assertCommunicationAudienceAllowed,
  assertContactsAllowedForActor,
  parseAudienceMode,
} from "../services/communicationRecipientService";

const teacher = { isSchoolWideAdmin: false, assignedClassNames: ["Class A"] };
const admin = { isSchoolWideAdmin: true, assignedClassNames: ["Class A"] };

function testTeacherCannotLoadAllParents() {
  const deny = assertCommunicationAudienceAllowed(teacher, {
    audience: parseAudienceMode("all_parents"),
    kind: "parents",
  });
  assert.ok(deny);
}

function testTeacherCannotSendForeignParent() {
  const deny = assertContactsAllowedForActor(teacher, [
    {
      source: "parent",
      sourceId: "p-other",
      classNames: ["Class Z"],
      contactName: "Other Parent",
    },
  ]);
  assert.ok(deny);
}

function testAdminCanSendManualAndSchoolWide() {
  assert.equal(
    assertCommunicationAudienceAllowed(admin, { audience: "all_parents", kind: "parents" }),
    null
  );
  assert.equal(
    assertContactsAllowedForActor(admin, [
      { source: undefined, contactName: "Manual", classNames: [] },
      { source: "parent", sourceId: "p1", classNames: ["Class Z"], contactName: "P" },
    ]),
    null
  );
}

function testTeacherAssignedParentOk() {
  assert.equal(
    assertContactsAllowedForActor(teacher, [
      {
        source: "parent",
        sourceId: "p1",
        classNames: ["Class A"],
        contactName: "Assigned Parent",
      },
    ]),
    null
  );
}

function testTeacherManualContactDenied() {
  const deny = assertContactsAllowedForActor(teacher, [
    {
      contactName: "Manual",
      classNames: [],
    },
  ]);
  assert.ok(deny);
  assert.match(String(deny), /verified parents/i);
}

function testEmptyContactsMessage() {
  const deny = assertContactsAllowedForActor(teacher, []);
  assert.ok(deny);
  assert.match(String(deny), /at least one contact/i);
}

testTeacherCannotLoadAllParents();
testTeacherCannotSendForeignParent();
testAdminCanSendManualAndSchoolWide();
testTeacherAssignedParentOk();
testTeacherManualContactDenied();
testEmptyContactsMessage();
console.log("communication.recipientAuth.unit.test.ts: ok");
