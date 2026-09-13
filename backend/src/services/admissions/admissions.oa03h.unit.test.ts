/**
 * OA-03H unit tests — public serializer + edit allowlist + info-supplied event (no DB).
 * Run: npx ts-node --transpile-only src/services/admissions/admissions.oa03h.unit.test.ts
 */
import assert from "assert";
import { Prisma } from "@prisma/client";

import { INFORMATION_SUPPLIED_EVENT } from "./applicantInfoResponseService";
import {
  APPLICANT_DRAFT_ALLOWED_KEYS,
  APPLICANT_DRAFT_FORBIDDEN_KEYS,
  serializeApplicantApplication,
} from "./draftApplicationService";
import { assertApplicationTransition } from "./staffAdmissionsWorkflowService";

function main() {
  assert.strictEqual(INFORMATION_SUPPLIED_EVENT, "INFORMATION_SUPPLIED");

  // Public serializer exposes applicant-facing statusReason, never staff notes
  const view = serializeApplicantApplication({
    publicAccessId: "pub-1",
    status: "INFO_REQUESTED",
    statusReason: "Please update the birth certificate scan",
    intakeYear: 2027,
    requestedGrade: "Grade 1",
    applicationNumber: "APP-2027-000001",
    feeRequired: true,
    feeAmount: new Prisma.Decimal("1600.00"),
    feeCurrency: "ZAR",
    feeSnapshotAt: new Date("2026-01-01T00:00:00.000Z"),
    declaredExistingSibling: false,
    declaredSiblingLearnerName: null,
    declaredSiblingAdmissionNo: null,
    declaredExistingFamily: false,
    privacyAcceptedAt: new Date("2026-01-01T00:00:00.000Z"),
    declarationsAcceptedAt: new Date("2026-01-01T00:00:00.000Z"),
    privacyNoticeVersion: "v1",
    submittedAt: new Date("2026-01-02T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
    learnerCandidate: {
      firstName: "Thabo",
      lastName: "Molefe",
      nickname: null,
      birthDate: new Date("2018-05-01T00:00:00.000Z"),
      gender: null,
      idNumber: null,
      homeLanguage: null,
      citizenship: null,
      homeAddress: "1 Test St",
      allergies: null,
      medicalAlert: null,
      previousSchoolName: null,
      notes: null,
    },
    guardians: [],
    answers: [],
    feeRecord: {
      required: true,
      amount: new Prisma.Decimal("1600.00"),
      currency: "ZAR",
      paymentStatus: "AWAITING_PAYMENT",
      paymentReference: "REF-1",
    },
  });
  assert.strictEqual(view.status, "INFO_REQUESTED");
  assert.strictEqual(view.statusReason, "Please update the birth certificate scan");
  assert.strictEqual("internalNote" in view, false);
  assert.strictEqual("staffNotes" in view, false);
  assert.strictEqual("acceptedByUserId" in view, false);

  // Staff-only / status injection keys remain forbidden on applicant PATCH
  for (const key of [
    "status",
    "statusReason",
    "paymentStatus",
    "schoolId",
    "acceptedAt",
    "declinedAt",
    "staffNotes",
  ]) {
    assert.ok(APPLICANT_DRAFT_FORBIDDEN_KEYS.has(key), key);
    assert.ok(!APPLICANT_DRAFT_ALLOWED_KEYS.has(key), key);
  }
  assert.ok(APPLICANT_DRAFT_ALLOWED_KEYS.has("learner"));
  assert.ok(APPLICANT_DRAFT_ALLOWED_KEYS.has("guardians"));
  assert.ok(APPLICANT_DRAFT_ALLOWED_KEYS.has("answers"));

  // Transition policy: applicant cannot own resume; staff path still INFO_REQUESTED → UNDER_REVIEW
  assert.deepStrictEqual(assertApplicationTransition("INFO_REQUESTED", "resume_review").to, "UNDER_REVIEW");
  assert.strictEqual(assertApplicationTransition("INFO_REQUESTED", "accept").allowed, false);
  assert.strictEqual(assertApplicationTransition("SUBMITTED", "resume_review").allowed, false);
  assert.strictEqual(assertApplicationTransition("UNDER_REVIEW", "resume_review").allowed, true); // idempotent

  console.log("OA-03H unit tests passed");
}

main();
