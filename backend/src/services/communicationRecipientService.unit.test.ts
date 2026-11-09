/**
 * Communication Centre recipient audience, auth and credit estimate.
 * Run: node --import tsx src/services/communicationRecipientService.unit.test.ts
 */
import assert from "node:assert/strict";
import {
  assertCommunicationAudienceAllowed,
  assertContactAllowedForActor,
  assertContactsAllowedForActor,
  estimateCommunicationSmsCredits,
  parseAudienceMode,
  parseClassScope,
} from "./communicationRecipientService";

const admin = { isSchoolWideAdmin: true, assignedClassNames: ["Grade 1A", "Grade 2B"] };
const teacher = { isSchoolWideAdmin: false, assignedClassNames: ["Grade 1A"] };
const teacherNoClasses = { isSchoolWideAdmin: false, assignedClassNames: [] as string[] };

function testParseHelpers() {
  assert.equal(parseAudienceMode("all_parents"), "all_parents");
  assert.equal(parseAudienceMode(""), "legacy");
  assert.equal(parseClassScope("all_in_grade"), "all_in_grade");
  assert.equal(parseClassScope(""), "classroom");
}

function testAdminAudienceAllowed() {
  assert.equal(assertCommunicationAudienceAllowed(admin, { audience: "all_parents", kind: "parents" }), null);
  assert.equal(
    assertCommunicationAudienceAllowed(admin, {
      audience: "by_class",
      classScope: "grade",
      grade: "1",
      kind: "parents",
    }),
    null
  );
  assert.equal(
    assertCommunicationAudienceAllowed(admin, {
      audience: "by_class",
      classScope: "classroom",
      className: "Grade 1A",
      kind: "parents",
    }),
    null
  );
  assert.match(
    String(
      assertCommunicationAudienceAllowed(admin, {
        audience: "by_class",
        classScope: "classroom",
        kind: "parents",
      })
    ),
    /classroom/i
  );
}

function testTeacherAudienceDeniedSchoolWide() {
  assert.match(
    String(assertCommunicationAudienceAllowed(teacher, { audience: "all_parents", kind: "parents" })),
    /assigned classrooms/i
  );
  assert.match(
    String(
      assertCommunicationAudienceAllowed(teacher, {
        audience: "by_class",
        classScope: "grade",
        grade: "1",
        kind: "parents",
      })
    ),
    /entire grade/i
  );
  assert.match(
    String(
      assertCommunicationAudienceAllowed(teacher, {
        audience: "by_class",
        classScope: "all_in_grade",
        grade: "1",
        kind: "parents",
      })
    ),
    /entire grade/i
  );
  assert.match(
    String(assertCommunicationAudienceAllowed(teacher, { audience: "legacy", kind: "employees" })),
    /employee|all-contact/i
  );
}

function testTeacherAudienceAssignedClassOk() {
  assert.equal(
    assertCommunicationAudienceAllowed(teacher, {
      audience: "by_class",
      classScope: "classroom",
      className: "Grade 1A",
      kind: "parents",
    }),
    null
  );
  assert.equal(
    assertCommunicationAudienceAllowed(teacher, {
      audience: "individual",
      kind: "parents",
    }),
    null
  );
  assert.match(
    String(
      assertCommunicationAudienceAllowed(teacher, {
        audience: "by_class",
        classScope: "classroom",
        className: "Grade 9Z",
        kind: "parents",
      })
    ),
    /assigned classrooms/i
  );
  assert.match(
    String(assertCommunicationAudienceAllowed(teacherNoClasses, { audience: "individual", kind: "parents" })),
    /No assigned classrooms/i
  );
}

function testContactAuth() {
  assert.equal(
    assertContactAllowedForActor(admin, {
      source: "manual",
      contactName: "X",
    }),
    null
  );
  assert.match(
    String(
      assertContactAllowedForActor(teacher, {
        source: "manual",
        contactName: "X",
      })
    ),
    /verified parents/i
  );
  assert.equal(
    assertContactAllowedForActor(teacher, {
      source: "parent",
      sourceId: "p1",
      classNames: ["Grade 1A"],
      contactName: "Parent",
    }),
    null
  );
  assert.match(
    String(
      assertContactAllowedForActor(teacher, {
        source: "parent",
        sourceId: "p2",
        classNames: ["Grade 9Z"],
        contactName: "Other",
      })
    ),
    /assigned classrooms/i
  );
  assert.match(
    String(assertContactsAllowedForActor(teacher, [])),
    /at least one contact/i
  );
}

function testCreditEstimate() {
  const one = estimateCommunicationSmsCredits("Hello parent", 1);
  assert.equal(one.segments, 1);
  assert.equal(one.recipientCount, 1);
  assert.equal(one.estimatedCredits, 1);

  const multi = estimateCommunicationSmsCredits("Hello parent", 12);
  assert.equal(multi.estimatedCredits, multi.segments * 12);

  const empty = estimateCommunicationSmsCredits("", 5);
  assert.equal(empty.segments, 0);
  assert.equal(empty.estimatedCredits, 0);
}

testParseHelpers();
testAdminAudienceAllowed();
testTeacherAudienceDeniedSchoolWide();
testTeacherAudienceAssignedClassOk();
testContactAuth();
testCreditEstimate();
console.log("communicationRecipientService.unit.test.ts: ok");
