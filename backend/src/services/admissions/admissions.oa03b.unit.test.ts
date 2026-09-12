/**
 * OA-03B unit tests — tokens, number format, public config (no DB).
 * Run: npx ts-node --transpile-only src/services/admissions/admissions.oa03b.unit.test.ts
 */
import assert from "assert";
import { Prisma } from "@prisma/client";

import {
  formatApplicationNumber,
  parseApplicationNumber,
} from "./allocateApplicationNumber";
import {
  applicantTokenExpiry,
  generateApplicantAccessToken,
  hashApplicantAccessToken,
  verifyApplicantAccessToken,
} from "./applicantAccessToken";
import { buildPublicAdmissionsConfig } from "./publicAdmissionsConfig";
import { isAdmissionsWindowOpen } from "./resolvePublicAdmissions";

function settingsStub(overrides: Record<string, unknown> = {}) {
  return {
    id: "set1",
    schoolId: "school-a",
    enabled: true,
    publicSlug: "demo-school",
    applicationsOpenAt: null,
    applicationsCloseAt: null,
    intakeYear: 2027,
    acceptedGrades: ["Grade 1"],
    admissionFeeRequired: false,
    defaultAdmissionFeeAmount: null,
    currency: "ZAR",
    proofOfPaymentRequired: false,
    paymentVerificationRequired: true,
    requirePaymentVerifiedBeforeAccept: true,
    bankName: "SECRET BANK",
    accountHolder: "SECRET",
    accountNumber: "123456",
    branchCode: "000000",
    accountType: "Cheque",
    paymentInstructions: "secret",
    admissionContactEmail: "admissions@example.com",
    admissionContactPhone: "0100000000",
    requiredDocuments: [],
    applicationQuestions: [],
    notificationRecipientUserIds: [],
    privacyNoticeVersion: "v1",
    declarationText: "I agree",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as any;
}

function main() {
  // Number format
  assert.strictEqual(formatApplicationNumber(2027, 1), "APP-2027-000001");
  assert.strictEqual(formatApplicationNumber(2027, 123), "APP-2027-000123");
  assert.deepStrictEqual(parseApplicationNumber("APP-2027-000123"), {
    intakeYear: 2027,
    sequence: 123,
  });
  assert.strictEqual(parseApplicationNumber("BAD"), null);
  assert.throws(() => formatApplicationNumber(1999, 1));
  assert.throws(() => formatApplicationNumber(2027, 0));

  // Tokens
  const token = generateApplicantAccessToken();
  assert.ok(token.length >= 32);
  const hash = hashApplicantAccessToken(token);
  assert.notStrictEqual(hash, token);
  assert.strictEqual(verifyApplicantAccessToken(token, hash), true);
  assert.strictEqual(verifyApplicantAccessToken("wrong", hash), false);
  assert.strictEqual(verifyApplicantAccessToken(token, null), false);
  assert.strictEqual(verifyApplicantAccessToken("", hash), false);

  const exp = applicantTokenExpiry(new Date("2026-01-01T00:00:00.000Z"));
  assert.ok(exp.getTime() > new Date("2026-01-01T00:00:00.000Z").getTime());

  // Window
  assert.strictEqual(isAdmissionsWindowOpen({ applicationsOpenAt: null, applicationsCloseAt: null }), true);
  assert.strictEqual(
    isAdmissionsWindowOpen(
      {
        applicationsOpenAt: new Date("2030-01-01"),
        applicationsCloseAt: null,
      },
      new Date("2026-01-01")
    ),
    false
  );
  assert.strictEqual(
    isAdmissionsWindowOpen(
      {
        applicationsOpenAt: null,
        applicationsCloseAt: new Date("2020-01-01"),
      },
      new Date("2026-01-01")
    ),
    false
  );

  // Public config — enabled
  const cfg = buildPublicAdmissionsConfig({
    publicSlug: "demo-school",
    schoolName: "Demo School",
    logoUrl: "/logo.png",
    primaryColor: "#000",
    settings: settingsStub({
      admissionFeeRequired: true,
      defaultAdmissionFeeAmount: new Prisma.Decimal("1600.00"),
    }),
  });
  assert.strictEqual(cfg.acceptingApplications, true);
  assert.strictEqual(cfg.enabled, true);
  assert.strictEqual(cfg.admissionFeeAmount, "1600.00");
  assert.strictEqual(cfg.schoolDisplayName, "Demo School");
  assert.ok(!("schoolId" in cfg));
  assert.ok(!("bankName" in cfg));
  assert.ok(!("accountNumber" in cfg));
  assert.notStrictEqual(cfg.admissionFeeAmount, null);

  // Disabled → not accepting
  const closed = buildPublicAdmissionsConfig({
    publicSlug: "demo-school",
    schoolName: "Demo School",
    logoUrl: null,
    primaryColor: null,
    settings: settingsStub({ enabled: false }),
  });
  assert.strictEqual(closed.enabled, false);
  assert.strictEqual(closed.acceptingApplications, false);

  // R1600 is not a default when amount null
  const noFee = buildPublicAdmissionsConfig({
    publicSlug: "demo-school",
    schoolName: "Demo School",
    logoUrl: null,
    primaryColor: null,
    settings: settingsStub({
      admissionFeeRequired: false,
      defaultAdmissionFeeAmount: null,
    }),
  });
  assert.strictEqual(noFee.admissionFeeAmount, null);

  console.log("✓ OA-03B admissions unit tests passed");
}

main();
