/**
 * OA-03E integration tests — applicant payment instructions (local educlear only).
 * Run: npx ts-node --transpile-only src/services/admissions/admissions.oa03e.integration.test.ts
 */
import "dotenv/config";
import assert from "assert";
import { PrismaClient } from "@prisma/client";

import { uploadProofOfPayment } from "./admissionsDocumentService";
import {
  createDraftApplication,
  updateDraftApplication,
} from "./draftApplicationService";
import { getApplicantPaymentView } from "./paymentInstructionsService";
import { getPublicAdmissionsConfig, PublicAdmissionsError } from "./publicAdmissionsConfig";
import { submitApplication } from "./submitApplicationService";

const prisma = new PrismaClient();

function assertLocal() {
  const raw = process.env.DATABASE_URL || "";
  const host = (raw.match(/@([^:/?]+)/) || [])[1] || "";
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`Refusing non-local host: ${host}`);
  }
}

function minimalPdf(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");
}

async function makeSchool(
  suffix: string,
  opts?: { fee?: boolean; bank?: boolean; feeAmount?: string }
) {
  const school = await prisma.school.create({ data: { name: `OA03E ${suffix}` } });
  const slug = `oa03e-${suffix}-${Date.now().toString(36)}`;
  const withFee = Boolean(opts?.fee);
  const withBank = opts?.bank !== false && withFee;
  await prisma.schoolAdmissionsSettings.create({
    data: {
      schoolId: school.id,
      enabled: true,
      publicSlug: slug,
      intakeYear: 2027,
      acceptedGrades: ["Grade 1", "Grade 2"],
      admissionFeeRequired: withFee,
      defaultAdmissionFeeAmount: withFee ? ((opts?.feeAmount as any) || "1600.00") : null,
      currency: "ZAR",
      applicationQuestions: [{ key: "why", label: "Why apply?", required: true }],
      bankName: withBank ? "Test Bank" : withFee ? null : null,
      accountHolder: withBank ? "School Account" : null,
      accountNumber: withBank ? "123456789" : null,
      branchCode: withBank ? "250655" : null,
      accountType: withBank ? "Cheque" : null,
      paymentInstructions: withBank ? "Use your application number as reference." : null,
    },
  });
  return { school, slug };
}

async function cleanupSchool(schoolId: string) {
  const apps = await prisma.admissionApplication.findMany({
    where: { schoolId },
    select: { id: true },
  });
  const ids = apps.map((a) => a.id);
  if (ids.length) {
    await prisma.admissionFeeRecord.updateMany({
      where: { applicationId: { in: ids } },
      data: { latestProofDocumentId: null },
    });
    await prisma.admissionDocument.updateMany({
      where: { applicationId: { in: ids } },
      data: { replacedByDocumentId: null },
    });
    await prisma.admissionDocument.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionAuditEvent.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionStatusHistory.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionPaymentHistory.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionFeeRecord.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionAnswer.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionGuardian.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionLearnerCandidate.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionStaffNote.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionApplication.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.admissionApplicationCounter.deleteMany({ where: { schoolId } });
  await prisma.schoolAdmissionsSettings.deleteMany({ where: { schoolId } });
  await prisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
}

async function completeDraft(slug: string, publicAccessId: string, token: string) {
  return updateDraftApplication(prisma, slug, publicAccessId, token, {
    requestedGrade: "Grade 1",
    intakeYear: 2027,
    learner: {
      firstName: "Thabo",
      lastName: "Molefe",
      birthDate: "2018-05-01",
      homeAddress: "1 Test St",
    },
    guardians: [
      {
        firstName: "Lerato",
        surname: "Molefe",
        cellNo: "0821111111",
        email: "lerato@example.com",
        isPrimary: true,
        isPayingPerson: true,
        homeAddress: "1 Test St",
      },
    ],
    answers: [{ questionKey: "why", questionLabelSnapshot: "Why apply?", valueJson: "Great school" }],
    privacyAccepted: true,
    declarationsAccepted: true,
    privacyNoticeVersion: "v1",
  });
}

function assertNoInternalLeak(payment: Record<string, unknown>) {
  const json = JSON.stringify(payment);
  assert.ok(!json.includes("verifiedBy"));
  assert.ok(!json.includes("verifiedAt"));
  assert.ok(!json.includes("waivedBy"));
  assert.ok(!json.includes("storageKey"));
  assert.ok(!json.includes("storageProvider"));
  assert.ok(!json.includes("checksumSha256"));
  assert.ok(!json.includes("rejectionReason"));
  assert.ok(!json.includes("waiveReason"));
  assert.ok(!("schoolId" in payment));
  assert.ok(!json.includes("data/admissions"));
}

async function main() {
  assertLocal();
  const schoolIds: string[] = [];

  try {
    const a = await makeSchool("a", { fee: true, bank: true, feeAmount: "1600.00" });
    const b = await makeSchool("b", { fee: true, bank: true });
    const noBank = await makeSchool("nobank", { fee: true, bank: false });
    const free = await makeSchool("free", { fee: false });
    schoolIds.push(a.school.id, b.school.id, noBank.school.id, free.school.id);

    // Public config never leaks bank
    const cfg = await getPublicAdmissionsConfig(prisma, a.slug);
    assert.ok(!("bankName" in cfg));
    assert.ok(!("accountNumber" in cfg));

    const draft = await createDraftApplication(prisma, a.slug, {
      requestedGrade: "Grade 1",
      learner: { firstName: "", lastName: "" },
    });
    const accessA = draft.application.publicAccessId;
    const tokenA = draft.accessToken;

    // Before submission — blocked
    await assert.rejects(
      () => getApplicantPaymentView(prisma, a.slug, accessA, tokenA),
      (err: unknown) =>
        err instanceof PublicAdmissionsError && err.code === "PAYMENT_REQUIRES_SUBMISSION"
    );

    await completeDraft(a.slug, accessA, tokenA);
    const submitted = await submitApplication(prisma, a.slug, accessA, tokenA);
    assert.ok(submitted.application.applicationNumber);

    // Authenticated own payment instructions
    const payment = await getApplicantPaymentView(prisma, a.slug, accessA, tokenA);
    assert.strictEqual(payment.applicationNumber, submitted.application.applicationNumber);
    assert.strictEqual(payment.paymentReference, submitted.application.applicationNumber);
    assert.strictEqual(payment.feeRequired, true);
    assert.strictEqual(payment.feeAmount, "1600.00");
    assert.strictEqual(payment.currency, "ZAR");
    assert.strictEqual(payment.paymentStatus, "AWAITING_PAYMENT");
    assert.strictEqual(payment.paymentInstructionsAvailable, true);
    assert.strictEqual(payment.bankConfigurationIncomplete, false);
    assert.ok(payment.bank);
    assert.strictEqual(payment.bank!.bankName, "Test Bank");
    assert.strictEqual(payment.bank!.accountHolder, "School Account");
    assert.strictEqual(payment.bank!.accountNumber, "123456789");
    assert.strictEqual(payment.bank!.branchCode, "250655");
    assert.strictEqual(payment.bank!.accountType, "Cheque");
    assert.ok(payment.bank!.paymentInstructions);
    assert.strictEqual(payment.proofOfPayment.uploaded, false);
    assert.strictEqual(payment.guidance.code, "AWAITING_PAYMENT");
    assert.strictEqual(payment.guidance.shouldPay, true);
    assertNoInternalLeak(payment as any);

    // Immutable fee snapshot — changing live settings must not change view amount
    await prisma.schoolAdmissionsSettings.update({
      where: { schoolId: a.school.id },
      data: { defaultAdmissionFeeAmount: "9999.00" as any },
    });
    const afterFeeChange = await getApplicantPaymentView(prisma, a.slug, accessA, tokenA);
    assert.strictEqual(afterFeeChange.feeAmount, "1600.00");

    // Invalid token
    await assert.rejects(
      () => getApplicantPaymentView(prisma, a.slug, accessA, "bad-token"),
      (err: unknown) => err instanceof PublicAdmissionsError && err.statusCode === 404
    );

    // Cross-application
    const other = await createDraftApplication(prisma, a.slug, {
      requestedGrade: "Grade 2",
      learner: { firstName: "", lastName: "" },
    });
    await assert.rejects(
      () =>
        getApplicantPaymentView(prisma, a.slug, other.application.publicAccessId, tokenA),
      (err: unknown) => err instanceof PublicAdmissionsError && err.statusCode === 404
    );

    // Cross-school
    await assert.rejects(
      () => getApplicantPaymentView(prisma, b.slug, accessA, tokenA),
      (err: unknown) => err instanceof PublicAdmissionsError && err.statusCode === 404
    );

    // PROOF_UPLOADED
    await uploadProofOfPayment(prisma, a.slug, accessA, tokenA, {
      buffer: minimalPdf(),
      originalFileName: "pop.pdf",
      claimedMime: "application/pdf",
    });
    const withPop = await getApplicantPaymentView(prisma, a.slug, accessA, tokenA);
    assert.strictEqual(withPop.paymentStatus, "PROOF_UPLOADED");
    assert.strictEqual(withPop.proofOfPayment.uploaded, true);
    assert.ok(withPop.proofOfPayment.document);
    assert.strictEqual(withPop.proofOfPayment.document!.contentType, "application/pdf");
    assert.ok(!(withPop.proofOfPayment.document as any).storageKey);
    assert.ok(!(withPop.proofOfPayment.document as any).absolutePath);
    assert.strictEqual(withPop.guidance.code, "PROOF_UPLOADED");
    assert.strictEqual(withPop.guidance.shouldPay, false);
    assertNoInternalLeak(withPop as any);

    // VERIFIED (staff-simulated) — still no leak, do not tell to pay again
    const appRow = await prisma.admissionApplication.findFirstOrThrow({
      where: { publicAccessId: accessA },
    });
    await prisma.admissionFeeRecord.update({
      where: { applicationId: appRow.id },
      data: {
        paymentStatus: "VERIFIED",
        verifiedAt: new Date(),
        rejectionReason: "INTERNAL STAFF NOTE DO NOT LEAK",
      },
    });
    const verified = await getApplicantPaymentView(prisma, a.slug, accessA, tokenA);
    assert.strictEqual(verified.paymentStatus, "VERIFIED");
    assert.strictEqual(verified.guidance.shouldPay, false);
    assert.ok(/verified/i.test(verified.guidance.message));
    assertNoInternalLeak(verified as any);
    assert.ok(!JSON.stringify(verified).includes("INTERNAL STAFF"));

    // REJECTED
    await prisma.admissionFeeRecord.update({
      where: { applicationId: appRow.id },
      data: {
        paymentStatus: "REJECTED",
        verifiedAt: null,
        verifiedByUserId: null,
        rejectedAt: new Date(),
        rejectionReason: "Blurry screenshot — staff only",
      },
    });
    const rejected = await getApplicantPaymentView(prisma, a.slug, accessA, tokenA);
    assert.strictEqual(rejected.paymentStatus, "REJECTED");
    assert.strictEqual(rejected.guidance.code, "REJECTED");
    assert.strictEqual(rejected.guidance.shouldPay, true);
    assert.ok(!JSON.stringify(rejected).includes("Blurry"));
    assert.ok(!JSON.stringify(rejected).includes("rejectionReason"));

    // Incomplete bank config school
    const draftNb = await createDraftApplication(prisma, noBank.slug, {
      requestedGrade: "Grade 1",
      learner: { firstName: "", lastName: "" },
    });
    await completeDraft(noBank.slug, draftNb.application.publicAccessId, draftNb.accessToken);
    await submitApplication(prisma, noBank.slug, draftNb.application.publicAccessId, draftNb.accessToken);
    const incomplete = await getApplicantPaymentView(
      prisma,
      noBank.slug,
      draftNb.application.publicAccessId,
      draftNb.accessToken
    );
    assert.strictEqual(incomplete.feeRequired, true);
    assert.strictEqual(incomplete.bankConfigurationIncomplete, true);
    assert.strictEqual(incomplete.paymentInstructionsAvailable, false);
    assert.strictEqual(incomplete.bank, null);
    assert.strictEqual(incomplete.guidance.code, "BANK_CONFIGURATION_INCOMPLETE");
    assert.strictEqual(incomplete.guidance.shouldPay, false);

    // NOT_REQUIRED
    const draftFree = await createDraftApplication(prisma, free.slug, {
      requestedGrade: "Grade 1",
      learner: { firstName: "", lastName: "" },
    });
    await completeDraft(free.slug, draftFree.application.publicAccessId, draftFree.accessToken);
    await submitApplication(prisma, free.slug, draftFree.application.publicAccessId, draftFree.accessToken);
    const noFee = await getApplicantPaymentView(
      prisma,
      free.slug,
      draftFree.application.publicAccessId,
      draftFree.accessToken
    );
    assert.strictEqual(noFee.paymentStatus, "NOT_REQUIRED");
    assert.strictEqual(noFee.feeRequired, false);
    assert.strictEqual(noFee.bank, null);
    assert.strictEqual(noFee.guidance.shouldPay, false);
    assert.ok(/no admission fee payment is required/i.test(noFee.guidance.message));

    // No side effects
    assert.strictEqual(await prisma.learner.count({ where: { schoolId: a.school.id } }), 0);
    assert.strictEqual(await prisma.parent.count({ where: { schoolId: a.school.id } }), 0);

    console.log("OA-03E integration tests passed");
  } finally {
    for (const id of schoolIds) {
      await cleanupSchool(id);
    }
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
