/**
 * OA-04B unit tests — conversion DTO + auth gates (no DB).
 * Run: npx ts-node --transpile-only src/services/admissions/admissions.oa04b.unit.test.ts
 */
import assert from "assert";

import {
  assertConversionAuthorized,
  parseConversionDecisionDto,
  type ConversionActor,
} from "./admissionsConversionService";
import { StaffAdmissionsError } from "./staffAdmissionsReadService";

function actor(overrides: Partial<ConversionActor> = {}): ConversionActor {
  return {
    userId: "u1",
    schoolId: "school-a",
    appRole: "Admin",
    hasAdmissionsManage: true,
    hasLearnersCreate: true,
    ...overrides,
  };
}

function main() {
  // Auth
  assert.doesNotThrow(() => assertConversionAuthorized(actor()));
  assert.throws(
    () => assertConversionAuthorized(actor({ hasAdmissionsManage: false })),
    (e: unknown) => e instanceof StaffAdmissionsError && e.code === "ADMISSIONS_FORBIDDEN"
  );
  assert.throws(
    () => assertConversionAuthorized(actor({ hasLearnersCreate: false })),
    (e: unknown) => e instanceof StaffAdmissionsError && e.code === "LEARNERS_CREATE_FORBIDDEN"
  );
  assert.throws(
    () => assertConversionAuthorized(actor({ appRole: "Finance" })),
    (e: unknown) => e instanceof StaffAdmissionsError && e.code === "ADMISSIONS_DECISION_FORBIDDEN"
  );
  assert.throws(
    () => assertConversionAuthorized(actor({ appRole: "Teacher", hasAdmissionsManage: true })),
    (e: unknown) => e instanceof StaffAdmissionsError && e.code === "ADMISSIONS_DECISION_FORBIDDEN"
  );

  // DTO happy path
  const dto = parseConversionDecisionDto({
    family: { mode: "CREATE_NEW" },
    guardians: [{ admissionGuardianId: "g1", mode: "CREATE_NEW" }],
    placement: { grade: "Grade 1", className: "1A" },
  });
  assert.strictEqual(dto.family.mode, "CREATE_NEW");
  assert.strictEqual(dto.placement.grade, "Grade 1");
  assert.strictEqual(dto.placement.className, "1A");

  // Protected fields
  assert.throws(
    () =>
      parseConversionDecisionDto({
        schoolId: "x",
        family: { mode: "CREATE_NEW" },
        guardians: [{ admissionGuardianId: "g1", mode: "CREATE_NEW" }],
        placement: { grade: "Grade 1" },
      }),
    (e: unknown) => e instanceof StaffAdmissionsError && e.code === "PROTECTED_FIELD"
  );
  assert.throws(
    () =>
      parseConversionDecisionDto({
        billing: {},
        family: { mode: "CREATE_NEW" },
        guardians: [{ admissionGuardianId: "g1", mode: "CREATE_NEW" }],
        placement: { grade: "Grade 1" },
      }),
    (e: unknown) => e instanceof StaffAdmissionsError && e.code === "PROTECTED_FIELD"
  );

  // Family / guardian validation
  assert.throws(
    () =>
      parseConversionDecisionDto({
        family: { mode: "USE_EXISTING" },
        guardians: [{ admissionGuardianId: "g1", mode: "CREATE_NEW" }],
        placement: { grade: "Grade 1" },
      }),
    (e: unknown) => e instanceof StaffAdmissionsError && e.code === "EXISTING_FAMILY_REQUIRED"
  );
  assert.throws(
    () =>
      parseConversionDecisionDto({
        family: { mode: "CREATE_NEW" },
        guardians: [
          { admissionGuardianId: "g1", mode: "CREATE_NEW" },
          { admissionGuardianId: "g1", mode: "LINK_EXISTING", existingParentId: "p1" },
        ],
        placement: { grade: "Grade 1" },
      }),
    (e: unknown) => e instanceof StaffAdmissionsError && e.code === "DUPLICATE_GUARDIAN_DECISION"
  );
  assert.throws(
    () =>
      parseConversionDecisionDto({
        family: { mode: "CREATE_NEW" },
        guardians: [{ admissionGuardianId: "g1", mode: "LINK_EXISTING" }],
        placement: { grade: "Grade 1" },
      }),
    (e: unknown) => e instanceof StaffAdmissionsError && e.code === "EXISTING_PARENT_REQUIRED"
  );
  assert.throws(
    () =>
      parseConversionDecisionDto({
        family: { mode: "CREATE_NEW" },
        guardians: [{ admissionGuardianId: "g1", mode: "CREATE_NEW" }],
        placement: { grade: "" },
      }),
    (e: unknown) => e instanceof StaffAdmissionsError && e.code === "GRADE_REQUIRED"
  );

  // Ack flag parsing
  const ack = parseConversionDecisionDto({
    family: {
      mode: "CREATE_NEW",
      acknowledgeCreateNewFamilyDespiteSiblingDeclaration: true,
    },
    guardians: [{ admissionGuardianId: "g1", mode: "CREATE_NEW" }],
    placement: { grade: "Grade 2" },
  });
  assert.strictEqual(ack.family.acknowledgeCreateNewFamilyDespiteSiblingDeclaration, true);

  console.log("OA-04B unit tests passed");
}

main();
