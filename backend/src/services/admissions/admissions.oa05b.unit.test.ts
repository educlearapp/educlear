/**
 * OA-05B unit tests — reactivation DTO + auth gates (no DB).
 * Run: npx ts-node --transpile-only src/services/admissions/admissions.oa05b.unit.test.ts
 */
import assert from "assert";

import { assertConversionAuthorized, type ConversionActor } from "./admissionsConversionService";
import { parseReactivationDecisionDto } from "./admissionsHistoricalReactivationService";
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

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    learnerId: "learner-1",
    family: { mode: "KEEP_EXISTING" },
    guardians: [{ admissionGuardianId: "g1", mode: "CREATE_NEW" }],
    placement: { grade: "Grade 2", className: "2A" },
    ...overrides,
  };
}

function main() {
  assert.doesNotThrow(() => assertConversionAuthorized(actor()));
  assert.throws(
    () => assertConversionAuthorized(actor({ appRole: "Finance" })),
    (e: unknown) => e instanceof StaffAdmissionsError && e.code === "ADMISSIONS_DECISION_FORBIDDEN"
  );

  const dto = parseReactivationDecisionDto(validBody());
  assert.strictEqual(dto.learnerId, "learner-1");
  assert.strictEqual(dto.family.mode, "KEEP_EXISTING");
  assert.strictEqual(dto.placement.grade, "Grade 2");
  assert.strictEqual(dto.placement.className, "2A");

  assert.throws(
    () => parseReactivationDecisionDto(validBody({ schoolId: "x" })),
    (e: unknown) => e instanceof StaffAdmissionsError && e.code === "PROTECTED_FIELD"
  );
  assert.throws(
    () =>
      parseReactivationDecisionDto(
        validBody({ family: { mode: "CREATE_NEW" } })
      ),
    (e: unknown) =>
      e instanceof StaffAdmissionsError && e.code === "CREATE_NEW_FAMILY_NOT_SUPPORTED"
  );
  assert.throws(
    () =>
      parseReactivationDecisionDto(
        validBody({ family: { mode: "USE_EXISTING" } })
      ),
    (e: unknown) => e instanceof StaffAdmissionsError && e.code === "EXISTING_FAMILY_REQUIRED"
  );
  assert.throws(
    () =>
      parseReactivationDecisionDto(
        validBody({ placement: { grade: "" } })
      ),
    (e: unknown) => e instanceof StaffAdmissionsError && e.code === "GRADE_REQUIRED"
  );
  assert.throws(
    () => parseReactivationDecisionDto(validBody({ learnerId: "" })),
    (e: unknown) => e instanceof StaffAdmissionsError && e.code === "LEARNER_ID_REQUIRED"
  );

  const useExisting = parseReactivationDecisionDto(
    validBody({
      family: {
        mode: "USE_EXISTING",
        familyAccountId: "fa-1",
        acknowledgeHistoricalFamilyChange: true,
      },
      acknowledgeExistingBillingPlan: true,
    })
  );
  assert.strictEqual(useExisting.family.mode, "USE_EXISTING");
  assert.strictEqual(useExisting.family.familyAccountId, "fa-1");
  assert.strictEqual(useExisting.family.acknowledgeHistoricalFamilyChange, true);
  assert.strictEqual(useExisting.acknowledgeExistingBillingPlan, true);

  console.log("OA-05B unit tests passed");
}

main();
