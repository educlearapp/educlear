/**
 * OA-03G integration tests — staff workflow/payment/decisions (local educlear only).
 * Run: npx ts-node --transpile-only src/services/admissions/admissions.oa03g.integration.test.ts
 */
import "dotenv/config";
import assert from "assert";
import { PrismaClient } from "@prisma/client";

import { markInformationSupplied } from "./applicantInfoResponseService";
import { uploadApplicantDocument, uploadProofOfPayment } from "./admissionsDocumentService";
import {
  createDraftApplication,
  updateDraftApplication,
} from "./draftApplicationService";
import { submitApplication } from "./submitApplicationService";
import { StaffAdmissionsError } from "./staffAdmissionsReadService";
import {
  acceptAdmissionApplication,
  rejectAdmissionApplication,
  rejectAdmissionProofOfPayment,
  requestApplicationInfo,
  resumeApplicationReview,
  startApplicationReview,
  verifyAdmissionPayment,
  waiveAdmissionFee,
  type StaffWorkflowActor,
} from "./staffAdmissionsWorkflowService";

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

function actor(
  schoolId: string,
  userId: string,
  role: "Admin" | "Finance" | "Teacher",
  flags: { edit: boolean; manage: boolean }
): StaffWorkflowActor {
  return {
    userId,
    schoolId,
    appRole: role,
    hasAdmissionsEdit: flags.edit,
    hasAdmissionsManage: flags.manage,
  };
}

async function makeSchool(suffix: string, opts?: { fee?: boolean; requirePay?: boolean }) {
  const school = await prisma.school.create({ data: { name: `OA03G ${suffix}` } });
  const slug = `oa03g-${suffix}-${Date.now().toString(36)}`;
  await prisma.schoolAdmissionsSettings.create({
    data: {
      schoolId: school.id,
      enabled: true,
      publicSlug: slug,
      intakeYear: 2027,
      acceptedGrades: ["Grade 1", "Grade 2"],
      admissionFeeRequired: Boolean(opts?.fee),
      defaultAdmissionFeeAmount: opts?.fee ? ("1600.00" as any) : null,
      currency: "ZAR",
      requirePaymentVerifiedBeforeAccept: opts?.requirePay !== false,
      requiredDocuments: [
        { key: "birth_certificate", label: "Birth certificate", required: true },
        { key: "parent_id", label: "Parent ID", required: true },
      ],
      applicationQuestions: [{ key: "why", label: "Why apply?", required: true }],
      bankName: opts?.fee ? "Test Bank" : null,
      accountHolder: opts?.fee ? "School" : null,
      accountNumber: opts?.fee ? "123456789" : null,
      branchCode: opts?.fee ? "250655" : null,
    },
  });
  const admin = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `oa03g-admin-${suffix}-${Date.now()}@example.com`,
      passwordHash: "x",
      role: "SCHOOL_ADMIN",
      isActive: true,
    },
  });
  const finance = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `oa03g-fin-${suffix}-${Date.now()}@example.com`,
      passwordHash: "x",
      role: "FINANCE",
      isActive: true,
    },
  });
  return { school, slug, admin, finance };
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
    await prisma.admissionStaffNote.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionAuditEvent.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionStatusHistory.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionPaymentHistory.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionFeeRecord.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionAnswer.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionGuardian.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionLearnerCandidate.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionApplication.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.admissionApplicationCounter.deleteMany({ where: { schoolId } });
  await prisma.schoolAdmissionsSettings.deleteMany({ where: { schoolId } });
  await prisma.user.deleteMany({ where: { schoolId, email: { startsWith: "oa03g-" } } });
  await prisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
}

async function completeAndSubmit(slug: string) {
  const draft = await createDraftApplication(prisma, slug, {
    requestedGrade: "Grade 1",
    learner: { firstName: "", lastName: "" },
  });
  await updateDraftApplication(prisma, slug, draft.application.publicAccessId, draft.accessToken, {
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
  const submitted = await submitApplication(
    prisma,
    slug,
    draft.application.publicAccessId,
    draft.accessToken
  );
  const row = await prisma.admissionApplication.findFirstOrThrow({
    where: { publicAccessId: draft.application.publicAccessId },
  });
  return {
    appId: row.id,
    accessId: draft.application.publicAccessId,
    token: draft.accessToken,
    applicationNumber: submitted.application.applicationNumber!,
  };
}

async function uploadRequiredDocs(slug: string, accessId: string, token: string) {
  await uploadApplicantDocument(prisma, slug, accessId, token, {
    documentType: "birth_certificate",
    buffer: minimalPdf(),
    originalFileName: "birth.pdf",
    claimedMime: "application/pdf",
  });
  await uploadApplicantDocument(prisma, slug, accessId, token, {
    documentType: "parent_id",
    buffer: minimalPdf(),
    originalFileName: "id.pdf",
    claimedMime: "application/pdf",
  });
}

async function main() {
  assertLocal();
  const schoolIds: string[] = [];

  try {
    const a = await makeSchool("a", { fee: true, requirePay: true });
    const b = await makeSchool("b", { fee: true, requirePay: true });
    const free = await makeSchool("free", { fee: false });
    schoolIds.push(a.school.id, b.school.id, free.school.id);

    const adminA = actor(a.school.id, a.admin.id, "Admin", { edit: true, manage: true });
    const financeA = actor(a.school.id, a.finance.id, "Finance", { edit: true, manage: false });
    const teacherA = actor(a.school.id, a.admin.id, "Teacher", { edit: false, manage: false });
    const adminB = actor(b.school.id, b.admin.id, "Admin", { edit: true, manage: true });

    const app = await completeAndSubmit(a.slug);
    const other = await completeAndSubmit(b.slug);
    const freeApp = await completeAndSubmit(free.slug);

    // Unauthorized / view-only cannot mutate
    await assert.rejects(
      () => startApplicationReview(prisma, teacherA, app.appId),
      (err: unknown) => err instanceof StaffAdmissionsError && err.statusCode === 403
    );

    // Start review
    const started = await startApplicationReview(prisma, financeA, app.appId);
    assert.strictEqual(started.application.status, "UNDER_REVIEW");
    assert.strictEqual(started.idempotent, false);
    const startedAgain = await startApplicationReview(prisma, financeA, app.appId);
    assert.strictEqual(startedAgain.idempotent, true);
    const histStart = await prisma.admissionStatusHistory.count({
      where: { applicationId: app.appId, toStatus: "UNDER_REVIEW", fromStatus: "SUBMITTED" },
    });
    assert.strictEqual(histStart, 1);

    // Invalid transition from DRAFT-like (cross already submitted)
    // Request info
    const info = await requestApplicationInfo(prisma, financeA, app.appId, {
      message: "Please upload a clearer birth certificate",
      internalNote: "Internal: blurry scan",
    });
    assert.strictEqual(info.application.status, "INFO_REQUESTED");
    assert.strictEqual(info.application.statusReason, "Please upload a clearer birth certificate");
    const notes = await prisma.admissionStaffNote.findMany({ where: { applicationId: app.appId } });
    assert.ok(notes.some((n) => n.body === "Internal: blurry scan"));

    // Resume blocked until applicant marks information supplied (OA-03H)
    await assert.rejects(
      () => resumeApplicationReview(prisma, financeA, app.appId),
      (err: unknown) =>
        err instanceof StaffAdmissionsError && err.code === "APPLICANT_RESPONSE_REQUIRED"
    );

    await markInformationSupplied(prisma, a.slug, app.accessId, app.token);

    // Resume review
    const resumed = await resumeApplicationReview(prisma, financeA, app.appId);
    assert.strictEqual(resumed.application.status, "UNDER_REVIEW");

    // Accept blocked — missing docs + unpaid
    await assert.rejects(
      () => acceptAdmissionApplication(prisma, adminA, app.appId),
      (err: unknown) =>
        err instanceof StaffAdmissionsError &&
        (err.code === "DOCUMENTS_INCOMPLETE" || err.code === "PAYMENT_NOT_VERIFIED")
    );

    // Finance cannot accept (role gate)
    await uploadRequiredDocs(a.slug, app.accessId, app.token);
    await assert.rejects(
      () => acceptAdmissionApplication(prisma, financeA, app.appId),
      (err: unknown) => err instanceof StaffAdmissionsError && err.code === "ADMISSIONS_DECISION_FORBIDDEN"
    );

    // Verify blocked without POP
    await assert.rejects(
      () => verifyAdmissionPayment(prisma, financeA, app.appId),
      (err: unknown) =>
        err instanceof StaffAdmissionsError &&
        (err.code === "PROOF_REQUIRED" || err.code === "INVALID_PAYMENT_TRANSITION")
    );

    await uploadProofOfPayment(prisma, a.slug, app.accessId, app.token, {
      buffer: minimalPdf(),
      originalFileName: "pop.pdf",
      claimedMime: "application/pdf",
    });

    // Reject POP
    const rejectedPop = await rejectAdmissionProofOfPayment(prisma, financeA, app.appId, {
      reason: "Unreadable amount",
    });
    assert.strictEqual(rejectedPop.application.payment?.paymentStatus, "REJECTED");
    assert.ok(rejectedPop.application.payment?.proofDocument);
    const proofStill = await prisma.admissionDocument.findFirst({
      where: {
        applicationId: app.appId,
        documentType: "proof_of_payment",
        deletedAt: null,
      },
    });
    assert.ok(proofStill);

    // Replacement POP possible
    await uploadProofOfPayment(prisma, a.slug, app.accessId, app.token, {
      buffer: minimalPdf(),
      originalFileName: "pop2.pdf",
      claimedMime: "application/pdf",
    });
    const feeAfter = await prisma.admissionFeeRecord.findUniqueOrThrow({
      where: { applicationId: app.appId },
    });
    assert.strictEqual(feeAfter.paymentStatus, "PROOF_UPLOADED");

    // Verify payment
    const verified = await verifyAdmissionPayment(prisma, financeA, app.appId);
    assert.strictEqual(verified.application.payment?.paymentStatus, "VERIFIED");
    assert.ok(verified.application.payment?.verifiedAt);
    assert.strictEqual(verified.application.payment?.verifiedByUserId, a.finance.id);
    const verifiedAgain = await verifyAdmissionPayment(prisma, financeA, app.appId);
    assert.strictEqual(verifiedAgain.idempotent, true);
    const verifyHist = await prisma.admissionPaymentHistory.count({
      where: { applicationId: app.appId, toStatus: "VERIFIED" },
    });
    assert.strictEqual(verifyHist, 1);

    // Accept succeeds
    const accepted = await acceptAdmissionApplication(prisma, adminA, app.appId);
    assert.strictEqual(accepted.application.status, "ACCEPTED");
    assert.ok(accepted.application.statusHistory.some((h) => h.toStatus === "ACCEPTED"));
    const acceptedAgain = await acceptAdmissionApplication(prisma, adminA, app.appId);
    assert.strictEqual(acceptedAgain.idempotent, true);
    const acceptHist = await prisma.admissionStatusHistory.count({
      where: { applicationId: app.appId, toStatus: "ACCEPTED" },
    });
    assert.strictEqual(acceptHist, 1);

    // Terminal cannot freely mutate
    await assert.rejects(
      () => startApplicationReview(prisma, financeA, app.appId),
      (err: unknown) => err instanceof StaffAdmissionsError && err.code === "APPLICATION_TERMINAL"
    );
    await assert.rejects(
      () =>
        rejectAdmissionApplication(prisma, adminA, app.appId, { reason: "too late" }),
      (err: unknown) => err instanceof StaffAdmissionsError && err.statusCode === 409
    );

    // No learner conversion
    assert.strictEqual(await prisma.learner.count({ where: { schoolId: a.school.id } }), 0);
    assert.strictEqual(await prisma.parent.count({ where: { schoolId: a.school.id } }), 0);

    // Cross-school blocked
    await assert.rejects(
      () => startApplicationReview(prisma, adminA, other.appId),
      (err: unknown) => err instanceof StaffAdmissionsError && err.statusCode === 404
    );
    await assert.rejects(
      () => startApplicationReview(prisma, adminB, app.appId),
      (err: unknown) => err instanceof StaffAdmissionsError && err.statusCode === 404
    );

    // Waive path (separate app) — not represented as VERIFIED
    const waiveTarget = await completeAndSubmit(a.slug);
    await startApplicationReview(prisma, adminA, waiveTarget.appId);
    const waived = await waiveAdmissionFee(prisma, financeA, waiveTarget.appId, {
      reason: "Scholarship",
    });
    assert.strictEqual(waived.application.payment?.paymentStatus, "WAIVED");
    assert.strictEqual(waived.application.payment?.verifiedAt, null);
    assert.strictEqual(waived.application.payment?.verifiedByUserId, null);
    assert.ok(waived.application.payment?.waivedAt);
    await uploadRequiredDocs(a.slug, waiveTarget.accessId, waiveTarget.token);
    const acceptWaived = await acceptAdmissionApplication(prisma, adminA, waiveTarget.appId);
    assert.strictEqual(acceptWaived.application.status, "ACCEPTED");

    // NOT_REQUIRED fee school
    await uploadRequiredDocs(free.slug, freeApp.accessId, freeApp.token);
    const freeAdmin = actor(free.school.id, free.admin.id, "Admin", { edit: true, manage: true });
    await startApplicationReview(prisma, freeAdmin, freeApp.appId);
    const acceptFree = await acceptAdmissionApplication(prisma, freeAdmin, freeApp.appId);
    assert.strictEqual(acceptFree.application.status, "ACCEPTED");
    assert.strictEqual(acceptFree.application.payment?.paymentStatus, "NOT_REQUIRED");

    // Application rejection records history
    const declineTarget = await completeAndSubmit(a.slug);
    await startApplicationReview(prisma, adminA, declineTarget.appId);
    const declined = await rejectAdmissionApplication(prisma, adminA, declineTarget.appId, {
      reason: "No capacity in Grade 1",
    });
    assert.strictEqual(declined.application.status, "DECLINED");
    assert.strictEqual(declined.application.statusReason, "No capacity in Grade 1");
    assert.ok(declined.application.statusHistory.some((h) => h.toStatus === "DECLINED"));
    const docsRemain = await prisma.admissionDocument.count({
      where: { applicationId: declineTarget.appId },
    });
    // may be 0 if no uploads — that's fine; application row remains
    assert.ok(await prisma.admissionApplication.findUnique({ where: { id: declineTarget.appId } }));
    void docsRemain;

    // Concurrent accept vs reject — exactly one wins
    const race = await completeAndSubmit(a.slug);
    await uploadRequiredDocs(a.slug, race.accessId, race.token);
    await uploadProofOfPayment(prisma, a.slug, race.accessId, race.token, {
      buffer: minimalPdf(),
      originalFileName: "pop.pdf",
      claimedMime: "application/pdf",
    });
    await startApplicationReview(prisma, adminA, race.appId);
    await verifyAdmissionPayment(prisma, financeA, race.appId);
    const outcomes = await Promise.allSettled([
      acceptAdmissionApplication(prisma, adminA, race.appId),
      rejectAdmissionApplication(prisma, adminA, race.appId, { reason: "Race reject" }),
    ]);
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    const rejected = outcomes.filter((o) => o.status === "rejected");
    assert.strictEqual(fulfilled.length, 1);
    assert.strictEqual(rejected.length, 1);
    const final = await prisma.admissionApplication.findUniqueOrThrow({ where: { id: race.appId } });
    assert.ok(final.status === "ACCEPTED" || final.status === "DECLINED");

    console.log("OA-03G integration tests passed");
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
