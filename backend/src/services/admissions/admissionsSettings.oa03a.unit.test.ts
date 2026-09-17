/**
 * OA-03A admissions settings auth + validation (no DB writes).
 * Run: npx tsx src/services/admissions/admissionsSettings.oa03a.unit.test.ts
 */
import assert from "assert";
import { evaluateAdmissionsSettingsAuth } from "../../middleware/requireAdmissionsSettingsAuth";
import {
  AdmissionsSettingsValidationError,
  defaultAdmissionsSettingsShape,
  serializeAdmissionsSettings,
  upsertSchoolAdmissionsSettings,
} from "./schoolAdmissionsSettingsService";
import { permissionsForRole } from "../../utils/userPermissions";
import { Prisma } from "@prisma/client";

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

async function main() {
  const schoolA = "school-a";
  const schoolB = "school-b";

  // Unauthenticated
  {
    const d = evaluateAdmissionsSettingsAuth({
      auth: null,
      requireAction: "view",
    });
    assert.strictEqual(d.allowed, false);
    if (!d.allowed) assert.strictEqual(d.status, 401);
  }

  // Cross-tenant schoolId rejected
  {
    const d = evaluateAdmissionsSettingsAuth({
      auth: auth(schoolA, "Admin"),
      requireAction: "view",
      requestSchoolId: schoolB,
    });
    assert.strictEqual(d.allowed, false);
    if (!d.allowed) {
      assert.strictEqual(d.status, 403);
      assert.strictEqual(d.code, "SCHOOL_MISMATCH");
    }
  }

  // Finance cannot manage settings
  {
    const d = evaluateAdmissionsSettingsAuth({
      auth: auth(schoolA, "Finance"),
      requireAction: "manage",
    });
    assert.strictEqual(d.allowed, false);
    if (!d.allowed) assert.strictEqual(d.code, "ADMISSIONS_FORBIDDEN");
  }

  // Finance can view
  {
    const d = evaluateAdmissionsSettingsAuth({
      auth: auth(schoolA, "Finance"),
      requireAction: "view",
    });
    assert.strictEqual(d.allowed, true);
  }

  // Admin can manage
  {
    const d = evaluateAdmissionsSettingsAuth({
      auth: auth(schoolA, "Admin"),
      requireAction: "manage",
    });
    assert.strictEqual(d.allowed, true);
  }

  // Defaults: no R1600
  const defaults = defaultAdmissionsSettingsShape(schoolA);
  assert.strictEqual(defaults.defaultAdmissionFeeAmount, null);
  assert.strictEqual(defaults.admissionFeeRequired, false);

  // serialize null row
  const serialized = serializeAdmissionsSettings(null, schoolA);
  assert.strictEqual(serialized.schoolId, schoolA);
  assert.strictEqual(serialized.enabled, false);

  // serialize with decimal fee
  const withFee = serializeAdmissionsSettings(
    {
      id: "s1",
      schoolId: schoolA,
      enabled: false,
      publicSlug: "demo-school",
      applicationsOpenAt: null,
      applicationsCloseAt: null,
      intakeYear: 2027,
      acceptedGrades: ["Grade 1"],
      admissionFeeRequired: true,
      defaultAdmissionFeeAmount: new Prisma.Decimal("1600.00"),
      currency: "ZAR",
      proofOfPaymentRequired: true,
      paymentVerificationRequired: true,
      requirePaymentVerifiedBeforeAccept: true,
      bankName: null,
      accountHolder: null,
      accountNumber: null,
      branchCode: null,
      accountType: null,
      paymentInstructions: null,
      admissionContactEmail: null,
      admissionContactPhone: null,
      requiredDocuments: [],
      applicationQuestions: [],
      notificationRecipientUserIds: [],
      privacyNoticeVersion: null,
      declarationText: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    schoolA
  );
  assert.strictEqual(withFee.defaultAdmissionFeeAmount, "1600.00");

  // Body schoolId spoof rejected by service
  const fakePrisma = {
    school: { findUnique: async () => ({ id: schoolA }) },
    schoolAdmissionsSettings: {
      findUnique: async () => null,
      upsert: async () => {
        throw new Error("upsert must not run on spoof");
      },
    },
  } as any;

  let spoofThrown = false;
  try {
    await upsertSchoolAdmissionsSettings(fakePrisma, schoolA, {
      schoolId: schoolB,
      enabled: false,
    });
  } catch (err) {
    spoofThrown = err instanceof AdmissionsSettingsValidationError;
  }
  assert.ok(spoofThrown, "client schoolId spoof must be rejected");

  // Invalid slug
  let slugThrown = false;
  try {
    await upsertSchoolAdmissionsSettings(fakePrisma, schoolA, {
      publicSlug: "BAD SLUG!",
    });
  } catch (err) {
    slugThrown = err instanceof AdmissionsSettingsValidationError;
  }
  assert.ok(slugThrown, "invalid slug must be rejected");

  // Enable without slug
  let enableThrown = false;
  try {
    await upsertSchoolAdmissionsSettings(fakePrisma, schoolA, {
      enabled: true,
      publicSlug: null,
    });
  } catch (err) {
    enableThrown = err instanceof AdmissionsSettingsValidationError;
  }
  assert.ok(enableThrown, "enable without slug must be rejected");

  // Fee required without amount
  let feeThrown = false;
  try {
    await upsertSchoolAdmissionsSettings(fakePrisma, schoolA, {
      admissionFeeRequired: true,
      defaultAdmissionFeeAmount: null,
      publicSlug: "ok-school",
    });
  } catch (err) {
    feeThrown = err instanceof AdmissionsSettingsValidationError;
  }
  assert.ok(feeThrown, "fee required without amount must be rejected");

  // Successful upsert stamps authorized school only
  let upsertData: any = null;
  const okPrisma = {
    school: { findUnique: async () => ({ id: schoolA }) },
    schoolAdmissionsSettings: {
      findUnique: async () => null,
      upsert: async (args: any) => {
        upsertData = args;
        return {
          id: "new",
          ...args.create,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    },
  } as any;

  const saved = await upsertSchoolAdmissionsSettings(okPrisma, schoolA, {
    enabled: true,
    publicSlug: "demo-school",
    admissionFeeRequired: true,
    defaultAdmissionFeeAmount: "1600",
    currency: "ZAR",
    schoolId: schoolA, // same school allowed
  });
  assert.strictEqual(upsertData.create.schoolId, schoolA);
  assert.strictEqual(saved.defaultAdmissionFeeAmount, "1600.00");
  assert.strictEqual(saved.publicSlug, "demo-school");

  // Cross-tenant body rejected even if upsert would otherwise work
  let crossThrown = false;
  try {
    await upsertSchoolAdmissionsSettings(okPrisma, schoolA, {
      schoolId: schoolB,
      publicSlug: "x",
    });
  } catch (err) {
    crossThrown = err instanceof AdmissionsSettingsValidationError;
  }
  assert.ok(crossThrown);

  console.log("✓ OA-03A admissions settings auth/validation unit tests passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
