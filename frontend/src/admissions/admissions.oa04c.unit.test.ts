/**
 * OA-04C staff admissions conversion UI unit tests.
 * Run: npx tsx src/admissions/admissions.oa04c.unit.test.ts
 */
import assert from "node:assert/strict";
import { canConvertAdmissionApplication } from "./admissionsPermissions";
import {
  assertStrictConversionDto,
  buildConversionDecisionDto,
  describeBlockerCode,
  getEnrolmentDetailLabel,
  getEnrolmentStatusLabel,
  hasConversionBlocker,
  initialFamilyDecision,
  initialGuardianDecisions,
  isFinanceBaselineWarningOnly,
  validateConversionUiState,
  type ConversionUiState,
} from "./conversionDecision";
import type { ConversionDecisionDto, ConversionPreflight } from "./staffAdmissionsTypes";
import { permissionsForRole } from "../users/permissions";

function adminUser() {
  return {
    id: "1",
    schoolId: "s",
    email: "a@ex.com",
    firstName: "A",
    surname: "A",
    fullName: "A A",
    appRole: "Admin",
    role: "STAFF",
    status: "Active",
    isActive: true,
    permissions: permissionsForRole("Admin"),
    lastLoginAt: null,
  };
}

function financeUser() {
  return {
    id: "2",
    schoolId: "s",
    email: "f@ex.com",
    firstName: "F",
    surname: "F",
    fullName: "F F",
    appRole: "Finance",
    role: "STAFF",
    status: "Active",
    isActive: true,
    permissions: permissionsForRole("Finance"),
    lastLoginAt: null,
  };
}

function ownerUser() {
  return {
    ...adminUser(),
    id: "3",
    appRole: "Owner",
    permissions: permissionsForRole("Owner"),
  };
}

function basePreflight(overrides: Partial<ConversionPreflight> = {}): ConversionPreflight {
  return {
    application: {
      id: "app1",
      applicationNumber: "APP-001",
      status: "ACCEPTED",
      alreadyConverted: false,
      promotedLearnerId: null,
      promotedFamilyAccountId: null,
      intakeYear: 2026,
      requestedGrade: "1",
    },
    learner: {
      firstName: "Sam",
      lastName: "Smith",
      nickname: null,
      birthDate: "2018-01-01",
      gender: "M",
      hasIdNumber: true,
      homeLanguage: "English",
      citizenship: "SA",
      requestedGrade: "1",
      intakeYear: 2026,
      duplicate: null,
    },
    guardians: [
      {
        admissionGuardianId: "g1",
        firstName: "Pat",
        surname: "Smith",
        relationship: "Mother",
        hasIdNumber: true,
        hasEmail: true,
        hasCellNo: true,
        isPrimary: true,
        isPayingPerson: true,
        identityDecision: null,
        matchStrength: "PROBABLE",
        candidates: [
          {
            parentId: "p1",
            firstName: "Patricia",
            surname: "Smith",
            maskedIdNumber: "••••1234",
            maskedCellphone: "••••5678",
            maskedEmail: "p***@example.com",
            matchReasons: ["email"],
            familyAccountId: "fam1",
          },
        ],
        suggestedMode: "LINK_EXISTING",
        suggestedExistingParentId: "p1",
      },
    ],
    family: {
      declaredExistingSibling: true,
      declaredExistingFamily: false,
      declaredSiblingLearnerName: "Alex",
      declaredSiblingAdmissionNo: "A001",
      staffMatchedFamilyAccountId: null,
      staffMatchDecision: null,
      candidates: [
        {
          familyAccountId: "fam1",
          accountRef: "FAM001",
          familyName: "Smith",
          reason: "sibling",
          strength: "STRONG",
        },
      ],
      requiresFamilyDecision: true,
      requiresAckForCreateNewDespiteSiblingDeclaration: true,
    },
    placement: {
      requestedGrade: "1",
      proposedGrade: "1",
      classNameRequired: false,
    },
    blockers: [],
    warnings: [],
    canConvert: true,
    ...overrides,
  };
}

function completeValidState(preflight: ConversionPreflight): ConversionUiState {
  const guardians: ConversionUiState["guardians"] = {};
  for (const g of preflight.guardians) {
    guardians[g.admissionGuardianId] = {
      mode: "CREATE_NEW",
      confirmCreateDespiteMatch: g.matchStrength === "PROBABLE" || g.matchStrength === "AMBIGUOUS",
    };
  }
  return {
    guardians,
    family: {
      mode: "CREATE_NEW",
      acknowledgeCreateNewFamilyDespiteSiblingDeclaration:
        preflight.family.requiresAckForCreateNewDespiteSiblingDeclaration,
    },
    grade: "1",
    className: "",
  };
}

function main() {
  // 1 / 4 — authorized Admin/Owner can convert; Finance cannot
  assert.equal(canConvertAdmissionApplication(adminUser()), true);
  assert.equal(canConvertAdmissionApplication(ownerUser()), true);
  assert.equal(canConvertAdmissionApplication(financeUser()), false);

  // Missing learners.create / admissions.manage
  const noCreate = {
    ...adminUser(),
    permissions: {
      ...permissionsForRole("Admin"),
      learners: { ...permissionsForRole("Admin").learners, create: false },
    },
  };
  assert.equal(canConvertAdmissionApplication(noCreate), false);
  const noManage = {
    ...adminUser(),
    permissions: {
      ...permissionsForRole("Admin"),
      admissions: { ...permissionsForRole("Admin").admissions, manage: false },
    },
  };
  assert.equal(canConvertAdmissionApplication(noManage), false);

  // 2 / 19 — enrolment labels only for ACCEPTED; promotedLearnerId distinguishes enrolled
  assert.equal(getEnrolmentStatusLabel("ACCEPTED", null), "Awaiting enrolment");
  assert.equal(getEnrolmentStatusLabel("ACCEPTED", "learner-1"), "Enrolled");
  assert.equal(getEnrolmentStatusLabel("SUBMITTED", null), null);
  assert.equal(getEnrolmentDetailLabel("ACCEPTED", null), "Awaiting EduClear enrolment");
  assert.equal(getEnrolmentDetailLabel("ACCEPTED", "x"), "EduClear learner created");

  const preflight = basePreflight();

  // 9 — probable parent match is NOT auto-linked
  const probableInitial = initialGuardianDecisions(preflight);
  assert.equal(probableInitial.g1.mode, "");
  assert.notEqual(probableInitial.g1.mode, "LINK_EXISTING");

  // Strong match also requires explicit choice
  const strongPf = basePreflight({
    guardians: [
      {
        ...preflight.guardians[0],
        matchStrength: "STRONG",
        suggestedMode: "LINK_EXISTING",
        suggestedExistingParentId: "p1",
      },
    ],
  });
  assert.equal(initialGuardianDecisions(strongPf).g1.mode, "");
  const strongCreateBlocked = validateConversionUiState(strongPf, {
    guardians: { g1: { mode: "CREATE_NEW" } },
    family: { mode: "CREATE_NEW", acknowledgeCreateNewFamilyDespiteSiblingDeclaration: true },
    grade: "1",
    className: "",
  });
  assert.equal(strongCreateBlocked.ok, false);
  if (!strongCreateBlocked.ok) assert.match(strongCreateBlocked.message, /Strong parent match/i);
  const strongLinkOk = validateConversionUiState(strongPf, {
    guardians: { g1: { mode: "LINK_EXISTING", existingParentId: "p1" } },
    family: { mode: "CREATE_NEW", acknowledgeCreateNewFamilyDespiteSiblingDeclaration: true },
    grade: "1",
    className: "",
  });
  assert.equal(strongLinkOk.ok, true);

  // 11 — family mode not preselected even with strong candidate
  assert.equal(initialFamilyDecision(preflight).mode, "");

  // 8 — each guardian requires explicit decision
  const missingGuardian = validateConversionUiState(preflight, {
    guardians: { g1: { mode: "" } },
    family: { mode: "CREATE_NEW", acknowledgeCreateNewFamilyDespiteSiblingDeclaration: true },
    grade: "1",
    className: "",
  });
  assert.equal(missingGuardian.ok, false);

  // 10 — LINK_EXISTING requires candidate selection
  const linkNoParent = validateConversionUiState(preflight, {
    guardians: { g1: { mode: "LINK_EXISTING" } },
    family: { mode: "USE_EXISTING", existingFamilyAccountId: "fam1" },
    grade: "1",
    className: "",
  });
  assert.equal(linkNoParent.ok, false);

  // Probable CREATE_NEW requires confirmCreateDespiteMatch
  const probableNoAck = validateConversionUiState(preflight, {
    guardians: { g1: { mode: "CREATE_NEW" } },
    family: { mode: "CREATE_NEW", acknowledgeCreateNewFamilyDespiteSiblingDeclaration: true },
    grade: "1",
    className: "",
  });
  assert.equal(probableNoAck.ok, false);

  // 12 — sibling declaration + CREATE_NEW requires acknowledgement
  const siblingFail = validateConversionUiState(preflight, {
    guardians: { g1: { mode: "CREATE_NEW", confirmCreateDespiteMatch: true } },
    family: { mode: "CREATE_NEW" },
    grade: "1",
    className: "",
  });
  assert.equal(siblingFail.ok, false);
  if (!siblingFail.ok) assert.match(siblingFail.message, /Acknowledge/i);

  // 13 / 14 — grade required; class optional
  const complete = completeValidState(preflight);
  assert.equal(validateConversionUiState(preflight, complete).ok, true);
  assert.equal(
    validateConversionUiState(preflight, { ...complete, grade: "  " }).ok,
    false
  );
  assert.equal(
    validateConversionUiState(preflight, { ...complete, className: "Grade 1A" }).ok,
    true
  );

  // 16 / 22 — DTO matches contract; no arbitrary/forbidden fields
  const dto = buildConversionDecisionDto(complete);
  assert.equal(dto.placement.grade, "1");
  assert.equal(dto.placement.className, null);
  assert.equal(dto.family.mode, "CREATE_NEW");
  assert.equal(dto.family.acknowledgeCreateNewFamilyDespiteSiblingDeclaration, true);
  assert.equal(dto.guardians[0].mode, "CREATE_NEW");
  assert.equal(dto.guardians[0].confirmCreateDespiteMatch, true);
  assert.equal(JSON.stringify(dto).includes("schoolId"), false);
  assert.equal(JSON.stringify(dto).includes("promotedLearnerId"), false);
  assert.equal(JSON.stringify(dto).includes("billing"), false);
  assert.equal(JSON.stringify(dto).includes("portal"), false);
  assertStrictConversionDto(dto);

  const linkState: ConversionUiState = {
    guardians: { g1: { mode: "LINK_EXISTING", existingParentId: "p1" } },
    family: { mode: "USE_EXISTING", existingFamilyAccountId: "fam1" },
    grade: "Grade 1",
    className: "1A",
  };
  assert.equal(validateConversionUiState(preflight, linkState).ok, true);
  const linkDto = buildConversionDecisionDto(linkState);
  assert.equal(linkDto.family.existingFamilyAccountId, "fam1");
  assert.equal(linkDto.guardians[0].existingParentId, "p1");
  assert.equal(linkDto.placement.className, "1A");

  // Forbidden key detection
  assert.throws(() =>
    assertStrictConversionDto({
      ...dto,
      schoolId: "evil",
    } as ConversionDecisionDto & { schoolId: string })
  );

  // 6 / 7 — blockers disable conversion path via helper
  const dupPf = basePreflight({
    canConvert: false,
    learner: {
      ...preflight.learner,
      duplicate: {
        strength: "STRONG",
        matchReason: "id",
        enrollmentStatus: "ACTIVE",
        learnerId: "L1",
        admissionNo: "A1",
        familyAccountId: "F1",
        accountRef: "REF",
        blockerCode: "LEARNER_IDENTITY_CONFLICT",
      },
    },
    blockers: [{ code: "LEARNER_IDENTITY_CONFLICT", message: "dup" }],
  });
  assert.equal(hasConversionBlocker(dupPf), true);
  assert.match(describeBlockerCode("LEARNER_IDENTITY_CONFLICT"), /existing learner/i);

  const histPf = basePreflight({
    canConvert: false,
    blockers: [{ code: "HISTORICAL_LEARNER_REQUIRES_REACTIVATION", message: "hist" }],
    learner: {
      ...preflight.learner,
      duplicate: {
        strength: "STRONG",
        matchReason: "id",
        enrollmentStatus: "HISTORICAL",
        learnerId: "L2",
        admissionNo: null,
        familyAccountId: null,
        accountRef: null,
        blockerCode: "HISTORICAL_LEARNER_REQUIRES_REACTIVATION",
      },
    },
  });
  assert.equal(hasConversionBlocker(histPf), true);
  assert.match(describeBlockerCode("HISTORICAL_LEARNER_REQUIRES_REACTIVATION"), /historical/i);

  // 19 / 20 — finance baseline warning is not enrolment failure; idempotent is success-shaped
  assert.equal(
    isFinanceBaselineWarningOnly({
      action: "convert_to_learner",
      idempotent: false,
      learnerId: "l1",
      familyAccountId: "f1",
      admissionNo: "A100",
      accountRef: "REF1",
      familyMode: "created",
      guardianOutcomes: [],
      grade: "1",
      className: null,
      financeBaselineRegistered: false,
      financeBaselineWarning: "FINANCE_BASELINE_SYNC_FAILED",
    }),
    true
  );
  assert.equal(
    isFinanceBaselineWarningOnly({
      action: "convert_to_learner",
      idempotent: true,
      learnerId: "l1",
      familyAccountId: "f1",
      admissionNo: "A100",
      accountRef: "REF1",
      familyMode: "reused",
      guardianOutcomes: [],
      grade: "1",
      className: null,
      financeBaselineRegistered: true,
    }),
    false
  );

  // OA-04C.1 — mixed guardians stay independent in DTO
  const mixedPf = basePreflight({
    guardians: [
      { ...preflight.guardians[0], admissionGuardianId: "gA", matchStrength: "NONE", candidates: [], suggestedMode: null, suggestedExistingParentId: null },
      {
        ...preflight.guardians[0],
        admissionGuardianId: "gB",
        firstName: "Other",
        matchStrength: "NONE",
        candidates: [
          {
            parentId: "p2",
            firstName: "Other",
            surname: "Parent",
            maskedIdNumber: "••••9999",
            maskedCellphone: "",
            maskedEmail: "",
            matchReasons: ["id"],
            familyAccountId: "fam2",
          },
        ],
        suggestedMode: null,
        suggestedExistingParentId: null,
      },
    ],
    family: {
      ...preflight.family,
      declaredExistingSibling: false,
      declaredExistingFamily: false,
      requiresAckForCreateNewDespiteSiblingDeclaration: false,
      candidates: [
        {
          familyAccountId: "fam2",
          accountRef: "FAM002",
          familyName: "Other",
          reason: "staff",
          strength: "PROBABLE",
        },
      ],
    },
  });
  const mixedState: ConversionUiState = {
    guardians: {
      gA: { mode: "CREATE_NEW" },
      gB: { mode: "LINK_EXISTING", existingParentId: "p2" },
    },
    family: { mode: "USE_EXISTING", existingFamilyAccountId: "fam2" },
    grade: "Grade 1",
    className: "",
  };
  assert.equal(validateConversionUiState(mixedPf, mixedState).ok, true);
  const mixedDto = buildConversionDecisionDto(mixedState);
  assert.equal(mixedDto.guardians.find((g) => g.admissionGuardianId === "gA")?.mode, "CREATE_NEW");
  assert.equal(mixedDto.guardians.find((g) => g.admissionGuardianId === "gB")?.existingParentId, "p2");
  assert.equal(mixedDto.family.existingFamilyAccountId, "fam2");

  // Sibling ack must be re-asserted after switching away from CREATE_NEW
  const ackCleared: ConversionUiState = {
    ...complete,
    family: { mode: "USE_EXISTING", existingFamilyAccountId: "fam1" },
  };
  assert.equal(validateConversionUiState(preflight, ackCleared).ok, true);
  const backToCreate: ConversionUiState = {
    ...complete,
    family: { mode: "CREATE_NEW" },
  };
  assert.equal(validateConversionUiState(preflight, backToCreate).ok, false);

  // Idempotent + finance warning still success-shaped (not failure)
  assert.equal(
    isFinanceBaselineWarningOnly({
      action: "convert_to_learner",
      idempotent: true,
      learnerId: "l1",
      familyAccountId: "f1",
      admissionNo: "A100",
      accountRef: "REF1",
      familyMode: "reused",
      guardianOutcomes: [{ admissionGuardianId: "g1", mode: "created", parentId: "p9" }],
      grade: "1",
      className: null,
      financeBaselineRegistered: false,
      financeBaselineWarning: "FINANCE_BASELINE_SYNC_FAILED",
    }),
    true
  );

  console.log("✓ OA-04C frontend admissions unit tests passed");
}

main();
