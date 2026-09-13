/**
 * OA-04E post-enrolment checklist unit tests (pure helpers / permissions).
 * Run: npx tsx src/admissions/admissions.oa04e.unit.test.ts
 */
import assert from "node:assert/strict";
import {
  canConvertAdmissionApplication,
  canEditBillingPlan,
  canViewBillingPlan,
} from "./admissionsPermissions";
import type { PostEnrolmentSummary } from "./staffAdmissionsTypes";
import { permissionsForRole } from "../users/permissions";

function user(appRole: "Admin" | "Finance" | "Owner" | "Teacher") {
  return {
    id: "1",
    schoolId: "s",
    email: "a@ex.com",
    firstName: "A",
    surname: "A",
    fullName: "A A",
    appRole,
    role: "STAFF",
    status: "Active",
    isActive: true,
    permissions: permissionsForRole(appRole),
    lastLoginAt: null,
  };
}

function sampleSummary(overrides: Partial<PostEnrolmentSummary> = {}): PostEnrolmentSummary {
  return {
    learner: {
      id: "L1",
      firstName: "Neo",
      lastName: "Verify",
      admissionNo: "VER001",
      grade: "Grade 1",
      className: null,
      enrollmentStatus: "ACTIVE",
    },
    family: {
      id: "F1",
      accountRef: "VER001",
      accountNo: "VER001",
      familyName: "Verify",
      mode: "created",
    },
    placement: {
      status: "ACTION_RECOMMENDED",
      label: "Grade recorded — class not yet assigned",
      grade: "Grade 1",
      className: null,
    },
    billingPlan: {
      status: "REQUIRED",
      label: "Billing plan required",
      lineCount: 0,
    },
    finance: {
      status: "READY",
      label: "Finance account ready",
      accountRef: "VER001",
      baselinePresent: true,
      note: "ok",
    },
    guardians: [
      {
        parentId: "P1",
        firstName: "Parent",
        surname: "Verify",
        relationship: "Mother",
        isPrimary: true,
        isPayingPerson: true,
        hasEmail: true,
        hasCellNo: true,
        portalStatus: "ONBOARDING_REQUIRED",
        portalLabel: "Parent onboarding required",
        onboardingStatus: null,
      },
    ],
    invoicing: {
      status: "WAITING_FOR_BILLING_PLAN",
      label: "Waiting for billing plan",
      note: "Handled through Invoice Runs",
    },
    admissionFee: {
      required: false,
      paymentStatus: "NOT_REQUIRED",
      label: "Admission fee: not required",
      note: "Application-scoped only. VERIFIED does not mean paid on the FamilyAccount ledger.",
    },
    ...overrides,
  };
}

function main() {
  assert.equal(canConvertAdmissionApplication(user("Admin")), true);
  assert.equal(canConvertAdmissionApplication(user("Finance")), false);
  assert.equal(canEditBillingPlan(user("Finance")), true);
  assert.equal(canEditBillingPlan(user("Admin")), false);
  assert.equal(canViewBillingPlan(user("Admin")), true);

  const missingClass = sampleSummary();
  assert.equal(missingClass.placement.status, "ACTION_RECOMMENDED");
  assert.notEqual(missingClass.placement.status, "COMPLETE");

  const withClass = sampleSummary({
    learner: { ...missingClass.learner, className: "1A" },
    placement: {
      status: "COMPLETE",
      label: "Grade and class recorded",
      grade: "Grade 1",
      className: "1A",
    },
  });
  assert.equal(withClass.placement.status, "COMPLETE");

  assert.equal(missingClass.billingPlan.status, "REQUIRED");
  assert.equal(missingClass.invoicing.status, "WAITING_FOR_BILLING_PLAN");

  const withPlan = sampleSummary({
    billingPlan: { status: "ASSIGNED", label: "Billing plan assigned", lineCount: 2 },
    invoicing: {
      status: "READY_FOR_FUTURE_INVOICE_RUN",
      label: "Ready for future invoice run",
      note: "no claim of invoice exists",
    },
  });
  assert.equal(withPlan.billingPlan.status, "ASSIGNED");
  assert.notEqual(withPlan.invoicing.label.toLowerCase().includes("generated"), true);

  assert.match(missingClass.admissionFee.note, /does not mean paid on the FamilyAccount/i);

  const baselineMissing = sampleSummary({
    finance: {
      status: "BASELINE_MISSING",
      label: "Finance setup needs attention",
      accountRef: "VER001",
      baselinePresent: false,
      note: "Enrolment is still complete",
    },
  });
  assert.equal(baselineMissing.finance.status, "BASELINE_MISSING");
  assert.match(baselineMissing.finance.note, /Enrolment is still complete/i);

  const mixed = sampleSummary({
    guardians: [
      {
        parentId: "P1",
        firstName: "A",
        surname: "One",
        relationship: null,
        isPrimary: true,
        isPayingPerson: true,
        hasEmail: true,
        hasCellNo: true,
        portalStatus: "READY",
        portalLabel: "Parent Portal ready",
        onboardingStatus: "REGISTERED",
      },
      {
        parentId: "P2",
        firstName: "B",
        surname: "Two",
        relationship: null,
        isPrimary: false,
        isPayingPerson: false,
        hasEmail: false,
        hasCellNo: false,
        portalStatus: "CONTACT_REQUIRED",
        portalLabel: "Contact details required",
        onboardingStatus: null,
      },
    ],
  });
  assert.equal(mixed.guardians[0].portalStatus, "READY");
  assert.equal(mixed.guardians[1].portalStatus, "CONTACT_REQUIRED");

  console.log("✓ OA-04E frontend admissions unit tests passed");
}

main();
