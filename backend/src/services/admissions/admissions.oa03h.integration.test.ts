/**
 * OA-03H integration tests — applicant info-request response loop (local educlear only).
 * Run: npx ts-node --transpile-only src/services/admissions/admissions.oa03h.integration.test.ts
 */
import "dotenv/config";
import assert from "assert";
import { PrismaClient } from "@prisma/client";

import {
  INFORMATION_SUPPLIED_EVENT,
  markInformationSupplied,
} from "./applicantInfoResponseService";
import { uploadApplicantDocument } from "./admissionsDocumentService";
import {
  createDraftApplication,
  getApplicationForApplicant,
  updateDraftApplication,
} from "./draftApplicationService";
import { PublicAdmissionsError } from "./resolvePublicAdmissions";
import { submitApplication } from "./submitApplicationService";
import { StaffAdmissionsError } from "./staffAdmissionsReadService";
import {
  requestApplicationInfo,
  resumeApplicationReview,
  startApplicationReview,
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
  role: "Admin" | "Finance",
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

async function makeSchool(suffix: string) {
  const school = await prisma.school.create({ data: { name: `OA03H ${suffix}` } });
  const slug = `oa03h-${suffix}-${Date.now().toString(36)}`;
  await prisma.schoolAdmissionsSettings.create({
    data: {
      schoolId: school.id,
      enabled: true,
      publicSlug: slug,
      intakeYear: 2027,
      acceptedGrades: ["Grade 1", "Grade 2"],
      admissionFeeRequired: false,
      currency: "ZAR",
      requiredDocuments: [
        { key: "birth_certificate", label: "Birth certificate", required: true },
        { key: "parent_id", label: "Parent ID", required: true },
      ],
      applicationQuestions: [{ key: "why", label: "Why apply?", required: true }],
    },
  });
  const admin = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `oa03h-admin-${suffix}-${Date.now()}@example.com`,
      passwordHash: "x",
      role: "SCHOOL_ADMIN",
      isActive: true,
    },
  });
  const finance = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `oa03h-fin-${suffix}-${Date.now()}@example.com`,
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
  await prisma.user.deleteMany({ where: { schoolId, email: { startsWith: "oa03h-" } } });
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
  await submitApplication(prisma, slug, draft.application.publicAccessId, draft.accessToken);
  const row = await prisma.admissionApplication.findFirstOrThrow({
    where: { publicAccessId: draft.application.publicAccessId },
  });
  return {
    appId: row.id,
    accessId: draft.application.publicAccessId,
    token: draft.accessToken,
  };
}

async function moveToInfoRequested(
  slug: string,
  schoolId: string,
  staff: StaffWorkflowActor,
  app: { appId: string; accessId: string; token: string },
  message: string
) {
  await startApplicationReview(prisma, staff, app.appId);
  await requestApplicationInfo(prisma, staff, app.appId, {
    message,
    internalNote: "Staff-only note must stay private",
  });
  const viewed = await getApplicationForApplicant(prisma, slug, app.accessId, app.token);
  assert.strictEqual(viewed.status, "INFO_REQUESTED");
  assert.strictEqual(viewed.statusReason, message);
  assert.strictEqual("internalNote" in viewed, false);
  assert.strictEqual("staffNotes" in viewed, false);
  const notes = await prisma.admissionStaffNote.findMany({ where: { applicationId: app.appId } });
  assert.ok(notes.some((n) => n.body === "Staff-only note must stay private"));
  void schoolId;
  return viewed;
}

async function main() {
  assertLocal();
  const schoolIds: string[] = [];

  try {
    const a = await makeSchool("a");
    const b = await makeSchool("b");
    schoolIds.push(a.school.id, b.school.id);

    const financeA = actor(a.school.id, a.finance.id, "Finance", { edit: true, manage: false });
    const adminA = actor(a.school.id, a.admin.id, "Admin", { edit: true, manage: true });
    const financeB = actor(b.school.id, b.finance.id, "Finance", { edit: true, manage: false });

    const app = await completeAndSubmit(a.slug);
    const other = await completeAndSubmit(b.slug);

    // Wrong status: cannot mark supplied while SUBMITTED
    await assert.rejects(
      () => markInformationSupplied(prisma, a.slug, app.accessId, app.token),
      (err: unknown) => err instanceof PublicAdmissionsError && err.code === "INVALID_STATUS"
    );

    // Cannot edit while SUBMITTED
    await assert.rejects(
      () =>
        updateDraftApplication(prisma, a.slug, app.accessId, app.token, {
          learner: { firstName: "Hack", lastName: "Molefe" },
        }),
      (err: unknown) =>
        err instanceof PublicAdmissionsError && err.code === "APPLICATION_NOT_EDITABLE"
    );

    await moveToInfoRequested(
      a.slug,
      a.school.id,
      financeA,
      app,
      "Please correct the learner home address"
    );

    // PUBLIC READ — status + message; no staff notes
    const read = await getApplicationForApplicant(prisma, a.slug, app.accessId, app.token);
    assert.strictEqual(read.status, "INFO_REQUESTED");
    assert.strictEqual(read.statusReason, "Please correct the learner home address");

    // Non-owner / wrong token
    await assert.rejects(
      () => getApplicationForApplicant(prisma, a.slug, app.accessId, other.token),
      (err: unknown) =>
        err instanceof PublicAdmissionsError && err.code === "APPLICATION_NOT_FOUND"
    );
    await assert.rejects(
      () => getApplicationForApplicant(prisma, a.slug, other.accessId, app.token),
      (err: unknown) =>
        err instanceof PublicAdmissionsError && err.code === "APPLICATION_NOT_FOUND"
    );

    // EDITING — owner can patch allowed fields
    const privacyBefore = read.privacyAcceptedAt;
    const edited = await updateDraftApplication(prisma, a.slug, app.accessId, app.token, {
      learner: {
        firstName: "Thabo",
        lastName: "Molefe",
        birthDate: "2018-05-01",
        homeAddress: "42 Corrected Ave",
      },
      privacyAccepted: true,
      declarationsAccepted: true,
    });
    assert.strictEqual(edited.learner?.homeAddress, "42 Corrected Ave");
    assert.strictEqual(edited.status, "INFO_REQUESTED");
    assert.strictEqual(edited.privacyAcceptedAt, privacyBefore);

    const updateAudit = await prisma.admissionAuditEvent.findFirst({
      where: {
        applicationId: app.appId,
        eventType: "APPLICATION_UPDATED_WHILE_INFO_REQUESTED",
      },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(updateAudit);

    // Staff-only body injection rejected
    await assert.rejects(
      () =>
        updateDraftApplication(prisma, a.slug, app.accessId, app.token, {
          status: "UNDER_REVIEW",
        } as any),
      (err: unknown) => err instanceof PublicAdmissionsError && err.code === "PROTECTED_FIELD"
    );
    await assert.rejects(
      () =>
        updateDraftApplication(prisma, a.slug, app.accessId, app.token, {
          statusReason: "forced",
        } as any),
      (err: unknown) => err instanceof PublicAdmissionsError && err.code === "PROTECTED_FIELD"
    );
    await assert.rejects(
      () =>
        updateDraftApplication(prisma, a.slug, app.accessId, app.token, {
          schoolId: b.school.id,
        } as any),
      (err: unknown) =>
        err instanceof PublicAdmissionsError &&
        (err.code === "SCHOOL_ID_NOT_ALLOWED" || err.code === "PROTECTED_FIELD")
    );

    // Non-owner / cross-tenant cannot edit
    await assert.rejects(
      () =>
        updateDraftApplication(prisma, a.slug, app.accessId, other.token, {
          learner: { firstName: "X", lastName: "Y" },
        }),
      (err: unknown) =>
        err instanceof PublicAdmissionsError && err.code === "APPLICATION_NOT_FOUND"
    );
    await assert.rejects(
      () =>
        updateDraftApplication(prisma, b.slug, app.accessId, app.token, {
          learner: { firstName: "X", lastName: "Y" },
        }),
      (err: unknown) =>
        err instanceof PublicAdmissionsError && err.code === "APPLICATION_NOT_FOUND"
    );

    // DOCUMENTS — upload while INFO_REQUESTED; does not verify payment/docs
    const doc = await uploadApplicantDocument(prisma, a.slug, app.accessId, app.token, {
      documentType: "birth_certificate",
      buffer: minimalPdf(),
      originalFileName: "birth.pdf",
      claimedMime: "application/pdf",
    });
    assert.ok(doc.id);
    const fee = await prisma.admissionFeeRecord.findUnique({ where: { applicationId: app.appId } });
    if (fee) {
      assert.notStrictEqual(fee.paymentStatus, "VERIFIED");
    }
    await assert.rejects(
      () =>
        uploadApplicantDocument(prisma, a.slug, app.accessId, other.token, {
          documentType: "parent_id",
          buffer: minimalPdf(),
          originalFileName: "id.pdf",
          claimedMime: "application/pdf",
        }),
      (err: unknown) =>
        err instanceof PublicAdmissionsError && err.code === "APPLICATION_NOT_FOUND"
    );

    // INFORMATION-SUPPLIED
    const supplied = await markInformationSupplied(prisma, a.slug, app.accessId, app.token);
    assert.strictEqual(supplied.idempotent, false);
    assert.strictEqual(supplied.application.status, "INFO_REQUESTED");
    assert.ok(supplied.infoRequestHistoryId);
    assert.ok(supplied.informationSuppliedAt);

    const events = await prisma.admissionAuditEvent.findMany({
      where: {
        applicationId: app.appId,
        eventType: INFORMATION_SUPPLIED_EVENT,
        actorType: "APPLICANT",
      },
    });
    assert.strictEqual(events.length, 1);
    const meta = events[0].metadataJson as Record<string, unknown>;
    assert.strictEqual(meta.infoRequestHistoryId, supplied.infoRequestHistoryId);

    // Idempotent same cycle
    const again = await markInformationSupplied(prisma, a.slug, app.accessId, app.token);
    assert.strictEqual(again.idempotent, true);
    assert.strictEqual(again.infoRequestHistoryId, supplied.infoRequestHistoryId);
    assert.strictEqual(
      await prisma.admissionAuditEvent.count({
        where: { applicationId: app.appId, eventType: INFORMATION_SUPPLIED_EVENT },
      }),
      1
    );

    // Still INFO_REQUESTED — applicant cannot force UNDER_REVIEW via PATCH
    const after = await getApplicationForApplicant(prisma, a.slug, app.accessId, app.token);
    assert.strictEqual(after.status, "INFO_REQUESTED");

    // Non-owner cannot mark supplied
    await assert.rejects(
      () => markInformationSupplied(prisma, a.slug, app.accessId, other.token),
      (err: unknown) =>
        err instanceof PublicAdmissionsError && err.code === "APPLICATION_NOT_FOUND"
    );
    await assert.rejects(
      () => markInformationSupplied(prisma, a.slug, other.accessId, app.token),
      (err: unknown) =>
        err instanceof PublicAdmissionsError && err.code === "APPLICATION_NOT_FOUND"
    );

    // Staff resume after response (Finance edit)
    const resumed = await resumeApplicationReview(prisma, financeA, app.appId);
    assert.strictEqual(resumed.application.status, "UNDER_REVIEW");
    assert.ok(
      resumed.application.statusHistory.some(
        (h) => h.toStatus === "UNDER_REVIEW" && h.fromStatus === "INFO_REQUESTED"
      )
    );

    // New request cycle — applicant may respond again
    await requestApplicationInfo(prisma, adminA, app.appId, {
      message: "Also need parent ID scan",
    });
    const cycle2Read = await getApplicationForApplicant(prisma, a.slug, app.accessId, app.token);
    assert.strictEqual(cycle2Read.status, "INFO_REQUESTED");
    assert.strictEqual(cycle2Read.statusReason, "Also need parent ID scan");

    // Resume before new response fails
    await assert.rejects(
      () => resumeApplicationReview(prisma, financeA, app.appId),
      (err: unknown) =>
        err instanceof StaffAdmissionsError && err.code === "APPLICANT_RESPONSE_REQUIRED"
    );

    const supplied2 = await markInformationSupplied(prisma, a.slug, app.accessId, app.token);
    assert.strictEqual(supplied2.idempotent, false);
    assert.notStrictEqual(supplied2.infoRequestHistoryId, supplied.infoRequestHistoryId);
    assert.strictEqual(
      await prisma.admissionAuditEvent.count({
        where: { applicationId: app.appId, eventType: INFORMATION_SUPPLIED_EVENT },
      }),
      2
    );

    const resumed2 = await resumeApplicationReview(prisma, financeA, app.appId);
    assert.strictEqual(resumed2.application.status, "UNDER_REVIEW");

    // Terminal / wrong status cannot use information-supplied
    const terminal = await completeAndSubmit(a.slug);
    await assert.rejects(
      () => markInformationSupplied(prisma, a.slug, terminal.accessId, terminal.token),
      (err: unknown) => err instanceof PublicAdmissionsError && err.code === "INVALID_STATUS"
    );

    // Cross-tenant staff cannot resume school A app
    await assert.rejects(
      () => resumeApplicationReview(prisma, financeB, app.appId),
      (err: unknown) => err instanceof StaffAdmissionsError && err.statusCode === 404
    );

    // No canonical enrolment
    assert.strictEqual(await prisma.learner.count({ where: { schoolId: a.school.id } }), 0);
    assert.strictEqual(await prisma.parent.count({ where: { schoolId: a.school.id } }), 0);
    assert.strictEqual(await prisma.familyAccount.count({ where: { schoolId: a.school.id } }), 0);

    console.log("OA-03H integration tests passed");
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
