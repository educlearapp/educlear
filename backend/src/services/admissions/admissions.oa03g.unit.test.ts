/**
 * OA-03G unit tests — transition policy + payment acceptance gates (no DB).
 * Run: npx ts-node --transpile-only src/services/admissions/admissions.oa03g.unit.test.ts
 */
import assert from "assert";

import { evaluateAdmissionsSettingsAuth } from "../../middleware/requireAdmissionsSettingsAuth";
import { permissionsForRole } from "../../utils/userPermissions";
import {
  canAdministerAdmissionPayment,
  canMakeAdmissionDecision,
} from "./admissionsDecisionAuth";
import {
  assertApplicationTransition,
  assertPaymentTransition,
  paymentAllowsAcceptance,
} from "./staffAdmissionsWorkflowService";

function auth(schoolId: string, appRole: string, permissions = permissionsForRole(appRole)) {
  return {
    userId: "u1",
    schoolId,
    email: "a@ex.com",
    role: "SCHOOL_ADMIN",
    appRole,
    authorizedSchoolId: schoolId,
    permissions,
  };
}

function main() {
  // Application transitions
  assert.deepStrictEqual(assertApplicationTransition("SUBMITTED", "start_review").to, "UNDER_REVIEW");
  assert.strictEqual(assertApplicationTransition("DRAFT", "start_review").allowed, false);
  assert.deepStrictEqual(assertApplicationTransition("UNDER_REVIEW", "request_info").to, "INFO_REQUESTED");
  assert.deepStrictEqual(assertApplicationTransition("INFO_REQUESTED", "resume_review").to, "UNDER_REVIEW");
  assert.deepStrictEqual(assertApplicationTransition("UNDER_REVIEW", "accept").to, "ACCEPTED");
  assert.deepStrictEqual(assertApplicationTransition("UNDER_REVIEW", "reject").to, "DECLINED");
  assert.strictEqual(assertApplicationTransition("ACCEPTED", "reject").allowed, false);
  assert.strictEqual(assertApplicationTransition("DECLINED", "accept").allowed, false);
  assert.strictEqual(assertApplicationTransition("ACCEPTED", "start_review").code, "APPLICATION_TERMINAL");

  // Idempotent same-state
  assert.strictEqual(assertApplicationTransition("UNDER_REVIEW", "start_review").allowed, true);
  assert.strictEqual(assertApplicationTransition("ACCEPTED", "accept").allowed, true);

  // Payment transitions
  assert.deepStrictEqual(assertPaymentTransition("PROOF_UPLOADED", "verify").to, "VERIFIED");
  assert.strictEqual(assertPaymentTransition("AWAITING_PAYMENT", "verify").allowed, false);
  assert.deepStrictEqual(assertPaymentTransition("PROOF_UPLOADED", "reject_pop").to, "REJECTED");
  assert.deepStrictEqual(assertPaymentTransition("AWAITING_PAYMENT", "waive").to, "WAIVED");
  assert.strictEqual(assertPaymentTransition("VERIFIED", "waive").code, "PAYMENT_ALREADY_VERIFIED");
  assert.strictEqual(assertPaymentTransition("NOT_REQUIRED", "verify").code, "FEE_NOT_REQUIRED");

  // Acceptance payment gate
  assert.strictEqual(
    paymentAllowsAcceptance({
      requirePaymentVerifiedBeforeAccept: true,
      feeRequired: true,
      paymentStatus: "VERIFIED",
    }).ok,
    true
  );
  assert.strictEqual(
    paymentAllowsAcceptance({
      requirePaymentVerifiedBeforeAccept: true,
      feeRequired: true,
      paymentStatus: "WAIVED",
    }).ok,
    true
  );
  assert.strictEqual(
    paymentAllowsAcceptance({
      requirePaymentVerifiedBeforeAccept: true,
      feeRequired: false,
      paymentStatus: "NOT_REQUIRED",
    }).ok,
    true
  );
  for (const bad of ["AWAITING_PAYMENT", "PROOF_UPLOADED", "UNDER_VERIFICATION", "REJECTED"]) {
    assert.strictEqual(
      paymentAllowsAcceptance({
        requirePaymentVerifiedBeforeAccept: true,
        feeRequired: true,
        paymentStatus: bad,
      }).ok,
      false,
      bad
    );
  }
  assert.strictEqual(
    paymentAllowsAcceptance({
      requirePaymentVerifiedBeforeAccept: false,
      feeRequired: true,
      paymentStatus: "AWAITING_PAYMENT",
    }).ok,
    true
  );

  // Permission mapping (OA-03A)
  const finance = permissionsForRole("Finance");
  const admin = permissionsForRole("Admin");
  assert.strictEqual(canMakeAdmissionDecision("Finance"), false);
  assert.strictEqual(canMakeAdmissionDecision("Admin"), true);
  assert.strictEqual(canAdministerAdmissionPayment("Finance", finance.admissions.edit), true);
  assert.strictEqual(canAdministerAdmissionPayment("Teacher", true), false);

  // View-only cannot edit
  {
    const d = evaluateAdmissionsSettingsAuth({
      auth: auth("school-a", "Viewer"),
      requireAction: "edit",
    });
    assert.strictEqual(d.allowed, false);
  }
  // Finance can edit (workflow/payment) but not manage (accept route middleware)
  {
    const edit = evaluateAdmissionsSettingsAuth({
      auth: auth("school-a", "Finance"),
      requireAction: "edit",
    });
    assert.strictEqual(edit.allowed, true);
    const manage = evaluateAdmissionsSettingsAuth({
      auth: auth("school-a", "Finance"),
      requireAction: "manage",
    });
    assert.strictEqual(manage.allowed, false);
  }
  {
    const manage = evaluateAdmissionsSettingsAuth({
      auth: auth("school-a", "Admin"),
      requireAction: "manage",
    });
    assert.strictEqual(manage.allowed, true);
    assert.strictEqual(admin.admissions.manage, true);
  }

  console.log("OA-03G unit tests passed");
}

main();
