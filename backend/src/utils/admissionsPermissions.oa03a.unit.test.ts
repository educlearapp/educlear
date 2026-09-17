/**
 * OA-03A admissions permissions + decision authority.
 * Run: npx tsx src/utils/admissionsPermissions.oa03a.unit.test.ts
 */
import assert from "assert";
import {
  canAdministerAdmissionPayment,
  canMakeAdmissionDecision,
  canViewAdmissionsMedicalDetails,
  canViewAdmissionsStaffNotes,
} from "../services/admissions/admissionsDecisionAuth";
import {
  PERMISSION_MODULES,
  hasPermission,
  permissionsForRole,
  type ModuleKey,
} from "./userPermissions";
import { defaultAdmissionsSettingsShape } from "../services/admissions/schoolAdmissionsSettingsService";

function main() {
  const moduleKeys = PERMISSION_MODULES.map((m) => m.key);
  assert.ok(moduleKeys.includes("admissions"), "admissions module must exist");

  const owner = permissionsForRole("Owner");
  assert.strictEqual(owner.admissions.view, true);
  assert.strictEqual(owner.admissions.manage, true);
  assert.strictEqual(owner.admissions.edit, true);

  const admin = permissionsForRole("Admin");
  assert.strictEqual(admin.admissions.view, true);
  assert.strictEqual(admin.admissions.manage, true);
  assert.strictEqual(admin.admissions.edit, true);
  assert.strictEqual(admin.admissions.delete, true);
  assert.strictEqual(admin.admissions.send, true);
  assert.strictEqual(admin.admissions.export, true);
  assert.strictEqual(admin.admissions.print, true);

  const finance = permissionsForRole("Finance");
  assert.strictEqual(finance.admissions.view, true);
  assert.strictEqual(finance.admissions.edit, true);
  assert.strictEqual(finance.admissions.manage, false, "Finance must not get admissions.manage");
  assert.strictEqual(finance.admissions.delete, false);

  const teacher = permissionsForRole("Teacher");
  assert.strictEqual(teacher.admissions.view, false);
  assert.strictEqual(teacher.admissions.manage, false);

  const viewer = permissionsForRole("Viewer");
  assert.strictEqual(viewer.admissions.view, false);

  // Unrelated modules unchanged for Teacher
  assert.strictEqual(teacher.learners.view, true);
  assert.strictEqual(teacher.attendance.edit, true);

  assert.strictEqual(canMakeAdmissionDecision("Owner"), true);
  assert.strictEqual(canMakeAdmissionDecision("Admin"), true);
  assert.strictEqual(canMakeAdmissionDecision("Finance"), false);
  assert.strictEqual(canMakeAdmissionDecision("Teacher"), false);

  assert.strictEqual(canAdministerAdmissionPayment("Finance", true), true);
  assert.strictEqual(canAdministerAdmissionPayment("Finance", false), false);
  assert.strictEqual(canAdministerAdmissionPayment("Teacher", true), false);

  // OA-03F sensitive visibility helpers (existing manage vs edit distinction)
  assert.strictEqual(canViewAdmissionsMedicalDetails(true), true);
  assert.strictEqual(canViewAdmissionsMedicalDetails(false), false);
  assert.strictEqual(canViewAdmissionsStaffNotes(true), true);
  assert.strictEqual(canViewAdmissionsStaffNotes(false), false);
  assert.strictEqual(canViewAdmissionsMedicalDetails(finance.admissions.manage), false);
  assert.strictEqual(
    canViewAdmissionsStaffNotes(finance.admissions.edit || finance.admissions.manage),
    true
  );
  assert.strictEqual(canViewAdmissionsMedicalDetails(admin.admissions.manage), true);

  const defaults = defaultAdmissionsSettingsShape("school-x");
  assert.strictEqual(defaults.admissionFeeRequired, false);
  assert.strictEqual(defaults.defaultAdmissionFeeAmount, null);
  assert.notStrictEqual(defaults.defaultAdmissionFeeAmount, "1600.00");
  assert.notStrictEqual(Number(defaults.defaultAdmissionFeeAmount), 1600);
  assert.strictEqual(defaults.paymentVerificationRequired, true);
  assert.strictEqual(defaults.requirePaymentVerifiedBeforeAccept, true);
  assert.strictEqual(defaults.enabled, false);
  assert.strictEqual(defaults.currency, "ZAR");

  assert.strictEqual(
    hasPermission({ appRole: "Finance", isActive: true, permissions: finance }, "admissions", "manage"),
    false
  );
  assert.strictEqual(
    hasPermission({ appRole: "Admin", isActive: true, permissions: admin }, "admissions", "manage"),
    true
  );

  // Type-level module key exists
  const key: ModuleKey = "admissions";
  assert.strictEqual(key, "admissions");

  console.log("✓ OA-03A admissions permissions + defaults unit tests passed");
}

main();
